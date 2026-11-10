"use client";

import { useRouter } from "next/navigation";
import { downloadExport, ExportMenu, type ExportFormat, type ExportOutcome } from "@/components/list/export-menu";
import {
  letterErrorMessage,
  letterExportFileName,
  type LetterError,
  type LetterExportInput,
  type LetterListFilters,
} from "../types";
import { goToLogin } from "./action-sheet";
import { COPY } from "./copy";

const EXPORT_ROUTE = "/api/letters/export";

/**
 * "Ekspor" on Surat Masuk and Surat Keluar (design screen 11, 14): the filters the rows were read
 * with (never raw address values), all matching rows, Excel, CSV or PDF. Only for letters.export; the
 * route and the database check again and write the export log before any file is returned.
 */
export function LettersExport({ filters }: { filters: LetterListFilters }) {
  const router = useRouter();

  async function onExport(format: ExportFormat): Promise<ExportOutcome> {
    const body: LetterExportInput = { format, filters };
    const result = await downloadExport(EXPORT_ROUTE, body, letterExportFileName(filters.type, format));
    if (result.kind === "saved") return { kind: "done", fileName: result.fileName };
    if (result.kind === "network") return { kind: "error", text: COPY.network, icon: "wifi_off" };
    const error = await readError(result.response);
    if (error.code === "unauthenticated") {
      goToLogin(router);
      return { kind: "none" };
    }
    return { kind: "error", text: letterErrorMessage(error, "export") ?? COPY.unavailable };
  }

  return <ExportMenu onExport={onExport} note={COPY.exportNote} />;
}

async function readError(response: Response): Promise<LetterError> {
  try {
    const body = (await response.json()) as { error?: LetterError };
    if (body.error && typeof body.error.code === "string") return body.error;
  } catch {
    // Not JSON: fall through.
  }
  if (response.status === 401) return { code: "unauthenticated" };
  if (response.status === 403) return { code: "forbidden" };
  return { code: "unavailable" };
}
