/**
 * S3-compatible storage driver (prod). Works against AWS S3 or Cloudflare R2 (set
 * S3_ENDPOINT for R2). If S3_PUBLIC_BASE_URL is set (public bucket / CDN), url() returns
 * a direct URL; otherwise it returns a short-lived signed GET URL.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config.js';
import type { PutOptions, StorageDriver, StorageObject } from './types.js';

async function streamToBytes(body: unknown): Promise<Uint8Array> {
  // Node stream
  const anyBody = body as { transformToByteArray?: () => Promise<Uint8Array> } & AsyncIterable<Uint8Array>;
  if (typeof anyBody?.transformToByteArray === 'function') {
    return anyBody.transformToByteArray();
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of anyBody) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export class S3Driver implements StorageDriver {
  readonly name = 's3';
  private client: S3Client;
  private bucket: string;
  private publicBaseUrl?: string;

  constructor(cfg: AppConfig) {
    const s = cfg.storage.s3;
    if (!s.bucket) throw new Error('S3_BUCKET is required for the s3 storage driver');
    this.bucket = s.bucket;
    this.publicBaseUrl = s.publicBaseUrl?.replace(/\/$/, '');
    this.client = new S3Client({
      region: s.region,
      endpoint: s.endpoint,
      forcePathStyle: Boolean(s.endpoint), // R2 / minio need path-style
      credentials:
        s.accessKeyId && s.secretAccessKey
          ? { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey }
          : undefined,
    });
  }

  async put(key: string, bytes: Uint8Array, opts: PutOptions): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl,
      }),
    );
    return key;
  }

  async get(key: string): Promise<StorageObject> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await streamToBytes(res.Body);
    return { bytes, contentType: res.ContentType ?? 'application/octet-stream' };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async url(key: string): Promise<string> {
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${key}`;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 3600 },
    );
  }
}
