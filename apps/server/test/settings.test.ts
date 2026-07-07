/**
 * Phase 10 (F2) settings endpoints: org members & roles (last-admin lockout), project
 * create/visibility, and per-project member assignments. Fixture: org S with admin /
 * pm (on ps_a) / super / member, plus an outsider org admin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { ServerDeps } from '../src/deps.js';
import { buildTestDeps } from './helpers.js';

let deps: ServerDeps;
let app: FastifyInstance;

const tok: Record<string, string> = {};
const auth = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
const json = (who: string) => ({ ...auth(who), 'content-type': 'application/json' });

beforeAll(async () => {
  deps = await buildTestDeps();
  app = await buildApp(deps);
  await app.ready();
  const { repo, sessions } = deps;

  await repo.createOrg({ id: 'org_s', name: 'Settings Org' });
  await repo.createOrg({ id: 'org_t', name: 'Other Org' });
  for (const [key, org, orgRole] of [
    ['adminS', 'org_s', 'admin'],
    ['adminS2', 'org_s', 'admin'],
    ['pmS', 'org_s', 'member'],
    ['superS', 'org_s', 'member'],
    ['memberS', 'org_s', 'member'],
    ['outsiderT', 'org_t', 'admin'],
  ] as const) {
    await repo.createUser({ id: key, email: `${key}@x.com`, name: key });
    await repo.addMembership({ id: `m_${key}`, userId: key, orgId: org, orgRole });
    tok[key] = await sessions.issue(key);
  }
  await repo.createProject({
    id: 'ps_a',
    orgId: 'org_s',
    name: 'Settings Project A',
    superName: 'S',
    visibility: 'assigned',
  });
  await repo.addProjectMember({ id: 'pm_1', projectId: 'ps_a', userId: 'pmS', role: 'pm' });
  await repo.addProjectMember({ id: 'pm_2', projectId: 'ps_a', userId: 'superS', role: 'super' });
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/orgs/:orgId/members', () => {
  it('admin and pm read the table (assignments carry project names); super gets 403', async () => {
    const asAdmin = await app.inject({ url: '/api/orgs/org_s/members', headers: auth('adminS') });
    expect(asAdmin.statusCode).toBe(200);
    const rows = asAdmin.json() as Array<{
      user: { id: string };
      orgRole: string;
      assignments: Array<{ projectId: string; projectName: string; role: string }>;
    }>;
    expect(rows).toHaveLength(5);
    const pmRow = rows.find((r) => r.user.id === 'pmS')!;
    expect(pmRow.assignments).toEqual([
      { projectId: 'ps_a', projectName: 'Settings Project A', role: 'pm' },
    ]);

    expect(
      (await app.inject({ url: '/api/orgs/org_s/members', headers: auth('pmS') })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/orgs/org_s/members', headers: auth('superS') })).statusCode,
    ).toBe(403);
    // Outsider: 404 — org existence never leaks.
    expect(
      (await app.inject({ url: '/api/orgs/org_s/members', headers: auth('outsiderT') }))
        .statusCode,
    ).toBe(404);
  });
});

describe('member role change + removal', () => {
  it('admin changes a role; pm cannot; last-admin is locked out', async () => {
    const promote = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/org_s/members/memberS',
      headers: json('adminS'),
      payload: { orgRole: 'admin' },
    });
    expect(promote.statusCode).toBe(204);
    // revert
    await app.inject({
      method: 'PATCH',
      url: '/api/orgs/org_s/members/memberS',
      headers: json('adminS'),
      payload: { orgRole: 'member' },
    });

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/orgs/org_s/members/memberS',
          headers: json('pmS'),
          payload: { orgRole: 'admin' },
        })
      ).statusCode,
    ).toBe(403);

    // Demote adminS2 (fine — two admins), then demoting adminS must be blocked.
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/orgs/org_s/members/adminS2',
          headers: json('adminS'),
          payload: { orgRole: 'member' },
        })
      ).statusCode,
    ).toBe(204);
    const lockout = await app.inject({
      method: 'PATCH',
      url: '/api/orgs/org_s/members/adminS',
      headers: json('adminS'),
      payload: { orgRole: 'member' },
    });
    expect(lockout.statusCode).toBe(400);
    // Removing the last admin is blocked too.
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/orgs/org_s/members/adminS',
          headers: auth('adminS'),
        })
      ).statusCode,
    ).toBe(400);
    // restore the second admin
    await app.inject({
      method: 'PATCH',
      url: '/api/orgs/org_s/members/adminS2',
      headers: json('adminS'),
      payload: { orgRole: 'admin' },
    });
  });

  it('removal drops the membership AND the org-scoped project assignments', async () => {
    const { repo, sessions } = deps;
    await repo.createUser({ id: 'leaverS', email: 'leaver@x.com', name: 'Leaver' });
    await repo.addMembership({ id: 'm_leaver', userId: 'leaverS', orgId: 'org_s', orgRole: 'member' });
    await repo.addProjectMember({ id: 'pm_l', projectId: 'ps_a', userId: 'leaverS', role: 'viewer' });
    tok.leaverS = await sessions.issue('leaverS');

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/orgs/org_s/members/leaverS',
      headers: auth('adminS'),
    });
    expect(del.statusCode).toBe(204);
    expect(await repo.getMembership('leaverS', 'org_s')).toBeNull();
    expect(await repo.getProjectRole('ps_a', 'leaverS')).toBeNull();
    // Their session no longer reaches org data.
    expect(
      (await app.inject({ url: '/api/orgs/org_s/projects', headers: auth('leaverS') }))
        .statusCode,
    ).toBe(404);
  });
});

describe('projects: create + visibility', () => {
  it('admin creates; non-admin 403; visibility patch is admin-only', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orgs/org_s/projects',
      headers: json('adminS'),
      payload: { name: 'New Project', visibility: 'org' },
    });
    expect(created.statusCode).toBe(201);
    const proj = created.json() as { id: string; name: string; visibility: string; role: null };
    expect(proj.name).toBe('New Project');
    expect(proj.visibility).toBe('org');

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/orgs/org_s/projects',
          headers: json('pmS'),
          payload: { name: 'Nope' },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/projects/${proj.id}`,
          headers: json('adminS'),
          payload: { visibility: 'assigned' },
        })
      ).statusCode,
    ).toBe(204);
    expect((await deps.repo.getProject(proj.id))?.visibility).toBe('assigned');

    // pm on ps_a is NOT admin → 403 on a project they can view; outsider → 404.
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/projects/ps_a',
          headers: json('pmS'),
          payload: { visibility: 'org' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/projects/ps_a',
          headers: json('outsiderT'),
          payload: { visibility: 'org' },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('project member assignments', () => {
  it('pm assigns/updates/removes; assignee must be an org member; super 403', async () => {
    // pm assigns memberS as viewer
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/ps_a/members/memberS',
          headers: json('pmS'),
          payload: { role: 'viewer' },
        })
      ).statusCode,
    ).toBe(204);
    // upsert to super
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/ps_a/members/memberS',
          headers: json('pmS'),
          payload: { role: 'super' },
        })
      ).statusCode,
    ).toBe(204);
    expect(await deps.repo.getProjectRole('ps_a', 'memberS')).toBe('super');

    const list = await app.inject({ url: '/api/projects/ps_a/members', headers: auth('pmS') });
    expect(list.statusCode).toBe(200);
    expect(
      (list.json() as Array<{ userId: string }>).some((m) => m.userId === 'memberS'),
    ).toBe(true);

    // Cross-tenant assignee rejected.
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/ps_a/members/outsiderT',
          headers: json('pmS'),
          payload: { role: 'viewer' },
        })
      ).statusCode,
    ).toBe(400);

    // super can't manage assignments.
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/projects/ps_a/members/memberS',
          headers: json('superS'),
          payload: { role: 'viewer' },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/projects/ps_a/members/memberS',
          headers: auth('pmS'),
        })
      ).statusCode,
    ).toBe(204);
    expect(await deps.repo.getProjectRole('ps_a', 'memberS')).toBeNull();
  });
});
