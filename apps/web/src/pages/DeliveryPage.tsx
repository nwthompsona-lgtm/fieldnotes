/**
 * Delivery / audit panel — /review/:id/delivery (design handoff §Delivery). Per send:
 * "Sent {date} · X of Y opened" + teal progress + "Resend to unopened"; rows show
 * gradient avatar · name · company/email · Opened {time} (teal) / Not opened / Revoked,
 * with per-row Resend + Revoke. Revoked links collect in their own subsection.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Recipient, Report, ReportSend } from '@fieldreport/contracts';
import { getReport, listSends, revokeRecipient, resendRecipient } from '../authApi';
import { Avatar } from '../components/flux';
import { Loading, ErrorState } from '../components/ui';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Row({
  r,
  busy,
  onResend,
  onRevoke,
}: {
  r: Recipient;
  busy: boolean;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const revoked = Boolean(r.revokedAt);
  return (
    <div className="deliv-row">
      <Avatar name={r.name} email={r.email} />
      <div className="deliv-who">
        <div className="deliv-name">{r.name}</div>
        <div className="deliv-org">{r.org ? `${r.org} · ${r.email}` : r.email}</div>
      </div>
      {r.emailError && (
        // Provider rejected the email (contracts 1.2.x `emailError`) — make it visible
        // instead of silently looking sent; hover for the raw provider message. The
        // existing Resend button is the retry path.
        <span className="schip schip-danger" title={r.emailError}>
          Email failed
        </span>
      )}
      {revoked ? (
        <span className="deliv-status revoked">Revoked</span>
      ) : r.firstOpenedAt ? (
        <span className="deliv-status opened">✓ Opened {fmtWhen(r.firstOpenedAt)}</span>
      ) : (
        <span className="deliv-status unopened">Not opened</span>
      )}
      {!revoked && (
        <div className="deliv-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onResend}>
            Resend
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRevoke} style={{ color: 'var(--danger)' }}>
            Revoke
          </button>
        </div>
      )}
    </div>
  );
}

export function DeliveryPage() {
  const { id = '' } = useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [sends, setSends] = useState<ReportSend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rep, s] = await Promise.all([getReport(id), listSends(id)]);
      // Newest send first.
      s.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
      setReport(rep);
      setSends(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, doneMsg: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice(doneMsg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="page page-narrow">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!report || !sends) {
    return (
      <div className="page page-narrow">
        <Loading message="Loading delivery…" />
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <p className="eyebrow">Delivery</p>
      <div className="row row-between mb-24">
        <div>
          <h1>{report.projectName ?? report.projectId}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Daily field report · {report.date}
          </p>
        </div>
        <Link className="btn btn-secondary" to={`/review/${encodeURIComponent(id)}`}>
          ← Back to report
        </Link>
      </div>

      {notice && <div className="alert alert-info mb-24">{notice}</div>}

      {sends.length === 0 && (
        <div className="empty">
          <h2>Not sent yet</h2>
          <p>Send the finalized report to stakeholders and every open shows up here.</p>
        </div>
      )}

      {sends.map((send, idx) => {
        const active = send.recipients.filter((r) => !r.revokedAt);
        const revoked = send.recipients.filter((r) => r.revokedAt);
        const opened = active.filter((r) => r.firstOpenedAt).length;
        const unopened = active.filter((r) => !r.firstOpenedAt);
        return (
          <div className="card" key={send.id}>
            <div className="row deliv-head" style={{ gap: 14 }}>
              <div>
                <h2 style={{ marginBottom: 2 }}>
                  Sent {fmtWhen(send.sentAt)}
                  {idx === 0 && sends.length > 1 && ' · latest'}
                </h2>
                <span className="opened">
                  {opened} of {active.length} opened
                </span>
              </div>
              <div className="prog" aria-hidden="true">
                <i style={{ width: `${active.length ? (opened / active.length) * 100 : 0}%` }} />
              </div>
              {unopened.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => Promise.all(unopened.map((r) => resendRecipient(id, r.id))),
                      `Resent to ${unopened.length} unopened ${unopened.length === 1 ? 'recipient' : 'recipients'}.`,
                    )
                  }
                >
                  Resend to unopened
                </button>
              )}
            </div>
            <div className="mt-16">
              {active.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  busy={busy}
                  onResend={() => act(() => resendRecipient(id, r.id), `Resent to ${r.email}.`)}
                  onRevoke={() =>
                    act(() => revokeRecipient(id, r.id), `Revoked ${r.email}'s link.`)
                  }
                />
              ))}
              {revoked.length > 0 && (
                <>
                  <p className="eyebrow mt-24" style={{ color: 'var(--muted)' }}>
                    Revoked links
                  </p>
                  {revoked.map((r) => (
                    <Row key={r.id} r={r} busy={busy} onResend={() => {}} onRevoke={() => {}} />
                  ))}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
