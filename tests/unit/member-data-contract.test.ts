// Member Data: zod schemas, page-address parsing, database error mapping, capability derivation, URL builder, pagination
// window, copy helpers. Spec: docs/modules/member-data.md (MD-10, MD-25, MD-26, MD-28, MD-30, MD-01..MD-05 capability side).
import { describe, expect, it } from "vitest";
import { mapMemberDataError } from "@/lib/picore/member-data";
import { parseMemberListSearchParams } from "@/modules/member-data/server/params";
import { invalidInput } from "@/modules/member-data/server/validation";
import {
  MEMBER_LIST_PAGE_SIZE_MAX,
  MEMBER_SEARCH_MAX_LENGTH,
  MEMBER_SEARCH_RAW_MAX_LENGTH,
  formatMemberUnit,
  memberDataCapabilities,
  memberExportFormatSchema,
  memberExportLogQuerySchema,
  memberListFiltersSchema,
  memberListQuerySchema,
  memberSearchSchema,
  memberStatusFilterSchema,
  memberUnitIdSchema,
} from "@/modules/member-data/types";
import { formatCount, rangeText } from "@/modules/member-data/ui/copy";
import { isDefaultFilter, memberListHref } from "@/modules/member-data/ui/list-url";
import { pageWindow } from "@/modules/member-data/ui/member-pagination";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";

const UNIT = "11111111-2222-3333-4444-555555555555";

describe("memberSearchSchema (F2: trim, collapse spaces, blank = none)", () => {
  it("trims and collapses whitespace runs", () => {
    expect(memberSearchSchema.parse("  Bulk   Anggota \t 11  ")).toBe("Bulk Anggota 11");
  });
  it("blank and whitespace-only become null", () => {
    expect(memberSearchSchema.parse("")).toBeNull();
    expect(memberSearchSchema.parse("   \t\n ")).toBeNull();
  });
  it("accepts exactly 120 characters after cleaning, refuses 121", () => {
    expect(memberSearchSchema.safeParse("a".repeat(MEMBER_SEARCH_MAX_LENGTH)).success).toBe(true);
    expect(memberSearchSchema.safeParse("a".repeat(MEMBER_SEARCH_MAX_LENGTH + 1)).success).toBe(false);
  });
  it("padding does not count against the 120 limit, but raw input above 480 is refused before cleaning", () => {
    expect(memberSearchSchema.safeParse(`   ${"a".repeat(120)}   `).success).toBe(true);
    expect(memberSearchSchema.safeParse(" ".repeat(MEMBER_SEARCH_RAW_MAX_LENGTH)).success).toBe(true);
    expect(memberSearchSchema.safeParse(" ".repeat(MEMBER_SEARCH_RAW_MAX_LENGTH + 1)).success).toBe(false);
  });
  it("does not strip or alter special characters (the database uses it as plain text)", () => {
    expect(memberSearchSchema.parse("O'Brien %_\\ <b>")).toBe("O'Brien %_\\ <b>");
  });
  it("refuses a non-string", () => {
    expect(memberSearchSchema.safeParse(5).success).toBe(false);
    expect(memberSearchSchema.safeParse({}).success).toBe(false);
  });
});

describe("memberUnitIdSchema / status / format enums", () => {
  it("accepts a GUID, including a seeded non-RFC-4122 one", () => {
    expect(memberUnitIdSchema.safeParse(UNIT).success).toBe(true);
    expect(memberUnitIdSchema.safeParse("00000000-0000-0000-0000-000000000001").success).toBe(true);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "abc", "1", `${UNIT}x`, `'; drop table x;--`, "00000000-0000-0000-0000"]) {
      expect(memberUnitIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
  it("status filter has exactly active, inactive, all", () => {
    expect(memberStatusFilterSchema.options).toEqual(["active", "inactive", "all"]);
    expect(memberStatusFilterSchema.safeParse("Aktif").success).toBe(false);
    expect(memberStatusFilterSchema.safeParse("ALL").success).toBe(false);
  });
  it("export format has exactly xlsx, csv, pdf (MD-30)", () => {
    expect(memberExportFormatSchema.options).toEqual(["xlsx", "csv", "pdf"]);
    for (const bad of ["docx", "XLSX", "", "csv ", "json"]) expect(memberExportFormatSchema.safeParse(bad).success, bad).toBe(false);
  });
});

describe("memberListQuerySchema (MD-26: page size cannot be raised)", () => {
  it("applies defaults: page 1, size 20, status active, no search or unit", () => {
    expect(memberListQuerySchema.parse({})).toEqual({ search: null, unitId: null, status: "active", page: 1, pageSize: 20 });
  });
  it("refuses a page size above the server maximum and below 1; never clamps", () => {
    expect(memberListQuerySchema.safeParse({ pageSize: MEMBER_LIST_PAGE_SIZE_MAX }).success).toBe(true);
    expect(memberListQuerySchema.safeParse({ pageSize: MEMBER_LIST_PAGE_SIZE_MAX + 1 }).success).toBe(false);
    expect(memberListQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
    expect(memberListQuerySchema.safeParse({ pageSize: 1_000_000 }).success).toBe(false);
  });
  it("refuses page 0, negative, fractional", () => {
    for (const page of [0, -1, 1.5, Number.NaN]) expect(memberListQuerySchema.safeParse({ page }).success, String(page)).toBe(false);
  });
  it("an invalid field is named by invalidInput() (first issue)", () => {
    const r = memberListQuerySchema.safeParse({ pageSize: 51 });
    expect(r.success).toBe(false);
    if (!r.success) expect(invalidInput(r.error)).toEqual({ code: "invalid_input", field: "pageSize" });
    const s = memberListQuerySchema.safeParse({ search: "a".repeat(200) });
    if (!s.success) expect(invalidInput(s.error)).toEqual({ code: "invalid_input", field: "search" });
    else throw new Error("expected failure");
  });
  it("memberListFiltersSchema strips unknown keys (nothing extra reaches the database call)", () => {
    const parsed = memberListFiltersSchema.parse({ status: "all", email: "a@b.c", nim: "123" } as object);
    expect(Object.keys(parsed).sort()).toEqual(["search", "status", "unitId"]);
  });
  it("export-log page size is capped at 50", () => {
    expect(memberExportLogQuerySchema.safeParse({ pageSize: 51 }).success).toBe(false);
    expect(memberExportLogQuerySchema.parse({}).pageSize).toBe(50);
  });
});

describe("parseMemberListSearchParams (lenient page address, never throws)", () => {
  const parse = (q: string | Record<string, string | string[] | undefined>) =>
    parseMemberListSearchParams(typeof q === "string" ? new URLSearchParams(q) : q);

  it("empty address -> all defaults left to the schema", () => {
    expect(parse("")).toEqual({ search: null, unitId: null, status: undefined, page: undefined });
  });
  it("reads q, unit, status, page", () => {
    expect(parse(`q=Budi&unit=${UNIT}&status=inactive&page=3`)).toEqual({ search: "Budi", unitId: UNIT, status: "inactive", page: 3 });
  });
  it("a bad unit falls back to no filter; a bad status falls back to the default", () => {
    expect(parse("unit=not-a-guid&status=weird")).toMatchObject({ unitId: null, status: undefined });
  });
  it("page: only plain positive integers; everything else is page 1 (undefined)", () => {
    for (const bad of ["0", "-2", "1e3", "0x10", "2.5", " 3", "3 ", "abc", "", "١٢", "9999999999", "+4"]) {
      expect(parse({ page: bad }).page, JSON.stringify(bad)).toBeUndefined();
    }
    expect(parse({ page: "007" }).page).toBe(7);
    expect(parse({ page: "999999999" }).page).toBe(100_000); // capped; the database returns the last page
  });
  it("search is kept as typed (untrimmed, so the server can still refuse it) but bounded to 481 characters", () => {
    expect(parse({ q: "  x  " }).search).toBe("  x  ");
    expect(parse({ q: "a".repeat(5000) }).search).toHaveLength(481);
    expect(parse({ q: "   " }).search).toBeNull();
  });
  it("a repeated parameter uses its first value", () => {
    expect(parse({ q: ["first", "second"], status: ["all", "inactive"] })).toMatchObject({ search: "first", status: "all" });
    expect(parse("q=one&q=two").search).toBe("one");
  });
  it("a page size in the address is ignored (MD-26)", () => {
    const out = parse("pageSize=500&page_size=500&limit=500&size=500") as Record<string, unknown>;
    expect(out.pageSize).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("500");
  });
  it("hostile values do not throw", () => {
    expect(() => parse({ q: "\u0000\ud800", unit: "__proto__", status: "constructor", page: "toString" })).not.toThrow();
    expect(() => parse("q=%E0%A4%A&unit=%00")).not.toThrow();
  });
});

describe("mapMemberDataError: only known hints map, everything else is 'unavailable' (no database text leaks)", () => {
  it("42501 + permission_required -> forbidden", () => {
    expect(mapMemberDataError({ code: "42501", hint: "permission_required" })).toEqual({ code: "forbidden" });
  });
  it("22023 + each known hint -> invalid_input with the field", () => {
    const table = {
      invalid_status: "status",
      invalid_page: "page",
      invalid_page_size: "pageSize",
      invalid_format: "format",
      invalid_unit: "unitId",
      search_too_long: "search",
    } as const;
    for (const [hint, field] of Object.entries(table)) {
      expect(mapMemberDataError({ code: "22023", hint })).toEqual({ code: "invalid_input", field });
    }
  });
  it("unknown hint, other codes, missing hint -> unavailable", () => {
    const unavailable = { code: "unavailable" };
    expect(mapMemberDataError({ code: "22023", hint: "something_new" })).toEqual(unavailable);
    expect(mapMemberDataError({ code: "22023", hint: null })).toEqual(unavailable);
    expect(mapMemberDataError({ code: "22023" })).toEqual(unavailable);
    expect(mapMemberDataError({ code: "42501" })).toEqual(unavailable); // a missing GRANT looks like 42501 without the hint
    expect(mapMemberDataError({ code: "42501", hint: "export_log_direct_insert" })).toEqual(unavailable);
    expect(mapMemberDataError({ code: "PGRST106", hint: "permission_required" })).toEqual(unavailable);
    expect(mapMemberDataError({ code: "PGRST301" })).toEqual(unavailable);
    expect(mapMemberDataError({})).toEqual(unavailable);
    expect(mapMemberDataError({ code: "57014" })).toEqual(unavailable);
  });
  // BUG-MD-01 (fixed 2026-11-07): prototype keys of INVALID_INPUT_HINTS must not resolve as hints.
  it("BUG-MD-01: prototype keys are not treated as hints", () => {
    for (const hint of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(mapMemberDataError({ code: "22023", hint }), hint).toEqual({ code: "unavailable" });
    }
  });
  it("the result never carries message, details or hint text", () => {
    const err = { code: "XX000", hint: "leak me", message: "relation public.members does not exist", details: "secret" };
    expect(JSON.stringify(mapMemberDataError(err))).toBe('{"code":"unavailable"}');
  });
});

function member(permissions: Partial<PermissionGrant>[], isSystemAdmin = false): Extract<AccessState, { kind: "member" }> {
  return {
    kind: "member",
    member: { memberId: "m1", fullName: "X", memberType: "student", isSystemAdmin, activePeriodId: "p1", activePeriodLabel: "2026/2027" },
    permissions: permissions.map((p) => ({ key: "", scope: "all", unitIds: [], isSensitive: true, ...p })),
  };
}

describe("memberDataCapabilities (drawer, button, page gate)", () => {
  it("BPH: view + export + log (MD-01)", () => {
    const c = memberDataCapabilities(member([{ key: "member_data.view" }, { key: "member_data.export" }, { key: "member_data.view_export_log" }]));
    expect(c).toEqual({ canView: true, canExport: true, canViewExportLog: true });
  });
  it("Kepala Departemen / Biro: view only (MD-02)", () => {
    expect(memberDataCapabilities(member([{ key: "member_data.view" }]))).toEqual({ canView: true, canExport: false, canViewExportLog: false });
  });
  it("System Admin without keys: no view, no export, but may read the log (MD-03, A-MD10)", () => {
    expect(memberDataCapabilities(member([], true))).toEqual({ canView: false, canExport: false, canViewExportLog: true });
  });
  it("export without view is not enough (R15)", () => {
    expect(memberDataCapabilities(member([{ key: "member_data.export" }]))).toMatchObject({ canView: false, canExport: false });
  });
  it("a grant limited to units does not count (only scope 'all' is offered)", () => {
    const c = memberDataCapabilities(member([{ key: "member_data.view", scope: "units", unitIds: ["u"] }, { key: "member_data.export", scope: "units" }]));
    expect(c).toEqual({ canView: false, canExport: false, canViewExportLog: false });
  });
  it("other modules' keys give nothing here", () => {
    expect(memberDataCapabilities(member([{ key: "finance.view" }, { key: "member_data" }, { key: "member_data.view.extra" }]))).toEqual({ canView: false, canExport: false, canViewExportLog: false });
  });
  it("every non-member state gets nothing", () => {
    for (const kind of ["anonymous", "error", "no_access", "password_pending"] as const) {
      expect(memberDataCapabilities({ kind }), kind).toEqual({ canView: false, canExport: false, canViewExportLog: false });
    }
  });
});

describe("formatMemberUnit (R4)", () => {
  it("division -> 'Parent · Unit'; others -> own name; none -> null", () => {
    expect(formatMemberUnit({ unitName: "Logistik", parentUnitName: "Departemen Operasional" })).toBe("Departemen Operasional · Logistik");
    expect(formatMemberUnit({ unitName: "BPH PMK ITERA", parentUnitName: null })).toBe("BPH PMK ITERA");
    expect(formatMemberUnit({ unitName: null, parentUnitName: null })).toBeNull();
  });
});

describe("memberListHref (F3 step 4: the address holds search, unit, status, page and nothing else)", () => {
  it("defaults are left out: reset is the bare path", () => {
    expect(memberListHref({})).toBe("/data-anggota");
    expect(memberListHref({ status: "active", page: 1, search: "  ", unitId: null })).toBe("/data-anggota");
  });
  it("builds and encodes non-default values", () => {
    const href = memberListHref({ search: "  a&b=c d ", unitId: UNIT, status: "all", page: 3 });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/data-anggota");
    expect(url.searchParams.get("q")).toBe("a&b=c d");
    expect(url.searchParams.get("unit")).toBe(UNIT);
    expect(url.searchParams.get("status")).toBe("all");
    expect(url.searchParams.get("page")).toBe("3");
    expect([...url.searchParams.keys()].sort()).toEqual(["page", "q", "status", "unit"]);
  });
  it("round trip through parseMemberListSearchParams", () => {
    const href = memberListHref({ search: "Budi Santoso", unitId: UNIT, status: "inactive", page: 2 });
    const parsed = parseMemberListSearchParams(new URL(href, "http://x").searchParams);
    expect(parsed).toEqual({ search: "Budi Santoso", unitId: UNIT, status: "inactive", page: 2 });
  });
  it("isDefaultFilter", () => {
    expect(isDefaultFilter({ search: null, unitId: null, status: "active" })).toBe(true);
    expect(isDefaultFilter({ search: "x", unitId: null, status: "active" })).toBe(false);
    expect(isDefaultFilter({ search: null, unitId: UNIT, status: "active" })).toBe(false);
    expect(isDefaultFilter({ search: null, unitId: null, status: "all" })).toBe(false);
  });
});

describe("pageWindow (pagination numbers)", () => {
  it("phone (around 0): first, current, last with gaps", () => {
    expect(pageWindow(1, 3, 0)).toEqual([1, "gap", 3]);
    expect(pageWindow(2, 3, 0)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10, 0)).toEqual([1, "gap", 5, "gap", 10]);
  });
  it("wide (around 1): neighbours too; no gap marker between adjacent numbers", () => {
    expect(pageWindow(1, 3, 1)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10, 1)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageWindow(2, 10, 1)).toEqual([1, 2, 3, "gap", 10]);
    expect(pageWindow(9, 10, 1)).toEqual([1, "gap", 8, 9, 10]);
  });
  it("one page", () => {
    expect(pageWindow(1, 1, 0)).toEqual([1]);
    expect(pageWindow(1, 1, 1)).toEqual([1]);
  });
  it("always contains first, current and last, never repeats a number, always sorted", () => {
    for (let count = 1; count <= 30; count++) {
      for (let page = 1; page <= count; page++) {
        for (const around of [0, 1, 2]) {
          const nums = pageWindow(page, count, around).filter((x): x is number => x !== "gap");
          expect(nums).toContain(1);
          expect(nums).toContain(count);
          expect(nums).toContain(page);
          expect(nums).toEqual([...new Set(nums)].sort((a, b) => a - b));
          expect(Math.max(...nums)).toBeLessThanOrEqual(count);
          expect(Math.min(...nums)).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe("counter text (F4, MD-26)", () => {
  it("'Menampilkan a-b dari N anggota' with Indonesian thousands dots", () => {
    expect(rangeText(1, 20, 45)).toBe("Menampilkan 1-20 dari 45 anggota");
    expect(rangeText(41, 45, 45)).toBe("Menampilkan 41-45 dari 45 anggota");
    expect(rangeText(1001, 1020, 1204)).toBe("Menampilkan 1.001-1.020 dari 1.204 anggota");
    expect(formatCount(0)).toBe("0");
  });
});
