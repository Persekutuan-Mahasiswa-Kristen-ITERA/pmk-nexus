import type { AccessState } from "@/lib/auth/types";
import { FINANCE_NAV_ITEM, financeCapabilities } from "@/modules/finance/types";
import { inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { memberDataCapabilities } from "@/modules/member-data/types";
import { minuteCapabilities } from "@/modules/minutes/types";

/**
 * Side drawer items (D-021): only modules that are built AND that the person may open.
 * Stitch order and icons. Hiding an item is convenience only; every page checks access itself.
 */
export type NavIcon = "dashboard" | "group" | "finance" | "minutes" | "letters" | "inventory";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
};

/** Data the drawer shows, computed on the server from the access state. Plain values only. */
export type NavData = {
  items: NavItem[];
  memberName: string;
  periodLabel: string | null;
};

export function buildNavData(state: Extract<AccessState, { kind: "member" }>): NavData {
  const items: NavItem[] = [{ href: "/", label: "Dashboard", icon: "dashboard" }];
  if (memberDataCapabilities(state).canView) {
    items.push({ href: "/data-anggota", label: "Data Anggota", icon: "group" });
  }
  // Finance sits before Notulensi Rapat (Stitch order). finance.view only, so a Treasurer or a BPH member
  // sees it; a department head or a plain member does not (D-021, FN-03). Hiding is convenience only.
  if (financeCapabilities(state).canView) {
    items.push({ href: FINANCE_NAV_ITEM.href, label: FINANCE_NAV_ITEM.label, icon: "finance" });
  }
  if (minuteCapabilities(state).canView) {
    // minutes.view in any unit scope (spec 2, D-021): a department secretary sees it for her own unit.
    items.push({ href: "/notulensi", label: "Notulensi Rapat", icon: "minutes" });
  }
  // Surat Menyurat shows for EVERY active member (D-025, exception to D-021): anyone may request a letter
  // ("Permohonan Saya" is a fixed right); the register segments inside keep their own keys.
  items.push({ href: "/surat", label: "Surat Menyurat", icon: "letters" });
  if (inventoryCapabilities(state).canViewCatalog) {
    // inventory.view is baseline for every active member (D01), so almost everyone sees it.
    items.push({ href: "/inventaris", label: "Manajemen & Inventaris", icon: "inventory" });
  }
  return {
    items,
    memberName: state.member.fullName,
    periodLabel: state.member.activePeriodLabel,
  };
}

/** "/" matches only itself; a module matches its own sub-paths too. */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
