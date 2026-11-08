import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { listEntries } from "@/modules/inventory-borrowing/server/catalog";
import { inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { NarrowPage } from "@/modules/inventory-borrowing/ui/inventory-header";
import { ItemCreateForm } from "@/modules/inventory-borrowing/ui/item-form";
import { firstFailure, pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { ITEM_NEW_PATH } from "@/modules/inventory-borrowing/ui/routes";
import { UnavailableNotice } from "@/modules/inventory-borrowing/ui/states";
import { inventoryPageTitle } from "../../../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Tambah barang") };
}

/** "Tambah barang" (design 7.1, 7.2). inventory.manage only; the Server Action and the database check again. */
export default async function NewItemPage() {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  if (!capabilities.canManageInventory) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const [categories, locations] = await Promise.all([listEntries({ kind: "category" }), listEntries({ kind: "location" })]);
  const failure = firstFailure(
    categories.ok ? null : pageFailure(categories.error, ITEM_NEW_PATH),
    locations.ok ? null : pageFailure(locations.error, ITEM_NEW_PATH),
  );
  if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  return (
    <NarrowPage>
      {categories.ok && locations.ok ? (
        <ItemCreateForm categories={categories.data} locations={locations.data} />
      ) : (
        <ListNavigationProvider>
          <UnavailableNotice />
        </ListNavigationProvider>
      )}
    </NarrowPage>
  );
}
