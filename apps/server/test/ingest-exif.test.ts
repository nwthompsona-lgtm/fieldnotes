import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizePhoto } from '../src/ingest/index.js';

describe('normalizePhoto (EXIF orientation — spec §9)', () => {
  it('auto-rotates a sideways photo so dimensions reflect the corrected orientation', async () => {
    // 120x60 image tagged orientation=6 (rotate 90° CW on display).
    const sideways = await sharp({
      create: { width: 120, height: 60, channels: 3, background: { r: 100, g: 120, b: 110 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const out = await normalizePhoto(new Uint8Array(sideways));
    // After EXIF correction the visual orientation is applied: 120x60 -> 60x120.
    expect(out.width).toBe(60);
    expect(out.height).toBe(120);
    expect(out.bytes.byteLength).toBeGreaterThan(0);
  });

  it('caps very large images to the 2000px bound', async () => {
    const huge = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const out = await normalizePhoto(new Uint8Array(huge));
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2000);
  });
});
