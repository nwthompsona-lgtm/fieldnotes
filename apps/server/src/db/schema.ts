/**
 * Database schema (Drizzle / pg-core). Works against both prod Postgres (node-postgres)
 * and dev/test pglite (embedded) — same schema, same queries. Mirrors the frozen
 * contracts (§5). Media bytes live in object storage; here we keep metadata, storage
 * keys, transcripts, and synthesized prose.
 */
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
import type { Annotation, ProcessingStatus, ReportStatus } from '@fieldreport/contracts';

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  superName: text('super_name').notNull(),
  glossary: jsonb('glossary').$type<string[]>().notNull().default([]),
  baseLexiconRef: text('base_lexicon_ref').notNull().default('base-construction-v1'),
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
    status: text('status').$type<ReportStatus>().notNull().default('draft'),
    processing: text('processing').$type<ProcessingStatus>().notNull().default('uploaded'),
    processingError: text('processing_error'),
    htmlKey: text('html_key'),
    pdfKey: text('pdf_key'),
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

export type ProjectRow = typeof projects.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type ObservationRow = typeof observations.$inferSelect;
export type PhotoRow = typeof photos.$inferSelect;
