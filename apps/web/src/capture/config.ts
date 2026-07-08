// Capture-flow configuration (Phase 13a — one app). The server base comes from the
// web app's single config; review/send now live on the SAME origin, so the old
// cross-origin WEB_BASE hand-off is gone.
import { API_BASE } from '../config';

export { API_BASE };

export const UPLOAD_URL = `${API_BASE}/api/upload`;

// Where the super reviews / edits / sends the finished report — an internal route now
// (react-router navigation, no second login, no popup dance).
export const reviewUrl = (reportId: string): string => `/review/${reportId}`;

// Image compression targets (spec §4).
export const IMAGE_MAX_DIMENSION = 1600;
export const IMAGE_QUALITY = 0.7;
