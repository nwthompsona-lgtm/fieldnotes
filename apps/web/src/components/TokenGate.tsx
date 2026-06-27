import { useState, type FormEvent } from 'react';

/** Prompt for the admin bearer token. Shown initially and on any 401. */
export function TokenGate({
  onSubmit,
  error,
}: {
  onSubmit: (token: string) => void;
  error?: string;
}) {
  const [value, setValue] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = value.trim();
    if (t) onSubmit(t);
  }

  return (
    <div className="page page-narrow">
      <p className="eyebrow">Operator access</p>
      <h1>Admin token required</h1>
      <p className="muted mb-24">
        The quality view is gated. Paste the <code>ADMIN_TOKEN</code> to continue — it’s
        stored in this browser so you only enter it once.
      </p>

      {error && <div className="alert alert-error mb-24">{error}</div>}

      <form className="card token-form" onSubmit={submit}>
        <label className="field" htmlFor="admin-token">
          Admin token
        </label>
        <input
          id="admin-token"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Bearer token…"
          autoComplete="off"
          autoFocus
        />
        <button className="btn btn-primary mt-16" type="submit" disabled={!value.trim()}>
          Unlock admin
        </button>
      </form>
    </div>
  );
}
