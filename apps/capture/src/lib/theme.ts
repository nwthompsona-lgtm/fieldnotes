// Daylight / Nightshift theming. The theme is a single attribute on <html>
// (`data-theme="light|dark"`); all colors are CSS variables in styles.css, so the
// switch is instant and component code never branches on theme. Seeded from the
// OS preference on first run, then the user's manual choice is remembered.

export type Theme = 'light' | 'dark';

const KEY = 'fieldreport.theme';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

/** The stored theme, or the OS preference if the user hasn't chosen one. */
export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* localStorage unavailable */
  }
  return systemPrefersDark() ? 'dark' : 'light';
}

/** Apply a theme to the document (no persistence). Safe to call before React mounts.
 *  Also updates the PWA status-bar tint so the installed chrome follows the toggle. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0B0E13' : '#EEF1F5');
}

/** Persist + apply the user's chosen theme. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* non-fatal */
  }
  applyTheme(theme);
}

/** Call once at boot (before/at mount) so first paint is already themed. */
export function initTheme(): Theme {
  const t = getTheme();
  applyTheme(t);
  return t;
}
