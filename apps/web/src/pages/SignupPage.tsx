/**
 * Sign up — /signup (design handoff §Sign up). First run, no auth: name, work email,
 * password (≥10 chars per the design; the contract floor is 8), organization name →
 * "Create workspace". The creator becomes the org's Admin.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signup } from '../authApi';
import { ApiError } from '../api';
import { AuthScaffold, SsoRow } from '../components/AuthScaffold';

const MIN_PASSWORD = 10;

export function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signup({
        name: name.trim(),
        email: email.trim(),
        password,
        orgName: orgName.trim(),
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('An account with that email already exists — log in instead.');
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
        <h1>Create your workspace</h1>
        <p className="auth-sub">Your team, your projects, your reports — in one place.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={onSubmit}>
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
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="small muted">At least {MIN_PASSWORD} characters.</span>
          </label>
          <label className="field">
            <span className="field-name">Organization name</span>
            <input
              className="input"
              type="text"
              autoComplete="organization"
              required
              placeholder="e.g. Meridian Builders"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </label>
          <button className="btn btn-primary btn-lg btn-block mt-24" type="submit" disabled={busy}>
            {busy ? 'Creating workspace…' : 'Create workspace'}
          </button>
        </form>
        <SsoRow />
      </div>
      <p className="auth-alt">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthScaffold>
  );
}
