/**
 * Session management (auth plan §4.1, T-1): opaque bearer tokens, persisted server-side
 * (sessions.id IS the token) so revoke is a row update. SESSION_TTL_DAYS=0 → indefinite
 * sessions (expires_at = null, D-2 "stay logged in indefinitely"); logout revokes.
 */
import type { AppConfig } from '../config.js';
import type { Repo } from '../db/types.js';
import { secretToken } from '../ids.js';

export interface SessionManager {
  /** Mint + persist a session; returns the bearer token the SPA stores. */
  issue(userId: string): Promise<string>;
  /** Token → userId, or null when unknown/revoked/expired. Touches last_seen_at
   *  (throttled so hot sessions don't write on every request). */
  resolve(token: string): Promise<string | null>;
  revoke(token: string): Promise<void>;
}

const TOUCH_INTERVAL_MS = 5 * 60_000;
/** Above this, stale touch-throttle entries get swept. Entries older than the touch
 *  interval are safe to drop — the worst case is one extra last_seen write. */
const TOUCH_MAP_SWEEP_SIZE = 10_000;

export function makeSessions(repo: Repo, config: AppConfig): SessionManager {
  // In-memory throttle for last_seen_at writes. Per-process is fine: it's an
  // optimization, not correctness — a restart just means one extra write per session.
  const lastTouched = new Map<string, number>();

  const sweepIfLarge = () => {
    if (lastTouched.size <= TOUCH_MAP_SWEEP_SIZE) return;
    const cutoff = Date.now() - TOUCH_INTERVAL_MS;
    for (const [tok, at] of lastTouched) if (at < cutoff) lastTouched.delete(tok);
  };

  return {
    async issue(userId) {
      const token = secretToken('ses');
      const ttlDays = config.auth.sessionTtlDays;
      const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 86_400_000) : null;
      await repo.createSession({ id: token, userId, expiresAt });
      return token;
    },

    async resolve(token) {
      if (!token) return null;
      const s = await repo.getSession(token);
      // Dead tokens (unknown / revoked out-of-band / expired) also evict their throttle
      // entry so the Map tracks only live sessions instead of leaking one per token ever
      // resolved for the life of the process.
      if (!s || s.revokedAt || (s.expiresAt && s.expiresAt.getTime() < Date.now())) {
        lastTouched.delete(token);
        return null;
      }
      const last = lastTouched.get(token) ?? 0;
      if (Date.now() - last > TOUCH_INTERVAL_MS) {
        lastTouched.set(token, Date.now());
        sweepIfLarge();
        // last_seen_at is a pure optimization (§4.1): NEVER let a transient failure of this
        // write reject resolve() — the session is already proven valid above, and rejecting
        // here would (via context.ts's catch) demote a live session to an anonymous 401.
        try {
          await repo.touchSession(token);
        } catch {
          /* swallow: retried on the next request past the throttle window */
        }
      }
      return s.userId;
    },

    async revoke(token) {
      lastTouched.delete(token);
      await repo.revokeSession(token);
    },
  };
}
