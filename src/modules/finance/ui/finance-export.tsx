"use client";

import { useRouter } from "next/navigation";
import { downloadExport, ExportMenu, type ExportFormat, type ExportOutcome } from "@/components/list/export-menu";
import {
  FINANCE_COPY,
  FINANCE_ROUTES,
  financeErrorMessage,
  financeExportFileName,
  type FinanceError,
  type FinanceExportInput,
  type FinanceListFilters,
} from "../types";
import { goToLogin } from "./action-sheet";
import { UI_COPY } from "./copy";

/**
 * "Ekspor" (spec 7 screen 8, F7): the list with the filters the rows were read with (never raw address
 * values). Excel, CSV or PDF. Only for finance.export; the route and the database check again and write
 * the export log before any file is returned. `periodLabel` is only for the file name shown if the server
 * sends none.
 */
export function FinanceExport({ filters, periodLabel }: { filters: FinanceListFilters; periodLabel: string | null }) {
  const router = useRouter();

  async function onExport(format: ExportFormat): Promise<ExportOutcome> {
    const body: FinanceExportInput = { format, filters };
    const result = await downloadExport(FINANCE_ROUTES.export, body, financeExportFileName(format, periodLabel));
    if (result.kind === "saved") return { kind: "done", fileName: result.fileName };
    if (result.kind === "network") return { kind: "error", text: UI_COPY.network, icon: "wifi_off" };
    const error = await readError(result.response);
    if (error.code === "unauthenticated") {
      goToLogin(router);
      return { kind: "none" };
    }
    return { kind: "error", text: financeErrorMessage(error, "export") ?? FINANCE_COPY.list.error };
  }

  return <ExportMenu intro={FINANCE_COPY.export.menuTitle} onExport={onExport} />;
}

async function readError(response: Response): Promise<FinanceError> {
  try {
    const body = (await response.json()) as { error?: FinanceError };
    if (body.error && typeof body.error.code === "string") return body.error;
  } catch {
    // Not JSON: fall through.
  }
  if (response.status === 401) return { code: "unauthenticated" };
  if (response.status === 403) return { code: "forbidden" };
  return { code: "unavailable" };
}
