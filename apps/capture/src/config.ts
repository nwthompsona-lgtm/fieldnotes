// Build-time configuration (spec §9). All values come from VITE_* env vars with
// sensible pilot defaults so the app runs with zero config in dev.

// Use `||` (not `??`) so an empty-string env var also falls back to the default;
// `?? ` would let VITE_API_BASE="" produce a relative "/api/upload" URL.
export const API_BASE: string = (import.meta.env.VITE_API_BASE || 'http://localhost:8787').replace(
  /\/$/,
  '',
);

export const PROJECT_ID: string = import.meta.env.VITE_PROJECT_ID ?? 'pilot-project';

export const SUPER_NAME: string = import.meta.env.VITE_SUPER_NAME ?? 'Pilot Super';

export const UPLOAD_URL = `${API_BASE}/api/upload`;

// Where the super reviews / edits / sends the finished report (the online web app).
// Defaults to the pilot web deploy; override with VITE_WEB_BASE in dev.
export const WEB_BASE: string = (
  import.meta.env.VITE_WEB_BASE || 'https://fieldnotes-web.vercel.app'
).replace(/\/$/, '');
export const reviewUrl = (reportId: string): string => `${WEB_BASE}/review/${reportId}`;

// Image compression targets (spec §4).
export const IMAGE_MAX_DIMENSION = 1600;
export const IMAGE_QUALITY = 0.7;
