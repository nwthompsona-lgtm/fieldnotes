import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AdminReportView } from '@fieldreport/contracts';
import { ApiError, getAdminReport } from '../api';
import { useAdminToken } from '../hooks/useAdminToken';
import { TokenGate } from '../components/TokenGate';
import { Chip, ErrorState, Loading, ProcessingBadge, StatusBadge } from '../components/ui';

type State =
  | { kind: 'loading' }
  | { kind: 'unauthorized'; message?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; view: AdminReportView };

export function AdminDetailPage() {
  const { id = '' } = useParams();
  const { token, setToken, clear } = useAdminToken();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: 'unauthorized' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const view = await getAdminReport(id, token);
      setState({ kind: 'ready', view });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clear();
        setState({ kind: 'unauthorized', message: 'That token was rejected. Try again.' });
      } else if (err instanceof ApiError && err.status === 404) {
        setState({ kind: 'error', message: 'Report not found.' });
      } else {
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load.' });
      }
    }
  }, [id, token, clear]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'unauthorized') {
    return <TokenGate onSubmit={setToken} error={state.message} />;
  }

  if (state.kind === 'loading') {
    return (
      <div className="page">
        <Loading message="Loading report…" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="page">
        <p>
          <Link className="link-back" to="/admin">
            ← All reports
          </Link>
        </p>
        <ErrorState message={state.message} onRetry={load} />
      </div>
    );
  }

  const { report, observations } = state.view;
  const sorted = [...observations].sort((a, b) => a.order - b.order);

  return (
    <div className="page">
      <p>
        <Link className="link-back" to="/admin">
          ← All reports
        </Link>
      </p>

      <div className="row row-between mb-24">
        <div>
          <p className="eyebrow">Raw vs. polished</p>
          <h1>{report.date}</h1>
          <div className="report-meta">
            <span>
              Project <b>{report.projectId}</b>
            </span>
            <span>
              Super <b>{report.superName}</b>
            </span>
            <span>
              <StatusBadge status={report.status} />
            </span>
            <span>
              <ProcessingBadge processing={report.processing} />
            </span>
          </div>
        </div>
        <div className="row">
          {report.htmlUrl && (
            <a className="btn btn-secondary" href={report.htmlUrl} target="_blank" rel="noreferrer">
              Open report ↗
            </a>
          )}
          {report.pdfUrl && (
            <a className="btn btn-secondary" href={report.pdfUrl} target="_blank" rel="noreferrer">
              PDF ↗
            </a>
          )}
        </div>
      </div>

      {report.summary && (
        <div className="card mb-24">
          <p className="eyebrow">Daily summary (polished)</p>
          <p className="polished-text" style={{ margin: 0 }}>
            {report.summary}
          </p>
        </div>
      )}

      <h2>Observations ({sorted.length})</h2>
      {sorted.length === 0 && (
        <div className="card muted">No observations captured for this report.</div>
      )}

      {sorted.map((obs, i) => (
        <div className="card" key={obs.id} style={{ padding: 0, overflow: 'hidden' }}>
          <div className="sxs">
            {/* RAW INPUTS */}
            <div className="sxs-pane sxs-raw">
              <div className="sxs-label">Raw input · Observation {i + 1}</div>
              <div className="photo-stack">
                {obs.photoUrls.length === 0 && (
                  <p className="muted small">No photos.</p>
                )}
                {obs.photoUrls.map((url, p) => (
                  <img key={p} src={url} alt={`Raw photo ${p + 1}`} loading="lazy" />
                ))}
              </div>
              {obs.audioUrl && <audio controls preload="none" src={obs.audioUrl} />}
              <div className="transcript">
                {obs.transcript?.trim() || '— no transcript —'}
              </div>
            </div>

            {/* POLISHED OUTPUT */}
            <div className="sxs-pane sxs-polished">
              <div className="sxs-label">Polished output</div>
              <p className="polished-text">
                {obs.cleanedDescription?.trim() || (
                  <span className="muted">— no description synthesized —</span>
                )}
              </p>
              <div className="chip-row">
                {obs.trade && <Chip label="Trade" value={obs.trade} />}
                {obs.area && <Chip label="Area" value={obs.area} />}
                {!obs.trade && !obs.area && (
                  <span className="muted small">No trade/area inferred.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
