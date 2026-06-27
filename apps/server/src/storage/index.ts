import type { AppConfig } from '../config.js';
import type { StorageDriver } from './types.js';
import { LocalDiskDriver } from './local.js';
import { S3Driver } from './s3.js';

export function makeStorage(cfg: AppConfig): StorageDriver {
  return cfg.storage.driver === 's3' ? new S3Driver(cfg) : new LocalDiskDriver(cfg);
}

export { storageKeys } from './types.js';
export type { StorageDriver } from './types.js';
