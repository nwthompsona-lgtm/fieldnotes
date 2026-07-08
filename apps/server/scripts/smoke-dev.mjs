#!/usr/bin/env node
/**
 * Dev-staging smoke test (Phase 0 verification; safe to re-run any time).
 *
 * Exercises the WHOLE stack against a deployed server using a throwaway signup org
 * (never touches the pilot tenant): signup → me → create project → authenticated
 * multipart upload (proves R2 WRITES) → mock pipeline to ready → report read →
 * hosted HTML + PDF (proves artifact render + storage round-trip) → finalize →
 * send to an ad-hoc recipient → delivery audit → invitation mint (proves
 * WEB_BASE_URL) → /s bad-token page → CORS allowlist preflights.
 *
 *   node apps/server/scripts/smoke-dev.mjs
 *   SMOKE_BASE=https://... SMOKE_WEB=https://... node apps/server/scripts/smoke-dev.mjs
 *
 * The one flow this can't reach: opening a real /s/<token> link — recipient tokens
 * ride only in email (by design), so that needs a real RESEND_API_KEY + an inbox.
 */
import { CONTRACTS_VERSION, audioFieldFor } from '@fieldreport/contracts';
import { randomUUID } from 'node:crypto';

const BASE = (process.env.SMOKE_BASE ?? 'https://fieldreport-server-dev.onrender.com').replace(/\/$/, '');
const WEB = (process.env.SMOKE_WEB ?? 'https://fieldreport-web-dev.vercel.app').replace(/\/$/, '');
const CAPTURE = (process.env.SMOKE_CAPTURE ?? 'https://fieldreport-capture-dev.vercel.app').replace(/\/$/, '');

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const die = (msg) => {
  console.error(`\nABORT: ${msg}`);
  summary();
  process.exit(1);
};
const summary = () => {
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  if (fails.length) process.exitCode = 1;
};

// 1x1 black JPEG (valid file, enough for the pipeline; dims ride in the manifest).
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
);

const run = Date.now().toString(36);
const account = {
  email: `smoke-${run}@fieldreport-smoke.test`,
  password: `smoke-${randomUUID()}`, // throwaway; never printed
  name: 'Dev Smoke',
  orgName: `Smoke Test ${run} (safe to ignore)`,
};

// ── auth + workspace ─────────────────────────────────────────────────────────
const sign = await fetch(`${BASE}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(account),
});
step('signup (201/200)', sign.ok, `HTTP ${sign.status}`);
if (!sign.ok) die(await sign.text());
const { token } = await sign.json();
const auth = { authorization: `Bearer ${token}` };

const meRes = await fetch(`${BASE}/api/auth/me`, { headers: auth });
const me = meRes.ok ? await meRes.json() : null;
step('me() resolves session', !!me?.orgs?.length, me ? `org ${me.orgs[0].name}` : `HTTP ${meRes.status}`);
if (!me) die('no session');
const orgId = me.orgs[0].id;

const projRes = await fetch(`${BASE}/api/orgs/${orgId}/projects`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Smoke Project', visibility: 'assigned' }),
});
const proj = projRes.ok ? await projRes.json() : null;
step('create project (org admin)', projRes.status === 201 && !!proj?.id, `HTTP ${projRes.status}`);
if (!proj) die('no project');

// ── authenticated upload (R2 write) ──────────────────────────────────────────
const walkId = `walk-${randomUUID()}`;
const obsId = `obs-${randomUUID()}`;
const photoId = `photo-${randomUUID()}`;
const manifest = {
  contractsVersion: CONTRACTS_VERSION,
  projectId: proj.id,
  projectName: proj.name,
  superName: account.name,
  date: new Date().toISOString().slice(0, 10),
  walkId,
  observations: [
    {
      id: obsId,
      order: 0,
      createdAt: new Date().toISOString(),
      photos: [{ id: photoId, width: 1, height: 1, byteSize: TINY_JPEG.length }],
      audioField: audioFieldFor(obsId),
      audioMime: 'audio/webm',
    },
  ],
  client: { ua: 'smoke-dev.mjs', installed: false, tz: 'UTC' },
};
const form = new FormData();
form.append('manifest', JSON.stringify(manifest)); // FIRST part — §6.1 ordering
form.append(photoId, new Blob([TINY_JPEG], { type: 'image/jpeg' }), `${photoId}.jpg`);
form.append(
  audioFieldFor(obsId),
  new Blob([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])], { type: 'audio/webm' }),
  `${obsId}.webm`,
);
const up = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: auth, body: form });
const upBody = up.ok ? await up.json() : await up.text();
step('authenticated upload → 202 (R2 write)', up.status === 202, `HTTP ${up.status}${up.ok ? '' : ` ${String(upBody).slice(0, 200)}`}`);
if (up.status !== 202) die('upload failed — check S3_BUCKET / token write access');
const reportId = upBody.reportId;

// ── pipeline to ready (mock STT/synthesis on dev) ────────────────────────────
let processing = 'uploaded';
for (let i = 0; i < 60 && !['ready', 'failed'].includes(processing); i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await fetch(`${BASE}/api/reports/${reportId}/status`, { headers: auth });
  if (s.ok) processing = (await s.json()).processing;
}
step('pipeline reaches ready', processing === 'ready', processing);
if (processing !== 'ready') die('pipeline did not finish');

const rep = await fetch(`${BASE}/api/reports/${reportId}`, { headers: auth });
const report = rep.ok ? await rep.json() : null;
step('report read (attribution)', report?.superName === account.name && report?.projectId === proj.id,
  report ? `by ${report.superName}` : `HTTP ${rep.status}`);

// ── hosted artifacts (storage round-trip + Chromium PDF on the dev box) ─────
const fin = await fetch(`${BASE}/api/reports/${reportId}/finalize`, { method: 'POST', headers: auth });
step('finalize', fin.ok, `HTTP ${fin.status}`);
const html = await fetch(`${BASE}/r/${reportId}`, { headers: auth });
step('hosted HTML (session-gated)', html.ok && (html.headers.get('content-type') ?? '').includes('text/html'), `HTTP ${html.status}`);
const anonHtml = await fetch(`${BASE}/r/${reportId}`);
step('hosted HTML anon → 401 (gate holds)', anonHtml.status === 401, `HTTP ${anonHtml.status}`);
const pdf = await fetch(`${BASE}/r/${reportId}.pdf`, { headers: auth });
const pdfBytes = pdf.ok ? (await pdf.arrayBuffer()).byteLength : 0;
step('hosted PDF renders', pdf.ok && pdfBytes > 1000, `HTTP ${pdf.status}, ${pdfBytes} bytes`);

// ── send + delivery ──────────────────────────────────────────────────────────
const send = await fetch(`${BASE}/api/reports/${reportId}/send`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({
    selection: { orgIds: [], contactIds: [], adHoc: [{ name: 'Smoke Recipient', email: `recipient-${run}@fieldreport-smoke.test` }] },
    message: 'Dev smoke test send.',
    expiresInDays: 1,
  }),
});
const sendBody = send.ok ? await send.json() : null;
step('send → 201 w/ recipient', send.status === 201 && sendBody?.recipients?.length === 1, `HTTP ${send.status}`);
step('send response leaks no token', !JSON.stringify(sendBody ?? {}).includes('tok_'), '');
const sends = await fetch(`${BASE}/api/reports/${reportId}/sends`, { headers: auth });
const audit = sends.ok ? await sends.json() : [];
step('delivery audit lists the send', audit.length >= 1 && audit[0]?.recipients?.length === 1, '');

// ── invitations (WEB_BASE_URL) ───────────────────────────────────────────────
const inv = await fetch(`${BASE}/api/orgs/${orgId}/invitations`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ email: `invitee-${run}@fieldreport-smoke.test`, orgRole: 'member', projectAssignments: [] }),
});
const invBody = inv.ok ? await inv.json() : null;
step('invitation mints', inv.ok && !!invBody?.token, `HTTP ${inv.status}`);
step('inviteUrl targets the web app', (invBody?.inviteUrl ?? '').startsWith(`${WEB}/accept?token=`), invBody?.inviteUrl?.split('?')[0] ?? '');
if (invBody?.token) {
  const prev = await fetch(`${BASE}/api/auth/invitations/${invBody.token}`);
  const prevBody = prev.ok ? await prev.json() : null;
  step('invite preview', prev.ok && prevBody?.orgName === account.orgName, `HTTP ${prev.status}`);
}

// ── external /s + CORS allowlist ─────────────────────────────────────────────
const badShare = await fetch(`${BASE}/s/tok_bogus_smoke`);
const badBody = await badShare.text();
step('/s bad token → 404 branded page', badShare.status === 404 && badBody.includes('Link not found'), `HTTP ${badShare.status}`);

const preflight = async (origin) => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });
  return r.headers.get('access-control-allow-origin');
};
step('CORS allows web-dev origin', (await preflight(WEB)) === WEB, '');
step('CORS allows capture-dev origin', (await preflight(CAPTURE)) === CAPTURE, '');
step('CORS blocks unknown origin', (await preflight('https://evil.example')) == null, '');

// ── the two SPAs serve + deep-link rewrite ───────────────────────────────────
for (const [name, url, probe] of [
  ['web-dev SPA serves', WEB, `${WEB}/`],
  ['web-dev deep link rewrites (/settings/members)', WEB, `${WEB}/settings/members`],
  ['capture-dev SPA serves', CAPTURE, `${CAPTURE}/`],
]) {
  const r = await fetch(probe, { redirect: 'follow' });
  const body = await r.text();
  step(name, r.ok && body.includes('<div id="root">'), `HTTP ${r.status}`);
}

summary();
