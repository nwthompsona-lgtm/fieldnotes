/**
 * Data-access seam. The db leaf module implements `getDb`/`ensureSchema`/`makeRepo`;
 * the orchestrator-owned wiring (routes, pipeline) consumes `Repo`. Repo speaks in
 * CONTRACT types (`@fieldreport/contracts`) so callers never touch Drizzle rows.
 */
import type {
  Report,
  ReportEdit,
  ReportStatus,
  ProcessingStatus,
  Project,
  UploadManifest,
} from '@fieldreport/contracts';
import type { SynthesisOutput } from '../synthesis/types.js';

/** Opaque DB handle (drizzle instance over pglite|pg). */
export type Db = unknown;

/** Storage keys (and server-corrected photo dims) resolved by ingest before rows
 *  are written. Dims come from the EXIF-corrected/resized image, not the client. */
export interface IngestMediaKeys {
  /** photoId -> stored photo metadata */
  photos: Record<
    string,
    { key: string; width: number; height: number; byteSize: number }
  >;
  /** observationId -> { key, mime, ext } */
  audio: Record<string, { key: string; mime: string; ext: string }>;
}

/** One observation's processing inputs (audio + keyterm assembly happens in caller). */
export interface ProcessingObservation {
  id: string;
  order: number;
  audioKey: string | null;
  audioMime: string | null;
  photoCount: number;
}

export interface Repo {
  // projects
  getProject(id: string): Promise<Project | null>;
  upsertProject(p: Project): Promise<void>;
  /** Ensure a project row exists for an uploaded report (the reports.projectId FK
   *  requires it). Creates it with an empty glossary, or — if it already exists —
   *  refreshes name/superName while PRESERVING any accumulated glossary. */
  ensureProjectFromUpload(p: { id: string; name: string; superName: string }): Promise<void>;

  // ingest (idempotent on walkId)
  createReportFromUpload(
    manifest: UploadManifest,
    media: IngestMediaKeys,
  ): Promise<{ reportId: string; created: boolean; acceptedObservationIds: string[] }>;

  // reads
  getReport(id: string): Promise<Report | null>;
  getReportStatus(
    id: string,
  ): Promise<{ status: ReportStatus; processing: ProcessingStatus; error?: string } | null>;
  listReports(): Promise<Report[]>;
  getProcessingObservations(reportId: string): Promise<ProcessingObservation[]>;
  getReportProjectId(id: string): Promise<string | null>;

  // pipeline writes
  setProcessing(id: string, status: ProcessingStatus, error?: string): Promise<void>;
  setTranscript(observationId: string, text: string, confidence?: number): Promise<void>;
  applySynthesis(reportId: string, out: SynthesisOutput): Promise<void>;
  setRenderArtifacts(id: string, keys: { htmlKey: string; pdfKey: string }): Promise<void>;

  // review gate
  applyEdit(id: string, edit: ReportEdit): Promise<Report | null>;
  finalize(id: string): Promise<Report | null>;
}
