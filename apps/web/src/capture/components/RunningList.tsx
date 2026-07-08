import { useEffect, useState } from 'react';
import { db, type ObservationRow } from '../db';
import { deleteObservation, getObservationsForWalk } from '../repo';
import { PhotoThumb } from './PhotoThumb';
import { Icon } from './Icon';

interface Props {
  walkId: string;
  /** Bump to force a refresh after a save/delete. */
  refreshKey: number;
  onChanged: () => void;
}

interface Row {
  obs: ObservationRow;
  firstPhotoId: string | null;
  photoCount: number;
  hasAudio: boolean;
}

/** This walk's observations in order, each a captured row with a thumbnail + delete.
 *  Area/trade aren't known until the server synthesizes the report, so locally we
 *  show the honest capture facts: index, photo count, and whether a voice note exists. */
export function RunningList({ walkId, refreshKey, onChanged }: Props) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const obs = await getObservationsForWalk(walkId);
      const built: Row[] = [];
      for (const o of obs) {
        const photos = await db.photos.where('obsId').equals(o.id).sortBy('order');
        const audio = await db.audio.get(o.id);
        built.push({
          obs: o,
          firstPhotoId: photos[0]?.id ?? null,
          photoCount: photos.length,
          hasAudio: !!audio,
        });
      }
      if (alive) setRows(built);
    })();
    return () => {
      alive = false;
    };
  }, [walkId, refreshKey]);

  if (rows.length === 0) return null;

  async function onDelete(obsId: string) {
    if (!confirm('Delete this observation? This cannot be undone.')) return;
    await deleteObservation(obsId);
    onChanged();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r) => (
        <div
          key={r.obs.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            padding: 10,
          }}
        >
          <div
            style={{
              position: 'relative',
              width: 58,
              height: 58,
              borderRadius: 11,
              overflow: 'hidden',
              background: 'var(--surface-2)',
              flex: '0 0 auto',
            }}
          >
            {r.firstPhotoId ? (
              <PhotoThumb photoId={r.firstPhotoId} className="thumb-cover" />
            ) : null}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--fg)' }}>
              Observation {r.obs.order + 1}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {r.photoCount} photo{r.photoCount === 1 ? '' : 's'} ·{' '}
              {r.hasAudio ? 'voice note ✓' : 'no voice note'}
            </div>
          </div>
          <button
            className="icon-btn danger"
            aria-label="Delete observation"
            onClick={() => onDelete(r.obs.id)}
          >
            <Icon name="trash" size={17} />
          </button>
        </div>
      ))}
    </div>
  );
}
