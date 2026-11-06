import type { AccessState } from "@/lib/auth/types";
import { memberDataCapabilities } from "@/modules/member-data/types";

/**
 * Side drawer items (D-021): only modules that are built AND that the person may open.
 * Stitch order and icons. Hiding an item is convenience only; every page checks access itself.
 */
export type NavIcon = "dashboard" | "group";

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
  // Finance, Notulensi Rapat, Surat Menyurat and Inventaris join here when their modules ship.
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
