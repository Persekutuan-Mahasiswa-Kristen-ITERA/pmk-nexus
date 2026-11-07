// Limits of the Supabase API that server code must respect.

/**
 * PostgREST `max_rows` (supabase/config.toml [api] max_rows; hosted default 1000). A set-returning RPC
 * (`returns table`) answers at most this many rows and drops the rest WITHOUT an error. Callers that
 * need every row (exports) refuse an answer of this size instead of passing on a cut list.
 * Keep in sync with the project setting.
 */
export const POSTGREST_MAX_ROWS = 1000;

/** True when a set-returning RPC answer may have been cut by max_rows (fail closed: treat as too large). */
export function mayBeTruncated(rowCount: number): boolean {
  return rowCount >= POSTGREST_MAX_ROWS;
}
