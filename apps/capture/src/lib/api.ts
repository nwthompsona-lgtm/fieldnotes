// Report API client (the in-app report review/edit/send). The capture app is offline-first
// for CAPTURE, but reviewing a synthesized report is inherently online — these calls hit the
// live server (API_BASE) with the session bearer (§6.3: report reads/edits are gated by
// the permission matrix; a 401 clears the session so the app falls back to login).
import { API_BASE } from '../config';
import { authHeaders, clearSession } from './session';
import type { Report, ReportEdit, ProcessingStatus, ReportStatus } from '@fieldreport/contracts';

export interface ReportStatusResponse {
  status: ReportStatus;
  processing: ProcessingStatus;
  error?: string;
}

/** Hosted report (HTML) — INTERNAL since §6.6 (session-gated; external recipients get
 *  /s/:token capability links via the web app's Send flow). */
export const hostedUrl = (id: string): string => `${API_BASE}/r/${id}`;
/** Hosted PDF (session-gated — fetch via `fetchPdfBlobUrl`, a bare tab can't send the bearer). */
export const pdfUrl = (id: string): string => `${API_BASE}/r/${id}.pdf`;

async function authed<T>(path: string, init?: RequestInit, friendly?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Can't reach the server — check your connection.");
  }
  if (res.status === 401) {
    clearSession();
    throw new Error('Your session has expired — please log in again.');
  }
  if (!res.ok) throw new Error(`${friendly ?? 'Request failed'} (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

export function getReport(id: string): Promise<Report> {
  return authed<Report>(`/api/reports/${id}`, undefined, "Couldn't load the report");
}

export function getReportStatus(id: string): Promise<ReportStatusResponse> {
  return authed<ReportStatusResponse>(`/api/reports/${id}/status`);
}

export function patchReport(id: string, edit: ReportEdit): Promise<Report> {
  return authed<Report>(
    `/api/reports/${id}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(edit),
    },
    "Couldn't save your edit",
  );
}

export function finalizeReport(id: string): Promise<Report> {
  return authed<Report>(
    `/api/reports/${id}/finalize`,
    { method: 'POST' },
    "Couldn't finalize the report",
  );
}

/** Fetch the (session-gated) PDF with the bearer and hand back an object URL a new tab
 *  can display — `window.open(pdfUrl)` alone would 401 since it carries no header. */
export async function fetchPdfBlobUrl(id: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(pdfUrl(id), { headers: { ...authHeaders() } });
  } catch {
    throw new Error("Can't reach the server — check your connection.");
  }
  if (res.status === 401) {
    clearSession();
    throw new Error('Your session has expired — please log in again.');
  }
  if (!res.ok) throw new Error(`Couldn't fetch the PDF (HTTP ${res.status}).`);
  return URL.createObjectURL(await res.blob());
}
