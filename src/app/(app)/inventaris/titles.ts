import "server-only";
import { getAccessState } from "@/lib/auth/session";
import { inventoryCapabilities } from "@/modules/inventory-borrowing/types";

// The (app) layout may show a status screen instead of the page; the tab title follows it.
const STATUS_TITLES = {
  anonymous: "Masuk",
  error: "Terjadi gangguan",
  no_access: "Belum ada akses",
  password_pending: "Ganti kata sandi dulu",
} as const;

/** Tab title of an inventory page: the page's own title, or the status / no-permission title. */
export async function inventoryPageTitle(title: string): Promise<string> {
  const state = await getAccessState(); // cached per request
  if (state.kind !== "member") return STATUS_TITLES[state.kind];
  return inventoryCapabilities(state).canViewCatalog ? title : "Tidak punya akses";
}
