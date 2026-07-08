// PWA install / standalone detection (spec §2).
//
// Durable iOS storage requires the app to run from the Home Screen. We detect
// standalone via both the iOS-only `navigator.standalone` and the standard
// display-mode media query, and we sniff the platform to show the right
// install instructions.

export function isStandalone(): boolean {
  // iOS Safari sets navigator.standalone when launched from Home Screen.
  const iosStandalone =
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayStandalone =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(display-mode: standalone)').matches === true;
  return iosStandalone || displayStandalone;
}

export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(): Platform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // iPadOS 13+ reports as Mac; disambiguate via touch points.
  const isIpadOs = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIpadOs) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
