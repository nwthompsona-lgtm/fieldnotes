/**
 * renderReportHtml — React static markup -> a complete, self-contained HTML document
 * (CSS inlined). Photos in the model are expected to be data: URLs so the document and
 * its PDF are fully self-contained (no HTTP needed at render time — works in dry-run).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportDocument, prettyDate } from './template.js';
import { REPORT_CSS } from './styles.js';
import type { ReportRenderModel } from './types.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

/**
 * Per-page PDF footer (Chromium displayHeaderFooter template). The hosted HTML view has its
 * own in-body footer; the PDF gets this one on EVERY page with "Page X of Y" (CSS paged-media
 * counters aren't available in Chromium's PDF path, so the renderer fills these spans). It
 * renders in an isolated context without the page's fonts, so it uses a system stack.
 */
export function buildPdfFooter(model: ReportRenderModel): string {
  const note = model.reviewed
    ? 'AI-assisted, superintendent-reviewed.'
    : 'AI-assisted draft — pending superintendent review.';
  const meta = `${model.projectName} · ${prettyDate(model.date)}`;
  return (
    `<div style="width:100%;font-size:8px;font-family:Arial,Helvetica,sans-serif;color:#5B6675;` +
    `padding:0 0.5in;display:flex;justify-content:space-between;align-items:center;` +
    `-webkit-print-color-adjust:exact;">` +
    `<span>${escapeHtml(note)}</span>` +
    `<span>${escapeHtml(meta)} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>` +
    `</div>`
  );
}

export function renderReportHtml(model: ReportRenderModel): string {
  const body = renderToStaticMarkup(React.createElement(ReportDocument, { model }));
  const title = `Field Report — ${model.projectName} — ${model.date}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet"/>
<style>${REPORT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}
