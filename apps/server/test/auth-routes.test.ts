/**
 * Phase 3 auth core (AUTH_MULTITENANCY_PLAN.md §4): signup/login/logout/me over a real
 * Fastify app (app.inject — no port), hermetic deps (in-memory pglite, mock providers,
 * local storage config). Also verifies the §11 CORS allowlist swap and that existing
 * routes remain unguarded (guards land in Phase 4).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/db/schema.js';
import { ensureSchema } from '../src/db/migrate.js';
import { makeRepo } from '../src/db/repo.js';
import { makeStorage } from '../src/storage/index.js';
import { makeTranscriber } from '../src/stt/index.js';
import { makeSynthesizer } from '../src/synthesis/index.js';
import { makeSessions } from '../src/auth/sessions.js';
import { buildApp } from '../src/app.js';
import { config, type AppConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import type { ServerDeps } from '../src/deps.js';

/** Hermetic deps: in-memory DB, local-disk storage config, forced mocks — never the
 *  real Neon/R2/API keys that may sit in .env on this machine. */
async function buildTestDeps(overrides?: Partial<AppConfig>): Promise<ServerDeps> {
  const cfg = {
    ...config,
    db: { ...config.db, url: undefined },
    storage: { ...config.storage, driver: 'local', localDir: '.data/test-auth-storage' },
    stt: { ...config.stt, provider: 'mock' },
    synthesis: { ...config.synthesis, provider: 'mock' },
    auth: { sessionTtlDays: 0 },
    cors: { allowedOrigins: [] },
    ...overrides,
  } as AppConfig;
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await ensureSchema(db);
  const repo = makeRepo(db);
  return {
    config: cfg,
    db,
    repo,
    storage: makeStorage(cfg),
    transcriber: makeTranscriber(cfg),
    synthesizer: makeSynthesizer(cfg),
    sessions: makeSessions(repo, cfg),
  };
}

let deps: ServerDeps;
let app: FastifyInstance;

beforeAll(async () => {
  deps = await buildTestDeps();
  app = await buildApp(deps);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const signupBody = {
  email: 'Jake@Example.com',
  password: 'hunter2hunter2',
  name: 'Jake Romero',
  orgName: 'Romero Builds',
};

let firstToken: string;

describe('POST /api/auth/signup', () => {
  it('creates user + org + admin membership and issues a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupBody });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^ses_/);
    expect(body.user).toMatchObject({ email: 'jake@example.com', name: 'Jake Romero' });
    expect(body.user.passwordHash).toBeUndefined(); // PublicUser only
    expect(body.orgs).toHaveLength(1);
    expect(body.orgs[0]).toMatchObject({ name: 'Romero Builds', role: 'admin' });
    firstToken = body.token;
  });

  it('rejects a duplicate email with 409 (case-insensitive)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { ...signupBody, email: 'JAKE@EXAMPLE.COM', orgName: 'Other Org' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an invalid body with 400 (short password)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { ...signupBody, email: 'new@example.com', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('rejects a wrong password with a generic 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: signupBody.email, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid credentials' });
  });

  it('rejects an unknown email with the same generic 401 (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'whatever1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid credentials' });
  });

  it('issues a fresh session on good credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      // Different case than signup — zod's .email() rejects stray whitespace with 400
      // (contract-level), so case-insensitivity is what the repo normalization covers.
      payload: { email: 'JAKE@example.COM', password: signupBody.password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toMatch(/^ses_/);
    expect(body.token).not.toBe(firstToken);
    expect(body.orgs[0]).toMatchObject({ name: 'Romero Builds', role: 'admin' });
  });
});

describe('GET /api/auth/me + POST /api/auth/logout', () => {
  it('401s without a token and with a garbage token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { authorization: 'Bearer ses_garbage' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('returns the current user + orgs with a valid session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('jake@example.com');
    expect(res.json().orgs[0].role).toBe('admin');
  });

  it('logout revokes the session; the token is dead afterwards', async () => {
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${firstToken}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('logout without a session is itself a 401', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(401);
  });
});

describe('session lifetime (§4.3)', () => {
  it('SESSION_TTL_DAYS=0 → indefinite (expires_at null); >0 → concrete expiry', async () => {
    // The app-wide manager runs with ttl 0 — check the row of a live token.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: signupBody.email, password: signupBody.password },
    });
    const token: string = login.json().token;
    expect((await deps.repo.getSession(token))?.expiresAt).toBeNull();

    // A ttl-7 manager over the same repo stamps a real expiry.
    const ttlSessions = makeSessions(deps.repo, {
      ...deps.config,
      auth: { sessionTtlDays: 7 },
    } as AppConfig);
    const userId = (await deps.repo.getUserByEmail(signupBody.email))!.id;
    const ttlToken = await ttlSessions.issue(userId);
    const row = await deps.repo.getSession(ttlToken);
    expect(row?.expiresAt).toBeInstanceOf(Date);
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('an expired session no longer authenticates', async () => {
    const userId = (await deps.repo.getUserByEmail(signupBody.email))!.id;
    await deps.repo.createSession({
      id: 'ses_expired',
      userId,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer ses_expired' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('existing routes stay unguarded (guards are Phase 4)', () => {
  it('healthz and report reads work without any session', async () => {
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    // Unknown report → 404 (not 401): the route ran, no guard intercepted.
    const report = await app.inject({ method: 'GET', url: '/api/reports/r-nope' });
    expect(report.statusCode).toBe(404);
  });
});

describe('CORS allowlist (§11)', () => {
  it('empty allowlist stays permissive (origin: true reflects any origin)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://anywhere.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://anywhere.example');
  });

  it('with an allowlist, allowed origins reflect and others get no CORS header', async () => {
    const gated = await buildApp(
      await buildTestDeps({
        cors: { allowedOrigins: ['https://capture-dev.example', 'https://web-dev.example'] },
      } as Partial<AppConfig>),
    );
    await gated.ready();
    try {
      const ok = await gated.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'https://web-dev.example' },
      });
      expect(ok.headers['access-control-allow-origin']).toBe('https://web-dev.example');

      const blocked = await gated.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'https://evil.example' },
      });
      expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await gated.close();
    }
  });
});
