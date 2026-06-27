import { useOnline } from '../hooks/useOnline';

interface Props {
  pendingObservations: number;
}

/** Sticky top bar: brand + online/offline + this-walk pending count (spec §8). */
export function TopBar({ pendingObservations }: Props) {
  const online = useOnline();
  return (
    <header className="topbar">
      <span className="brand">FieldReport</span>
      <span className="status">
        <span className={`dot ${online ? 'online' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span>
        <span className="pill">{pendingObservations} saved</span>
      </span>
    </header>
  );
}
