/**
 * The report template (spec §3, §6) — the artifact the GC/PM judges the product by.
 * Pure presentation: consumes a ReportRenderModel, renders header + summary +
 * grouped observations (photos + cleaned prose) + the required footer. No data access.
 */
import React from 'react';
import type { ReportRenderModel, RenderObservation } from './types.js';

const UNCLEAR_HINT = 'narration was unclear';

/** Group by area, else trade, else a default bucket — in first-appearance order,
 *  preserving observation order within each group. */
function groupObservations(
  obs: RenderObservation[],
): Array<{ key: string; items: RenderObservation[] }> {
  const order: string[] = [];
  const byKey = new Map<string, RenderObservation[]>();
  for (const o of [...obs].sort((a, b) => a.order - b.order)) {
    const key = (o.area || o.trade || 'General Observations').trim();
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(o);
  }
  return order.map((key) => ({ key, items: byKey.get(key)! }));
}

function prettyDate(iso: string): string {
  // iso is YYYY-MM-DD; render as "Friday, June 27, 2026" without timezone surprises.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function Observation({ o }: { o: RenderObservation }) {
  const unclear = o.cleanedDescription.toLowerCase().includes(UNCLEAR_HINT);
  const photoClass = o.photos.length === 1 ? 'photos single' : 'photos';
  return (
    <section className="obs">
      <div className="obs-head">
        <span className="obs-num">{o.order + 1}</span>
        <div className="obs-chips">
          {o.trade ? <span className="chip">{o.trade}</span> : null}
          {o.area ? <span className="chip">{o.area}</span> : null}
        </div>
      </div>
      <div className="obs-body">
        {o.photos.length > 0 ? (
          <div className={photoClass}>
            {o.photos.map((p) => (
              <img key={p.id} src={p.url} alt={`Observation ${o.order + 1}`} />
            ))}
          </div>
        ) : null}
        <p className={unclear ? 'desc unclear' : 'desc'}>{o.cleanedDescription}</p>
      </div>
    </section>
  );
}

export function ReportDocument({ model }: { model: ReportRenderModel }) {
  const groups = groupObservations(model.observations);
  const showGroupHeads =
    groups.length > 1 || (groups[0]?.key && groups[0].key !== 'General Observations');

  return (
    <div className="page">
      <div className="wrap">
        <header className="report-header">
          <div className="brand">
            <span className="mark">FR</span>
            <div>
              <div className="kicker">Daily Field Report</div>
              <div className="title">{model.projectName}</div>
            </div>
          </div>
          <div className="meta">
            <div className="project">{prettyDate(model.date)}</div>
            <div>
              Prepared by: <b>{model.superName}</b>
            </div>
            <div>
              {model.observations.length} observation
              {model.observations.length === 1 ? '' : 's'}
            </div>
          </div>
        </header>

        {!model.reviewed ? (
          <div className="draft-banner">
            DRAFT — pending superintendent review. Not for distribution.
          </div>
        ) : null}

        {model.summary?.trim() ? (
          <div className="summary">
            <h2>Daily Summary</h2>
            <p>{model.summary}</p>
          </div>
        ) : null}

        {groups.map((g) => (
          <div key={g.key}>
            {showGroupHeads ? <div className="group-head">{g.key}</div> : null}
            {g.items.map((o) => (
              <Observation key={o.id} o={o} />
            ))}
          </div>
        ))}

        <footer className="report-footer">
          <span className="badge">
            {model.reviewed
              ? 'AI-assisted, superintendent-reviewed.'
              : 'AI-assisted draft — pending superintendent review.'}
          </span>
          <span>{model.projectName} · {prettyDate(model.date)}</span>
        </footer>
      </div>
    </div>
  );
}
