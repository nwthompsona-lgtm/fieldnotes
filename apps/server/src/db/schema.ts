/**
 * Database schema (Drizzle / pg-core). Works against both prod Postgres (node-postgres)
 * and dev/test pglite (embedded) — same schema, same queries. Mirrors the frozen
 * contracts (§5). Media bytes live in object storage; here we keep metadata, storage
 * keys, transcripts, and synthesized prose.
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  real,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type {
  Annotation,
  ProcessingStatus,
  ReportStatus,
  OrgRole,
  ProjectRole,
  ProjectVisibility,
  StakeholderKind,
  SendSelection,
} from '@fieldreport/contracts';

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  superName: text('super_name').notNull(),
  glossary: jsonb('glossary').$type<string[]>().notNull().default([]),
  baseLexiconRef: text('base_lexicon_ref').notNull().default('base-construction-v1'),
  /** Tenancy (auth plan §1.3). Nullable until the Phase 4 backfill adopts existing rows. */
  orgId: text('org_id'),
  visibility: text('visibility').$type<ProjectVisibility>().notNull().default('assigned'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** Idempotency key for the whole walk (one report per walk upload). */
    walkId: text('walk_id').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD
    superName: text('super_name').notNull(),
    summary: text('summary').notNull().default(''),
    /** The AI's first-draft summary, snapshotted once at synthesis. Never touched by edits,
     *  so summary-vs-aiSummary is a durable "how much did the human change" signal. */
    aiSummary: text('ai_summary'),
    /** Root LangSmith run id for this report's pipeline, so review outcomes (edit distance,
     *  sent-unmodified) can be attached back to the trace as feedback. */
    langsmithRunId: text('langsmith_run_id'),
    status: text('status').$type<ReportStatus>().notNull().default('draft'),
    processing: text('processing').$type<ProcessingStatus>().notNull().default('uploaded'),
    processingError: text('processing_error'),
    htmlKey: text('html_key'),
    pdfKey: text('pdf_key'),
    /** Author (auth plan §1.3). Nullable; backfilled to the pilot super in Phase 4. */
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    walkIdx: uniqueIndex('reports_walk_id_uq').on(t.walkId),
    projectIdx: index('reports_project_idx').on(t.projectId),
  }),
);

export const observations = pgTable(
  'observations',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    audioKey: text('audio_key'),
    audioMime: text('audio_mime'),
    /** Separate markup layer (§5) — never flattened onto a photo. */
    annotations: jsonb('annotations').$type<Annotation[]>(),
    transcript: text('transcript'),
    transcriptConfidence: real('transcript_confidence'),
    cleanedDescription: text('cleaned_description'),
    /** The AI's first-draft polished description, snapshotted once at synthesis. Compared
     *  against cleanedDescription to measure how much the super corrected the AI/transcript. */
    aiCleanedDescription: text('ai_cleaned_description'),
    trade: text('trade'),
    area: text('area'),
  },
  (t) => ({
    reportOrdIdx: index('observations_report_ord_idx').on(t.reportId, t.ord),
  }),
);

export const photos = pgTable(
  'photos',
  {
    id: text('id').primaryKey(),
    observationId: text('observation_id')
      .notNull()
      .references(() => observations.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size'),
    /** Position within the observation's photo set. */
    ord: integer('ord').notNull().default(0),
  },
  (t) => ({
    obsIdx: index('photos_observation_idx').on(t.observationId),
  }),
);

// ---------------------------------------------------------------------------
// Auth + multi-tenancy + distribution (AUTH_MULTITENANCY_PLAN.md §1.2).
// All ids are text PKs (newId(prefix), T-6); created_at timestamptz default now().
// The executable DDL lives in migrate.ts — these defs drive query building.
// ---------------------------------------------------------------------------

export const orgs = pgTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Stored as typed; uniqueness is on lower(email) — normalize at the repo layer. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** Nullable: invited-not-yet-set and (future) SSO-only accounts have no password. */
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    /** The opaque bearer token itself (T-1); revoke = set revoked_at. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** null = indefinite session (SESSION_TTL_DAYS=0, D-2). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    orgRole: text('org_role').$type<OrgRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userOrgUq: uniqueIndex('memberships_user_org_uq').on(t.userId, t.orgId),
    userIdx: index('memberships_user_idx').on(t.userId),
  }),
);

export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    orgRole: text('org_role').$type<OrgRole>().notNull(),
    projectAssignments: jsonb('project_assignments')
      .$type<Array<{ projectId: string; role: ProjectRole }>>()
      .notNull()
      .default([]),
    token: text('token').notNull(),
    invitedBy: text('invited_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => ({
    tokenUq: uniqueIndex('invitations_token_uq').on(t.token),
    orgEmailIdx: index('invitations_org_email_idx').on(t.orgId, t.email),
  }),
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectRole: text('project_role').$type<ProjectRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectUserUq: uniqueIndex('project_members_project_user_uq').on(t.projectId, t.userId),
    userIdx: index('project_members_user_idx').on(t.userId),
  }),
);

export const stakeholderOrgs = pgTable(
  'stakeholder_orgs',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<StakeholderKind>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('stakeholder_orgs_org_idx').on(t.orgId),
  }),
);

export const stakeholderContacts = pgTable(
  'stakeholder_contacts',
  {
    id: text('id').primaryKey(),
    stakeholderOrgId: text('stakeholder_org_id')
      .notNull()
      .references(() => stakeholderOrgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('stakeholder_contacts_org_idx').on(t.stakeholderOrgId),
    emailIdx: index('stakeholder_contacts_email_idx').on(t.email),
  }),
);

/** Per-project roster: which stakeholder orgs the Send modal offers (plan §7). */
export const projectStakeholders = pgTable(
  'project_stakeholders',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stakeholderOrgId: text('stakeholder_org_id')
      .notNull()
      .references(() => stakeholderOrgs.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectOrgUq: uniqueIndex('project_stakeholders_uq').on(t.projectId, t.stakeholderOrgId),
  }),
);

/** Remembered last send selection per project (D-8). */
export const projectDistributionDefaults = pgTable('project_distribution_defaults', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  selection: jsonb('selection').$type<SendSelection>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reportSends = pgTable(
  'report_sends',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    sentBy: text('sent_by').references(() => users.id),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    message: text('message'),
  },
  (t) => ({
    reportIdx: index('report_sends_report_idx').on(t.reportId),
  }),
);

export const reportSendRecipients = pgTable(
  'report_send_recipients',
  {
    id: text('id').primaryKey(),
    sendId: text('send_id')
      .notNull()
      .references(() => reportSends.id, { onDelete: 'cascade' }),
    /** Nullable: ad-hoc one-off recipients aren't in the directory; SET NULL on contact
     *  delete keeps the denormalized email/name below as the durable audit record (§7). */
    contactId: text('contact_id').references(() => stakeholderContacts.id, {
      onDelete: 'set null',
    }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** The per-person capability token for /s/:token (T-5). */
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    openCount: integer('open_count').notNull().default(0),
    /** Last email-dispatch failure for this recipient (null = last dispatch reached the
     *  provider OK). Written by the send/resend paths so a Resend rejection surfaces in
     *  the delivery panel instead of the send silently looking fine (§8). */
    emailError: text('email_error'),
  },
  (t) => ({
    tokenUq: uniqueIndex('rsr_token_uq').on(t.token),
    sendIdx: index('rsr_send_idx').on(t.sendId),
  }),
);

export type ProjectRow = typeof projects.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type ObservationRow = typeof observations.$inferSelect;
export type PhotoRow = typeof photos.$inferSelect;
export type OrgRow = typeof orgs.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type StakeholderOrgRow = typeof stakeholderOrgs.$inferSelect;
export type StakeholderContactRow = typeof stakeholderContacts.$inferSelect;
export type ReportSendRow = typeof reportSends.$inferSelect;
export type ReportSendRecipientRow = typeof reportSendRecipients.$inferSelect;
