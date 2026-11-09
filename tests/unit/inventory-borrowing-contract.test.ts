// Inventory and Borrowing contract (src/modules/inventory-borrowing/types.ts) and error mapping
// (src/lib/picore/inventory-borrowing.ts): dates, overdue, capabilities per persona, zod limits, copy, hint mapping.
// Expected values are written from the spec (docs/modules/inventory-borrowing.md sections 2, 5, 11, 11c), not copied from the code.
import { describe, expect, it } from "vitest";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";
import { mapInventoryDbError } from "@/lib/picore/inventory-borrowing";
import {
  addDays,
  catalogFiltersSchema,
  defaultQueueView,
  evidenceFileSchema,
  evidencePathSchema,
  evidencePhotoPath,
  formatInventoryCopy,
  INVENTORY_DB_HINTS,
  INVENTORY_ERROR_COPY,
  INVENTORY_LIMITS,
  inventoryCapabilities,
  inventoryErrorMessage,
  inventoryExportStatusLabel,
  inventorySearchSchema,
  isRequestOverdue,
  itemCreateSchema,
  jakartaToday,
  maxRequestEndDate,
  queueFiltersSchema,
  rangeDays,
  requestCreateSchema,
  requestExtendSchema,
  requestHandOverSchema,
  requestReferenceSchema,
  requestReturnSchema,
  returnOutcomeInputSchema,
  stockMoveSchema,
  type InventoryErrorCode,
} from "@/modules/inventory-borrowing/types";

const ID = "11111111-2222-3333-4444-555555555555";
const ID2 = "aaaaaaaa-2222-3333-4444-555555555555";
const LINE = "bbbbbbbb-2222-3333-4444-555555555555";
const UNIT = "cccccccc-2222-3333-4444-555555555555";

describe("dates are Jakarta calendar days (R19, IB-35, IB-50)", () => {
  it("jakartaToday flips at 17:00 UTC; 23:30 UTC is already the next Jakarta day", () => {
    expect(jakartaToday(new Date("2026-11-08T16:59:59Z"))).toBe("2026-11-08");
    expect(jakartaToday(new Date("2026-11-08T17:00:00Z"))).toBe("2026-11-09");
    expect(jakartaToday(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-09");
    expect(jakartaToday(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(jakartaToday(new Date("2028-02-28T18:00:00Z"))).toBe("2028-02-29"); // leap day
  });
  it("addDays: month, year and leap-year borders, negative numbers", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-09", 0)).toBe("2026-11-09");
  });
  it("maxRequestEndDate = start + 365 days (366-day year ends one day earlier in the calendar)", () => {
    expect(maxRequestEndDate("2026-01-01")).toBe("2027-01-01");
    expect(maxRequestEndDate("2028-01-01")).toBe("2028-12-31");
    expect(maxRequestEndDate("2026-11-09")).toBe("2027-11-09");
  });
  it("rangeDays is inclusive of both ends (R4, IB-37)", () => {
    expect(rangeDays("2026-11-09", "2026-11-09")).toBe(1);
    expect(rangeDays("2026-11-09", "2026-11-11")).toBe(3);
    expect(rangeDays("2026-02-27", "2026-03-02")).toBe(4);
  });
});

describe("isRequestOverdue (F9): Dipinjam, something still out, end date before today", () => {
  const base = { status: "borrowed", qtyOutstanding: 1, endDate: "2026-11-08" } as const;
  it("true only when all three hold", () => {
    expect(isRequestOverdue(base, "2026-11-09")).toBe(true);
    expect(isRequestOverdue(base, "2026-11-08")).toBe(false); // end date itself is not late
    expect(isRequestOverdue({ ...base, qtyOutstanding: 0 }, "2026-11-20")).toBe(false);
    for (const status of ["submitted", "approved", "returned", "cancelled", "rejected"] as const) {
      expect(isRequestOverdue({ ...base, status }, "2026-11-20")).toBe(false);
    }
  });
});

describe("inventoryCapabilities per persona (spec section 2): absent, not greyed out", () => {
  const grant = (key: string, scope = "all"): PermissionGrant => ({ key, scope, unitIds: [], isSensitive: false }) as PermissionGrant;
  const member = (keys: string[], period: string | null = "p-1"): AccessState => ({
    kind: "member",
    member: { memberId: "m", fullName: "T", memberType: "student", isSystemAdmin: false, activePeriodId: period, activePeriodLabel: period ? "2026/2027" : null },
    permissions: keys.map((k) => grant(k)),
  }) as AccessState;

  const MEMBER = ["inventory.view"];
  const BPH = ["inventory.view", "inventory.export", "borrowing.view_all", "borrowing.export"];
  const OPS_STAFF = ["inventory.view", "inventory.manage", "inventory.export", "borrowing.view_all", "borrowing.handle", "borrowing.export"];
  const OPS_HEAD = [...OPS_STAFF, "borrowing.approve"];

  it("plain member / lecturer / admin without position / previous-period officer: view, own requests, request; nothing else", () => {
    const c = inventoryCapabilities(member(MEMBER));
    expect(c).toMatchObject({ canViewCatalog: true, canViewOwnRequests: true, canSubmitRequest: true, canManageInventory: false, canViewAllRequests: false, canApprove: false, canHandle: false, canExportInventory: false, canExportBorrowing: false, canRecordOutsideParty: false, canViewItemHistory: false });
  });
  it("BPH: all requests and exports, no approve, no handle, no manage", () => {
    const c = inventoryCapabilities(member(BPH));
    expect(c).toMatchObject({ canViewAllRequests: true, canExportInventory: true, canExportBorrowing: true, canViewItemHistory: true, canApprove: false, canHandle: false, canManageInventory: false });
  });
  it("Operations staff: handle and manage, no approve; heads also approve", () => {
    expect(inventoryCapabilities(member(OPS_STAFF))).toMatchObject({ canHandle: true, canManageInventory: true, canApprove: false, canRecordOutsideParty: true });
    expect(inventoryCapabilities(member(OPS_HEAD))).toMatchObject({ canHandle: true, canManageInventory: true, canApprove: true });
  });
  it("export keys without their view key do nothing (R15); a scope other than 'all' grants nothing", () => {
    expect(inventoryCapabilities(member(["inventory.export"]))).toMatchObject({ canExportInventory: false });
    expect(inventoryCapabilities(member(["inventory.view", "borrowing.export"]))).toMatchObject({ canExportBorrowing: false });
    const scoped = { ...member([]), permissions: [{ key: "inventory.manage", scope: "units", unitIds: [ID], isSensitive: false }] } as AccessState;
    expect(inventoryCapabilities(scoped).canManageInventory).toBe(false);
  });
  it("no active period: cannot request, no outside-party option, banner state (R11)", () => {
    const c = inventoryCapabilities(member(OPS_STAFF, null));
    expect(c.hasActivePeriod).toBe(false);
    expect(c.canSubmitRequest).toBe(false);
    expect(c.canRecordOutsideParty).toBe(false);
  });
  it("anonymous, no_access, password_pending, error: nothing at all (L1)", () => {
    for (const state of [{ kind: "anonymous" }, { kind: "no_access" }, { kind: "password_pending" }, { kind: "error" }] as AccessState[]) {
      const c = inventoryCapabilities(state);
      expect(Object.values(c).every((v) => v === false), state.kind).toBe(true);
    }
  });
  it("default queue view: heads pending, other Operations ready, BPH all", () => {
    expect(defaultQueueView(inventoryCapabilities(member(OPS_HEAD)))).toBe("pending");
    expect(defaultQueueView(inventoryCapabilities(member(OPS_STAFF)))).toBe("ready");
    expect(defaultQueueView(inventoryCapabilities(member(BPH)))).toBe("all");
  });
});

describe("request form schema (IB-16, IB-51, IB-55)", () => {
  const line = { itemId: ID, quantity: 1 };
  const ok = { startDate: "2026-11-09", endDate: "2026-11-10", purpose: "Kegiatan", lines: [line] };
  const issue = (input: unknown) => {
    const r = requestCreateSchema.safeParse(input);
    return r.success ? null : r.error.issues[0].message;
  };
  it("accepts the normal case and the start+365 boundary; refuses 366", () => {
    expect(issue(ok)).toBeNull();
    expect(issue({ ...ok, endDate: "2027-11-09" })).toBeNull();
    expect(issue({ ...ok, endDate: "2027-11-10" })).toBe("date_range_too_long");
    expect(issue({ ...ok, startDate: "2028-01-01", endDate: "2028-12-31" })).toBeNull(); // leap-year edge
    expect(issue({ ...ok, startDate: "2028-01-01", endDate: "2029-01-01" })).toBe("date_range_too_long");
  });
  it("end before start; impossible dates; before the year 2000", () => {
    expect(issue({ ...ok, endDate: "2026-11-08" })).toBe("invalid_dates");
    expect(issue({ ...ok, startDate: "2026-02-30" })).toBe("invalid_dates");
    expect(issue({ ...ok, startDate: "2026-13-01" })).toBe("invalid_dates");
    expect(issue({ ...ok, startDate: "1999-12-31", endDate: "2000-01-01" })).toBe("invalid_dates");
    expect(issue({ ...ok, startDate: "9/11/2026" })).toBe("invalid_dates");
  });
  it("quantity: whole numbers 1..9999 only", () => {
    for (const quantity of [0, -1, 1.5, 10000, "3", null, Number.NaN]) {
      expect(issue({ ...ok, lines: [{ itemId: ID, quantity }] }), String(quantity)).toBe("quantity_invalid");
    }
    expect(issue({ ...ok, lines: [{ itemId: ID, quantity: 9999 }] })).toBeNull();
  });
  it("lines: at least one, at most 50, the same item twice is refused (case-insensitive)", () => {
    expect(issue({ ...ok, lines: [] })).toBe("quantity_invalid");
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ itemId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quantity: 1 }));
    expect(issue({ ...ok, lines: many(50) })).toBeNull();
    expect(issue({ ...ok, lines: many(51) })).toBe("too_many_lines");
    expect(issue({ ...ok, lines: [line, { itemId: ID.toUpperCase(), quantity: 2 }] })).toBe("duplicate_item");
  });
  it("purpose and note count characters, not UTF-16 units: 500 emoji pass, 501 do not; blank purpose is text_required", () => {
    expect(issue({ ...ok, purpose: "😀".repeat(500) })).toBeNull();
    expect(issue({ ...ok, purpose: "😀".repeat(501) })).toBe("text_too_long");
    expect(issue({ ...ok, note: "n".repeat(501) })).toBe("text_too_long");
    expect(issue({ ...ok, purpose: "   " })).toBe("text_required");
    expect(issue({ ...ok, purpose: undefined })).toBe("text_required");
  });
  it("outside party: both names required, 120 characters each, trimmed; no other keys (no phone or email, IB-14)", () => {
    expect(issue({ ...ok, outsideParty: { orgName: "Gereja", contactName: "Pak A" } })).toBeNull();
    expect(issue({ ...ok, outsideParty: { orgName: "", contactName: "Pak A" } })).toBe("text_required");
    expect(issue({ ...ok, outsideParty: { orgName: "o".repeat(121), contactName: "Pak A" } })).toBe("text_too_long");
    const parsed = requestCreateSchema.parse({ ...ok, outsideParty: { orgName: "  Gereja  ", contactName: " Pak A ", phone: "0812" } });
    expect(parsed.outsideParty).toEqual({ orgName: "Gereja", contactName: "Pak A" }); // unknown keys dropped, never stored
  });
  it("the requester is never an input: a client-supplied requester id is dropped (IB-14)", () => {
    const parsed = requestCreateSchema.parse({ ...ok, requesterId: ID2, requester_member_id: ID2 });
    expect(JSON.stringify(parsed)).not.toContain(ID2);
  });
});

describe("other write schemas", () => {
  it("extend: note required, date real", () => {
    expect(requestExtendSchema.safeParse({ requestId: ID, version: 2, newEndDate: "2026-12-01", note: "perlu" }).success).toBe(true);
    expect(requestExtendSchema.safeParse({ requestId: ID, version: 2, newEndDate: "2026-12-01", note: "  " }).success).toBe(false);
    expect(requestExtendSchema.safeParse({ requestId: ID, version: 0, newEndDate: "2026-12-01", note: "x" }).success).toBe(false);
  });
  it("hand over: a quantity line or a unit line, never both; 200 units max; duplicate lines refused", () => {
    const base = { requestId: ID, version: 1 };
    expect(requestHandOverSchema.safeParse({ ...base, lines: [{ lineId: LINE, quantity: 2 }] }).success).toBe(true);
    expect(requestHandOverSchema.safeParse({ ...base, lines: [{ lineId: LINE, unitIds: [UNIT] }] }).success).toBe(true);
    expect(requestHandOverSchema.safeParse({ ...base, lines: [{ lineId: LINE, quantity: 1, unitIds: [UNIT] }] }).success).toBe(false);
    expect(requestHandOverSchema.safeParse({ ...base, lines: [{ lineId: LINE, unitIds: [UNIT, UNIT] }] }).success).toBe(false);
    const units = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(requestHandOverSchema.safeParse({ ...base, lines: [{ lineId: LINE, unitIds: units }] }).success).toBe(false);
    expect(requestHandOverSchema.safeParse({ ...base, lines: [{ lineId: LINE, quantity: 1 }, { lineId: LINE, quantity: 1 }] }).success).toBe(false);
  });
  const photo = `${ID}/${ID2}.jpg`;
  it("return outcomes: good needs nothing; damaged needs condition, note and 1-3 photos; lost needs note and photos; exactly one of quantity / unitId", () => {
    const good = { outcome: "good", lineId: LINE, quantity: 1 };
    expect(returnOutcomeInputSchema.safeParse(good).success).toBe(true);
    expect(returnOutcomeInputSchema.safeParse({ ...good, photos: [photo] }).success).toBe(false); // good never carries photos
    const damaged = { outcome: "damaged", lineId: LINE, unitId: UNIT, resultingCondition: "needs_service", note: "patah", photos: [photo] };
    expect(returnOutcomeInputSchema.safeParse(damaged).success).toBe(true);
    expect(returnOutcomeInputSchema.safeParse({ ...damaged, note: "" }).success).toBe(false);
    expect(returnOutcomeInputSchema.safeParse({ ...damaged, photos: [] }).success).toBe(false);
    expect(returnOutcomeInputSchema.safeParse({ ...damaged, photos: [photo, photo, photo, photo] }).success).toBe(false);
    expect(returnOutcomeInputSchema.safeParse({ ...damaged, resultingCondition: "good" }).success).toBe(false); // a damaged return cannot leave it good
    expect(returnOutcomeInputSchema.safeParse({ ...damaged, resultingCondition: undefined }).success).toBe(false);
    expect(returnOutcomeInputSchema.safeParse({ outcome: "lost", lineId: LINE, unitId: UNIT, note: "hilang", photos: [photo] }).success).toBe(true);
    expect(returnOutcomeInputSchema.safeParse({ outcome: "lost", lineId: LINE, unitId: UNIT, note: "hilang" }).success).toBe(false);
    expect(returnOutcomeInputSchema.safeParse({ ...good, unitId: UNIT }).success).toBe(false); // both quantity and unit
    expect(returnOutcomeInputSchema.safeParse({ outcome: "good", lineId: LINE }).success).toBe(false); // neither
  });
  it("return call: photos must live in THIS request's folder and appear once; a unit only once", () => {
    const base = { requestId: ID, version: 1 };
    const dmg = (p: string, unit = UNIT) => ({ outcome: "damaged", lineId: LINE, unitId: unit, resultingCondition: "damaged", note: "x", photos: [p] });
    expect(requestReturnSchema.safeParse({ ...base, outcomes: [dmg(photo)] }).success).toBe(true);
    expect(requestReturnSchema.safeParse({ ...base, outcomes: [dmg(`${ID2}/${ID2}.jpg`)] }).success).toBe(false); // another request's folder
    expect(requestReturnSchema.safeParse({ ...base, outcomes: [dmg(photo), dmg(photo, ID2)] }).success).toBe(false); // same photo twice
    expect(requestReturnSchema.safeParse({ ...base, outcomes: [dmg(photo), { outcome: "good", lineId: LINE, unitId: UNIT }] }).success).toBe(false); // same unit twice
    expect(requestReturnSchema.safeParse({ ...base, outcomes: [] }).success).toBe(false);
  });
  it("evidence path pattern and builder: lower-case ids, jpg/jpeg/png/webp only, no traversal", () => {
    expect(evidencePathSchema.safeParse(photo).success).toBe(true);
    for (const bad of [`${ID}/${ID2}.gif`, `${ID}/${ID2}.JPG`, `../${ID2}.jpg`, `${ID}/../${ID2}.jpg`, `${ID2.toUpperCase()}/${ID}.jpg`, "x.jpg", `${ID}/${ID2}.jpg/extra`, ""]) {
      expect(evidencePathSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(evidencePhotoPath(ID.toUpperCase(), ID2.toUpperCase(), "image/png")).toBe(`${ID}/${ID2}.png`);
    expect(evidencePhotoPath(ID, ID2, "image/webp")).toBe(`${ID}/${ID2}.webp`);
  });
  it("evidence file: JPG, PNG, WebP only, 1 byte up to exactly 1.5 MiB (IB-56)", () => {
    const MAX = 1_572_864;
    expect(evidenceFileSchema.safeParse({ type: "image/jpeg", size: MAX }).success).toBe(true);
    expect(evidenceFileSchema.safeParse({ type: "image/jpeg", size: MAX + 1 }).success).toBe(false);
    expect(evidenceFileSchema.safeParse({ type: "image/jpeg", size: 0 }).success).toBe(false);
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", "text/html", "IMAGE/JPEG", ""]) {
      expect(evidenceFileSchema.safeParse({ type, size: 100 }).success, type).toBe(false);
    }
  });
});

describe("inventory schemas (IB-07, IB-55, P6)", () => {
  it("item create: mode first; counted needs at least one piece and 0..9999 per condition; tracked needs 1..200 units", () => {
    const counted = (stock: unknown) => itemCreateSchema.safeParse({ mode: "quantity", name: "Kabel", stock });
    expect(counted({ good: 1 }).success).toBe(true);
    expect(counted({ good: 9999, needsService: 9999, damaged: 9999 }).success).toBe(true);
    for (const stock of [{}, { good: 0 }, { good: 10000 }, { good: -1 }, { good: 1.5 }]) expect(counted(stock).success, JSON.stringify(stock)).toBe(false);
    expect(itemCreateSchema.safeParse({ name: "x", stock: { good: 1 } }).success).toBe(false); // no mode, no guess
    expect(itemCreateSchema.safeParse({ mode: "other", name: "x" }).success).toBe(false);
    const tracked = (n: number) => itemCreateSchema.safeParse({ mode: "tracked", name: "Drum", units: Array.from({ length: n }, () => ({ condition: "good" })) });
    expect(tracked(1).success).toBe(true);
    expect(tracked(200).success).toBe(true);
    expect(tracked(0).success).toBe(false);
    expect(tracked(201).success).toBe(false);
    expect(itemCreateSchema.safeParse({ mode: "tracked", name: "Drum", units: [{ condition: "lost" }] }).success).toBe(false); // lost is a status, not a condition
  });
  it("names: 120 characters, blank refused; a code field cannot be supplied (codes are the database's)", () => {
    const name = (n: string) => itemCreateSchema.safeParse({ mode: "quantity", name: n, stock: { good: 1 } }).success;
    expect(name("a".repeat(120))).toBe(true);
    expect(name("a".repeat(121))).toBe(false);
    expect(name("   ")).toBe(false);
    const parsed = itemCreateSchema.parse({ mode: "quantity", name: "Kabel", stock: { good: 1 }, code: "INV-0001" });
    expect("code" in parsed).toBe(false);
  });
  it("stock move: source and target must differ; quantity at least 1; a reason is always required", () => {
    const move = (o: Record<string, unknown>) => stockMoveSchema.safeParse({ itemId: ID, from: "good", to: "damaged", quantity: 1, note: "jatuh", ...o });
    expect(move({}).success).toBe(true);
    expect(move({ to: "good" }).success).toBe(false);
    expect(move({ quantity: 0 }).success).toBe(false);
    expect(move({ note: "  " }).success).toBe(false);
  });
});

describe("reads: search, filters, references", () => {
  it("search: spaces collapsed, blank = none, 120 characters after cleaning, 480 raw", () => {
    expect(inventorySearchSchema.parse("  kabel   hdmi  ")).toBe("kabel hdmi");
    expect(inventorySearchSchema.parse("   ")).toBeNull();
    expect(inventorySearchSchema.safeParse("a".repeat(120)).success).toBe(true);
    expect(inventorySearchSchema.safeParse("a".repeat(121)).success).toBe(false);
    expect(inventorySearchSchema.safeParse(`${"a ".repeat(100)}`).success).toBe(false); // 199 characters after cleaning
    expect(inventorySearchSchema.safeParse(" ".repeat(481)).success).toBe(false);
  });
  it("date filters: both or none, end not before start", () => {
    expect(catalogFiltersSchema.safeParse({ availableFrom: "2026-11-09", availableTo: "2026-11-09" }).success).toBe(true);
    expect(catalogFiltersSchema.safeParse({ availableFrom: "2026-11-09" }).success).toBe(false);
    expect(catalogFiltersSchema.safeParse({ availableFrom: "2026-11-10", availableTo: "2026-11-09" }).success).toBe(false);
    expect(queueFiltersSchema.safeParse({ view: "all", from: "2026-11-09" }).success).toBe(false);
    expect(queueFiltersSchema.safeParse({ view: "everything" }).success).toBe(false);
    expect(queueFiltersSchema.parse({}).view).toBe("pending");
  });
  it("request reference: PJM- plus 4-16 digits, case-insensitive, trimmed, 40 characters raw", () => {
    expect(requestReferenceSchema.parse(" pjm-0001 ")).toBe("PJM-0001");
    expect(requestReferenceSchema.safeParse("PJM-123").success).toBe(false);
    expect(requestReferenceSchema.safeParse("PJM-0001; drop table").success).toBe(false);
    expect(requestReferenceSchema.safeParse("PJM-0001" + " ".repeat(40)).success).toBe(false);
    expect(requestReferenceSchema.safeParse(`PJM-${"1".repeat(17)}`).success).toBe(false);
  });
});

describe("error copy and database hint mapping", () => {
  it("every error code has a text or an explicit per-field null; the owner's texts are exact", () => {
    expect(INVENTORY_ERROR_COPY.too_many_open_requests).toBe("Kamu sudah punya 5 pengajuan yang menunggu persetujuan. Tunggu keputusannya atau batalkan salah satu.");
    expect(INVENTORY_ERROR_COPY.daily_request_limit).toBe("Kamu sudah membuat 20 pengajuan hari ini. Coba lagi besok.");
    expect(INVENTORY_ERROR_COPY.date_range_too_long).toBe("Peminjaman paling lama 365 hari dari tanggal mulai. Untuk waktu yang lebih lama, buat pengajuan baru.");
    expect(INVENTORY_ERROR_COPY.already_corrected).toBe("Pengembalian ini sudah pernah dikoreksi. Koreksi hanya boleh sekali.");
    expect(INVENTORY_ERROR_COPY.state_changed).toBe("Data sudah berubah. Muat ulang.");
    // The limits quoted in the copy match the limits enforced
    expect(INVENTORY_ERROR_COPY.too_many_open_requests).toContain(String(INVENTORY_LIMITS.openRequestsPerMember));
    expect(INVENTORY_ERROR_COPY.daily_request_limit).toContain(String(INVENTORY_LIMITS.requestsPerDay));
    expect(INVENTORY_ERROR_COPY.too_many_lines).toContain(String(INVENTORY_LIMITS.linesPerRequest));
    expect(INVENTORY_ERROR_COPY.too_many_units).toContain(String(INVENTORY_LIMITS.unitsPerCall));
    expect(INVENTORY_ERROR_COPY.date_range_too_long).toContain(String(INVENTORY_LIMITS.requestMaxDays));
  });
  it("copy never names a person (counts and dates only)", () => {
    const all = Object.values(INVENTORY_ERROR_COPY).filter((t): t is string => typeof t === "string").join("\n");
    expect(all).not.toMatch(/\b(peminjam|pemohon)\s+[A-Z]/);
    expect(inventoryErrorMessage({ code: "open_requests_exist", count: 2 }, "manage")).toBe("Barang ini masih punya 2 peminjaman yang belum selesai. Selesaikan atau batalkan dulu.");
    expect(inventoryErrorMessage({ code: "reserved_stock", count: 3 }, "manage")).toContain("kurang dari 3");
  });
  it("action variants: approve vs extend vs submit vs correction", () => {
    const stock = { code: "insufficient_stock", itemId: null, conflictDate: null } as const;
    expect(inventoryErrorMessage(stock, "approve")).toBe("Stok tidak cukup di tanggal itu. Pengajuan tetap menunggu.");
    expect(inventoryErrorMessage(stock, "submitRequest")).toBe("Stok berubah. Cek lagi.");
    expect(inventoryErrorMessage(stock, "correctReturn")).toBe("Stok tidak cukup untuk koreksi ini.");
    expect(inventoryErrorMessage(stock, "extend")).toBe("Bentrok dengan pengajuan lain. Tanggal belum diubah."); // no date found
    expect(inventoryErrorMessage({ ...stock, conflictDate: "2026-11-12" }, "extend", { formatDate: (d) => `tgl ${d}` })).toBe("Bentrok dengan pengajuan lain pada tgl 2026-11-12. Tanggal belum diubah.");
    expect(inventoryErrorMessage({ code: "no_active_period" }, "submitRequest")).toBe("Belum ada periode aktif. Pengajuan belum bisa dibuat.");
    expect(inventoryErrorMessage({ code: "too_early", startDate: "2026-11-12" }, "handOver")).toBe("Belum bisa diserahkan. Tanggal mulai peminjaman: 2026-11-12.");
    expect(inventoryErrorMessage({ code: "too_early", startDate: null }, "handOver")).toBe(INVENTORY_ERROR_COPY.unavailable);
    expect(inventoryErrorMessage({ code: "photo_too_large", maxMb: 1.5 }, "uploadPhoto")).toBe("Foto terlalu besar. Pakai foto di bawah 1,5 MB.");
    expect(inventoryErrorMessage({ code: "unit_not_available", unitId: null, unitStatus: null }, "handOver", { unitCode: "INV-0007" })).toBe("Unit INV-0007 baru dipakai pengajuan lain. Pilih unit lain.");
    expect(inventoryErrorMessage({ code: "unauthenticated" }, "read")).toBeNull(); // redirect, no text
    expect(inventoryErrorMessage({ code: "invalid_photo", ref: null }, "return")).toBe(INVENTORY_ERROR_COPY.unavailable); // a bad saved path is a bug, not the person's fault
  });
  it("formatInventoryCopy leaves unknown placeholders and cannot be tricked by prototype keys", () => {
    expect(formatInventoryCopy("{n} dari {m} {constructor}", { n: 1 })).toBe("1 dari {m} {constructor}");
    expect(formatInventoryCopy("{tanggal}", { tanggal: "10 Des" })).toBe("10 Des");
  });
  it("database hints map to codes ONLY through the table; prototype names and unknown hints fail closed as unavailable", () => {
    const err = (hint: string, details: string | null = null, code = "P0001") => mapInventoryDbError({ code, hint, details });
    expect(err("insufficient_stock", ID).code).toBe("insufficient_stock");
    expect(err("self_approval_blocked", null, "42501").code).toBe("self_approval_blocked");
    expect(err("permission_required", null, "42501").code).toBe("forbidden");
    expect(err("not_active_member", null, "42501").code).toBe("forbidden");
    expect(err("state_changed").code).toBe("state_changed");
    expect(err("request_not_found", null, "P0002")).toMatchObject({ code: "not_found", entity: "request" });
    expect(err("too_many_open_requests", "5")).toEqual({ code: "too_many_open_requests", limit: 5 });
    expect(err("daily_request_limit", "20")).toEqual({ code: "daily_request_limit", limit: 20 });
    expect(err("date_range_too_long", "2027-11-09", "22023")).toMatchObject({ code: "date_range_too_long", maxEndDate: "2027-11-09" });
    expect(err("reserved_stock", "4")).toEqual({ code: "reserved_stock", count: 4 });
    expect(err("reserved_stock", "not a number").code).toBe("unavailable"); // never a made-up count
    for (const hint of ["constructor", "__proto__", "toString", "hasOwnProperty", "no_such_hint", "", "append_only", "immutable_column", "export_log_direct_insert"]) {
      expect(err(hint).code, hint).toBe("unavailable");
    }
    expect(mapInventoryDbError({ code: "XX000", hint: "state_changed", details: null }).code).toBe("unavailable"); // unexpected SQLSTATE
    expect(mapInventoryDbError({}).code).toBe("unavailable");
    // Every hint in the table maps to a known code
    for (const [hint, code] of Object.entries(INVENTORY_DB_HINTS)) expect(INVENTORY_ERROR_COPY, `${hint} -> ${code}`).toHaveProperty(code as InventoryErrorCode);
  });
  it("export status column: Hilang wins over an archived item; archived unit or item = Nonaktif; else Aktif", () => {
    expect(inventoryExportStatusLabel({ unitStatus: "lost", itemIsActive: false })).toBe("Hilang");
    expect(inventoryExportStatusLabel({ unitStatus: "archived", itemIsActive: true })).toBe("Nonaktif");
    expect(inventoryExportStatusLabel({ unitStatus: "active", itemIsActive: false })).toBe("Nonaktif");
    expect(inventoryExportStatusLabel({ unitStatus: null, itemIsActive: true })).toBe("Aktif");
  });
});
