import { describe, it, expect } from 'vitest';
import { normalizedEditDistance, reportQualityMetrics, computeRollup } from '../src/quality.js';
import type { ReportQuality } from '../src/db/types.js';

const obs = (
  id: string,
  ai: string | null,
  final: string | null,
  conf: number | null = 0.9,
) => ({ id, aiCleanedDescription: ai, cleanedDescription: final, transcriptConfidence: conf });

const report = (over: Partial<ReportQuality> = {}): ReportQuality => ({
  id: 'r1',
  runId: 'run-1',
  status: 'reviewed',
  processing: 'ready',
  createdAt: '2026-06-28T00:00:00.000Z',
  summary: 'summary',
  aiSummary: 'summary',
  observations: [obs('o1', 'the slab is poured', 'the slab is poured')],
  ...over,
});

describe('normalizedEditDistance', () => {
  it('is 0 for identical (case/space-insensitive) text', () => {
    expect(normalizedEditDistance('Framing inspection done', 'framing   inspection done')).toBe(0);
  });
  it('is 1 when fully rewritten', () => {
    expect(normalizedEditDistance('alpha beta', 'gamma delta')).toBe(1);
  });
  it('is fractional for a partial edit', () => {
    // one of three tokens changed
    expect(normalizedEditDistance('grade inspection today', 'framing inspection today')).toBeCloseTo(1 / 3);
  });
  it('treats empty vs empty as identical', () => {
    expect(normalizedEditDistance('', '')).toBe(0);
  });
});

describe('reportQualityMetrics', () => {
  it('flags sent-unmodified when nothing changed', () => {
    const m = reportQualityMetrics(report());
    expect(m.sentUnmodified).toBe(true);
    expect(m.editedObservationCount).toBe(0);
    expect(m.avgObsEditDistance).toBe(0);
    expect(m.summaryEditDistance).toBe(0);
  });

  it('measures edits against the AI draft', () => {
    const m = reportQualityMetrics(
      report({
        summary: 'edited summary text',
        observations: [obs('o1', 'grade inspection today', 'framing inspection today')],
      }),
    );
    expect(m.sentUnmodified).toBe(false);
    expect(m.editedObservationCount).toBe(1);
    expect(m.avgObsEditDistance).toBeCloseTo(1 / 3);
    expect(m.summaryEditDistance).toBeGreaterThan(0);
  });

  it('returns null sent-unmodified when there is no AI-draft snapshot', () => {
    const m = reportQualityMetrics(
      report({ aiSummary: null, observations: [obs('o1', null, 'typed by hand')] }),
    );
    expect(m.sentUnmodified).toBeNull();
    expect(m.summaryEditDistance).toBeNull();
  });

  it('counts low-confidence clips', () => {
    const m = reportQualityMetrics(
      report({ observations: [obs('o1', 'a', 'a', 0.4), obs('o2', 'b', 'b', 0.95)] }),
    );
    expect(m.lowConfidenceCount).toBe(1);
    expect(m.avgTranscriptConfidence).toBeCloseTo(0.675);
  });
});

describe('computeRollup', () => {
  it('aggregates success, sent-unmodified, and confidence', () => {
    const list: ReportQuality[] = [
      report({ id: 'a', processing: 'ready', status: 'reviewed' }),
      report({
        id: 'b',
        processing: 'ready',
        status: 'reviewed',
        observations: [obs('o', 'grade', 'framing', 0.5)],
      }),
      report({ id: 'c', processing: 'failed', status: 'draft', observations: [] }),
    ];
    const r = computeRollup(list);
    expect(r.totalReports).toBe(3);
    expect(r.successRate).toBeCloseTo(2 / 3);
    expect(r.reviewedCount).toBe(2);
    expect(r.measurableReviewedCount).toBe(2);
    expect(r.sentUnmodifiedRate).toBeCloseTo(0.5); // a unchanged, b edited
    expect(r.byProcessing.ready).toBe(2);
    expect(r.byProcessing.failed).toBe(1);
  });

  it('handles an empty corpus without dividing by zero', () => {
    const r = computeRollup([]);
    expect(r.totalReports).toBe(0);
    expect(r.successRate).toBeNull();
    expect(r.sentUnmodifiedRate).toBeNull();
  });
});
