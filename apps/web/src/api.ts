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
    res = await fetch(`${API_BASE}${path}`, init);
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
