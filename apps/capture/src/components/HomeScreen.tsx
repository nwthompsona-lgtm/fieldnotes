import { useEffect, useState } from 'react';
import { Icon, Logo } from './Icon';
import { RunningList } from './RunningList';
import { formatBytes, formatRelativeAt } from '../lib/format';
import { getSubmittedReports, type SubmittedReport } from '../lib/reports';
import type { Theme } from '../lib/theme';

interface Props {
  walkId: string | null;
  obsCount: number;
  bytes: number;
  online: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  refreshKey: number;
  pendingWalkId: string | null;
  onNewObservation: () => void;
  onDone: () => void;
  onOpenPending: () => void;
  onOpenReport: (reportId: string) => void;
  onChanged: () => void;
}

/** Home — the walk dashboard. Stat card, new-observation CTA, captured list,
 *  submitted reports, and the sticky "Done — review & sync" bar. */
export function HomeScreen({
  walkId,
  obsCount,
  bytes,
  online,
  theme,
  onToggleTheme,
  refreshKey,
  pendingWalkId,
  onNewObservation,
  onDone,
  onOpenPending,
  onOpenReport,
  onChanged,
}: Props) {
  return (
    <div className="screen">
      <div className="sticky-header">
        <div className="header-row" style={{ justifyContent: 'space-between' }}>
          <div className="header-row" style={{ gap: 9 }}>
            <span
              style={{
                display: 'flex',
                width: 30,
                height: 30,
                borderRadius: 9,
                background: 'var(--primary-soft)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Logo size={18} fill="var(--primary)" ink="var(--primary-ink)" />
            </span>
            <span className="display" style={{ fontWeight: 700, fontSize: 19 }}>
              FieldReport
            </span>
          </div>
          <div className="header-row" style={{ gap: 8 }}>
            <button
              className="icon-btn"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to Daylight' : 'Switch to Nightshift'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
            <span className="status-pill">
              <span className={`status-dot ${online ? 'online' : 'offline'}`} />
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      <div className="screen-body">
        {/* This-walk stat card */}
        <div className="card">
          <div className="label">This walk</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 11, marginTop: 6 }}>
            <span className="display" style={{ fontWeight: 800, fontSize: 60, lineHeight: 0.86 }}>
              {obsCount}
            </span>
            <span
              className="muted"
              style={{ fontSize: 15, fontWeight: 600, paddingBottom: 9, lineHeight: 1.2 }}
            >
              observation{obsCount === 1 ? '' : 's'}
              <br />
              captured
            </span>
          </div>
          <div
            className="muted"
            style={{ marginTop: 15, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
          >
            <Icon name="drive" size={15} />~{formatBytes(bytes)} stored · safe on device
          </div>
        </div>

        {/* New observation — the hero action */}
        <button className="btn btn-primary btn-xl" onClick={onNewObservation}>
          <Icon name="camera" size={22} strokeWidth={1.9} />
          New observation
        </button>

        {/* Pending-walk safety net (a finished walk awaiting upload) */}
        {pendingWalkId && (
          <button
            onClick={onOpenPending}
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textAlign: 'left',
              cursor: 'pointer',
              border: '1.5px solid var(--primary)',
              width: '100%',
            }}
          >
            <span
              style={{
                display: 'flex',
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'var(--primary-soft)',
                color: 'var(--primary)',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
              }}
            >
              <Icon name="cloud" size={20} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5, color: 'var(--fg)' }}>
                A walk is ready to sync
              </span>
              <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                Tap to review &amp; upload
              </span>
            </span>
            <span style={{ color: 'var(--primary)', flex: '0 0 auto' }}>
              <Icon name="chevronRight" size={18} strokeWidth={2.1} />
            </span>
          </button>
        )}

        {/* Captured (this walk) */}
        {obsCount > 0 && walkId && (
          <div>
            <div className="label" style={{ marginBottom: 10 }}>
              Captured
            </div>
            <RunningList walkId={walkId} refreshKey={refreshKey} onChanged={onChanged} />
          </div>
        )}

        <SubmittedReports refreshKey={refreshKey} onOpen={onOpenReport} />
      </div>

      {obsCount > 0 && (
        <div className="bottom-bar">
          <button className="btn btn-secondary btn-lg" onClick={onDone}>
            Done — review &amp; sync
            <Icon name="chevronRight" size={17} strokeWidth={2.1} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Reports submitted from this device, each opening its in-app report view. */
function SubmittedReports({
  refreshKey,
  onOpen,
}: {
  refreshKey: number;
  onOpen: (reportId: string) => void;
}) {
  const [reports, setReports] = useState<SubmittedReport[]>([]);
  useEffect(() => {
    setReports(getSubmittedReports());
  }, [refreshKey]);

  if (reports.length === 0) return null;
  return (
    <div>
      <div className="label" style={{ marginBottom: 10 }}>
        Submitted reports
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {reports.map((r) => (
          <button
            key={r.id}
            onClick={() => onOpen(r.id)}
            style={{
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '13px 14px',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            <span
              style={{
                display: 'flex',
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'var(--primary-soft)',
                color: 'var(--primary)',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
              }}
            >
              <Icon name="doc" size={19} strokeWidth={1.7} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5, color: 'var(--fg)' }}>
                {formatRelativeAt(r.at)}
              </span>
              <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                {r.count} observation{r.count === 1 ? '' : 's'}
              </span>
            </span>
            <span
              style={{
                fontWeight: 700,
                fontSize: 13.5,
                color: 'var(--primary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                flex: '0 0 auto',
              }}
            >
              Open
              <Icon name="chevronRight" size={15} strokeWidth={2.1} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
