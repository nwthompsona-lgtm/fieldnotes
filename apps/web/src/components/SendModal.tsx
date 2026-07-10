/**
 * Send / distribution modal (design handoff §Send — the centerpiece). Recipients come
 * from the project's stakeholder ROSTER as selectable company rows (checkbox selects the
 * whole company, indeterminate when partial; expand to pick contacts), pre-checked from
 * the project's remembered distribution default (D-8), plus typed one-off "+ Add person"
 * recipients. Typing in the add-person form typeahead-searches the org's whole directory
 * (14b) — picked off-roster people render as "From the directory" rows; brand-new people
 * are persisted server-side on send, so nobody is ever typed twice. Footer shows the live
 * count; Send is disabled at 0. Success shows the confirmation state with a View-delivery
 * handoff.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  Report,
  ReportSend,
  StakeholderOrg,
  StakeholderSuggestion,
} from '@fieldreport/contracts';
import {
  getRoster,
  getDistributionDefault,
  getStakeholderSuggestions,
  sendReport,
} from '../authApi';
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
  // Directory people picked via the typeahead whose company isn't on the roster — they
  // need their own visible rows (their ids live in `selected` like roster contacts).
  const [extras, setExtras] = useState<StakeholderSuggestion[]>([]);
  const [personName, setPersonName] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [addingPerson, setAddingPerson] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<StakeholderSuggestion[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<ReportSend | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Roster load has its own explicit error + retry state — a failed load must stop the
  // "Loading recipients…" spinner (roster stays null forever) and offer a Retry.
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterReloadKey, setRosterReloadKey] = useState(0);

  // Load the roster and the remembered default together; pre-check the last selection.
  // The default is applied ONCE (appliedDefault) and MERGED into existing state — this
  // effect re-runs on the error-state Retry, and the user may already have picked
  // people via the typeahead / typed one-offs while the roster was down; a wholesale
  // replace would silently drop them from the count and the send.
  const appliedDefault = useRef(false);
  useEffect(() => {
    let alive = true;
    setRosterError(null);
    Promise.all([getRoster(report.projectId), getDistributionDefault(report.projectId)])
      .then(([r, def]) => {
        if (!alive) return;
        setRoster(r);
        const valid = new Set(r.flatMap((o) => o.contacts.map((c) => c.id)));
        // Typeahead picks made while the roster was unloaded all landed in `extras`;
        // any that turn out to be roster people get their own checkbox row instead.
        setExtras((l) => l.filter((e) => !valid.has(e.contactId)));
        if (def && !appliedDefault.current) {
          appliedDefault.current = true;
          const pre = new Set<string>(def.contactIds);
          for (const orgId of def.orgIds) {
            const org = r.find((o) => o.id === orgId);
            for (const c of org?.contacts ?? []) pre.add(c.id);
          }
          // Only keep ids that still exist in the roster.
          const kept = [...pre].filter((id) => valid.has(id));
          if (kept.length > 0) setSelected((s) => new Set([...s, ...kept]));
          // Legacy defaults (pre-14b) can still carry raw typed one-offs — restore them
          // too instead of silently dropping people from "your last send".
          if (def.adHoc.length > 0) {
            setAdHoc((l) => {
              const have = new Set(l.map((p) => p.email.toLowerCase()));
              const add = def.adHoc.filter((a) => !have.has(a.email.toLowerCase()));
              return add.length ? [...l, ...add.map((a) => ({ name: a.name, email: a.email }))] : l;
            });
          }
          if (kept.length > 0 || def.adHoc.length > 0) setPrefilled(true);
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

  // Typeahead (14b): typing a name or email searches the org's whole directory —
  // debounced, min 2 chars, stale responses dropped via the cleanup flag.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      getStakeholderSuggestions(report.projectId, q)
        .then((s) => alive && setSuggestions(s))
        .catch(() => alive && setSuggestions([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, report.projectId]);

  const rosterIds = useMemo(
    () => new Set((roster ?? []).flatMap((o) => o.contacts.map((c) => c.id))),
    [roster],
  );

  const pickSuggestion = (s: StakeholderSuggestion) => {
    setSelected((sel) => new Set(sel).add(s.contactId));
    if (!rosterIds.has(s.contactId)) {
      setExtras((l) => (l.some((e) => e.contactId === s.contactId) ? l : [...l, s]));
    }
    setPersonName('');
    setPersonEmail('');
    setQuery('');
  };

  const removeExtra = (contactId: string) => {
    setExtras((l) => l.filter((e) => e.contactId !== contactId));
    setSelected((sel) => {
      const next = new Set(sel);
      next.delete(contactId);
      return next;
    });
  };

  const addPerson = (e: FormEvent) => {
    e.preventDefault();
    const name = personName.trim();
    const email = personEmail.trim();
    if (!name || !email) return;
    // Skip a duplicate of someone already picked (typed one-off, typeahead extra, or a
    // checked roster contact) — the server would dedupe the email anyway, but adding it
    // here would over-count the footer and list the person twice.
    const emailLc = email.toLowerCase();
    const already =
      adHoc.some((p) => p.email.toLowerCase() === emailLc) ||
      extras.some((s) => s.email.toLowerCase() === emailLc) ||
      (roster ?? []).some((o) =>
        o.contacts.some((c) => selected.has(c.id) && c.email.toLowerCase() === emailLc),
      );
    if (!already) setAdHoc((l) => [...l, { name, email }]);
    setPersonName('');
    setPersonEmail('');
    setQuery('');
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
    // The send API is best-effort per recipient: links are always minted, but the
    // provider may have rejected some (or all) of the emails. Say so HERE — a fully
    // failed send used to show pure success until the user happened to open Delivery.
    const failed = done.recipients.filter((r) => r.emailError);
    const allFailed = failed.length > 0 && failed.length === done.recipients.length;
    return (
      <Modal
        title={allFailed ? 'Report ready — emails failed' : 'Report sent'}
        onClose={() => onSent(done)}
      >
        <p>
          {allFailed ? (
            <>
              Private links were created for <b>{done.recipients.length}</b>{' '}
              {done.recipients.length === 1 ? 'person' : 'people'}, but{' '}
              <b>none of the emails could be sent</b>.
            </>
          ) : (
            <>
              Sent to <b>{done.recipients.length}</b>{' '}
              {done.recipients.length === 1 ? 'person' : 'people'}. Each got their own
              private link — you can watch opens and revoke access from Delivery.
            </>
          )}
        </p>
        {failed.length > 0 && (
          <div className="alert alert-error" role="alert">
            <p style={{ margin: 0 }}>
              <b>
                {failed.length} of {done.recipients.length}{' '}
                {failed.length === 1 ? 'email' : 'emails'} failed to send.
              </b>
            </p>
            <p className="small" style={{ margin: '6px 0 0' }}>
              {failed[0]!.emailError}
            </p>
            <p className="small" style={{ margin: '6px 0 0' }}>
              You can retry each one from Delivery once the cause is fixed.
            </p>
          </div>
        )}
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
          {roster.length === 0 && adHoc.length === 0 && extras.length === 0 && (
            <div className="empty" style={{ padding: '28px 16px', marginTop: 12 }}>
              <h2 style={{ fontSize: 16 }}>No recipients on this project yet</h2>
              <p className="small">
                Add people below — anyone you add is saved to this project and suggested
                everywhere next time.
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
          {extras.length > 0 && (
            <div className="sel-org">
              <div className="sel-org-head" style={{ cursor: 'default' }}>
                <span className="sel-org-name">From the directory</span>
                <span className="sel-count">{extras.length} added</span>
              </div>
              <div className="sel-contacts">
                {extras.map((s) => (
                  <div className="sel-contact" key={s.contactId}>
                    <span>{s.name}</span>
                    <span className="email">{s.email}</span>
                    <span className="schip schip-proc">{s.companyName}</span>
                    <span className="spacer" style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeExtra(s.contactId)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

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
            <>
              <form className="inline-form" onSubmit={addPerson}>
                <div className="grow">
                  <span className="field-name">Name</span>
                  <input
                    className="input"
                    type="text"
                    value={personName}
                    onChange={(e) => {
                      setPersonName(e.target.value);
                      setQuery(e.target.value);
                    }}
                    required
                  />
                </div>
                <div className="grow">
                  <span className="field-name">Email</span>
                  <input
                    className="input"
                    type="email"
                    value={personEmail}
                    onChange={(e) => {
                      setPersonEmail(e.target.value);
                      setQuery(e.target.value);
                    }}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-secondary btn-sm">
                  Add
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setAddingPerson(false);
                    setPersonName('');
                    setPersonEmail('');
                    setQuery('');
                  }}
                >
                  Cancel
                </button>
              </form>
              {(() => {
                const shown = suggestions.filter((s) => !selected.has(s.contactId));
                return shown.length > 0 ? (
                  <div className="typeahead" role="listbox" aria-label="People your team has added before">
                    {shown.map((s) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="typeahead-item"
                        key={s.contactId}
                        onClick={() => pickSuggestion(s)}
                      >
                        <span className="typeahead-name">{s.name}</span>
                        <span className="email">{s.email}</span>
                        <span className="schip schip-proc">{s.companyName}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted small" style={{ margin: '6px 0 0' }}>
                    Typing searches people your team has added before — new people are
                    saved for next time.
                  </p>
                );
              })()}
            </>
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
