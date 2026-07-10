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
import { makeAuthz, type Authz } from './auth/authz.js';
import { makeEmail, type EmailDriver } from './email/index.js';
import { parseFromAddress } from './email/types.js';
import { checkResendDomainVerified } from './email/resend.js';
import { hash } from './auth/passwords.js';
import { newId } from './ids.js';
import { PILOT_GLOSSARY } from './pilot.js';

/** Live email-config health for /healthz: the EMAIL_FROM domain and whether it is
 *  verified in the Resend account (refreshed once at boot, in the background). One curl
 *  after any dashboard change answers "will real recipients actually get email?" —
 *  false means Resend testing mode: only the account owner's own address receives. */
export interface EmailHealth {
  fromDomain: string | null;
  domainVerified: boolean | 'unknown';
}

export interface ServerDeps {
  config: AppConfig;
  db: Db;
  repo: Repo;
  storage: StorageDriver;
  transcriber: Transcriber;
  synthesizer: Synthesizer;
  sessions: SessionManager;
  authz: Authz;
  email: EmailDriver;
  emailHealth: EmailHealth;
}

/** Boot-time config validation. Returns fatal problems; buildDeps throws on any.
 *  Exported pure for tests. */
export function bootConfigErrors(config: AppConfig): string[] {
  const errors: string[] = [];
  // On Render with no DATABASE_URL, the silent pglite fallback writes to the container's
  // ephemeral disk — every deploy/restart would destroy ALL data. Refuse to boot;
  // FIELDREPORT_LOCAL=1 remains the explicit opt-in (e.g. pglite on a persistent disk).
  if (config.isRender && !config.forceLocal && !config.db.url) {
    errors.push(
      'DATABASE_URL is not set. On Render the embedded-pglite fallback lives on the ' +
        "container's ephemeral disk and is WIPED on every deploy. Set DATABASE_URL " +
        '(or set FIELDREPORT_LOCAL=1 to explicitly opt into pglite).',
    );
  }
  // A malformed EMAIL_FROM means Resend rejects EVERY send at runtime with no boot-time
  // symptom — fail fast where email is real (Render + resend driver), warn elsewhere.
  if (config.email.provider === 'resend' && !parseFromAddress(config.email.from)) {
    const msg =
      `EMAIL_FROM is malformed: ${JSON.stringify(config.email.from)} — expected ` +
      '"email@example.com" or "Name <email@example.com>".';
    if (config.isRender) errors.push(msg);
    else console.warn(`[email] ${msg}`);
  }
  return errors;
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
  //    Names (14e): an env-set name is authoritative — a dashboard rename lands at the
  //    next boot. With no env name, create-if-missing under a NEUTRAL name and leave
  //    existing rows untouched, so a rename done in-app (or via a since-removed env) is
  //    never clobbered back by the every-boot seed.
  const org = await repo.getOrg(config.pilot.orgId);
  if (!org) {
    await repo.upsertOrg({ id: config.pilot.orgId, name: config.pilot.orgName ?? 'My Organization' });
  } else if (config.pilot.orgName && org.name !== config.pilot.orgName) {
    await repo.upsertOrg({ id: config.pilot.orgId, name: config.pilot.orgName });
  }
  const project = await repo.getProject(config.pilot.projectId);
  if (!project) {
    await repo.upsertProject({
      id: config.pilot.projectId,
      name: config.pilot.projectName ?? 'Pilot Project',
      superName: config.pilot.superName,
      glossary: PILOT_GLOSSARY,
      baseLexiconRef: BASE_LEXICON_ID,
    });
  } else if (config.pilot.projectName && project.name !== config.pilot.projectName) {
    // Name only: superName/glossary may have been edited since — keep them.
    await repo.upsertProject({ ...project, name: config.pilot.projectName });
  }

  // 2. Pilot admin user (email+password from env; §15.5 — rotate after first login).
  //    Identity is keyed on the email: rotating PILOT_SUPER_EMAIL between boots creates a
  //    NEW admin and leaves the old account intact (it can still log in with its old
  //    password). Revoke the previous admin by hand when rotating (ops caveat, §15.5).
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

  // 3. Adopt pre-tenancy projects (org_id IS NULL → the pilot org) — but ONLY while the
  //    pilot org is the sole tenant. Once self-serve signup has created real second orgs,
  //    a blanket "adopt every org-less project" would risk absorbing another tenant's
  //    transiently-null-org project into the pilot org, so stop and let such a row surface.
  //    Then make sure the pilot admin is the pilot project's super (explicit row keeps the
  //    §5 matrix honest and survives a role downgrade).
  if ((await repo.countOrgs()) <= 1) {
    await repo.adoptOrphanProjects(config.pilot.orgId);
  }
  if (pilotUserId && !(await repo.getProjectRole(config.pilot.projectId, pilotUserId))) {
    await repo.addProjectMember({
      id: newId('pm'),
      projectId: config.pilot.projectId,
      userId: pilotUserId,
      role: 'super',
    });
  }

  // 4. Backfill authorship on pre-auth reports (created_by IS NULL), scoped to the pilot
  //    org so a null-author report in another tenant is never attributed to the pilot admin.
  if (pilotUserId) await repo.backfillReportsCreatedBy(pilotUserId, config.pilot.orgId);
}

export async function buildDeps(config: AppConfig): Promise<ServerDeps> {
  const bootErrors = bootConfigErrors(config);
  if (bootErrors.length) {
    throw new Error(`fatal config problems:\n- ${bootErrors.join('\n- ')}`);
  }

  const db = await getDb(config);
  await ensureSchema(db);
  const repo = makeRepo(db);

  await seedPilot(repo, config);

  // Email-config health: resolve the from-domain's Resend verification in the
  // background (never blocks boot; 'unknown' until/unless the API answers).
  const from = parseFromAddress(config.email.from);
  const emailHealth: EmailHealth = {
    fromDomain: from ? from.email.split('@')[1]!.toLowerCase() : null,
    domainVerified: 'unknown',
  };
  if (config.email.provider === 'resend' && config.email.resendApiKey && emailHealth.fromDomain) {
    void checkResendDomainVerified(config.email.resendApiKey, emailHealth.fromDomain).then(
      (v) => {
        emailHealth.domainVerified = v;
        if (v === false) {
          console.warn(
            `[email] EMAIL_FROM domain "${emailHealth.fromDomain}" is NOT verified in this ` +
              'Resend account — sends to anyone but the account owner will be rejected. ' +
              'Verify the domain at resend.com/domains.',
          );
        }
      },
    );
  }

  return {
    config,
    db,
    repo,
    storage: makeStorage(config),
    transcriber: makeTranscriber(config),
    synthesizer: makeSynthesizer(config),
    sessions: makeSessions(repo, config),
    authz: makeAuthz(repo),
    email: makeEmail(config),
    emailHealth,
  };
}
