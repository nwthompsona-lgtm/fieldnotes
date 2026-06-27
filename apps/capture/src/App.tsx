import { useCallback, useEffect, useState } from 'react';
import { isStandalone } from './lib/install';
import { Onboarding } from './components/Onboarding';
import { CaptureFlow } from './components/CaptureFlow';
import { HomeScreen } from './components/HomeScreen';
import { ReviewScreen } from './components/ReviewScreen';
import { ReportScreen } from './components/ReportScreen';
import {
  finishWalk,
  getObservationsForWalk,
  getOrCreateActiveWalk,
  getPendingWalks,
  walkByteSize,
} from './repo';
import { useOnline } from './hooks/useOnline';
import { useTheme } from './hooks/useTheme';

type Screen = 'home' | 'capture' | 'review' | 'report';

export function App() {
  const online = useOnline();
  const { theme, toggle: toggleTheme } = useTheme();

  // Onboarding gate (spec §2). DEV escape hatch only.
  const [installed, setInstalled] = useState<boolean>(isStandalone());
  const [devBypass, setDevBypass] = useState(false);

  const [walkId, setWalkId] = useState<string | null>(null);
  const [pendingWalkId, setPendingWalkId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [reportId, setReportId] = useState<string | null>(null);

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
      if (pending.length > 0 && pending[0]) setPendingWalkId(pending[0].id);
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

  // Auto-surface review on open if a pending walk exists and we're online (spec §7).
  useEffect(() => {
    if (pendingWalkId && online && screen === 'home') setScreen('review');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWalkId, online]);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  async function handleFinishWalk() {
    if (!walkId) return;
    await finishWalk(walkId);
    setPendingWalkId(walkId);
    // Immediately open a fresh active walk so capture always has a valid target
    // and the finished walk is preserved (pending) until it syncs.
    const next = await getOrCreateActiveWalk();
    setWalkId(next.id);
    setScreen('review');
    bump();
  }

  function openReport(id: string) {
    setReportId(id);
    setScreen('report');
  }

  async function handleSyncDone() {
    setPendingWalkId(null);
    const active = await getOrCreateActiveWalk();
    setWalkId(active.id);
    setScreen('home');
    bump();
  }

  if (!gateOpen) {
    return (
      <Onboarding
        onEnter={() => setInstalled(isStandalone())}
        onContinueAnyway={import.meta.env.DEV ? () => setDevBypass(true) : undefined}
      />
    );
  }

  if (screen === 'capture' && walkId) {
    return (
      <CaptureFlow
        walkId={walkId}
        onSaved={() => {
          setScreen('home');
          bump();
        }}
        onCancel={() => {
          setScreen('home');
          bump();
        }}
      />
    );
  }

  if (screen === 'review' && pendingWalkId) {
    return (
      <ReviewScreen
        pendingWalkId={pendingWalkId}
        online={online}
        onBack={() => setScreen('home')}
        onOpenReport={openReport}
        onNewWalk={handleSyncDone}
      />
    );
  }

  if (screen === 'report' && reportId) {
    return <ReportScreen reportId={reportId} online={online} onBack={() => setScreen('home')} />;
  }

  return (
    <HomeScreen
      walkId={walkId}
      obsCount={obsCount}
      bytes={bytes}
      online={online}
      theme={theme}
      onToggleTheme={toggleTheme}
      refreshKey={refreshKey}
      pendingWalkId={pendingWalkId}
      onNewObservation={() => setScreen('capture')}
      onDone={handleFinishWalk}
      onOpenPending={() => setScreen('review')}
      onOpenReport={openReport}
      onChanged={bump}
    />
  );
}
