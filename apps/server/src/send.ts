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
 * validates not-revoked/not-expired AND that the report is still 'reviewed' (a post-send
 * edit reverts it to draft; recipients then get a "being updated" page, never mid-edit
 * content), renders on demand, records the first open, and serves expired/revoked pages
 * otherwise. Hosted HTML embeds photos as data-URLs, so external viewers never touch
 * /media (§6.7).
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

  /** Email one recipient their personal link (best-effort). Attribution follows the
   *  ACTUAL sender (the session user): fromName is "<sender> via FieldReport" and
   *  reply-to points at the same person, so "From" and "replies go straight to" always
   *  agree — when a PM sends a super's report, replies reach the PM, not the super. The
   *  report's preparer (superName) still appears where the report content shows it.
   *  Records the per-recipient dispatch outcome (emailError) so a provider rejection
   *  surfaces in the delivery panel instead of silently looking sent. */
  const emailRecipient = async (
    req: FastifyRequest,
    report: Report,
    rec: { id: string; name: string; email: string },
    token: string,
    expiresAt: Date,
    message?: string,
  ): Promise<void> => {
    const sender = req.auth!.user;
    const senderName = sender.name?.trim() || sender.email;
    const rendered = shareEmail({
      projectName: report.projectName ?? 'the project',
      date: report.date,
      senderName,
      recipientName: rec.name,
      message,
      link: `${base}/s/${token}`,
      expiresAt,
    });
    const outcome = await sendBestEffort(
      deps.email,
      {
        to: { email: rec.email, name: rec.name },
        fromName: `${senderName} via FieldReport`,
        replyTo: sender.email ? { email: sender.email, name: sender.name } : undefined,
        ...rendered,
      },
      (o, m) => req.log.error(o, m),
    );
    // Persist the outcome: the failure message on throw, null (cleared) on success.
    // Best-effort itself — a bookkeeping failure must not fail the send/resend request.
    await repo
      .setRecipientEmailError(rec.id, outcome.ok ? null : outcome.error)
      .catch((err) => req.log.error({ err, recipientId: rec.id }, 'recording email outcome failed'));
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

      // A report still transcribing/synthesizing (or failed) must not go out: finalize-
      // on-send below would render + email a half-processed report and flip it to
      // reviewed. Only processing='ready' may send — the client polls /status and
      // enables Send when ready, so a 409 here only catches races/stale UIs.
      const procStatus = await repo.getReportStatus(req.params.id);
      if (procStatus?.processing !== 'ready') {
        return reply.code(409).send({ error: 'not ready' });
      }

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
      await emailRecipient(req, report, { id: rec.id, name: rec.name, email: rec.email }, token, expiresAt);
      return { ok: true, recipientId: rec.id, resentTo: rec.email };
    },
  );

  // ── External capability URL (no session) ────────────────────────────────────
  const servePage = (reply: FastifyReply, code: number, html: string) =>
    reply.code(code).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html);

  /** Who sent this link (for the expired/revoked "email the sender" CTA) — best-effort;
   *  the failure pages degrade gracefully when anything here can't be resolved. */
  const senderFor = async (rec: {
    sendId: string;
    reportId: string;
  }): Promise<ShareSender | undefined> => {
    try {
      const sends = await repo.listSendsForReport(rec.reportId);
      const send = sends.find((s) => s.id === rec.sendId);
      if (!send) return undefined;
      const orgId = await repo.getReportOrgId(rec.reportId);
      const org = orgId ? await repo.getOrg(orgId) : null;
      return {
        name: send.sentBy.name ?? send.sentBy.email,
        email: send.sentBy.email,
        orgName: org?.name,
      };
    } catch {
      return undefined;
    }
  };

  /** Validate a share token → recipient+report, or send the right failure page
   *  (design §RECIPIENT: friendly expired/revoked states with an email-sender CTA). */
  const resolveShare = async (
    token: string,
    reply: FastifyReply,
  ): Promise<{ reportId: string; expiresAt: Date } | null> => {
    const rec = await repo.getRecipientByToken(token);
    if (!rec) {
      await servePage(reply, 404, shareStatePage('notfound', {}));
      return null;
    }
    if (rec.revokedAt) {
      await servePage(reply, 410, shareStatePage('revoked', { sender: await senderFor(rec) }));
      return null;
    }
    if (rec.expiresAt.getTime() < Date.now()) {
      await servePage(
        reply,
        410,
        shareStatePage('expired', { expiresAt: rec.expiresAt, sender: await senderFor(rec) }),
      );
      return null;
    }
    // Post-send edit gate: editing a sent report reverts it to 'draft' and invalidates
    // the cached artifacts — a recipient reopening a still-valid link must NEVER get
    // mid-edit content re-rendered (with the DRAFT watermark). Serve the branded
    // "being updated" page until the report is re-finalized (finalize/send flips it
    // back to 'reviewed'). Gates BOTH /s/:token and /s/:token.pdf, which each resolve
    // through here before touching artifacts.
    const meta = await repo.getReportViewMeta(rec.reportId);
    if (meta?.status !== 'reviewed') {
      await servePage(reply, 503, shareStatePage('updating', { sender: await senderFor(rec) }));
      return null;
    }
    return { reportId: rec.reportId, expiresAt: rec.expiresAt };
  };

  app.get<{ Params: { token: string } }>('/s/:token', { preHandler: throttle }, async (req, reply) => {
    const r = await resolveShare(req.params.token, reply);
    if (!r) return reply;
    if (!(await ensureArtifacts(deps, r.reportId))) {
      return servePage(reply, 503, shareStatePage('notready', {}));
    }
    // Re-check status AFTER ensureArtifacts: an edit committing between resolveShare's
    // gate and the (possible) re-render above flips status to 'draft' first and deletes
    // artifacts second, so ensureArtifacts can have just rendered mid-edit content. The
    // post-render read closes that race — never serve it.
    const meta = await repo.getReportViewMeta(r.reportId);
    if (meta?.status !== 'reviewed') {
      return servePage(reply, 503, shareStatePage('updating', {}));
    }
    // The HTML view is the canonical "opened" (§8.4) — record it, then serve inside the
    // read-only recipient shell (brand bar + Download PDF + expiry line).
    await repo.recordRecipientOpen(req.params.token);
    const project = meta ? await repo.getProject(meta.projectId) : null;
    const obj = await storage.get(storageKeys.html(r.reportId));
    const html = Buffer.from(obj.bytes).toString('utf8');
    return servePage(
      reply,
      200,
      injectShareShell(html, {
        projectName: project?.name ?? 'your project',
        pdfHref: `/s/${encodeURIComponent(req.params.token)}.pdf`,
        expiresAt: r.expiresAt,
      }),
    );
  });

  app.get<{ Params: { token: string } }>('/s/:token.pdf', { preHandler: throttle }, async (req, reply) => {
    const r = await resolveShare(req.params.token, reply);
    if (!r) return reply;
    if (!(await ensureArtifacts(deps, r.reportId))) return reply.code(503).send({ error: 'not ready' });
    // Same post-render status re-check as the HTML route (edit race — see above).
    const meta = await repo.getReportViewMeta(r.reportId);
    if (meta?.status !== 'reviewed') {
      return servePage(reply, 503, shareStatePage('updating', {}));
    }
    // No extra open recorded here — the HTML view is the canonical open (§8.4).
    const obj = await storage.get(storageKeys.pdf(r.reportId));
    reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="field-report-${r.reportId}.pdf"`)
      .header('cache-control', 'no-store');
    return reply.send(Buffer.from(obj.bytes));
  });
}

// ── Recipient shell + state pages (design handoff §RECIPIENT; Flux light palette,
// fixed — the hosted report body is light-only and these pages match it) ─────────
const SHARE_FONT =
  "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PIN_SVG = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" style="flex:0 0 auto;"><path d="M12 21.5c4.6-5 7.5-8.5 7.5-12A7.5 7.5 0 1 0 4.5 9.5c0 3.5 2.9 7 7.5 12Z" fill="#2b54e0"/><path d="M9.2 9.4v4.4M12 7.7v7.8M14.8 9.4v4.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const LOCK_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:0 0 auto;"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

const fmtExpiry = (d: Date): string =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The slim sticky read-only bar over the (unchanged) hosted report body: brand pin +
 *  "Daily field report — {project}" + Download PDF pill + shared/read-only/expiry line. */
function injectShareShell(
  html: string,
  opts: { projectName: string; pdfHref: string; expiresAt: Date },
): string {
  const shell = `<div style="position:sticky;top:0;z-index:10;background:#ffffff;border-bottom:1px solid #e6ebf2;font-family:${SHARE_FONT};">
<div style="max-width:760px;margin:0 auto;padding:11px 18px 0;display:flex;align-items:center;gap:11px;flex-wrap:wrap;">
${PIN_SVG(20)}
<div style="flex:1;min-width:140px;font-size:14.5px;color:#10151d;"><b style="font-weight:700;">Daily field report</b> — ${escapeHtml(opts.projectName)}</div>
<a href="${opts.pdfHref}" style="display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;white-space:nowrap;padding:9px 14px;border-radius:999px;background:#2b54e0;color:#ffffff;font-weight:700;font-size:13.5px;text-decoration:none;box-shadow:0 8px 20px -14px rgba(43,84,224,.26);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4M5 20h14"/></svg>Download PDF</a>
</div>
<div style="max-width:760px;margin:0 auto;padding:7px 18px 9px;font-size:12px;color:#667283;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${LOCK_SVG}Shared with you · read-only · link expires ${escapeHtml(fmtExpiry(opts.expiresAt))}</div>
</div>`;
  const m = /<body[^>]*>/.exec(html);
  if (!m) return shell + html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + shell + html.slice(at);
}

interface ShareSender {
  name: string;
  email?: string;
  orgName?: string;
}

type ShareState = 'expired' | 'revoked' | 'notfound' | 'notready' | 'updating';

const STATE_COPY: Record<
  ShareState,
  { title: string; iconBg: string; iconInk: string; icon: string }
> = {
  expired: {
    title: 'This link has expired',
    iconBg: '#fdefd6', // amber clock (accent-soft / accent-ink)
    iconInk: '#96591a',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 2"/>',
  },
  revoked: {
    title: 'This link has been turned off',
    iconBg: '#fbeae8', // red slash (danger-soft / danger)
    iconInk: '#e0492f',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  },
  notfound: {
    title: 'Link not found',
    iconBg: '#f3f6fb',
    iconInk: '#667283',
    icon: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/>',
  },
  notready: {
    title: 'Not ready yet',
    iconBg: '#e7edfc', // primary-soft
    iconInk: '#2b54e0',
    icon: '<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/>',
  },
  updating: {
    title: 'This report is being updated',
    iconBg: '#e7edfc', // primary-soft refresh (transient, like notready)
    iconInk: '#2b54e0',
    icon: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M18.5 2.5v4h-4"/>',
  },
};

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last) return (first.charAt(0) + last.charAt(0)).toUpperCase();
  return (first?.slice(0, 2) ?? '?').toUpperCase();
};

/** Friendly full-page state (expired / revoked / not-found / not-ready / updating) with
 *  a contact-the-sender card + mailto CTA when the sender is known. */
function shareStatePage(
  state: ShareState,
  opts: { expiresAt?: Date; sender?: ShareSender },
): string {
  const c = STATE_COPY[state];
  const message =
    state === 'expired'
      ? `Shared reports stay private — links expire a set time after they're sent.${
          opts.expiresAt
            ? ` This one expired on <span style="color:#10151d;font-weight:600;">${escapeHtml(fmtExpiry(opts.expiresAt))}</span>.`
            : ''
        }`
      : state === 'revoked'
        ? 'The sender revoked access to this report. The contents are no longer available at this link.'
        : state === 'notfound'
          ? 'This share link is not valid — check that the address matches the one in your email.'
          : state === 'updating'
            ? 'The sender is making changes to this report right now. Your link keeps working — check back shortly for the updated version.'
            : 'This report is still being prepared. Try again in a minute.';

  const sender = opts.sender;
  const senderCard = sender
    ? `<div style="background:#ffffff;border:1px solid #e6ebf2;border-radius:12px;padding:15px;margin-top:20px;display:flex;align-items:center;gap:11px;text-align:left;">
<span style="display:flex;width:40px;height:40px;border-radius:999px;background:#e7edfc;color:#2b54e0;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex:0 0 auto;">${escapeHtml(initialsOf(sender.name))}</span>
<div style="flex:1;min-width:0;"><div style="font-size:12px;color:#667283;">${state === 'expired' ? 'Need an updated copy? Contact' : state === 'updating' ? 'Questions in the meantime? Contact' : 'For an updated copy, contact'}</div><div style="font-weight:600;font-size:14px;color:#10151d;">${escapeHtml(sender.name)}${sender.orgName ? ` · ${escapeHtml(sender.orgName)}` : ''}</div></div>
</div>`
    : '';
  const senderCta =
    sender?.email
      ? `<a href="mailto:${escapeHtml(sender.email)}?subject=${encodeURIComponent('Field report link')}" style="margin-top:14px;display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:999px;background:#2b54e0;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;box-shadow:0 10px 24px -14px rgba(43,84,224,.26);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/></svg>Email ${escapeHtml(sender.name)}${state === 'expired' ? ' for a new link' : ''}</a>`
      : '';

  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(c.title)} — FieldReport</title></head>
<body style="margin:0;min-height:100vh;display:flex;flex-direction:column;background:#eef2f7;color:#10151d;font-family:${SHARE_FONT};">
<div style="background:#ffffff;border-bottom:1px solid #e6ebf2;padding:13px 18px;display:flex;align-items:center;gap:9px;">${PIN_SVG(20)}<span style="font-weight:700;font-size:16px;">FieldReport</span></div>
<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:30px 24px;">
<div style="max-width:400px;text-align:center;">
<div style="margin:0 auto;width:64px;height:64px;border-radius:18px;background:${c.iconBg};color:${c.iconInk};display:flex;align-items:center;justify-content:center;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg></div>
<div style="font-weight:700;font-size:22px;margin-top:18px;">${escapeHtml(c.title)}</div>
<div style="font-size:14.5px;color:#667283;margin-top:9px;line-height:1.55;">${message}</div>
${senderCard}${senderCta}
</div></div></body></html>`;
}
