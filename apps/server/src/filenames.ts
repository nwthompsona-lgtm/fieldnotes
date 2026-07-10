/**
 * PDF filenames (Phase 14d, pilot feedback 7): every surface that hands out report PDF
 * bytes — /r/:id.pdf, /s/:token.pdf, and the web/capture clients — agrees on the same
 * human name, "<Project> – <YYYY-MM-DD>.pdf", instead of a report-id slug (which mobile
 * share sheets displayed as gibberish, or worse, "Unknown.pdf").
 */

/** Sanitized "<Project> – <date>.pdf"; falls back to "Field report" when unnamed. */
export function reportPdfFilename(projectName: string | null | undefined, date: string): string {
  const base = (projectName ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${(base || 'Field report').slice(0, 120)} – ${date}.pdf`;
}

/** `inline` Content-Disposition carrying the name twice: a plain-ASCII `filename=`
 *  fallback (the en dash and any unicode in project names must not appear raw in a
 *  header value) plus the RFC 5987 `filename*` with the true UTF-8 name. */
export function inlinePdfDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '-').replace(/["\\]/g, '');
  const star = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${star}`;
}
