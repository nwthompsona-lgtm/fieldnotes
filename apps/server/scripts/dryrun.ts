/**
 * End-to-end offline dry run (spec §10, §13). Seeds a synthetic walk (generated photos +
 * dummy audio), runs the REAL ingest + pipeline, and writes report.html/pdf/json to
 * apps/server/dryrun-output/ for inspection.
 *
 *   npm run dryrun -w @fieldreport/server
 *
 * Defaults (overridable via env): FIELDREPORT_LOCAL=1 so it NEVER touches the prod Neon
 * DB / R2 bucket, and STT_PROVIDER=mock so transcripts come from the curated corpus
 * (dummy audio would otherwise yield empty real-STT transcripts). Synthesis stays real
 * when ANTHROPIC_API_KEY is set — so this doubles as the prompt-tuning render.
 */
// Set self-test defaults BEFORE config is (dynamically) imported below.
process.env.FIELDREPORT_LOCAL ??= '1';
process.env.STT_PROVIDER ??= 'mock';

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { audioFieldFor, CONTRACTS_VERSION, type UploadManifest } from '@fieldreport/contracts';
import { buildDeps } from '../src/deps.js';
import { processUpload } from '../src/ingest/index.js';
import { runPipeline } from '../src/pipeline.js';
import { storageKeys } from '../src/storage/types.js';
import { closeBrowser } from '../src/render/index.js';

// Dynamic import so the env defaults above are honored when config evaluates.
const { config } = await import('../src/config.js');

const N = 10;
const COLORS = ['#2f6f57', '#3b5b8c', '#8c5a3b', '#5a3b8c', '#3b8c7a', '#8c3b5a'];

async function makePhoto(order: number, idx: number): Promise<Uint8Array> {
  const color = COLORS[(order + idx) % COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <rect width="1200" height="900" fill="${color}"/>
    <rect x="40" y="40" width="1120" height="820" fill="none" stroke="#ffffff" stroke-width="6" opacity="0.35"/>
    <text x="600" y="430" font-family="Arial" font-size="120" fill="#ffffff" text-anchor="middle" opacity="0.9">#${order + 1}</text>
    <text x="600" y="540" font-family="Arial" font-size="46" fill="#ffffff" text-anchor="middle" opacity="0.8">photo ${idx + 1} · sample</text>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer());
}

async function main() {
  const deps = await buildDeps(config);
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const walkId = `dryrun-${now.getTime()}`;
  // Run-unique ids so the script is safe to re-run against a persistent DB.
  const nonce = now.getTime().toString(36);

  const files = new Map<string, Uint8Array>();
  const observations: UploadManifest['observations'] = [];

  for (let order = 0; order < N; order++) {
    const obsId = `obs-${nonce}-${order}`;
    const photoCount = order % 3 === 0 ? 2 : 1;
    const photos = [];
    for (let i = 0; i < photoCount; i++) {
      const photoId = `pho-${nonce}-${order}-${i}`;
      files.set(photoId, await makePhoto(order, i));
      photos.push({ id: photoId, width: 1200, height: 900 });
    }
    files.set(audioFieldFor(obsId), new Uint8Array([1, 2, 3, 4]));
    observations.push({
      id: obsId,
      order,
      createdAt: new Date(now.getTime() + order * 60000).toISOString(),
      photos,
      audioField: audioFieldFor(obsId),
      audioMime: 'audio/webm',
    });
  }

  const manifest: UploadManifest = {
    contractsVersion: CONTRACTS_VERSION,
    projectId: config.pilot.projectId,
    superName: config.pilot.superName,
    date,
    walkId,
    observations,
    client: { ua: 'dryrun', installed: true, tz: 'UTC' },
  };

  console.log(
    `[dryrun] db=${config.db.url ? 'postgres' : 'pglite'} storage=${deps.storage.name} stt=${deps.transcriber.name} synthesis=${deps.synthesizer.name}`,
  );
  console.log(`[dryrun] ingesting synthetic walk: ${N} observations, ${files.size} media parts`);
  const result = await processUpload({ manifest, files, storage: deps.storage, repo: deps.repo });
  await runPipeline(deps, result.reportId);

  const report = await deps.repo.getReport(result.reportId);
  const htmlObj = await deps.storage.get(storageKeys.html(result.reportId));
  const pdfObj = await deps.storage.get(storageKeys.pdf(result.reportId));

  const outDir = resolve(process.cwd(), 'dryrun-output');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'report.html'), Buffer.from(htmlObj.bytes));
  await writeFile(resolve(outDir, 'report.pdf'), Buffer.from(pdfObj.bytes));
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));

  console.log(`[dryrun] DONE → ${outDir}`);
  console.log(`[dryrun]   report.html (${htmlObj.bytes.byteLength} bytes), report.pdf (${pdfObj.bytes.byteLength} bytes)`);
  console.log(`[dryrun]   summary: ${report?.summary?.slice(0, 160) ?? '(none)'}`);

  await closeBrowser();
  process.exit(0);
}

main().catch((err) => {
  console.error('[dryrun] FAILED', err);
  process.exit(1);
});
