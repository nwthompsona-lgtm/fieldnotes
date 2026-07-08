/**
 * Local-disk storage driver (dev/test). Writes under config.storage.localDir with a
 * `.ct` sidecar per object so content types round-trip. URLs point back at the server's
 * /media route (absolute, using publicBaseUrl) and carry a short-lived HMAC signature —
 * browsers never attach an Authorization header to <img>/<audio> loads, so the URL
 * itself must be the capability (mirroring how the S3/R2 driver hands out signed URLs).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { AppConfig } from '../config.js';
import type { PutOptions, StorageDriver, StorageObject } from './types.js';

// ── Signed /media capability URLs (review F4) ─────────────────────────────────
// Per-boot secret: signatures die on restart, which is acceptable — clients re-fetch
// report JSON and get freshly signed URLs. ~6h lifetime comfortably covers a review
// session while keeping a leaked URL short-lived.
const MEDIA_URL_TTL_SECONDS = 6 * 60 * 60;
const mediaUrlSecret = randomBytes(32);

/** Hex HMAC-SHA256 over `${key}:${exp}` (exp = unix SECONDS) with the per-boot secret. */
export function signMediaKey(key: string, exp: number): string {
  return createHmac('sha256', mediaUrlSecret).update(`${key}:${exp}`).digest('hex');
}

/** Constant-time signature check for the /media route. False on expiry, tampering, or a
 *  malformed exp/sig — never throws. timingSafeEqual (length-guarded) so the comparison
 *  is not a byte-by-byte prefix-match timing oracle. */
export function verifyMediaSignature(key: string, exp: number, sig: string): boolean {
  if (!Number.isInteger(exp) || exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(signMediaKey(key, exp), 'hex');
  // Non-hex/odd-length input decodes short → length mismatch → false.
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local-disk';
  private base: string;
  private publicBaseUrl: string;

  constructor(cfg: AppConfig) {
    this.base = resolve(process.cwd(), cfg.storage.localDir);
    this.publicBaseUrl = cfg.publicBaseUrl;
  }

  private pathFor(key: string): string {
    const p = resolve(this.base, key);
    if (p !== this.base && !p.startsWith(this.base + sep)) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    return p;
  }

  async put(key: string, bytes: Uint8Array, opts: PutOptions): Promise<string> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    await writeFile(`${p}.ct`, opts.contentType, 'utf8');
    return key;
  }

  async get(key: string): Promise<StorageObject> {
    const p = this.pathFor(key);
    const bytes = new Uint8Array(await readFile(p));
    let contentType = 'application/octet-stream';
    try {
      contentType = (await readFile(`${p}.ct`, 'utf8')).trim() || contentType;
    } catch {
      /* no sidecar — fall back to octet-stream */
    }
    return { bytes, contentType };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const p = this.pathFor(key);
    await rm(p, { force: true }); // force => no error if missing
    await rm(`${p}.ct`, { force: true });
  }

  async url(key: string): Promise<string> {
    // Short-lived signed capability URL: /media verifies exp+sig WITHOUT a session, so
    // <img>/<audio> tags (which can't send Authorization) work on the local driver too.
    const exp = Math.floor(Date.now() / 1000) + MEDIA_URL_TTL_SECONDS;
    const sig = signMediaKey(key, exp);
    return `${this.publicBaseUrl}/media/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`;
  }
}
