/**
 * Reports list (home) — /p/:projectId/reports (design handoff §Reports list). Status-rail
 * rows: date block · title · author (gradient avatar) · status chip · context action pill
 * (Continue / Review / Send / View); sent rows show the teal "X/Y opened". Header =
 * project name + visibility chip + count + pill filter tabs. Role-aware: viewers get
 * View-only actions and no capture hint (the server already filters drafts out of their
 * list).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listReports, type ReportListRow } from '../authApi';
import { useWorkspace, effectiveRole, canWork } from '../workspace';
import { Avatar, StatusChip, railStatusOf, type RailStatus } from '../components/flux';
import { Loading, ErrorState } from '../components/ui';

type Filter = 'all' | 'inprogress' | 'finalized' | 'sent';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'inprogress', label: 'In progress' },
  { key: 'finalized', label: 'Finalized' },
  { key: 'sent', label: 'Sent' },
];

function matches(filter: Filter, status: RailStatus): boolean {
  if (filter === 'all') return true;
  if (filter === 'inprogress') return status === 'draft' || status === 'processing';
  return filter === status;
}

/** Row title: the summary's first sentence, else a generic label. */
function titleOf(r: ReportListRow): string {
  const s = r.summary?.trim();
  if (!s) return 'Daily field report';
  const first = s.split(/(?<=[.!?])\s/)[0] ?? s;
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

/** "2026-06-28" → { day: "28", mon: "JUN" } without timezone drift. */
function dateBlock(date: string): { day: string; mon: string } {
  const [y, m, d] = date.split('-').map(Number);
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  if (!y || !m || !d) return { day: '—', mon: '' };
  return { day: String(d), mon: MONTHS[m - 1] ?? '' };
}

/** Context action per the permission matrix (D-7: send = finalize = edit, so a super
 *  Sends only their OWN finalized reports); everyone else just Views. */
function actionFor(status: RailStatus, canEditThis: boolean): string {
  switch (status) {
    case 'processing':
      return canEditThis ? 'Review' : 'View';
    case 'draft':
      return canEditThis ? 'Continue' : 'View';
    case 'finalized':
      return canEditThis ? 'Send' : 'View';
    case 'sent':
      return 'View';
  }
}

function RailRow({ r, canEditThis }: { r: ReportListRow; canEditThis: boolean }) {
  const status = railStatusOf(r);
  const { day, mon } = dateBlock(r.date);
  const action = actionFor(status, canEditThis);
  // The Send pill deep-links into the review page with the Send modal open.
  const href = `/review/${encodeURIComponent(r.id)}${action === 'Send' ? '?send=1' : ''}`;
  return (
    <Link to={href} className={`rail-row rail-${status}`}>
      <span className="rail-date">
        <span className="day">{day}</span>
        <br />
        <span className="mon">{mon}</span>
      </span>
      <span className="rail-main">
        <span className="rail-title">{titleOf(r)}</span>
        <span className="rail-meta">
          <Avatar name={r.superName} size="sm" />
          {r.superName}
          <span aria-hidden="true">·</span>
          {r.observations.length} observation{r.observations.length === 1 ? '' : 's'}
        </span>
      </span>
      <span className="rail-right">
        {r.lastSend && (
          <span className="opened">
            {r.lastSend.opened}/{r.lastSend.total} opened
          </span>
        )}
        <StatusChip status={status} />
        <span className={action === 'View' ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}>
          {action}
        </span>
      </span>
    </Link>
  );
}

export function ReportsListPage() {
  const { projectId = '' } = useParams();
  const ws = useWorkspace();
  const [rows, setRows] = useState<ReportListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [reloadKey, setReloadKey] = useState(0);

  const project = ws.projects?.find((p) => p.id === projectId);
  const role = effectiveRole(ws, project);
  const writable = canWork(role);

  useEffect(() => {
    if (project) ws.rememberProject(project.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remember once per project
  }, [project?.id]);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    listReports(projectId)
      .then((r) => {
        if (!alive) return;
        // Newest first (walk date, then creation time as the tiebreaker).
        r.sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
        );
        setRows(r);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [projectId, reloadKey]);

  const visible = (rows ?? []).filter((r) => matches(filter, railStatusOf(r)));

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{project?.name ?? rows?.[0]?.projectName ?? 'Reports'}</h1>
          <div className="row" style={{ gap: 8 }}>
            {project?.visibility && (
              <span className="schip schip-proc">
                {project.visibility === 'org' ? 'Org-visible' : 'Assigned only'}
              </span>
            )}
            {rows && (
              <span className="page-count">
                {rows.length} report{rows.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Filter reports">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={filter === f.key ? 'tab active' : 'tab'}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!rows ? (
        <Loading message="Loading reports…" />
      ) : visible.length === 0 ? (
        <div className="empty">
          <h2>{filter === 'all' ? 'No reports yet' : 'Nothing here'}</h2>
          <p>
            {filter === 'all'
              ? writable
                ? 'Start a walk on your phone — reports land here as soon as they upload.'
                : 'Finalized reports will appear here.'
              : 'Try a different filter.'}
          </p>
        </div>
      ) : (
        <div className="rail-list">
          {visible.map((r) => (
            <RailRow
              key={r.id}
              r={r}
              canEditThis={
                role === 'admin' ||
                role === 'pm' ||
                (role === 'super' && r.createdBy === ws.user.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
