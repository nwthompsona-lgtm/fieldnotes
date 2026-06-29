/**
 * Print + screen CSS for the report ("Adaptive" layout — Claude Design handoff). One
 * stylesheet drives both the hosted HTML view and the Playwright PDF. White + blue
 * (Daylight palette); Space Grotesk display, IBM Plex Sans body. US Letter, 0.5in margins
 * on every page (applied by the PDF renderer); photos shown at true aspect, never cropped.
 */
export const REPORT_CSS = `
:root{
  --ink:#0E141B; --muted:#5B6675; --line:#E1E6EC; --frame:#D9DFE6; --accent:#2563EB;
  --soft:#E7EEFD; --soft-border:#d6e2fb; --summary-ink:#1c3a5e; --surface-2:#F5F7FA;
  --photos-fill:#EEF2F7;
  --display:'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --font:'IBM Plex Sans', system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:var(--ink);font-family:var(--font);
  -webkit-print-color-adjust:exact;print-color-adjust:exact;}
.page{max-width:8.5in;margin:0 auto;background:#fff;}
.wrap{padding:0.5in;display:flex;flex-direction:column;}

/* Header (page 1) */
.rep-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;}
.brand{display:flex;align-items:center;gap:13px;}
.brand-mark{width:46px;height:46px;border-radius:11px;background:var(--accent);color:#fff;
  font-family:var(--display);font-weight:700;font-size:18px;letter-spacing:.02em;
  display:flex;align-items:center;justify-content:center;flex:0 0 auto;}
.brand-kicker{font-family:var(--display);font-weight:600;font-size:10px;letter-spacing:.2em;
  color:var(--accent);text-transform:uppercase;}
.brand-title{font-family:var(--display);font-weight:700;font-size:22px;color:var(--ink);
  letter-spacing:-.01em;line-height:1;margin-top:4px;}
.rep-meta{text-align:right;display:flex;flex-direction:column;gap:3px;padding-top:2px;}
.rep-meta .date{font-size:12px;color:var(--ink);font-weight:600;}
.rep-meta .sub{font-size:11.5px;color:var(--muted);}
.rule{height:3px;background:var(--accent);border-radius:2px;margin-top:13px;}

/* Summary callout */
.summary{background:var(--soft);border:1px solid var(--soft-border);border-left:3px solid var(--accent);
  border-radius:10px;padding:12px 16px;margin:15px 0 16px;}
.summary h2{margin:0 0 5px;font-family:var(--display);font-weight:700;font-size:10px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--accent);}
.summary p{margin:0;font-size:11.5px;line-height:1.5;color:var(--summary-ink);}

.draft-banner{background:#fdf0d8;border:1px solid #efd9a8;color:#7a4d05;font-size:12px;font-weight:600;
  border-radius:9px;padding:8px 12px;margin-bottom:16px;text-align:center;}

/* Section heading band */
.section-band{display:flex;align-items:center;gap:9px;margin:2px 0 10px;}
.section-tab{width:3px;height:13px;border-radius:2px;background:var(--accent);flex:0 0 auto;}
.section-label{font-family:var(--display);font-weight:700;font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink);}
.section-count{font-size:10px;color:var(--muted);}
.section-rule{flex:1;height:1px;background:var(--line);}

/* Observation rows (two-up; full-width cards take the whole row) */
.obs-row{display:flex;gap:18px;align-items:flex-start;margin-bottom:14px;}
.obs-half{flex:1 1 0;min-width:0;}
.obs-full{flex:1 1 0;min-width:0;}
.obs-spacer{flex:1 1 0;}

/* Card shells */
.card{background:#fff;border:1px solid var(--frame);border-radius:12px;overflow:hidden;}
.card-stacked{display:flex;flex-direction:column;}
.card-beside,.card-hero,.card-tray{display:flex;}

/* Photo frame */
.ph-frame-top{padding:12px 18px 0;}
.ph-frame-side{padding:12px;flex:0 0 auto;}
.ph-box{position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--frame);
  background:var(--surface-2);}
.ph-box img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;}
.ph-badge{position:absolute;top:8px;left:8px;min-width:23px;height:23px;padding:0 6px;border-radius:7px;
  background:rgba(255,255,255,.94);display:flex;align-items:center;justify-content:center;
  font-family:var(--display);font-weight:700;font-size:12px;color:var(--accent);
  box-shadow:0 1px 4px rgba(14,20,27,.22);}

/* Captions */
.cap-block{padding:9px 14px 12px;display:flex;flex-direction:column;gap:7px;}
.cap-side{flex:1;padding:13px 13px 13px 2px;display:flex;flex-direction:column;gap:7px;min-width:0;}
.cap-hero{flex:1;padding:20px 24px;display:flex;flex-direction:column;gap:11px;justify-content:center;min-width:0;}
.cap{font-size:11.5px;line-height:1.5;color:var(--ink);}
.cap-lg{font-size:13.5px;line-height:1.55;color:var(--ink);}
.desc-unclear{color:var(--muted);font-style:italic;}

/* Multi-photo tray */
.tray{flex:0 0 auto;display:flex;gap:8px;padding:14px;background:var(--surface-2);
  border-right:1px solid var(--line);flex-wrap:wrap;align-content:flex-start;}

/* Chips */
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.chip-trade{background:var(--soft);color:var(--accent);border-radius:999px;padding:3px 9px;
  font-family:var(--display);font-weight:600;font-size:10px;white-space:nowrap;}
.chip-area{display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:3px 9px;font-weight:500;font-size:10px;white-space:nowrap;}
.chip-photos{display:inline-flex;align-items:center;gap:4px;background:var(--photos-fill);color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-weight:600;font-size:10px;white-space:nowrap;}

/* Footer (screen only — the PDF gets a per-page footer from the renderer) */
.report-footer{margin-top:18px;padding-top:11px;border-top:1px solid var(--line);
  display:flex;justify-content:space-between;align-items:center;}
.footer-note{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);}
.footer-meta{font-size:10px;color:var(--muted);}

@page{size:Letter;}
@media print{
  html,body{background:#fff;}
  .page{max-width:none;margin:0;}
  /* 0.5in page margins are applied by the PDF renderer on every page; drop the on-screen
     container padding so the inset isn't doubled. */
  .wrap{padding:0;}
  .report-footer{display:none;}
  .card{break-inside:avoid;page-break-inside:avoid;}
  .obs-row{break-inside:avoid;page-break-inside:avoid;}
  .section-band{break-after:avoid;}
}
`;
