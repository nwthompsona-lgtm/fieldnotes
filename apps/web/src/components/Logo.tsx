/** The two-tone waypoint-pin logomark (Flux brand mark), shared by the auth screens
 *  and the app-shell top bar. Matches the capture app's mark. */
export function Pin({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 22c5-5.6 8-9.3 8-13a8 8 0 1 0-16 0c0 3.7 3 7.4 8 13Z" fill="var(--primary)" />
      <path
        d="M9 9.4v4.6M12 7.6v8.2M15 9.4v4.6"
        stroke="var(--primary-ink)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Brand lockup: pin-in-a-tile + wordmark (as used on the auth cards). */
export function Brand({ pinSize = 18 }: { pinSize?: number }) {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Pin size={pinSize} />
      </span>
      FieldReport
    </span>
  );
}
