"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Download } from "lucide-react";
import { AlertMessage, type AlertIcon } from "@/components/ui/alert-message";
import { Spinner } from "@/components/ui/nx-button";
import { cn } from "@/lib/utils";
import {
  MEMBER_EXPORT_TOO_LARGE_TEXT,
  MEMBER_LIST_PARAMS,
  memberExportFormatSchema,
  type MemberExportError,
  type MemberExportFormat,
  type MemberListFilters,
} from "../types";
import { COPY, EXPORT_FORMAT_LABEL } from "./copy";

const EXPORT_URL = "/api/member-data/export";
/** A slow PI-CORE answer must not leave the button busy forever (weak campus Wi-Fi). */
const EXPORT_TIMEOUT_MS = 60_000;
const FORMATS: MemberExportFormat[] = ["xlsx", "csv", "pdf"];

type Notice = { kind: "error"; icon: AlertIcon; text: string } | { kind: "done"; fileName: string };

/**
 * "Ekspor" with a menu of Excel, CSV, PDF (spec F5, M5, MD-30). Shown only with member_data.export;
 * the server checks again and refuses anyone else.
 *
 * Mechanism: a real POST form inside a <details> menu. With JavaScript the form is sent with fetch,
 * so a refusal becomes a readable message on this page (never raw JSON), the button can show it is
 * busy, and a second press is ignored (every export writes a log row). The file is then saved through
 * a temporary blob link. Without JavaScript, or on a browser that cannot save a blob link, the same
 * form is sent the normal way and the browser downloads the attachment itself.
 */
export function MemberExport({ filters }: { filters: MemberListFilters }) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Close the menu on Escape or a press outside it, and put focus back on the button.
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

  function close() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!canSaveBlob()) return; // let the browser send the form and download the file itself
    event.preventDefault();
    if (busyRef.current) return;

    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const format = memberExportFormatSchema.safeParse(
      submitter instanceof HTMLButtonElement ? submitter.value : undefined,
    );
    if (!format.success) return;

    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    close();
    summaryRef.current?.focus();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
    try {
      const response = await fetch(EXPORT_URL, {
        method: "POST",
        body: exportBody(filters, format.data),
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) {
        const fileName = fileNameFrom(response, format.data);
        saveBlob(await response.blob(), fileName);
        setNotice({ kind: "done", fileName });
        return;
      }
      const code = await errorCode(response);
      if (code === "unauthenticated") {
        // Session ended: back to login with the notice, then return here (spec F6, auth-login F9).
        const next = `${window.location.pathname}${window.location.search}`;
        router.push(`/login?reason=session_ended&next=${encodeURIComponent(next)}`);
        return;
      }
      setNotice(errorNotice(code));
    } catch {
      // Network failure or timeout. The person decides whether to try again.
      setNotice({ kind: "error", icon: "wifi_off", text: COPY.network });
    } finally {
      clearTimeout(timeout);
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <form method="post" action={EXPORT_URL} onSubmit={onSubmit} className="relative">
        {/* The validated filters of the list on screen, never the raw address (R15). */}
        {filters.search ? <input type="hidden" name={MEMBER_LIST_PARAMS.search} value={filters.search} /> : null}
        {filters.unitId ? <input type="hidden" name={MEMBER_LIST_PARAMS.unitId} value={filters.unitId} /> : null}
        <input type="hidden" name={MEMBER_LIST_PARAMS.status} value={filters.status} />

        <details ref={detailsRef} onToggle={(event) => setOpen(event.currentTarget.open)} className="group">
          <summary
            ref={summaryRef}
            aria-disabled={busy || undefined}
            onClick={(event) => {
              if (busyRef.current) event.preventDefault();
            }}
            // text-label-lg stays outside cn(); see the note in components/ui/nx-button.tsx.
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
            <p className="px-3 pt-2 pb-1 text-body-sm text-ink-body">Unduh semua hasil filter sebagai:</p>
            <ul>
              {FORMATS.map((format) => (
                <li key={format}>
                  <button
                    type="submit"
                    name={MEMBER_LIST_PARAMS.format}
                    value={format}
                    disabled={busy}
                    className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-body-md font-semibold text-ink hover:bg-ivory disabled:text-ink-meta"
                  >
                    {EXPORT_FORMAT_LABEL[format]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </form>

      <div role="status" aria-live="polite" className="w-full empty:hidden">
        {notice?.kind === "done" ? (
          <p className="text-right text-body-sm text-ink-body">Unduhan dimulai: {notice.fileName}</p>
        ) : null}
      </div>
      {notice?.kind === "error" ? (
        <AlertMessage role="alert" tone="warning" icon={notice.icon} className="w-full">
          {notice.text}
        </AlertMessage>
      ) : null}
    </div>
  );
}

function exportBody(filters: MemberListFilters, format: MemberExportFormat): URLSearchParams {
  const body = new URLSearchParams();
  if (filters.search) body.set(MEMBER_LIST_PARAMS.search, filters.search);
  if (filters.unitId) body.set(MEMBER_LIST_PARAMS.unitId, filters.unitId);
  body.set(MEMBER_LIST_PARAMS.status, filters.status);
  body.set(MEMBER_LIST_PARAMS.format, format);
  return body;
}

/** The server's name ("data-anggota-2026-11-06.xlsx"), or a plain fallback. */
function fileNameFrom(response: Response, format: MemberExportFormat): string {
  const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
  return match?.[1] ?? `data-anggota.${format}`;
}

async function errorCode(response: Response): Promise<MemberExportError["code"]> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    const code = body.error?.code;
    if (
      code === "unauthenticated" ||
      code === "forbidden" ||
      code === "invalid_input" ||
      code === "unavailable" ||
      code === "export_too_large"
    ) {
      return code;
    }
  } catch {
    // Not our JSON (a proxy page, an HTML error): treat as a temporary fault.
  }
  return response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : "unavailable";
}

function errorNotice(code: Exclude<MemberExportError["code"], "unauthenticated">): Notice {
  switch (code) {
    case "export_too_large":
      // The answer reached the API row limit, so the file could be cut: narrow the filter (HTTP 422).
      return { kind: "error", icon: "warning", text: MEMBER_EXPORT_TOO_LARGE_TEXT };
    case "forbidden":
      return { kind: "error", icon: "warning", text: COPY.accessChanged };
    case "invalid_input":
      return { kind: "error", icon: "warning", text: COPY.exportInvalid };
    case "unavailable":
      return { kind: "error", icon: "warning", text: COPY.unavailable };
  }
}

/** Blob links with a download name work in current Safari (iOS 14.5+) and Chrome; older browsers fall back. */
function canSaveBlob(): boolean {
  return typeof URL.createObjectURL === "function" && "download" in HTMLAnchorElement.prototype;
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
