import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { me, listProjects, logout, ApiError } from '../lib/authApi';
import { getAccount, setAccount } from '../lib/session';
import {
  cacheProjects,
  clearWorkspaceState,
  getActiveProject,
  getCachedProjects,
  lastCaptureAt,
  setActiveProject,
  type PickableProject,
} from '../lib/activeProject';
import { formatRelativeAt } from '../lib/format';

/** Which projects can this account CAPTURE into? Org admins: every project in the org;
 *  members: projects where they're pm or super. Viewers (and org-visible-only projects)
 *  are view-only — they never show in the picker (§6.1 canCapture). */
const CAPTURE_ROLES = new Set(['pm', 'super']);

interface Props {
  online: boolean;
  onPicked: () => void;
  /** Present when this is a re-pick (switching projects) — shows a back affordance. */
  onBack?: () => void;
}

/** Project picker (design handoff §CAPTURE): tappable list of assigned projects with a
 *  Recent highlight and last-walk meta; search appears when the list is long. Replaces
 *  the old free-text project entry on Review. */
export function ProjectPickerScreen({ online, onPicked, onBack }: Props) {
  const [projects, setProjects] = useState<PickableProject[] | null>(null);
  const [orgCount, setOrgCount] = useState(1);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [query, setQuery] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  // Bumped to re-run the project fetch (Retry button + connectivity returning). Without
  // it, a transient network failure on the FIRST pick (empty project cache) permanently
  // blocked capture until an app restart.
  const [retryKey, setRetryKey] = useState(0);

  // Auto-retry when connectivity returns (false → true transition only — the ref keeps
  // the mount run from double-fetching).
  const prevOnline = useRef(online);
  useEffect(() => {
    if (!prevOnline.current && online) setRetryKey((k) => k + 1);
    prevOnline.current = online;
  }, [online]);

  useEffect(() => {
    let alive = true;
    setError(null); // a retry starts clean — show the loading state, not the stale error
    (async () => {
      try {
        const who = await me();
        if (!alive) return;
        setAccount(who.user); // keep the offline-cached account fresh
        const lists = await Promise.all(
          who.orgs.map(async (org) => {
            const projs = await listProjects(org.id);
            return projs
              .filter((p) => org.role === 'admin' || (p.role != null && CAPTURE_ROLES.has(p.role)))
              .map<PickableProject>((p) => ({
                projectId: p.id,
                projectName: p.name,
                orgId: org.id,
                orgName: org.name,
                lastCaptureAt: lastCaptureAt(p.id),
              }));
          }),
        );
        if (!alive) return;
        const flat = lists.flat();
        setOrgCount(who.orgs.length);
        setOrgName(who.orgs.length === 1 ? (who.orgs[0]?.name ?? null) : null);
        setProjects(flat);
        setFromCache(false); // a live fetch supersedes any earlier cache fallback
        cacheProjects(flat);
      } catch (err) {
        if (!alive) return;
        // Offline (or a flaky signal): fall back to the last known list so a re-pick
        // still works in a dead zone. A 401 already cleared the session — App reacts.
        const cached = getCachedProjects();
        if (cached.length > 0) {
          setProjects(cached.map((p) => ({ ...p, lastCaptureAt: lastCaptureAt(p.projectId) })));
          setFromCache(true);
        } else if (!(err instanceof ApiError && err.status === 401)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [retryKey]);

  // Most-recently-walked first (device history), then alphabetical. The top project
  // with history gets the "Recent" highlight.
  const sorted = useMemo(() => {
    if (!projects) return null;
    return [...projects].sort(
      (a, b) =>
        (b.lastCaptureAt ?? '').localeCompare(a.lastCaptureAt ?? '') ||
        a.projectName.localeCompare(b.projectName),
    );
  }, [projects]);

  const recentId = sorted?.find((p) => p.lastCaptureAt)?.projectId ?? null;
  const activeId = getActiveProject()?.projectId ?? null;

  const q = query.trim().toLowerCase();
  const visible = sorted?.filter((p) => !q || p.projectName.toLowerCase().includes(q)) ?? null;

  async function signOut() {
    setSigningOut(true);
    clearWorkspaceState();
    await logout(); // clears the session → App falls back to the login screen
  }

  return (
    <div className="screen">
      <div style={{ padding: 'var(--safe-top) 22px 12px' }}>
        {onBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back" style={{ marginBottom: 14 }}>
            <Icon name="chevronLeft" size={18} strokeWidth={2.1} />
          </button>
        )}
        <div className="display" style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-.01em' }}>
          Choose a project
        </div>
        <div className="muted" style={{ fontSize: 14, marginTop: 5 }}>
          {sorted == null
            ? 'Loading your projects…'
            : sorted.length === 0
              ? 'No projects are assigned to you yet.'
              : `You're assigned to ${sorted.length} project${sorted.length === 1 ? '' : 's'}${
                  orgName ? ` on ${orgName}` : orgCount > 1 ? ` across ${orgCount} organizations` : ''
                }.`}
        </div>
        {sorted != null && sorted.length > 6 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              marginTop: 16,
              background: 'var(--surface)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 14px',
            }}
          >
            <span className="muted" style={{ display: 'flex', flex: '0 0 auto' }}>
              <Icon name="search" size={17} strokeWidth={2} />
            </span>
            <input
              className="input"
              type="search"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ border: 'none', boxShadow: 'none', padding: '10px 0', minHeight: 44 }}
            />
          </div>
        )}
      </div>

      <div className="screen-body" style={{ gap: 11, paddingTop: 6 }}>
        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)' }}>
            <p className="err" style={{ margin: 0 }}>
              {online ? error : "You're offline — reconnect once to load your projects."}
            </p>
            <button
              className="btn btn-soft"
              style={{ marginTop: 12 }}
              onClick={() => setRetryKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        )}

        {visible?.map((p) => (
          <button
            key={p.projectId}
            className={`proj-card${p.projectId === (activeId ?? recentId) ? ' recent' : ''}`}
            onClick={() => {
              // Bind the pick to the account making it — App only honors an
              // activeProject whose owner matches the current account. With NO cached
              // account (blocked storage / cleared cache while offline) an ownerless
              // pick would be treated as unset — a silent picker loop — so surface it;
              // the boot me() refresh repopulates the account once online.
              const account = getAccount();
              if (!account) {
                setError('Reconnect once to confirm your account, then pick a project.');
                return;
              }
              setActiveProject({
                projectId: p.projectId,
                projectName: p.projectName,
                orgId: p.orgId,
                orgName: p.orgName,
                ownerUserId: account.id,
              });
              onPicked();
            }}
          >
            <span className="proj-ico">
              <Icon name="building" size={24} strokeWidth={1.7} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span
                  className="display"
                  style={{
                    fontWeight: 700,
                    fontSize: 17,
                    color: 'var(--fg)',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.projectName}
                </span>
                {p.projectId === recentId && <span className="recent-pill">Recent</span>}
              </span>
              <span className="muted" style={{ display: 'block', fontSize: 13, marginTop: 3 }}>
                {p.lastCaptureAt ? `Last walk ${formatRelativeAt(p.lastCaptureAt)}` : p.orgName}
              </span>
            </span>
            <span className="muted" style={{ flex: '0 0 auto', display: 'flex' }}>
              <Icon name="chevronRight" size={20} strokeWidth={2.1} />
            </span>
          </button>
        ))}

        {visible != null && visible.length === 0 && sorted != null && sorted.length > 0 && (
          <div className="muted" style={{ textAlign: 'center', padding: '18px 0', fontSize: 14 }}>
            No projects match “{query.trim()}”.
          </div>
        )}

        <div className="note note-hint" style={{ marginTop: 6 }}>
          <Icon name="info" size={16} strokeWidth={1.9} />
          <span>
            {fromCache
              ? "You're offline — showing your projects from the last time you were connected."
              : "Only your assigned projects show here. Ask your PM if one's missing."}
          </span>
        </div>

        <button
          className="btn btn-ghost"
          style={{ marginTop: 'auto' }}
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          <Icon name="signout" size={16} strokeWidth={1.9} />
          {signingOut ? 'Signing out…' : `Sign out${getAccount()?.name ? ` (${getAccount()!.name})` : ''}`}
        </button>
      </div>
    </div>
  );
}
