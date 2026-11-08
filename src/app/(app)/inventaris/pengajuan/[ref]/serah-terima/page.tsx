import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { AlertMessage } from "@/components/ui/alert-message";
import { getRequestDetailByReference, listHandoverUnits } from "@/modules/inventory-borrowing/server/borrowing";
import {
  formatInventoryCopy,
  INVENTORY_ERROR_COPY,
  INVENTORY_ERROR_COPY_VARIANTS,
  inventoryCapabilities,
  jakartaToday,
} from "@/modules/inventory-borrowing/types";
import { formatDate } from "@/modules/inventory-borrowing/ui/format";
import { HandoverForm } from "@/modules/inventory-borrowing/ui/handover-form";
import { NarrowPage } from "@/modules/inventory-borrowing/ui/inventory-header";
import { pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { RequestSummaryCard } from "@/modules/inventory-borrowing/ui/request-summary";
import { handoverHref, QUEUE_PATH, requestHref } from "@/modules/inventory-borrowing/ui/routes";
import { BackLink, NotFoundCard, UnavailableNotice } from "@/modules/inventory-borrowing/ui/states";
import { inventoryPageTitle } from "../../../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Serahkan barang") };
}

/**
 * "Serahkan barang" (design screen 9) at /inventaris/pengajuan/{ref}/serah-terima. borrowing.handle
 * only; the Server Action and the database check again. A request that cannot be handed over (any
 * more) goes back to its detail, which shows why.
 */
export default async function HandoverPage({ params }: { params: Promise<{ ref: string }> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  const noActivePeriod = !capabilities.hasActivePeriod;
  if (!capabilities.canHandle) return <ForbiddenScreen noActivePeriod={noActivePeriod} />;

  const reference = safeDecode((await params).ref);
  const notFound = (
    <NarrowPage>
      <NotFoundCard text={INVENTORY_ERROR_COPY_VARIANTS.notFound.request} backHref={QUEUE_PATH} backLabel="Kembali ke Antrean" />
    </NarrowPage>
  );
  if (reference === null) return notFound;

  const detail = await getRequestDetailByReference(reference);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, handoverHref(reference));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={noActivePeriod} />;
    if (failure === "not_found" || failure === "invalid") return notFound;
    return <Unavailable />;
  }

  const d = detail.data;
  const head = (
    <>
      <BackLink href={requestHref(d.reference)}>Pengajuan {d.reference}</BackLink>
      <h1 className="font-heading text-display-sm text-title">Serahkan barang</h1>
      <RequestSummaryCard detail={d} />
    </>
  );

  // Not before the start date (A-IB8): the form is replaced by the date.
  if (d.status === "approved" && !d.actions.canHandOver && d.startDate > jakartaToday()) {
    return (
      <NarrowPage>
        {head}
        <AlertMessage role="status" tone="info">
          {formatInventoryCopy(INVENTORY_ERROR_COPY.too_early ?? "", { tanggal: formatDate(d.startDate) })}
        </AlertMessage>
      </NarrowPage>
    );
  }
  if (!d.actions.canHandOver) redirect(requestHref(d.reference));

  const units = await listHandoverUnits(d.requestId);
  if (!units.ok) {
    if (pageFailure(units.error, handoverHref(reference)) === "forbidden") return <ForbiddenScreen noActivePeriod={noActivePeriod} />;
    return <Unavailable />;
  }

  return (
    <NarrowPage>
      {head}
      <HandoverForm detail={d} units={units.data} />
    </NarrowPage>
  );
}

function Unavailable() {
  return (
    <ListNavigationProvider>
      <NarrowPage>
        <UnavailableNotice />
      </NarrowPage>
    </ListNavigationProvider>
  );
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
