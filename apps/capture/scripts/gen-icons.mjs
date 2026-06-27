// Self-contained PNG icon generator — NO native deps, only Node's built-in zlib.
// Draws a solid brand-green (#0F3D2E) square with white "FR" centered.
// Emits: public/icons/icon-192.png, icon-512.png, icon-512-maskable.png,
//        public/apple-touch-icon.png (180), public/favicon.ico-sized 32 (as png).
//
// We hand-rasterize the two glyphs "F" and "R" from simple rectangle/curve
// primitives so we never need a font engine. Pixels are written into an RGBA
// buffer, then encoded as a single-IDAT PNG via zlib.deflateSync.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');
const ICONS = resolve(PUBLIC, 'icons');

const BRAND = [0x0f, 0x3d, 0x2e]; // #0F3D2E deep green
const WHITE = [0xff, 0xff, 0xff];

// ---- tiny PNG encoder -----------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // add filter byte (0) at the start of each scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- rasterizer -----------------------------------------------------------
function makeIcon(size, { padRatio }) {
  const rgba = Buffer.alloc(size * size * 4);
  const setPx = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  };
  const fillRect = (x0, y0, w, h, color) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(x, y, color);
  };
  // background (full bleed — maskable safe because glyphs sit inside safe zone)
  fillRect(0, 0, size, size, BRAND);

  // Layout the "FR" wordmark inside the safe zone.
  const pad = Math.round(size * padRatio);
  const inner = size - pad * 2;
  const glyphH = Math.round(inner * 0.58);
  const stroke = Math.max(2, Math.round(glyphH * 0.16));
  const glyphW = Math.round(glyphH * 0.62);
  const gap = Math.round(glyphW * 0.34);
  const totalW = glyphW * 2 + gap;
  const x0 = Math.round((size - totalW) / 2);
  const y0 = Math.round((size - glyphH) / 2);

  // --- F ---
  const fx = x0;
  fillRect(fx, y0, stroke, glyphH, WHITE); // vertical stem
  fillRect(fx, y0, glyphW, stroke, WHITE); // top bar
  fillRect(fx, y0 + Math.round(glyphH * 0.45), Math.round(glyphW * 0.82), stroke, WHITE); // mid bar

  // --- R ---
  const rx = x0 + glyphW + gap;
  fillRect(rx, y0, stroke, glyphH, WHITE); // vertical stem
  const bowlH = Math.round(glyphH * 0.5);
  fillRect(rx, y0, glyphW, stroke, WHITE); // top bar
  fillRect(rx + glyphW - stroke, y0, stroke, bowlH, WHITE); // right side of bowl
  fillRect(rx, y0 + bowlH - stroke, glyphW, stroke, WHITE); // bottom of bowl
  // diagonal leg of the R
  const legStartY = y0 + bowlH - stroke;
  const legLen = glyphH - bowlH + stroke;
  for (let t = 0; t < legLen; t++) {
    const lx = rx + Math.round((glyphW - stroke) * (t / legLen));
    fillRect(lx, legStartY + t, stroke, 2, WHITE);
  }

  return encodePng(size, size, rgba);
}

// ---- emit -----------------------------------------------------------------
mkdirSync(ICONS, { recursive: true });
const standard = { padRatio: 0.16 };
const maskable = { padRatio: 0.22 }; // extra safe-zone padding for mask crop

const outputs = [
  [resolve(ICONS, 'icon-192.png'), makeIcon(192, standard)],
  [resolve(ICONS, 'icon-512.png'), makeIcon(512, standard)],
  [resolve(ICONS, 'icon-512-maskable.png'), makeIcon(512, maskable)],
  [resolve(PUBLIC, 'apple-touch-icon.png'), makeIcon(180, standard)],
  [resolve(PUBLIC, 'favicon-32.png'), makeIcon(32, standard)],
];
for (const [path, buf] of outputs) {
  writeFileSync(path, buf);
  console.log(`wrote ${path} (${buf.length} bytes)`);
}
console.log('icons generated.');
