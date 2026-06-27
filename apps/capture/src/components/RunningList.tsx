import { useEffect, useState } from 'react';
import { db, type ObservationRow } from '../db';
import { deleteObservation, getObservationsForWalk } from '../repo';
import { PhotoThumb } from './PhotoThumb';

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

/**
 * Running list of THIS walk's observations in order (spec §5), each with a
 * thumbnail and a DELETE action. (Per-photo retake/delete lives in the capture
 * flow before save; here we offer delete + a quick "add a photo" retake path
 * by deleting and re-capturing is out of scope of this list — delete is the
 * destructive review action.)
 */
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

  if (rows.length === 0) {
    return <p className="muted center">No observations yet. Take your first one above.</p>;
  }

  async function onDelete(obsId: string) {
    if (!confirm('Delete this observation? This cannot be undone.')) return;
    await deleteObservation(obsId);
    onChanged();
  }

  return (
    <div className="list">
      {rows.map((r) => (
        <div className="obs-item" key={r.obs.id}>
          {r.firstPhotoId ? (
            <PhotoThumb photoId={r.firstPhotoId} />
          ) : (
            <div className="thumb" />
          )}
          <div className="obs-meta">
            <div className="ttl">Observation #{r.obs.order + 1}</div>
            <div className="sub">
              {r.photoCount} photo{r.photoCount === 1 ? '' : 's'} · {r.hasAudio ? 'voice note ✓' : 'no voice note'}
            </div>
          </div>
          <button
            className="btn btn-danger"
            style={{ width: 'auto', padding: '0 16px', minHeight: 48 }}
            onClick={() => onDelete(r.obs.id)}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
