// Drawer items per D-021 (MD-01..MD-05 UI side) and the cn() Stitch text-size fix (src/lib/utils.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccessState, PermissionGrant } from "@/lib/auth/types";
import { buildNavData, isActiveHref } from "@/components/shell/nav";
import { cn } from "@/lib/utils";

type MemberState = Extract<AccessState, { kind: "member" }>;
const grant = (key: string, scope: "all" | "units" = "all"): PermissionGrant => ({ key, scope, unitIds: scope === "units" ? ["u1"] : [], isSensitive: true });
const state = (keys: PermissionGrant[], opts: { name?: string; label?: string | null; admin?: boolean } = {}): MemberState => ({
  kind: "member",
  member: { memberId: "m", fullName: opts.name ?? "Tester", memberType: "student", isSystemAdmin: opts.admin ?? false, activePeriodId: opts.label === null ? null : "p", activePeriodLabel: opts.label === undefined ? "2026/2027" : opts.label },
  permissions: keys,
});

const DASHBOARD = { href: "/", label: "Dashboard", icon: "dashboard" };
const DATA = { href: "/data-anggota", label: "Data Anggota", icon: "group" };

describe("buildNavData (D-021): only built modules the person may open", () => {
  it("BPH (view + export + log): Dashboard, Data Anggota", () => {
    expect(buildNavData(state([grant("member_data.view"), grant("member_data.export"), grant("member_data.view_export_log")])).items).toEqual([DASHBOARD, DATA]);
  });
  it("Kepala Departemen / Biro (view only): Dashboard, Data Anggota", () => {
    expect(buildNavData(state([grant("member_data.view")])).items).toEqual([DASHBOARD, DATA]);
  });
  it("System Admin without a position: Dashboard only (admin is not a business-data user)", () => {
    expect(buildNavData(state([], { admin: true })).items).toEqual([DASHBOARD]);
  });
  it("regular member, lecturer, staff, previous-period officer, secretary-level (no member_data key): Dashboard only", () => {
    for (const keys of [[], [grant("finance.view")], [grant("letters.manage"), grant("inventory.manage")]]) {
      expect(buildNavData(state(keys)).items).toEqual([DASHBOARD]);
    }
  });
  it("a Member Data key limited to units, or only the export key, does not unlock the item", () => {
    expect(buildNavData(state([grant("member_data.view", "units")])).items).toEqual([DASHBOARD]);
    expect(buildNavData(state([grant("member_data.export")])).items).toEqual([DASHBOARD]);
    expect(buildNavData(state([grant("member_data.view_export_log")])).items).toEqual([DASHBOARD]);
  });
  it("Dashboard is first and always present; unbuilt modules never appear (no 'Segera hadir' items)", () => {
    const everything = buildNavData(state(["member_data.view", "finance.view", "letters.view", "inventory.view", "minutes.view"].map((k) => grant(k))));
    expect(everything.items[0]).toEqual(DASHBOARD);
    expect(everything.items.map((i) => i.label)).toEqual(["Dashboard", "Data Anggota"]);
  });
  it("carries the member name and period label for the drawer footer; no period -> null", () => {
    expect(buildNavData(state([], { name: "Budi", label: "2026/2027" }))).toMatchObject({ memberName: "Budi", periodLabel: "2026/2027" });
    expect(buildNavData(state([], { label: null })).periodLabel).toBeNull();
  });
  it("contains plain values only (it is passed to a client component)", () => {
    const nav = buildNavData(state([grant("member_data.view")]));
    expect(JSON.parse(JSON.stringify(nav))).toEqual(nav);
  });
});

describe("isActiveHref (aria-current)", () => {
  it("'/' matches only itself; a module matches itself and sub-paths, not look-alikes", () => {
    expect(isActiveHref("/", "/")).toBe(true);
    expect(isActiveHref("/data-anggota", "/")).toBe(false);
    expect(isActiveHref("/data-anggota", "/data-anggota")).toBe(true);
    expect(isActiveHref("/data-anggota/123", "/data-anggota")).toBe(true);
    expect(isActiveHref("/data-anggota-lama", "/data-anggota")).toBe(false);
    expect(isActiveHref("/", "/data-anggota")).toBe(false);
  });
});

describe("cn(): Stitch text sizes survive a following colour class (regression)", () => {
  // Read the real tokens, so a new `--text-*` token added to globals.css without updating utils.ts fails here.
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const tokens = [...new Set([...css.matchAll(/^\s*--text-([a-z0-9-]+):/gm)].map((m) => m[1]).filter((t) => !t.includes("--")))];

  it("finds the Stitch scale in globals.css (guards against the parser silently matching nothing)", () => {
    expect(tokens).toEqual(expect.arrayContaining(["display-lg", "headline-lg", "body-md", "label-lg", "label-sm", "numeric-metric", "field"]));
  });
  it("the exact bug: cn('text-label-lg text-walnut') keeps both", () => {
    expect(cn("text-label-lg text-walnut")).toBe("text-label-lg text-walnut");
  });
  for (const token of tokens) {
    it(`text-${token} keeps its size when a colour follows, and when a colour precedes`, () => {
      expect(cn(`text-${token} text-walnut`).split(" ").sort()).toEqual([`text-${token}`, "text-walnut"].sort());
      expect(cn(`text-walnut text-${token}`).split(" ").sort()).toEqual([`text-${token}`, "text-walnut"].sort());
    });
  }
  it("a real conflict is still resolved: later colour wins, later size wins", () => {
    expect(cn("text-ink text-walnut")).toBe("text-walnut");
    expect(cn("text-label-lg text-body-sm")).toBe("text-body-sm");
    expect(cn("text-sm text-label-lg")).toBe("text-label-lg");
    expect(cn("text-label-lg text-sm")).toBe("text-sm");
  });
  it("a colour whose name starts with a size token is still a colour (text-field-line, text-field vs text-ink)", () => {
    expect(cn("text-field text-field-line").split(" ").sort()).toEqual(["text-field", "text-field-line"]);
    expect(cn("text-field-line text-ink")).toBe("text-ink");
  });
  it("ordinary merging is unharmed", () => {
    expect(cn("p-2 p-4", "px-1", false && "hidden", null, undefined, "font-bold")).toBe("p-4 px-1 font-bold");
  });
});
