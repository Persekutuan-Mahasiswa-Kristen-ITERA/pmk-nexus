"use client";

import { useRouter } from "next/navigation";
import { downloadExport, ExportMenu, type ExportFormat, type ExportOutcome } from "@/components/list/export-menu";
import { inventoryErrorMessage, type CatalogFilters, type InventoryError, type QueueFiltersInput } from "../types";
import { COPY } from "./copy";

const CATALOG_EXPORT_URL = "/api/inventory/export";
const BORROWING_EXPORT_URL = "/api/inventory/borrowing/export";

/**
 * One export press against an inventory route (design screen 12). Words the result with the contract
 * copy: invalid filters get the Data Anggota text, too many rows get export_too_large, an ended session
 * goes back to login.
 */
function useInventoryExport(url: string, fallbackName: string, filters: unknown) {
  const router = useRouter();

  return async function onExport(format: ExportFormat): Promise<ExportOutcome> {
    const result = await downloadExport(url, { format, filters }, `${fallbackName}.${format}`);
    if (result.kind === "saved") return { kind: "done", fileName: result.fileName };
    if (result.kind === "network") return { kind: "error", icon: "wifi_off", text: COPY.network };

    const error = await readError(result.response);
    if (error.code === "unauthenticated") {
      const next = `${window.location.pathname}${window.location.search}`;
      router.push(`/login?reason=session_ended&next=${encodeURIComponent(next)}`);
      return { kind: "none" };
    }
    if (error.code === "invalid_input" || error.code === "invalid_dates" || error.code === "start_in_past") {
      return { kind: "error", text: COPY.exportInvalid };
    }
    return { kind: "error", text: inventoryErrorMessage(error, "export") ?? COPY.unavailable };
  };
}

/**
 * "Ekspor" on Katalog and Kelola Barang. Shown only with inventory.export; the route checks again.
 * Sends the VALIDATED filters the list was read with (CatalogPage.filters), never raw address values
 * (R15), as a JSON CatalogExportInput.
 */
export function CatalogExport({ filters }: { filters: CatalogFilters }) {
  const onExport = useInventoryExport(CATALOG_EXPORT_URL, "inventaris", filters);
  return <ExportMenu onExport={onExport} />;
}

/**
 * "Ekspor" on Antrean (borrowing.export). The validated queue filters (QueuePage.filters, including the
 * period) or, for the handover list, only the view; the file holds the same rows as the screen.
 */
export function BorrowingExport({ filters, intro }: { filters: QueueFiltersInput; intro?: string }) {
  const onExport = useInventoryExport(BORROWING_EXPORT_URL, "peminjaman", filters);
  return <ExportMenu intro={intro} onExport={onExport} />;
}

/** The route's InventoryErrorBody, or a code from the HTTP status when the body is not ours. */
async function readError(response: Response): Promise<InventoryError> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    if (body.error && typeof body.error.code === "string") return body.error as InventoryError;
  } catch {
    // A proxy page or an HTML error: treat as a temporary fault below.
  }
  if (response.status === 401) return { code: "unauthenticated" };
  if (response.status === 403) return { code: "forbidden" };
  return { code: "unavailable" };
}
