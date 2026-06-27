import { useState } from 'react';
import { useOnline } from '../hooks/useOnline';
import { syncWalk, type SyncProgress } from '../sync';
import { reviewUrl } from '../config';
import { recordSubmittedReport } from '../lib/reports';

interface Props {
  walkId: string;
  observationCount: number;
  onDone: () => void;
}

/**
 * Foreground sync UI (spec §7). Shows a visible overall progress bar and a
 * per-attempt status line, retries on failure with backoff, and offers a clear
 * retry button. On success the acked observations are cleared by syncWalk.
 */
export function SyncPanel({ walkId, observationCount, onDone }: Props) {
  const online = useOnline();
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setProgress({ totalObservations: observationCount, fraction: 0, phase: 'building' });
    try {
      const result = await syncWalk(walkId, setProgress);
      recordSubmittedReport(result.reportId, observationCount);
      setReportId(result.reportId);
      setDone(true);
    } catch {
      // error surfaced via progress.phase === 'error'
    } finally {
      setRunning(false);
    }
  }

  const pct = Math.round((progress?.fraction ?? 0) * 100);
  const isError = progress?.phase === 'error';

  return (
    <div className="card">
      <div className="section-title">Sync this walk</div>
      <p className="muted" style={{ marginTop: 0 }}>
        {observationCount} observation{observationCount === 1 ? '' : 's'} ready to upload.
      </p>

      {!online && (
        <p className="err">You're offline. Connect to Wi-Fi or cell data, then Sync. Nothing is lost.</p>
      )}

      {running && (
        <>
          <div className="bar" style={{ marginBottom: 8 }}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            {progress?.phase === 'building'
              ? 'Packaging…'
              : progress?.phase === 'uploading'
                ? `Uploading… ${pct}%`
                : ''}
          </p>
          {progress?.message && <p className="muted">{progress.message}</p>}
        </>
      )}

      {isError && !running && (
        <p className="err">Upload failed: {progress?.message}</p>
      )}

      {done ? (
        <>
          <p style={{ color: 'var(--ok)', fontWeight: 800 }}>✓ Uploaded — your report is being written up.</p>
          <p className="muted" style={{ marginTop: 0 }}>
            Transcribing and drafting takes about a minute. Open the review page to read it,
            fix any wording, and send — it updates on its own while it's preparing.
          </p>
          {reportId && (
            <a
              className="btn btn-brand btn-lg"
              href={reviewUrl(reportId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Review &amp; send report →
            </a>
          )}
          <button className="btn btn-ghost" onClick={onDone}>
            Start a new walk
          </button>
        </>
      ) : (
        <button className="btn btn-primary btn-lg" disabled={running || !online} onClick={run}>
          {running ? 'Syncing…' : isError ? 'Retry Sync' : '☁︎ Sync Now'}
        </button>
      )}
    </div>
  );
}
