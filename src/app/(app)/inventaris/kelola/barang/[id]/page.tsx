import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { getItemDetail, listEntries } from "@/modules/inventory-borrowing/server/catalog";
import { INVENTORY_ERROR_COPY_VARIANTS, inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { NarrowPage } from "@/modules/inventory-borrowing/ui/inventory-header";
import { ItemEditForm } from "@/modules/inventory-borrowing/ui/item-edit-form";
import { firstFailure, pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { itemEditHref, MANAGE_PATH, readId } from "@/modules/inventory-borrowing/ui/routes";
import { NotFoundCard, UnavailableNotice } from "@/modules/inventory-borrowing/ui/states";
import { inventoryPageTitle } from "../../../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Ubah barang") };
}

/**
 * "Ubah barang" (design 7.3) at /inventaris/kelola/barang/{id}. inventory.manage only; every Server
 * Action on the page and the database check again. Managers also see archived items and units.
 */
export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  if (!capabilities.canManageInventory) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const notFound = (
    <NarrowPage>
      <NotFoundCard text={INVENTORY_ERROR_COPY_VARIANTS.notFound.item} backHref={MANAGE_PATH} backLabel="Kembali ke Kelola Barang" />
    </NarrowPage>
  );

  const { id } = await params;
  const itemId = readId(id);
  if (!itemId) return notFound;

  const [detail, categories, locations] = await Promise.all([
    getItemDetail(itemId),
    listEntries({ kind: "category" }),
    listEntries({ kind: "location" }),
  ]);

  const next = itemEditHref(itemId);
  const failure = firstFailure(
    detail.ok ? null : pageFailure(detail.error, next),
    categories.ok ? null : pageFailure(categories.error, next),
    locations.ok ? null : pageFailure(locations.error, next),
  );
  if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
  if (!detail.ok && (failure === "not_found" || failure === "invalid")) return notFound;

  if (!detail.ok || !categories.ok || !locations.ok) {
    return (
      <ListNavigationProvider>
        <NarrowPage>
          <UnavailableNotice />
        </NarrowPage>
      </ListNavigationProvider>
    );
  }

  return (
    <NarrowPage>
      <ItemEditForm item={detail.data} categories={categories.data} locations={locations.data} />
    </NarrowPage>
  );
}
