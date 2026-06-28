import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/db/schema.js';
import { ensureSchema } from '../src/db/migrate.js';
import { makeRepo } from '../src/db/repo.js';
import type { Db } from '../src/db/client.js';
import type { UploadManifest } from '@fieldreport/contracts';
import type { IngestMediaKeys } from '../src/db/types.js';
import { reportQualityMetrics, computeRollup } from '../src/quality.js';

async function freshRepo() {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await ensureSchema(db);
  const repo = makeRepo(db);
  await repo.upsertProject({
    id: 'p1',
    name: 'Watson Island',
    superName: 'Test',
    glossary: [],
    baseLexiconRef: 'base-construction-v1',
  });
  return repo;
}

const manifest: UploadManifest = {
  contractsVersion: '1.0.0',
  projectId: 'p1',
  superName: 'Test',
  date: '2026-06-27',
  walkId: 'walk-q',
  observations: [
    { id: 'o1', order: 0, createdAt: '2026-06-27T14:00:00.000Z', photos: [{ id: 'ph1', width: 100, height: 100 }], audioField: 'audio:o1', audioMime: 'audio/webm' },
    { id: 'o2', order: 1, createdAt: '2026-06-27T14:01:00.000Z', photos: [{ id: 'ph2', width: 100, height: 100 }], audioField: 'audio:o2', audioMime: 'audio/webm' },
  ],
};

const media: IngestMediaKeys = {
  photos: {
    ph1: { key: 'reports/r/photos/ph1.jpg', width: 100, height: 100, byteSize: 10 },
    ph2: { key: 'reports/r/photos/ph2.jpg', width: 100, height: 100, byteSize: 10 },
  },
  audio: {
    o1: { key: 'reports/r/audio/o1.webm', mime: 'audio/webm', ext: 'webm' },
    o2: { key: 'reports/r/audio/o2.webm', mime: 'audio/webm', ext: 'webm' },
  },
};

describe('repo quality signals (AI-draft snapshot survives edits)', () => {
  it('preserves the AI draft and measures edits against it', async () => {
    const repo = await freshRepo();
    const { reportId } = await repo.createReportFromUpload(manifest, media);
    await repo.setTranscript('o1', 'grade inspection at level five', 0.92);
    await repo.setTranscript('o2', 'mud and tape on the demising wall', 0.4);
    await repo.applySynthesis(reportId, {
      summary: 'Framing inspection and drywall progress.',
      observations: [
        { id: 'o1', cleanedDescription: 'Grade inspection at Level 5.', trade: 'Concrete' },
        { id: 'o2', cleanedDescription: 'Mud and tape on the demising wall.', trade: 'Drywall' },
      ],
    });

    // Super corrects the mis-transcription on o1; leaves o2 alone.
    await repo.applyEdit(reportId, {
      observations: [{ id: 'o1', cleanedDescription: 'Framing inspection at Level 5.' }],
    });

    const q = await repo.getReportQuality(reportId);
    expect(q).not.toBeNull();
    // Original AI draft is preserved even though the live text changed.
    const o1 = q!.observations.find((o) => o.id === 'o1')!;
    expect(o1.aiCleanedDescription).toBe('Grade inspection at Level 5.');
    expect(o1.cleanedDescription).toBe('Framing inspection at Level 5.');
    expect(o1.transcriptConfidence).toBeCloseTo(0.92);

    const m = reportQualityMetrics(q!);
    expect(m.editedObservationCount).toBe(1); // only o1 changed
    expect(m.sentUnmodified).toBe(false);
    expect(m.avgObsEditDistance).toBeGreaterThan(0);
    expect(m.lowConfidenceCount).toBe(1); // o2 at 0.4
  });

  it('stores and reads the LangSmith run id', async () => {
    const repo = await freshRepo();
    const { reportId } = await repo.createReportFromUpload(manifest, media);
    expect((await repo.getReportQuality(reportId))!.runId).toBeNull();
    await repo.setLangsmithRunId(reportId, 'run-xyz');
    expect((await repo.getReportQuality(reportId))!.runId).toBe('run-xyz');
  });

  it('rolls up quality across reports', async () => {
    const repo = await freshRepo();
    const { reportId } = await repo.createReportFromUpload(manifest, media);
    await repo.applySynthesis(reportId, {
      summary: 'S.',
      observations: [
        { id: 'o1', cleanedDescription: 'unchanged one' },
        { id: 'o2', cleanedDescription: 'unchanged two' },
      ],
    });
    await repo.finalize(reportId); // reviewed, no edits → sent unmodified
    const rollup = computeRollup(await repo.listReportQuality());
    expect(rollup.totalReports).toBe(1);
    expect(rollup.reviewedCount).toBe(1);
    expect(rollup.sentUnmodifiedRate).toBe(1);
  });
});
