/**
 * Accept invitation — /accept?token=… (design handoff §Accept invitation). Previews the
 * invite ("You've been invited to {Org} as {role}") with the invited email locked, then
 * the invitee sets name + password. Two terminal shapes (contract AcceptInviteResponse):
 *   - AuthResponse → the account was created/activated and logged in → into the app.
 *   - { requiresLogin } → the invite was for an ALREADY-ACTIVE account: the membership
 *     was added but no session is minted (D21) → hand off to /login with a notice.
 * Expired/invalid tokens render the friendly error state.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { previewInvite, acceptInvite, type InvitePreview } from '../authApi';
import { ApiError } from '../api';
import { AuthScaffold } from '../components/AuthScaffold';
import { RoleBadge } from '../components/flux';
import { Loading } from '../components/ui';

const MIN_PASSWORD = 10;

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid('This invitation link is incomplete.');
      return;
    }
    let alive = true;
    previewInvite(token)
      .then((p) => alive && setPreview(p))
      .catch((err) => {
        if (!alive) return;
        setInvalid(
          err instanceof ApiError && (err.status === 404 || err.status === 410)
            ? 'This invitation link is invalid or has expired.'
            : err instanceof Error
              ? err.message
              : String(err),
        );
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await acceptInvite({ token, name: name.trim(), password });
      if ('token' in res) {
        navigate('/', { replace: true });
      } else {
        navigate('/login', {
          replace: true,
          state: {
            email: res.email,
            notice: 'You already have an account — log in to open your new workspace.',
          },
        });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        setInvalid('This invitation link is invalid or has expired.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (invalid) {
    return (
      <AuthScaffold>
        <div className="card">
          <h1>Invitation expired</h1>
          <p className="auth-sub">{invalid}</p>
          <p className="muted small">
            Ask your project admin to send a fresh invite — links expire after 14 days.
          </p>
        </div>
        <p className="auth-alt">
          Already set up? <Link to="/login">Log in</Link>
        </p>
      </AuthScaffold>
    );
  }

  if (!preview) {
    return (
      <AuthScaffold>
        <div className="card">
          <Loading message="Checking your invitation…" />
        </div>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold>
      <div className="card">
        <p className="eyebrow">Invitation</p>
        <h1>Join {preview.orgName}</h1>
        <p className="auth-sub">
          You’ve been invited to <b>{preview.orgName}</b> as{' '}
          <RoleBadge role={preview.orgRole} />
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={onSubmit}>
          <label className="field">
            <span className="field-name">
              Email <span className="locked-pill">Locked</span>
            </span>
            <input className="input input-locked" type="email" value={preview.email} readOnly />
          </label>
          <label className="field">
            <span className="field-name">Your name</span>
            <input
              className="input"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-name">Set a password</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="small muted">At least {MIN_PASSWORD} characters.</span>
          </label>
          <button className="btn btn-primary btn-lg btn-block mt-24" type="submit" disabled={busy}>
            {busy ? 'Joining…' : 'Accept invitation'}
          </button>
        </form>
      </div>
      <p className="auth-alt">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthScaffold>
  );
}
