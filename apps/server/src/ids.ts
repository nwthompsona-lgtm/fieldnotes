/**
 * Deterministic ids + mime helpers shared across ingest, pipeline, and storage so the
 * upload stays idempotent: the same walkId always maps to the same reportId and the
 * same storage keys, so a retried upload overwrites rather than duplicating.
 */
import { createHash, randomUUID } from 'node:crypto';

export function reportIdForWalk(walkId: string): string {
  const h = createHash('sha256').update(walkId).digest('hex').slice(0, 20);
  return `r-${h}`;
}

/** Random id for the auth/tenancy entities (T-6): `newId('org')` -> `org_<uuid-hex>`.
 *  Reports keep the deterministic r-<sha256> above (idempotency); everything new is random. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
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
