// HTTP smoke test against a RUNNING server (default :8787). Exercises the real wire path
// the dry-run skips: multipart upload, status polling, edit, finalize gate, hosted HTML+PDF.
//   1) npm run dev:server   2) node apps/server/scripts/smoke.mjs
import sharp from 'sharp';

const BASE = process.env.SMOKE_BASE || 'http://localhost:8787';
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

const walkId = `smoke-walk-${Date.now()}`;
const oid = (i) => `smoke-obs-${i}`;
const pid = (i) => `smoke-photo-${i}`;
const observations = [0, 1].map((i) => ({
  id: oid(i),
  order: i,
  createdAt: new Date(Date.now() + i * 1000).toISOString(),
  photos: [{ id: pid(i), width: 400, height: 300 }],
  audioField: `audio:${oid(i)}`,
  audioMime: 'audio/webm',
}));
const manifest = {
  contractsVersion: '1.0.0',
  projectId: 'pilot-project',
  superName: 'Smoke Tester',
  date: new Date().toISOString().slice(0, 10),
  walkId,
  observations,
};

const fd = new FormData();
fd.set('manifest', JSON.stringify(manifest));
for (const i of [0, 1]) {
  fd.set(pid(i), new Blob([await jpeg(i)], { type: 'image/jpeg' }), `${pid(i)}.jpg`);
  fd.set(`audio:${oid(i)}`, new Blob([new Uint8Array([1, 2, 3, i])], { type: 'audio/webm' }), `a${i}.webm`);
}

const up = await fetch(`${BASE}/api/upload`, { method: 'POST', body: fd });
const upj = await up.json();
console.log('upload:', up.status, JSON.stringify(upj).slice(0, 400));
assert(up.status === 202, 'upload accepted (202)');
const reportId = upj.reportId;

let st;
for (let i = 0; i < 90; i++) {
  st = await (await fetch(`${BASE}/api/reports/${reportId}/status`)).json();
  if (st.processing === 'ready' || st.processing === 'failed') break;
  await sleep(1000);
}
console.log('final status:', st);
assert(st.processing === 'ready', `pipeline reached ready (got ${st.processing}${st.error ? ': ' + st.error : ''})`);

const rep = await (await fetch(`${BASE}/api/reports/${reportId}`)).json();
assert(rep.observations.length === 2, 'report has 2 observations');
assert(/^https?:\/\//.test(rep.observations[0].photos[0].blobRef), 'photo blobRef resolved to a URL');
assert(typeof rep.observations[0].cleanedDescription === 'string' && rep.observations[0].cleanedDescription.length > 0, 'observation has a cleaned description');

const patched = await fetch(`${BASE}/api/reports/${reportId}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ summary: 'Edited by smoke test.' }),
});
assert(patched.status === 200, 'edit accepted');

const fin = await (await fetch(`${BASE}/api/reports/${reportId}/finalize`, { method: 'POST' })).json();
assert(fin.status === 'reviewed', 'finalize -> reviewed');
assert(/\/r\//.test(fin.htmlUrl) && /\.pdf$/.test(fin.pdfUrl), 'finalize returns hosted html + pdf links');

const html = await fetch(`${BASE}/r/${reportId}`);
assert(html.status === 200 && (html.headers.get('content-type') || '').includes('text/html'), 'hosted HTML served');
const pdf = await fetch(`${BASE}/r/${reportId}.pdf`);
const pdfBytes = await pdf.arrayBuffer();
assert(pdf.status === 200 && pdfBytes.byteLength > 1000, `PDF served (${pdfBytes.byteLength} bytes)`);

// admin (token-gated)
const unauth = await fetch(`${BASE}/api/admin/reports`);
assert(unauth.status === 401, 'admin rejects missing token');
const admin = await fetch(`${BASE}/api/admin/reports`, { headers: { authorization: 'Bearer dev-admin-token' } });
assert(admin.status === 200, 'admin accepts dev token');

console.log('\nSMOKE PASSED ✓');
process.exit(0);
