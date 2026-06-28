/**
 * Quality metrics (pure, no I/O) — the "improvement flywheel" math. Every human edit in
 * review is a free quality signal: how much did the super have to change the AI's first
 * draft? We snapshot the AI draft at synthesis (ai_summary / ai_cleaned_description) and
 * compare it to the final, edited text here. Consumed by LangSmith feedback (per report)
 * and the admin metrics rollup (across reports).
 */
import type { ReportQuality } from './db/types.js';

/** Below this STT confidence we flag a clip for review / lexicon tuning. */
export const LOW_CONFIDENCE = 0.6;

function tokens(s: string): string[] {
  return s.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Word-level Levenshtein distance. */
function levenshtein(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (cur[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      cur[j] = Math.min(del, ins, sub);
    }
    prev = cur;
  }
  return prev[n] ?? 0;
}

/** Token-level edit distance normalized to 0..1 (0 = identical, 1 = completely rewritten). */
export function normalizedEditDistance(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  const max = Math.max(ta.length, tb.length);
  if (max === 0) return 0;
  return levenshtein(ta, tb) / max;
}

export interface ReportQualityMetrics {
  reportId: string;
  runId: string | null;
  observationCount: number;
  /** Observations that have an AI-draft snapshot to compare against. */
  measurableObservationCount: number;
  editedObservationCount: number;
  /** True when no measurable observation was changed from the AI draft (AI nailed it).
   *  null when nothing is measurable (e.g. pre-snapshot reports). */
  sentUnmodified: boolean | null;
  /** Mean normalized edit distance across measurable observations (0..1). */
  avgObsEditDistance: number | null;
  /** Normalized edit distance of the summary (aiSummary vs final summary). */
  summaryEditDistance: number | null;
  avgTranscriptConfidence: number | null;
  lowConfidenceCount: number;
}

/** Per-report quality metrics from the AI-draft snapshot vs the final edited text. */
export function reportQualityMetrics(q: ReportQuality): ReportQualityMetrics {
  const measurable = q.observations.filter((o) => o.aiCleanedDescription != null);
  const distances = measurable.map((o) =>
    normalizedEditDistance(o.aiCleanedDescription ?? '', o.cleanedDescription ?? ''),
  );
  const editedCount = distances.filter((d) => d > 0).length;
  const confidences = q.observations
    .map((o) => o.transcriptConfidence)
    .filter((c): c is number => c != null);

  return {
    reportId: q.id,
    runId: q.runId,
    observationCount: q.observations.length,
    measurableObservationCount: measurable.length,
    editedObservationCount: editedCount,
    sentUnmodified: measurable.length ? editedCount === 0 : null,
    avgObsEditDistance: distances.length
      ? distances.reduce((a, b) => a + b, 0) / distances.length
      : null,
    summaryEditDistance:
      q.aiSummary != null ? normalizedEditDistance(q.aiSummary, q.summary) : null,
    avgTranscriptConfidence: confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null,
    lowConfidenceCount: confidences.filter((c) => c < LOW_CONFIDENCE).length,
  };
}

export interface MetricsRollup {
  totalReports: number;
  byProcessing: Record<string, number>;
  byStatus: Record<string, number>;
  /** ready / total — pipeline success rate. */
  successRate: number | null;
  reviewedCount: number;
  /** Reviewed reports for which we have an AI-draft snapshot to measure against. */
  measurableReviewedCount: number;
  /** Of measurable reviewed reports, the fraction sent with zero observation edits. */
  sentUnmodifiedRate: number | null;
  /** Mean per-report avg observation edit distance, over reviewed measurable reports. */
  avgObsEditDistance: number | null;
  avgTranscriptConfidence: number | null;
  /** Fraction of all observations (with confidence) below LOW_CONFIDENCE. */
  lowConfidenceObsRate: number | null;
}

/** Aggregate quality across all reports for the admin dashboard. */
export function computeRollup(list: ReportQuality[]): MetricsRollup {
  const byProcessing: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const r of list) {
    byProcessing[r.processing] = (byProcessing[r.processing] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  const reviewed = list.filter((r) => r.status === 'reviewed');
  const reviewedMetrics = reviewed
    .map(reportQualityMetrics)
    .filter((m) => m.sentUnmodified !== null);

  const allConfidences = list
    .flatMap((r) => r.observations.map((o) => o.transcriptConfidence))
    .filter((c): c is number => c != null);

  const obsEditDistances = reviewedMetrics
    .map((m) => m.avgObsEditDistance)
    .filter((d): d is number => d != null);

  return {
    totalReports: list.length,
    byProcessing,
    byStatus,
    successRate: list.length ? (byProcessing['ready'] ?? 0) / list.length : null,
    reviewedCount: reviewed.length,
    measurableReviewedCount: reviewedMetrics.length,
    sentUnmodifiedRate: reviewedMetrics.length
      ? reviewedMetrics.filter((m) => m.sentUnmodified === true).length / reviewedMetrics.length
      : null,
    avgObsEditDistance: obsEditDistances.length
      ? obsEditDistances.reduce((a, b) => a + b, 0) / obsEditDistances.length
      : null,
    avgTranscriptConfidence: allConfidences.length
      ? allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
      : null,
    lowConfidenceObsRate: allConfidences.length
      ? allConfidences.filter((c) => c < LOW_CONFIDENCE).length / allConfidences.length
      : null,
  };
}
