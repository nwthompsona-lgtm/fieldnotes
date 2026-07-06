/**
 * Shared test harness: hermetic ServerDeps over an in-memory pglite — local-disk
 * storage config, forced mock providers — never the real Neon/R2/API keys that may
 * sit in .env on this machine. buildTestDeps does NOT run the pilot seed; tests that
 * want it call seedPilot themselves with a fixture config.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/db/schema.js';
import { ensureSchema } from '../src/db/migrate.js';
import { makeRepo } from '../src/db/repo.js';
import { makeStorage } from '../src/storage/index.js';
import { makeTranscriber } from '../src/stt/index.js';
import { makeSynthesizer } from '../src/synthesis/index.js';
import { makeSessions } from '../src/auth/sessions.js';
import { makeMockEmail } from '../src/email/index.js';
import type { MockEmailDriver } from '../src/email/mock.js';
import { config, type AppConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import type { ServerDeps } from '../src/deps.js';

/** ServerDeps with the email driver narrowed to the mock (exposes `.sent`). */
export type TestDeps = ServerDeps & { email: MockEmailDriver };

export async function buildTestDeps(overrides?: Partial<AppConfig>): Promise<TestDeps> {
  const cfg = {
    ...config,
    db: { ...config.db, url: undefined },
    storage: { ...config.storage, driver: 'local', localDir: '.data/test-auth-storage' },
    stt: { ...config.stt, provider: 'mock' },
    synthesis: { ...config.synthesis, provider: 'mock' },
    auth: { sessionTtlDays: 0 },
    cors: { allowedOrigins: [] },
    admin: { token: 'test-admin-token', breakGlass: false },
    email: { ...config.email, provider: 'mock' },
    ...overrides,
  } as AppConfig;
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await ensureSchema(db);
  const repo = makeRepo(db);
  return {
    config: cfg,
    db,
    repo,
    storage: makeStorage(cfg),
    transcriber: makeTranscriber(cfg),
    synthesizer: makeSynthesizer(cfg),
    sessions: makeSessions(repo, cfg),
    // Direct mock (not makeEmail) so tests can reach `.sent` without a cast.
    email: makeMockEmail('.data/test-email'),
  };
}
