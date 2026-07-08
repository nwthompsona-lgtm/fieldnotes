/**
 * Settings → Members & roles (design §Settings-members): table of name · email · org
 * role · per-project assignment chips · actions. Org-role change + removal are org-admin
 * ops (server keeps the last admin); assignments are editable per member (admin/pm) via
 * a small dialog; Invite member = email + org role + optional project assignments.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { OrgMemberRow, OrgRole, ProjectRole } from '@fieldreport/contracts';
import {
  listMembers,
  setMemberRole,
  removeMember,
  createInvitation,
  setProjectMember,
  removeProjectMember,
} from '../../authApi';
import { ApiError } from '../../api';
import { useWorkspace } from '../../workspace';
import { Avatar, RoleBadge } from '../../components/flux';
import { Modal } from '../../components/Modal';
import { Loading, ErrorState } from '../../components/ui';

const PROJECT_ROLES: Array<{ value: ProjectRole | ''; label: string }> = [
  { value: '', label: 'No access' },
  { value: 'pm', label: 'PM' },
  { value: 'super', label: 'Super' },
  { value: 'viewer', label: 'Viewer' },
];

function AssignmentsDialog({
  member,
  onClose,
  onSaved,
}: {
  member: OrgMemberRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<Map<string, ProjectRole | ''>>(() => {
    const m = new Map<string, ProjectRole | ''>();
    for (const p of ws.projects ?? []) m.set(p.id, '');
    for (const a of member.assignments) m.set(a.projectId, a.role);
    return m;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const before = new Map(member.assignments.map((a) => [a.projectId, a.role]));
      for (const [projectId, role] of draft) {
        const prev = before.get(projectId) ?? '';
        if (role === prev) continue;
        if (role === '') await removeProjectMember(projectId, member.user.id);
        else await setProjectMember(projectId, member.user.id, role);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Assignments — ${member.user.name ?? member.user.email}`}
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save assignments'}
          </button>
        </>
      }
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {(ws.projects ?? []).map((p) => (
        <div className="settings-row" key={p.id}>
          <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
          <select
            className="input"
            style={{ width: 140 }}
            value={draft.get(p.id) ?? ''}
            onChange={(e) =>
              setDraft((d) => new Map(d).set(p.id, e.target.value as ProjectRole | ''))
            }
          >
            {PROJECT_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </Modal>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [email, setEmail] = useState('');
  const [orgRole, setOrgRole] = useState<OrgRole>('member');
  const [assign, setAssign] = useState<Map<string, ProjectRole | ''>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ws.org) return;
    setBusy(true);
    setError(null);
    try {
      const projectAssignments = [...assign]
        .filter(([, role]) => role !== '')
        .map(([projectId, role]) => ({ projectId, role: role as ProjectRole }));
      const res = await createInvitation(ws.org.id, {
        email: email.trim(),
        orgRole,
        projectAssignments,
      });
      setInviteUrl(res.inviteUrl);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (inviteUrl) {
    return (
      <Modal title="Invitation sent" onClose={onClose}>
        <p>
          We emailed <b>{email.trim()}</b> an invitation (valid 14 days). You can also share
          the link directly:
        </p>
        <input className="input" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
        <div className="row mt-16">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(inviteUrl).then(() => setCopied(true));
            }}
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Invite member"
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="invite-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Inviting…' : 'Send invitation'}
          </button>
        </>
      }
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form id="invite-form" onSubmit={submit}>
        <label className="field">
          <span className="field-name">Work email</span>
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-name">Organization role</span>
          <select
            className="input"
            value={orgRole}
            onChange={(e) => setOrgRole(e.target.value as OrgRole)}
          >
            <option value="member">Member — works on assigned projects</option>
            <option value="admin">Admin — manages the organization</option>
          </select>
        </label>
        <p className="field-name" style={{ marginTop: 14 }}>
          Assign to projects (optional)
        </p>
        {(ws.projects ?? []).map((p) => (
          <div className="settings-row" key={p.id} style={{ padding: '8px 0' }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
            <select
              className="input"
              style={{ width: 140 }}
              value={assign.get(p.id) ?? ''}
              onChange={(e) =>
                setAssign((d) => new Map(d).set(p.id, e.target.value as ProjectRole | ''))
              }
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </form>
    </Modal>
  );
}

export function MembersPage() {
  const ws = useWorkspace();
  const [rows, setRows] = useState<OrgMemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [editing, setEditing] = useState<OrgMemberRow | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAdmin = ws.orgRole === 'admin';

  const load = useCallback(async () => {
    if (!ws.org) return;
    try {
      setRows(await listMembers(ws.org.id));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setReadOnly(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [ws.org?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (readOnly) {
    return (
      <div className="alert alert-info">
        Members are managed by your organization’s admins and project managers.
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <Loading message="Loading members…" />;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <span className="page-count">
          {rows.length} {rows.length === 1 ? 'member' : 'members'}
        </span>
        <span className="spacer" />
        {isAdmin && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setInviting(true)}>
            + Invite member
          </button>
        )}
      </div>
      {/* Desktop: the usual table. ≤640px: .table-cards collapses each row into a
          card (thead hidden, td stacked, data-label as the field caption). */}
      <div className="table-scroll table-cards">
      <table className="report-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Org role</th>
            <th>Projects</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.user.id}>
              <td>
                <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                  <Avatar name={m.user.name} email={m.user.email} size="sm" />
                  <span>
                    <span style={{ fontWeight: 600 }}>{m.user.name ?? m.user.email}</span>
                    <br />
                    <span className="muted small">{m.user.email}</span>
                  </span>
                </span>
              </td>
              <td data-label="Org role">
                {isAdmin && m.user.id !== ws.user.id ? (
                  <select
                    className="input btn-sm"
                    style={{ width: 120, padding: '4px 8px' }}
                    value={m.orgRole}
                    disabled={busy}
                    onChange={(e) =>
                      act(() => setMemberRole(ws.org!.id, m.user.id, e.target.value as OrgRole))
                    }
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <RoleBadge role={m.orgRole} />
                )}
              </td>
              <td data-label="Projects">
                <span className="assign-chips">
                  {m.orgRole === 'admin' ? (
                    <span className="muted small">All projects (admin)</span>
                  ) : m.assignments.length === 0 ? (
                    <span className="muted small">—</span>
                  ) : (
                    m.assignments.map((a) => (
                      <span className="chip" key={a.projectId}>
                        <span className="chip-label">{a.role}</span>
                        {a.projectName}
                      </span>
                    ))
                  )}
                </span>
              </td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditing(m)}
                >
                  Assignments
                </button>
                {isAdmin && m.user.id !== ws.user.id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)' }}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove ${m.user.name ?? m.user.email} from ${ws.org?.name}?`)) {
                        void act(() => removeMember(ws.org!.id, m.user.id));
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {editing && (
        <AssignmentsDialog
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={() => void load()} />}
    </>
  );
}
