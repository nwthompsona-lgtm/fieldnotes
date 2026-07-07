// Seeds local DEMO data for the web-app preview (frontend phases F1–F4): three walks on
// the seeded pilot project — one left as a draft, one finalized, one finalized + SENT to
// two ad-hoc recipients with one link opened (so the reports list shows the full status
// rail: Draft / Finalized / Sent · 1/2 opened, and the Delivery panel has real rows).
//
// Run against a local hermetic server (mock STT/synthesis + mock email; see memory of the
// smoke recipe), from the REPO ROOT so the mock-email drop dir (.data/email) lines up:
//   1) PILOT_SUPER_EMAIL=… PILOT_SUPER_PASSWORD=… node apps/server/dist/index.js
//   2) PILOT_SUPER_EMAIL=… PILOT_SUPER_PASSWORD=… node apps/server/scripts/seed-demo.mjs
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { login, auth } from './_auth.mjs';

const BASE = process.env.SEED_BASE || 'http://127.0.0.1:8787';
const PROJECT_ID = process.env.PILOT_PROJECT_ID || 'pilot-project';
const EMAIL_DIR = process.env.EMAIL_DIR || '.data/email';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = await login(BASE, process.env.PILOT_SUPER_EMAIL, process.env.PILOT_SUPER_PASSWORD);
console.log('logged in as pilot admin');

const jpeg = async (n) =>
  new Uint8Array(
    await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 60 + n * 40, g: 110 - n * 10, b: 90 + n * 25 },
      },
    })
      .jpeg()
      .toBuffer(),
  );

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function upload(label, obsCount, date) {
  const stamp = `${Date.now()}-${label}`;
  const oid = (i) => `demo-obs-${stamp}-${i}`;
  const pid = (i) => `demo-photo-${stamp}-${i}`;
  const observations = Array.from({ length: obsCount }, (_, i) => ({
    id: oid(i),
    order: i,
    createdAt: new Date(Date.now() + i * 1000).toISOString(),
    photos: [{ id: pid(i), width: 640, height: 480 }],
    audioField: `audio:${oid(i)}`,
    audioMime: 'audio/webm',
  }));
  const fd = new FormData();
  // Manifest FIRST so the server authorizes before buffering media (§6.1).
  fd.set(
    'manifest',
    JSON.stringify({
      contractsVersion: '1.2.0',
      projectId: PROJECT_ID,
      superName: 'Jake Romero',
      date,
      walkId: `demo-walk-${stamp}`,
      observations,
    }),
  );
  for (let i = 0; i < obsCount; i++) {
    fd.set(pid(i), new Blob([await jpeg(i)], { type: 'image/jpeg' }), `${pid(i)}.jpg`);
    fd.set(`audio:${oid(i)}`, new Blob([new Uint8Array([1, 2, 3, i])], { type: 'audio/webm' }), `a${i}.webm`);
  }
  const up = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: auth(token), body: fd });
  if (up.status !== 202) throw new Error(`upload ${label}: ${up.status} ${await up.text()}`);
  const { reportId } = await up.json();

  for (let i = 0; i < 90; i++) {
    const st = await (
      await fetch(`${BASE}/api/reports/${reportId}/status`, { headers: auth(token) })
    ).json();
    if (st.processing === 'ready') break;
    if (st.processing === 'failed') throw new Error(`pipeline failed for ${label}: ${st.error}`);
    await sleep(1000);
  }
  console.log(`${label}: report ${reportId} ready (${date})`);
  return reportId;
}

// 1) Draft — today.
await upload('draft', 2, daysAgo(0));

// 2) Finalized — yesterday.
const finalized = await upload('finalized', 2, daysAgo(1));
const fin = await fetch(`${BASE}/api/reports/${finalized}/finalize`, {
  method: 'POST',
  headers: auth(token),
});
if (fin.status !== 200) throw new Error(`finalize: ${fin.status} ${await fin.text()}`);
console.log(`finalized: ${finalized}`);

// 3) Sent — two days ago, two ad-hoc recipients (finalize-on-send).
const sent = await upload('sent', 3, daysAgo(2));
const send = await fetch(`${BASE}/api/reports/${sent}/send`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...auth(token) },
  body: JSON.stringify({
    selection: {
      adHoc: [
        { name: 'Jane Okafor', email: 'jane@fosterpartners.test' },
        { name: 'Rachel Adler', email: 'rachel@acmedev.test' },
      ],
    },
  }),
});
if (!send.ok) throw new Error(`send: ${send.status} ${await send.text()}`);
console.log(`sent: ${sent} to 2 recipients`);

// Record one open: pull the newest mock-email JSON and follow its /s/<token> link.
try {
  const dir = resolve(process.cwd(), EMAIL_DIR);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const latest = files[files.length - 1];
  const msg = JSON.parse(await readFile(resolve(dir, latest), 'utf8'));
  const m = (msg.html || msg.text || '').match(/https?:\/\/[^\s"'<)]+\/s\/[A-Za-z0-9_-]+/);
  if (m) {
    // Node resolves `localhost` to ::1 but the server binds IPv4 — pin it.
    const opened = await fetch(m[0].replace('//localhost', '//127.0.0.1'));
    console.log(`opened share link for ${msg.to.email}: ${opened.status}`);
  } else {
    console.log('no /s/ link found in the mock email — skipping the open');
  }
} catch (err) {
  console.log(`could not record an open (non-fatal): ${err.message}`);
}

console.log('\nDEMO SEED DONE ✓');
