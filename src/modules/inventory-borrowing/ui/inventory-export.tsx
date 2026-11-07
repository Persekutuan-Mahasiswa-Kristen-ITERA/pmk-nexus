"use client";

import { useRouter } from "next/navigation";
import { downloadExport, ExportMenu, type ExportFormat, type ExportOutcome } from "@/components/list/export-menu";
import { inventoryErrorMessage, type CatalogFilters, type InventoryError } from "../types";
import { COPY } from "./copy";

const CATALOG_EXPORT_URL = "/api/inventory/export";

/**
 * "Ekspor" on Katalog (design screen 12). Shown only with inventory.export; the route checks again.
 * Sends the VALIDATED filters the list was read with (CatalogPage.filters), never raw address values
 * (R15), as a JSON CatalogExportInput.
 */
export function CatalogExport({ filters }: { filters: CatalogFilters }) {
  const router = useRouter();

  async function onExport(format: ExportFormat): Promise<ExportOutcome> {
    const result = await downloadExport(CATALOG_EXPORT_URL, { format, filters }, `inventaris.${format}`);
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
  }

  return <ExportMenu onExport={onExport} />;
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
