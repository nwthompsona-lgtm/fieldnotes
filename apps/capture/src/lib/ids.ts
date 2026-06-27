// Client-minted ids (spec: the client mints ids offline so media can be
// referenced before the server has ever seen it). uuid v4 via crypto.

export function uuid(): string {
  // crypto.randomUUID is available in all PWA-capable browsers (iOS 15.4+).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback (should never hit on target devices).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
