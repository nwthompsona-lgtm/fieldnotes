// Dev-only: screenshot the web review + admin pages driving the live API, for visual QA.
//   node apps/server/scripts/web-shot.mjs <reportId>
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.WEB_BASE || 'http://127.0.0.1:5181';
const reportId = process.argv[2];
if (!reportId) throw new Error('usage: web-shot.mjs <reportId>');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('fieldreport.adminToken', 'dev-admin-token'); } catch {}
});
const page = await ctx.newPage();

await page.goto(`${WEB}/review/${reportId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(dir, '../dryrun-output/web-review.png'), fullPage: true });
console.log('review shot written');

await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.screenshot({ path: resolve(dir, '../dryrun-output/web-admin.png'), fullPage: true });
console.log('admin shot written');

await browser.close();
