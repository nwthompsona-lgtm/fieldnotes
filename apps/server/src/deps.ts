/**
 * Dependency assembly (wiring). Calls the leaf-module factories once at startup and
 * runs the idempotent pilot seed/backfill (auth plan §12) so the live pilot keeps
 * working the moment the auth gating ships. Everything downstream takes `ServerDeps`.
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
import { makeSessions, type SessionManager } from './auth/sessions.js';
import { hash } from './auth/passwords.js';
import { newId } from './ids.js';
import { PILOT_GLOSSARY } from './pilot.js';

export interface ServerDeps {
  config: AppConfig;
  db: Db;
  repo: Repo;
  storage: StorageDriver;
  transcriber: Transcriber;
  synthesizer: Synthesizer;
  sessions: SessionManager;
}

/**
 * Idempotent pilot seed + backfill (auth plan §12). Runs at every boot, after
 * ensureSchema, so a prod promotion self-migrates: the org exists, the pilot admin can
 * log in, pre-tenancy projects get adopted, and old reports gain an author.
 */
export async function seedPilot(
  repo: Repo,
  config: AppConfig,
  log: (msg: string) => void = console.warn,
): Promise<void> {
  // 1. Org + the pilot project row (project seed predates tenancy; org_id lands in step 3).
  await repo.upsertOrg({ id: config.pilot.orgId, name: config.pilot.orgName });
  await repo.upsertProject({
    id: config.pilot.projectId,
    name: config.pilot.projectName,
    superName: config.pilot.superName,
    glossary: PILOT_GLOSSARY,
    baseLexiconRef: BASE_LEXICON_ID,
  });

  // 2. Pilot admin user (email+password from env; §15.5 — rotate after first login).
  let pilotUserId: string | null = null;
  if (config.pilot.superEmail) {
    const existing = await repo.getUserByEmail(config.pilot.superEmail);
    if (existing) {
      pilotUserId = existing.id;
    } else if (config.pilot.superPassword) {
      pilotUserId = newId('usr');
      await repo.createUser({
        id: pilotUserId,
        email: config.pilot.superEmail,
        name: config.pilot.superName,
        passwordHash: await hash(config.pilot.superPassword),
      });
    } else {
      log(
        '[seed] PILOT_SUPER_EMAIL is set but PILOT_SUPER_PASSWORD is not — pilot admin ' +
          'not created; set both (or invite the user once invitations ship).',
      );
    }
    if (pilotUserId && !(await repo.getMembership(pilotUserId, config.pilot.orgId))) {
      await repo.addMembership({
        id: newId('mem'),
        userId: pilotUserId,
        orgId: config.pilot.orgId,
        orgRole: 'admin',
      });
    }
  }

  // 3. Adopt pre-tenancy projects (org_id IS NULL → the pilot org), then make sure the
  //    pilot admin is on the pilot project as its super (they're org admin anyway, but
  //    the explicit row keeps the matrix honest and survives a role downgrade).
  await repo.adoptOrphanProjects(config.pilot.orgId);
  if (pilotUserId && !(await repo.getProjectRole(config.pilot.projectId, pilotUserId))) {
    await repo.addProjectMember({
      id: newId('pm'),
      projectId: config.pilot.projectId,
      userId: pilotUserId,
      role: 'super',
    });
  }

  // 4. Backfill authorship on pre-auth reports (created_by IS NULL only).
  if (pilotUserId) await repo.backfillReportsCreatedBy(pilotUserId);
}

export async function buildDeps(config: AppConfig): Promise<ServerDeps> {
  const db = await getDb(config);
  await ensureSchema(db);
  const repo = makeRepo(db);

  await seedPilot(repo, config);

  return {
    config,
    db,
    repo,
    storage: makeStorage(config),
    transcriber: makeTranscriber(config),
    synthesizer: makeSynthesizer(config),
    sessions: makeSessions(repo, config),
  };
}
