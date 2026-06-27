// Dev-only: screenshot the dry-run report HTML for visual QA of the template.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(dir, '../dryrun-output/report.html'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 850, height: 1100 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: resolve(dir, '../dryrun-output/report.png'), fullPage: true });
await browser.close();
console.log('screenshot written');
