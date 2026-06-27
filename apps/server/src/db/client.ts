/**
 * DB client. Prod: node-postgres over DATABASE_URL (Neon). Dev/test: embedded pglite
 * (in-process, persisted under PGLITE_DIR) so the whole pipeline runs with no DB server.
 * Both expose the same drizzle query API; the repo is identical either way.
 */
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppConfig } from '../config.js';
import * as schema from './schema.js';

export type Db = PgliteDatabase<typeof schema>;

export async function getDb(cfg: AppConfig): Promise<Db> {
  if (cfg.db.url) {
    const pool = new pg.Pool({
      connectionString: cfg.db.url,
      ssl: /sslmode=require|neon\.tech|supabase/.test(cfg.db.url)
        ? { rejectUnauthorized: false }
        : undefined,
    });
    return drizzlePg(pool, { schema }) as unknown as Db;
  }
  const dir = resolve(process.cwd(), cfg.db.pgliteDir);
  await mkdir(dir, { recursive: true });
  const client = new PGlite(dir);
  return drizzlePglite(client, { schema });
}
