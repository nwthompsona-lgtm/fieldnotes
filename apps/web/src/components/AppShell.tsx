/**
 * The Flux app shell (design handoff §App shell, reshaped by Phase 14c): glassy sticky
 * top bar with the brand pin, ONE combined context pill (project over org — pilot
 * feedback 5/6: two pills + five fixed controls starved the labels to ~43px on phones),
 * the camera shortcut into /capture, and the user menu (gradient avatar → theme toggle /
 * Account / Members & settings / Sign out). Routed pages render below via <Outlet/>.
 */
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useWorkspace } from '../workspace';
import { Pin } from './Logo';
import { Avatar } from './flux';
import { Dropdown, Chevron, Check } from './Dropdown';

/** Theme toggle as an avatar-menu row (14c — it left the bar to make label room). */
function ThemeMenuItem() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="menu-item"
      role="menuitem"
      // Deliberately does NOT close the menu: the theme flips live under it, and the
      // next tap (or tap-out) is the user's call.
      onClick={toggle}
    >
      {theme === 'dark' ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20 14.5A8.2 8.2 0 0 1 9.4 4 7 7 0 1 0 20 14.5Z" />
        </svg>
      )}
      {theme === 'dark' ? 'Switch to Daylight' : 'Switch to Nightshift'}
    </button>
  );
}

export function AppShell() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  // The project switcher reflects the project in the URL (when on a project page),
  // falling back to the remembered default.
  const routeProjectId = location.pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null;
  const currentProjectId = routeProjectId ?? ws.defaultProjectId;
  const currentProject = ws.projects?.find((p) => p.id === currentProjectId);

  const showSettings = ws.orgRole === 'admin' || currentProject?.role === 'pm';

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand-pin" aria-label="FieldReport home">
            <Pin size={19} />
          </Link>

          {/* ONE combined context pill (14c): project as the primary line, org beneath.
              A single menu holds both sections — projects first (the frequent switch). */}
          {ws.org && (
            <Dropdown
              label="Switch project or organization"
              triggerClass="switcher-btn ctx-btn"
              trigger={
                <>
                  <span className="ctx-labels">
                    <span className="ctx-project">{currentProject?.name ?? 'Projects'}</span>
                    <span className="ctx-org">{ws.org.name}</span>
                  </span>
                  <Chevron />
                </>
              }
            >
              {(close) => (
                <>
                  <div className="menu-head">Projects</div>
                  {(ws.projects ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      onClick={() => {
                        close();
                        ws.rememberProject(p.id);
                        navigate(`/p/${encodeURIComponent(p.id)}/reports`);
                      }}
                    >
                      {p.name}
                      {p.id === currentProjectId && <Check />}
                    </button>
                  ))}
                  {ws.projects && ws.projects.length === 0 && (
                    <div className="menu-note">No projects yet.</div>
                  )}
                  <div className="menu-sep" />
                  <div className="menu-head">Organizations</div>
                  {ws.orgs.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      onClick={() => {
                        close();
                        if (o.id !== ws.org?.id) {
                          ws.switchOrg(o.id);
                          navigate('/');
                        }
                      }}
                    >
                      {o.name}
                      {o.id === ws.org?.id && <Check />}
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
          )}

          <div className="topbar-right">
            {/* Into the capture flow (Phase 13b): the walk surface lives at /capture
                in this same app — one tap from anywhere in management. */}
            <Link
              to="/capture"
              className="icon-btn"
              aria-label="Start a walk (capture)"
              title="Start a walk"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
                <circle cx="12" cy="13.5" r="3.2" />
              </svg>
            </Link>
            {/* User menu */}
            <Dropdown
              label="Account menu"
              align="right"
              triggerClass="avatar-btn"
              trigger={<Avatar name={ws.user.name} email={ws.user.email} />}
            >
              {(close) => (
                <>
                  <div className="menu-head">{ws.user.name ?? ws.user.email}</div>
                  <div className="menu-note">{ws.user.email}</div>
                  <ThemeMenuItem />
                  <Link to="/capture" className="menu-item" role="menuitem" onClick={close}>
                    Start a walk
                  </Link>
                  <Link to="/account" className="menu-item" role="menuitem" onClick={close}>
                    Account
                  </Link>
                  {showSettings && (
                    <Link
                      to="/settings/members"
                      className="menu-item"
                      role="menuitem"
                      onClick={close}
                    >
                      Members &amp; settings
                    </Link>
                  )}
                  <div className="menu-sep" />
                  <button
                    type="button"
                    className="menu-item danger"
                    role="menuitem"
                    onClick={async () => {
                      close();
                      await ws.signOut(); // clears the session → RequireAuth redirects
                    }}
                  >
                    Sign out
                  </button>
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
