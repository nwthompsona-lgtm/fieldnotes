/**
 * Phase 6 invitations (AUTH_MULTITENANCY_PLAN.md §4.2): create (org admin only,
 * assignments locked to the org) → emailed accept link → accept lands the invitee
 * with the right org + project roles and a session. Expired/used tokens → 410.
 * An invite can never overwrite an ACTIVE account's credentials.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hash } from '../src/auth/passwords.js';
import { buildTestDeps, type TestDeps } from './helpers.js';

let deps: TestDeps;
let app: FastifyInstance;
let adminTok: string;
let memberTok: string;

beforeAll(async () => {
  deps = await buildTestDeps();
  app = await buildApp(deps);
  await app.ready();
  const { repo, sessions } = deps;

  await repo.createOrg({ id: 'org_i', name: 'Invite Org' });
  await repo.createOrg({ id: 'org_other', name: 'Other Org' });
  await repo.createUser({ id: 'adminI', email: 'admin@i.com', name: 'Admin I' });
  await repo.createUser({ id: 'memberI', email: 'member@i.com', name: 'Member I' });
  await repo.addMembership({ id: 'mi1', userId: 'adminI', orgId: 'org_i', orgRole: 'admin' });
  await repo.addMembership({ id: 'mi2', userId: 'memberI', orgId: 'org_i', orgRole: 'member' });
  await repo.createProject({
    id: 'p_i',
    orgId: 'org_i',
    name: 'Invite Project',
    superName: 'S',
    visibility: 'assigned',
  });
  await repo.createProject({
    id: 'p_other',
    orgId: 'org_other',
    name: 'Foreign Project',
    superName: 'S',
    visibility: 'assigned',
  });
  adminTok = await sessions.issue('adminI');
  memberTok = await sessions.issue('memberI');
});

afterAll(async () => {
  await app.close();
});

const create = (token: string | null, body: unknown) =>
  app.inject({
    method: 'POST',
    url: '/api/orgs/org_i/invitations',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: body as Record<string, unknown>,
  });

describe('create invitation', () => {
  it('org admin gets token + inviteUrl and the invite email goes out', async () => {
    const res = await create(adminTok, {
      email: 'New.Hire@Example.com',
      orgRole: 'member',
      projectAssignments: [{ projectId: 'p_i', role: 'super' }],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toMatch(/^inv_/);
    expect(body.inviteUrl).toContain(`/accept?token=${body.token}`);

    const mail = deps.email.sent.at(-1)!;
    expect(mail.to.email).toBe('New.Hire@Example.com');
    expect(mail.subject).toContain('Invite Org');
    expect(mail.html).toContain(body.inviteUrl);
  });

  it('403 for non-admin members, 401 anonymous', async () => {
    expect((await create(memberTok, { email: 'x@y.com' })).statusCode).toBe(403);
    expect((await create(null, { email: 'x@y.com' })).statusCode).toBe(401);
  });

  it("400 when an assignment references another org's project", async () => {
    const res = await create(adminTok, {
      email: 'x@y.com',
      projectAssignments: [{ projectId: 'p_other', role: 'viewer' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('p_other');
  });
});

describe('preview + accept happy path', () => {
  let inviteToken: string;

  beforeAll(async () => {
    const res = await create(adminTok, {
      email: 'crew@example.com',
      orgRole: 'member',
      projectAssignments: [{ projectId: 'p_i', role: 'super' }],
    });
    inviteToken = res.json().token;
  });

  it('preview returns org/email/role; unknown token 404', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/auth/invitations/${inviteToken}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgName: 'Invite Org', email: 'crew@example.com', orgRole: 'member' });
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/invitations/inv_nope' })).statusCode,
    ).toBe(404);
  });

  it('accept creates the user with org + project roles and a live session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/invitations/accept',
      payload: { token: inviteToken, name: 'Crew Member', password: 'crewpass123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toMatch(/^ses_/);
    expect(body.user).toMatchObject({ email: 'crew@example.com', name: 'Crew Member' });
    expect(body.orgs).toEqual([{ id: 'org_i', name: 'Invite Org', role: 'member' }]);

    const user = await deps.repo.getUserByEmail('crew@example.com');
    expect(await deps.repo.getProjectRole('p_i', user!.id)).toBe('super');

    // The issued session works.
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it('the token is single-use: preview and re-accept now 410', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/api/auth/invitations/${inviteToken}` })).statusCode,
    ).toBe(410);
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/invitations/accept',
      payload: { token: inviteToken, name: 'Crew Member', password: 'crewpass123' },
    });
    expect(again.statusCode).toBe(410);
  });
});

describe('edge cases', () => {
  it('expired invitation → 410 on preview and accept', async () => {
    await deps.repo.createInvitation({
      id: 'inv_expired',
      orgId: 'org_i',
      email: 'late@example.com',
      orgRole: 'member',
      projectAssignments: [],
      token: 'inv_tok_expired',
      invitedBy: 'adminI',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/invitations/inv_tok_expired' })).statusCode,
    ).toBe(410);
    const acc = await app.inject({
      method: 'POST',
      url: '/api/auth/invitations/accept',
      payload: { token: 'inv_tok_expired', name: 'Late', password: 'latepass123' },
    });
    expect(acc.statusCode).toBe(410);
  });

  it('pending (passwordless) user: accept activates the account', async () => {
    await deps.repo.createUser({ id: 'usr_pending', email: 'pending@example.com', name: 'Pending' });
    const inv = (await create(adminTok, { email: 'pending@example.com' })).json();
    const acc = await app.inject({
      method: 'POST',
      url: '/api/auth/invitations/accept',
      payload: { token: inv.token, name: 'Now Active', password: 'activated123' },
    });
    expect(acc.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'pending@example.com', password: 'activated123' },
    });
    expect(login.statusCode).toBe(200);
    expect((await deps.repo.getUserById('usr_pending'))?.name).toBe('Now Active');
  });

  it('ACTIVE account: invite adds the membership but never logs the token holder in', async () => {
    await deps.repo.createUser({
      id: 'usr_active',
      email: 'active@example.com',
      name: 'Original Name',
      passwordHash: await hash('originalpass1'),
    });
    const inv = (await create(adminTok, { email: 'active@example.com', orgRole: 'admin' })).json();
    const acc = await app.inject({
      method: 'POST',
      url: '/api/auth/invitations/accept',
      payload: { token: inv.token, name: 'Attacker Name', password: 'attackerpass1' },
    });
    // Membership added, but NO session is minted for the token holder (account-takeover
    // guard): the response says "log in", it carries no bearer token.
    expect(acc.statusCode).toBe(200);
    const body = acc.json();
    expect(body.requiresLogin).toBe(true);
    expect(body.email).toBe('active@example.com');
    expect(body.token).toBeUndefined();

    // The original credentials and profile stand; the attacker's password never works.
    expect((await deps.repo.getUserById('usr_active'))?.name).toBe('Original Name');
    const oldPw = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'active@example.com', password: 'originalpass1' },
    });
    expect(oldPw.statusCode).toBe(200);
    const newPw = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'active@example.com', password: 'attackerpass1' },
    });
    expect(newPw.statusCode).toBe(401);
    expect(await deps.repo.getMembership('usr_active', 'org_i')).toEqual({ orgRole: 'admin' });
  });

  it('concurrent double-accept of one fresh token is race-safe (no 500)', async () => {
    await deps.repo.createUser({ id: 'usr_pending2', email: 'race@example.com', name: 'Race' });
    const inv = (await create(adminTok, { email: 'race@example.com' })).json();
    const accept = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/invitations/accept',
        payload: { token: inv.token, name: 'Race Winner', password: 'racepass1234' },
      });
    // Fire both at once: the unique-email race must not surface as a 500. One wins with a
    // 200; the token is single-use so the other is 200 (activated) or 410 (already used).
    const [a, b] = await Promise.all([accept(), accept()]);
    expect([a.statusCode, b.statusCode].every((c) => c === 200 || c === 410)).toBe(true);
    expect(a.statusCode).not.toBe(500);
    expect(b.statusCode).not.toBe(500);
  });

  it('invalid accept body → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/invitations/accept',
      payload: { token: 'inv_x', name: '', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });
});
