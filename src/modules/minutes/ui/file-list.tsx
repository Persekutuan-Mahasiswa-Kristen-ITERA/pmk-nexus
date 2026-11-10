"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, FileText, Image as ImageIcon } from "lucide-react";
import { TextareaField } from "@/components/ui/form-fields";
import { Spinner } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { formatMinuteCopy, MINUTE_COPY, MINUTE_ERROR_COPY_VARIANTS, MINUTE_LIMITS, minuteErrorMessage, type MinuteFile } from "../types";
import { ActionSheet, defaultActionError, goToLogin, useMinuteAction } from "./action-sheet";
import { formatDateTime, formatFileSize } from "./format";
import { minuteHref } from "./routes";
import { getMinuteFileLink, withdrawMinuteFile } from "./server-actions";

const D = MINUTE_COPY.detail;

/**
 * "Lampiran" on the detail (spec 7 screen 2). Each row: type mark, name, size and "Lihat", which asks the
 * server for a signed link at the press and opens it in a new tab. Managers of the unit also see
 * withdrawn files with the chip "Ditarik" and the reason, and "Tarik berkas" on visible ones (screen 6).
 */
export function MinuteFileList({
  files,
  minuteId,
  withdraw,
}: {
  files: MinuteFile[];
  minuteId: string;
  /** detail.actions.canWithdrawFiles: the minute's version for the withdraw call. */
  withdraw: { version: number } | null;
}) {
  const [target, setTarget] = useState<MinuteFile | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <ul className="flex flex-col divide-y divide-row-line">
        {files.map((file) => (
          <li key={file.fileId} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <FileMark file={file} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className={cn("text-body-md font-semibold break-words text-ink", file.isWithdrawn && "text-ink-body")}>{file.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-ink-meta tabular-nums">
                {formatFileSize(file.sizeBytes)}
                {file.isWithdrawn ? <StatusChip tone="grey">{D.withdrawnChip}</StatusChip> : null}
              </p>
              {file.isWithdrawn && file.withdrawReason ? (
                <p className="text-body-sm break-words text-ink-body">
                  {formatMinuteCopy(D.historyReason, { alasan: file.withdrawReason })}
                  {file.withdrawnAt ? (
                    <span className="block text-ink-meta">
                      {file.withdrawnByName ? `${file.withdrawnByName}, ` : ""}
                      <time dateTime={file.withdrawnAt}>{formatDateTime(file.withdrawnAt)}</time>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-1">
                <OpenFileButton file={file} minuteId={minuteId} />
                {withdraw && !file.isWithdrawn ? (
                  <button
                    type="button"
                    aria-label={`${MINUTE_COPY.withdrawDialog.confirm} ${file.name}`}
                    onClick={() => {
                      setTarget(file);
                      setOpen(true);
                    }}
                    className="inline-flex min-h-11 items-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
                  >
                    {MINUTE_COPY.withdrawDialog.confirm}
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {withdraw && target ? (
        <WithdrawDialog key={target.fileId} open={open} onOpenChange={setOpen} file={target} minuteId={minuteId} version={withdraw.version} />
      ) : null}
    </>
  );
}

function FileMark({ file }: { file: MinuteFile }) {
  const pdf = file.mimeType === "application/pdf";
  const Icon = pdf ? FileText : ImageIcon;
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-gold-tint-line bg-gold-tint text-walnut"
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
      <span className="text-label-sm leading-none font-bold">{pdf ? "PDF" : file.mimeType === "image/png" ? "PNG" : "JPG"}</span>
    </span>
  );
}

/**
 * "Lihat": the signed link is made at the press (spec 4.4, 300 seconds), so it never expires under an
 * open page. A blank tab opens inside the tap (no pop-up blocker stops it) and is pointed at the link
 * when it arrives, or closed again with the error text.
 */
function OpenFileButton({ file, minuteId }: { file: MinuteFile; minuteId: string }) {
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
    try {
      const result = await getMinuteFileLink({ minuteId, fileId: file.fileId });
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
      setError(minuteErrorMessage(result.error, "openFile") ?? MINUTE_ERROR_COPY_VARIANTS.unavailable.openFile);
    } catch {
      tab?.close();
      setError(MINUTE_ERROR_COPY_VARIANTS.unavailable.openFile);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={() => void open()}
        aria-busy={busy || undefined}
        aria-label={`${D.viewFile} ${file.name}`}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
      >
        {busy ? <Spinner /> : <Eye aria-hidden="true" className="size-[18px]" strokeWidth={2} />}
        {D.viewFile}
      </button>
      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Tarik berkas?" (spec 7 screen 6): reason required; the record and the stored file stay. */
function WithdrawDialog({
  open,
  onOpenChange,
  file,
  minuteId,
  version,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: MinuteFile;
  minuteId: string;
  version: number;
}) {
  const W = MINUTE_COPY.withdrawDialog;
  const { router, busy, error, setError, run } = useMinuteAction();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    if (reason.trim() === "") {
      setReasonError(MINUTE_ERROR_COPY_VARIANTS.reasonRequired.withdrawFile);
      reasonRef.current?.focus();
      return;
    }
    void run(() => withdrawMinuteFile({ fileId: file.fileId, version, reason }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(minuteHref(minuteId, "file_withdrawn"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "reason_required" || e.code === "text_too_long") {
          setReasonError(minuteErrorMessage(e, "withdrawFile"));
          reasonRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "withdrawFile");
      },
    });
  }

  return (
    <ActionSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      title={W.title}
      description={W.body}
      primaryLabel={W.confirm}
      cancelLabel={W.back}
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={reasonRef}
    >
      <p className="flex items-center gap-2 rounded-lg border border-gold-tint-line bg-gold-tint px-3 py-2.5 text-body-md font-semibold break-words text-ink">
        <FileText aria-hidden="true" className="size-[18px] shrink-0 text-walnut" strokeWidth={1.75} />
        <span className="min-w-0">{file.name}</span>
      </p>
      <TextareaField
        ref={reasonRef}
        id="minute-withdraw-reason"
        label={W.reason}
        value={reason}
        maxLength={MINUTE_LIMITS.reason}
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
