/**
 * Shared scaffolding for the auth screens (design handoff §Sign up / §Log in / §Accept):
 * desktop = split layout (left --primary brand panel with tagline + value bullets,
 * right the form card); mobile = single column with a compact brand header. Plus the
 * de-emphasized future-SSO row ("Coming soon" — provider flows out of scope).
 */
import type { ReactNode } from 'react';
import { Brand } from './Logo';

export function AuthScaffold({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <Brand />
        <h2>
          The daily field report,
          <br />
          written for you.
        </h2>
        <p>
          Walk the site, talk through what you see — FieldReport drafts the report, you
          review it, and every stakeholder gets a private link.
        </p>
        <ul className="auth-points">
          <li>Capture on your phone, hands-free</li>
          <li>AI drafts, the super stays in control</li>
          <li>Send with per-person links — see who opened</li>
        </ul>
      </aside>
      <div className="auth-form-wrap">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Future-SSO row: Google / Microsoft / Apple, de-emphasized, disabled. */
export function SsoRow() {
  return (
    <>
      <div className="divider">
        or <span className="soon-pill">SSO coming soon</span>
      </div>
      <div className="sso-row">
        {['Google', 'Microsoft', 'Apple'].map((p) => (
          <button key={p} type="button" className="sso-btn" disabled title="Coming soon">
            {p}
          </button>
        ))}
      </div>
    </>
  );
}
