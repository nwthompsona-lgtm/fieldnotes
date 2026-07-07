/**
 * Per-IP fixed-window rate limit for the credential + capability endpoints (§11):
 * signup / login / invitation-accept, and (Phase 8) the public /s/:token share links.
 * In-memory token bucket — per-process is fine for one instance; the ops upgrade path is
 * @fastify/rate-limit behind a shared store once there's more than one instance.
 *
 * Lives in its own module (not a route file) so importing the limiter never drags in a
 * route module's side effects, and every throttled surface shares ONE bucket store.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 30;
/** Above this, expired windows get swept so rotating-IP floods can't grow the Map forever. */
const BUCKETS_SWEEP_SIZE = 10_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

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
