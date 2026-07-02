/**
 * Auth endpoints (auth plan §4.2): signup / login / logout / me. Signup is self-serve
 * onboarding (D-5): creates the user + their org + an admin membership, then issues a
 * session. Login is generic-401 on any failure (no user-enumeration). Passwords are
 * never logged; PublicUser is the only user shape returned.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SignupRequest, LoginRequest, type AuthResponse, type Me } from '@fieldreport/contracts';
import type { ServerDeps } from '../deps.js';
import { newId } from '../ids.js';
import { hash, verify } from './passwords.js';
import { bearerToken, requireAuth } from './context.js';

// Basic per-IP fixed-window throttle on the credential endpoints (§11; ops upgrade
// path: @fastify/rate-limit behind a real store once there's more than one instance).
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 30;
const buckets = new Map<string, { count: number; resetAt: number }>();

async function throttle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = `${req.ip}:${req.routeOptions.url ?? req.url}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  b.count += 1;
  if (b.count > MAX_ATTEMPTS) {
    await reply.code(429).send({ error: 'too many attempts, try again later' });
  }
}

export function registerAuthRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, sessions } = deps;

  const authResponse = async (userId: string): Promise<Omit<AuthResponse, 'token'>> => {
    const user = await repo.getUserById(userId);
    return {
      user: { id: user!.id, email: user!.email, name: user!.name },
      orgs: await repo.listOrgsForUser(userId),
    };
  };

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
    try {
      await repo.createUser({ id: userId, email, name, passwordHash: await hash(password) });
    } catch {
      // Unique-index race on lower(email) — same outcome as the check above.
      return reply.code(409).send({ error: 'email already registered' });
    }
    const orgId = newId('org');
    await repo.createOrg({ id: orgId, name: orgName });
    await repo.addMembership({ id: newId('mem'), userId, orgId, orgRole: 'admin' });

    const token = await sessions.issue(userId);
    const body: AuthResponse = { token, ...(await authResponse(userId)) };
    return reply.code(201).send(body);
  });

  app.post('/api/auth/login', { preHandler: throttle }, async (req, reply) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid login', issues: parsed.error.issues });
    }
    const { email, password } = parsed.data;

    // Same generic 401 for unknown email, no password set, and wrong password.
    const user = await repo.getUserByEmail(email);
    if (!user?.passwordHash || !(await verify(user.passwordHash, password))) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    const token = await sessions.issue(user.id);
    const body: AuthResponse = { token, ...(await authResponse(user.id)) };
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
