/**
 * Print + screen CSS for the report. One stylesheet drives both the hosted HTML view
 * and the Playwright PDF so they are pixel-identical. White + blue to match the apps
 * (Daylight palette); Space Grotesk for display, IBM Plex Sans for body. Tuned for US
 * Letter, embedded photos, and clean page breaks between observations (spec §3, §6).
 */
export const REPORT_CSS = `
:root{
  --ink:#0e141b; --muted:#5b6675; --line:#e1e6ec; --accent:#2563eb;
  --accent-soft:#e7eefd; --bg:#ffffff; --page-bg:#eef1f5; --chip:#e7eefd;
  --display:'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --font:'IBM Plex Sans', system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--page-bg);color:var(--ink);
  font-family:var(--font);
  -webkit-print-color-adjust:exact;print-color-adjust:exact;}
.page{max-width:8.5in;margin:0 auto;background:var(--bg);}
.wrap{padding:0.7in 0.75in 0.55in;}

/* Header */
.report-header{border-bottom:3px solid var(--accent);padding-bottom:16px;margin-bottom:22px;
  display:flex;justify-content:space-between;align-items:flex-end;gap:24px;}
.brand{display:flex;align-items:center;gap:10px;}
.brand .mark{width:34px;height:34px;border-radius:9px;background:var(--accent);color:#fff;
  font-family:var(--display);font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;letter-spacing:.5px;}
.brand .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;}
.brand .title{font-family:var(--display);font-size:18px;font-weight:700;line-height:1.1;}
.meta{text-align:right;font-size:12.5px;color:var(--muted);line-height:1.5;}
.meta .project{font-family:var(--display);font-size:16px;color:var(--ink);font-weight:700;}
.meta b{color:var(--ink);font-weight:600;}

/* Summary */
.summary{background:var(--accent-soft);border:1px solid var(--line);border-left:4px solid var(--accent);
  border-radius:10px;padding:14px 16px;margin-bottom:26px;}
.summary h2{margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);}
.summary p{margin:0;font-size:13.5px;line-height:1.55;}

/* Group heading (area/trade) */
.group-head{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);
  font-weight:700;margin:24px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--line);}

/* Observation */
.obs{border:1px solid var(--line);border-radius:13px;overflow:hidden;margin-bottom:16px;
  break-inside:avoid;page-break-inside:avoid;}
.obs-head{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--page-bg);border-bottom:1px solid var(--line);}
.obs-num{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;
  font-family:var(--display);font-size:12px;font-weight:700;
  display:flex;align-items:center;justify-content:center;flex:none;}
.obs-chips{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto;}
.chip{font-size:10.5px;font-weight:700;color:var(--accent);background:var(--chip);border-radius:999px;padding:3px 9px;letter-spacing:.02em;}
.obs-body{padding:12px 14px 14px;}
.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:11px;}
.photos.single{grid-template-columns:1fr;}
.photos img{width:100%;height:auto;max-height:3.6in;object-fit:cover;border-radius:9px;border:1px solid var(--line);display:block;}
.desc{font-size:13px;line-height:1.55;margin:0;}
.desc.unclear{color:var(--muted);font-style:italic;}

/* Footer */
.report-footer{margin-top:26px;padding-top:12px;border-top:1px solid var(--line);
  display:flex;justify-content:space-between;font-size:11px;color:var(--muted);}
.report-footer .badge{font-weight:700;color:var(--accent);}

.draft-banner{background:#fdf0d8;border:1px solid #efd9a8;color:#7a4d05;font-size:12px;font-weight:600;
  border-radius:9px;padding:8px 12px;margin-bottom:18px;text-align:center;}

@page{size:Letter;}
@media print{
  html,body{background:#fff;}
  /* Page margins are applied by the PDF renderer on EVERY page (pdf.ts margin option);
     zero the on-screen container padding so the inset isn't doubled in print. */
  .page{max-width:none;margin:0;box-shadow:none;}
  .wrap{padding:0;}
  .obs{break-inside:avoid;page-break-inside:avoid;}
}
`;
