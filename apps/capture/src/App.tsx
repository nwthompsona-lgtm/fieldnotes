import { useCallback, useEffect, useState } from 'react';
import { isStandalone } from './lib/install';
import { Onboarding } from './components/Onboarding';
import { TopBar } from './components/TopBar';
import { CaptureFlow } from './components/CaptureFlow';
import { RunningList } from './components/RunningList';
import { SyncPanel } from './components/SyncPanel';
import {
  finishWalk,
  getObservationsForWalk,
  getOrCreateActiveWalk,
  getPendingWalks,
  walkByteSize,
} from './repo';
import { formatBytes } from './lib/format';
import { useOnline } from './hooks/useOnline';

type Screen = 'capture' | 'review';

export function App() {
  const online = useOnline();

  // Onboarding gate (spec §2). DEV escape hatch only.
  const [installed, setInstalled] = useState<boolean>(isStandalone());
  const [devBypass, setDevBypass] = useState(false);

  const [walkId, setWalkId] = useState<string | null>(null);
  const [pendingWalkId, setPendingWalkId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('capture');
  const [capturing, setCapturing] = useState(false);

  const [obsCount, setObsCount] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Re-check standalone on visibility changes (user may install then return).
  useEffect(() => {
    const check = () => setInstalled(isStandalone());
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  const gateOpen = installed || devBypass;

  // Boot: load/create the active walk and detect any pending (un-synced) walk.
  useEffect(() => {
    if (!gateOpen) return;
    (async () => {
      const pending = await getPendingWalks();
      if (pending.length > 0 && pending[0]) {
        setPendingWalkId(pending[0].id);
        setScreen('review');
      }
      const active = await getOrCreateActiveWalk();
      setWalkId(active.id);
    })();
  }, [gateOpen]);

  const refreshTotals = useCallback(async (id: string) => {
    const obs = await getObservationsForWalk(id);
    setObsCount(obs.length);
    setBytes(await walkByteSize(id));
  }, []);

  useEffect(() => {
    if (walkId) refreshTotals(walkId);
  }, [walkId, refreshKey, refreshTotals]);

  // Auto-prompt sync on open if a pending walk exists and we're online (spec §7).
  // We surface the review screen (with the Sync button) rather than auto-firing,
  // so the upload is always foreground + visible.
  useEffect(() => {
    if (pendingWalkId && online) setScreen('review');
  }, [pendingWalkId, online]);

  function bump() {
    setRefreshKey((k) => k + 1);
  }

  async function handleFinishWalk() {
    if (!walkId) return;
    await finishWalk(walkId);
    setPendingWalkId(walkId);
    setWalkId(null);
    setScreen('review');
  }

  async function handleSyncDone() {
    setPendingWalkId(null);
    setScreen('capture');
    // start a fresh active walk
    const active = await getOrCreateActiveWalk();
    setWalkId(active.id);
    bump();
  }

  if (!gateOpen) {
    return <Onboarding onContinueAnyway={import.meta.env.DEV ? () => setDevBypass(true) : undefined} />;
  }

  return (
    <div className="app">
      <TopBar pendingObservations={obsCount} />

      <main className="main">
        {screen === 'review' && pendingWalkId ? (
          <ReviewScreen
            pendingWalkId={pendingWalkId}
            onBackToCapture={() => setScreen('capture')}
            onSyncDone={handleSyncDone}
          />
        ) : (
          <>
            <div className="card center">
              <div className="big-count">{obsCount}</div>
              <div className="muted">
                observation{obsCount === 1 ? '' : 's'} this walk · ~{formatBytes(bytes)} stored
              </div>
            </div>

            {capturing ? (
              walkId && (
                <CaptureFlow
                  walkId={walkId}
                  onSaved={() => {
                    setCapturing(false);
                    bump();
                  }}
                  onCancel={() => {
                    setCapturing(false);
                    bump();
                  }}
                />
              )
            ) : (
              <button className="btn btn-primary btn-lg" onClick={() => setCapturing(true)}>
                ＋ New Observation
              </button>
            )}

            {walkId && (
              <>
                <div className="section-title">This walk</div>
                <RunningList walkId={walkId} refreshKey={refreshKey} onChanged={bump} />
              </>
            )}

            {obsCount > 0 && !capturing && (
              <button className="btn btn-brand btn-lg" onClick={handleFinishWalk}>
                Done — Review & Sync
              </button>
            )}

            {pendingWalkId && (
              <button className="btn btn-outline" onClick={() => setScreen('review')}>
                You have a walk pending upload →
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** Review + sync screen for a finished (pending) walk. */
function ReviewScreen({
  pendingWalkId,
  onBackToCapture,
  onSyncDone,
}: {
  pendingWalkId: string;
  onBackToCapture: () => void;
  onSyncDone: () => void;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    getObservationsForWalk(pendingWalkId).then((o) => setCount(o.length));
  }, [pendingWalkId]);

  return (
    <>
      <div className="section-title">Review &amp; Sync</div>
      <RunningList walkId={pendingWalkId} refreshKey={count} onChanged={() => {
        getObservationsForWalk(pendingWalkId).then((o) => setCount(o.length));
      }} />
      <SyncPanel walkId={pendingWalkId} observationCount={count} onDone={onSyncDone} />
      <button className="btn btn-ghost" onClick={onBackToCapture}>
        ← Back to capture
      </button>
    </>
  );
}
