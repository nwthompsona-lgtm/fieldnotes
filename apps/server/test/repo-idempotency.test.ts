import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/db/schema.js';
import { ensureSchema } from '../src/db/migrate.js';
import { makeRepo } from '../src/db/repo.js';
import type { Db } from '../src/db/client.js';
import type { UploadManifest } from '@fieldreport/contracts';
import type { IngestMediaKeys } from '../src/db/types.js';

async function freshRepo() {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db; // in-memory
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
  walkId: 'walk-1',
  observations: [
    {
      id: 'o1',
      order: 0,
      createdAt: '2026-06-27T14:00:00.000Z',
      photos: [{ id: 'ph1', width: 100, height: 100 }],
      audioField: 'audio:o1',
      audioMime: 'audio/webm',
    },
    {
      id: 'o2',
      order: 1,
      createdAt: '2026-06-27T14:01:00.000Z',
      photos: [{ id: 'ph2', width: 100, height: 100 }],
      audioField: 'audio:o2',
      audioMime: 'audio/webm',
    },
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

describe('repo upload idempotency (spec §3 — retried upload never double-creates)', () => {
  it('creates once, returns the same report on a retried walk', async () => {
    const repo = await freshRepo();
    const r1 = await repo.createReportFromUpload(manifest, media);
    const r2 = await repo.createReportFromUpload(manifest, media);
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.reportId).toBe(r1.reportId);
    expect(r2.acceptedObservationIds.sort()).toEqual(['o1', 'o2']);
  });

  it('round-trips observations + photos in order via getReport', async () => {
    const repo = await freshRepo();
    const { reportId } = await repo.createReportFromUpload(manifest, media);
    const report = await repo.getReport(reportId);
    expect(report?.observations.map((o) => o.order)).toEqual([0, 1]);
    expect(report?.observations[0]!.photos[0]!.blobRef).toBe('reports/r/photos/ph1.jpg');
    expect(report?.observations[0]!.audioRef).toBe('reports/r/audio/o1.webm');
  });

  it('applies synthesis + finalize through the review gate', async () => {
    const repo = await freshRepo();
    const { reportId } = await repo.createReportFromUpload(manifest, media);
    await repo.applySynthesis(reportId, {
      summary: 'Test summary.',
      observations: [
        { id: 'o1', cleanedDescription: 'Clean one.', trade: 'Drywall', area: 'Level 3' },
        { id: 'o2', cleanedDescription: 'Clean two.' },
      ],
    });
    let r = await repo.getReport(reportId);
    expect(r?.summary).toBe('Test summary.');
    expect(r?.observations[0]!.cleanedDescription).toBe('Clean one.');
    expect(r?.status).toBe('draft');

    await repo.finalize(reportId);
    r = await repo.getReport(reportId);
    expect(r?.status).toBe('reviewed');

    // An edit must revert to draft (re-review required before sharing).
    await repo.applyEdit(reportId, { summary: 'Edited.' });
    r = await repo.getReport(reportId);
    expect(r?.status).toBe('draft');
    expect(r?.summary).toBe('Edited.');
  });
});
