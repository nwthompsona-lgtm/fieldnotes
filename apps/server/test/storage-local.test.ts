import { describe, it, expect } from 'vitest';
import { rm } from 'node:fs/promises';
import { LocalDiskDriver, signMediaKey, verifyMediaSignature } from '../src/storage/local.js';
import type { AppConfig } from '../src/config.js';

const cfg = {
  storage: { localDir: '.data/test-storage' },
  publicBaseUrl: 'http://localhost:8787',
} as unknown as AppConfig;

describe('LocalDiskDriver', () => {
  it('round-trips bytes + content type, reports existence, and builds a media URL', async () => {
    await rm('.data/test-storage', { recursive: true, force: true });
    const s = new LocalDiskDriver(cfg);
    const key = 'reports/r-test/photos/p1.jpg';
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    expect(await s.exists(key)).toBe(false);
    await s.put(key, bytes, { contentType: 'image/jpeg' });
    expect(await s.exists(key)).toBe(true);

    const got = await s.get(key);
    expect(Array.from(got.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(got.contentType).toBe('image/jpeg');

    // URLs are signed capabilities now (browsers can't send Authorization on <img>):
    // /media/<key>?exp=<unix seconds ~6h out>&sig=<hex hmac>, verifiable without a session.
    const url = new URL(await s.url(key));
    expect(url.origin).toBe('http://localhost:8787');
    expect(url.pathname).toBe('/media/reports/r-test/photos/p1.jpg');
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    expect(exp * 1000).toBeGreaterThan(Date.now()); // in the future…
    expect(exp * 1000).toBeLessThanOrEqual(Date.now() + 7 * 3600 * 1000); // …but bounded (~6h)
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyMediaSignature(key, exp, sig)).toBe(true);
  });

  it('rejects tampered, expired, and malformed media signatures', () => {
    const key = 'reports/r-test/photos/p1.jpg';
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signMediaKey(key, exp);

    expect(verifyMediaSignature(key, exp, sig)).toBe(true);
    // Tampered signature / signature for a DIFFERENT key.
    expect(verifyMediaSignature(key, exp, sig.replace(/^./, sig[0] === '0' ? '1' : '0'))).toBe(false);
    expect(verifyMediaSignature('reports/r-test/photos/p2.jpg', exp, sig)).toBe(false);
    // Expired: a signature that WAS valid for a past exp must not verify.
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(verifyMediaSignature(key, past, signMediaKey(key, past))).toBe(false);
    // Malformed exp/sig never throw — they just fail.
    expect(verifyMediaSignature(key, Number.NaN, sig)).toBe(false);
    expect(verifyMediaSignature(key, exp, 'not-hex')).toBe(false);
    expect(verifyMediaSignature(key, exp, '')).toBe(false);
  });

  it('rejects path-traversal keys', async () => {
    const s = new LocalDiskDriver(cfg);
    await expect(s.put('../escape.txt', new Uint8Array([1]), { contentType: 'text/plain' })).rejects.toThrow();
  });
});
