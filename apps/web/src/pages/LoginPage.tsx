/**
 * Log in — /login (design handoff §Log in). Email + password, long-lived session,
 * inline bad-credentials error, future-SSO row, link to Sign up. An accept-invite
 * redirect can pass { email, notice } in location.state to prefill + explain.
 */
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { login } from '../authApi';
import { ApiError } from '../api';
import { AuthScaffold, SsoRow } from '../components/AuthScaffold';

interface LoginNavState {
  /** Where RequireAuth intercepted the visitor — search + hash included so deep links
   *  like the capture app's /review/:id?send=1 survive the login wall intact. */
  from?: { pathname?: string; search?: string; hash?: string };
  email?: string;
  notice?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as LoginNavState;
  const [email, setEmail] = useState(state.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
      // Restore the FULL intercepted location (pathname + search + hash), not just the
      // pathname — dropping ?send=1 would break the capture app's send hand-off.
      const from = state.from;
      navigate(
        from?.pathname ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}` : '/',
        { replace: true },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('That email or password didn’t match. Try again.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts — wait a minute, then try again.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScaffold>
      <div className="card">
        <h1>Log in</h1>
        <p className="auth-sub">Welcome back — pick up where you left off.</p>
        {state.notice && <div className="alert alert-info small mb-24">{state.notice}</div>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={onSubmit}>
          <label className="field">
            <span className="field-name">Work email</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-name">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="btn btn-primary btn-lg btn-block mt-24" type="submit" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <SsoRow />
      </div>
      <p className="auth-alt">
        New to FieldReport? <Link to="/signup">Create a workspace</Link>
      </p>
    </AuthScaffold>
  );
}
