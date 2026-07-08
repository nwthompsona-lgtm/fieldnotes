/**
 * HTTP surface (spec §4). Thin handlers over the repo + pipeline. Upload is idempotent
 * and kicks off async processing; review/finalize is the trust gate; /r/:id(.pdf) is the
 * shareable hosted artifact; /api/admin/* is token-gated raw-vs-polished.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  UploadManifest,
  ReportEdit,
  type Report,
  type AdminReportView,
} from '@fieldreport/contracts';
import type { ServerDeps } from './deps.js';
import { processUpload } from './ingest/index.js';
import { runPipeline, renderAndStore, ensureArtifacts } from './pipeline.js';
import { storageKeys } from './storage/types.js';
import { verifyMediaSignature } from './storage/local.js';
import { reportQualityMetrics, computeRollup } from './quality.js';
import { recordRunFeedback } from './observability.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerInvitationRoutes } from './auth/invitations.js';
import { registerDirectoryRoutes } from './directory.js';
import { registerSendRoutes } from './send.js';
import { registerSettingsRoutes } from './settings.js';
import { bearerToken, requireAuth } from './auth/context.js';
import type { ReportAccessMeta } from './auth/authz.js';

/** Constant-time string compare (length-guarded — timingSafeEqual requires equal lengths).
 *  Leaks only length, never a byte-by-byte prefix-match timing signal. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, storage, config, authz } = deps;
  const base = config.publicBaseUrl;

  // /api/auth/* (signup/login/logout/me — auth plan §4.2) + invitations (Phase 6) +
  // stakeholder directory / roster / distribution defaults (Phase 7) + send/delivery +
  // external /s/:token (Phase 8).
  registerAuthRoutes(app, deps);
  registerInvitationRoutes(app, deps);
  registerDirectoryRoutes(app, deps);
  registerSendRoutes(app, deps);
  registerSettingsRoutes(app, deps);

  /** Break-glass superadmin (§15.3): the static ADMIN_TOKEN sees all orgs, but only
   *  when explicitly enabled — off by default since Phase 4 re-gated /api/admin/*.
   *  Constant-time token compare so it isn't a timing oracle when break-glass is on. */
  const isBreakGlass = (req: FastifyRequest): boolean => {
    if (!config.admin.breakGlass) return false;
    const tok = bearerToken(req);
    return tok != null && safeEqual(tok, config.admin.token);
  };

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

  // Hosted-artifact lazy render/cache now lives in pipeline.ts (shared with /s/:token). Edits
  // invalidate the cache (see PATCH) so the next view re-renders fresh; the draft watermark
  // follows status. Returns false when the report isn't ready → caller shows a 425/processing.
  const ensureArtifactsFor = (id: string): Promise<boolean> => ensureArtifacts(deps, id);

  // The §6.3 view gate in ONE place: fetch the cheap access-meta (not a full report) and
  // 404 — never 403 — when the report is missing or unviewable, so ids never leak. Every
  // read/edit/finalize/hosted route funnels through this, so a new route can't forget it or
  // accidentally return 403 and turn report-id existence into an oracle. Returns the meta,
  // or null after it has already sent the 404.
  const loadViewableReport = async (
    id: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ReportAccessMeta | null> => {
    const meta = await repo.getReportViewMeta(id);
    if (!meta || !(await authz.canViewReport(req, meta))) {
      await reply.code(404).send({ error: 'not found' });
      return null;
    }
    return meta;
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
    email: deps.email.name,
    // Render injects RENDER_GIT_COMMIT — lets us confirm which commit is live after a deploy.
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'dev',
    node: process.version,
  }));

  // ── Upload (multipart: manifest field + media parts) ──────────────────────
  // §6.1: authenticated; caller needs capture rights (org admin / pm / super) on an
  // EXISTING, org-adopted project. Authorship + display name come from the session,
  // not the manifest.
  app.post('/api/upload', { preHandler: requireAuth }, async (req, reply) => {
    // The capture client sends the manifest FIRST (apps/capture/src/sync.ts), so we parse
    // + authorize it before buffering any media: a caller with no capture rights on the
    // project is denied without the server holding a single photo in memory (an authed
    // viewer could otherwise stream gigabytes to a project they can't touch). If a media
    // part arrives before the manifest (older client), it is buffered as before.
    let manifestRaw: string | undefined;
    let parsed: UploadManifest | undefined;
    let denied = false;
    const files = new Map<string, Uint8Array>();
    for await (const part of req.parts()) {
      if (part.fieldname === 'manifest') {
        manifestRaw = part.type === 'file' ? (await part.toBuffer()).toString('utf8') : String(part.value);
        let json: unknown;
        try {
          json = JSON.parse(manifestRaw);
        } catch {
          json = undefined;
        }
        const p = json === undefined ? null : UploadManifest.safeParse(json);
        if (p?.success) {
          parsed = p.data;
          denied = !(await authz.canCapture(req, parsed.projectId));
        }
      } else if (part.type === 'file') {
        // Once denied, drain-and-discard the remaining parts (bounded to one at a time)
        // rather than retaining them — the forbidden upload buffers nothing.
        if (denied) {
          await part.toBuffer();
          continue;
        }
        files.set(part.fieldname, new Uint8Array(await part.toBuffer()));
      }
    }

    if (!manifestRaw) return reply.code(400).send({ error: 'missing manifest part' });
    if (!parsed) {
      let json: unknown;
      try {
        json = JSON.parse(manifestRaw);
      } catch {
        return reply.code(400).send({ error: 'manifest is not valid JSON' });
      }
      const p = UploadManifest.safeParse(json);
      return reply
        .code(400)
        .send({ error: 'invalid manifest', issues: p.success ? undefined : p.error.issues });
    }
    if (denied) return reply.code(403).send({ error: 'no capture access to this project' });

    // The session, not the manifest, says who prepared the report (empty display name →
    // fall back to the manifest's superName rather than stamping a blank one).
    const auth = req.auth!; // requireAuth preHandler guarantees a session here
    // Empty/absent display name → keep the manifest's superName rather than stamping a blank.
    const sessionName = auth.user.name?.trim();
    const superName = sessionName || parsed.superName;
    const manifest = { ...parsed, superName };

    // createdBy is written atomically in the report insert (§6.1) — no follow-up UPDATE a
    // crash could skip and the boot backfill then mis-attribute.
    const result = await processUpload({ manifest, files, storage, repo, createdBy: auth.userId });
    // Fire-and-forget processing; failures recorded as processing='failed'.
    void runPipeline(deps, result.reportId).catch((err) =>
      app.log.error({ err, reportId: result.reportId }, 'pipeline failed'),
    );
    return reply.code(202).send(result);
  });

  // ── Workspace (app-shell switchers) ─────────────────────────────────────────
  // The projects the caller can see in an org (admins: all; members: their assignments +
  // org-visible projects — repo.listProjectsForUser scopes it), each with the caller's
  // explicit project role (null = visible via org visibility / org-admin only) so the UI
  // can gate actions per the permission matrix. 404 (no leak) when the caller isn't a
  // member of the org. Feeds the web app's project switcher (§9 shell).
  app.get<{ Params: { orgId: string } }>(
    '/api/orgs/:orgId/projects',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await repo.getMembership(req.auth!.userId, req.params.orgId))) {
        return reply.code(404).send({ error: 'not found' });
      }
      const [projs, roleRows] = await Promise.all([
        repo.listProjectsForUser(req.auth!.userId, req.params.orgId),
        repo.listProjectRolesForUser(req.auth!.userId, req.params.orgId),
      ]);
      const roles = new Map(roleRows.map((r) => [r.projectId, r.role]));
      return projs.map((p) => ({ ...p, role: roles.get(p.id) ?? null }));
    },
  );

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
      // One batched rollup for the whole list (2 queries total) instead of 2-per-row.
      const sends = await repo.getLatestSendSummaries(visible.map((r) => r.id));
      return Promise.all(
        visible.map(async (r) => ({
          ...(await resolveReport(r)),
          lastSend: sends.get(r.id) ?? null,
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
      // Per-requester edit capability, derived from the report's OWN org/project — the
      // client can't compute this reliably (its UI state tracks the currently-viewed org,
      // which misclassifies cross-org reports; verified failure in the Phase 9–12 review).
      return { ...(await resolveReport(r)), canEdit: await authz.canEditReport(req, r) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/reports/:id/status',
    { preHandler: requireAuth },
    async (req, reply) => {
      // Hot polling path: authorize from the cheap access-meta, not a full assembly.
      if (!(await loadViewableReport(req.params.id, req, reply))) return reply;
      return repo.getReportStatus(req.params.id);
    },
  );

  // Inline edits — draft only (review gate, spec §3). §6.4: admin/pm edit any report
  // on the project; a super edits their own (D-6).
  app.patch<{ Params: { id: string } }>(
    '/api/reports/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
    const meta = await loadViewableReport(req.params.id, req, reply);
    if (!meta) return reply;
    if (!(await authz.canEditReport(req, meta))) {
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
    const meta = await loadViewableReport(req.params.id, req, reply);
    if (!meta) return reply;
    if (!(await authz.canFinalize(req, meta))) {
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
  // do not reopen /r. 404 on no-access (via loadViewableReport) to avoid leaking ids.
  // Break-glass (§15.3): the admin surface links here for raw-vs-polished comparison, so
  // when ADMIN_BREAK_GLASS is on the static token is accepted like on /api/admin/* —
  // otherwise those links dead-end for an operator whose session isn't in the report's org.
  const requireAuthOrBreakGlass = async (req: FastifyRequest, reply: FastifyReply) => {
    if (isBreakGlass(req)) return;
    return requireAuth(req, reply);
  };
  const hostedViewGate = async (
    id: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> => {
    if (isBreakGlass(req)) {
      if (await repo.getReportViewMeta(id)) return true;
      await reply.code(404).send({ error: 'not found' });
      return false;
    }
    return (await loadViewableReport(id, req, reply)) != null;
  };
  app.get<{ Params: { id: string } }>(
    '/r/:id',
    { preHandler: requireAuthOrBreakGlass },
    async (req, reply) => {
      if (!(await hostedViewGate(req.params.id, req, reply))) return reply;
      if (!(await ensureArtifactsFor(req.params.id))) {
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
    { preHandler: requireAuthOrBreakGlass },
    async (req, reply) => {
      if (!(await hostedViewGate(req.params.id, req, reply))) return reply;
      if (!(await ensureArtifactsFor(req.params.id))) return reply.code(425).send({ error: 'not ready' });
      const obj = await storage.get(storageKeys.pdf(req.params.id));
      reply
        .type('application/pdf')
        .header('content-disposition', `inline; filename="field-report-${req.params.id}.pdf"`)
        .header('cache-control', 'no-cache');
      return reply.send(Buffer.from(obj.bytes));
    },
  );

  // ── Media (local-disk driver serves bytes here; S3/R2 returns signed URLs) ──
  // §6.7: this route is the LOCAL-DISK path only — prod R2 hands out signed URLs that the
  // browser loads directly (no bearer needed), and hosted HTML/PDF embed photos as
  // data-URLs. Browsers never attach Authorization to <img>/<audio> loads, so
  // LocalDiskDriver.url() mints short-lived signed URLs (?exp&sig) that this route
  // accepts WITHOUT a session — the URL is the capability, mirroring R2. Anything
  // unsigned/expired/tampered falls back to the session gate: viewability of the OWNING
  // report (key = reports/<reportId>/...) — any pm/super/viewer/admin who can see the
  // report can load its media, not just org-admins. 404 (not 403) when unviewable so
  // keys don't leak.
  app.get('/media/*', async (req, reply) => {
    const key = (req.params as Record<string, string>)['*'];
    if (!key) return reply.code(404).send({ error: 'not found' });
    const q = req.query as { exp?: string; sig?: string };
    const signedOk =
      typeof q.exp === 'string' &&
      typeof q.sig === 'string' &&
      verifyMediaSignature(key, Number(q.exp), q.sig);
    if (!signedOk && !isBreakGlass(req)) {
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
      const m = /^reports\/([^/]+)\//.exec(key);
      const meta = m ? await repo.getReportViewMeta(m[1]!) : null;
      if (!meta || !(await authz.canViewReport(req, meta))) {
        return reply.code(404).send({ error: 'not found' });
      }
    }
    if (!(await storage.exists(key))) return reply.code(404).send({ error: 'not found' });
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
      // Enforce org scope BEFORE assembling the report, so a cross-org id returns the same
      // cheap 404 as a non-existent one — no assembly-time timing oracle for existence.
      const scope = await adminScope(req);
      if (scope !== null) {
        const orgId = await repo.getReportOrgId(req.params.id);
        if (!orgId || !scope.includes(orgId)) return reply.code(404).send({ error: 'not found' });
      }
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
