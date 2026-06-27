import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Report, ReportEdit, ProcessingStatus } from '@fieldreport/contracts';
import {
  ApiError,
  finalizeReport,
  getReport,
  getReportStatus,
  patchReport,
  type StatusEnvelope,
} from '../api';
import { STATUS_POLL_MS } from '../config';
import { useAutosave, type SaveState } from '../hooks/useAutosave';
import { ErrorState, Loading, StatusBadge } from '../components/ui';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'processing'; processing: ProcessingStatus; error?: string }
  | { kind: 'ready'; report: Report };

const STAGE_LABELS: Record<ProcessingStatus, string> = {
  uploaded: 'Queued',
  transcribing: 'Transcribing…',
  synthesizing: 'Writing up…',
  rendering: 'Rendering…',
  ready: 'Ready',
  failed: 'Failed',
};

const PIPELINE: ProcessingStatus[] = [
  'uploaded',
  'transcribing',
  'synthesizing',
  'rendering',
  'ready',
];

export function ReviewPage() {
  const { id = '' } = useParams();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadReady = useCallback(async () => {
    try {
      const report = await getReport(id);
      setPhase({ kind: 'ready', report });
    } catch (err) {
      setPhase({ kind: 'error', message: messageOf(err) });
    }
  }, [id]);

  const tick = useCallback(
    async (status: StatusEnvelope) => {
      if (status.processing === 'ready') {
        stopPolling();
        await loadReady();
      } else if (status.processing === 'failed') {
        stopPolling();
        setPhase({ kind: 'processing', processing: 'failed', error: status.error });
      } else {
        setPhase({ kind: 'processing', processing: status.processing });
      }
    },
    [loadReady, stopPolling],
  );

  const start = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const status = await getReportStatus(id);
      await tick(status);
      if (status.processing !== 'ready' && status.processing !== 'failed') {
        stopPolling();
        pollRef.current = setInterval(async () => {
          try {
            const s = await getReportStatus(id);
            await tick(s);
          } catch {
            // Transient poll failure: keep polling; a hard failure surfaces on next ok.
          }
        }, STATUS_POLL_MS);
      }
    } catch (err) {
      setPhase({ kind: 'error', message: messageOf(err) });
    }
  }, [id, tick, stopPolling]);

  useEffect(() => {
    void start();
    return stopPolling;
  }, [start, stopPolling]);

  if (phase.kind === 'loading') {
    return (
      <div className="page page-narrow">
        <Loading message="Opening report…" />
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className="page page-narrow">
        <ErrorState
          message={phase.message}
          onRetry={start}
          hint="Check the report id and that the FieldReport server is running."
        />
        <p className="center-state" style={{ paddingTop: 0 }}>
          <Link className="link-back" to="/">
            ← Back home
          </Link>
        </p>
      </div>
    );
  }

  if (phase.kind === 'processing') {
    return (
      <div className="page page-narrow">
        <ProcessingView processing={phase.processing} error={phase.error} onRetry={start} />
      </div>
    );
  }

  return <ReadyView report={phase.report} reportId={id} />;
}

// ── Processing view ──────────────────────────────────────────────────────────

function ProcessingView({
  processing,
  error,
  onRetry,
}: {
  processing: ProcessingStatus;
  error?: string;
  onRetry: () => void;
}) {
  if (processing === 'failed') {
    return (
      <div className="center-state">
        <div className="alert alert-error" style={{ display: 'inline-block', maxWidth: 560 }}>
          <strong>Processing failed.</strong>
          <p style={{ margin: '8px 0 0' }}>
            {error || 'The report could not be generated.'}
          </p>
          <p className="small" style={{ margin: '8px 0 0' }}>
            This usually clears on a re-upload from the capture app. If it persists,
            contact the operator.
          </p>
          <button className="btn btn-secondary mt-16" type="button" onClick={onRetry}>
            Check again
          </button>
        </div>
      </div>
    );
  }

  const activeIdx = PIPELINE.indexOf(processing);

  return (
    <div className="center-state">
      <div className="spinner" aria-hidden />
      <h2 style={{ marginBottom: 4 }}>{STAGE_LABELS[processing]}</h2>
      <p className="muted">Hang tight — your report is being prepared for review.</p>
      <div className="stage-steps">
        {PIPELINE.filter((s) => s !== 'ready').map((s, i) => (
          <span
            key={s}
            className={`stage-step ${i === activeIdx ? 'active' : i < activeIdx ? 'done' : ''}`}
          >
            {i < activeIdx ? '✓ ' : ''}
            {STAGE_LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Ready view (the editable draft + finalize gate) ──────────────────────────

function ReadyView({ report: initial, reportId }: { report: Report; reportId: string }) {
  // Local working copy — the source of truth for the inputs. Server responses
  // refresh status/links but never clobber the text the super is actively typing.
  const [report, setReport] = useState<Report>(initial);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const sortedObs = [...report.observations].sort((a, b) => a.order - b.order);

  const save = useCallback(
    async (edit: ReportEdit) => {
      const updated = await patchReport(reportId, edit);
      // Editing reverts status to draft server-side; reflect status + links only.
      setReport((r) => ({
        ...r,
        status: updated.status,
        processing: updated.processing,
        htmlUrl: updated.htmlUrl,
        pdfUrl: updated.pdfUrl,
      }));
    },
    [reportId],
  );

  const { state, queue, retry } = useAutosave(save);

  const onSummary = (summary: string) => {
    setReport((r) => ({ ...r, summary }));
    queue({ summary });
  };

  const onObsField = (
    obsId: string,
    field: 'cleanedDescription' | 'trade' | 'area',
    value: string,
  ) => {
    setReport((r) => ({
      ...r,
      observations: r.observations.map((o) =>
        o.id === obsId ? { ...o, [field]: value } : o,
      ),
    }));
    queue({ observations: [{ id: obsId, [field]: value }] });
  };

  const onFinalize = async () => {
    setFinalizeError(null);
    setFinalizing(true);
    try {
      const updated = await finalizeReport(reportId);
      setReport(updated);
    } catch (err) {
      setFinalizeError(messageOf(err));
    } finally {
      setFinalizing(false);
    }
  };

  const reviewed = report.status === 'reviewed';

  return (
    <div className="page page-narrow">
      <div className="row row-between mb-24">
        <div>
          <p className="eyebrow">Review before sending</p>
          <h1>Daily Field Report</h1>
          <div className="report-meta">
            <span>
              <b>{report.date}</b>
            </span>
            <span>
              Project <b>{report.projectName ?? report.projectId}</b>
            </span>
            <span>
              Prepared by <b>{report.superName}</b>
            </span>
          </div>
        </div>
        <StatusBadge status={report.status} />
      </div>

      <div className="card">
        <label className="field" htmlFor="summary">
          Daily summary
        </label>
        <textarea
          id="summary"
          className="summary-textarea"
          value={report.summary}
          onChange={(e) => onSummary(e.target.value)}
          placeholder="Summary of the day's walk…"
        />
      </div>

      <h2 className="mt-24">Observations ({sortedObs.length})</h2>
      {sortedObs.length === 0 && (
        <div className="card muted">No observations were captured for this report.</div>
      )}

      {sortedObs.map((obs, i) => (
        <div className="card obs-card" key={obs.id}>
          <div>
            <div className="obs-index">Observation {i + 1}</div>
            <div className="photo-stack">
              {obs.photos.map((p) => (
                <img
                  key={p.id}
                  src={p.blobRef}
                  alt={`Observation ${i + 1}`}
                  loading="lazy"
                />
              ))}
            </div>
          </div>
          <div>
            <label className="field" htmlFor={`desc-${obs.id}`}>
              Description
            </label>
            <textarea
              id={`desc-${obs.id}`}
              className="desc-textarea"
              value={obs.cleanedDescription ?? ''}
              onChange={(e) => onObsField(obs.id, 'cleanedDescription', e.target.value)}
              placeholder="Write-up of this observation…"
            />
            <div className="inline-fields">
              <div className="grow">
                <label className="field" htmlFor={`trade-${obs.id}`}>
                  Trade
                </label>
                <input
                  id={`trade-${obs.id}`}
                  type="text"
                  value={obs.trade ?? ''}
                  onChange={(e) => onObsField(obs.id, 'trade', e.target.value)}
                  placeholder="e.g. Concrete"
                  autoComplete="off"
                />
              </div>
              <div className="grow">
                <label className="field" htmlFor={`area-${obs.id}`}>
                  Area
                </label>
                <input
                  id={`area-${obs.id}`}
                  type="text"
                  value={obs.area ?? ''}
                  onChange={(e) => onObsField(obs.id, 'area', e.target.value)}
                  placeholder="e.g. Level 3 — East"
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* The trust gate: sticky action bar. Links stay hidden until reviewed. */}
      <div className="finalize-bar">
        <SaveIndicator state={state} onRetry={retry} />
        <div className="spacer" />

        {reviewed ? (
          <>
            <StatusBadge status="reviewed" />
            {report.htmlUrl && (
              <a
                className="btn btn-secondary"
                href={report.htmlUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open report ↗
              </a>
            )}
            {report.pdfUrl && (
              <a className="btn btn-primary" href={report.pdfUrl} target="_blank" rel="noreferrer">
                Download PDF
              </a>
            )}
          </>
        ) : (
          <button
            className="btn btn-primary btn-lg"
            type="button"
            onClick={onFinalize}
            disabled={finalizing}
          >
            {finalizing ? (
              <>
                <span className="spinner spinner-sm" aria-hidden /> Finalizing…
              </>
            ) : (
              'Finalize & create shareable report'
            )}
          </button>
        )}
      </div>

      {reviewed ? (
        <div className="alert alert-info mt-16">
          This report is finalized and shareable. Any further edits will revert it to a
          draft — you’ll need to finalize again to refresh the shared links.
        </div>
      ) : (
        <div className="alert alert-info mt-16">
          Nothing is shareable yet. Review the write-up above, then finalize to generate
          the hosted HTML and PDF.
        </div>
      )}

      {finalizeError && (
        <div className="alert alert-error mt-16">Could not finalize: {finalizeError}</div>
      )}
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'saving') {
    return (
      <span className="save-indicator save-saving">
        <span className="spinner spinner-sm" aria-hidden /> Saving…
      </span>
    );
  }
  if (state === 'saved') {
    return <span className="save-indicator save-saved">✓ Saved</span>;
  }
  if (state === 'error') {
    return (
      <span className="save-indicator save-error">
        Save failed —{' '}
        <button type="button" onClick={onRetry}>
          retry
        </button>
      </span>
    );
  }
  return <span className="save-indicator muted">All changes save automatically.</span>;
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Report not found.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Unexpected error.';
}
