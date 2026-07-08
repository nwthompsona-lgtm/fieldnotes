import { useState } from 'react';
import { detectPlatform, type Platform } from '../lib/install';
import { Logo } from './Icon';

interface Props {
  /** Re-check install state (the real gate). Tapped after the user installs. */
  onEnter?: () => void;
  /** DEV-only escape hatch (browser, not installed). */
  onContinueAnyway?: () => void;
}

const IOS_STEPS = [
  'Tap the Share button in Safari (the square with an up-arrow).',
  'Scroll down and tap “Add to Home Screen.”',
  'Tap “Add” in the top-right.',
  'Open FieldReport from your Home Screen.',
];
const AND_STEPS = [
  'Tap the ⋮ menu (top-right) in Chrome.',
  'Tap “Install app” (or “Add to Home screen”).',
  'Confirm “Install.”',
  'Open FieldReport from your app drawer.',
];

/**
 * Blocking onboarding (spec §2). Durable iOS storage requires Home Screen install,
 * so the super can't reach the capture loop until installed. Primary-colored hero +
 * platform-specific install steps + a single CTA that re-checks install.
 */
export function Onboarding({ onEnter, onContinueAnyway }: Props) {
  const [tab, setTab] = useState<Platform>(detectPlatform() === 'android' ? 'android' : 'ios');
  const steps = tab === 'android' ? AND_STEPS : IOS_STEPS;

  return (
    <div className="screen" style={{ padding: '0 0 var(--safe-bottom)' }}>
      {/* Hero */}
      <div
        style={{
          padding: 'calc(env(safe-area-inset-top, 0px) + 56px) 24px 26px',
          background: 'var(--primary)',
          color: 'var(--primary-ink)',
          borderRadius: '0 0 30px 30px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -40,
            top: -30,
            width: 180,
            height: 180,
            borderRadius: 999,
            background: 'rgba(255,255,255,.08)',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <Logo size={26} fill="var(--primary-ink)" ink="var(--primary)" />
          <span className="display" style={{ fontWeight: 700, fontSize: 21 }}>
            FieldReport
          </span>
        </div>
        <div
          className="display"
          style={{
            fontWeight: 700,
            fontSize: 30,
            lineHeight: 1.1,
            marginTop: 22,
            position: 'relative',
            maxWidth: 300,
          }}
        >
          Walk the site. We write the report.
        </div>
        <div style={{ fontSize: 15, opacity: 0.9, marginTop: 10, position: 'relative', maxWidth: 290 }}>
          Capture a photo and a voice note at each issue — even with no signal. It all syncs and
          turns into a clean report.
        </div>
        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center', position: 'relative' }}>
          <div
            style={{
              width: 128,
              height: 150,
              borderRadius: 22,
              background: 'rgba(255,255,255,.14)',
              border: '1px solid rgba(255,255,255,.3)',
              padding: 12,
              animation: 'floaty 4s ease-in-out infinite',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 9,
                    background: i === 2 ? 'var(--accent)' : 'rgba(255,255,255,.22)',
                    display: i === 2 ? 'flex' : undefined,
                    alignItems: i === 2 ? 'center' : undefined,
                    justifyContent: i === 2 ? 'center' : undefined,
                    color: i === 2 ? 'var(--accent-ink)' : undefined,
                    fontWeight: 800,
                    fontSize: 18,
                  }}
                >
                  {i === 2 ? '＋' : ''}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 11, textAlign: 'center', fontSize: 11, fontWeight: 700, opacity: 0.92 }}>
              Home Screen
            </div>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div style={{ flex: 1, padding: '22px 22px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="label" style={{ textAlign: 'center' }}>
          Add to your Home Screen to begin
        </div>
        <div className="seg">
          <button className={`seg-tab ${tab === 'ios' ? 'active' : ''}`} onClick={() => setTab('ios')}>
            iPhone
          </button>
          <button
            className={`seg-tab ${tab === 'android' ? 'active' : ''}`}
            onClick={() => setTab('android')}
          >
            Android
          </button>
        </div>
        <div className="card" style={{ padding: '6px 4px' }}>
          {steps.map((t, i) => (
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
          <div style={{ padding: '11px 14px', fontSize: 13, color: 'var(--muted)' }}>
            Once it opens full-screen with no address bar, you're set.
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '16px 22px 0' }}>
        <button
          className="btn btn-primary btn-lg"
          style={{ minHeight: 60, fontSize: 17 }}
          onClick={() => {
            onEnter?.();
            onContinueAnyway?.();
          }}
        >
          I've added it — start walking
        </button>
      </div>
    </div>
  );
}
