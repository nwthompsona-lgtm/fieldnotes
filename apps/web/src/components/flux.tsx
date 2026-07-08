/**
 * Small Flux primitives from the design handoff: gradient avatars, role badges, and the
 * report status chip. Pure presentational — all colors come from the styles.css tokens.
 */
import type { OrgRole, ProjectRole } from '@fieldreport/contracts';
import type { ReportListRow } from '../authApi';

/** "Jake Romero" → "JR"; falls back to the first letter of an email/name. */
export function initialsOf(name: string | undefined, email?: string): string {
  const src = name?.trim() || email?.trim() || '?';
  const parts = src.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last) {
    return (first.charAt(0) + last.charAt(0)).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

/** Gradient person avatar (Flux: primary→data gradient, white initials). */
export function Avatar({
  name,
  email,
  size,
}: {
  name?: string;
  email?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar';
  return (
    <span className={cls} aria-hidden="true">
      {initialsOf(name, email)}
    </span>
  );
}

const ROLE_LABEL: Record<OrgRole | ProjectRole, string> = {
  admin: 'Admin',
  member: 'Member',
  pm: 'PM',
  super: 'Super',
  viewer: 'Viewer',
};

/** Org- or project-role pill (Admin / Member / PM / Super / Viewer). */
export function RoleBadge({ role }: { role: OrgRole | ProjectRole }) {
  return <span className={`role-badge role-${role}`}>{ROLE_LABEL[role]}</span>;
}

/** The four list-facing report states (design handoff), derived from the contract's
 *  status+processing+lastSend. `ready` = still synthesizing (blue "Processing"→"Ready"
 *  rail); the design's separate "Ready for review" maps onto our draft state. */
export type RailStatus = 'processing' | 'draft' | 'finalized' | 'sent';

export function railStatusOf(r: {
  status: ReportListRow['status'];
  processing: ReportListRow['processing'];
  lastSend: ReportListRow['lastSend'];
}): RailStatus {
  // "Sent" only while the report is still in its sent (finalized) form — a report
  // edited AFTER a send reverts to draft server-side and must surface as Draft
  // (Continue + In-progress filter), not hide behind a stale teal chip.
  if (r.lastSend && r.status === 'reviewed') return 'sent';
  if (r.status === 'reviewed') return 'finalized';
  if (r.processing === 'ready' || r.processing === 'failed') return 'draft';
  return 'processing';
}

const CHIP: Record<RailStatus, { cls: string; label: string }> = {
  processing: { cls: 'schip schip-proc', label: 'Processing' },
  draft: { cls: 'schip schip-draft', label: 'Draft' },
  finalized: { cls: 'schip schip-finalized', label: 'Finalized' },
  sent: { cls: 'schip schip-sent', label: 'Sent' },
};

/** Report status chip (Flux: pill, 11px/700 uppercase; teal = sent). */
export function StatusChip({ status }: { status: RailStatus }) {
  const c = CHIP[status];
  return <span className={c.cls}>{c.label}</span>;
}
