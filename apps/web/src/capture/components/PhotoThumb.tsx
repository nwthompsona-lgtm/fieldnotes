import { useEffect, useState } from 'react';
import { db } from '../db';
import { useBlobUrl } from '../hooks/useBlobUrl';

interface Props {
  photoId: string;
  className?: string;
}

/** Renders a thumbnail by loading the compressed blob from IndexedDB. */
export function PhotoThumb({ photoId, className }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let alive = true;
    db.photos.get(photoId).then((row) => {
      if (alive) setBlob(row?.blob ?? null);
    });
    return () => {
      alive = false;
    };
  }, [photoId]);
  const url = useBlobUrl(blob);
  return url ? <img className={className ?? 'thumb'} src={url} alt="observation" /> : <div className={className ?? 'thumb'} />;
}
