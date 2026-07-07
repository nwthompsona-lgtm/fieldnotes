/**
 * Phase 9 (F1) backend gap: GET /api/orgs/:orgId/projects — the app-shell project
 * switcher feed. Scoping follows repo.listProjectsForUser (admins: all; members:
 * assignments + org-visible), and each row carries the caller's explicit project role
 * (null = visible via org visibility / org-admin only) for the permission-matrix UI.
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

beforeAll(async () => {
  deps = await buildTestDeps();
  app = await buildApp(deps);
  await app.ready();
  const { repo, sessions } = deps;

  await repo.createOrg({ id: 'org_w', name: 'Workspace Org' });
  await repo.createOrg({ id: 'org_x', name: 'Other Org' });
  for (const [key, org, orgRole] of [
    ['adminW', 'org_w', 'admin'],
    ['memberW', 'org_w', 'member'],
    ['outsiderX', 'org_x', 'admin'],
  ] as const) {
    await repo.createUser({ id: key, email: `${key}@x.com`, name: key });
    await repo.addMembership({ id: `m_${key}`, userId: key, orgId: org, orgRole });
    tok[key] = await sessions.issue(key);
  }

  const proj = (id: string, visibility: 'org' | 'assigned') =>
    repo.createProject({ id, orgId: 'org_w', name: id, superName: 'S', visibility });
  await proj('pw_assigned', 'assigned'); // memberW is pm here
  await proj('pw_orgvis', 'org'); // visible to all org members, no explicit role
  await proj('pw_hidden', 'assigned'); // memberW has no assignment → invisible
  await repo.addProjectMember({
    id: 'pm_w1',
    projectId: 'pw_assigned',
    userId: 'memberW',
    role: 'pm',
  });
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/orgs/:orgId/projects', () => {
  it('org admin sees every project; role reflects explicit assignment only', async () => {
    const res = await app.inject({ url: '/api/orgs/org_w/projects', headers: auth('adminW') });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; role: string | null }>;
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set(['pw_assigned', 'pw_orgvis', 'pw_hidden']),
    );
    expect(rows.every((r) => r.role === null)).toBe(true); // admin has no project_member rows
  });

  it('member sees assignments + org-visible, with their project role attached', async () => {
    const res = await app.inject({ url: '/api/orgs/org_w/projects', headers: auth('memberW') });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; role: string | null }>;
    const byId = new Map(rows.map((r) => [r.id, r.role]));
    expect(byId.get('pw_assigned')).toBe('pm');
    expect(byId.get('pw_orgvis')).toBeNull();
    expect(byId.has('pw_hidden')).toBe(false);
  });

  it('non-members 404 (no org existence leak); anonymous 401', async () => {
    const out = await app.inject({ url: '/api/orgs/org_w/projects', headers: auth('outsiderX') });
    expect(out.statusCode).toBe(404);
    const anon = await app.inject({ url: '/api/orgs/org_w/projects' });
    expect(anon.statusCode).toBe(401);
  });
});
