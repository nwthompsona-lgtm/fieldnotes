import { useState } from 'react';
import { useOnline } from '../hooks/useOnline';
import { syncWalk, type SyncProgress } from '../sync';

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

  async function run() {
    setRunning(true);
    setProgress({ totalObservations: observationCount, fraction: 0, phase: 'building' });
    try {
      await syncWalk(walkId, setProgress);
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
          <p style={{ color: 'var(--ok)', fontWeight: 800 }}>✓ Uploaded. Local copy cleared.</p>
          <button className="btn btn-brand" onClick={onDone}>
            Done
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
