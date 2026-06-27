/**
 * FieldReport — FROZEN DATA CONTRACTS (spec §5).
 *
 * This file is the single source of truth for every shape that crosses a module
 * boundary: the capture client <-> server upload seam, the processing pipeline,
 * and the report/admin views. Zod schemas are authoritative; TypeScript types are
 * inferred from them so runtime validation and compile-time types never drift.
 *
 * DO NOT change a shape here without (a) bumping CONTRACTS_VERSION and (b) logging
 * the change in DECISIONS.md. Every other module imports from `@fieldreport/contracts`.
 */
import { z } from 'zod';

/** Bump on any breaking change to the shapes below. The client stamps this into
 *  every upload manifest so the server can reject incompatible bundles. */
export const CONTRACTS_VERSION = '1.1.0';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const Iso8601 = z.string().datetime({ offset: true });

/** Stable client-generated id (uuid v4). The client mints ids offline so an
 *  observation/photo can be referenced before the server has ever seen it. */
export const ClientId = z.string().min(8).max(64);

export const ReportStatus = z.enum(['draft', 'reviewed']);
export type ReportStatus = z.infer<typeof ReportStatus>;

/** Where a bundle is in the server-side processing pipeline. Surfaced to the
 *  review/admin UIs so a super never edits a half-synthesized report. */
export const ProcessingStatus = z.enum([
  'uploaded', // bundle received, media in object storage, rows persisted
  'transcribing', // STT in flight
  'synthesizing', // LLM synthesis in flight
  'rendering', // HTML/PDF render in flight
  'ready', // report draftable/reviewable
  'failed', // see processingError
]);
export type ProcessingStatus = z.infer<typeof ProcessingStatus>;

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const Photo = z.object({
  id: ClientId,
  /** Storage key (server-assigned) OR object URL. Empty string client-side until
   *  uploaded; the client carries the actual bytes in IndexedDB keyed by `id`. */
  blobRef: z.string().default(''),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Bytes of the compressed image as stored. Informational. */
  byteSize: z.number().int().nonnegative().optional(),
});
export type Photo = z.infer<typeof Photo>;

/**
 * Markup is a SEPARATE LAYER (spec §5, §9) — never flattened onto the photo.
 * Stored as either vector strokes or a transparent PNG overlay keyed to a photo.
 * Markup itself is deferred (§12) but the shape is frozen now so adding the
 * one-tool pen later is an increment, not a refactor.
 */
export const Annotation = z.object({
  photoId: ClientId,
  /** Freehand vector strokes: array of polylines in normalized [0..1] coords. */
  strokes: z
    .array(z.array(z.object({ x: z.number(), y: z.number() })))
    .optional(),
  /** OR a pre-rasterized transparent overlay (storage key / object URL). */
  overlayBlobRef: z.string().optional(),
});
export type Annotation = z.infer<typeof Annotation>;

// ---------------------------------------------------------------------------
// Observation (one photo-set + one voice note)
// ---------------------------------------------------------------------------

export const Observation = z.object({
  id: ClientId,
  /** Sequence within the walk; assigned at capture time, preserved end-to-end. */
  order: z.number().int().nonnegative(),
  createdAt: Iso8601,
  photos: z.array(Photo).min(1),
  annotations: z.array(Annotation).optional(),
  /** Storage key for the voice note (server-side). */
  audioRef: z.string().default(''),
  /** Filled server-side by transcription. */
  transcript: z.string().optional(),
  /** Filled by synthesis (the IP). */
  cleanedDescription: z.string().optional(),
  /** Optional, synthesis-inferred. */
  trade: z.string().optional(),
  /** Optional, synthesis-inferred. */
  area: z.string().optional(),
});
export type Observation = z.infer<typeof Observation>;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const Report = z.object({
  id: z.string(),
  projectId: z.string(),
  /** Human-readable project label (resolved from the Project row) for display. */
  projectName: z.string().optional(),
  /** Calendar date of the walk (YYYY-MM-DD). */
  date: z.string(),
  superName: z.string(),
  /** Synthesis-generated daily summary paragraph (top of report). */
  summary: z.string().default(''),
  observations: z.array(Observation),
  status: ReportStatus.default('draft'),
  processing: ProcessingStatus.default('uploaded'),
  processingError: z.string().optional(),
  htmlUrl: z.string().optional(),
  pdfUrl: z.string().optional(),
  createdAt: Iso8601.optional(),
  updatedAt: Iso8601.optional(),
});
export type Report = z.infer<typeof Report>;

// ---------------------------------------------------------------------------
// Project (+ the two context-injection lexicons, spec §8)
// ---------------------------------------------------------------------------

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  superName: z.string(),
  /** Per-project proper nouns — where almost all STT accuracy gain lives (§8b).
   *  e.g. ["Watson Island", "JMA", "Najib", "Lighthouse"]. */
  glossary: z.array(z.string()).default([]),
  /** Reference to the reusable base construction lexicon (§8a). */
  baseLexiconRef: z.string().default('base-construction-v1'),
});
export type Project = z.infer<typeof Project>;

// ---------------------------------------------------------------------------
// Upload seam (capture client -> server)
// ---------------------------------------------------------------------------

/**
 * The manifest is sent as a single JSON part of a multipart upload; the photo
 * and audio bytes are sent as additional parts whose field names are the client
 * ids: each photo under a field named `photo.id`, each observation's audio under
 * `audioFieldFor(observation.id)` (= `audio:<id>`). The server resolves bytes -> storage
 * keys and fills blobRef/audioRef. This keeps the phone's job to: capture +
 * durable local storage + upload (spec §3).
 */
export const UploadObservation = z.object({
  id: ClientId,
  order: z.number().int().nonnegative(),
  createdAt: Iso8601,
  photos: z.array(
    z.object({
      id: ClientId,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      byteSize: z.number().int().nonnegative().optional(),
    }),
  ).min(1),
  annotations: z.array(Annotation).optional(),
  /** Multipart field name carrying this observation's audio bytes. */
  audioField: z.string(),
  /** Audio mime as recorded by the device (varies: iOS=mp4/aac, others=webm/opus). */
  audioMime: z.string().default('audio/webm'),
});
export type UploadObservation = z.infer<typeof UploadObservation>;

export const UploadManifest = z.object({
  contractsVersion: z.string(),
  projectId: z.string(),
  /** Human-readable project label the user typed (e.g. "Tower B — Level 4"). Optional
   *  for back-compat with v1.0.0 clients; when present the server creates/updates the
   *  Project row (so reports attribute to the right project and its glossary accrues). */
  projectName: z.string().optional(),
  /** Name of whoever prepared the report (super, foreman, PM, owner's rep, …). */
  superName: z.string(),
  /** Walk date (YYYY-MM-DD), device-local. */
  date: z.string(),
  /** Idempotency key for the whole walk so a retried upload never double-creates. */
  walkId: ClientId,
  observations: z.array(UploadObservation),
  /** Device/diagnostic breadcrumbs — invaluable for debugging on-device failures. */
  client: z
    .object({
      ua: z.string().optional(),
      installed: z.boolean().optional(), // running as installed PWA?
      tz: z.string().optional(),
    })
    .optional(),
});
export type UploadManifest = z.infer<typeof UploadManifest>;

/** Server's response to a completed upload. */
export const UploadResult = z.object({
  reportId: z.string(),
  walkId: ClientId,
  processing: ProcessingStatus,
  /** Echo of which observation/photo ids were accepted (client clears those). */
  acceptedObservationIds: z.array(ClientId),
});
export type UploadResult = z.infer<typeof UploadResult>;

// ---------------------------------------------------------------------------
// Review-before-send (spec §3, hard requirement)
// ---------------------------------------------------------------------------

/** The super's inline edits. Only prose is editable; media/order are immutable. */
export const ReportEdit = z.object({
  summary: z.string().optional(),
  observations: z
    .array(
      z.object({
        id: ClientId,
        cleanedDescription: z.string().optional(),
        trade: z.string().optional(),
        area: z.string().optional(),
      }),
    )
    .optional(),
});
export type ReportEdit = z.infer<typeof ReportEdit>;

// ---------------------------------------------------------------------------
// Admin (raw-vs-polished, spec §3)
// ---------------------------------------------------------------------------

export const AdminObservationView = z.object({
  id: ClientId,
  order: z.number().int().nonnegative(),
  photoUrls: z.array(z.string()),
  audioUrl: z.string().optional(),
  transcript: z.string().optional(), // verbatim
  cleanedDescription: z.string().optional(), // polished
  trade: z.string().optional(),
  area: z.string().optional(),
});
export type AdminObservationView = z.infer<typeof AdminObservationView>;

export const AdminReportView = z.object({
  report: Report,
  observations: z.array(AdminObservationView),
});
export type AdminReportView = z.infer<typeof AdminReportView>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Canonical multipart field name for an observation's audio part. */
export const audioFieldFor = (observationId: string) => `audio:${observationId}`;
