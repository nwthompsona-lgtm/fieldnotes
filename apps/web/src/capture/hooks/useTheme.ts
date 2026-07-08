import { useCallback, useEffect, useState } from 'react';
import { getTheme, setTheme as persistTheme, type Theme } from '../lib/theme';

/** Theme state + a toggle. Reads the initial value from storage/OS, keeps <html>
 *  in sync, and follows OS changes only while the user hasn't made a manual choice. */
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  // Apply on mount and whenever it changes (covers the initial render too).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    persistTheme(t);
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark';
      persistTheme(next);
      return next;
    });
  }, []);

  return { theme, toggle, setTheme };
}
