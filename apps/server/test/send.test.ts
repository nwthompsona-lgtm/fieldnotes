/**
 * Phase 8 — send + delivery + external /s/:token (§8, the distribution milestone).
 * Send resolves a selection → deduped recipients, finalizes the draft, mints per-person
 * tokens, remembers the default, and mails each a /s/<token> link. The external capability
 * URL renders on demand, records the first open once, and 410s when revoked/expired.
 *
 * One real render happens (finalize-on-send); /s reuses the cached artifacts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { processUpload } from '../src/ingest/index.js';
import { buildTestDeps, type TestDeps } from './helpers.js';
import type { UploadManifest } from '@fieldreport/contracts';

let deps: TestDeps;
let app: FastifyInstance;
const tok: Record<string, string> = {};
const hdr = (who: string | null) => (who ? { authorization: `Bearer ${tok[who]}` } : {});
const req = (method: 'GET' | 'POST', who: string | null, url: string, body?: unknown) =>
  app.inject({ method, url, headers: hdr(who), payload: body as Record<string, unknown> });

let reportId: string;
const C1_EMAIL = 'owner.one@acme.co';
const C2_EMAIL = 'owner.two@acme.co';

/** Pull the /s/<token> capability token out of a captured share email. */
const tokenFromEmailTo = (email: string): string => {
  const mail = [...deps.email.sent].reverse().find((m) => m.to.email.toLowerCase() === email.toLowerCase());
  const m = /\/s\/(tok_[A-Za-z0-9_-]+)/.exec(mail?.text ?? '');
  if (!m) throw new Error(`no share link in email to ${email}`);
  return m[1]!;
};

beforeAll(async () => {
  deps = await buildTestDeps();
  app = await buildApp(deps);
  await app.ready();
  const { repo, sessions, storage } = deps;

  await repo.createOrg({ id: 'org_s', name: 'Org S' });
  for (const [key, role] of [['adminS', 'admin'], ['viewerS', 'member']] as const) {
    await repo.createUser({ id: key, email: `${key}@x.com`, name: `Name ${key}` });
    await repo.addMembership({ id: `m_${key}`, userId: key, orgId: 'org_s', orgRole: role });
    tok[key] = await sessions.issue(key);
  }
  await repo.createProject({ id: 'proj_s', orgId: 'org_s', name: 'Send Project', superName: 'Jake Romero', visibility: 'assigned' });
  await repo.addProjectMember({ id: 'pmv', projectId: 'proj_s', userId: 'viewerS', role: 'viewer' });

  // Directory + roster: one stakeholder org with two contacts, rostered on the project.
  await repo.createStakeholderOrg({ id: 'sto_s', orgId: 'org_s', name: 'Acme Owners', kind: 'owner' });
  await repo.createStakeholderContact({ id: 'c1', stakeholderOrgId: 'sto_s', name: 'Owner One', email: C1_EMAIL });
  await repo.createStakeholderContact({ id: 'c2', stakeholderOrgId: 'sto_s', name: 'Owner Two', email: C2_EMAIL });
  await repo.setProjectStakeholders('proj_s', ['sto_s']);

  // A renderable DRAFT report (real photo bytes so finalize-on-send can render).
  const jpeg = new Uint8Array(await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 20, g: 90, b: 70 } } }).jpeg().toBuffer());
  const manifest: UploadManifest = {
    contractsVersion: '1.2.0',
    projectId: 'proj_s',
    superName: 'Jake Romero',
    date: '2026-07-07',
    walkId: 'w-send',
    observations: [
      { id: 'o-send', order: 0, createdAt: '2026-07-07T12:00:00.000Z', photos: [{ id: 'p-send', width: 60, height: 40 }], audioField: 'audio:o-send', audioMime: 'audio/webm' },
    ],
  };
  const files = new Map<string, Uint8Array>([['p-send', jpeg]]);
  const res = await processUpload({ manifest, files, storage, repo, createdBy: 'adminS' });
  reportId = res.reportId;
  // The pipeline never runs in this suite — mark the report ready by hand, since send
  // now 409s on anything still transcribing/synthesizing (half-processed content).
  await repo.setProcessing(reportId, 'ready');
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/reports/:id/send', () => {
  it('rejects anonymous (401) and a non-send-capable viewer (404, draft not viewable)', async () => {
    expect((await req('POST', null, `/api/reports/${reportId}/send`, {})).statusCode).toBe(401);
    const body = { selection: { orgIds: ['sto_s'], contactIds: [], adHoc: [] } };
    expect((await req('POST', 'viewerS', `/api/reports/${reportId}/send`, body)).statusCode).toBe(404);
  });

  it('empty selection → 400', async () => {
    expect((await req('POST', 'adminS', `/api/reports/${reportId}/send`, { selection: { orgIds: [], contactIds: [], adHoc: [] } })).statusCode).toBe(400);
  });

  it('a report still processing → 409 (never render/email a half-processed report)', async () => {
    // Fresh upload, pipeline never run: processing stays 'uploaded'.
    const { repo, storage } = deps;
    const jpeg = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toBuffer());
    const manifest: UploadManifest = {
      contractsVersion: '1.2.0',
      projectId: 'proj_s',
      superName: 'Jake Romero',
      date: '2026-07-07',
      walkId: 'w-send-unready',
      observations: [
        { id: 'o-unready', order: 0, createdAt: '2026-07-07T12:00:00.000Z', photos: [{ id: 'p-unready', width: 8, height: 8 }], audioField: 'audio:o-unready', audioMime: 'audio/webm' },
      ],
    };
    const { reportId: unreadyId } = await processUpload({ manifest, files: new Map([['p-unready', jpeg]]), storage, repo, createdBy: 'adminS' });

    const body = { selection: { orgIds: [], contactIds: [], adHoc: [{ name: 'A', email: 'a@x.co' }] } };
    for (const processing of ['uploaded', 'transcribing', 'synthesizing', 'failed'] as const) {
      await repo.setProcessing(unreadyId, processing);
      const res = await req('POST', 'adminS', `/api/reports/${unreadyId}/send`, body);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'not ready' });
    }
    // Nothing was recorded or mailed for the blocked attempts.
    expect(await deps.repo.listSendsForReport(unreadyId)).toEqual([]);
  });

  it('resolves the selection (deduped), finalizes, remembers the default, mails everyone', async () => {
    const before = deps.email.sent.length;
    const selection = { orgIds: ['sto_s'], contactIds: [], adHoc: [
      { name: 'Dup Of One', email: C1_EMAIL }, // dupes contact c1 → dropped
      { name: 'Ad Hoc', email: 'adhoc@guest.co' },
    ] };
    const res = await req('POST', 'adminS', `/api/reports/${reportId}/send`, { selection, message: 'FYI team' });
    expect(res.statusCode).toBe(201);
    const send = res.json();

    // c1 + c2 + adhoc = 3 (the duplicate ad-hoc of c1 is deduped away).
    const emails = send.recipients.map((r: { email: string }) => r.email).sort();
    expect(emails).toEqual([C1_EMAIL, C2_EMAIL, 'adhoc@guest.co'].sort());

    // Finalize-on-send flipped the report to reviewed.
    expect((await deps.repo.getReportViewMeta(reportId))?.status).toBe('reviewed');
    // Default remembered for next time.
    expect(await deps.repo.getDistributionDefault('proj_s')).toMatchObject({ orgIds: ['sto_s'] });
    // One email per recipient, attributed to the ACTUAL sender (the session user, who
    // is also the reply-to) — not the report's preparer.
    const sent = deps.email.sent.slice(before);
    expect(sent).toHaveLength(3);
    expect(sent.every((m) => m.fromName === 'Name adminS via FieldReport')).toBe(true);
    expect(sent.every((m) => m.replyTo?.email === 'admins@x.com')).toBe(true); // repo lowercases
    expect(sent.every((m) => m.text.includes('Name adminS shared'))).toBe(true);
  }, 30_000); // finalize-on-send renders HTML+PDF (Playwright) — well over the 5s default
});

describe('GET /s/:token (external capability URL)', () => {
  it('valid link renders the report and records the first open once', async () => {
    const token = tokenFromEmailTo(C1_EMAIL);
    const r1 = await app.inject({ method: 'GET', url: `/s/${token}` });
    expect(r1.statusCode).toBe(200);
    expect(r1.headers['content-type']).toContain('text/html');
    expect(r1.body).toContain('Shared with you');

    const after1 = await deps.repo.getRecipientByToken(token);
    expect(after1!.openCount).toBe(1);
    expect(after1!.firstOpenedAt).not.toBeNull();

    // A second load bumps open_count but not first_opened_at.
    await app.inject({ method: 'GET', url: `/s/${token}` });
    const after2 = await deps.repo.getRecipientByToken(token);
    expect(after2!.openCount).toBe(2);
    expect(after2!.firstOpenedAt).toEqual(after1!.firstOpenedAt);
  }, 30_000); // artifacts are cached from the send, but allow a render if the cache missed

  it('the PDF link streams a PDF and records no extra open', async () => {
    const token = tokenFromEmailTo(C2_EMAIL);
    await app.inject({ method: 'GET', url: `/s/${token}` }); // canonical open
    const before = (await deps.repo.getRecipientByToken(token))!.openCount;
    const pdf = await app.inject({ method: 'GET', url: `/s/${token}.pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.length).toBeGreaterThan(1000);
    expect((await deps.repo.getRecipientByToken(token))!.openCount).toBe(before);
  });

  it('unknown token → 404 page', async () => {
    const res = await app.inject({ method: 'GET', url: '/s/tok_nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('expired token → 410 page', async () => {
    const { repo } = deps;
    await repo.createReportSend({ id: 'snd_exp', reportId, sentBy: 'adminS' });
    await repo.createRecipients([
      { id: 'rcp_exp', sendId: 'snd_exp', email: 'late@guest.co', name: 'Late', token: 'tok_expired_x', expiresAt: new Date(Date.now() - 1000) },
    ]);
    const res = await app.inject({ method: 'GET', url: '/s/tok_expired_x' });
    expect(res.statusCode).toBe(410);
  });
});

describe('delivery audit + revoke + resend', () => {
  it('GET /api/reports/:id/sends returns the audit with per-recipient opens', async () => {
    const res = await req('GET', 'adminS', `/api/reports/${reportId}/sends`);
    expect(res.statusCode).toBe(200);
    const sends = res.json();
    expect(sends.length).toBeGreaterThanOrEqual(1);
    const recips = sends.flatMap((s: { recipients: unknown[] }) => s.recipients);
    expect(recips.some((r: { openCount: number }) => r.openCount >= 1)).toBe(true);
  });

  it('revoke makes the link 410; resend mints a fresh working link', async () => {
    const token = tokenFromEmailTo('adhoc@guest.co');
    const rec = await deps.repo.getRecipientByToken(token);
    const rid = rec!.id;

    expect((await req('POST', 'adminS', `/api/reports/${reportId}/recipients/${rid}/revoke`)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/s/${token}` })).statusCode).toBe(410);

    const before = deps.email.sent.length;
    const resend = await req('POST', 'adminS', `/api/reports/${reportId}/recipients/${rid}/resend`);
    expect(resend.statusCode).toBe(200);
    expect(deps.email.sent.length).toBe(before + 1);
    // The resent email carries a NEW token (the old one was revoked) that works again.
    const newToken = tokenFromEmailTo('adhoc@guest.co');
    expect(newToken).not.toBe(token);
    expect((await app.inject({ method: 'GET', url: `/s/${newToken}` })).statusCode).toBe(200);
  });
});

describe('post-send edit gate on /s (report reverted to draft)', () => {
  it('a still-valid link serves the "being updated" page — never mid-edit content', async () => {
    const token = tokenFromEmailTo(C1_EMAIL);
    // An edit reverts the sent report to 'draft' (review gate). The recipient's link is
    // still valid, but must NOT re-render draft content with the DRAFT watermark.
    await deps.repo.applyEdit(reportId, { summary: 'mid-edit summary' });
    const opensBefore = (await deps.repo.getRecipientByToken(token))!.openCount;

    const html = await app.inject({ method: 'GET', url: `/s/${token}` });
    expect(html.statusCode).toBe(503);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).toContain('This report is being updated');
    expect(html.body).not.toContain('Shared with you'); // the report shell never renders
    expect(html.body).not.toContain('mid-edit summary');

    // Same gate on the PDF sibling.
    const pdf = await app.inject({ method: 'GET', url: `/s/${token}.pdf` });
    expect(pdf.statusCode).toBe(503);
    expect(pdf.body).toContain('This report is being updated');

    // The blocked view records no open.
    expect((await deps.repo.getRecipientByToken(token))!.openCount).toBe(opensBefore);

    // Re-finalizing restores the link (artifacts were still cached in this suite).
    await deps.repo.finalize(reportId);
    const restored = await app.inject({ method: 'GET', url: `/s/${token}` });
    expect(restored.statusCode).toBe(200);
    expect(restored.body).toContain('Shared with you');
  }, 30_000); // allow a re-render if the artifact cache missed
});

describe('per-recipient email dispatch outcome (emailError)', () => {
  const FAIL_EMAIL = 'bounce@guest.co';

  it('a provider rejection still yields 201 but records emailError on the recipient', async () => {
    const originalSend = deps.email.send.bind(deps.email);
    deps.email.send = async () => {
      throw new Error('provider rejected: from-domain not verified');
    };
    try {
      const body = { selection: { orgIds: [], contactIds: [], adHoc: [{ name: 'Bounce', email: FAIL_EMAIL }] } };
      const res = await req('POST', 'adminS', `/api/reports/${reportId}/send`, body);
      expect(res.statusCode).toBe(201); // per-recipient best-effort: the send itself succeeds
      const send = res.json() as { recipients: Array<{ id: string; email: string; emailError?: string }> };
      const rec = send.recipients.find((r) => r.email === FAIL_EMAIL)!;
      // The DTO carries the failure so the delivery panel can say "email failed".
      expect(rec.emailError).toBe('provider rejected: from-domain not verified');
      expect((await deps.repo.getRecipientById(rec.id))?.emailError).toBe(
        'provider rejected: from-domain not verified',
      );
    } finally {
      deps.email.send = originalSend;
    }
  }, 30_000);

  it('a later successful resend clears the recorded failure', async () => {
    const sends = await deps.repo.listSendsForReport(reportId);
    const rec = sends.flatMap((s) => s.recipients).find((r) => r.email === FAIL_EMAIL)!;
    expect(rec.emailError).toBeTruthy(); // still failed from the previous test

    const res = await req('POST', 'adminS', `/api/reports/${reportId}/recipients/${rec.id}/resend`);
    expect(res.statusCode).toBe(200);
    expect((await deps.repo.getRecipientById(rec.id))?.emailError).toBeNull();
    const after = (await deps.repo.listSendsForReport(reportId))
      .flatMap((s) => s.recipients)
      .find((r) => r.id === rec.id)!;
    expect(after.emailError).toBeUndefined(); // absent in the DTO once cleared
  });
});
