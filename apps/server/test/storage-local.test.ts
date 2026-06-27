import { describe, it, expect } from 'vitest';
import { rm } from 'node:fs/promises';
import { LocalDiskDriver } from '../src/storage/local.js';
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

    expect(await s.url(key)).toBe('http://localhost:8787/media/reports/r-test/photos/p1.jpg');
  });

  it('rejects path-traversal keys', async () => {
    const s = new LocalDiskDriver(cfg);
    await expect(s.put('../escape.txt', new Uint8Array([1]), { contentType: 'text/plain' })).rejects.toThrow();
  });
});
