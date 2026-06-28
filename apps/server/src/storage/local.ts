/**
 * Local-disk storage driver (dev/test). Writes under config.storage.localDir with a
 * `.ct` sidecar per object so content types round-trip. URLs point back at the server's
 * /media route (absolute, using publicBaseUrl).
 */
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { AppConfig } from '../config.js';
import type { PutOptions, StorageDriver, StorageObject } from './types.js';

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
    return `${this.publicBaseUrl}/media/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}
