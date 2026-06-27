// Small display helpers.

/** Approximate human-readable byte size, e.g. "12.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/** mm:ss clock for the record timer / playback duration. */
export function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.max(0, Math.floor(totalSeconds % 60));
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Friendly relative stamp for a submitted report, e.g. "Yesterday · 4:12 PM". */
export function formatRelativeAt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today · ${time}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday · ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

/** Friendly long date for the report header, e.g. "Jun 27, 2026". */
export function formatLongDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Local YYYY-MM-DD for the walk date stamp. */
export function localDateYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
