// Build-time configuration. The only knob is the server base URL.
//
// Use `||` (not `??`) so an empty-string env var also falls back to the default;
// `??` would let VITE_API_BASE="" produce relative "/api/..." URLs.
export const API_BASE: string = (
  import.meta.env.VITE_API_BASE || 'http://localhost:8787'
).replace(/\/$/, '');

/** localStorage key for the persisted admin bearer token. */
export const ADMIN_TOKEN_KEY = 'fieldreport.adminToken';

/** Poll the processing status this often (ms) while a report is not yet ready. */
export const STATUS_POLL_MS = 3000;

/** Debounce window for autosave (ms). */
export const AUTOSAVE_DEBOUNCE_MS = 800;
