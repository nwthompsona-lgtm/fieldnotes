/**
 * Settings → Projects (design §Settings-projects, Admin): list/create projects; per
 * project: visibility (Org-visible vs Assigned-only, with one-line explanations), member
 * count, stakeholder-roster count + a roster dialog (attach directory companies so the
 * Send modal has recipients to offer).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ProjectVisibility, StakeholderOrg } from '@fieldreport/contracts';
import {
  createProject,
  setProjectVisibility,
  listProjectMembers,
  listStakeholders,
  getRoster,
  setRoster,
  type ProjectWithRole,
} from '../../authApi';
import { useWorkspace } from '../../workspace';
import { Modal } from '../../components/Modal';
import { Loading, ErrorState } from '../../components/ui';

const VISIBILITY_HELP: Record<ProjectVisibility, string> = {
  org: 'Org-visible — everyone in the organization can see finalized reports.',
  assigned: 'Assigned-only — only people assigned to the project can see it.',
};

function RosterDialog({
  project,
  onClose,
}: {
  project: ProjectWithRole;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const [directory, setDirectory] = useState<StakeholderOrg[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ws.org) return;
    let alive = true;
    Promise.all([listStakeholders(ws.org.id), getRoster(project.id)])
      .then(([dir, roster]) => {
        if (!alive) return;
        setDirectory(dir);
        setPicked(new Set(roster.map((o) => o.id)));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [ws.org?.id, project.id]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setRoster(project.id, [...picked]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Stakeholders — ${project.name}`}
      onClose={onClose}
      foot={
        <>
          <span className="muted small">{picked.size} attached</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save roster'}
          </button>
        </>
      }
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small" style={{ marginTop: 0 }}>
        Companies attached here appear in this project’s Send modal.
      </p>
      {!directory ? (
        <Loading message="Loading directory…" />
      ) : directory.length === 0 ? (
        <div className="alert alert-info">
          The org directory is empty — add companies under Settings → Stakeholders first.
        </div>
      ) : (
        directory.map((o) => (
          <label className="settings-row" key={o.id} style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              className="checkbox"
              checked={picked.has(o.id)}
              onChange={() =>
                setPicked((s) => {
                  const next = new Set(s);
                  if (next.has(o.id)) next.delete(o.id);
                  else next.add(o.id);
                  return next;
                })
              }
            />
            <span style={{ flex: 1, fontWeight: 600 }}>{o.name}</span>
            <span className="schip schip-proc">{o.kind}</span>
            <span className="muted small">
              {o.contacts.length} {o.contacts.length === 1 ? 'contact' : 'contacts'}
            </span>
          </label>
        ))
      )}
    </Modal>
  );
}

export function ProjectsPage() {
  const ws = useWorkspace();
  const [counts, setCounts] = useState<Map<string, { members: number; roster: number }>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<ProjectVisibility>('assigned');
  const [busy, setBusy] = useState(false);
  const [rosterFor, setRosterFor] = useState<ProjectWithRole | null>(null);

  const projects = ws.projects;

  const loadCounts = useCallback(async () => {
    if (!projects) return;
    try {
      const entries = await Promise.all(
        projects.map(async (p) => {
          const [members, roster] = await Promise.all([
            listProjectMembers(p.id).catch(() => []),
            getRoster(p.id).catch(() => []),
          ]);
          return [p.id, { members: members.length, roster: roster.length }] as const;
        }),
      );
      setCounts(new Map(entries));
    } catch {
      /* counts are decoration — never block the page on them */
    }
  }, [projects]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  if (error) return <ErrorState message={error} onRetry={() => setError(null)} />;
  if (!projects) return <Loading message="Loading projects…" />;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ws.org) return;
    setBusy(true);
    setError(null);
    try {
      await createProject(ws.org.id, { name: name.trim(), visibility });
      setName('');
      ws.reloadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const changeVisibility = async (p: ProjectWithRole, v: ProjectVisibility) => {
    setBusy(true);
    try {
      await setProjectVisibility(p.id, v);
      ws.reloadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>New project</h2>
        <form className="inline-form" onSubmit={create}>
          <div className="grow">
            <span className="field-name">Project name</span>
            <input
              className="input"
              type="text"
              required
              placeholder="e.g. Harbor Point Phase 2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <span className="field-name">Visibility</span>
            <select
              className="input"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as ProjectVisibility)}
            >
              <option value="assigned">Assigned-only</option>
              <option value="org">Org-visible</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Create project
          </button>
        </form>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          {VISIBILITY_HELP[visibility]}
        </p>
      </div>

      <div className="card">
        <h2>Projects</h2>
        {projects.length === 0 && (
          <p className="muted">No projects yet — create the first one above.</p>
        )}
        {projects.map((p) => {
          const c = counts.get(p.id);
          return (
            <div className="settings-row" key={p.id}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 700 }}>{p.name}</span>
                <br />
                <span className="muted small">
                  {c ? `${c.members} ${c.members === 1 ? 'member' : 'members'} · ${c.roster} stakeholder ${c.roster === 1 ? 'company' : 'companies'}` : '…'}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setRosterFor(p)}
              >
                Stakeholders
              </button>
              <select
                className="input"
                style={{ width: 150 }}
                value={p.visibility ?? 'assigned'}
                disabled={busy}
                title={VISIBILITY_HELP[p.visibility ?? 'assigned']}
                onChange={(e) => void changeVisibility(p, e.target.value as ProjectVisibility)}
              >
                <option value="assigned">Assigned-only</option>
                <option value="org">Org-visible</option>
              </select>
            </div>
          );
        })}
      </div>

      {rosterFor && (
        <RosterDialog
          project={rosterFor}
          onClose={() => {
            setRosterFor(null);
            void loadCounts();
          }}
        />
      )}
    </>
  );
}
