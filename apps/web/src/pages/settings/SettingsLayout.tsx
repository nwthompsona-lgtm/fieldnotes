/**
 * Settings shell — /settings/* (design handoff §Settings). Tabbed: Members & roles
 * (Admin/PM), Projects (Admin), Stakeholders (Admin). Supers/viewers get the read-only
 * banner instead (the permission matrix's "a Super never sees org settings").
 */
import { NavLink, Outlet } from 'react-router-dom';
import { useWorkspace } from '../../workspace';

export function SettingsLayout() {
  const ws = useWorkspace();
  const isAdmin = ws.orgRole === 'admin';
  const isPm = ws.projects?.some((p) => p.role === 'pm') ?? false;

  if (!isAdmin && !isPm) {
    return (
      <div className="page page-narrow">
        <p className="eyebrow">Settings</p>
        <div className="alert alert-info">
          Settings are managed by your organization’s admins and project managers. Ask an
          admin if something here needs to change.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <p className="eyebrow">Settings</p>
      <h1 style={{ marginBottom: 16 }}>{ws.org?.name}</h1>
      <div className="tabs">
        <NavLink to="/settings/members" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          Members &amp; roles
        </NavLink>
        {isAdmin && (
          <NavLink to="/settings/projects" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            Projects
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/settings/stakeholders" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            Stakeholders
          </NavLink>
        )}
      </div>
      <Outlet />
    </div>
  );
}
