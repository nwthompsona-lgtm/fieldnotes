/**
 * Auth endpoints (auth plan §4.2): signup / login / logout / me. Signup is self-serve
 * onboarding (D-5): creates the user + their org + an admin membership in one
 * transaction, then issues a session. Login is generic-401 on any failure (no
 * user-enumeration — including by timing; see DUMMY_HASH). Passwords are never logged;
 * PublicUser is the only user shape returned.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SignupRequest, LoginRequest, type AuthResponse, type Me } from '@fieldreport/contracts';
import type { ServerDeps } from '../deps.js';
import type { UserRow } from '../db/types.js';
import { newId } from '../ids.js';
import { hash, verify } from './passwords.js';
import { bearerToken, requireAuth } from './context.js';

// Basic per-IP fixed-window throttle on the credential endpoints (§11; ops upgrade
// path: @fastify/rate-limit behind a real store once there's more than one instance).
// req.ip is the real client because app.ts sets trustProxy.
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 30;
/** Above this, expired windows get swept so rotating-IP sweeps can't grow the Map forever. */
const BUCKETS_SWEEP_SIZE = 10_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Shared by the invitation routes (§4.2 rate-limits signup/login/accept alike). */
export async function throttle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = `${req.ip}:${req.routeOptions.url ?? req.url}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    if (buckets.size > BUCKETS_SWEEP_SIZE) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  b.count += 1;
  if (b.count > MAX_ATTEMPTS) {
    await reply.code(429).send({ error: 'too many attempts, try again later' });
  }
}

/** Real argon2 hash of a random throwaway secret. Login verifies against this when the
 *  account doesn't exist (or has no password), so unknown emails cost the same ~100ms
 *  as wrong passwords — otherwise response timing is a user-enumeration oracle. */
const DUMMY_HASH = hash(`dummy-${newId('tmg')}`);

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '23505' || /unique|duplicate key/i.test(e?.message ?? '');
};

export function registerAuthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, sessions } = deps;

  const publicUser = (user: UserRow) => ({ id: user.id, email: user.email, name: user.name });

  app.post('/api/auth/signup', { preHandler: throttle }, async (req, reply) => {
    const parsed = SignupRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid signup', issues: parsed.error.issues });
    }
    const { email, password, name, orgName } = parsed.data;

    if (await repo.getUserByEmail(email)) {
      return reply.code(409).send({ error: 'email already registered' });
    }
    const userId = newId('usr');
    const orgId = newId('org');
    try {
      // One transaction: a mid-sequence failure can't strand an org-less account
      // whose email is then permanently blocked by the duplicate check above.
      await repo.createUserWithOrg({
        user: { id: userId, email, name, passwordHash: await hash(password) },
        org: { id: orgId, name: orgName },
        membership: { id: newId('mem'), orgRole: 'admin' },
      });
    } catch (err) {
      // Only the lower(email) unique-index race is a 409; anything else (transient DB
      // failure) must surface as a 500, not tell the user their free email is taken.
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'email already registered' });
      }
      req.log.error({ err }, 'signup failed');
      return reply.code(500).send({ error: 'signup failed, please retry' });
    }

    const token = await sessions.issue(userId);
    const body: AuthResponse = {
      token,
      // All fields are in hand — no re-fetch. Email mirrors the repo's normalization.
      user: { id: userId, email: email.trim().toLowerCase(), name },
      orgs: [{ id: orgId, name: orgName, role: 'admin' }],
    };
    return reply.code(201).send(body);
  });

  app.post('/api/auth/login', { preHandler: throttle }, async (req, reply) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid login', issues: parsed.error.issues });
    }
    const { email, password } = parsed.data;

    // Same generic 401 for unknown email, no password set, and wrong password — and the
    // same argon2 cost for all three (verify against DUMMY_HASH when there's no real one).
    const user = await repo.getUserByEmail(email);
    const ok = await verify(user?.passwordHash ?? (await DUMMY_HASH), password);
    if (!user?.passwordHash || !ok) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    const token = await sessions.issue(user.id);
    const body: AuthResponse = {
      token,
      user: publicUser(user),
      orgs: await repo.listOrgsForUser(user.id),
    };
    return body;
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    const token = bearerToken(req);
    if (token) await sessions.revoke(token);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const body: Me = {
      user: req.auth!.user,
      orgs: await repo.listOrgsForUser(req.auth!.userId),
    };
    return body;
  });
}
