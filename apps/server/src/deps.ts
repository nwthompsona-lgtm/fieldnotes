/**
 * Dependency assembly (wiring). Calls the leaf-module factories once at startup and
 * seeds the single pilot project. Everything downstream takes `ServerDeps`.
 */
import { BASE_LEXICON_ID } from '@fieldreport/contracts';
import type { AppConfig } from './config.js';
import type { Repo, Db } from './db/types.js';
import type { StorageDriver } from './storage/types.js';
import type { Transcriber } from './stt/types.js';
import type { Synthesizer } from './synthesis/types.js';
import { getDb, ensureSchema, makeRepo } from './db/index.js';
import { makeStorage } from './storage/index.js';
import { makeTranscriber } from './stt/index.js';
import { makeSynthesizer } from './synthesis/index.js';
import { PILOT_GLOSSARY } from './pilot.js';

export interface ServerDeps {
  config: AppConfig;
  db: Db;
  repo: Repo;
  storage: StorageDriver;
  transcriber: Transcriber;
  synthesizer: Synthesizer;
}

export async function buildDeps(config: AppConfig): Promise<ServerDeps> {
  const db = await getDb(config);
  await ensureSchema(db);
  const repo = makeRepo(db);

  // Seed the single pilot project (spec §12).
  await repo.upsertProject({
    id: config.pilot.projectId,
    name: config.pilot.projectName,
    superName: config.pilot.superName,
    glossary: PILOT_GLOSSARY,
    baseLexiconRef: BASE_LEXICON_ID,
  });

  return {
    config,
    db,
    repo,
    storage: makeStorage(config),
    transcriber: makeTranscriber(config),
    synthesizer: makeSynthesizer(config),
  };
}
