import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { finalizeReport, getReport, hostedUrl, patchReport, pdfUrl } from '../lib/api';
import { formatLongDate } from '../lib/format';
import type { Report } from '@fieldreport/contracts';

interface Props {
  reportId: string;
  online: boolean;
  onBack: () => void;
}

type Editing = { kind: 'summary' } | { kind: 'obs'; id: string } | null;

/** In-app AI report: review the synthesized draft, edit per observation (and the
 *  summary), then PDF / Send. Reviewing is online — the data comes from the server. */
export function ReportScreen({ reportId, online, onBack }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [sent, setSent] = useState(false);

  // Poll until the pipeline reaches a terminal state (ready/failed).
  useEffect(() => {
    let alive = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await getReport(reportId);
        if (!alive) return;
        setReport(r);
        setError(null);
        if (r.processing === 'ready' || r.processing === 'failed') return;
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      }
      attempts += 1;
      if (alive && attempts < 90) timer = setTimeout(tick, 2000);
    }
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [reportId, reloadKey]);

  const ready = report?.processing === 'ready';
  const failed = report?.processing === 'failed';

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const edit =
        editing.kind === 'summary'
          ? { summary: draft }
          : { observations: [{ id: editing.id, cleanedDescription: draft }] };
      const updated = await patchReport(reportId, edit);
      setReport(updated);
      setEditing(null);
      setSent(false); // an edit reverts the report to draft; it must be re-sent
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    setFinalizing(true);
    setError(null);
    try {
      const updated = await finalizeReport(reportId);
      setReport(updated);
      setSent(true);
      const url = hostedUrl(reportId);
      const title = `Field report — ${updated.projectName ?? updated.projectId}`;
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (nav.share) {
        try {
          await nav.share({ title, text: `${title} · ${formatLongDate(updated.date)}`, url });
        } catch {
          /* user dismissed the share sheet — finalize still succeeded */
        }
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinalizing(false);
    }
  }

  // ---- preparing / failed / offline gates ---------------------------------
  if (!ready) {
    return (
      <div className="screen">
        <Header onBack={onBack} status={report?.status} />
        <div
          className="screen-body"
          style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 18 }}
        >
          {failed ? (
            <>
              <span style={{ color: 'var(--danger)' }}>
                <Icon name="alert" size={40} strokeWidth={1.8} />
              </span>
              <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>
                Report couldn't be generated
              </div>
              <div className="muted" style={{ fontSize: 14, maxWidth: 280 }}>
                {report?.processingError ?? 'Something went wrong while writing the report.'}
              </div>
              <button className="btn btn-soft" style={{ width: 'auto', padding: '0 20px' }} onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </button>
            </>
          ) : error && !report ? (
            <>
              <span className="muted">
                <Icon name="alert" size={40} strokeWidth={1.8} />
              </span>
              <div className="muted" style={{ fontSize: 14, maxWidth: 280 }}>
                {online ? error : "You're offline. Reconnect to view this report."}
              </div>
              <button className="btn btn-soft" style={{ width: 'auto', padding: '0 20px' }} onClick={() => setReloadKey((k) => k + 1)}>
                Retry
              </button>
            </>
          ) : (
            <>
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 999,
                  border: '3px solid var(--surface-2)',
                  borderTopColor: 'var(--primary)',
                  animation: 'spin .9s linear infinite',
                }}
              />
              <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>
                Writing your report…
              </div>
              <div className="muted" style={{ fontSize: 14, maxWidth: 280 }}>
                Transcribing the voice notes and drafting the report. This takes about a minute.
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const project = report.projectName ?? report.projectId;
  const obs = report.observations;

  return (
    <div className="screen">
      <Header onBack={onBack} status={report.status} />

      <div className="screen-body">
        <div>
          <div className="display" style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.15 }}>
            {project}
          </div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 5 }}>
            {formatLongDate(report.date)} · {report.superName} · {obs.length} observation
            {obs.length === 1 ? '' : 's'}
          </div>
        </div>

        {error && <p className="err">{error}</p>}

        {/* Summary */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <span className="label">Summary</span>
            {editing?.kind !== 'summary' && (
              <button
                className="link-edit"
                onClick={() => {
                  setEditing({ kind: 'summary' });
                  setDraft(report.summary ?? '');
                }}
              >
                <Icon name="edit" size={14} strokeWidth={1.9} />
                Edit
              </button>
            )}
          </div>
          {editing?.kind === 'summary' ? (
            <EditBox draft={draft} setDraft={setDraft} saving={saving} onSave={saveEdit} onCancel={() => setEditing(null)} />
          ) : (
            <div style={{ fontSize: 14.5, lineHeight: 1.5 }}>
              {report.summary?.trim() || 'No summary yet.'}
            </div>
          )}
        </div>

        <div className="label">Observations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {obs.map((o, i) => {
            const photo = o.photos[0];
            const isEditing = editing?.kind === 'obs' && editing.id === o.id;
            return (
              <div key={o.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {photo?.blobRef && (
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: 'var(--surface-2)' }}>
                    <img className="thumb-cover" src={photo.blobRef} alt={`Observation ${i + 1}`} />
                    <span
                      style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        minWidth: 30,
                        height: 30,
                        padding: '0 8px',
                        borderRadius: 9,
                        background: 'rgba(10,14,12,.55)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 14,
                        backdropFilter: 'blur(4px)',
                        fontFamily: 'var(--display)',
                      }}
                    >
                      {i + 1}
                    </span>
                  </div>
                )}
                <div style={{ padding: '14px 16px 16px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {o.trade && <span className="chip chip-primary">{o.trade}</span>}
                    {o.area && (
                      <span className="chip chip-muted">
                        <Icon name="pin" size={12} strokeWidth={2} />
                        {o.area}
                      </span>
                    )}
                  </div>
                  {isEditing ? (
                    <div style={{ marginTop: 11 }}>
                      <EditBox
                        draft={draft}
                        setDraft={setDraft}
                        saving={saving}
                        onSave={saveEdit}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 14.5, lineHeight: 1.5, marginTop: 11 }}>
                        {o.cleanedDescription?.trim() || 'Description pending.'}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: 13,
                          paddingTop: 12,
                          borderTop: '1px solid var(--line)',
                        }}
                      >
                        <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <Icon name="mic" size={14} />
                          From voice note
                        </span>
                        <button
                          className="link-edit"
                          onClick={() => {
                            setEditing({ kind: 'obs', id: o.id });
                            setDraft(o.cleanedDescription ?? '');
                          }}
                        >
                          <Icon name="edit" size={14} strokeWidth={1.9} />
                          Edit
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bottom-bar" style={{ display: 'flex', gap: 10 }}>
        <button
          className="btn btn-soft"
          style={{ flex: 1, width: 'auto', minHeight: 56, fontSize: 15 }}
          onClick={() => window.open(pdfUrl(reportId), '_blank', 'noopener')}
        >
          <Icon name="upload" size={18} />
          PDF
        </button>
        <button
          className="btn btn-primary"
          style={{ flex: 2, width: 'auto', minHeight: 56, fontSize: 16 }}
          disabled={finalizing}
          onClick={send}
        >
          {finalizing ? (
            'Sending…'
          ) : sent ? (
            <>
              <Icon name="check" size={18} strokeWidth={2.4} />
              Sent
            </>
          ) : (
            <>
              <Icon name="send" size={19} />
              Send report
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Header({ onBack, status }: { onBack: () => void; status?: Report['status'] }) {
  const subtitle = status === 'reviewed' ? 'Reviewed · ready to share' : 'Draft · review before sending';
  return (
    <div className="sticky-header" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="header-row">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <Icon name="chevronLeft" size={18} strokeWidth={2.1} />
        </button>
        <div style={{ flex: 1 }}>
          <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>
            Site report
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {subtitle}
          </div>
        </div>
        <span className="chip chip-primary" style={{ padding: '6px 11px' }}>
          <Icon name="sparkle" size={13} />
          AI draft
        </span>
      </div>
    </div>
  );
}

function EditBox({
  draft,
  setDraft,
  saving,
  onSave,
  onCancel,
}: {
  draft: string;
  setDraft: (s: string) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        rows={4}
      />
      <div className="btn-row">
        <button className="btn btn-soft" style={{ minHeight: 46 }} disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" style={{ minHeight: 46 }} disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
