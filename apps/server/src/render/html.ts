/**
 * renderReportHtml — React static markup -> a complete, self-contained HTML document
 * (CSS inlined). Photos in the model are expected to be data: URLs so the document and
 * its PDF are fully self-contained (no HTTP needed at render time — works in dry-run).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportDocument } from './template.js';
import { REPORT_CSS } from './styles.js';
import type { ReportRenderModel } from './types.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
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
<style>${REPORT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}
