// readTotalCount / isCut (src/lib/supabase/limits.ts): how the server tells a complete export answer
// from one cut by PostgREST max_rows, using total_count from the database (migration 20261109100000).
import { describe, expect, it } from "vitest";
import { isCut, readTotalCount } from "@/lib/supabase/limits";

const rows = (n: number, total: number) => Array.from({ length: n }, () => ({ total_count: total }));

describe("readTotalCount", () => {
  it("no rows = total 0", () => expect(readTotalCount([])).toBe(0));
  it("returns the shared total when every row agrees and the total covers the rows", () => {
    expect(readTotalCount(rows(3, 3))).toBe(3);
    expect(readTotalCount(rows(1000, 4321))).toBe(4321);
  });
  it("null (inconsistent) when rows disagree", () => {
    expect(readTotalCount([{ total_count: 2 }, { total_count: 3 }])).toBeNull();
  });
  it("null (inconsistent) when more rows arrived than counted", () => {
    expect(readTotalCount(rows(3, 2))).toBeNull();
  });
});

describe("isCut", () => {
  it("false when every counted row arrived (also at exactly 1000)", () => {
    expect(isCut({ rows: [], totalCount: 0 })).toBe(false);
    expect(isCut({ rows: rows(1000, 1000), totalCount: 1000 })).toBe(false);
  });
  it("true when fewer rows arrived than counted", () => {
    expect(isCut({ rows: rows(1000, 1001), totalCount: 1001 })).toBe(true);
  });
});
