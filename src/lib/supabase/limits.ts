// Limits of the Supabase API that server code must respect.

/**
 * PostgREST `max_rows` (supabase/config.toml [api] max_rows; hosted default 1000) silently cuts a
 * set-returning RPC (`returns table`) answer WITHOUT an error. The export functions therefore return
 * `total_count` (migration 20261109100000: `count(*) over ()` of the full filtered result) on every
 * row, so the server can compare it with the rows it received instead of guessing from a row count.
 */

/** Export rows plus the database's own count of the full result. */
export type CountedRows<T> = { rows: T[]; totalCount: number };

/**
 * The full-result count of an export answer, or null when the answer is inconsistent (rows disagree,
 * or more rows arrived than counted). No rows = total 0.
 */
export function readTotalCount(rows: readonly { total_count: number }[]): number | null {
  if (rows.length === 0) return 0;
  const total = rows[0].total_count;
  if (rows.some((r) => r.total_count !== total) || rows.length > total) return null;
  return total;
}

/** True when fewer rows arrived than the database counted (the answer was cut by max_rows). */
export function isCut<T>(answer: CountedRows<T>): boolean {
  return answer.rows.length < answer.totalCount;
}
