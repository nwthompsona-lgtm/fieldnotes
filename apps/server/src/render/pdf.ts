/**
 * renderReportPdf — HTML string -> PDF bytes via headless Chromium (Playwright).
 * Best fidelity for embedded images + CSS page breaks (spec §3, §6). A lazily-created
 * browser is reused across renders; call closeBrowser() on shutdown.
 */
import type { Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    })();
  }
  return browserPromise;
}

export async function renderReportPdf(html: string, footerTemplate?: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Images are data: URLs, so this resolves without any network.
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Margins are set here (not via @page) so Chromium applies them uniformly to EVERY page,
    // including interior page breaks. 0.5in all sides per the layout handoff; the print CSS
    // zeroes the container padding so the inset isn't doubled. When a footerTemplate is given
    // it renders in the bottom margin on every page (with "Page X of Y").
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: Boolean(footerTemplate),
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate ?? '<span></span>',
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
    });
    return new Uint8Array(pdf);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
