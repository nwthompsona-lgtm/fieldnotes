import type { ReactNode } from 'react';
import { Icon, Logo } from './Icon';

/**
 * THE capture top bar (Phase 15d, pilot feedback 5). One glassy bar — translucent
 * blur + hairline border, matching the management shell's topbar — with props-only
 * slots: back/cancel (or the brand mark when rootless), title+subtitle (or the
 * wordmark), right-side controls, and an optional second row. Its `capbar-*` classes
 * live in capture.css (scoped under `.cap` by the build), so every capture screen
 * renders the identical bar instead of five hand-rolled headers.
 */
export function TopBar({
  onBack,
  backLabel = 'Back',
  backIcon = 'chevronLeft',
  title,
  subtitle,
  right,
  children,
}: {
  /** Back/cancel action; omitted = the brand pin instead. */
  onBack?: () => void;
  backLabel?: string;
  backIcon?: 'chevronLeft' | 'x';
  /** Title line; omitted = the FieldReport wordmark. */
  title?: string;
  subtitle?: string;
  /** Right-side controls (icon buttons, status pill, chips). */
  right?: ReactNode;
  /** Optional second row (project pill, step progress). */
  children?: ReactNode;
}) {
  return (
    <div className="capbar">
      <div className="capbar-row">
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label={backLabel}>
            <Icon name={backIcon} size={18} strokeWidth={2.1} />
          </button>
        ) : (
          <span className="capbar-brandpin">
            <Logo size={18} fill="var(--primary)" ink="var(--primary-ink)" />
          </span>
        )}
        {title ? (
          <div className="capbar-titles">
            <div className="display capbar-title">{title}</div>
            {subtitle && <div className="capbar-sub">{subtitle}</div>}
          </div>
        ) : (
          <span className="display capbar-word">FieldReport</span>
        )}
        {right && <div className="capbar-right">{right}</div>}
      </div>
      {children}
    </div>
  );
}
