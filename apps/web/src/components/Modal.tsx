/**
 * Modal primitive (Flux): centered dialog on desktop, full-width bottom sheet ≤820px
 * (styles.css). Closes on Escape or an overlay click; the panel itself swallows clicks.
 */
import { useEffect, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  foot,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Optional sticky footer row (actions). */
  foot?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <span className="spacer" />
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}
