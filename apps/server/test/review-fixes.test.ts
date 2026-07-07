/**
 * Regression tests for the Phase 4–6 code-review fixes (unit/repo level; the HTTP-level
 * ones live in authz-matrix / invitations / auth-routes):
 *   C5  — a failing best-effort touchSession must NOT demote a valid session.
 *   C17 — report authorship is written atomically by createReportFromUpload.
 *   C11 — listReportQualityForOrgs scopes in SQL (only the caller's orgs' reports).
 *   C8  — getLatestSendSummaries batches the per-report send rollup.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeSessions } from '../src/auth/sessions.js';
import { buildTestDeps, type TestDeps } from './helpers.js';
import type { UploadManifest } from '@fieldreport/contracts';
import type { IngestMediaKeys } from '../src/db/types.js';

let deps: TestDeps;

const manifestFor = (projectId: string, walkId: string): UploadManifest => ({
  contractsVersion: '1.2.0',
  projectId,
  superName: 'Fixture Super',
  date: '2026-07-07',
  walkId,
  observations: [
    {
      id: `o-${walkId}`,
      order: 0,
      createdAt: '2026-07-07T12:00:00.000Z',
      photos: [{ id: `p-${walkId}`, width: 8, height: 8 }],
      audioField: `audio:o-${walkId}`,
      audioMime: 'audio/webm',
    },
  ],
});
const mediaFor = (walkId: string): IngestMediaKeys => ({
  photos: { [`p-${walkId}`]: { key: `reports/x/photos/p-${walkId}.jpg`, width: 8, height: 8, byteSize: 7 } },
  audio: {},
});

beforeAll(async () => {
  deps = await buildTestDeps();
});

describe('C5 — session resolve survives a failing last_seen write', () => {
  it('returns the userId even when touchSession rejects', async () => {
    const { repo, config } = deps;
    await repo.createUser({ id: 'usr_sess', email: 'sess@x.com', name: 'Sess' });
    const sessions = makeSessions(repo, config);
    const token = await sessions.issue('usr_sess');

    const original = repo.touchSession.bind(repo);
    repo.touchSession = async () => {
      throw new Error('transient db blip');
    };
    try {
      // First resolve is past the throttle window (no prior touch) so it WOULD write — and
      // that write now throws. The session is still valid, so resolve must still succeed.
      expect(await sessions.resolve(token)).toBe('usr_sess');
    } finally {
      repo.touchSession = original;
    }
  });
});

describe('C17 — createReportFromUpload writes authorship atomically', () => {
  it('stamps created_by from the opts, no follow-up UPDATE', async () => {
    const { repo } = deps;
    await repo.upsertProject({
      id: 'proj_c17',
      name: 'C17',
      superName: 'S',
      glossary: [],
      baseLexiconRef: 'base-construction-v1',
    });
    await repo.createUser({ id: 'usr_author', email: 'author@x.com', name: 'Author' });
    const { reportId } = await repo.createReportFromUpload(
      manifestFor('proj_c17', 'w-c17'),
      mediaFor('w-c17'),
      { createdBy: 'usr_author' },
    );
    expect((await repo.getReport(reportId))?.createdBy).toBe('usr_author');
    expect((await repo.getReportViewMeta(reportId))?.createdBy).toBe('usr_author');
  });
});

describe('C11 — quality rollup is org-scoped in SQL', () => {
  it('returns only reports whose project belongs to the given orgs', async () => {
    const { repo } = deps;
    await repo.createOrg({ id: 'org_qx', name: 'QX' });
    await repo.createOrg({ id: 'org_qy', name: 'QY' });
    await repo.createProject({ id: 'proj_qx', orgId: 'org_qx', name: 'QX', superName: 'S', visibility: 'assigned' });
    await repo.createProject({ id: 'proj_qy', orgId: 'org_qy', name: 'QY', superName: 'S', visibility: 'assigned' });
    const { reportId: rx } = await repo.createReportFromUpload(manifestFor('proj_qx', 'w-qx'), mediaFor('w-qx'));
    const { reportId: ry } = await repo.createReportFromUpload(manifestFor('proj_qy', 'w-qy'), mediaFor('w-qy'));

    const scoped = await repo.listReportQualityForOrgs(['org_qx']);
    const ids = scoped.map((q) => q.id);
    expect(ids).toContain(rx);
    expect(ids).not.toContain(ry);
    expect(await repo.listReportQualityForOrgs([])).toEqual([]);
  });
});

describe('C8 — getLatestSendSummaries batches the send rollup', () => {
  it('keys the latest-send rollup by reportId (absent when never sent)', async () => {
    const { repo } = deps;
    await repo.upsertProject({
      id: 'proj_c8',
      name: 'C8',
      superName: 'S',
      glossary: [],
      baseLexiconRef: 'base-construction-v1',
    });
    await repo.createUser({ id: 'usr_sender', email: 'sender@x.com', name: 'Sender' });
    const { reportId: sent } = await repo.createReportFromUpload(manifestFor('proj_c8', 'w-c8-a'), mediaFor('w-c8-a'));
    const { reportId: neverSent } = await repo.createReportFromUpload(manifestFor('proj_c8', 'w-c8-b'), mediaFor('w-c8-b'));

    await repo.createReportSend({ id: 'snd_1', reportId: sent, sentBy: 'usr_sender' });
    await repo.createRecipients([
      { id: 'rcp_1', sendId: 'snd_1', email: 'a@x.com', name: 'A', token: 'tok_a', expiresAt: new Date(Date.now() + 86_400_000) },
      { id: 'rcp_2', sendId: 'snd_1', email: 'b@x.com', name: 'B', token: 'tok_b', expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    await repo.recordRecipientOpen('tok_a');

    const summaries = await repo.getLatestSendSummaries([sent, neverSent]);
    expect(summaries.get(sent)).toMatchObject({ total: 2, opened: 1 });
    expect(summaries.get(neverSent)).toBeUndefined();
    // Single-report helper agrees with the batch.
    expect(await repo.getReportLatestSendSummary(sent)).toMatchObject({ total: 2, opened: 1 });
  });
});
