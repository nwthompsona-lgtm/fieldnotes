import { useCallback, useEffect, useState } from 'react';
import { isStandalone } from './lib/install';
import { MoveScreen } from './components/MoveScreen';
import { Onboarding } from './components/Onboarding';
import { CaptureFlow } from './components/CaptureFlow';
import { HomeScreen } from './components/HomeScreen';
import { ReviewScreen } from './components/ReviewScreen';
import { ReportScreen } from './components/ReportScreen';
import { LoginScreen } from './components/LoginScreen';
import { ProjectPickerScreen } from './components/ProjectPickerScreen';
import {
  finishWalk,
  getObservationsForWalk,
  getOrCreateActiveWalk,
  getPendingWalks,
  walkByteSize,
} from './repo';
import { useOnline } from './hooks/useOnline';
import { useTheme } from './hooks/useTheme';
import { useSessionToken, useAccount, useActiveProject } from './hooks/useWorkspace';
import { me } from './lib/authApi';
import { setAccount } from './lib/session';

type Screen = 'home' | 'capture' | 'review' | 'report';

export function App() {
  const online = useOnline();
  const { theme, toggle: toggleTheme } = useTheme();

  // Onboarding gate (spec §2). DEV escape hatch only.
  const [installed, setInstalled] = useState<boolean>(isStandalone());
  const [devBypass, setDevBypass] = useState(false);

  // Auth + project gates (Phase 11 / F3): session bearer → picked project → capture.
  const sessionToken = useSessionToken();
  const account = useAccount();
  const pickedProject = useActiveProject();
  const [repicking, setRepicking] = useState(false);

  // Workspace state is bound to the account that picked it: a 401-forced logout clears
  // only the session (walks in IndexedDB survive by design), so a persisted activeProject
  // would otherwise leak into the NEXT login — possibly a different account on a shared
  // device — skipping the picker and capturing into the previous user's project. A
  // mismatched owner (or a legacy record without one, handled in getActiveProject) is
  // treated as unset, which re-opens the picker.
  const activeProject =
    pickedProject && account && pickedProject.ownerUserId === account.id ? pickedProject : null;

  const [walkId, setWalkId] = useState<string | null>(null);
  const [pendingWalkId, setPendingWalkId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [reportId, setReportId] = useState<string | null>(null);
  // 15c: this origin is retired — the default face is the move screen. The old app
  // stays reachable behind it ONLY to finish syncing walk data (per-origin IndexedDB
  // can't move to the new origin).
  const [stayForSync, setStayForSync] = useState(false);

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

  // Session hygiene: when online with a stored token, refresh the cached account (name
  // changes, and a revoked/expired session surfaces as a 401, which clears the token and
  // drops the app back to login). Offline, the cached account keeps the app usable.
  useEffect(() => {
    if (!sessionToken || !online) return;
    me()
      .then((who) => setAccount(who.user))
      .catch(() => {
        /* 401 already cleared the session; network blips change nothing */
      });
  }, [sessionToken, online]);

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

  // 15c — the retirement gate comes FIRST: whoever lands here (the installed legacy
  // PWA above all) gets sent to the new origin. "Data at risk" = a finished walk
  // waiting to sync OR observations on the active walk; those users may drop back
  // into the old app to finish, everyone else only gets the move screen.
  if (!stayForSync) {
    return (
      <MoveScreen
        dataAtRisk={pendingWalkId !== null || obsCount > 0}
        checking={gateOpen && walkId === null}
        onStay={() => setStayForSync(true)}
      />
    );
  }

  if (!gateOpen) {
    return (
      <Onboarding
        onEnter={() => setInstalled(isStandalone())}
        onContinueAnyway={import.meta.env.DEV ? () => setDevBypass(true) : undefined}
      />
    );
  }

  // Login gate: no session bearer → log in (capture data in IndexedDB is untouched, so
  // a mid-walk logout/401 loses nothing; sync resumes after the next login).
  if (!sessionToken) {
    return <LoginScreen onLoggedIn={() => setRepicking(false)} />;
  }

  // Project gate: capture always attributes to a picked project (replaces free text).
  if (!activeProject || repicking) {
    return (
      <ProjectPickerScreen
        online={online}
        onPicked={() => setRepicking(false)}
        onBack={activeProject && repicking ? () => setRepicking(false) : undefined}
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
      projectName={activeProject.projectName}
      onSwitchProject={() => setRepicking(true)}
      onNewObservation={() => setScreen('capture')}
      onDone={handleFinishWalk}
      onOpenPending={() => setScreen('review')}
      onOpenReport={openReport}
      onChanged={bump}
    />
  );
}
