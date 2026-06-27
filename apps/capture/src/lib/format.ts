// Small display helpers.

/** Approximate human-readable byte size, e.g. "12.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/** Local YYYY-MM-DD for the walk date stamp. */
export function localDateYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
