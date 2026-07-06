/**
 * HTTP surface (spec §4). Thin handlers over the repo + pipeline. Upload is idempotent
 * and kicks off async processing; review/finalize is the trust gate; /r/:id(.pdf) is the
 * shareable hosted artifact; /api/admin/* is token-gated raw-vs-polished.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
import { reportQualityMetrics, computeRollup } from './quality.js';
import { recordRunFeedback } from './observability.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerInvitationRoutes } from './auth/invitations.js';
import { bearerToken, requireAuth } from './auth/context.js';
import { makeAuthz } from './auth/authz.js';

export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, storage, config } = deps;
  const base = config.publicBaseUrl;
  const authz = makeAuthz(repo);

  // /api/auth/* (signup/login/logout/me — auth plan §4.2) + invitations (Phase 6).
  registerAuthRoutes(app, deps);
  registerInvitationRoutes(app, deps);

  /** Break-glass superadmin (§15.3): the static ADMIN_TOKEN sees all orgs, but only
   *  when explicitly enabled — off by default since Phase 4 re-gated /api/admin/*. */
  const isBreakGlass = (req: Parameters<typeof bearerToken>[0]): boolean =>
    config.admin.breakGlass && bearerToken(req) === config.admin.token;

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

  // Lazily (re)render the hosted HTML+PDF for a READY report and cache them. Edits delete
  // these artifacts (see PATCH), so the next view re-renders fresh from current data —
  // the draft watermark follows status (draft → watermark, reviewed → clean). Returns
  // false when the report isn't ready yet, so the caller shows a processing page / 425.
  const ensureArtifacts = async (id: string): Promise<boolean> => {
    const htmlKey = storageKeys.html(id);
    const pdfKey = storageKeys.pdf(id);
    if ((await storage.exists(htmlKey)) && (await storage.exists(pdfKey))) return true;
    const status = await repo.getReportStatus(id);
    if (!status || status.processing !== 'ready') return false;
    await renderAndStore(deps, id, status.status === 'reviewed');
    return true;
  };

  // Drop the cached html/pdf so the next /r/:id(.pdf) view re-renders from current data.
  const invalidateArtifacts = (id: string): Promise<void> =>
    Promise.all([
      storage.delete(storageKeys.html(id)).catch(() => {}),
      storage.delete(storageKeys.pdf(id)).catch(() => {}),
    ]).then(() => {});

  app.get('/healthz', async () => ({
    ok: true,
    storage: storage.name,
    stt: deps.transcriber.name,
    // Active STT model (nova-2 vs nova-3) — confirm the transcription tuning after a deploy.
    sttModel: deps.transcriber.name === 'deepgram' ? config.stt.model : null,
    synthesis: deps.synthesizer.name,
    // Active synthesis model + whether LangSmith tracing is on — confirm both after a deploy.
    model: deps.synthesizer.name === 'claude' ? config.synthesis.model : null,
    langsmith: config.langsmith.enabled,
    // Render injects RENDER_GIT_COMMIT — lets us confirm which commit is live after a deploy.
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'dev',
    node: process.version,
  }));

  // ── Upload (multipart: manifest field + media parts) ──────────────────────
  // §6.1: authenticated; caller needs capture rights (org admin / pm / super) on an
  // EXISTING, org-adopted project. Authorship + display name come from the session,
  // not the manifest.
  app.post('/api/upload', { preHandler: requireAuth }, async (req, reply) => {
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

    if (!(await authz.canCapture(req, parsed.data.projectId))) {
      return reply.code(403).send({ error: 'no capture access to this project' });
    }
    // The session, not the manifest, says who prepared the report.
    const manifest = { ...parsed.data, superName: req.auth!.user.name ?? parsed.data.superName };

    const result = await processUpload({ manifest, files, storage, repo });
    await repo.setReportCreatedBy(result.reportId, req.auth!.userId); // fill-if-null
    // Fire-and-forget processing; failures recorded as processing='failed'.
    void runPipeline(deps, result.reportId).catch((err) =>
      app.log.error({ err, reportId: result.reportId }, 'pipeline failed'),
    );
    return reply.code(202).send(result);
  });

  // ── Reports ───────────────────────────────────────────────────────────────

  // §6.2: the scoped list (replaces /api/admin/reports for normal users). Role-aware:
  // pm/super/admin see drafts + finalized; viewers and visibility-org members see
  // finalized only. Each row carries the latest-send chip (null until Phase 8 sends).
  app.get<{ Querystring: { projectId?: string } }>(
    '/api/reports',
    { preHandler: requireAuth },
    async (req, reply) => {
      const projectId = req.query.projectId;
      if (!projectId) return reply.code(400).send({ error: 'projectId query is required' });
      if (!(await authz.canViewProject(req, projectId))) {
        return reply.code(404).send({ error: 'not found' }); // don't leak existence
      }
      const all = await repo.listReportsForProject(projectId);
      const visible = [];
      for (const r of all) if (await authz.canViewReport(req, r)) visible.push(r);
      // Per-row rollup is 2 small queries each — fine at pilot scale; batch when the
      // list view grows (getReportLatestSendSummary batching noted in the plan).
      return Promise.all(
        visible.map(async (r) => ({
          ...(await resolveReport(r)),
          lastSend: await repo.getReportLatestSendSummary(r.id),
        })),
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/reports/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const r = await repo.getReport(req.params.id);
      // 404 (not 403) when unauthorized, to avoid leaking existence (§6.3).
      if (!r || !(await authz.canViewReport(req, r))) {
        return reply.code(404).send({ error: 'not found' });
      }
      return resolveReport(r);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/reports/:id/status',
    { preHandler: requireAuth },
    async (req, reply) => {
      const r = await repo.getReport(req.params.id);
      if (!r || !(await authz.canViewReport(req, r))) {
        return reply.code(404).send({ error: 'not found' });
      }
      return repo.getReportStatus(req.params.id);
    },
  );

  // Inline edits — draft only (review gate, spec §3). §6.4: admin/pm edit any report
  // on the project; a super edits their own (D-6).
  app.patch<{ Params: { id: string } }>(
    '/api/reports/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
    const existing = await repo.getReport(req.params.id);
    if (!existing || !(await authz.canViewReport(req, existing))) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (!(await authz.canEditReport(req, existing))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const parsed = ReportEdit.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid edit', issues: parsed.error.issues });
    }
    const r = await repo.applyEdit(req.params.id, parsed.data);
    if (!r) return reply.code(404).send({ error: 'not found or not editable' });
    let result = r;

    // The summary is derived from the narrations. When the super corrects an observation's
    // description (and isn't hand-editing the summary itself), regenerate the summary so it
    // reflects the change. Best-effort: a failure here must not fail the edit.
    const descChanged = parsed.data.observations?.some((o) => o.cleanedDescription !== undefined);
    if (descChanged && parsed.data.summary === undefined) {
      try {
        const projectId = await repo.getReportProjectId(r.id);
        const project = projectId ? await repo.getProject(projectId) : null;
        const summary = await deps.synthesizer.resummarize({
          project: {
            name: project?.name ?? 'Project',
            superName: r.superName,
            date: r.date,
            glossary: project?.glossary ?? [],
          },
          observations: r.observations.map((o) => ({
            id: o.id,
            order: o.order,
            cleanedDescription: o.cleanedDescription ?? '',
            trade: o.trade,
            area: o.area,
          })),
        });
        const r2 = await repo.applyEdit(r.id, { summary });
        if (r2) result = r2;
      } catch (err) {
        app.log.error({ err, reportId: r.id }, 'summary regeneration failed');
      }
    }
    // The edit (and any resummary) changed the report — drop the stale hosted html/pdf so
    // the next view re-renders fresh (1.1). The edit also reverted status to draft in the
    // repo, so that re-render will show the draft watermark until it's finalized again.
    await invalidateArtifacts(req.params.id);
    return resolveReport(result);
  });

  // Finalize: re-render the reviewed version, flip status -> reviewed. §6.5:
  // canFinalize = canEdit (admin/pm any; super their own — D-6).
  app.post<{ Params: { id: string } }>(
    '/api/reports/:id/finalize',
    { preHandler: requireAuth },
    async (req, reply) => {
    const existing = await repo.getReport(req.params.id);
    if (!existing || !(await authz.canViewReport(req, existing))) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (!(await authz.canFinalize(req, existing))) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    await renderAndStore(deps, req.params.id, true);
    const r = await repo.finalize(req.params.id);
    if (!r) return reply.code(409).send({ error: 'could not finalize' });
    // Close the loop: attach review outcomes (edit distance, sent-unmodified) to the trace.
    // Fire-and-forget so observability never delays or fails the finalize response.
    if (config.langsmith.enabled) {
      void emitReviewFeedback(deps, req.params.id).catch((err) =>
        app.log.error({ err, reportId: req.params.id }, 'review feedback failed'),
      );
    }
    return resolveReport(r);
  });

  // ── Hosted artifacts ────────────────────────────────────────────────────────
  // §6.6: /r/:id is now INTERNAL (session + canViewReport; used by the web app's
  // view/preview). External recipients get capability URLs at /s/:token in Phase 8 —
  // do not reopen /r. 404 on no-access to avoid leaking report ids.
  const guardReportView = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const id = (req.params as { id: string }).id;
    const r = await repo.getReport(id);
    if (!r || !(await authz.canViewReport(req, r))) {
      await reply.code(404).send({ error: 'not found' });
      return false;
    }
    return true;
  };

  app.get<{ Params: { id: string } }>(
    '/r/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await guardReportView(req, reply))) return reply;
      if (!(await ensureArtifacts(req.params.id))) {
        reply.type('text/html');
        return processingPage(req.params.id, base);
      }
      const obj = await storage.get(storageKeys.html(req.params.id));
      reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache');
      return reply.send(Buffer.from(obj.bytes));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/r/:id.pdf',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await guardReportView(req, reply))) return reply;
      if (!(await ensureArtifacts(req.params.id))) return reply.code(425).send({ error: 'not ready' });
      const obj = await storage.get(storageKeys.pdf(req.params.id));
      reply
        .type('application/pdf')
        .header('content-disposition', `inline; filename="field-report-${req.params.id}.pdf"`)
        .header('cache-control', 'no-cache');
      return reply.send(Buffer.from(obj.bytes));
    },
  );

  // ── Media (local-disk driver serves bytes here; S3/R2 returns signed URLs) ──
  // §6.7: rendered HTML/PDF embed photos as data-URLs, so only the admin raw-view
  // needs these bytes — gate behind org-admin (or break-glass). Private cache: the
  // response now varies by authorization.
  app.get('/media/*', async (req, reply) => {
    if (!isBreakGlass(req)) {
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
      if (!(await authz.adminOrgIds(req)).length) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    }
    const key = (req.params as Record<string, string>)['*'];
    if (!key || !(await storage.exists(key))) return reply.code(404).send({ error: 'not found' });
    const obj = await storage.get(key);
    reply.type(obj.contentType).header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(Buffer.from(obj.bytes));
  });

  // ── Admin (raw-vs-polished) ─────────────────────────────────────────────────
  // §6.8: re-gated to org-admin sessions, scoped to the admin's orgs. The static
  // ADMIN_TOKEN only works as an unscoped break-glass superadmin when
  // ADMIN_BREAK_GLASS is enabled (off by default, §15.3).
  app.register(async (admin) => {
    admin.addHook('preHandler', async (req, reply) => {
      if (isBreakGlass(req)) return;
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
      if (!(await authz.adminOrgIds(req)).length) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    });

    /** Orgs this admin may see; null = unscoped break-glass. */
    const adminScope = async (req: FastifyRequest): Promise<string[] | null> =>
      isBreakGlass(req) ? null : authz.adminOrgIds(req);

    admin.get('/api/admin/reports', async (req) => {
      const scope = await adminScope(req);
      const reports = scope === null ? await repo.listReports() : await repo.listReportsForOrgs(scope);
      return Promise.all(reports.map(resolveReport));
    });

    // Quality + reliability rollup across the admin's orgs (KPIs: success rate,
    // sent-unmodified rate, avg edit distance, transcription confidence). MONITORING.md.
    admin.get('/api/admin/metrics', async (req) => {
      const scope = await adminScope(req);
      const quality =
        scope === null ? await repo.listReportQuality() : await repo.listReportQualityForOrgs(scope);
      return computeRollup(quality);
    });

    admin.get<{ Params: { id: string } }>('/api/admin/reports/:id', async (req, reply) => {
      const report = await repo.getReport(req.params.id);
      if (!report) return reply.code(404).send({ error: 'not found' });
      const scope = await adminScope(req);
      if (scope !== null) {
        const orgId = await repo.getReportOrgId(req.params.id);
        if (!orgId || !scope.includes(orgId)) return reply.code(404).send({ error: 'not found' });
      }
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

/** After review/finalize, attach the review outcomes to the report's LangSmith run so the
 *  trace records how much the super changed the AI draft. Best-effort; never throws. */
async function emitReviewFeedback(deps: ServerDeps, id: string): Promise<void> {
  const q = await deps.repo.getReportQuality(id);
  if (!q?.runId) return;
  const m = reportQualityMetrics(q);
  await recordRunFeedback(true, q.runId, {
    sent_unmodified: m.sentUnmodified == null ? undefined : m.sentUnmodified ? 1 : 0,
    obs_edit_distance: m.avgObsEditDistance ?? undefined,
    summary_edit_distance: m.summaryEditDistance ?? undefined,
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
