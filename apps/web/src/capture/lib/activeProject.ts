// The picked project (Phase 11 / F3) — device state that replaces the old free-text
// project entry (lib/profile.ts). The picker writes it; Review + sync read it; walks
// are stamped with it. Persisted so a relaunch (or an offline session) keeps capturing
// into the same project without a network round-trip.
//
// Alongside it: a most-recent-first capture history (drives the picker's "Recent"
// highlight + "Last walk …" meta) and a cache of the last capture-capable project list
// so the picker can still render in a dead zone.

export interface ActiveProject {
  projectId: string;
  projectName: string;
  orgId: string;
  orgName: string;
  /** Account (PublicUser.id) that picked this project. Workspace state is bound to the
   *  account: a 401-forced logout clears only the session, so without this binding the
   *  NEXT login — possibly a different account on a shared device — would skip the picker
   *  and capture into the previous user's project. */
  ownerUserId: string;
}

/** A pickable (capture-capable) project as shown in the picker (no owner — ownership is
 *  stamped at pick time from the logged-in account). */
export interface PickableProject extends Omit<ActiveProject, 'ownerUserId'> {
  /** ISO timestamp of the last capture into this project from this device, if any. */
  lastCaptureAt?: string;
}

const ACTIVE_KEY = 'fieldreport.activeProject';
const HISTORY_KEY = 'fieldreport.captureHistory'; // { [projectId]: ISO last-capture }
const CACHE_KEY = 'fieldreport.projectCache'; // PickableProject[] (last online fetch)
const HISTORY_MAX = 24;

const listeners = new Set<() => void>();

export function getActiveProject(): ActiveProject | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveProject>;
    // Legacy records (pre-ownerUserId) can't be attributed to an account — treat them as
    // unset so the picker runs once and re-persists with ownership.
    if (!parsed.projectId || !parsed.ownerUserId) return null;
    return parsed as ActiveProject;
  } catch {
    return null;
  }
}

export function setActiveProject(p: ActiveProject): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — selection lives only for this session */
  }
  emit();
}

export function clearActiveProject(): void {
  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** Record "this device captured into project X just now" (called on successful sync). */
export function recordCapture(projectId: string): void {
  try {
    const map = readHistory();
    map[projectId] = new Date().toISOString();
    const entries = Object.entries(map)
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* non-fatal — the picker just won't show "Last walk" for this one */
  }
}

export function lastCaptureAt(projectId: string): string | undefined {
  return readHistory()[projectId];
}

function readHistory(): Record<string, string> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Cache the last successfully fetched pickable-project list (offline picker). */
export function cacheProjects(list: PickableProject[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    /* non-fatal */
  }
}

export function getCachedProjects(): PickableProject[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PickableProject[]) : [];
  } catch {
    return [];
  }
}

/** Wipe all workspace device-state (sign-out) — including the capture history, which
 *  would otherwise leak "Last walk …" timestamps across accounts on a shared device. */
export function clearWorkspaceState(): void {
  try {
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function subscribeActiveProject(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

// Reflect a project switch performed in another tab (mirror of session.ts's listener) —
// useWorkspace promises cross-tab propagation, and without this the event never reaches
// the in-page subscribers.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ACTIVE_KEY) emit();
  });
}
