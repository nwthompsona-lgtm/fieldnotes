import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Report } from '@fieldreport/contracts';
import { ApiError, listAdminReports } from '../api';
import { useAdminToken } from '../hooks/useAdminToken';
import { TokenGate } from '../components/TokenGate';
import { ErrorState, Loading, ProcessingBadge, StatusBadge } from '../components/ui';

type State =
  | { kind: 'loading' }
  | { kind: 'unauthorized'; message?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; reports: Report[] };

export function AdminListPage() {
  const { token, setToken, clear } = useAdminToken();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: 'unauthorized' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const reports = await listAdminReports(token);
      setState({ kind: 'ready', reports });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clear();
        setState({ kind: 'unauthorized', message: 'That token was rejected. Try again.' });
      } else {
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load.' });
      }
    }
  }, [token, clear]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'unauthorized') {
    return <TokenGate onSubmit={setToken} error={state.message} />;
  }

  if (state.kind === 'loading') {
    return (
      <div className="page">
        <Loading message="Loading reports…" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="page">
        <ErrorState message={state.message} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row row-between mb-24">
        <div>
          <p className="eyebrow">Operator</p>
          <h1>Quality admin</h1>
          <p className="muted small" style={{ margin: 0 }}>
            All reports across projects. Open one to compare raw inputs against the
            polished write-up.
          </p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={clear}>
          Sign out
        </button>
      </div>

      {state.reports.length === 0 ? (
        <div className="card muted">No reports yet. Once a walk is uploaded it appears here.</div>
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Project</th>
              <th>Prepared by</th>
              <th>Status</th>
              <th>Processing</th>
              <th>Observations</th>
            </tr>
          </thead>
          <tbody>
            {[...state.reports]
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/admin/${encodeURIComponent(r.id)}`}>{r.date}</Link>
                  </td>
                  <td>{r.projectName ?? r.projectId}</td>
                  <td>{r.superName}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <ProcessingBadge processing={r.processing} />
                  </td>
                  <td>{r.observations.length}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
