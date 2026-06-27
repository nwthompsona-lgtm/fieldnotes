// Report API client (the in-app report review/edit/send). The capture app is offline-first
// for CAPTURE, but reviewing a synthesized report is inherently online — these calls hit the
// live server (API_BASE). CORS on the server is open, so the capture origin is allowed.
import { API_BASE } from '../config';
import type { Report, ReportEdit, ProcessingStatus, ReportStatus } from '@fieldreport/contracts';

export interface ReportStatusResponse {
  status: ReportStatus;
  processing: ProcessingStatus;
  error?: string;
}

/** Public hosted report (HTML) — what gets shared with the PM/owner. */
export const hostedUrl = (id: string): string => `${API_BASE}/r/${id}`;
/** Hosted PDF. */
export const pdfUrl = (id: string): string => `${API_BASE}/r/${id}.pdf`;

export async function getReport(id: string): Promise<Report> {
  const r = await fetch(`${API_BASE}/api/reports/${id}`);
  if (!r.ok) throw new Error(`Couldn't load the report (HTTP ${r.status}).`);
  return (await r.json()) as Report;
}

export async function getReportStatus(id: string): Promise<ReportStatusResponse> {
  const r = await fetch(`${API_BASE}/api/reports/${id}/status`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as ReportStatusResponse;
}

export async function patchReport(id: string, edit: ReportEdit): Promise<Report> {
  const r = await fetch(`${API_BASE}/api/reports/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(edit),
  });
  if (!r.ok) throw new Error(`Couldn't save your edit (HTTP ${r.status}).`);
  return (await r.json()) as Report;
}

export async function finalizeReport(id: string): Promise<Report> {
  const r = await fetch(`${API_BASE}/api/reports/${id}/finalize`, { method: 'POST' });
  if (!r.ok) throw new Error(`Couldn't finalize the report (HTTP ${r.status}).`);
  return (await r.json()) as Report;
}
