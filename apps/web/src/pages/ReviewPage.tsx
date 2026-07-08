import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Report, ReportEdit, ProcessingStatus } from '@fieldreport/contracts';
import {
  ApiError,
  finalizeReport,
  getReport,
  getReportStatus,
  openAuthedArtifact,
  patchReport,
  type StatusEnvelope,
} from '../api';
import { STATUS_POLL_MS } from '../config';
import { useAutosave, type SaveState } from '../hooks/useAutosave';
import { useWorkspace, effectiveRole, canEditReport } from '../workspace';
import { Chip, ErrorState, Loading, StatusBadge } from '../components/ui';
import { SendModal } from '../components/SendModal';

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
  const [openError, setOpenError] = useState<string | null>(null);
  const navigate = useNavigate();
  const ws = useWorkspace();

  // Per-report edit rights (D-7: send = finalize = edit). The SERVER's per-requester
  // verdict (report.canEdit, derived from the report's OWN org/project) is authoritative:
  // the local rule only sees the currently-viewed org, so it misclassifies cross-org
  // reports (the author lands read-only via the capture hand-off; an org-A admin gets a
  // 403-autosave loop on an org-B report). The shared local rule remains only as a
  // fallback for servers that predate the field.
  const project = ws.projects?.find((p) => p.id === report.projectId);
  const canEdit =
    report.canEdit ?? canEditReport(effectiveRole(ws, project), report, ws.user.id);

  // ?send=1 (from the reports list's Send pill / capture hand-off) opens the Send
  // modal. Effect-driven (not initial state) so a still-loading project list doesn't
  // swallow the deep link; non-editors simply never trigger it. closeSend strips the
  // param so the modal won't re-open.
  const [searchParams, setSearchParams] = useSearchParams();
  const [sendOpen, setSendOpen] = useState(false);
  useEffect(() => {
    if (canEdit && report.status === 'reviewed' && searchParams.get('send') === '1') {
      setSendOpen(true);
    }
  }, [canEdit, report.status, searchParams]);
  const closeSend = () => {
    setSendOpen(false);
    if (searchParams.get('send')) setSearchParams({}, { replace: true });
  };

  // Hosted HTML/PDF are session-gated — a plain <a target="_blank"> would 401, so we
  // open them via the bearer-carrying blob-URL helper and surface failures inline.
  const openArtifact = (url: string) => {
    setOpenError(null);
    openAuthedArtifact(url).catch((err) => setOpenError(messageOf(err)));
  };

  const sortedObs = [...report.observations].sort((a, b) => a.order - b.order);

  const save = useCallback(
    async (edit: ReportEdit) => {
      const updated = await patchReport(reportId, edit);
      // Editing reverts status to draft server-side; reflect status + links only — never
      // clobber text the super is actively typing. EXCEPTION: when this save edited a
      // description (not the summary), the server regenerates the summary; reflect it,
      // unless the user is currently in the summary box.
      setReport((r) => {
        const next: Report = {
          ...r,
          status: updated.status,
          processing: updated.processing,
          htmlUrl: updated.htmlUrl,
          pdfUrl: updated.pdfUrl,
        };
        const editingSummaryBox =
          typeof document !== 'undefined' && document.activeElement?.id === 'summary';
        if (edit.summary === undefined && !editingSummaryBox) next.summary = updated.summary;
        return next;
      });
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

  // Read-only rendering for viewers / non-author supers: plain text instead of
  // textareas (their autosave PATCHes would only 403 into a permanent "Save failed"),
  // and no Send / Finalize / delivery affordances. Placed after every hook above so
  // the hook order is stable when canEdit flips as the project list loads.
  if (!canEdit) {
    return <ReadOnlyView report={report} />;
  }

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
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => report.htmlUrl && openArtifact(report.htmlUrl)}
              >
                Open report ↗
              </button>
            )}
            {report.pdfUrl && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => report.pdfUrl && openArtifact(report.pdfUrl)}
              >
                Download PDF
              </button>
            )}
            <Link className="btn btn-secondary" to={`/review/${encodeURIComponent(reportId)}/delivery`}>
              View delivery
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => setSendOpen(true)}>
              Send report
            </button>
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

      {openError && (
        <div className="alert alert-error mt-16">Could not open the report: {openError}</div>
      )}

      {sendOpen && (
        <SendModal
          report={report}
          onClose={closeSend}
          onSent={() => navigate(`/review/${encodeURIComponent(reportId)}/delivery`)}
        />
      )}
    </div>
  );
}

/** Read-only report view (D-7): the same content as ReadyView but rendered as plain
 *  text — no textareas / autosave, no Send / Finalize / delivery. Hosted HTML/PDF stay
 *  reachable once reviewed (viewing is exactly what these roles are allowed to do),
 *  opened through the bearer-carrying blob-URL helper like the editable view. */
function ReadOnlyView({ report }: { report: Report }) {
  const [openError, setOpenError] = useState<string | null>(null);
  const sortedObs = [...report.observations].sort((a, b) => a.order - b.order);
  const { htmlUrl, pdfUrl } = report;
  const reviewed = report.status === 'reviewed';

  const openArtifact = (url: string) => {
    setOpenError(null);
    openAuthedArtifact(url).catch((err) => setOpenError(messageOf(err)));
  };

  return (
    <div className="page page-narrow">
      <div className="row row-between mb-24">
        <div>
          <p className="eyebrow">Field report</p>
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
        <p className="eyebrow">Daily summary</p>
        <p className="polished-text" style={{ margin: 0 }}>
          {report.summary?.trim() || 'No summary yet.'}
        </p>
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
                <img key={p.id} src={p.blobRef} alt={`Observation ${i + 1}`} loading="lazy" />
              ))}
            </div>
          </div>
          <div>
            <p className="polished-text">
              {obs.cleanedDescription?.trim() || (
                <span className="muted">— no description —</span>
              )}
            </p>
            <div className="chip-row">
              {obs.trade && <Chip label="Trade" value={obs.trade} />}
              {obs.area && <Chip label="Area" value={obs.area} />}
            </div>
          </div>
        </div>
      ))}

      <div className="finalize-bar">
        <span className="muted small">Read-only — you don’t have edit access to this report.</span>
        <div className="spacer" />
        {reviewed && htmlUrl && (
          <button type="button" className="btn btn-secondary" onClick={() => openArtifact(htmlUrl)}>
            Open report ↗
          </button>
        )}
        {reviewed && pdfUrl && (
          <button type="button" className="btn btn-secondary" onClick={() => openArtifact(pdfUrl)}>
            Download PDF
          </button>
        )}
      </div>

      {openError && (
        <div className="alert alert-error mt-16">Could not open the report: {openError}</div>
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
