/**
 * Account / profile — /account (design handoff §Account). Gradient avatar + name +
 * email, the "Your organizations" list (with role), and Sign out. Editing the name /
 * changing the password needs a profile endpoint that lands with the Settings phase
 * (F2) — this screen is read-only until then.
 */
import { useWorkspace } from '../workspace';
import { Avatar, RoleBadge } from '../components/flux';

export function AccountPage() {
  const ws = useWorkspace();
  return (
    <div className="page page-narrow">
      <p className="eyebrow">Account</p>
      <div className="card">
        <div className="row" style={{ gap: 16 }}>
          <Avatar name={ws.user.name} email={ws.user.email} size="lg" />
          <div>
            <h1 style={{ marginBottom: 0 }}>{ws.user.name ?? ws.user.email}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {ws.user.email}
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Your organizations</h2>
        <div className="stack-gap">
          {ws.orgs.map((o) => (
            <div key={o.id} className="row row-between">
              <span style={{ fontWeight: 600 }}>{o.name}</span>
              <RoleBadge role={o.role} />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row row-between">
          <div>
            <h2 style={{ marginBottom: 2 }}>Sign out</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Signs this browser out of FieldReport.
            </p>
          </div>
          <button className="btn btn-danger" type="button" onClick={() => void ws.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
