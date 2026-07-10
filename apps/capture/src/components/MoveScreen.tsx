import { Logo } from './Icon';
import { WEB_BASE } from '../config';

interface Props {
  /** Un-synced walk data exists on THIS origin (IndexedDB can't move with you). */
  dataAtRisk: boolean;
  /** Still counting local walk data — hold the all-clear copy until we know. */
  checking: boolean;
  /** Keep using the old app to finish syncing (only offered while data is at risk). */
  onStay: () => void;
}

const NEW_URL = `${WEB_BASE}/capture`;

/**
 * Phase 15c — this origin is retired. Capture merged into the ONE app (13a); an
 * installed PWA pins its origin, so moving means installing from the new address.
 * This screen is the legacy app's final face: it sends people to the new origin, and
 * refuses to strand un-synced walks (per-origin IndexedDB) by keeping the old sync
 * path reachable behind "Finish syncing here" until the device is clean.
 */
export function MoveScreen({ dataAtRisk, checking, onStay }: Props) {
  return (
    <div className="screen" style={{ padding: '0 0 var(--safe-bottom)' }}>
      {/* Hero — same brand block as onboarding, new message. */}
      <div
        style={{
          padding: 'calc(env(safe-area-inset-top, 0px) + 56px) 24px 30px',
          background: 'var(--primary)',
          color: 'var(--primary-ink)',
          borderRadius: '0 0 30px 30px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={26} fill="var(--primary-ink)" ink="var(--primary)" />
          <span className="display" style={{ fontWeight: 700, fontSize: 21 }}>
            FieldReport
          </span>
        </div>
        <div
          className="display"
          style={{ fontWeight: 700, fontSize: 30, lineHeight: 1.12, marginTop: 22, maxWidth: 300 }}
        >
          FieldReport has moved
        </div>
        <div style={{ fontSize: 15, opacity: 0.9, marginTop: 10, maxWidth: 300 }}>
          Capture and reports are one app now, at a new address. Install it once and
          this old icon can go.
        </div>
      </div>

      <div style={{ flex: 1, padding: '22px 22px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {dataAtRisk && (
          <div
            className="card"
            style={{
              border: '1px solid var(--accent)',
              padding: '14px 16px',
              fontSize: 14.5,
              lineHeight: 1.45,
            }}
          >
            <b>You have walk data on this device that hasn’t synced.</b> It can’t move to
            the new app by itself — finish syncing it here first, then come back and
            switch.
          </div>
        )}

        <div className="card" style={{ padding: '6px 4px' }}>
          {[
            'Open the new address in your browser.',
            'Add it to your Home Screen (same as before).',
            'Remove this old FieldReport icon.',
          ].map((t, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 13,
                padding: '13px 14px',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <span
                style={{
                  flex: '0 0 auto',
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: 'var(--primary-soft)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: 14,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 14.5, color: 'var(--fg)', lineHeight: 1.35 }}>{t}</span>
            </div>
          ))}
          <div style={{ padding: '11px 14px', fontSize: 13, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
            New address: {NEW_URL}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 22px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <a
          className="btn btn-primary btn-lg"
          style={{ minHeight: 60, fontSize: 17, textDecoration: 'none' }}
          href={NEW_URL}
          target="_blank"
          rel="noreferrer"
        >
          Open the new FieldReport
        </a>
        {dataAtRisk && (
          <button
            className="btn btn-soft"
            style={{ minHeight: 52, fontSize: 15 }}
            onClick={onStay}
          >
            Finish syncing here first
          </button>
        )}
        {checking && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
            Checking this device for unsent walks…
          </div>
        )}
      </div>
    </div>
  );
}
