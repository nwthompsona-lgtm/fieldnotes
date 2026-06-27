/**
 * Object-storage seam. Media (photos, audio, rendered html/pdf) lives here, keyed by
 * an opaque storage key. Dev/test = LocalDiskDriver (under .data/); prod = S3Driver
 * (@aws-sdk/client-s3, works against S3 or Cloudflare R2). Selected by env.
 */
export interface PutOptions {
  contentType: string;
  /** Cache-Control for hosted artifacts (html/pdf). */
  cacheControl?: string;
}

export interface StorageObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface StorageDriver {
  readonly name: string;
  /** Store bytes under `key`; returns the key. Overwrites are allowed (idempotent). */
  put(key: string, bytes: Uint8Array, opts: PutOptions): Promise<string>;
  get(key: string): Promise<StorageObject>;
  exists(key: string): Promise<boolean>;
  /** A URL the app can serve/redirect to. For local driver this is `/media/:key`
   *  (served by the server); for S3/R2 it may be a signed URL. */
  url(key: string): Promise<string>;
}

/** Canonical key helpers so every module derives the same keys. */
export const storageKeys = {
  photo: (reportId: string, photoId: string) => `reports/${reportId}/photos/${photoId}.jpg`,
  audio: (reportId: string, obsId: string, ext: string) =>
    `reports/${reportId}/audio/${obsId}.${ext}`,
  html: (reportId: string) => `reports/${reportId}/report.html`,
  pdf: (reportId: string) => `reports/${reportId}/report.pdf`,
};
