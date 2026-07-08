// Compress-on-capture (spec §4). The moment a photo is taken we compress it to
// jpeg (~1600px max dim, ~0.7 quality) so the bytes that land in IndexedDB are
// already small and upload-ready. We also capture the natural pixel dimensions
// of the COMPRESSED output (what the server records as width/height).
//
// OFFLINE-CRITICAL: compression runs on the MAIN THREAD (useWebWorker:false).
// The library's web-worker build fetches its own code at runtime via
// `importScripts("https://cdn.jsdelivr.net/npm/browser-image-compression@.../dist/...")`,
// which hangs forever when the device is offline — silently stranding the capture
// ("Saving…" with no photo ever written). On-thread compression of a single
// ~1600px JPEG is sub-second and has ZERO network dependency. Never re-enable the
// worker without first self-hosting that script.

import imageCompression from 'browser-image-compression';
import { IMAGE_MAX_DIMENSION, IMAGE_QUALITY } from '../config';

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  byteSize: number;
}

// Hard ceiling so a pathological image can never strand a capture on the spinner.
const COMPRESS_TIMEOUT_MS = 15_000;

/** Positive integer dimensions. The upload contract requires width/height > 0, so a
 *  decode hiccup must round up to 1 rather than emit a 0 that fails upload validation. */
const posInt = (n: number): number => Math.max(1, Math.round(n || 0));

/** Reject `p` if it hasn't settled within `ms`. Clears the timer on settle. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('compression timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Read a blob's natural pixel dimensions. Local-only (no network). */
async function readDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  // createImageBitmap is the cheapest path and is supported on iOS 15+.
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      const dims = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return dims;
    } catch {
      // fall through to <img> decode
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Dimensions that never throw and are always upload-valid (positive ints). */
async function safeDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const { width, height } = await readDimensions(blob);
    return { width: posInt(width), height: posInt(height) };
  } catch {
    // Undecodable bytes — keep the capture anyway; 1×1 is a harmless placeholder that
    // still satisfies the contract's width/height > 0 rule so the walk can upload.
    return { width: 1, height: 1 };
  }
}

async function measure(blob: Blob): Promise<CompressedImage> {
  const { width, height } = await safeDimensions(blob);
  return { blob, width, height, byteSize: blob.size };
}

export async function compressForCapture(file: File | Blob): Promise<CompressedImage> {
  const input =
    file instanceof File ? file : new File([file], 'capture.jpg', { type: file.type || 'image/jpeg' });

  try {
    const compressed = await withTimeout(
      imageCompression(input, {
        maxWidthOrHeight: IMAGE_MAX_DIMENSION,
        initialQuality: IMAGE_QUALITY,
        fileType: 'image/jpeg',
        useWebWorker: false, // see file header — the worker build phones a CDN and hangs offline
        // Never UPSIZE a small image; just re-encode.
        alwaysKeepResolution: false,
      }),
      COMPRESS_TIMEOUT_MS,
    );
    return await measure(compressed);
  } catch {
    // Durability beats perfect compression (spec §4): if compression fails or times out,
    // persist the ORIGINAL bytes so the observation is never lost. The only cost is a
    // larger upload for this one photo; the server still ingests a full-size JPEG.
    const original =
      input.type === 'image/jpeg' ? input : new File([input], 'capture.jpg', { type: 'image/jpeg' });
    return measure(original);
  }
}
