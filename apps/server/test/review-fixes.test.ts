/**
 * Regression tests for the Phase 4–6 code-review fixes (unit/repo level; the HTTP-level
 * ones live in authz-matrix / invitations / auth-routes):
 *   C5  — a failing best-effort touchSession must NOT demote a valid session.
 *   C17 — report authorship is written atomically by createReportFromUpload.
 *   C11 — listReportQualityForOrgs scopes in SQL (only the caller's orgs' reports).
 *   C8  — getLatestSendSummaries batches the per-report send rollup.
 * Plus the later review round:
 *   F5  — the last-admin guard is atomic (locked + counted in ONE transaction).
 *   F6  — ensureProjectFromUpload is create-if-missing only (uploads never rename).
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

describe('F5 — atomic last-admin guard (lock + count + write in one transaction)', () => {
  it('demoting/removing the sole admin fails; with two admins it succeeds', async () => {
    const { repo } = deps;
    await repo.createOrg({ id: 'org_f5', name: 'F5 Org' });
    await repo.createUser({ id: 'f5_a1', email: 'f5a1@x.com', name: 'A1' });
    await repo.createUser({ id: 'f5_a2', email: 'f5a2@x.com', name: 'A2' });
    await repo.addMembership({ id: 'm_f5_a1', userId: 'f5_a1', orgId: 'org_f5', orgRole: 'admin' });

    // Sole admin: demote and remove both refuse and write nothing.
    expect(await repo.updateMembershipRoleGuarded('f5_a1', 'org_f5', 'member')).toBe('last-admin');
    expect((await repo.getMembership('f5_a1', 'org_f5'))?.orgRole).toBe('admin');
    expect(await repo.removeMembershipGuarded('f5_a1', 'org_f5')).toBe('last-admin');
    expect(await repo.getMembership('f5_a1', 'org_f5')).not.toBeNull();

    // A no-op "demotion" to admin and a non-admin change are never blocked.
    expect(await repo.updateMembershipRoleGuarded('f5_a1', 'org_f5', 'admin')).toBe('ok');

    // Two admins: demoting one succeeds and leaves exactly one admin standing.
    await repo.addMembership({ id: 'm_f5_a2', userId: 'f5_a2', orgId: 'org_f5', orgRole: 'admin' });
    expect(await repo.updateMembershipRoleGuarded('f5_a2', 'org_f5', 'member')).toBe('ok');
    expect((await repo.getMembership('f5_a2', 'org_f5'))?.orgRole).toBe('member');
    // …and the survivor is now the sole admin again, so the guard re-engages.
    expect(await repo.updateMembershipRoleGuarded('f5_a1', 'org_f5', 'member')).toBe('last-admin');
  });

  it('removal still drops the org-scoped project assignments (guarded path)', async () => {
    const { repo } = deps;
    await repo.createOrg({ id: 'org_f5b', name: 'F5b Org' });
    await repo.createUser({ id: 'f5_adm', email: 'f5adm@x.com', name: 'Adm' });
    await repo.createUser({ id: 'f5_mem', email: 'f5mem@x.com', name: 'Mem' });
    await repo.addMembership({ id: 'm_f5_adm', userId: 'f5_adm', orgId: 'org_f5b', orgRole: 'admin' });
    await repo.addMembership({ id: 'm_f5_mem', userId: 'f5_mem', orgId: 'org_f5b', orgRole: 'member' });
    await repo.createProject({ id: 'proj_f5b', orgId: 'org_f5b', name: 'F5b', superName: 'S', visibility: 'assigned' });
    await repo.addProjectMember({ id: 'pm_f5b', projectId: 'proj_f5b', userId: 'f5_mem', role: 'viewer' });

    expect(await repo.removeMembershipGuarded('f5_mem', 'org_f5b')).toBe('ok');
    expect(await repo.getMembership('f5_mem', 'org_f5b')).toBeNull();
    expect(await repo.getProjectRole('proj_f5b', 'f5_mem')).toBeNull();
  });
});

describe('F6 — ensureProjectFromUpload never renames an existing project', () => {
  it('creates when missing; a conflicting manifest name leaves the row unchanged', async () => {
    const { repo } = deps;
    // Create-if-missing still works (deploy-order compat for clients that name a
    // project before the server row exists).
    await repo.ensureProjectFromUpload({ id: 'proj_f6_new', name: 'Fresh Name', superName: 'Super F' });
    expect((await repo.getProject('proj_f6_new'))?.name).toBe('Fresh Name');

    // An existing (server-named, org-adopted) project must survive a stale manifest:
    // uploads carry a real projectId since Phase 11 — the name is just a cached label.
    await repo.createOrg({ id: 'org_f6', name: 'F6 Org' });
    await repo.createProject({ id: 'proj_f6', orgId: 'org_f6', name: 'Server Name', superName: 'Server Super', visibility: 'assigned' });
    await repo.ensureProjectFromUpload({ id: 'proj_f6', name: 'Stale Cached Name', superName: 'Sneaky Super' });
    const p = await repo.getProject('proj_f6');
    expect(p?.name).toBe('Server Name');
    expect(p?.superName).toBe('Server Super');
    expect(p?.orgId).toBe('org_f6'); // tenancy untouched too
  });
});
