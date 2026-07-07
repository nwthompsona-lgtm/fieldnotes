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
  useState,
  type ReactNode,
} from 'react';
import type { Me, OrgRole, ProjectRole } from '@fieldreport/contracts';
import { me as fetchMe, listProjects, logout, type ProjectWithRole } from './authApi';
import { LAST_ORG_KEY, lastProjectKey } from './config';
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [meData, setMeData] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectWithRole[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Load /me once per session (or on retry). A 401 inside authed() clears the session,
  // which unmounts this provider via the RequireAuth guard — no handling needed here.
  useEffect(() => {
    let alive = true;
    setError(null);
    fetchMe()
      .then((m) => {
        if (!alive) return;
        setMeData(m);
        const last = readLastOrg();
        const valid = m.orgs.find((o) => o.id === last) ?? m.orgs[0];
        setCurrentOrgId(valid?.id ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // (Re)load the project list whenever the current org changes.
  useEffect(() => {
    if (!currentOrgId) return;
    let alive = true;
    setProjects(null);
    listProjects(currentOrgId)
      .then((p) => alive && setProjects(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [currentOrgId]);

  const switchOrg = useCallback((orgId: string) => {
    persist(LAST_ORG_KEY, orgId);
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
        onRetry={() => setReloadKey((k) => k + 1)}
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
    switchOrg,
    defaultProjectId,
    rememberProject,
    signOut: logout,
  };

  return <WorkspaceContext.Provider value={ws}>{children}</WorkspaceContext.Provider>;
}
