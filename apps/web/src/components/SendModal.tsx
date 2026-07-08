/**
 * Send / distribution modal (design handoff §Send — the centerpiece). Recipients come
 * from the project's stakeholder ROSTER as selectable company rows (checkbox selects the
 * whole company, indeterminate when partial; expand to pick contacts), pre-checked from
 * the project's remembered distribution default (D-8), plus typed one-off "+ Add person"
 * recipients. Footer shows the live count; Send is disabled at 0. Success shows the
 * confirmation state with a View-delivery handoff.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Report, ReportSend, StakeholderOrg } from '@fieldreport/contracts';
import { getRoster, getDistributionDefault, sendReport } from '../authApi';
import { useWorkspace } from '../workspace';
import { Modal } from './Modal';
import { Loading } from './ui';

type AdHoc = { name: string; email: string };

function CompanyRow({
  org,
  selected,
  expanded,
  onToggleOrg,
  onToggleContact,
  onToggleExpand,
}: {
  org: StakeholderOrg;
  selected: Set<string>;
  expanded: boolean;
  onToggleOrg: (org: StakeholderOrg) => void;
  onToggleContact: (contactId: string) => void;
  onToggleExpand: () => void;
}) {
  const picked = org.contacts.filter((c) => selected.has(c.id)).length;
  const all = org.contacts.length > 0 && picked === org.contacts.length;
  const boxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = picked > 0 && !all;
  }, [picked, all]);

  return (
    <div className="sel-org">
      <div className="sel-org-head" onClick={onToggleExpand}>
        <input
          ref={boxRef}
          type="checkbox"
          className="checkbox"
          checked={all}
          aria-label={`Select everyone at ${org.name}`}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleOrg(org)}
        />
        <span className="sel-org-name">{org.name}</span>
        <span className="schip schip-proc">{org.kind}</span>
        <span className="sel-count">
          {org.contacts.length} {org.contacts.length === 1 ? 'person' : 'people'} · {picked}{' '}
          selected
        </span>
      </div>
      {expanded && (
        <div className="sel-contacts">
          {org.contacts.length === 0 && (
            <div className="sel-contact muted">No contacts on file for this company.</div>
          )}
          {org.contacts.map((c) => (
            <label className="sel-contact" key={c.id}>
              <input
                type="checkbox"
                className="checkbox"
                checked={selected.has(c.id)}
                onChange={() => onToggleContact(c.id)}
              />
              <span>{c.name}</span>
              <span className="email">{c.email}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function SendModal({
  report,
  onClose,
  onSent,
}: {
  report: Report;
  onClose: () => void;
  /** Called with the created send after the user leaves the confirmation. */
  onSent: (send: ReportSend) => void;
}) {
  const ws = useWorkspace();
  const [roster, setRoster] = useState<StakeholderOrg[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prefilled, setPrefilled] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adHoc, setAdHoc] = useState<AdHoc[]>([]);
  const [personName, setPersonName] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [addingPerson, setAddingPerson] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<ReportSend | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Roster load has its own explicit error + retry state — a failed load must stop the
  // "Loading recipients…" spinner (roster stays null forever) and offer a Retry.
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterReloadKey, setRosterReloadKey] = useState(0);

  // Load the roster and the remembered default together; pre-check the last selection.
  useEffect(() => {
    let alive = true;
    setRosterError(null);
    Promise.all([getRoster(report.projectId), getDistributionDefault(report.projectId)])
      .then(([r, def]) => {
        if (!alive) return;
        setRoster(r);
        if (def) {
          const pre = new Set<string>(def.contactIds);
          for (const orgId of def.orgIds) {
            const org = r.find((o) => o.id === orgId);
            for (const c of org?.contacts ?? []) pre.add(c.id);
          }
          // Only keep ids that still exist in the roster.
          const valid = new Set(r.flatMap((o) => o.contacts.map((c) => c.id)));
          const kept = new Set([...pre].filter((id) => valid.has(id)));
          if (kept.size > 0) {
            setSelected(kept);
            setPrefilled(true);
          }
        }
      })
      .catch((e) => alive && setRosterError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [report.projectId, rosterReloadKey]);

  const count = selected.size + adHoc.length;

  const toggleContact = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleOrg = (org: StakeholderOrg) =>
    setSelected((s) => {
      const next = new Set(s);
      const all = org.contacts.length > 0 && org.contacts.every((c) => next.has(c.id));
      for (const c of org.contacts) {
        if (all) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });

  const addPerson = (e: FormEvent) => {
    e.preventDefault();
    const name = personName.trim();
    const email = personEmail.trim();
    if (!name || !email) return;
    setAdHoc((l) => [...l, { name, email }]);
    setPersonName('');
    setPersonEmail('');
    setAddingPerson(false);
  };

  const doSend = async () => {
    setSending(true);
    setError(null);
    try {
      // D-8: report fully-checked companies as ORG selections (the server resolves an
      // orgId to its current contacts) so the remembered distribution default keeps
      // tracking future roster additions, instead of degrading to a frozen snapshot of
      // today's contact ids. Partially-checked companies stay as explicit contactIds.
      const orgIds: string[] = [];
      const contactIds = new Set(selected);
      for (const org of roster ?? []) {
        if (org.contacts.length > 0 && org.contacts.every((c) => contactIds.has(c.id))) {
          orgIds.push(org.id);
          for (const c of org.contacts) contactIds.delete(c.id);
        }
      }
      const send = await sendReport(report.id, {
        selection: { orgIds, contactIds: [...contactIds], adHoc },
        message: message.trim() || undefined,
        expiresInDays: 30,
      });
      setDone(send);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  // ── Post-send confirmation ────────────────────────────────────────────────
  if (done) {
    return (
      <Modal title="Report sent" onClose={() => onSent(done)}>
        <p>
          Sent to <b>{done.recipients.length}</b>{' '}
          {done.recipients.length === 1 ? 'person' : 'people'}. Each got their own private
          link — you can watch opens and revoke access from Delivery.
        </p>
        <div className="row mt-16">
          <button type="button" className="btn btn-primary" onClick={() => onSent(done)}>
            View delivery
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  const senderName = ws.user.name ?? ws.user.email;

  return (
    <Modal
      title="Send report"
      onClose={onClose}
      foot={
        <>
          <span className="muted small">
            {count} {count === 1 ? 'person' : 'people'} selected
          </span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={count === 0 || sending}
            onClick={doSend}
          >
            {sending ? 'Sending…' : 'Send report'}
          </button>
        </>
      }
    >
      <p className="muted small" style={{ margin: '0 0 4px' }}>
        {report.projectName ?? report.projectId} · {report.date}
      </p>
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        Each person gets a <b>private link</b> · expires in 30 days · revoke anytime.
        <br />
        From <b>{senderName} via FieldReport</b> · replies go to {senderName}.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {rosterError ? (
        // Explicit failed-load state: no eternal spinner — show the error with a Retry
        // (re-runs the load effect via the key). Ad-hoc recipients below stay usable.
        <div className="alert alert-error" role="alert">
          <p style={{ margin: 0 }}>Couldn’t load the recipient roster: {rosterError}</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-16"
            onClick={() => setRosterReloadKey((k) => k + 1)}
          >
            Retry
          </button>
        </div>
      ) : !roster ? (
        <Loading message="Loading recipients…" />
      ) : (
        <>
          {prefilled && <span className="prefill-note">Pre-filled from your last send</span>}
          {roster.length === 0 && adHoc.length === 0 && (
            <div className="empty" style={{ padding: '28px 16px', marginTop: 12 }}>
              <h2 style={{ fontSize: 16 }}>No stakeholders on this project yet</h2>
              <p className="small">
                Add people below, or set up the project roster in Settings → Stakeholders
                (admins).
              </p>
            </div>
          )}
          {roster.map((org) => (
            <CompanyRow
              key={org.id}
              org={org}
              selected={selected}
              expanded={expanded.has(org.id)}
              onToggleOrg={toggleOrg}
              onToggleContact={toggleContact}
              onToggleExpand={() =>
                setExpanded((s) => {
                  const next = new Set(s);
                  if (next.has(org.id)) next.delete(org.id);
                  else next.add(org.id);
                  return next;
                })
              }
            />
          ))}
        </>
      )}

      {/* One-off recipients + message stay usable even when the roster load failed. */}
      {(roster || rosterError) && (
        <>
          {adHoc.length > 0 && (
            <div className="sel-org">
              <div className="sel-org-head" style={{ cursor: 'default' }}>
                <span className="sel-org-name">One-off recipients</span>
                <span className="sel-count">{adHoc.length} added</span>
              </div>
              <div className="sel-contacts">
                {adHoc.map((p, i) => (
                  <div className="sel-contact" key={`${p.email}-${i}`}>
                    <span>{p.name}</span>
                    <span className="email">{p.email}</span>
                    <span className="spacer" style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setAdHoc((l) => l.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {addingPerson ? (
            <form className="inline-form" onSubmit={addPerson}>
              <div className="grow">
                <span className="field-name">Name</span>
                <input
                  className="input"
                  type="text"
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  required
                />
              </div>
              <div className="grow">
                <span className="field-name">Email</span>
                <input
                  className="input"
                  type="email"
                  value={personEmail}
                  onChange={(e) => setPersonEmail(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-secondary btn-sm">
                Add
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAddingPerson(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm mt-16"
              onClick={() => setAddingPerson(true)}
            >
              + Add person
            </button>
          )}

          <label className="field mt-16">
            <span className="field-name">Message (optional — quoted in the email)</span>
            <textarea
              className="input"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Note the pour schedule change on P2."
            />
          </label>
        </>
      )}
    </Modal>
  );
}
