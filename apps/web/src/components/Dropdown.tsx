/**
 * Generic dropdown for the Flux switchers + user menu: a trigger button and an absolutely
 * positioned .menu panel that closes on outside click or Escape (design handoff:
 * "dropdowns close on outside click"). Purely mechanical — callers style the trigger
 * (.switcher-btn / .avatar-btn) and render the .menu-item children.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Dropdown({
  trigger,
  align = 'left',
  children,
  triggerClass = 'switcher-btn',
  label,
}: {
  /** Trigger content (the closed pill / avatar). */
  trigger: ReactNode;
  /** Menu contents — call the provided close() when an item is picked. */
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  triggerClass?: string;
  /** Accessible name for the trigger button. */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="switcher" ref={rootRef}>
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className={align === 'right' ? 'menu menu-right' : 'menu'} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Chevron used inside switcher pills. */
export function Chevron() {
  return (
    <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Check mark for the current org/project in a switcher menu. */
export function Check() {
  return (
    <svg className="check" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
