import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

/** Tiny landing page: explains the two surfaces and jumps to a report id. */
export function IndexPage() {
  const navigate = useNavigate();
  const [id, setId] = useState('');

  function jump(e: FormEvent) {
    e.preventDefault();
    const trimmed = id.trim();
    if (trimmed) navigate(`/review/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="page page-narrow">
      <p className="eyebrow">FieldReport</p>
      <h1>Review &amp; Admin</h1>
      <p className="muted mb-24">
        The online surface for the AI-drafted daily field report. A superintendent
        reviews and edits the draft here — and only after finalizing does it become
        shareable.
      </p>

      <div className="surface-grid">
        <div className="card">
          <p className="eyebrow">For the superintendent</p>
          <h2>Review &amp; finalize</h2>
          <p className="muted small">
            Open a report to watch it process, correct the AI write-up inline (edits
            autosave), then finalize to create the shareable HTML and PDF. Nothing is
            shareable until you pass through review.
          </p>
        </div>
        <div className="card">
          <p className="eyebrow">For the operator</p>
          <h2>Quality admin</h2>
          <p className="muted small">
            Inspect every report raw-vs-polished — original photos, audio, and the
            verbatim transcript beside the synthesized description, trade, and area.
            Token-gated.
          </p>
        </div>
      </div>

      <div className="card">
        <label className="field" htmlFor="jump-id">
          Open a report for review
        </label>
        <form className="jump-form" onSubmit={jump}>
          <input
            id="jump-id"
            type="text"
            placeholder="Report id (e.g. rpt_…)"
            value={id}
            onChange={(e) => setId(e.target.value)}
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit" disabled={!id.trim()}>
            Open review
          </button>
        </form>
        <p className="small muted mt-16" style={{ marginBottom: 0 }}>
          Operators can browse all reports in the{' '}
          <a href="/admin">admin quality view</a>.
        </p>
      </div>
    </div>
  );
}
