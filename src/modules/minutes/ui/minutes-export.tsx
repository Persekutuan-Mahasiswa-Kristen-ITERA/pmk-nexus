"use client";

import { useRouter } from "next/navigation";
import { downloadExport, ExportMenu, type ExportFormat, type ExportOutcome } from "@/components/list/export-menu";
import {
  MINUTE_COPY,
  MINUTE_ROUTES,
  minuteErrorMessage,
  minuteExportFileName,
  type MinuteError,
  type MinuteExportInput,
  type MinuteListFilters,
} from "../types";
import { goToLogin } from "./action-sheet";
import { UI_COPY } from "./copy";

type Target = { kind: "list"; filters: MinuteListFilters } | { kind: "single"; minuteId: string; meetingDate: string };

/**
 * "Ekspor" (spec 7 screen 7, F6): the list with the filters the rows were read with (never raw address
 * values), or one minute from its detail. Excel, CSV or PDF. Only for minutes.export; the route and the
 * database check again and write the export log before any file is returned.
 */
export function MinutesExport({ target }: { target: Target }) {
  const router = useRouter();

  async function onExport(format: ExportFormat): Promise<ExportOutcome> {
    const body: MinuteExportInput =
      target.kind === "list" ? { kind: "list", format, filters: target.filters } : { kind: "single", format, minuteId: target.minuteId };
    const fallback = minuteExportFileName(target.kind === "list" ? { kind: "list" } : { kind: "single", meetingDate: target.meetingDate }, format);
    const result = await downloadExport(MINUTE_ROUTES.export, body, fallback);
    if (result.kind === "saved") return { kind: "done", fileName: result.fileName };
    if (result.kind === "network") return { kind: "error", text: UI_COPY.network, icon: "wifi_off" };
    const error = await readError(result.response);
    if (error.code === "unauthenticated") {
      goToLogin(router);
      return { kind: "none" };
    }
    if (error.code === "export_too_large") return { kind: "error", text: MINUTE_COPY.export.tooMany };
    return { kind: "error", text: minuteErrorMessage(error, "export") ?? MINUTE_COPY.unavailable };
  }

  return <ExportMenu intro={target.kind === "list" ? MINUTE_COPY.export.listIntro : MINUTE_COPY.export.singleIntro} onExport={onExport} />;
}

async function readError(response: Response): Promise<MinuteError> {
  try {
    const body = (await response.json()) as { error?: MinuteError };
    if (body.error && typeof body.error.code === "string") return body.error;
  } catch {
    // Not JSON: fall through.
  }
  if (response.status === 401) return { code: "unauthenticated" };
  if (response.status === 403) return { code: "forbidden" };
  return { code: "unavailable" };
}
