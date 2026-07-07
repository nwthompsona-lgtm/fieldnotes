/**
 * HTML escaping for untrusted strings interpolated into markup. One implementation so a
 * fix (or a newly-escaped character) can never land in the report renderer but miss the
 * email templates, or vice-versa. Escapes the five characters that matter inside both
 * element text and double-quoted attributes.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
