// Typed fetch wrapper around the FieldReport server API.
//
// Every shape crossing the wire comes from `@fieldreport/contracts` — this file
// never redeclares Report/ReportEdit/AdminReportView/ProcessingStatus. The only
// local type is the small status envelope returned by GET /:id/status, which the
// contract describes inline (status + processing + optional error).

import type {
  Report,
  ReportEdit,
  AdminReportView,
  ReportStatus,
  ProcessingStatus,
} from '@fieldreport/contracts';
import { API_BASE } from './config';
import { authHeaders } from './session';

/** Shape of GET /api/reports/:id/status. */
export interface StatusEnvelope {
  status: ReportStatus;
  processing: ProcessingStatus;
  error?: string;
}

/** Thrown for any non-2xx response; carries the HTTP status for callers
 *  (notably 401 -> re-prompt for the admin token). */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // Session bearer first so an explicit header (admin token) can override it.
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    // Network/DNS/CORS-level failure — no HTTP status to report.
    throw new ApiError(0, `Could not reach the server at ${API_BASE}.`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error ?? '';
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(
      res.status,
      detail || `Request failed (${res.status} ${res.statusText}).`,
    );
  }

  // 204 / empty body tolerance.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const jsonHeaders = { 'content-type': 'application/json' } as const;

// ── Review (super-facing) ───────────────────────────────────────────────────

export function getReport(id: string): Promise<Report> {
  return request<Report>(`/api/reports/${encodeURIComponent(id)}`);
}

export function getReportStatus(id: string): Promise<StatusEnvelope> {
  return request<StatusEnvelope>(`/api/reports/${encodeURIComponent(id)}/status`);
}

export function patchReport(id: string, edit: ReportEdit): Promise<Report> {
  return request<Report>(`/api/reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(edit),
  });
}

export function finalizeReport(id: string): Promise<Report> {
  return request<Report>(`/api/reports/${encodeURIComponent(id)}/finalize`, {
    method: 'POST',
  });
}

// ── Hosted artifacts (session-gated /r/:id and /r/:id.pdf) ──────────────────
// §6.6: the hosted HTML/PDF routes REQUIRE the session bearer, so a bare
// <a target="_blank"> always 401s — a new tab carries no Authorization header.
// Instead we pre-open a blank tab synchronously inside the click (popup blockers
// only allow window.open during a user gesture), fetch the artifact WITH the
// bearer, and point the tab at a blob: URL of the bytes. Shared by ReviewPage
// and AdminDetailPage.

/** How long a handed-out blob: URL stays alive before revocation — long enough
 *  for the new tab (and its PDF viewer) to load, short enough not to leak the
 *  blob for the whole session. */
const BLOB_URL_TTL_MS = 60_000;

/** Fetch a session-gated URL with the bearer and return a blob: URL for it.
 *  The URL self-revokes after BLOB_URL_TTL_MS. */
async function fetchBlobUrl(url: string, bearerToken?: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : { ...authHeaders() },
    });
  } catch {
    throw new ApiError(0, `Could not reach the server at ${API_BASE}.`);
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Could not load it (${res.status} ${res.statusText}).`);
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  // Deferred revoke: the new tab has long since read the blob after a minute.
  setTimeout(() => URL.revokeObjectURL(blobUrl), BLOB_URL_TTL_MS);
  return blobUrl;
}

/** The filename every PDF surface agrees on (14d): "<Project> – <YYYY-MM-DD>.pdf",
 *  sanitized for filesystems. Matches the server's Content-Disposition name. */
export function reportPdfFileName(projectName: string | null | undefined, date: string): string {
  const base = (projectName ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${(base || 'Field report').slice(0, 120)} – ${date}.pdf`;
}

/** Download a session-gated artifact as a NAMED file (14d — no tab, no "Unknown.pdf"):
 *  fetch with the bearer → blob URL → programmatic `<a download>` click. */
export async function downloadAuthedArtifact(url: string, filename: string): Promise<void> {
  const blobUrl = await fetchBlobUrl(url); // self-revokes after BLOB_URL_TTL_MS
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Open a session-gated hosted artifact (htmlUrl / pdfUrl) in a new tab.
 *  MUST be invoked synchronously from a click handler — window.open only
 *  succeeds inside the user gesture. Rejects with ApiError when the popup was
 *  blocked or the fetch failed (the blank tab is closed); surface the message
 *  inline next to the button.
 *  `bearerToken` overrides the session bearer — the admin surface passes its
 *  operator token so break-glass (/r accepts it since the Phase 9–12 fixes) can
 *  open cross-org reports the operator's own session can't view. */
export async function openAuthedArtifact(url: string, bearerToken?: string): Promise<void> {
  // Pre-open within the gesture — window.open after an await gets popup-blocked.
  const win = window.open('', '_blank');
  if (!win) {
    throw new ApiError(
      0,
      'Your browser blocked the new tab — allow pop-ups for this site and try again.',
    );
  }
  try {
    win.location.href = await fetchBlobUrl(url, bearerToken);
  } catch (err) {
    win.close(); // don't strand a blank tab on failure
    throw err;
  }
}

// ── Admin (operator-facing, bearer-gated) ───────────────────────────────────

function bearer(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

export function listAdminReports(token: string): Promise<Report[]> {
  return request<Report[]>('/api/admin/reports', bearer(token));
}

export function getAdminReport(id: string, token: string): Promise<AdminReportView> {
  return request<AdminReportView>(
    `/api/admin/reports/${encodeURIComponent(id)}`,
    bearer(token),
  );
}
