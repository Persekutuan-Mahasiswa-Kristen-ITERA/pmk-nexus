"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, FileText, Image as ImageIcon } from "lucide-react";
import { TextareaField } from "@/components/ui/form-fields";
import { Spinner } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import {
  FINANCE_COPY,
  FINANCE_ERROR_COPY_VARIANTS,
  FINANCE_HISTORY_DETAIL,
  FINANCE_LIMITS,
  financeErrorMessage,
  formatFinanceCopy,
  type FinanceProofFile,
} from "../types";
import { ActionSheet, defaultActionError, goToLogin, useFinanceAction } from "./action-sheet";
import { UI_COPY } from "./copy";
import { formatDateTime, formatFileSize } from "./format";
import { entryHref } from "./routes";
import { getFinanceProofLink, withdrawFinanceProof } from "./server-actions";

const D = FINANCE_COPY.detail;

/**
 * "Bukti" on the detail (spec 7 screen 2). Each row: type mark, name, size and "Lihat", which asks the
 * server for a signed link at the press and opens it in a new tab. Managers also see withdrawn proofs
 * with the chip "Ditarik" and the reason, and "Tarik berkas" on visible ones (screen 7).
 */
export function ProofList({ files, entryId, canWithdraw }: { files: FinanceProofFile[]; entryId: string; canWithdraw: boolean }) {
  const [target, setTarget] = useState<FinanceProofFile | null>(null);
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
                  {formatFinanceCopy(FINANCE_HISTORY_DETAIL.reason, { alasan: file.withdrawReason })}
                  {file.withdrawnAt ? (
                    <span className="block text-ink-meta">
                      {file.withdrawnByName ? `${file.withdrawnByName}, ` : ""}
                      <time dateTime={file.withdrawnAt}>{formatDateTime(file.withdrawnAt)}</time>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-1">
                <OpenProofButton file={file} entryId={entryId} />
                {canWithdraw && !file.isWithdrawn ? (
                  <button
                    type="button"
                    aria-label={`${FINANCE_COPY.withdraw.confirm} ${file.name}`}
                    onClick={() => {
                      setTarget(file);
                      setOpen(true);
                    }}
                    className="inline-flex min-h-11 items-center rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
                  >
                    {FINANCE_COPY.withdraw.confirm}
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {canWithdraw && target ? <WithdrawDialog key={target.fileId} open={open} onOpenChange={setOpen} file={target} entryId={entryId} /> : null}
    </>
  );
}

function FileMark({ file }: { file: FinanceProofFile }) {
  const Icon = file.mimeType === "application/pdf" ? FileText : ImageIcon;
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-gold-tint-line bg-gold-tint text-walnut"
    >
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  );
}

/**
 * "Lihat": the signed link is made now, at the press, so it never expires under an open page (spec 4.4). The
 * tab is opened by the press itself (a popup blocker lets that through) and pointed at the link when it
 * arrives. The storage path never reaches this component, only the short-lived URL.
 */
function OpenProofButton({ file, entryId }: { file: FinanceProofFile; entryId: string }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    // Opened synchronously inside the press, then pointed at the link.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const result = await getFinanceProofLink({ entryId, fileId: file.fileId });
      if (result.ok) {
        if (tab) tab.location.href = result.data.url;
        else window.location.assign(result.data.url);
        return;
      }
      tab?.close();
      if (result.error.code === "unauthenticated") {
        goToLogin(router);
        return;
      }
      setError(financeErrorMessage(result.error, "openFile") ?? FINANCE_COPY.list.error);
    } catch {
      tab?.close();
      setError(UI_COPY.network);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        aria-busy={busy || undefined}
        aria-label={`${D.proofView} ${file.name}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
      >
        {busy ? <Spinner /> : <Eye aria-hidden="true" className="size-4" strokeWidth={2} />}
        {D.proofView}
      </button>
      {error ? (
        <p role="alert" className="basis-full text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** "Tarik berkas" (spec 7 screen 7): reason required; the record and the stored file stay (L5). */
function WithdrawDialog({
  open,
  onOpenChange,
  file,
  entryId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: FinanceProofFile;
  entryId: string;
}) {
  const W = FINANCE_COPY.withdraw;
  const { router, busy, error, setError, run } = useFinanceAction();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    if (reason.trim() === "") {
      setReasonError(FINANCE_ERROR_COPY_VARIANTS.reasonRequired.withdrawProof);
      reasonRef.current?.focus();
      return;
    }
    void run(() => withdrawFinanceProof({ fileId: file.fileId, reason }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(entryHref(entryId, "proof_withdrawn"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "reason_required" || e.code === "text_too_long") {
          setReasonError(financeErrorMessage(e, "withdrawProof"));
          reasonRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "withdrawProof");
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
      <TextareaField
        ref={reasonRef}
        id="finance-withdraw-reason"
        label={W.reason}
        value={reason}
        maxLength={FINANCE_LIMITS.reason}
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
