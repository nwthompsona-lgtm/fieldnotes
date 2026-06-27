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
  status text NOT NULL DEFAULT 'draft',
  processing text NOT NULL DEFAULT 'uploaded',
  processing_error text,
  html_key text,
  pdf_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
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
  trade text,
  area text
);
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
`;

export async function ensureSchema(db: Db): Promise<void> {
  for (const stmt of DDL.split(';')) {
    const s = stmt.trim();
    if (s) await db.execute(sql.raw(s));
  }
}
