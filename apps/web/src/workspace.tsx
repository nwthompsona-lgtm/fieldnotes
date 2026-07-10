/**
 * Workspace context (design handoff §App shell): the logged-in user, their orgs, the
 * current org, and the current org's projects (with the caller's per-project role).
 * `currentOrgId` + the last-visited project persist in localStorage so a returning user
 * lands where they left off. The org/project switchers and every scoped query read from
 * here (README: "currentOrgId, currentProjectId drive the switchers + scope every query").
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Me, OrgRole, ProjectRole } from '@fieldreport/contracts';
import { me as fetchMe, listProjects, logout, type ProjectWithRole } from './authApi';
import { LAST_ORG_KEY, lastProjectKey } from './config';
import { getSessionToken } from './session';
import { Loading, ErrorState } from './components/ui';

export type WorkspaceOrg = Me['orgs'][number];

export interface Workspace {
  user: Me['user'];
  orgs: WorkspaceOrg[];
  /** Current org — null only when the user belongs to no org at all. */
  org: WorkspaceOrg | null;
  orgRole: OrgRole | null;
  /** Projects in the current org; null while (re)loading. */
  projects: ProjectWithRole[] | null;
  /** Re-fetch the project list (after create / visibility change in Settings). */
  reloadProjects(): void;
  switchOrg(orgId: string): void;
  /** Last-visited project in the current org, validated against `projects`. */
  defaultProjectId: string | null;
  rememberProject(projectId: string): void;
  signOut(): Promise<void>;
}

/** The caller's effective role on a project, per the permission matrix: an org admin
 *  acts as admin everywhere; otherwise the explicit project role; null = the project is
 *  visible only through org visibility (read-only, like a viewer). */
export function effectiveRole(
  ws: Pick<Workspace, 'orgRole'>,
  project: ProjectWithRole | undefined,
): 'admin' | ProjectRole | null {
  if (ws.orgRole === 'admin') return 'admin';
  return project?.role ?? null;
}

/** Capture / edit / send-capable roles (matrix rows 1–3). */
export function canWork(role: 'admin' | ProjectRole | null): boolean {
  return role === 'admin' || role === 'pm' || role === 'super';
}

/** Whether the caller may edit / finalize / send a SPECIFIC report (D-7: send =
 *  finalize = edit). Org admin and pm: any report; super: only their OWN (createdBy);
 *  viewer / visibility-only: never. Shared by ReportsListPage and ReviewPage so the
 *  two pages can't drift. */
export function canEditReport(
  role: 'admin' | ProjectRole | null,
  report: { createdBy?: string },
  userId: string,
): boolean {
  return (
    role === 'admin' ||
    role === 'pm' ||
    (role === 'super' && report.createdBy === userId)
  );
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ws;
}

function readLastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — non-fatal, the session just won't remember */
  }
}

// ── Workspace boot cache (Phase 15a) ─────────────────────────────────────────
// Entering the shell (from /capture, a reload, a new tab) used to hard-block on
// /me + projects. Cache the last-known snapshot BOUND TO THE SESSION TOKEN — a
// different login can never see the previous account's workspace — render from it
// instantly, and revalidate in the background. A network blip with a cache present
// degrades to slightly-stale data instead of a spinner or a full-screen error.

const WS_CACHE_KEY = 'fieldreport.workspaceCache.v1';

interface WsCache {
  /** Tail of the session token that fetched this snapshot (account binding). */
  tok: string;
  me: Me;
  projects: Record<string, ProjectWithRole[]>;
}

function tokenTail(): string | null {
  const t = getSessionToken();
  return t ? t.slice(-16) : null;
}

function readWsCache(): WsCache | null {
  try {
    const raw = localStorage.getItem(WS_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as WsCache;
    return c && c.tok && c.tok === tokenTail() && c.me ? c : null;
  } catch {
    return null;
  }
}

function writeWsCache(patch: { me?: Me; projects?: [string, ProjectWithRole[]] }): void {
  const tok = tokenTail();
  if (!tok) return;
  try {
    const prev = readWsCache();
    const me = patch.me ?? prev?.me;
    if (!me) return; // never cache projects without the account they belong to
    const next: WsCache = { tok, me, projects: { ...(prev?.projects ?? {}) } };
    if (patch.projects) next.projects[patch.projects[0]] = patch.projects[1];
    localStorage.setItem(WS_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* private mode — boot just stays network-dependent */
  }
}

function clearWsCache(): void {
  try {
    localStorage.removeItem(WS_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** The org the cached snapshot would open with (last-visited, validated). */
function cachedOrgId(c: WsCache | null): string | null {
  if (!c) return null;
  const last = readLastOrg();
  return (c.me.orgs.find((o) => o.id === last) ?? c.me.orgs[0])?.id ?? null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // Boot from the (token-bound) snapshot when one exists: the shell renders
  // immediately — no "Opening your workspace…" between /capture and management.
  const [meData, setMeData] = useState<Me | null>(() => readWsCache()?.me ?? null);
  const [error, setError] = useState<string | null>(null);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(() =>
    cachedOrgId(readWsCache()),
  );
  const [projects, setProjects] = useState<ProjectWithRole[] | null>(() => {
    const c = readWsCache();
    const orgId = cachedOrgId(c);
    return (orgId && c?.projects[orgId]) || null;
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [projectsKey, setProjectsKey] = useState(0);
  // Whether SOMETHING is on screen (cache or fetched) — a refresh failure then keeps
  // serving it instead of blanking the app into the full-screen error.
  const hasWorkspace = useRef(meData !== null);

  // Load /me once per session (or on retry), revalidating any cached snapshot. A 401
  // inside authed() clears the session, which unmounts this provider via the
  // RequireAuth guard — no handling needed here.
  useEffect(() => {
    let alive = true;
    setError(null);
    fetchMe()
      .then((m) => {
        if (!alive) return;
        setMeData(m);
        hasWorkspace.current = true;
        writeWsCache({ me: m });
        const last = readLastOrg();
        const valid = m.orgs.find((o) => o.id === last) ?? m.orgs[0];
        setCurrentOrgId(valid?.id ?? null);
      })
      .catch((e) => {
        if (!alive) return;
        // Tolerant boot (15a): with a snapshot on screen a network blip must not
        // blank the app — keep serving it. (An expired session is a real 401 and
        // signs out via authed(), never lands here as a stale-forever workspace.)
        if (hasWorkspace.current) {
          console.warn('[workspace] /me refresh failed — serving the cached snapshot', e);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // (Re)load the project list whenever the current org changes (or on reloadProjects()).
  // Cached list first (no flash), then revalidate.
  useEffect(() => {
    if (!currentOrgId) return;
    let alive = true;
    const cached = readWsCache()?.projects[currentOrgId] ?? null;
    setProjects(cached);
    listProjects(currentOrgId)
      .then((p) => {
        if (!alive) return;
        setProjects(p);
        writeWsCache({ projects: [currentOrgId, p] });
      })
      .catch((e) => {
        if (!alive) return;
        if (cached) {
          console.warn('[workspace] project refresh failed — serving the cached list', e);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [currentOrgId, projectsKey]);

  const switchOrg = useCallback((orgId: string) => {
    persist(LAST_ORG_KEY, orgId);
    // Clear the previous org's project list in the SAME update as the org change —
    // leaving it for one render lets HomePage's <Navigate> redirect into the OLD
    // org's first project before the reload effect runs.
    setProjects(null);
    setCurrentOrgId(orgId);
  }, []);

  const rememberProject = useCallback(
    (projectId: string) => {
      if (currentOrgId) persist(lastProjectKey(currentOrgId), projectId);
    },
    [currentOrgId],
  );

  if (error) {
    return (
      <ErrorState
        message={error}
        // Retry BOTH loads: a projects-fetch failure used to re-run only /me, which
        // left the project list permanently unfetched (same org id → effect no-op).
        onRetry={() => {
          setReloadKey((k) => k + 1);
          setProjectsKey((k) => k + 1);
        }}
        hint="Check your connection, then try again."
      />
    );
  }
  if (!meData) return <Loading message="Opening your workspace…" />;

  const org = meData.orgs.find((o) => o.id === currentOrgId) ?? null;

  let defaultProjectId: string | null = null;
  if (org && projects) {
    let last: string | null = null;
    try {
      last = localStorage.getItem(lastProjectKey(org.id));
    } catch {
      /* ignore */
    }
    defaultProjectId = (projects.find((p) => p.id === last) ?? projects[0])?.id ?? null;
  }

  const ws: Workspace = {
    user: meData.user,
    orgs: meData.orgs,
    org,
    orgRole: org?.role ?? null,
    projects,
    reloadProjects: () => setProjectsKey((k) => k + 1),
    switchOrg,
    defaultProjectId,
    rememberProject,
    signOut: async () => {
      clearWsCache(); // never leave a workspace snapshot behind on a shared device
      await logout();
    },
  };

  return <WorkspaceContext.Provider value={ws}>{children}</WorkspaceContext.Provider>;
}
