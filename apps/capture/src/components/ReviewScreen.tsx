import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { PhotoThumb } from './PhotoThumb';
import { db } from '../db';
import { getObservationsForWalk, getWalk, setWalkDetails } from '../repo';
import { syncWalk } from '../sync';
import { recordSubmittedReport } from '../lib/reports';
import { getAccount } from '../lib/session';
import { getActiveProject, recordCapture } from '../lib/activeProject';
import { formatBytes, formatLongDate } from '../lib/format';
import { walkByteSize } from '../repo';
import { getReportStatus } from '../lib/api';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Maps server processing status -> overall fraction for the second half of the bar,
// so progress keeps advancing through transcribe/synthesize/render, not just the upload.
const PROC_FRAC: Record<string, number> = {
  uploaded: 0.05,
  transcribing: 0.35,
  synthesizing: 0.7,
  rendering: 0.92,
  ready: 1,
  failed: 1,
};

/** Poll the report until it's ready/failed, reporting fraction (0..1). Returns whether
 *  it reached "ready". Times out after ~2min (report keeps processing server-side). */
async function pollProcessing(id: string, onFrac: (f: number) => void): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try {
      const s = await getReportStatus(id);
      onFrac(PROC_FRAC[s.processing] ?? 0.5);
      if (s.processing === 'ready') return true;
      if (s.processing === 'failed') return false;
    } catch {
      // transient (offline blip) — keep polling
    }
    await sleep(2000);
  }
  return false;
}

interface Props {
  pendingWalkId: string;
  online: boolean;
  onBack: () => void;
  onOpenReport: (reportId: string) => void;
  onNewWalk: () => void;
}

/** Review & sync: walk metadata is read-only — project comes from the picker, preparer
 *  from the logged-in account (design §CAPTURE "Review change") — then upload with live
 *  progress and hand off to the in-app report. */
export function ReviewScreen({ pendingWalkId, online, onBack, onOpenReport, onNewWalk }: Props) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [date, setDate] = useState('');

  // Provenance (design: "From picker" / "From login"). Both gates precede this screen,
  // so these are present in practice; the null fallbacks just keep a cleared-storage
  // edge case from syncing unattributed data.
  const account = getAccount();
  const activeProject = getActiveProject();
  const preparerName = account ? account.name?.trim() || account.email : '';

  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [phaseLabel, setPhaseLabel] = useState('Uploading…');
  const [done, setDone] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hydrate observation counts/thumbs for the summary card.
  useEffect(() => {
    let alive = true;
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
    })();
    return () => {
      alive = false;
    };
  }, [pendingWalkId]);

  // Stamp the account + picked project onto the durable walk row, so sync (which builds
  // the manifest from the store) and a crash-recovered walk both carry the right
  // attribution. Re-stamps if the user switches projects and comes back.
  useEffect(() => {
    if (!activeProject || !preparerName) return;
    void setWalkDetails(pendingWalkId, {
      superName: preparerName,
      projectName: activeProject.projectName,
      projectId: activeProject.projectId,
    });
  }, [pendingWalkId, activeProject?.projectId, preparerName]);

  const detailsReady = activeProject != null && preparerName.length > 0;

  async function runSync() {
    if (!detailsReady || !online) return;
    setErrorMsg(null);
    setRunning(true);
    setPhaseLabel('Uploading…');
    setPct(0);
    try {
      // Upload occupies the first half of the bar (real bytes via XHR progress).
      const result = await syncWalk(pendingWalkId, (p) => {
        if (p.phase === 'uploading') setPct(Math.round((p.fraction ?? 0) * 50));
      });
      recordSubmittedReport(result.reportId, count);
      if (activeProject) recordCapture(activeProject.projectId);
      setReportId(result.reportId);
      setPct(50);
      // Second half: the server writes the report (transcribe → synthesize → render).
      setPhaseLabel('Writing the report…');
      const ready = await pollProcessing(result.reportId, (f) => setPct(50 + Math.round(f * 50)));
      setPct(100);
      setReportReady(ready);
      setDone(true);
    } catch (e) {
      setErrorMsg((e as Error).message || 'Upload failed. Check your connection and retry.');
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

        {/* Report details — read-only, sourced from the picker + the login (F3). */}
        <div className="meta-card">
          <div className="meta-row">
            <span className="k">Project</span>
            <span className="v">{activeProject?.projectName ?? '—'}</span>
            <span className="locked-badge">
              <Icon name="lock" size={10} strokeWidth={2.4} />
              From picker
            </span>
          </div>
          <div className="meta-row">
            <span className="k">Preparer</span>
            <span className="v">{preparerName || '—'}</span>
            <span className="locked-badge">
              <Icon name="lock" size={10} strokeWidth={2.4} />
              From login
            </span>
          </div>
          <div className="meta-row">
            <span className="k">Date</span>
            <span className="v">{date ? formatLongDate(date) : '—'}</span>
          </div>
        </div>

        <div className="note note-info">
          <Icon name="info" size={16} strokeWidth={1.9} />
          <span>
            <b>Changed:</b> project and preparer now come from your login and the project you
            picked — no longer typed by hand.
          </span>
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
            {errorMsg && (
              <p className="err" style={{ marginBottom: 0 }}>
                {errorMsg}
              </p>
            )}
            {!detailsReady && (
              <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
                Log in and pick a project to sync.
              </p>
            )}
            <button
              className="btn btn-primary btn-lg"
              style={{ marginTop: 16 }}
              disabled={!detailsReady || !online}
              onClick={runSync}
            >
              <Icon name="cloud" size={22} />
              {errorMsg ? 'Retry sync' : 'Sync now'}
            </button>
          </div>
        )}

        {running && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{phaseLabel}</span>
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
              {phaseLabel === 'Uploading…'
                ? 'Keep the app open while it uploads.'
                : 'Transcribing and drafting your report…'}
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
              {reportReady ? 'Report ready' : 'Uploaded'}
            </div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.45 }}>
              {reportReady
                ? 'Your report is ready — review the draft and send it.'
                : 'Your report is being written up — this can take a minute.'}
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
