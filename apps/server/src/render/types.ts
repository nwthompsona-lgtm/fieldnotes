/**
 * Render model — the resolved view the template consumes. The wiring builds this from
 * the `Report` contract + storage URLs for each photo (so the template never touches
 * storage or the DB). Grouping (by area/trade) is computed here, not in the template.
 */
export interface RenderPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface RenderObservation {
  id: string;
  order: number;
  cleanedDescription: string;
  /** Verbatim transcript — only included for the admin/raw view, never the PM report. */
  transcript?: string;
  trade?: string;
  area?: string;
  photos: RenderPhoto[];
}

export interface ReportRenderModel {
  id: string;
  projectName: string;
  date: string; // YYYY-MM-DD
  superName: string;
  summary: string;
  observations: RenderObservation[];
  /** Whether this render is the finalized (reviewed) version. */
  reviewed: boolean;
}
