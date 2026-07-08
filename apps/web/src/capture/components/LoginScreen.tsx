import { useState, type FormEvent } from 'react';
import { Logo } from './Icon';
import { login, ApiError } from '../lib/authApi';

/** Mobile log in (design handoff §CAPTURE): email + password, full-width large inputs,
 *  60px primary button, future-SSO row, "your admin sends you an invite" footer. No
 *  sign-up here — accounts come from org invitations (accepted on the web app). */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = email.trim().length > 0 && password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed — try again.');
    } finally {
      // ALWAYS reset — a success normally unmounts this screen (session emit), but if
      // persisting the token hiccups the button must not wedge on "Logging in…".
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div
        style={{
          flex: 1,
          padding: 'max(60px, calc(env(safe-area-inset-top, 0px) + 28px)) 24px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13, textAlign: 'center' }}>
          <span
            style={{
              display: 'flex',
              width: 60,
              height: 60,
              borderRadius: 18,
              background: 'var(--primary)',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 14px 30px -14px var(--ring)',
            }}
          >
            <Logo size={32} fill="var(--primary-ink)" ink="var(--primary)" />
          </span>
          <div className="display" style={{ fontWeight: 700, fontSize: 25, letterSpacing: '-.01em' }}>
            Log in to FieldReport
          </div>
          <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.5, maxWidth: 270 }}>
            Walk your assigned projects and capture observations — even offline.
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div className="field">
            <label htmlFor="login-email">Work email</label>
            <input
              id="login-email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ padding: '16px 15px', fontSize: 16 }}
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ padding: '16px 15px', fontSize: 16 }}
            />
          </div>
          {error && (
            <p className="err" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!ready || busy}
            style={{ marginTop: 4, minHeight: 60, fontSize: 17 }}
          >
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        {/* Future SSO (coming soon) */}
        <div className="divider">or continue with</div>
        <div className="sso-row" aria-hidden="true">
          <span className="sso-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 11v2.9h4.7c-.2 1.2-1.5 3.6-4.7 3.6a5 5 0 0 1 0-10c1.5 0 2.6.6 3.2 1.2l2.2-2.1C16 4.9 14.2 4 12 4a8 8 0 1 0 0 16c4.6 0 7.7-3.2 7.7-7.8 0-.5 0-.9-.1-1.2H12z" />
            </svg>
          </span>
          <span className="sso-box">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <rect x="2" y="2" width="9" height="9" />
              <rect x="13" y="2" width="9" height="9" />
              <rect x="2" y="13" width="9" height="9" />
              <rect x="13" y="13" width="9" height="9" />
            </svg>
          </span>
          <span className="sso-box">
            <svg width="17" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 12.8c0-2.9 2.4-4.3 2.5-4.4-1.4-2-3.5-2.3-4.2-2.3-1.8-.2-3.5 1-4.4 1-.9 0-2.3-1-3.8-1-2 0-3.8 1.1-4.8 2.9-2 3.5-.5 8.8 1.5 11.6 1 1.4 2.1 2.9 3.6 2.9 1.4-.1 2-.9 3.7-.9s2.2.9 3.7.9 2.5-1.3 3.4-2.7c1.1-1.6 1.5-3.1 1.6-3.2-.1 0-3-1.2-3-4.5z" />
              <path d="M13.4 4.3c.8-1 1.3-2.3 1.2-3.6-1.1 0-2.5.8-3.3 1.7-.7.8-1.4 2.1-1.2 3.4 1.3.1 2.5-.6 3.3-1.5z" />
            </svg>
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 11 }}>
          <span className="soon-pill">Coming soon</span>
        </div>
      </div>

      <div
        className="muted"
        style={{
          padding: '18px 24px var(--safe-bottom)',
          textAlign: 'center',
          fontSize: 13.5,
          lineHeight: 1.5,
        }}
      >
        No account yet? Your project admin sends you an{' '}
        <span style={{ color: 'var(--primary)', fontWeight: 700 }}>invite</span> by email.
      </div>
    </div>
  );
}
