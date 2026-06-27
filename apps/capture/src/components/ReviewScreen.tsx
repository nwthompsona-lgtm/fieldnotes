import { useEffect, useId, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { PhotoThumb } from './PhotoThumb';
import { db } from '../db';
import { getObservationsForWalk, getWalk, setWalkDetails } from '../repo';
import { syncWalk, type SyncProgress } from '../sync';
import { recordSubmittedReport } from '../lib/reports';
import {
  getPreparerName,
  getRecentProjects,
  projectIdForName,
  recordProject,
  setPreparerName,
} from '../lib/profile';
import { formatBytes, formatLongDate } from '../lib/format';
import { walkByteSize } from '../repo';

// The OLD build baked this placeholder; treat it as "unset" so the user is asked.
const STALE_NAME = 'Pilot Super';

interface Props {
  pendingWalkId: string;
  online: boolean;
  onBack: () => void;
  onOpenReport: (reportId: string) => void;
  onNewWalk: () => void;
}

/** Review & sync: confirm walk metadata (required name + project), upload with live
 *  progress, then hand off to the in-app report. */
export function ReviewScreen({ pendingWalkId, online, onBack, onOpenReport, onNewWalk }: Props) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [date, setDate] = useState('');

  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [done, setDone] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  const listId = useId();

  // Hydrate observations + walk details. Reset `hydrated` first so a different walk
  // never persists the prior walk's details before its own values are loaded.
  useEffect(() => {
    let alive = true;
    setHydrated(false);
    (async () => {
      const [walk, obs] = await Promise.all([getWalk(pendingWalkId), getObservationsForWalk(pendingWalkId)]);
      const firstPhotos: string[] = [];
      for (const o of obs) {
        const photos = await db.photos.where('obsId').equals(o.id).sortBy('order');
        if (photos[0]) firstPhotos.push(photos[0].id);
      }
      if (!alive) return;
      setThumbs(firstPhotos);
      setCount(obs.length);
      setBytes(await walkByteSize(pendingWalkId));
      setDate(walk?.date ?? '');
      const savedName = getPreparerName();
      const walkName = walk?.superName && walk.superName !== STALE_NAME ? walk.superName : '';
      setName(walkName || savedName);
      setProject(walk?.projectName ?? '');
      setRecent(getRecentProjects());
      setHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, [pendingWalkId]);

  // Persist details to the durable walk whenever a hydrated value changes.
  useEffect(() => {
    if (!hydrated) return;
    const n = name.trim();
    const p = project.trim();
    void setWalkDetails(pendingWalkId, {
      superName: n,
      projectName: p,
      projectId: p ? projectIdForName(p) : '',
    });
  }, [name, project, hydrated, pendingWalkId]);

  const detailsReady = name.trim().length > 0 && project.trim().length > 0;
  const pct = Math.round((progress?.fraction ?? 0) * 100);
  const isError = progress?.phase === 'error';

  async function runSync() {
    if (!detailsReady || !online) return;
    setRunning(true);
    setProgress({ totalObservations: count, fraction: 0, phase: 'building' });
    try {
      const result = await syncWalk(pendingWalkId, setProgress);
      recordSubmittedReport(result.reportId, count);
      setReportId(result.reportId);
      setDone(true);
    } catch {
      // surfaced via progress.phase === 'error'
    } finally {
      setRunning(false);
    }
  }

  const shownThumbs = useMemo(() => thumbs.slice(0, 5), [thumbs]);
  const overflow = thumbs.length - shownThumbs.length;

  return (
    <div className="screen">
      <div className="sticky-header">
        <div className="header-row">
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="chevronLeft" size={18} strokeWidth={2.1} />
          </button>
          <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>
            Review &amp; sync
          </div>
        </div>
      </div>

      <div className="screen-body">
        {/* Summary */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="display" style={{ fontWeight: 800, fontSize: 34, lineHeight: 1 }}>
              {count}
            </span>
            <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
              observation{count === 1 ? '' : 's'} · ~{formatBytes(bytes)}
            </span>
          </div>
          {shownThumbs.length > 0 && (
            <div style={{ display: 'flex', gap: 7, marginTop: 14 }}>
              {shownThumbs.map((pid) => (
                <div
                  key={pid}
                  style={{
                    position: 'relative',
                    flex: 1,
                    aspectRatio: '1',
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                  }}
                >
                  <PhotoThumb photoId={pid} className="thumb-cover" />
                </div>
              ))}
              {overflow > 0 && (
                <div
                  className="muted"
                  style={{
                    flex: 1,
                    aspectRatio: '1',
                    borderRadius: 10,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  +{overflow}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Required details */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="label">Report details</div>
          <div className="field">
            <label htmlFor={`${listId}-project`}>Project</label>
            <input
              id={`${listId}-project`}
              className="input"
              type="text"
              list={listId}
              autoCapitalize="words"
              placeholder="e.g. Riverside Tower B"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              onBlur={() => {
                if (project.trim()) {
                  recordProject(project);
                  setRecent(getRecentProjects());
                }
              }}
            />
            <datalist id={listId}>
              {recent.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor={`${listId}-name`}>Your name</label>
            <input
              id={`${listId}-name`}
              className="input"
              type="text"
              autoComplete="name"
              placeholder="e.g. Sam Rivera"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setPreparerName(name)}
            />
            <span className="hint">Shown on the report as who prepared it.</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
            <span className="muted">Date</span>
            <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{date ? formatLongDate(date) : '—'}</span>
          </div>
        </div>

        {/* State-driven block */}
        {!online && !done && (
          <div
            style={{
              display: 'flex',
              gap: 11,
              alignItems: 'flex-start',
              background: 'var(--surface)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              padding: 14,
            }}
          >
            <span style={{ color: 'var(--danger)', flex: '0 0 auto', marginTop: 1 }}>
              <Icon name="alert" size={20} strokeWidth={1.9} />
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--fg)', lineHeight: 1.4 }}>
              You're offline. Connect to Wi-Fi or cell, then sync — <b>nothing is lost</b>.
            </span>
          </div>
        )}

        {!running && !done && (
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 16 }}>Ready to upload</div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.45 }}>
              Uploads over Wi-Fi or cell with a live progress bar. Transcription and the draft start
              automatically.
            </div>
            {isError && progress?.message && (
              <p className="err" style={{ marginBottom: 0 }}>
                Upload failed: {progress.message}
              </p>
            )}
            {!detailsReady && (
              <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                Add your name and project above to sync.
              </p>
            )}
            <button
              className="btn btn-primary btn-lg"
              style={{ marginTop: 16 }}
              disabled={!detailsReady || !online}
              onClick={runSync}
            >
              <Icon name="cloud" size={22} />
              {isError ? 'Retry sync' : 'Sync now'}
            </button>
          </div>
        )}

        {running && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Uploading…</span>
              <span
                className="display tabular"
                style={{ fontWeight: 700, fontSize: 16, color: 'var(--primary)' }}
              >
                {pct}%
              </span>
            </div>
            <div className="progress" style={{ marginTop: 12 }}>
              <div className="fill" style={{ width: `${pct}%` }} />
              <div className="sheen" />
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              {progress?.message ?? 'Keep the app open while it uploads.'}
            </div>
          </div>
        )}

        {done && (
          <div className="card" style={{ textAlign: 'center' }}>
            <div
              style={{
                margin: '0 auto',
                width: 64,
                height: 64,
                borderRadius: 999,
                background: 'var(--primary-soft)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'pop .4s ease both',
              }}
            >
              <Icon name="check" size={34} strokeWidth={2.4} />
            </div>
            <div className="display" style={{ fontWeight: 700, fontSize: 19, marginTop: 12 }}>
              Uploaded
            </div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.45 }}>
              Your report is being written up — transcribing and drafting takes about a minute.
            </div>
            {reportId && (
              <button
                className="btn btn-primary btn-lg"
                style={{ marginTop: 16 }}
                onClick={() => onOpenReport(reportId)}
              >
                Review &amp; send report
                <Icon name="chevronRight" size={17} strokeWidth={2.1} />
              </button>
            )}
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onNewWalk}>
              Start a new walk
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
