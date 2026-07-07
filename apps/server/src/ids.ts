/**
 * Deterministic ids + mime helpers shared across ingest, pipeline, and storage so the
 * upload stays idempotent: the same walkId always maps to the same reportId and the
 * same storage keys, so a retried upload overwrites rather than duplicating.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function reportIdForWalk(walkId: string): string {
  const h = createHash('sha256').update(walkId).digest('hex').slice(0, 20);
  return `r-${h}`;
}

/** Random id for the auth/tenancy entities (T-6): `newId('org')` -> `org_<uuid-hex>`.
 *  Reports keep the deterministic r-<sha256> above (idempotency); everything new is random. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

/** 256-bit capability token: `secretToken('ses')` -> `ses_<43 base64url chars>`. The single
 *  source for the entropy/encoding of every secret bearer (sessions `ses_`, invitations
 *  `inv_`, recipient share links `rsr_`), so a future strength bump lands everywhere at once.
 *  Distinct from newId: these are unguessable secrets, not just unique identifiers. */
export function secretToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

/** Canonical email normalization: the users table's unique index is on lower(email), so
 *  every producer (repo writes, signup response, comparisons) must agree on this exact rule. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Map a recorded audio mime to a file extension for the storage key. */
export function audioExtForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}
