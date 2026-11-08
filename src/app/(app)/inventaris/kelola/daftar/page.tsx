import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { listEntries } from "@/modules/inventory-borrowing/server/catalog";
import { inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { ListColumn } from "@/modules/inventory-borrowing/ui/inventory-header";
import { ListsScreen } from "@/modules/inventory-borrowing/ui/lists-screen";
import { pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { listsHref, readListKind, type SearchParams } from "@/modules/inventory-borrowing/ui/routes";
import { UnavailableNotice } from "@/modules/inventory-borrowing/ui/states";
import { inventoryPageTitle } from "../../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Kategori dan lokasi") };
}

/**
 * "Kategori dan lokasi" (design screen 5) at /inventaris/kelola/daftar?kind=location. inventory.manage
 * only (A-IB2); the Server Actions and the database check again.
 */
export default async function ListsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  if (!capabilities.canManageInventory) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const kind = readListKind(await searchParams);
  const entries = await listEntries({ kind, includeInactive: true });
  if (!entries.ok && pageFailure(entries.error, listsHref(kind)) === "forbidden") {
    return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
  }

  return (
    <ListColumn>
      {entries.ok ? (
        <ListsScreen kind={kind} entries={entries.data} />
      ) : (
        <ListNavigationProvider>
          <UnavailableNotice />
        </ListNavigationProvider>
      )}
    </ListColumn>
  );
}
