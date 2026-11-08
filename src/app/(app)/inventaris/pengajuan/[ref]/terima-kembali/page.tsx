import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { getRequestDetailByReference } from "@/modules/inventory-borrowing/server/borrowing";
import { INVENTORY_ERROR_COPY_VARIANTS, inventoryCapabilities } from "@/modules/inventory-borrowing/types";
import { NarrowPage } from "@/modules/inventory-borrowing/ui/inventory-header";
import { pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { RequestSummaryCard } from "@/modules/inventory-borrowing/ui/request-summary";
import { ReturnForm } from "@/modules/inventory-borrowing/ui/return-form";
import { QUEUE_PATH, requestHref, returnHref } from "@/modules/inventory-borrowing/ui/routes";
import { BackLink, NotFoundCard, UnavailableNotice } from "@/modules/inventory-borrowing/ui/states";
import { inventoryPageTitle } from "../../../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Terima pengembalian") };
}

/**
 * "Terima pengembalian" (design screen 10) at /inventaris/pengajuan/{ref}/terima-kembali.
 * borrowing.handle only; the photo route, the Server Action and the database check again. A request
 * with nothing to take back (any more) goes back to its detail.
 */
export default async function ReturnPage({ params }: { params: Promise<{ ref: string }> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  const noActivePeriod = !capabilities.hasActivePeriod;
  if (!capabilities.canHandle) return <ForbiddenScreen noActivePeriod={noActivePeriod} />;

  let reference: string | null;
  try {
    reference = decodeURIComponent((await params).ref);
  } catch {
    reference = null;
  }
  const notFound = (
    <NarrowPage>
      <NotFoundCard text={INVENTORY_ERROR_COPY_VARIANTS.notFound.request} backHref={QUEUE_PATH} backLabel="Kembali ke Antrean" />
    </NarrowPage>
  );
  if (reference === null) return notFound;

  const detail = await getRequestDetailByReference(reference);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, returnHref(reference));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={noActivePeriod} />;
    if (failure === "not_found" || failure === "invalid") return notFound;
    return (
      <ListNavigationProvider>
        <NarrowPage>
          <UnavailableNotice />
        </NarrowPage>
      </ListNavigationProvider>
    );
  }

  const d = detail.data;
  if (!d.actions.canReturn) redirect(requestHref(d.reference));

  return (
    <NarrowPage>
      <BackLink href={requestHref(d.reference)}>Pengajuan {d.reference}</BackLink>
      <h1 className="font-heading text-display-sm text-title">Terima pengembalian</h1>
      <RequestSummaryCard detail={d} />
      <ReturnForm detail={d} />
    </NarrowPage>
  );
}
