import type { ReactNode } from 'react';
import type { ProcessingStatus, ReportStatus } from '@fieldreport/contracts';

/** Centered loading state with spinner + message. */
export function Loading({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="center-state">
      <div className="spinner" aria-hidden />
      <p className="muted">{message}</p>
    </div>
  );
}

/** Centered error block with optional retry action. */
export function ErrorState({
  message,
  onRetry,
  hint,
}: {
  message: string;
  onRetry?: () => void;
  hint?: string;
}) {
  return (
    <div className="center-state">
      <div className="alert alert-error" style={{ display: 'inline-block', maxWidth: 560 }}>
        <strong>Something went wrong.</strong>
        <p style={{ margin: '8px 0 0' }}>{message}</p>
        {hint && <p className="small" style={{ margin: '8px 0 0' }}>{hint}</p>}
        {onRetry && (
          <button className="btn btn-secondary mt-16" onClick={onRetry} type="button">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: ReportStatus }) {
  return status === 'reviewed' ? (
    <span className="badge badge-reviewed">✓ Reviewed</span>
  ) : (
    <span className="badge badge-draft">Draft</span>
  );
}

export function ProcessingBadge({ processing }: { processing: ProcessingStatus }) {
  return <span className="badge badge-proc">{processing}</span>;
}

export function Chip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="chip">
      <span className="chip-label">{label}</span>
      {value}
    </span>
  );
}
