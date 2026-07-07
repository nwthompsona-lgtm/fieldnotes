/**
 * Sending & delivery (auth plan §8, Phase 8 — the distribution milestone).
 *
 * Internal (session): POST /api/reports/:id/send resolves a SendSelection to a deduped
 * recipient list, finalizes the report if needed, mints a per-person capability token,
 * records the send, remembers the selection as the project default, and emails each
 * recipient a personal /s/<token> link (best-effort). GET …/sends is the delivery audit;
 * …/recipients/:rid/{revoke,resend} manage individual links.
 *
 * External (no session): GET /s/:token(.pdf) is the capability URL mailed to a recipient —
 * validates not-revoked/not-expired, renders on demand, records the first open, and serves
 * expired/revoked pages otherwise. Hosted HTML embeds photos as data-URLs, so external
 * viewers never touch /media (§6.7).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SendRequest, type Report, type ReportSend } from '@fieldreport/contracts';
import type { ServerDeps } from './deps.js';
import { newId, secretToken, normalizeEmail } from './ids.js';
import { requireAuth } from './auth/context.js';
import { throttle } from './auth/throttle.js';
import { ensureArtifacts, renderAndStore } from './pipeline.js';
import { storageKeys } from './storage/types.js';
import { shareEmail, sendBestEffort } from './email/index.js';
import { escapeHtml } from './html.js';
import type { ReportAccessMeta } from './auth/authz.js';

export function registerSendRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, storage, authz, config } = deps;
  const base = config.publicBaseUrl;

  /** view + canSend gate for the send/delivery family: 404 (no leak) when unviewable,
   *  403 when viewable-but-not-send-capable. Returns the meta or null (reply already sent). */
  const guardSend = async (
    id: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ReportAccessMeta | null> => {
    const meta = await repo.getReportViewMeta(id);
    if (!meta || !(await authz.canViewReport(req, meta))) {
      await reply.code(404).send({ error: 'not found' });
      return null;
    }
    if (!(await authz.canSend(req, meta))) {
      await reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return meta;
  };

  /** Email one recipient their personal link (best-effort). From: "<super> via FieldReport",
   *  reply-to the human who sent it. */
  const emailRecipient = async (
    req: FastifyRequest,
    report: Report,
    rec: { name: string; email: string },
    token: string,
    expiresAt: Date,
    message?: string,
  ): Promise<void> => {
    const rendered = shareEmail({
      projectName: report.projectName ?? 'the project',
      date: report.date,
      senderName: report.superName,
      recipientName: rec.name,
      message,
      link: `${base}/s/${token}`,
      expiresAt,
    });
    await sendBestEffort(
      deps.email,
      {
        to: { email: rec.email, name: rec.name },
        fromName: `${report.superName} via FieldReport`,
        replyTo: req.auth!.user.email ? { email: req.auth!.user.email, name: req.auth!.user.name } : undefined,
        ...rendered,
      },
      (o, m) => req.log.error(o, m),
    );
  };

  // ── Send ────────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/reports/:id/send',
    { preHandler: requireAuth },
    async (req, reply) => {
      const meta = await guardSend(req.params.id, req, reply);
      if (!meta) return reply;
      const parsed = SendRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid send', issues: parsed.error.issues });
      }
      const { selection, message, expiresInDays } = parsed.data;

      const report = await repo.getReport(req.params.id);
      if (!report) return reply.code(404).send({ error: 'not found' });
      const orgId = await repo.getReportOrgId(req.params.id);
      if (!orgId) return reply.code(409).send({ error: 'report has no org (unadopted project)' });

      // Resolve the selection → concrete recipients (tenancy-safe), then add ad-hoc one-offs,
      // deduped by normalized email (a directory contact wins over a typed duplicate).
      const dir = await repo.resolveSelectionContacts(orgId, selection.orgIds, selection.contactIds);
      const byEmail = new Map<string, { contactId?: string; name: string; email: string }>();
      for (const c of dir) byEmail.set(normalizeEmail(c.email), c);
      for (const a of selection.adHoc) {
        const key = normalizeEmail(a.email);
        if (!byEmail.has(key)) byEmail.set(key, { name: a.name, email: a.email });
      }
      const recipients = [...byEmail.values()];
      if (!recipients.length) return reply.code(400).send({ error: 'no recipients selected' });

      // Sending finalizes (export = finalize): render + flip to reviewed if still a draft.
      if (meta.status !== 'reviewed') {
        await renderAndStore(deps, req.params.id, true);
        await repo.finalize(req.params.id);
      }

      const sendId = newId('snd');
      await repo.createReportSend({ id: sendId, reportId: req.params.id, sentBy: req.auth!.userId, message });

      const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
      const minted = recipients.map((r) => ({ ...r, id: newId('rcp'), token: secretToken('tok') }));
      await repo.createRecipients(
        minted.map((r) => ({
          id: r.id,
          sendId,
          contactId: r.contactId,
          email: r.email,
          name: r.name,
          token: r.token,
          expiresAt,
        })),
      );

      // Remember this selection as the project's default (D-8).
      await repo.setDistributionDefault(report.projectId, selection);

      // Emails are best-effort + per-recipient: one bad address never fails the whole send.
      for (const r of minted) await emailRecipient(req, report, r, r.token, expiresAt, message);

      const sends = await repo.listSendsForReport(req.params.id);
      const created = sends.find((s) => s.id === sendId) ?? sends[0];
      return reply.code(201).send(created satisfies ReportSend | undefined);
    },
  );

  // ── Delivery audit ────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/reports/:id/sends',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await guardSend(req.params.id, req, reply))) return reply;
      return repo.listSendsForReport(req.params.id);
    },
  );

  app.post<{ Params: { id: string; rid: string } }>(
    '/api/reports/:id/recipients/:rid/revoke',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await guardSend(req.params.id, req, reply))) return reply;
      const rec = await repo.getRecipientById(req.params.rid);
      if (!rec || rec.reportId !== req.params.id) return reply.code(404).send({ error: 'not found' });
      await repo.revokeRecipient(req.params.rid);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string; rid: string } }>(
    '/api/reports/:id/recipients/:rid/resend',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await guardSend(req.params.id, req, reply))) return reply;
      const rec = await repo.getRecipientById(req.params.rid);
      if (!rec || rec.reportId !== req.params.id) return reply.code(404).send({ error: 'not found' });
      const report = await repo.getReport(req.params.id);
      if (!report) return reply.code(404).send({ error: 'not found' });

      // Re-send the same link, unless it's revoked or expired — then mint a fresh 30-day one
      // on the same row (preserving the open history).
      let token = rec.token;
      let expiresAt = rec.expiresAt;
      if (rec.revokedAt || rec.expiresAt.getTime() < Date.now()) {
        token = secretToken('tok');
        expiresAt = new Date(Date.now() + 30 * 86_400_000);
        await repo.refreshRecipientToken(req.params.rid, { token, expiresAt });
      }
      await emailRecipient(req, report, { name: rec.name, email: rec.email }, token, expiresAt);
      return { ok: true, recipientId: rec.id, resentTo: rec.email };
    },
  );

  // ── External capability URL (no session) ────────────────────────────────────
  const servePage = (reply: FastifyReply, code: number, html: string) =>
    reply.code(code).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html);

  /** Validate a share token → recipient+report, or send the right failure page. */
  const resolveShare = async (
    token: string,
    reply: FastifyReply,
  ): Promise<{ reportId: string } | null> => {
    const rec = await repo.getRecipientByToken(token);
    if (!rec) {
      await servePage(reply, 404, sharePage('Link not found', 'This share link is not valid.'));
      return null;
    }
    if (rec.revokedAt) {
      await servePage(reply, 410, sharePage('Link revoked', 'This link has been revoked by the sender.'));
      return null;
    }
    if (rec.expiresAt.getTime() < Date.now()) {
      await servePage(reply, 410, sharePage('Link expired', 'This link has expired — ask the sender for a new one.'));
      return null;
    }
    return { reportId: rec.reportId };
  };

  app.get<{ Params: { token: string } }>('/s/:token', { preHandler: throttle }, async (req, reply) => {
    const r = await resolveShare(req.params.token, reply);
    if (!r) return reply;
    if (!(await ensureArtifacts(deps, r.reportId))) {
      return servePage(reply, 503, sharePage('Not ready yet', 'This report is still being prepared. Try again shortly.'));
    }
    // The HTML view is the canonical "opened" (§8.4) — record it, then serve with a banner.
    await repo.recordRecipientOpen(req.params.token);
    const obj = await storage.get(storageKeys.html(r.reportId));
    const html = Buffer.from(obj.bytes).toString('utf8');
    return servePage(reply, 200, injectShareBanner(html));
  });

  app.get<{ Params: { token: string } }>('/s/:token.pdf', { preHandler: throttle }, async (req, reply) => {
    const r = await resolveShare(req.params.token, reply);
    if (!r) return reply;
    if (!(await ensureArtifacts(deps, r.reportId))) return reply.code(503).send({ error: 'not ready' });
    // No extra open recorded here — the HTML view is the canonical open (§8.4).
    const obj = await storage.get(storageKeys.pdf(r.reportId));
    reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="field-report-${r.reportId}.pdf"`)
      .header('cache-control', 'no-store');
    return reply.send(Buffer.from(obj.bytes));
  });
}

/** A thin read-only banner injected at the top of the shared report body. */
function injectShareBanner(html: string): string {
  const banner =
    `<div style="background:#1d4ed8;color:#fff;font:500 13px/1.4 'IBM Plex Sans',-apple-system,Segoe UI,Roboto,sans-serif;` +
    `padding:8px 16px;text-align:center;">Shared with you · read-only</div>`;
  const i = html.indexOf('<body>');
  return i === -1 ? banner + html : html.slice(0, i + 6) + banner + html.slice(i + 6);
}

/** Minimal branded page for share-link failures (not-found / revoked / expired / not-ready). */
function sharePage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)} — FieldReport</title>
<style>body{font-family:'IBM Plex Sans',-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f8;color:#1f2937;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px 40px;text-align:center;max-width:440px}
.mark{font-size:13px;font-weight:700;letter-spacing:.02em;color:#1d4ed8;margin-bottom:14px}
.muted{color:#6b7280;font-size:15px;line-height:1.5}</style></head>
<body><div class="card"><div class="mark">FieldReport</div><h2>${escapeHtml(title)}</h2>
<p class="muted">${escapeHtml(message)}</p></div></body></html>`;
}
