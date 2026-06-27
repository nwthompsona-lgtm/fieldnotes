// Compress-on-capture (spec §4). The moment a photo is taken we compress it to
// jpeg (~1600px max dim, ~0.7 quality) so the bytes that land in IndexedDB are
// already small and upload-ready. We also capture the natural pixel dimensions
// of the COMPRESSED output (what the server records as width/height).

import imageCompression from 'browser-image-compression';
import { IMAGE_MAX_DIMENSION, IMAGE_QUALITY } from '../config';

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  byteSize: number;
}

/** Read a blob's natural pixel dimensions. */
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

export async function compressForCapture(file: File | Blob): Promise<CompressedImage> {
  const input =
    file instanceof File ? file : new File([file], 'capture.jpg', { type: file.type || 'image/jpeg' });

  const compressed = await imageCompression(input, {
    maxWidthOrHeight: IMAGE_MAX_DIMENSION,
    initialQuality: IMAGE_QUALITY,
    fileType: 'image/jpeg',
    useWebWorker: true,
    // Never UPSIZE a small image; just re-encode.
    alwaysKeepResolution: false,
  });

  const blob: Blob = compressed;
  const { width, height } = await readDimensions(blob);
  return { blob, width, height, byteSize: blob.size };
}
