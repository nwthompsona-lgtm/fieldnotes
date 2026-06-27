/**
 * REAL-audio end-to-end test against a LIVE server (proves the full cloud path:
 * real spoken audio → Deepgram → Claude → R2 + Neon → hosted PDF). Unlike smoke.mjs
 * (dummy audio), this synthesizes actual speech with Windows SAPI from the curated
 * proper-noun-heavy lines, so it exercises real transcription + keyterm biasing.
 *
 *   $env:E2E_BASE='https://<server>'; npm run e2e:live -w @fieldreport/server
 *
 * Leaves one report (walkId e2e-*) on the target so you can view the hosted PDF; remove
 * it later with `npm run clean:test`.
 */
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { audioFieldFor, CONTRACTS_VERSION } from '@fieldreport/contracts';
import { MOCK_TRANSCRIPTS } from '../src/mock-corpus.js';

const BASE = (process.env.E2E_BASE ?? '').replace(/\/$/, '');
if (!BASE) {
  console.error('Set E2E_BASE to the live server URL, e.g. https://fieldnotes-yglr.onrender.com');
  process.exit(1);
}
const tmp = resolve(dirname(fileURLToPath(import.meta.url)), '../.data/e2e-tmp');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Lines chosen for proper-noun + fidelity coverage (North Tower/Level 3, prepped-not-poured,
// JMA/RFI/mullion, Najib/South Tower elevator).
const PICK = [0, 1, 2, 6];

async function ttsWav(text: string, outPath: string): Promise<Uint8Array> {
  const txt = `${outPath}.txt`;
  await writeFile(txt, text, 'utf8');
  const q = (s: string) => s.replace(/'/g, "''");
  const ps = `Add-Type -AssemblyName System.Speech; $t = Get-Content -Raw -LiteralPath '${q(txt)}'; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = -1; $s.SetOutputToWaveFile('${q(outPath)}'); $s.Speak($t); $s.Dispose()`;
  await new Promise<void>((res, rej) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
    p.on('error', rej);
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`SAPI exited ${c}`))));
  });
  return new Uint8Array(await readFile(outPath));
}

async function makePhoto(n: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 600, height: 450, channels: 3, background: { r: 40 + n * 30, g: 90, b: 70 } } })
      .jpeg()
      .toBuffer(),
  );
}

async function main() {
  await mkdir(tmp, { recursive: true });
  console.log(`[e2e] target ${BASE}`);
  console.log('[e2e] health', await (await fetch(`${BASE}/healthz`)).json());

  const walkId = `e2e-${Date.now()}`;
  const fd = new FormData();
  const observations = [];
  for (let k = 0; k < PICK.length; k++) {
    const text = MOCK_TRANSCRIPTS[PICK[k]!]!;
    const oid = `e2e-obs-${k}`;
    const pid = `e2e-photo-${k}`;
    console.log(`[e2e] synthesizing speech #${k + 1}: "${text.slice(0, 56)}…"`);
    const wav = await ttsWav(text, resolve(tmp, `${oid}.wav`));
    fd.set(pid, new Blob([await makePhoto(k)], { type: 'image/jpeg' }), `${pid}.jpg`);
    fd.set(audioFieldFor(oid), new Blob([wav], { type: 'audio/wav' }), `${oid}.wav`);
    observations.push({
      id: oid,
      order: k,
      createdAt: new Date(Date.now() + k * 1000).toISOString(),
      photos: [{ id: pid, width: 600, height: 450 }],
      audioField: audioFieldFor(oid),
      audioMime: 'audio/wav',
    });
  }
  fd.set(
    'manifest',
    JSON.stringify({
      contractsVersion: CONTRACTS_VERSION,
      projectId: 'pilot-project',
      superName: 'E2E Tester',
      date: new Date().toISOString().slice(0, 10),
      walkId,
      observations,
    }),
  );

  console.log('[e2e] uploading real audio + photos…');
  const up = await fetch(`${BASE}/api/upload`, { method: 'POST', body: fd });
  const upj = await up.json();
  if (up.status !== 202) {
    console.error('[e2e] upload failed', up.status, upj);
    process.exit(1);
  }
  const reportId = upj.reportId as string;
  console.log(`[e2e] accepted reportId=${reportId} — processing (real Deepgram + Claude)…`);

  let st: { processing?: string; error?: string } = {};
  for (let i = 0; i < 120; i++) {
    st = await (await fetch(`${BASE}/api/reports/${reportId}/status`)).json();
    if (st.processing === 'ready' || st.processing === 'failed') break;
    await sleep(2000);
  }
  console.log('[e2e] final status', st);
  if (st.processing !== 'ready') {
    console.error('[e2e] pipeline did not reach ready');
    process.exit(1);
  }

  const rep = await (await fetch(`${BASE}/api/reports/${reportId}`)).json();
  console.log('\n━━━ REAL DEEPGRAM TRANSCRIPT  vs  REAL CLAUDE WRITE-UP ━━━\n');
  for (const o of rep.observations) {
    const tags = [o.trade, o.area].filter(Boolean).join(' · ');
    console.log(`#${o.order + 1}${tags ? `  [${tags}]` : ''}`);
    console.log(`  HEARD  : ${o.transcript ?? '(none)'}`);
    console.log(`  WRITTEN: ${o.cleanedDescription ?? '(none)'}\n`);
  }
  console.log('SUMMARY:', rep.summary);

  await fetch(`${BASE}/api/reports/${reportId}/finalize`, { method: 'POST' });
  const pdf = await fetch(`${BASE}/r/${reportId}.pdf`);
  const pdfLen = (await pdf.arrayBuffer()).byteLength;
  console.log(`\n[e2e] hosted report : ${BASE}/r/${reportId}`);
  console.log(`[e2e] PDF           : ${BASE}/r/${reportId}.pdf  (HTTP ${pdf.status}, ${pdfLen} bytes)`);

  await rm(tmp, { recursive: true, force: true });
  console.log('\n[e2e] DONE — full cloud path proven with real audio.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[e2e] FAILED', e);
  process.exit(1);
});
