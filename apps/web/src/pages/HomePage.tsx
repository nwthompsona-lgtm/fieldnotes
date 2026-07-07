/**
 * "/" inside the shell: resolve to the remembered (or first) project's reports list.
 * Graceful states for a brand-new workspace: no org at all, or an org with no projects
 * yet (projects are created from the capture upload / the Settings phase).
 */
import { Navigate } from 'react-router-dom';
import { useWorkspace } from '../workspace';
import { Loading } from '../components/ui';

export function HomePage() {
  const ws = useWorkspace();

  if (!ws.org) {
    return (
      <div className="page">
        <div className="empty">
          <h2>No workspace yet</h2>
          <p>You’re not a member of any organization. Ask your admin for an invite.</p>
        </div>
      </div>
    );
  }
  if (!ws.projects) {
    return <Loading message="Loading projects…" />;
  }
  if (!ws.defaultProjectId) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Welcome to {ws.org.name}</h2>
          <p>
            No projects yet. Start a walk in the capture app — the first upload creates
            your project — or set one up in Settings.
          </p>
        </div>
      </div>
    );
  }
  return <Navigate to={`/p/${encodeURIComponent(ws.defaultProjectId)}/reports`} replace />;
}
