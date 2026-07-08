/**
 * Settings → Stakeholder directory (design §Settings-stakeholders, Admin): the org
 * address book that powers Send. Companies grouped by kind (Owner, Architect, …), each
 * expandable to contacts (name · title · email) with edit/remove + inline Add contact /
 * Add company. Kept fast and keyboard-friendly — it's the one dense setup screen.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { StakeholderKind, type StakeholderOrg } from '@fieldreport/contracts';
import {
  listStakeholders,
  createStakeholderOrg,
  deleteStakeholderOrg,
  createStakeholderContact,
  deleteStakeholderContact,
} from '../../authApi';
import { useWorkspace } from '../../workspace';
import { Loading, ErrorState } from '../../components/ui';

const KIND_LABEL: Record<StakeholderKind, string> = {
  owner: 'Owner',
  architect: 'Architect',
  engineer: 'Structural / Engineer',
  gc: 'General contractor',
  consultant: 'Consultant',
  lender: 'Lender',
  sub: 'Subcontractor',
  other: 'Other',
};

function AddContactForm({
  onAdd,
}: {
  onAdd: (c: { name: string; email: string; title?: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        + Add contact
      </button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd({ name: name.trim(), email: email.trim(), title: title.trim() || undefined });
      setName('');
      setEmail('');
      setTitle('');
      setOpen(false);
    } catch (err) {
      // Mirror addCompany: surface the ApiError message inline instead of letting the
      // rejection go unhandled with no feedback. The form stays open so nothing is lost.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="inline-form" onSubmit={submit}>
      {error && (
        <p className="form-error" role="alert" style={{ flexBasis: '100%' }}>
          {error}
        </p>
      )}
      <div className="grow">
        <span className="field-name">Name</span>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grow">
        <span className="field-name">Email</span>
        <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grow">
        <span className="field-name">Title (optional)</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
        Add
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

export function StakeholdersPage() {
  const ws = useWorkspace();
  const [directory, setDirectory] = useState<StakeholderOrg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [companyName, setCompanyName] = useState('');
  const [companyKind, setCompanyKind] = useState<StakeholderKind>('owner');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ws.org) return;
    try {
      setDirectory(await listStakeholders(ws.org.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [ws.org?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!directory) return <Loading message="Loading directory…" />;

  const addCompany = async (e: FormEvent) => {
    e.preventDefault();
    if (!ws.org) return;
    setBusy(true);
    try {
      const created = await createStakeholderOrg(ws.org.id, {
        name: companyName.trim(),
        kind: companyKind,
      });
      setCompanyName('');
      setExpanded((s) => new Set(s).add(created.id));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const grouped = StakeholderKind.options
    .map((kind) => ({ kind, orgs: directory.filter((o) => o.kind === kind) }))
    .filter((g) => g.orgs.length > 0);

  return (
    <>
      <div className="card">
        <h2>Add company</h2>
        <form className="inline-form" onSubmit={addCompany}>
          <div className="grow">
            <span className="field-name">Company name</span>
            <input
              className="input"
              required
              placeholder="e.g. ACME Development"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div>
            <span className="field-name">Kind</span>
            <select
              className="input"
              value={companyKind}
              onChange={(e) => setCompanyKind(e.target.value as StakeholderKind)}
            >
              {StakeholderKind.options.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Add company
          </button>
        </form>
      </div>

      {directory.length === 0 && (
        <div className="empty">
          <h2>No stakeholders yet</h2>
          <p>
            Add the owner, architect, and other outside companies here — then attach them
            to projects so reports can be sent their way.
          </p>
        </div>
      )}

      {grouped.map((g) => (
        <div className="card" key={g.kind}>
          <p className="eyebrow">{KIND_LABEL[g.kind]}</p>
          {g.orgs.map((o) => {
            const open = expanded.has(o.id);
            return (
              <div className="sel-org" key={o.id}>
                <div
                  className="sel-org-head"
                  onClick={() =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (next.has(o.id)) next.delete(o.id);
                      else next.add(o.id);
                      return next;
                    })
                  }
                >
                  <span className="sel-org-name">{o.name}</span>
                  <span className="sel-count">
                    {o.contacts.length} {o.contacts.length === 1 ? 'contact' : 'contacts'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)' }}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Remove ${o.name} and its contacts from the directory? Past deliveries keep their records.`)) {
                        setBusy(true);
                        void deleteStakeholderOrg(ws.org!.id, o.id)
                          .then(load)
                          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                          .finally(() => setBusy(false));
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
                {open && (
                  <div className="sel-contacts" style={{ padding: '8px 14px' }}>
                    {o.contacts.map((c) => (
                      <div className="settings-row" key={c.id} style={{ padding: '8px 0' }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600 }}>{c.name}</span>
                          {c.title && <span className="muted small"> · {c.title}</span>}
                          <br />
                          <span className="muted small">{c.email}</span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void deleteStakeholderContact(ws.org!.id, o.id, c.id)
                              .then(load)
                              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                              .finally(() => setBusy(false));
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <AddContactForm
                      onAdd={async (c) => {
                        await createStakeholderContact(ws.org!.id, o.id, c);
                        await load();
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
