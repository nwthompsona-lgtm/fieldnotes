/**
 * The report template ("Adaptive" layout — Claude Design handoff, spec §3/§6). Pure
 * presentation over a ReportRenderModel: header + summary + observations grouped by area.
 *
 * Card type follows the photo(s): a single landscape photo stacks (photo on top, caption
 * below); a single portrait photo sits beside its caption; a lone observation or any
 * multi-photo observation becomes a full-width "wide" card (photo tray + caption beside).
 * Photos render at true aspect ratio with object-fit:contain — never cropped.
 */
import React from 'react';
import type { ReportRenderModel, RenderObservation, RenderPhoto } from './types.js';

const UNCLEAR_HINT = 'narration was unclear';

/** Group by area, else trade, else a default bucket — first-appearance order, observation
 *  order preserved within each group. */
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

export function prettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isLandscape = (p: RenderPhoto) => (p.width ?? 0) >= (p.height ?? 1);
const descClass = (o: RenderObservation, big = false) =>
  `${big ? 'cap-lg' : 'cap'}${o.cleanedDescription.toLowerCase().includes(UNCLEAR_HINT) ? ' desc-unclear' : ''}`;

function PinIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" style={{ flex: '0 0 auto' }}>
      <path d="M12 21c4-4.5 6.5-7.3 6.5-10.5A6.5 6.5 0 1 0 5.5 10.5C5.5 13.7 8 16.5 12 21Z" />
      <circle cx="12" cy="10.5" r="2.1" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="#2563EB" style={{ flex: '0 0 auto' }}>
      <path d="M12 2.6l1.7 5.2 5.2 1.7-5.2 1.7L12 16.4l-1.7-5.2L5.1 9.5l5.2-1.7Z" />
    </svg>
  );
}
function FramesIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: '0 0 auto' }}>
      <rect x="3" y="3" width="13" height="13" rx="2" />
      <path d="M8 21h11a2 2 0 0 0 2-2V8" />
    </svg>
  );
}

function Chips({
  o,
  photoCount = 0,
  sectionKey,
}: {
  o: RenderObservation;
  photoCount?: number;
  sectionKey?: string;
}) {
  // The section band already shows the area; only chip it when it adds info (differs).
  const showArea = o.area && o.area !== sectionKey;
  return (
    <div className="chips">
      {o.trade ? <span className="chip-trade">{o.trade}</span> : null}
      {showArea ? (
        <span className="chip-area">
          <PinIcon />
          {o.area}
        </span>
      ) : null}
      {photoCount >= 2 ? (
        <span className="chip-photos">
          <FramesIcon />
          {photoCount} photos
        </span>
      ) : null}
    </div>
  );
}

function PhotoBox({
  photo,
  badge,
  style,
}: {
  photo: RenderPhoto;
  badge?: string;
  style: React.CSSProperties;
}) {
  return (
    <div className="ph-box" style={style}>
      {photo.url ? <img src={photo.url} alt={badge ? `Observation ${badge}` : 'Observation photo'} /> : null}
      {badge ? <div className="ph-badge">{badge}</div> : null}
    </div>
  );
}

/** Full-width card: photo tray (1+ photos) + caption beside. Used for any multi-photo
 *  observation and for a lone observation in its section. */
function WideCard({ o, num, sectionKey }: { o: RenderObservation; num: string; sectionKey?: string }) {
  const multi = o.photos.length >= 2;
  const h = o.photos.length === 1 ? 220 : 180;
  return (
    <div className="card card-hero">
      {o.photos.length > 0 ? (
        <div className="tray">
          {o.photos.map((p, i) => (
            <PhotoBox
              key={p.id}
              photo={p}
              badge={i === 0 ? num : undefined}
              style={{ height: h, aspectRatio: isLandscape(p) ? '4 / 3' : '3 / 4' }}
            />
          ))}
        </div>
      ) : null}
      <div className="cap-hero">
        <Chips o={o} photoCount={multi ? o.photos.length : 0} sectionKey={sectionKey} />
        <p className={descClass(o, true)}>{o.cleanedDescription}</p>
      </div>
    </div>
  );
}

/** Half-width card for a single-photo observation in a multi-observation section. */
function HalfCard({ o, num, sectionKey }: { o: RenderObservation; num: string; sectionKey?: string }) {
  const p = o.photos[0];
  if (!p) {
    return (
      <div className="card">
        <div className="cap-block">
          <Chips o={o} sectionKey={sectionKey} />
          <p className={descClass(o)}>{o.cleanedDescription}</p>
        </div>
      </div>
    );
  }
  if (isLandscape(p)) {
    return (
      <div className="card card-stacked">
        <div className="ph-frame-top">
          <PhotoBox photo={p} badge={num} style={{ width: '100%', aspectRatio: '4 / 3' }} />
        </div>
        <div className="cap-block">
          <Chips o={o} sectionKey={sectionKey} />
          <p className={descClass(o)}>{o.cleanedDescription}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="card card-beside">
      <div className="ph-frame-side">
        <PhotoBox photo={p} badge={num} style={{ width: 160, aspectRatio: '3 / 4' }} />
      </div>
      <div className="cap-side">
        <Chips o={o} sectionKey={sectionKey} />
        <p className={descClass(o)}>{o.cleanedDescription}</p>
      </div>
    </div>
  );
}

type Row = { full: boolean; items: RenderObservation[] };

/** Pack a section's observations into rows: full-width cards (multi-photo, or a lone
 *  observation) take a whole row; single-photo cards pair two-up. */
function chunkRows(items: RenderObservation[]): Row[] {
  const rows: Row[] = [];
  let pendingHalf: RenderObservation | null = null;
  for (const o of items) {
    const full = o.photos.length >= 2 || items.length === 1;
    if (full) {
      if (pendingHalf) {
        rows.push({ full: false, items: [pendingHalf] });
        pendingHalf = null;
      }
      rows.push({ full: true, items: [o] });
    } else if (pendingHalf) {
      rows.push({ full: false, items: [pendingHalf, o] });
      pendingHalf = null;
    } else {
      pendingHalf = o;
    }
  }
  if (pendingHalf) rows.push({ full: false, items: [pendingHalf] });
  return rows;
}

export function ReportDocument({ model }: { model: ReportRenderModel }) {
  const groups = groupObservations(model.observations);
  const showGroupHeads =
    groups.length > 1 || (groups[0]?.key && groups[0].key !== 'General Observations');

  // Continuous, zero-padded numbering across the whole report (01…NN), in observation order.
  const numOf = new Map<string, number>();
  let running = 0;
  for (const g of groups) for (const o of g.items) numOf.set(o.id, ++running);
  const total = model.observations.length;

  return (
    <div className="page">
      <div className="wrap">
        <header className="rep-header">
          <div className="brand">
            <span className="brand-mark">FR</span>
            <div>
              <div className="brand-kicker">Daily Field Report</div>
              <div className="brand-title">{model.projectName}</div>
            </div>
          </div>
          <div className="rep-meta">
            <div className="date">{prettyDate(model.date)}</div>
            <div className="sub">Prepared by {model.superName}</div>
            <div className="sub">
              {total} observation{total === 1 ? '' : 's'}
            </div>
          </div>
        </header>
        <div className="rule" />

        {!model.reviewed ? (
          <div className="draft-banner" style={{ marginTop: 16 }}>
            DRAFT — pending superintendent review. Not for distribution.
          </div>
        ) : null}

        {model.summary?.trim() ? (
          <div className="summary">
            <h2>Report Summary</h2>
            <p>{model.summary}</p>
          </div>
        ) : null}

        {groups.map((g) => {
          const extra =
            g.items.length === 1 && (g.items[0]?.photos.length ?? 0) >= 2
              ? ` · ${g.items[0]!.photos.length} photos`
              : '';
          return (
            <div key={g.key}>
              {showGroupHeads ? (
                <div className="section-band">
                  <span className="section-tab" />
                  <span className="section-label">{g.key}</span>
                  <span className="section-count">
                    {g.items.length} observation{g.items.length === 1 ? '' : 's'}
                    {extra}
                  </span>
                  <span className="section-rule" />
                </div>
              ) : null}
              {chunkRows(g.items).map((row, ri) => (
                <div className="obs-row" key={ri}>
                  {row.full ? (
                    <div className="obs-full">
                      <WideCard o={row.items[0]!} num={pad2(numOf.get(row.items[0]!.id)!)} sectionKey={g.key} />
                    </div>
                  ) : (
                    <>
                      {row.items.map((o) => (
                        <div className="obs-half" key={o.id}>
                          <HalfCard o={o} num={pad2(numOf.get(o.id)!)} sectionKey={g.key} />
                        </div>
                      ))}
                      {row.items.length === 1 ? <div className="obs-spacer" /> : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        <footer className="report-footer">
          <span className="footer-note">
            <SparkleIcon />
            {model.reviewed
              ? 'AI-assisted, superintendent-reviewed.'
              : 'AI-assisted draft — pending superintendent review.'}
          </span>
          <span className="footer-meta">
            {model.projectName} · {prettyDate(model.date)}
          </span>
        </footer>
      </div>
    </div>
  );
}
