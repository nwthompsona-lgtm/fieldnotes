/**
 * The Flux app shell (design handoff §App shell): glassy sticky top bar with the brand
 * pin, the ORG and PROJECT switchers as primary navigation, theme toggle, and the user
 * menu (gradient avatar → Account / Members & settings / Sign out). Routed pages render
 * below via <Outlet/>.
 */
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useWorkspace } from '../workspace';
import { Pin } from './Logo';
import { Avatar } from './flux';
import { Dropdown, Chevron, Check } from './Dropdown';

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to Daylight' : 'Switch to Nightshift'}
      type="button"
    >
      {theme === 'dark' ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 14.5A8.2 8.2 0 0 1 9.4 4 7 7 0 1 0 20 14.5Z" />
        </svg>
      )}
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

          {/* Org switcher */}
          {ws.org && (
            <Dropdown
              label="Switch organization"
              trigger={
                <>
                  <span className="swb-label">{ws.org.name}</span>
                  <Chevron />
                </>
              }
            >
              {(close) => (
                <>
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

          {ws.org && <span className="sep-dot">·</span>}

          {/* Project switcher */}
          {ws.org && (
            <Dropdown
              label="Switch project"
              trigger={
                <>
                  <span className="swb-label">{currentProject?.name ?? 'Projects'}</span>
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
                </>
              )}
            </Dropdown>
          )}

          <div className="topbar-right">
            <ThemeToggle />
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
