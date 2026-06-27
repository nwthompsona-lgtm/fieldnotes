import { useState } from 'react';
import { detectPlatform, type Platform } from '../lib/install';

interface Props {
  onContinueAnyway?: () => void; // DEV-only escape hatch
}

/**
 * Blocking onboarding (spec §2). If the app is NOT running installed, the super
 * cannot reach the capture loop — durable iOS storage requires Home Screen
 * install. We show explicit step-by-step instructions for iOS Safari and
 * Android/Chrome.
 */
export function Onboarding({ onContinueAnyway }: Props) {
  const [tab, setTab] = useState<Platform>(detectPlatform() === 'android' ? 'android' : 'ios');

  return (
    <div className="onboard">
      <h1>Install FieldReport</h1>
      <p className="lede">
        Add FieldReport to your Home Screen first. This keeps your photos and voice notes safe on
        the phone even with no signal — and lets the app open instantly on site.
      </p>

      <div className="tabs">
        <button
          className={`tab ${tab === 'ios' ? 'active' : ''}`}
          onClick={() => setTab('ios')}
        >
          iPhone / iPad
        </button>
        <button
          className={`tab ${tab === 'android' ? 'active' : ''}`}
          onClick={() => setTab('android')}
        >
          Android
        </button>
      </div>

      {tab === 'ios' ? (
        <ol className="steps">
          <li>
            Tap the <strong>Share</strong> button (the square with an up-arrow) in Safari's toolbar.
          </li>
          <li>
            Scroll down and tap <strong>“Add to Home Screen”</strong>.
          </li>
          <li>
            Tap <strong>“Add”</strong> in the top-right.
          </li>
          <li>
            Close Safari and open <strong>FieldReport</strong> from your Home Screen.
          </li>
        </ol>
      ) : (
        <ol className="steps">
          <li>
            Tap the <strong>⋮ menu</strong> (top-right) in Chrome.
          </li>
          <li>
            Tap <strong>“Install app”</strong> (or “Add to Home screen”).
          </li>
          <li>
            Confirm <strong>“Install”</strong>.
          </li>
          <li>
            Open <strong>FieldReport</strong> from your Home Screen / app drawer.
          </li>
        </ol>
      )}

      <p className="lede">
        Once it opens full-screen from the Home Screen (no Safari address bar), you're ready to walk
        the site.
      </p>

      {onContinueAnyway && (
        <button className="btn btn-ghost" onClick={onContinueAnyway}>
          Continue anyway (dev only)
        </button>
      )}
    </div>
  );
}
