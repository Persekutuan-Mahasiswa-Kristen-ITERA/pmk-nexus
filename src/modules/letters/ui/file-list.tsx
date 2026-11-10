"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, FileText, Image as ImageIcon } from "lucide-react";
import { TextareaField } from "@/components/ui/form-fields";
import { Spinner } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import {
  LETTER_CHIP_LABEL,
  LETTER_LIMITS,
  letterErrorMessage,
  type LetterFile,
  type LetterFileLinkInput,
} from "../types";
import { ActionSheet, defaultActionError, goToLogin, useLetterAction } from "./action-sheet";
import { COPY } from "./copy";
import { formatDateTime, formatFileSize } from "./format";
import { letterHref } from "./routes";
import { getLetterFileLink, withdrawLetterFile } from "./server-actions";

export type FileParent = { parent: "letter"; letterId: string } | { parent: "request"; requestId: string };

/**
 * Files of a letter or a request (design 6.1 Berkas, 10.2 Berkas surat and Lampiran). Each row: type
 * mark, name (breaks at words), size, and one button that asks the server for a signed link at the
 * press and opens it in a new tab ("Lihat", or "Unduh" for the issued letter). Managers also see
 * withdrawn files with the chip "Ditarik" and the reason, and "Tarik berkas" on visible ones.
 */
export function FileList({
  files,
  parent,
  openLabel = "Lihat",
  withdraw,
}: {
  files: LetterFile[];
  parent: FileParent;
  openLabel?: "Lihat" | "Unduh";
  /** Managers on an Aktif letter of the active period (detail.actions.canWithdrawFiles). */
  withdraw?: { letterId: string; version: number; lastIssuedFile: boolean } | null;
}) {
  const [target, setTarget] = useState<LetterFile | null>(null);
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <ul className="flex flex-col divide-y divide-row-line">
        {files.map((file) => (
          <li key={file.fileId} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <FileMark file={file} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className={cn("text-body-md font-semibold break-words text-ink", file.isWithdrawn && "text-ink-body")}>
                {file.name}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-ink-meta tabular-nums">
                {formatFileSize(file.sizeBytes) ?? null}
                {file.isWithdrawn ? <StatusChip tone="grey">{LETTER_CHIP_LABEL.withdrawn}</StatusChip> : null}
              </p>
              {file.isWithdrawn && file.withdrawReason ? (
                <p className="text-body-sm break-words text-ink-body">
                  Alasan: {file.withdrawReason}
                  {file.withdrawnAt ? (
                    <span className="block text-ink-meta">
                      {file.withdrawnByName ? `${file.withdrawnByName}, ` : ""}
                      <time dateTime={file.withdrawnAt}>{formatDateTime(file.withdrawnAt)}</time>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-1">
                <OpenFileButton file={file} parent={parent} label={openLabel} />
                {withdraw && !file.isWithdrawn ? (
                  <button
                    type="button"
                    aria-label={`Tarik berkas ${file.name}`}
                    onClick={(event) => {
                      returnFocus.current = event.currentTarget;
                      setTarget(file);
                      setOpen(true);
                    }}
                    className="inline-flex min-h-11 items-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
                  >
                    Tarik berkas
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {withdraw && target ? (
        <WithdrawDialog
          open={open}
          onOpenChange={setOpen}
          file={target}
          letterId={withdraw.letterId}
          version={withdraw.version}
          blocked={withdraw.lastIssuedFile}
        />
      ) : null}
    </>
  );
}

function FileMark({ file }: { file: LetterFile }) {
  const Icon = file.mimeType === "application/pdf" ? FileText : ImageIcon;
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex size-11 shrink-0 flex-col items-center justify-center rounded-lg border border-gold-tint-line bg-gold-tint text-walnut"
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
      <span className="text-label-sm leading-none font-bold">{file.mimeType === "application/pdf" ? "PDF" : "FOTO"}</span>
    </span>
  );
}

/**
 * "Lihat" / "Unduh": the signed link is made at the press (A-LT13, design 3.3), so it never expires
 * under an open page. A blank tab opens inside the tap (so no pop-up blocker stops it) and is pointed at
 * the link when it arrives, or closed again with the error text.
 */
function OpenFileButton({ file, parent, label }: { file: LetterFile; parent: FileParent; label: "Lihat" | "Unduh" }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const tab = window.open("", "_blank");
    const input: LetterFileLinkInput =
      parent.parent === "letter"
        ? { parent: "letter", letterId: parent.letterId, fileId: file.fileId }
        : { parent: "request", requestId: parent.requestId, fileId: file.fileId };
    try {
      const result = await getLetterFileLink(input);
      if (result.ok) {
        if (tab) {
          tab.opener = null;
          tab.location.href = result.data.url;
        } else {
          window.location.assign(result.data.url);
        }
        return;
      }
      tab?.close();
      if (result.error.code === "unauthenticated") {
        goToLogin(router);
        return;
      }
      setError(letterErrorMessage(result.error, "openFile") ?? COPY.fileOpenFailed);
    } catch {
      tab?.close();
      setError(COPY.fileOpenFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const Icon = label === "Unduh" ? Download : Eye;
  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={() => void open()}
        aria-busy={busy || undefined}
        aria-label={`${label} ${file.name}`}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
      >
        {busy ? <Spinner /> : <Icon aria-hidden="true" className="size-[18px]" strokeWidth={2} />}
        {label}
      </button>
      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Tarik berkas" (design 8.2, G4): reason required; blocked for the last file a requester sees. */
function WithdrawDialog({
  open,
  onOpenChange,
  file,
  letterId,
  version,
  blocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: LetterFile;
  letterId: string;
  version: number;
  blocked: boolean;
}) {
  const { router, busy, error, setError, run } = useLetterAction();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    if (reason.trim() === "") {
      setReasonError(COPY.withdrawMissing);
      reasonRef.current?.focus();
      return;
    }
    void run(() => withdrawLetterFile({ fileId: file.fileId, version, reason }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(letterHref(letterId, "file_withdrawn"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "reason_required") {
          setReasonError(COPY.withdrawMissing);
          reasonRef.current?.focus();
          return null;
        }
        if (e.code === "text_too_long") {
          setReasonError(letterErrorMessage(e, "withdrawFile"));
          reasonRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "withdrawFile");
      },
    });
  }

  if (blocked) {
    return (
      <ActionSheet
        open={open}
        onOpenChange={onOpenChange}
        title={COPY.withdrawTitle}
        primaryLabel=""
        hidePrimary
        cancelLabel="Mengerti"
        busy={false}
        error={{ text: COPY.withdrawBlocked }}
        onSubmit={() => undefined}
      />
    );
  }

  return (
    <ActionSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      title={COPY.withdrawTitle}
      description={`${file.name} disembunyikan dari semua orang kecuali pengelola surat. Berkasnya tidak dihapus dan tetap ada di riwayat.`}
      primaryLabel="Tarik berkas"
      cancelLabel="Kembali"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={reasonRef}
    >
      <TextareaField
        ref={reasonRef}
        id="withdraw-reason"
        label="Alasan (wajib)"
        value={reason}
        maxLength={LETTER_LIMITS.reason}
        readOnly={busy}
        error={reasonError ?? undefined}
        onChange={(event) => {
          setReason(event.target.value);
          setReasonError(null);
        }}
      />
    </ActionSheet>
  );
}
