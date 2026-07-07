/**
 * Phase 7 — stakeholder directory + project roster + distribution defaults (§7).
 * Directory CRUD is org-admin-only and org-scoped (cross-org ids 404); roster/default reads
 * are open to send-capable roles (admin/pm/super) and roster writes are pm/admin. Deleting a
 * directory entry must not orphan past deliveries (denormalized email/name, contact_id → null).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { buildTestDeps, type TestDeps } from './helpers.js';
import type { UploadManifest } from '@fieldreport/contracts';
import type { IngestMediaKeys } from '../src/db/types.js';

let deps: TestDeps;
let app: FastifyInstance;
const tok: Record<string, string> = {};
const hdr = (who: string | null) => (who ? { authorization: `Bearer ${tok[who]}` } : {});

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', who: string | null, url: string, body?: unknown) =>
  app.inject({ method, url, headers: hdr(who), payload: body as Record<string, unknown> });

beforeAll(async () => {
  deps = await buildTestDeps();
  app = await buildApp(deps);
  await app.ready();
  const { repo, sessions } = deps;

  await repo.createOrg({ id: 'org_d', name: 'Org D' });
  await repo.createOrg({ id: 'org_e', name: 'Org E' });
  for (const [key, org, role] of [
    ['adminD', 'org_d', 'admin'],
    ['pmD', 'org_d', 'member'],
    ['superD', 'org_d', 'member'],
    ['viewerD', 'org_d', 'member'],
    ['memberD', 'org_d', 'member'],
    ['adminE', 'org_e', 'admin'],
  ] as const) {
    await repo.createUser({ id: key, email: `${key}@x.com`, name: key });
    await repo.addMembership({ id: `m_${key}`, userId: key, orgId: org, orgRole: role });
    tok[key] = await sessions.issue(key);
  }
  await repo.createProject({ id: 'proj_d', orgId: 'org_d', name: 'Proj D', superName: 'S', visibility: 'assigned' });
  await repo.addProjectMember({ id: 'pmd', projectId: 'proj_d', userId: 'pmD', role: 'pm' });
  await repo.addProjectMember({ id: 'sud', projectId: 'proj_d', userId: 'superD', role: 'super' });
  await repo.addProjectMember({ id: 'vwd', projectId: 'proj_d', userId: 'viewerD', role: 'viewer' });
});

afterAll(async () => {
  await app.close();
});

describe('directory CRUD (org admin only, org-scoped)', () => {
  it('admin can create/list/update stakeholder orgs + contacts; non-admin 403, anon 401', async () => {
    expect((await req('GET', null, '/api/orgs/org_d/stakeholders')).statusCode).toBe(401);
    expect((await req('GET', 'pmD', '/api/orgs/org_d/stakeholders')).statusCode).toBe(403);

    const created = await req('POST', 'adminD', '/api/orgs/org_d/stakeholders', { name: 'Acme Architects', kind: 'architect' });
    expect(created.statusCode).toBe(201);
    const sid = created.json().id;

    const list1 = await req('GET', 'adminD', '/api/orgs/org_d/stakeholders');
    expect(list1.json()).toHaveLength(1);
    expect(list1.json()[0]).toMatchObject({ id: sid, name: 'Acme Architects', kind: 'architect', contacts: [] });

    expect((await req('PATCH', 'adminD', `/api/orgs/org_d/stakeholders/${sid}`, { name: 'Acme A+E' })).statusCode).toBe(204);

    const contact = await req('POST', 'adminD', `/api/orgs/org_d/stakeholders/${sid}/contacts`, {
      name: 'Dana Lee',
      email: 'Dana.Lee@ACME.com',
      title: 'Principal',
    });
    expect(contact.statusCode).toBe(201);
    expect(contact.json().email).toBe('dana.lee@acme.com'); // normalized

    const list2 = await req('GET', 'adminD', '/api/orgs/org_d/stakeholders');
    expect(list2.json()[0]).toMatchObject({ name: 'Acme A+E', contacts: [{ name: 'Dana Lee', title: 'Principal' }] });
  });

  it("admin of org D cannot touch org E's directory entries (404)", async () => {
    const eOrg = await req('POST', 'adminE', '/api/orgs/org_e/stakeholders', { name: 'E Owner', kind: 'owner' });
    const esid = eOrg.json().id;
    // adminD references org E's stakeholder under the org_d path → ownership check → 404.
    expect((await req('PATCH', 'adminD', `/api/orgs/org_d/stakeholders/${esid}`, { name: 'hijack' })).statusCode).toBe(404);
    expect((await req('DELETE', 'adminD', `/api/orgs/org_d/stakeholders/${esid}`)).statusCode).toBe(404);
  });

  it('invalid create body → 400', async () => {
    expect((await req('POST', 'adminD', '/api/orgs/org_d/stakeholders', { name: '', kind: 'nope' })).statusCode).toBe(400);
  });
});

describe('project roster + distribution default', () => {
  let sid: string;
  beforeAll(async () => {
    sid = (await req('POST', 'adminD', '/api/orgs/org_d/stakeholders', { name: 'Owner Co', kind: 'owner' })).json().id;
  });

  it('pm sets the roster; super can read it; a non-send-capable member gets 404', async () => {
    const put = await req('PUT', 'pmD', '/api/projects/proj_d/stakeholders', { stakeholderOrgIds: [sid] });
    expect(put.statusCode).toBe(200);
    expect(put.json().map((s: { id: string }) => s.id)).toContain(sid);

    expect((await req('GET', 'superD', '/api/projects/proj_d/stakeholders')).statusCode).toBe(200);
    expect((await req('GET', 'memberD', '/api/projects/proj_d/stakeholders')).statusCode).toBe(404);
  });

  it('a viewer cannot write the roster (403), and cross-org stakeholder ids are rejected (400)', async () => {
    expect((await req('PUT', 'viewerD', '/api/projects/proj_d/stakeholders', { stakeholderOrgIds: [] })).statusCode).toBe(404);
    // superD is send-capable (passes the read-gate) but not a manager → 403 on write.
    expect((await req('PUT', 'superD', '/api/projects/proj_d/stakeholders', { stakeholderOrgIds: [sid] })).statusCode).toBe(403);
    const eOrgId = (await req('POST', 'adminE', '/api/orgs/org_e/stakeholders', { name: 'E2', kind: 'gc' })).json().id;
    const bad = await req('PUT', 'pmD', '/api/projects/proj_d/stakeholders', { stakeholderOrgIds: [eOrgId] });
    expect(bad.statusCode).toBe(400);
  });

  it('distribution default persists and reads back', async () => {
    expect((await req('GET', 'pmD', '/api/projects/proj_d/distribution-default')).json()).toBeNull();
    const sel = { orgIds: [sid], contactIds: [], adHoc: [] };
    const put = await req('PUT', 'pmD', '/api/projects/proj_d/distribution-default', sel);
    expect(put.statusCode).toBe(200);
    expect((await req('GET', 'superD', '/api/projects/proj_d/distribution-default')).json()).toMatchObject({ orgIds: [sid] });
  });
});

describe('deleting a directory entry never orphans past deliveries (§1.2)', () => {
  it('keeps the recipient row with its denormalized email/name; contact_id → null', async () => {
    const { repo } = deps;
    const sid = (await req('POST', 'adminD', '/api/orgs/org_d/stakeholders', { name: 'Del Co', kind: 'consultant' })).json().id;
    const cid = (await req('POST', 'adminD', `/api/orgs/org_d/stakeholders/${sid}/contacts`, { name: 'Pat Roe', email: 'pat@del.co' })).json().id;

    const manifest: UploadManifest = {
      contractsVersion: '1.2.0',
      projectId: 'proj_d',
      superName: 'S',
      date: '2026-07-07',
      walkId: 'w-del',
      observations: [
        { id: 'o-del', order: 0, createdAt: '2026-07-07T12:00:00.000Z', photos: [{ id: 'p-del', width: 8, height: 8 }], audioField: 'audio:o-del', audioMime: 'audio/webm' },
      ],
    };
    const media: IngestMediaKeys = { photos: { 'p-del': { key: 'reports/x/photos/p-del.jpg', width: 8, height: 8, byteSize: 7 } }, audio: {} };
    const { reportId } = await repo.createReportFromUpload(manifest, media);
    await repo.createReportSend({ id: 'snd_del', reportId, sentBy: 'pmD' });
    await repo.createRecipients([
      { id: 'rcp_del', sendId: 'snd_del', contactId: cid, email: 'pat@del.co', name: 'Pat Roe', token: 'tok_del', expiresAt: new Date(Date.now() + 86_400_000) },
    ]);

    expect((await req('DELETE', 'adminD', `/api/orgs/org_d/stakeholders/${sid}/contacts/${cid}`)).statusCode).toBe(204);

    const rec = await repo.getRecipientByToken('tok_del');
    expect(rec).not.toBeNull();
    expect(rec!.email).toBe('pat@del.co');
    expect(rec!.name).toBe('Pat Roe');
    expect(rec!.contactId ?? null).toBeNull(); // FK ON DELETE SET NULL
  });
});
