/**
 * Phase 4 authz matrix (AUTH_MULTITENANCY_PLAN.md §5.1, §13): a fixture org with
 * admin / pm / super(author) / super(other) / viewer / role-less member + an outsider
 * org, over two projects ('assigned' vs 'org' visibility), asserted over real HTTP
 * (app.inject). Reads use 404 (not 403) so report ids never leak (§6.3).
 *
 * Finalize/hosted-view ALLOW paths trigger Playwright rendering, so tests cover their
 * DENY paths over HTTP and rely on canFinalize === canEditReport (asserted via PATCH)
 * for the allow logic; reviewed fixtures are created via repo.finalize directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import type { ServerDeps } from '../src/deps.js';
import { signMediaKey } from '../src/storage/local.js';
import { buildTestDeps } from './helpers.js';
import type { UploadManifest } from '@fieldreport/contracts';
import type { IngestMediaKeys } from '../src/db/types.js';

let deps: ServerDeps;
let app: FastifyInstance;

/** user key → session token */
const tok: Record<string, string> = {};
const auth = (who: string) => ({ authorization: `Bearer ${tok[who]}` });

let repDraft: string; // p_assigned, draft, authored by superA1
let repRev: string; // p_assigned, reviewed
let repOrgDraft: string; // p_org, draft
let repOrgRev: string; // p_org, reviewed
let repB: string; // org B's report (admin scoping)

const USERS: Array<{ key: string; org: string; orgRole: 'admin' | 'member' }> = [
  { key: 'adminA', org: 'org_a', orgRole: 'admin' },
  { key: 'pmA', org: 'org_a', orgRole: 'member' },
  { key: 'superA1', org: 'org_a', orgRole: 'member' },
  { key: 'superA2', org: 'org_a', orgRole: 'member' },
  { key: 'viewerA', org: 'org_a', orgRole: 'member' },
  { key: 'memberA', org: 'org_a', orgRole: 'member' },
  { key: 'outsiderB', org: 'org_b', orgRole: 'admin' },
];

async function makeReport(
  projectId: string,
  walkId: string,
  createdBy?: string,
  reviewed = false,
): Promise<string> {
  const manifest: UploadManifest = {
    contractsVersion: '1.2.0',
    projectId,
    superName: 'Fixture Super',
    date: '2026-07-06',
    walkId,
    observations: [
      {
        id: `o-${walkId}`,
        order: 0,
        createdAt: '2026-07-06T14:00:00.000Z',
        photos: [{ id: `p-${walkId}`, width: 10, height: 10 }],
        audioField: `audio:o-${walkId}`,
        audioMime: 'audio/webm',
      },
    ],
  };
  const media: IngestMediaKeys = {
    photos: { [`p-${walkId}`]: { key: `k/p-${walkId}.jpg`, width: 10, height: 10, byteSize: 9 } },
    audio: {},
  };
  const { reportId } = await deps.repo.createReportFromUpload(manifest, media);
  if (createdBy) await deps.repo.setReportCreatedBy(reportId, createdBy);
  if (reviewed) await deps.repo.finalize(reportId);
  return reportId;
}

beforeAll(async () => {
  deps = await buildTestDeps();
  app = await buildApp(deps);
  await app.ready();
  const { repo, sessions } = deps;

  await repo.createOrg({ id: 'org_a', name: 'Org A' });
  await repo.createOrg({ id: 'org_b', name: 'Org B' });
  for (const u of USERS) {
    await repo.createUser({ id: u.key, email: `${u.key}@x.com`, name: `Name ${u.key}` });
    await repo.addMembership({ id: `m_${u.key}`, userId: u.key, orgId: u.org, orgRole: u.orgRole });
    tok[u.key] = await sessions.issue(u.key);
  }

  await repo.createProject({
    id: 'p_assigned',
    orgId: 'org_a',
    name: 'Assigned Project',
    superName: 'Fixture Super',
    visibility: 'assigned',
  });
  await repo.createProject({
    id: 'p_org',
    orgId: 'org_a',
    name: 'Org-visible Project',
    superName: 'Fixture Super',
    visibility: 'org',
  });
  await repo.createProject({
    id: 'p_b',
    orgId: 'org_b',
    name: 'B Project',
    superName: 'B Super',
    visibility: 'assigned',
  });
  await repo.addProjectMember({ id: 'pm1', projectId: 'p_assigned', userId: 'pmA', role: 'pm' });
  await repo.addProjectMember({ id: 'pm2', projectId: 'p_assigned', userId: 'superA1', role: 'super' });
  await repo.addProjectMember({ id: 'pm3', projectId: 'p_assigned', userId: 'superA2', role: 'super' });
  await repo.addProjectMember({ id: 'pm4', projectId: 'p_assigned', userId: 'viewerA', role: 'viewer' });

  repDraft = await makeReport('p_assigned', 'w-draft', 'superA1');
  repRev = await makeReport('p_assigned', 'w-rev', 'superA1', true);
  repOrgDraft = await makeReport('p_org', 'w-org-draft');
  repOrgRev = await makeReport('p_org', 'w-org-rev', undefined, true);
  repB = await makeReport('p_b', 'w-b', 'outsiderB');
});

afterAll(async () => {
  await app.close();
});

const get = (who: string | null, url: string) =>
  app.inject({ method: 'GET', url, headers: who ? auth(who) : {} });

describe('view: report read (§5.1 view rows; 404 = no leak)', () => {
  it('draft on an assigned project: roles see it, viewer/member/outsider do not', async () => {
    expect((await get('adminA', `/api/reports/${repDraft}`)).statusCode).toBe(200);
    expect((await get('pmA', `/api/reports/${repDraft}`)).statusCode).toBe(200);
    expect((await get('superA1', `/api/reports/${repDraft}`)).statusCode).toBe(200);
    expect((await get('superA2', `/api/reports/${repDraft}`)).statusCode).toBe(200); // project drafts
    expect((await get('viewerA', `/api/reports/${repDraft}`)).statusCode).toBe(404);
    expect((await get('memberA', `/api/reports/${repDraft}`)).statusCode).toBe(404);
    expect((await get('outsiderB', `/api/reports/${repDraft}`)).statusCode).toBe(404);
    expect((await get(null, `/api/reports/${repDraft}`)).statusCode).toBe(401);
  });

  it('reviewed on an assigned project: viewer yes, role-less member still no', async () => {
    expect((await get('viewerA', `/api/reports/${repRev}`)).statusCode).toBe(200);
    expect((await get('memberA', `/api/reports/${repRev}`)).statusCode).toBe(404);
    expect((await get('outsiderB', `/api/reports/${repRev}`)).statusCode).toBe(404);
  });

  it("org-visible project: any org member sees REVIEWED only (D-4)", async () => {
    expect((await get('memberA', `/api/reports/${repOrgRev}`)).statusCode).toBe(200);
    expect((await get('memberA', `/api/reports/${repOrgDraft}`)).statusCode).toBe(404);
    expect((await get('outsiderB', `/api/reports/${repOrgRev}`)).statusCode).toBe(404);
  });

  it('status route is gated identically', async () => {
    expect((await get('viewerA', `/api/reports/${repDraft}/status`)).statusCode).toBe(404);
    expect((await get('pmA', `/api/reports/${repDraft}/status`)).statusCode).toBe(200);
    expect((await get(null, `/api/reports/${repDraft}/status`)).statusCode).toBe(401);
  });
});

describe('edit + finalize (D-6: pm/admin any; super their own)', () => {
  const patch = (who: string, id: string) =>
    app.inject({ method: 'PATCH', url: `/api/reports/${id}`, headers: auth(who), payload: {} });

  it('denies: viewer 404 (cannot even view a draft), non-author super 403', async () => {
    expect((await patch('viewerA', repDraft)).statusCode).toBe(404);
    expect((await patch('superA2', repDraft)).statusCode).toBe(403);
    expect((await patch('memberA', repDraft)).statusCode).toBe(404);
    expect((await patch('outsiderB', repDraft)).statusCode).toBe(404);
  });

  it('allows: author super, pm, admin', async () => {
    expect((await patch('superA1', repDraft)).statusCode).toBe(200);
    expect((await patch('pmA', repDraft)).statusCode).toBe(200);
    expect((await patch('adminA', repDraft)).statusCode).toBe(200);
  });

  it('finalize deny paths mirror edit (allow path = same predicate, avoided: renders PDF)', async () => {
    const fin = (who: string, id: string) =>
      app.inject({ method: 'POST', url: `/api/reports/${id}/finalize`, headers: auth(who), payload: {} });
    expect((await fin('viewerA', repDraft)).statusCode).toBe(404);
    expect((await fin('superA2', repDraft)).statusCode).toBe(403);
    expect((await fin('outsiderB', repDraft)).statusCode).toBe(404);
    expect((await get(null, `/r/${repDraft}`)).statusCode).toBe(401); // hosted view authed too
    expect((await get('outsiderB', `/r/${repDraft}`)).statusCode).toBe(404);
    expect((await get('viewerA', `/r/${repDraft}`)).statusCode).toBe(404); // draft
  });
});

describe('GET /api/reports?projectId (scoped list, §6.2)', () => {
  it('roles see drafts + reviewed; viewer sees reviewed only', async () => {
    const pm = (await get('pmA', '/api/reports?projectId=p_assigned')).json();
    expect(pm.map((r: { id: string }) => r.id).sort()).toEqual([repDraft, repRev].sort());
    expect(pm[0]).toHaveProperty('lastSend'); // send chip wired (null until Phase 8)

    const viewer = (await get('viewerA', '/api/reports?projectId=p_assigned')).json();
    expect(viewer.map((r: { id: string }) => r.id)).toEqual([repRev]);
  });

  it('org-visible project: role-less member gets reviewed only; assigned project 404s them', async () => {
    const member = (await get('memberA', '/api/reports?projectId=p_org')).json();
    expect(member.map((r: { id: string }) => r.id)).toEqual([repOrgRev]);
    expect((await get('memberA', '/api/reports?projectId=p_assigned')).statusCode).toBe(404);
    expect((await get('outsiderB', '/api/reports?projectId=p_assigned')).statusCode).toBe(404);
    expect((await get('pmA', '/api/reports')).statusCode).toBe(400); // param required
  });
});

describe('upload scoping (§6.1)', () => {
  function multipart(manifest: unknown, photo: { field: string; data: Buffer }) {
    const b = '----fr-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify(manifest)}\r\n`,
      ),
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="${photo.field}"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      photo.data,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    return { payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
  }

  const uploadManifest = (projectId: string, walkId: string) => ({
    contractsVersion: '1.2.0',
    projectId,
    superName: 'Spoofed Name', // must be overridden by the session identity
    date: '2026-07-06',
    walkId,
    observations: [
      {
        id: `ou-${walkId}`,
        order: 0,
        createdAt: '2026-07-06T15:00:00.000Z',
        photos: [{ id: `pu-${walkId}`, width: 10, height: 10 }],
        audioField: `audio:ou-${walkId}`,
        audioMime: 'audio/webm',
      },
    ],
  });

  let jpeg: Buffer;
  beforeAll(async () => {
    jpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
  });

  const doUpload = (who: string, projectId: string, walkId: string) => {
    const m = uploadManifest(projectId, walkId);
    const { payload, headers } = multipart(m, { field: `pu-${walkId}`, data: jpeg });
    return app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...headers, ...auth(who) },
      payload,
    });
  };

  it('viewer and outsider get 403; unknown project 403', async () => {
    expect((await doUpload('viewerA', 'p_assigned', 'wu-viewer')).statusCode).toBe(403);
    expect((await doUpload('outsiderB', 'p_assigned', 'wu-outsider')).statusCode).toBe(403);
    expect((await doUpload('superA1', 'p_nope', 'wu-noproject')).statusCode).toBe(403);
  });

  it('a project super uploads: 202, created_by + superName come from the session', async () => {
    const res = await doUpload('superA1', 'p_assigned', 'wu-super');
    expect(res.statusCode).toBe(202);
    const { reportId } = res.json();
    const r = await deps.repo.getReport(reportId);
    expect(r?.createdBy).toBe('superA1');
    expect(r?.superName).toBe('Name superA1'); // spoofed manifest name overridden
  });

  it('org admin can capture without an explicit project role', async () => {
    expect((await doUpload('adminA', 'p_assigned', 'wu-admin')).statusCode).toBe(202);
  });
});

describe('media + admin surface (§6.7, §6.8)', () => {
  it('/media/* is gated by report viewability, not org-admin only (§6.7)', async () => {
    // Store real bytes under a reviewed report's key and a draft report's key.
    const px = new Uint8Array(
      await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } })
        .jpeg()
        .toBuffer(),
    );
    const revKey = `reports/${repRev}/photos/x.jpg`; // reviewed → a viewer may see it
    const draftKey = `reports/${repDraft}/photos/x.jpg`; // draft → a viewer may NOT
    await deps.storage.put(revKey, px, { contentType: 'image/jpeg' });
    await deps.storage.put(draftKey, px, { contentType: 'image/jpeg' });

    expect((await get(null, `/media/${revKey}`)).statusCode).toBe(401); // no session
    // A plain viewer can load media for a report they can view — not just org-admins.
    expect((await get('viewerA', `/media/${revKey}`)).statusCode).toBe(200);
    // …but not for a draft they can't view — 404 (not 403), so keys never leak.
    expect((await get('viewerA', `/media/${draftKey}`)).statusCode).toBe(404);
    expect((await get('adminA', `/media/${revKey}`)).statusCode).toBe(200); // org admin
    expect((await get('outsiderB', `/media/${revKey}`)).statusCode).toBe(404); // other org
    // Unknown report id → 404.
    expect((await get('adminA', '/media/reports/r-nope/photos/y.jpg')).statusCode).toBe(404);
  });

  it('/media/* accepts a signed capability URL without a session; tampered/expired 401', async () => {
    // Browsers never attach Authorization to <img>/<audio> loads — the local driver's
    // url() mints ?exp&sig, and /media honors a valid signature with NO session.
    const px = new Uint8Array(
      await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } } })
        .jpeg()
        .toBuffer(),
    );
    const key = `reports/${repRev}/photos/signed.jpg`;
    await deps.storage.put(key, px, { contentType: 'image/jpeg' });

    const u = new URL(await deps.storage.url(key));
    const signedPath = u.pathname + u.search;
    expect((await get(null, signedPath)).statusCode).toBe(200); // valid sig, no session

    // Tampered signature → falls back to the session gate → 401 anonymous.
    const sig = u.searchParams.get('sig')!;
    const badSig = sig.replace(/^./, sig[0] === '0' ? '1' : '0');
    expect(
      (await get(null, `${u.pathname}?exp=${u.searchParams.get('exp')}&sig=${badSig}`)).statusCode,
    ).toBe(401);
    // Expired exp (signature no longer covers a live window) → 401.
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    expect(
      (await get(null, `${u.pathname}?exp=${pastExp}&sig=${signMediaKey(key, pastExp)}`)).statusCode,
    ).toBe(401);
    // No sig at all + no session → 401 (the pre-existing gate, unchanged).
    expect((await get(null, u.pathname)).statusCode).toBe(401);
    // An invalid sig does NOT lock out a valid session (fallback keeps working).
    expect(
      (await get('viewerA', `${u.pathname}?exp=${u.searchParams.get('exp')}&sig=${badSig}`)).statusCode,
    ).toBe(200);
  });

  it('admin routes: 401 anonymous, 403 non-admin, static token dead when break-glass off', async () => {
    expect((await get(null, '/api/admin/reports')).statusCode).toBe(401);
    expect((await get('memberA', '/api/admin/reports')).statusCode).toBe(403);
    const stat = await app.inject({
      method: 'GET',
      url: '/api/admin/reports',
      headers: { authorization: `Bearer ${deps.config.admin.token}` },
    });
    expect(stat.statusCode).toBe(401);
  });

  it('org admin sees only their orgs; cross-org report detail 404s', async () => {
    const res = await get('adminA', '/api/admin/reports');
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((r: { id: string }) => r.id);
    expect(ids).toContain(repDraft);
    expect(ids).toContain(repOrgRev);
    expect(ids).not.toContain(repB);

    expect((await get('adminA', `/api/admin/reports/${repB}`)).statusCode).toBe(404);
    expect((await get('outsiderB', `/api/admin/reports/${repB}`)).statusCode).toBe(200);
    expect((await get('adminA', '/api/admin/metrics')).statusCode).toBe(200);
  });

  it('break-glass superadmin works only when enabled, and is unscoped', async () => {
    const bgDeps = await buildTestDeps({
      admin: { token: 'bg-secret', breakGlass: true },
    } as Partial<import('../src/config.js').AppConfig>);
    const bgApp = await buildApp(bgDeps);
    await bgApp.ready();
    try {
      const res = await bgApp.inject({
        method: 'GET',
        url: '/api/admin/reports',
        headers: { authorization: 'Bearer bg-secret' },
      });
      expect(res.statusCode).toBe(200); // fresh empty DB → empty, but the gate opened
      expect(res.json()).toEqual([]);
      const media = await bgApp.inject({
        method: 'GET',
        url: '/media/nope.jpg',
        headers: { authorization: 'Bearer bg-secret' },
      });
      expect(media.statusCode).toBe(404); // past the gate, key missing
    } finally {
      await bgApp.close();
    }
  });
});
