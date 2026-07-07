/**
 * Postgres error classification shared by every write path that races on a unique index
 * (signup, invite-accept). Matches the SQLSTATE 23505 unique-violation code, with a
 * message fallback for drivers/PGlite that surface the text but not the code.
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '23505' || /unique|duplicate key/i.test(e?.message ?? '');
}
