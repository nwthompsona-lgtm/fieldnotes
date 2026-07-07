// HTTP smoke test against a RUNNING server (default :8787). Exercises the real wire path
// the dry-run skips: multipart upload, status polling, edit, finalize gate, hosted HTML+PDF.
//
// The API is authenticated since Phase 4, so this logs in as the seeded pilot admin and
// uploads to the PILOT project (a fresh/user-named project would 403 — capture requires an
// existing, assigned project). Run with the same pilot creds the server was seeded with:
//   1) PILOT_SUPER_EMAIL=… PILOT_SUPER_PASSWORD=… npm run dev:server
//   2) PILOT_SUPER_EMAIL=… PILOT_SUPER_PASSWORD=… node apps/server/scripts/smoke.mjs
import sharp from 'sharp';
import { login, auth } from './_auth.mjs';

const BASE = process.env.SMOKE_BASE || 'http://localhost:8787';
const PROJECT_ID = process.env.PILOT_PROJECT_ID || 'pilot-project';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jpeg = async (n) =>
  new Uint8Array(
    await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 40 + n * 30, g: 90, b: 70 } } })
      .jpeg()
      .toBuffer(),
  );

function assert(cond, msg) {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
  console.log(`  ok: ${msg}`);
}

const health = await (await fetch(`${BASE}/healthz`)).json();
console.log('health:', health);
assert(health.ok === true, 'healthz ok');

// Authenticate as the pilot admin (org-admin + super on the pilot project).
const token = await login(BASE, process.env.PILOT_SUPER_EMAIL, process.env.PILOT_SUPER_PASSWORD);
assert(typeof token === 'string' && token.startsWith('ses_'), 'logged in as pilot admin');

// Unauthenticated upload is rejected now.
const noauth = await fetch(`${BASE}/api/upload`, { method: 'POST', body: new FormData() });
assert(noauth.status === 401, 'upload rejects missing session (401)');

// One stamp per run so EVERY id is unique — the walk, observations, and photos.
// (A fixed obs id would collide on a persisted dev DB across runs.)
const stamp = Date.now();
const walkId = `smoke-walk-${stamp}`;
const oid = (i) => `smoke-obs-${stamp}-${i}`;
const pid = (i) => `smoke-photo-${stamp}-${i}`;
const observations = [0, 1].map((i) => ({
  id: oid(i),
  order: i,
  createdAt: new Date(Date.now() + i * 1000).toISOString(),
  photos: [{ id: pid(i), width: 400, height: 300 }],
  audioField: `audio:${oid(i)}`,
  audioMime: 'audio/webm',
}));
// Upload to the seeded pilot project (must pre-exist + be assigned to the caller). superName
// now comes from the session, so the manifest value is only a fallback.
const superName = 'Smoke Tester';
const manifest = {
  contractsVersion: '1.1.0',
  projectId: PROJECT_ID,
  superName,
  date: new Date().toISOString().slice(0, 10),
  walkId,
  observations,
};

// Manifest FIRST so the server authorizes before buffering media (§6.1).
const fd = new FormData();
fd.set('manifest', JSON.stringify(manifest));
for (const i of [0, 1]) {
  fd.set(pid(i), new Blob([await jpeg(i)], { type: 'image/jpeg' }), `${pid(i)}.jpg`);
  fd.set(`audio:${oid(i)}`, new Blob([new Uint8Array([1, 2, 3, i])], { type: 'audio/webm' }), `a${i}.webm`);
}

const up = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: auth(token), body: fd });
const upj = await up.json();
console.log('upload:', up.status, JSON.stringify(upj).slice(0, 400));
assert(up.status === 202, 'upload accepted (202)');
const reportId = upj.reportId;

let st;
for (let i = 0; i < 90; i++) {
  st = await (await fetch(`${BASE}/api/reports/${reportId}/status`, { headers: auth(token) })).json();
  if (st.processing === 'ready' || st.processing === 'failed') break;
  await sleep(1000);
}
console.log('final status:', st);
assert(st.processing === 'ready', `pipeline reached ready (got ${st.processing}${st.error ? ': ' + st.error : ''})`);

const rep = await (await fetch(`${BASE}/api/reports/${reportId}`, { headers: auth(token) })).json();
assert(rep.observations.length === 2, 'report has 2 observations');
assert(typeof rep.projectName === 'string' && rep.projectName.length > 0, `report resolves the project name (got ${rep.projectName})`);
assert(/^https?:\/\//.test(rep.observations[0].photos[0].blobRef), 'photo blobRef resolved to a URL');
assert(typeof rep.observations[0].cleanedDescription === 'string' && rep.observations[0].cleanedDescription.length > 0, 'observation has a cleaned description');

const patched = await fetch(`${BASE}/api/reports/${reportId}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', ...auth(token) },
  body: JSON.stringify({ summary: 'Edited by smoke test.' }),
});
assert(patched.status === 200, 'edit accepted');

const fin = await (await fetch(`${BASE}/api/reports/${reportId}/finalize`, { method: 'POST', headers: auth(token) })).json();
assert(fin.status === 'reviewed', 'finalize -> reviewed');
assert(/\/r\//.test(fin.htmlUrl) && /\.pdf$/.test(fin.pdfUrl), 'finalize returns hosted html + pdf links');

const html = await fetch(`${BASE}/r/${reportId}`, { headers: auth(token) });
assert(html.status === 200 && (html.headers.get('content-type') || '').includes('text/html'), 'hosted HTML served');
const htmlBody = await html.text();
assert(htmlBody.includes('Prepared by'), 'report renders "Prepared by: <name>"');
const pdf = await fetch(`${BASE}/r/${reportId}.pdf`, { headers: auth(token) });
const pdfBytes = await pdf.arrayBuffer();
assert(pdf.status === 200 && pdfBytes.byteLength > 1000, `PDF served (${pdfBytes.byteLength} bytes)`);

// admin: the pilot admin's own session (org-admin) is accepted; a missing session is 401.
const unauth = await fetch(`${BASE}/api/admin/reports`);
assert(unauth.status === 401, 'admin rejects missing session');
const admin = await fetch(`${BASE}/api/admin/reports`, { headers: auth(token) });
assert(admin.status === 200, 'admin accepts the org-admin session');

console.log('\nSMOKE PASSED ✓');
process.exit(0);
