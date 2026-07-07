/**
 * Auth endpoints (auth plan §4.2): signup / login / logout / me. Signup is self-serve
 * onboarding (D-5): creates the user + their org + an admin membership in one
 * transaction, then issues a session. Login is generic-401 on any failure (no
 * user-enumeration — including by timing; see dummyHash). Passwords are never logged;
 * PublicUser is the only user shape returned.
 */
import type { FastifyInstance } from 'fastify';
import { SignupRequest, LoginRequest, type AuthResponse, type Me } from '@fieldreport/contracts';
import type { ServerDeps } from '../deps.js';
import { newId, normalizeEmail } from '../ids.js';
import { isUniqueViolation } from '../db/errors.js';
import { hash, verify } from './passwords.js';
import { bearerToken, requireAuth } from './context.js';
import { throttle } from './throttle.js';
import { publicUser, buildAuthResponse } from './identity.js';

/** Real argon2 hash of a random throwaway secret, computed lazily and memoized. Login
 *  verifies against this when the account doesn't exist (or has no password), so unknown
 *  emails cost the same ~100ms as wrong passwords — otherwise response timing is a
 *  user-enumeration oracle. Lazy (not module-load) so it adds no startup cost and can't
 *  become a stored unhandled rejection; the login handler treats any verify error as a
 *  generic 401, so even a degraded argon binding never turns into an enumeration signal. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hash(`dummy-${newId('tmg')}`);
  return dummyHashPromise;
}

export function registerAuthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, sessions } = deps;

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
      user: publicUser({ id: userId, email: normalizeEmail(email), name }),
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
    // same argon2 cost for all three (verify against dummyHash when there's no real one).
    // Any verify error (e.g. a degraded argon binding) also collapses to 401, so a failure
    // never distinguishes unknown-email from wrong-password.
    const user = await repo.getUserByEmail(email);
    let ok = false;
    try {
      ok = await verify(user?.passwordHash ?? (await dummyHash()), password);
    } catch (err) {
      req.log.error({ err }, 'password verify failed');
    }
    if (!user?.passwordHash || !ok) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    return buildAuthResponse(deps, user);
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
