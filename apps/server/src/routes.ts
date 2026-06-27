/**
 * HTTP surface (spec §4). Thin handlers over the repo + pipeline. Upload is idempotent
 * and kicks off async processing; review/finalize is the trust gate; /r/:id(.pdf) is the
 * shareable hosted artifact; /api/admin/* is token-gated raw-vs-polished.
 */
import type { FastifyInstance } from 'fastify';
import {
  UploadManifest,
  ReportEdit,
  type Report,
  type AdminReportView,
} from '@fieldreport/contracts';
import type { ServerDeps } from './deps.js';
import { processUpload } from './ingest/index.js';
import { runPipeline, renderAndStore } from './pipeline.js';
import { storageKeys } from './storage/types.js';

export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, storage, config } = deps;
  const base = config.publicBaseUrl;

  // Resolve a stored Report for API consumers: attach hosted html/pdf links and turn
  // each photo's storage key into a displayable URL (contract allows blobRef = key|URL).
  const resolveReport = async (r: Report): Promise<Report> => {
    const observations = await Promise.all(
      r.observations.map(async (o) => ({
        ...o,
        photos: await Promise.all(
          o.photos.map(async (p) => ({
            ...p,
            blobRef: p.blobRef ? await storage.url(p.blobRef) : p.blobRef,
          })),
        ),
      })),
    );
    return {
      ...r,
      observations,
      htmlUrl: `${base}/r/${r.id}`,
      pdfUrl: `${base}/r/${r.id}.pdf`,
    };
  };

  app.get('/healthz', async () => ({
    ok: true,
    storage: storage.name,
    stt: deps.transcriber.name,
    synthesis: deps.synthesizer.name,
    // Render injects RENDER_GIT_COMMIT — lets us confirm which commit is live after a deploy.
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'dev',
  }));

  // ── Upload (multipart: manifest field + media parts) ──────────────────────
  app.post('/api/upload', async (req, reply) => {
    let manifestRaw: string | undefined;
    const files = new Map<string, Uint8Array>();
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (part.fieldname === 'manifest') manifestRaw = buf.toString('utf8');
        else files.set(part.fieldname, new Uint8Array(buf));
      } else if (part.fieldname === 'manifest') {
        manifestRaw = String(part.value);
      }
    }
    if (!manifestRaw) return reply.code(400).send({ error: 'missing manifest part' });

    let json: unknown;
    try {
      json = JSON.parse(manifestRaw);
    } catch {
      return reply.code(400).send({ error: 'manifest is not valid JSON' });
    }
    const parsed = UploadManifest.safeParse(json);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid manifest', issues: parsed.error.issues });
    }

    const result = await processUpload({ manifest: parsed.data, files, storage, repo });
    // Fire-and-forget processing; failures recorded as processing='failed'.
    void runPipeline(deps, result.reportId).catch((err) =>
      app.log.error({ err, reportId: result.reportId }, 'pipeline failed'),
    );
    return reply.code(202).send(result);
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/reports/:id', async (req, reply) => {
    const r = await repo.getReport(req.params.id);
    if (!r) return reply.code(404).send({ error: 'not found' });
    return resolveReport(r);
  });

  app.get<{ Params: { id: string } }>('/api/reports/:id/status', async (req, reply) => {
    const s = await repo.getReportStatus(req.params.id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    return s;
  });

  // Inline edits — draft only (review gate, spec §3).
  app.patch<{ Params: { id: string } }>('/api/reports/:id', async (req, reply) => {
    const parsed = ReportEdit.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid edit', issues: parsed.error.issues });
    }
    const r = await repo.applyEdit(req.params.id, parsed.data);
    if (!r) return reply.code(404).send({ error: 'not found or not editable' });
    return resolveReport(r);
  });

  // Finalize: re-render the reviewed version, flip status -> reviewed.
  app.post<{ Params: { id: string } }>('/api/reports/:id/finalize', async (req, reply) => {
    const existing = await repo.getReport(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    await renderAndStore(deps, req.params.id, true);
    const r = await repo.finalize(req.params.id);
    if (!r) return reply.code(409).send({ error: 'could not finalize' });
    return resolveReport(r);
  });

  // ── Hosted artifacts (PM-facing) ───────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/r/:id', async (req, reply) => {
    const key = storageKeys.html(req.params.id);
    if (!(await storage.exists(key))) {
      reply.type('text/html');
      return processingPage(req.params.id, base);
    }
    const obj = await storage.get(key);
    reply.type('text/html; charset=utf-8');
    return reply.send(Buffer.from(obj.bytes));
  });

  app.get<{ Params: { id: string } }>('/r/:id.pdf', async (req, reply) => {
    const key = storageKeys.pdf(req.params.id);
    if (!(await storage.exists(key))) return reply.code(425).send({ error: 'not ready' });
    const obj = await storage.get(key);
    reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="field-report-${req.params.id}.pdf"`);
    return reply.send(Buffer.from(obj.bytes));
  });

  // ── Media (local-disk driver serves bytes here; S3/R2 returns signed URLs) ──
  app.get('/media/*', async (req, reply) => {
    const key = (req.params as Record<string, string>)['*'];
    if (!key || !(await storage.exists(key))) return reply.code(404).send({ error: 'not found' });
    const obj = await storage.get(key);
    reply.type(obj.contentType).header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(Buffer.from(obj.bytes));
  });

  // ── Admin (token-gated raw-vs-polished) ────────────────────────────────────
  app.register(async (admin) => {
    admin.addHook('preHandler', async (req, reply) => {
      const auth = req.headers.authorization ?? '';
      const token = auth.replace(/^Bearer\s+/i, '');
      if (token !== config.admin.token) return reply.code(401).send({ error: 'unauthorized' });
    });

    admin.get('/api/admin/reports', async () => {
      const reports = await repo.listReports();
      return Promise.all(reports.map(resolveReport));
    });

    admin.get<{ Params: { id: string } }>('/api/admin/reports/:id', async (req, reply) => {
      const report = await repo.getReport(req.params.id);
      if (!report) return reply.code(404).send({ error: 'not found' });
      const proc = await repo.getProcessingObservations(req.params.id);
      const audioByObs = new Map(proc.map((o) => [o.id, o.audioKey] as const));

      const observations = await Promise.all(
        [...report.observations]
          .sort((a, b) => a.order - b.order)
          .map(async (o) => {
            const audioKey = audioByObs.get(o.id) ?? null;
            const photoUrls = await Promise.all(
              o.photos.map((p) => (p.blobRef ? storage.url(p.blobRef) : Promise.resolve(''))),
            );
            return {
              id: o.id,
              order: o.order,
              photoUrls,
              audioUrl: audioKey ? await storage.url(audioKey) : undefined,
              transcript: o.transcript,
              cleanedDescription: o.cleanedDescription,
              trade: o.trade,
              area: o.area,
            };
          }),
      );
      const view: AdminReportView = { report: await resolveReport(report), observations };
      return view;
    });
  });
}

function processingPage(id: string, base: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="5"/>
<title>Field Report — preparing…</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f5f4;color:#16201c;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #d8e0db;border-radius:12px;padding:32px 40px;text-align:center;max-width:420px}
.mark{width:40px;height:40px;border-radius:9px;background:#0f3d2e;color:#fff;font-weight:800;display:flex;
align-items:center;justify-content:center;margin:0 auto 14px}.muted{color:#5b6b63;font-size:14px}</style></head>
<body><div class="card"><div class="mark">FR</div><h2>Preparing your report…</h2>
<p class="muted">Transcribing and writing up the walk. This page refreshes automatically.</p>
<p class="muted">Report ${id}</p></div></body></html>`;
}
