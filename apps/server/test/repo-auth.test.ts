/**
 * Phase 2 repo methods (AUTH_MULTITENANCY_PLAN.md §3): CRUD for every new auth/tenancy/
 * distribution entity against pglite. One shared instance (pglite boot is the slow part);
 * tests use distinct ids and are order-independent within each describe.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/db/schema.js';
import { ensureSchema } from '../src/db/migrate.js';
import { makeRepo } from '../src/db/repo.js';
import type { Db } from '../src/db/client.js';
import type { Repo } from '../src/db/types.js';
import type { UploadManifest } from '@fieldreport/contracts';
import type { IngestMediaKeys } from '../src/db/types.js';

let repo: Repo;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db; // in-memory
  await ensureSchema(db);
  repo = makeRepo(db);
});

describe('identity (users)', () => {
  it('createUserWithOrg is transactional: a duplicate email rolls back org + membership', async () => {
    await repo.createUserWithOrg({
      user: { id: 'usr_tx', email: 'tx@example.com', name: 'Tx One', passwordHash: 'h' },
      org: { id: 'org_tx', name: 'Tx Org' },
      membership: { id: 'mem_tx', orgRole: 'admin' },
    });
    expect(await repo.getOrg('org_tx')).toEqual({ id: 'org_tx', name: 'Tx Org' });
    expect(await repo.getMembership('usr_tx', 'org_tx')).toEqual({ orgRole: 'admin' });

    // Failure AFTER the user insert (duplicate org PK) must roll the user back too —
    // this is the exact "orphaned org-less account" scenario the transaction prevents.
    await expect(
      repo.createUserWithOrg({
        user: { id: 'usr_tx2', email: 'tx2@example.com', name: 'Tx Two', passwordHash: 'h' },
        org: { id: 'org_tx', name: 'Duplicate Org PK' },
        membership: { id: 'mem_tx2', orgRole: 'admin' },
      }),
    ).rejects.toThrow();
    expect(await repo.getUserByEmail('tx2@example.com')).toBeNull(); // rolled back
  });

  it('creates and reads a user by id and by email (case/space-insensitive)', async () => {
    await repo.createUser({ id: 'usr_1', email: 'Jake@Example.com ', name: 'Jake Romero' });
    const byId = await repo.getUserById('usr_1');
    expect(byId?.email).toBe('jake@example.com'); // normalized on write
    expect(byId?.passwordHash).toBeNull();
    const byEmail = await repo.getUserByEmail('  JAKE@example.COM');
    expect(byEmail?.id).toBe('usr_1');
  });

  it('rejects a duplicate email regardless of case (unique on lower(email))', async () => {
    await expect(
      repo.createUser({ id: 'usr_dup', email: 'JAKE@EXAMPLE.COM', name: 'Impostor' }),
    ).rejects.toThrow();
  });

  it('sets a password hash', async () => {
    await repo.setUserPassword('usr_1', 'argon2-hash-here');
    expect((await repo.getUserById('usr_1'))?.passwordHash).toBe('argon2-hash-here');
  });

  it('returns null for unknown users', async () => {
    expect(await repo.getUserById('usr_nope')).toBeNull();
    expect(await repo.getUserByEmail('nope@example.com')).toBeNull();
  });
});

describe('sessions', () => {
  it('creates, reads, touches, and revokes a session', async () => {
    await repo.createSession({ id: 'ses_tok_1', userId: 'usr_1', expiresAt: null });
    let s = await repo.getSession('ses_tok_1');
    expect(s).toEqual({ userId: 'usr_1', expiresAt: null, revokedAt: null }); // indefinite

    await repo.touchSession('ses_tok_1');
    await repo.revokeSession('ses_tok_1');
    s = await repo.getSession('ses_tok_1');
    expect(s?.revokedAt).toBeInstanceOf(Date);

    // Second revoke keeps the original revocation time.
    const first = s!.revokedAt!;
    await repo.revokeSession('ses_tok_1');
    expect((await repo.getSession('ses_tok_1'))?.revokedAt).toEqual(first);
  });

  it('stores a concrete expiry when given one', async () => {
    const expires = new Date('2027-01-01T00:00:00.000Z');
    await repo.createSession({ id: 'ses_tok_2', userId: 'usr_1', expiresAt: expires });
    expect((await repo.getSession('ses_tok_2'))?.expiresAt).toEqual(expires);
  });

  it('returns null for an unknown token', async () => {
    expect(await repo.getSession('ses_nope')).toBeNull();
  });
});

describe('orgs + memberships', () => {
  it('org → user → membership round-trip with roles', async () => {
    await repo.createOrg({ id: 'org_1', name: 'Watson Builders' });
    expect(await repo.getOrg('org_1')).toEqual({ id: 'org_1', name: 'Watson Builders' });

    await repo.addMembership({ id: 'mem_1', userId: 'usr_1', orgId: 'org_1', orgRole: 'admin' });
    expect(await repo.getMembership('usr_1', 'org_1')).toEqual({ orgRole: 'admin' });
    expect(await repo.getMembership('usr_1', 'org_nope')).toBeNull();

    const userOrgs = await repo.listOrgsForUser('usr_1');
    expect(userOrgs).toEqual([{ id: 'org_1', name: 'Watson Builders', role: 'admin' }]);
  });

  it('rejects a duplicate membership (unique user+org)', async () => {
    await expect(
      repo.addMembership({ id: 'mem_dup', userId: 'usr_1', orgId: 'org_1', orgRole: 'member' }),
    ).rejects.toThrow();
  });

  it('lists org members with their project assignments', async () => {
    await repo.createUser({ id: 'usr_2', email: 'pm@example.com', name: 'Ana PM' });
    await repo.addMembership({ id: 'mem_2', userId: 'usr_2', orgId: 'org_1', orgRole: 'member' });
    await repo.createProject({
      id: 'proj_a',
      orgId: 'org_1',
      name: 'Tower A',
      superName: 'Jake Romero',
      visibility: 'assigned',
    });
    await repo.addProjectMember({ id: 'pm_1', projectId: 'proj_a', userId: 'usr_2', role: 'pm' });

    const members = await repo.listOrgMembers('org_1');
    expect(members.map((m) => m.id).sort()).toEqual(['usr_1', 'usr_2']);
    const ana = members.find((m) => m.id === 'usr_2')!;
    expect(ana.orgRole).toBe('member');
    expect(ana.projects).toEqual([{ projectId: 'proj_a', userId: 'usr_2', role: 'pm' }]);
  });
});

describe('invitations', () => {
  it('creates, reads by token, and marks accepted', async () => {
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await repo.createInvitation({
      id: 'inv_1',
      orgId: 'org_1',
      email: 'New.Hire@Example.com',
      orgRole: 'member',
      projectAssignments: [{ projectId: 'proj_a', role: 'super' }],
      token: 'inv_tok_1',
      invitedBy: 'usr_1',
      expiresAt,
    });
    const inv = await repo.getInvitationByToken('inv_tok_1');
    expect(inv?.id).toBe('inv_1');
    expect(inv?.email).toBe('new.hire@example.com'); // normalized
    expect(inv?.projectAssignments).toEqual([{ projectId: 'proj_a', role: 'super' }]);
    expect(inv?.acceptedAt).toBeNull();

    await repo.markInvitationAccepted('inv_1');
    expect((await repo.getInvitationByToken('inv_tok_1'))?.acceptedAt).toBeInstanceOf(Date);
    expect(await repo.getInvitationByToken('inv_nope')).toBeNull();
  });
});

describe('projects (tenancy-aware)', () => {
  it('createProject + getProjectOrgId + setProjectVisibility', async () => {
    await repo.createProject({
      id: 'proj_b',
      orgId: 'org_1',
      name: 'Tower B',
      superName: 'Jake Romero',
      visibility: 'org',
    });
    expect(await repo.getProjectOrgId('proj_b')).toBe('org_1');
    expect(await repo.getProjectOrgId('proj_nope')).toBeNull();
    expect((await repo.getProject('proj_b'))?.visibility).toBe('org');

    await repo.setProjectVisibility('proj_b', 'assigned');
    expect((await repo.getProject('proj_b'))?.visibility).toBe('assigned');
    await repo.setProjectVisibility('proj_b', 'org'); // restore for the visibility test below
  });

  it('project member add / list / role / remove', async () => {
    await repo.addProjectMember({ id: 'pm_2', projectId: 'proj_b', userId: 'usr_2', role: 'viewer' });
    expect(await repo.getProjectRole('proj_b', 'usr_2')).toBe('viewer');
    const members = await repo.listProjectMembers('proj_b');
    expect(members).toEqual([
      {
        projectId: 'proj_b',
        userId: 'usr_2',
        role: 'viewer',
        user: { id: 'usr_2', email: 'pm@example.com', name: 'Ana PM' },
      },
    ]);
    await repo.removeProjectMember('proj_b', 'usr_2');
    expect(await repo.getProjectRole('proj_b', 'usr_2')).toBeNull();
    expect(await repo.listProjectMembers('proj_b')).toEqual([]);
  });

  it('listProjectsForUser: admins see all; members see assigned + org-visible; strangers none', async () => {
    // usr_1 is org admin → both org_1 projects.
    const adminSees = await repo.listProjectsForUser('usr_1', 'org_1');
    expect(adminSees.map((p) => p.id).sort()).toEqual(['proj_a', 'proj_b']);

    // usr_2 is a member: assigned to proj_a ('assigned' visibility) + proj_b is 'org'-visible.
    const memberSees = await repo.listProjectsForUser('usr_2', 'org_1');
    expect(memberSees.map((p) => p.id).sort()).toEqual(['proj_a', 'proj_b']);

    // Flip proj_b to 'assigned': usr_2 (not a member of it) loses it.
    await repo.setProjectVisibility('proj_b', 'assigned');
    const memberSeesNow = await repo.listProjectsForUser('usr_2', 'org_1');
    expect(memberSeesNow.map((p) => p.id)).toEqual(['proj_a']);

    // No membership in the org → nothing.
    await repo.createUser({ id: 'usr_3', email: 'stranger@example.com', name: 'Stranger' });
    expect(await repo.listProjectsForUser('usr_3', 'org_1')).toEqual([]);
  });
});

describe('reports scoping', () => {
  const manifest: UploadManifest = {
    contractsVersion: '1.2.0',
    projectId: 'proj_a',
    superName: 'Jake Romero',
    date: '2026-07-01',
    walkId: 'walk-auth-1',
    observations: [
      {
        id: 'oa1',
        order: 0,
        createdAt: '2026-07-01T14:00:00.000Z',
        photos: [{ id: 'pha1', width: 100, height: 100 }],
        audioField: 'audio:oa1',
        audioMime: 'audio/webm',
      },
    ],
  };
  const media: IngestMediaKeys = {
    photos: { pha1: { key: 'reports/r/photos/pha1.jpg', width: 100, height: 100, byteSize: 10 } },
    audio: { oa1: { key: 'reports/r/audio/oa1.webm', mime: 'audio/webm', ext: 'webm' } },
  };

  it('setReportCreatedBy surfaces via Report.createdBy; listReportsForProject scopes', async () => {
    const { reportId } = await repo.createReportFromUpload(manifest, media);
    expect((await repo.getReport(reportId))?.createdBy).toBeUndefined();

    await repo.setReportCreatedBy(reportId, 'usr_1');
    expect((await repo.getReport(reportId))?.createdBy).toBe('usr_1');

    const inProject = await repo.listReportsForProject('proj_a');
    expect(inProject.map((r) => r.id)).toEqual([reportId]);
    expect(await repo.listReportsForProject('proj_b')).toEqual([]);
  });
});

describe('stakeholder directory + roster + distribution default', () => {
  it('directory CRUD with nested contacts', async () => {
    await repo.createStakeholderOrg({ id: 'sko_1', orgId: 'org_1', name: 'JMA', kind: 'architect' });
    await repo.createStakeholderOrg({ id: 'sko_2', orgId: 'org_1', name: 'Acme Owner', kind: 'owner' });
    await repo.createStakeholderContact({
      id: 'skc_1',
      stakeholderOrgId: 'sko_1',
      name: 'Najib K',
      email: 'Najib@JMA.com',
      title: 'Principal',
    });
    await repo.createStakeholderContact({
      id: 'skc_2',
      stakeholderOrgId: 'sko_1',
      name: 'Bea L',
      email: 'bea@jma.com',
    });

    let dir = await repo.listStakeholderOrgs('org_1');
    expect(dir.map((o) => o.name)).toEqual(['Acme Owner', 'JMA']); // name-ordered
    const jma = dir.find((o) => o.id === 'sko_1')!;
    expect(jma.kind).toBe('architect');
    expect(jma.contacts.map((c) => c.name)).toEqual(['Bea L', 'Najib K']);
    expect(jma.contacts.find((c) => c.id === 'skc_1')).toEqual({
      id: 'skc_1',
      name: 'Najib K',
      email: 'najib@jma.com', // normalized
      title: 'Principal',
    });

    await repo.updateStakeholderOrg('sko_2', { name: 'Acme Holdings', kind: 'lender' });
    await repo.updateStakeholderContact('skc_2', { title: 'PM' });
    dir = await repo.listStakeholderOrgs('org_1');
    expect(dir.find((o) => o.id === 'sko_2')).toMatchObject({ name: 'Acme Holdings', kind: 'lender' });
    expect(dir.find((o) => o.id === 'sko_1')!.contacts.find((c) => c.id === 'skc_2')!.title).toBe('PM');

    const withOrg = await repo.getContactsByIds(['skc_1', 'skc_2']);
    expect(withOrg.map((c) => c.orgName)).toEqual(['JMA', 'JMA']);
    expect(await repo.getContactsByIds([])).toEqual([]);
  });

  it('roster set/get is wholesale-replace and dedupes input', async () => {
    await repo.setProjectStakeholders('proj_a', ['sko_1', 'sko_2']);
    expect((await repo.listProjectStakeholders('proj_a')).map((o) => o.id).sort()).toEqual([
      'sko_1',
      'sko_2',
    ]);
    await repo.setProjectStakeholders('proj_a', ['sko_1']);
    expect((await repo.listProjectStakeholders('proj_a')).map((o) => o.id)).toEqual(['sko_1']);
    // A repeated id from an unvalidated client array must not abort on the unique index.
    await repo.setProjectStakeholders('proj_a', ['sko_1', 'sko_1', 'sko_2']);
    expect((await repo.listProjectStakeholders('proj_a')).map((o) => o.id).sort()).toEqual([
      'sko_1',
      'sko_2',
    ]);
  });

  it('distribution default upserts', async () => {
    expect(await repo.getDistributionDefault('proj_a')).toBeNull();
    await repo.setDistributionDefault('proj_a', { orgIds: ['sko_1'], contactIds: [], adHoc: [] });
    expect(await repo.getDistributionDefault('proj_a')).toEqual({
      orgIds: ['sko_1'],
      contactIds: [],
      adHoc: [],
    });
    await repo.setDistributionDefault('proj_a', {
      orgIds: [],
      contactIds: ['skc_2'],
      adHoc: [{ name: 'One Off', email: 'one@off.com' }],
    });
    expect((await repo.getDistributionDefault('proj_a'))?.contactIds).toEqual(['skc_2']);
  });

  it('deleting a stakeholder org cascades its contacts', async () => {
    await repo.createStakeholderOrg({ id: 'sko_del', orgId: 'org_1', name: 'Gone Inc', kind: 'sub' });
    await repo.createStakeholderContact({
      id: 'skc_del',
      stakeholderOrgId: 'sko_del',
      name: 'Del C',
      email: 'del@gone.com',
    });
    await repo.deleteStakeholderOrg('sko_del');
    expect((await repo.listStakeholderOrgs('org_1')).find((o) => o.id === 'sko_del')).toBeUndefined();
    expect(await repo.getContactsByIds(['skc_del'])).toEqual([]);
  });
});

describe('sends + delivery', () => {
  let reportId: string;

  beforeAll(async () => {
    const { reportId: id } = await repo.createReportFromUpload(
      {
        contractsVersion: '1.2.0',
        projectId: 'proj_a',
        superName: 'Jake Romero',
        date: '2026-07-02',
        walkId: 'walk-send-1',
        observations: [
          {
            id: 'os1',
            order: 0,
            createdAt: '2026-07-02T14:00:00.000Z',
            photos: [{ id: 'phs1', width: 100, height: 100 }],
            audioField: 'audio:os1',
            audioMime: 'audio/webm',
          },
        ],
      },
      {
        photos: { phs1: { key: 'reports/r/photos/phs1.jpg', width: 100, height: 100, byteSize: 10 } },
        audio: { os1: { key: 'reports/r/audio/os1.webm', mime: 'audio/webm', ext: 'webm' } },
      },
    );
    reportId = id;
  });

  it('send + recipients round-trip with org attribution and token lookup', async () => {
    await repo.createReportSend({ id: 'snd_1', reportId, sentBy: 'usr_1', message: 'FYI' });
    await repo.createRecipients([
      {
        id: 'rcp_1',
        sendId: 'snd_1',
        contactId: 'skc_1',
        email: 'najib@jma.com',
        name: 'Najib K',
        token: 'tok_najib',
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
      {
        id: 'rcp_2',
        sendId: 'snd_1',
        email: 'one@off.com', // ad-hoc: no contactId
        name: 'One Off',
        token: 'tok_oneoff',
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    ]);

    const byToken = await repo.getRecipientByToken('tok_najib');
    expect(byToken?.id).toBe('rcp_1');
    expect(byToken?.reportId).toBe(reportId);
    expect(byToken?.openCount).toBe(0);
    expect(await repo.getRecipientByToken('tok_nope')).toBeNull();

    const sends = await repo.listSendsForReport(reportId);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.sentBy).toEqual({ id: 'usr_1', email: 'jake@example.com', name: 'Jake Romero' });
    expect(sends[0]!.recipients.map((r) => r.name)).toEqual(['Najib K', 'One Off']);
    expect(sends[0]!.recipients[0]!.org).toBe('JMA'); // via contact → stakeholder org
    expect(sends[0]!.recipients[1]!.org).toBeUndefined(); // ad-hoc
  });

  it('rejects a duplicate recipient token (unique capability URL)', async () => {
    await expect(
      repo.createRecipients([
        {
          id: 'rcp_dup',
          sendId: 'snd_1',
          email: 'dup@x.com',
          name: 'Dup',
          token: 'tok_najib',
          expiresAt: new Date(),
        },
      ]),
    ).rejects.toThrow();
  });

  it('records opens: first_opened_at only once, open_count increments', async () => {
    await repo.recordRecipientOpen('tok_najib');
    const first = await repo.getRecipientByToken('tok_najib');
    expect(first?.openCount).toBe(1);
    expect(first?.firstOpenedAt).toBeInstanceOf(Date);

    await repo.recordRecipientOpen('tok_najib');
    const second = await repo.getRecipientByToken('tok_najib');
    expect(second?.openCount).toBe(2);
    expect(second?.firstOpenedAt).toEqual(first?.firstOpenedAt); // sticky
    expect(second?.lastOpenedAt!.getTime()).toBeGreaterThanOrEqual(
      first?.lastOpenedAt!.getTime(),
    );
  });

  it('revokes a recipient (sticky timestamp) and rolls up the latest-send summary', async () => {
    await repo.revokeRecipient('rcp_2');
    const revoked = await repo.getRecipientByToken('tok_oneoff');
    expect(revoked?.revokedAt).toBeInstanceOf(Date);

    const summary = await repo.getReportLatestSendSummary(reportId);
    expect(summary).toMatchObject({ opened: 1, total: 2 });
    expect(typeof summary?.sentAt).toBe('string');
    expect(await repo.getReportLatestSendSummary('r-nope')).toBeNull();
  });
});
