/**
 * Idempotent schema bootstrap. Hand-authored DDL kept in sync with schema.ts, applied at
 * startup on both pglite and Postgres (CREATE ... IF NOT EXISTS). Avoids needing a
 * migration runner for the pilot; revisit if the schema grows.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  super_name text NOT NULL,
  glossary jsonb NOT NULL DEFAULT '[]'::jsonb,
  base_lexicon_ref text NOT NULL DEFAULT 'base-construction-v1'
);
CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  walk_id text NOT NULL,
  date text NOT NULL,
  super_name text NOT NULL,
  summary text NOT NULL DEFAULT '',
  ai_summary text,
  langsmith_run_id text,
  status text NOT NULL DEFAULT 'draft',
  processing text NOT NULL DEFAULT 'uploaded',
  processing_error text,
  html_key text,
  pdf_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS langsmith_run_id text;
CREATE UNIQUE INDEX IF NOT EXISTS reports_walk_id_uq ON reports (walk_id);
CREATE INDEX IF NOT EXISTS reports_project_idx ON reports (project_id);
CREATE TABLE IF NOT EXISTS observations (
  id text PRIMARY KEY,
  report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  ord integer NOT NULL,
  created_at timestamptz NOT NULL,
  audio_key text,
  audio_mime text,
  annotations jsonb,
  transcript text,
  transcript_confidence real,
  cleaned_description text,
  ai_cleaned_description text,
  trade text,
  area text
);
ALTER TABLE observations ADD COLUMN IF NOT EXISTS ai_cleaned_description text;
CREATE INDEX IF NOT EXISTS observations_report_ord_idx ON observations (report_id, ord);
CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  observation_id text NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  byte_size integer,
  ord integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS photos_observation_idx ON photos (observation_id);

-- Auth + multi-tenancy + distribution (AUTH_MULTITENANCY_PLAN.md §1). Additive +
-- idempotent: safe against a prod-shaped DB. orgs/users first (FK targets). The two
-- ALTERs on existing tables stay nullable + FK-free — backfill/enforcement is Phase 4.
CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  org_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_org_uq ON memberships (user_id, org_id);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);
CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email text NOT NULL,
  org_role text NOT NULL,
  project_assignments jsonb NOT NULL DEFAULT '[]'::jsonb,
  token text NOT NULL,
  invited_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_uq ON invitations (token);
CREATE INDEX IF NOT EXISTS invitations_org_email_idx ON invitations (org_id, email);
CREATE TABLE IF NOT EXISTS project_members (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_uq ON project_members (project_id, user_id);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members (user_id);
CREATE TABLE IF NOT EXISTS stakeholder_orgs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stakeholder_orgs_org_idx ON stakeholder_orgs (org_id);
CREATE TABLE IF NOT EXISTS stakeholder_contacts (
  id text PRIMARY KEY,
  stakeholder_org_id text NOT NULL REFERENCES stakeholder_orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stakeholder_contacts_org_idx ON stakeholder_contacts (stakeholder_org_id);
CREATE INDEX IF NOT EXISTS stakeholder_contacts_email_idx ON stakeholder_contacts (email);
CREATE TABLE IF NOT EXISTS project_stakeholders (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stakeholder_org_id text NOT NULL REFERENCES stakeholder_orgs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_stakeholders_uq ON project_stakeholders (project_id, stakeholder_org_id);
CREATE TABLE IF NOT EXISTS project_distribution_defaults (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  selection jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS report_sends (
  id text PRIMARY KEY,
  report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sent_by text REFERENCES users(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  message text
);
CREATE INDEX IF NOT EXISTS report_sends_report_idx ON report_sends (report_id);
CREATE TABLE IF NOT EXISTS report_send_recipients (
  id text PRIMARY KEY,
  send_id text NOT NULL REFERENCES report_sends(id) ON DELETE CASCADE,
  contact_id text REFERENCES stakeholder_contacts(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS rsr_token_uq ON report_send_recipients (token);
CREATE INDEX IF NOT EXISTS rsr_send_idx ON report_send_recipients (send_id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'assigned';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_by text;
`;

export async function ensureSchema(db: Db): Promise<void> {
  for (const stmt of DDL.split(';')) {
    const s = stmt.trim();
    if (s) await db.execute(sql.raw(s));
  }
}
