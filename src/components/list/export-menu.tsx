"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { AlertMessage, type AlertIcon } from "@/components/ui/alert-message";
import { Spinner } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";

export type ExportFormat = "xlsx" | "csv" | "pdf";

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV (.csv)",
  pdf: "PDF (.pdf)",
};

/** What one export press ended in. `none` = nothing to show (for example the page is redirecting). */
export type ExportOutcome =
  | { kind: "done"; fileName: string }
  | { kind: "error"; text: string; icon?: AlertIcon }
  | { kind: "none" };

/** A slow answer must not leave the button busy forever (weak campus Wi-Fi). */
const EXPORT_TIMEOUT_MS = 60_000;

export type DownloadResult =
  | { kind: "saved"; fileName: string }
  | { kind: "refused"; response: Response }
  | { kind: "network" };

/**
 * POSTs a JSON body to an export route and saves the returned file through a temporary blob link.
 * A non-2xx answer is handed back for the caller to word; a network failure or timeout is `network`.
 */
export async function downloadExport(endpoint: string, body: unknown, fallbackName: string): Promise<DownloadResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "refused", response };
    const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
    const fileName = match?.[1] ?? fallbackName;
    saveBlob(await response.blob(), fileName);
    return { kind: "saved", fileName };
  } catch {
    return { kind: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari reads the blob after click() returns; revoke later, not at once.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * "Ekspor" button with a menu of formats (docs/design/inventory-borrowing.md 15, same look as Data
 * Anggota). A <details> menu: Enter or Space opens it, Tab moves through the formats, Escape or a
 * press outside closes it. While busy a second press is ignored (every export writes a log row).
 * The caller does the request and words the result (`onExport`), so each module keeps its own copy.
 */
export function ExportMenu({
  intro = "Unduh semua hasil filter sebagai:",
  formats = ["xlsx", "csv", "pdf"],
  note,
  onExport,
}: {
  intro?: string;
  formats?: ExportFormat[];
  /** Plain line under the formats (Letters 14.1: "Surat yang dibatalkan ikut diunduh ..."). */
  note?: string;
  onExport: (format: ExportFormat) => Promise<ExportOutcome>;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ExportOutcome>({ kind: "none" });

  useEffect(() => {
    if (!open) return;
    const details = detailsRef.current;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && details) {
        details.open = false;
        summaryRef.current?.focus();
      }
    }
    function onPointer(event: PointerEvent) {
      if (details && !details.contains(event.target as Node)) details.open = false;
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  async function choose(format: ExportFormat) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setOutcome({ kind: "none" });
    if (detailsRef.current) detailsRef.current.open = false;
    summaryRef.current?.focus();
    try {
      setOutcome(await onExport(format));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <details ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)} className="group relative">
        <summary
          ref={summaryRef}
          aria-disabled={busy || undefined}
          onClick={(event) => {
            if (busyRef.current) event.preventDefault();
          }}
          className={`${cn(
            "inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-lg border-[1.5px] border-walnut bg-surface px-4 text-walnut select-none hover:bg-ivory",
            "[&::-webkit-details-marker]:hidden",
            busy && "cursor-progress",
          )} text-label-lg`}
        >
          {busy ? (
            <>
              <Spinner />
              Menyiapkan file...
            </>
          ) : (
            <>
              <Download aria-hidden="true" className="size-[18px]" strokeWidth={2} />
              Ekspor
              <ChevronDown
                aria-hidden="true"
                className="size-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                strokeWidth={2}
              />
            </>
          )}
        </summary>
        <div className="absolute top-full right-0 z-20 mt-1 w-60 rounded-xl border border-hairline bg-surface p-1 shadow-elevation-2">
          <p className="px-3 pt-2 pb-1 text-body-sm text-ink-body">{intro}</p>
          <ul>
            {formats.map((format) => (
              <li key={format}>
                <button
                  type="button"
                  onClick={() => void choose(format)}
                  className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-body-md font-semibold text-ink hover:bg-ivory"
                >
                  {EXPORT_FORMAT_LABEL[format]}
                </button>
              </li>
            ))}
          </ul>
          {note ? <p className="px-3 pt-1 pb-2 text-body-sm text-ink-body">{note}</p> : null}
        </div>
      </details>

      <div role="status" aria-live="polite" className="w-full empty:hidden">
        {outcome.kind === "done" ? (
          <p className="text-right text-body-sm text-ink-body">Unduhan dimulai: {outcome.fileName}</p>
        ) : null}
      </div>
      {outcome.kind === "error" ? (
        <AlertMessage role="alert" tone="warning" icon={outcome.icon} className="w-full">
          {outcome.text}
        </AlertMessage>
      ) : null}
    </div>
  );
}
