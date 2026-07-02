/**
 * Request auth context (auth plan §4.1): a global preHandler resolves the
 * `Authorization: Bearer <session token>` header into `req.auth = { userId, user }`.
 * It NEVER rejects — absent/invalid tokens just leave req.auth null (public routes keep
 * working; Phase 4 adds the guards). `requireAuth` is the opt-in 401 guard for routes
 * that need a signed-in user. The static admin token shares the same header but is not a
 * session — it resolves to null here and /api/admin/* keeps its own preHandler check.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PublicUser } from '@fieldreport/contracts';
import type { Repo } from '../db/types.js';
import type { SessionManager } from './sessions.js';

export interface AuthContext {
  userId: string;
  user: PublicUser;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

/** Extract the bearer token from a request (also used by logout to revoke itself). */
export function bearerToken(req: FastifyRequest): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  return m ? m[1]!.trim() : null;
}

export function registerAuthContext(
  app: FastifyInstance,
  opts: { repo: Repo; sessions: SessionManager },
): void {
  app.decorateRequest('auth', null);
  app.addHook('preHandler', async (req) => {
    req.auth = null;
    const token = bearerToken(req);
    if (!token) return;
    const userId = await opts.sessions.resolve(token);
    if (!userId) return;
    const user = await opts.repo.getUserById(userId);
    if (!user) return;
    req.auth = { userId, user: { id: user.id, email: user.email, name: user.name } };
  });
}

/** Route-level guard: 401 when no valid session. Attach as a preHandler. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.auth) {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}
