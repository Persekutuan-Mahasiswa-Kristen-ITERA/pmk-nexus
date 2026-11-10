"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { TextareaField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import {
  FINANCE_COPY,
  FINANCE_ERROR_COPY_VARIANTS,
  FINANCE_LIMITS,
  financeErrorMessage,
  formatFinanceCopy,
} from "../types";
import { ActionSheet, defaultActionError, useFinanceAction } from "./action-sheet";
import { UI_COPY } from "./copy";
import { EMPTY_PROOFS, ProofPicker, type ProofSummary } from "./proof-picker";
import { entryHref } from "./routes";
import { addFinanceProof, voidFinanceEntry } from "./server-actions";

/** "Tambah bukti" (F6): managers, an Aktif entry of the active period, room left. */
export function AddProofButton({ entryId, room }: { entryId: string; room: number }) {
  const [open, setOpen] = useState(false);
  // A fresh picker each time the sheet opens (files chosen and closed without saving are not records).
  const [round, setRound] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRound((n) => n + 1);
          setOpen(true);
        }}
        className={buttonClass("outline", "nx-press mt-3")}
      >
        <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
        {FINANCE_COPY.detail.addProof}
      </button>
      <AddProofSheet key={round} open={open} onOpenChange={setOpen} entryId={entryId} room={room} />
    </>
  );
}

function AddProofSheet({
  open,
  onOpenChange,
  entryId,
  room,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryId: string;
  room: number;
}) {
  const { router, busy, error, setError, run } = useFinanceAction();
  const [files, setFiles] = useState<ProofSummary>(EMPTY_PROOFS);
  const [filesError, setFilesError] = useState<string | null>(null);
  const requiredText = financeErrorMessage({ code: "file_required", field: "files", count: 1 }, "addProof") ?? FINANCE_COPY.list.error;

  function submit() {
    setFilesError(null);
    if (files.pending) {
      setError({ text: UI_COPY.fileStillBusy });
      return;
    }
    if (files.failed) {
      setError({ text: financeErrorMessage({ code: "unavailable" }, "upload") ?? FINANCE_COPY.list.error });
      return;
    }
    if (files.files.length === 0) {
      setFilesError(requiredText);
      document.getElementById("finance-add-proof")?.focus();
      return;
    }
    void run(() => addFinanceProof({ entryId, files: files.files }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(entryHref(entryId, "proof_added"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "file_required") {
          setFilesError(requiredText);
          return null;
        }
        return defaultActionError(e, "addProof");
      },
    });
  }

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={FINANCE_COPY.detail.addProof}
      description={formatFinanceCopy(FINANCE_COPY.detail.proofRoom, { n: room })}
      primaryLabel={FINANCE_COPY.detail.addProof}
      cancelLabel={FINANCE_COPY.form.cancel}
      busy={busy}
      error={error}
      onSubmit={submit}
    >
      <ProofPicker
        id="finance-add-proof"
        max={room}
        disabled={busy}
        onChange={(summary) => {
          setFiles(summary);
          if (summary.files.length > 0) setFilesError(null);
        }}
        error={filesError}
      />
    </ActionSheet>
  );
}

/** "Batalkan transaksi" (spec 7 screen 6): reason required; the entry stays as Dibatalkan, never restored. */
export function VoidEntryButton({ entryId, numberText }: { entryId: string; numberText: string }) {
  const V = FINANCE_COPY.void;
  const [open, setOpen] = useState(false);
  const { router, busy, error, setError, run } = useFinanceAction();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    if (reason.trim() === "") {
      setReasonError(FINANCE_ERROR_COPY_VARIANTS.reasonRequired.void);
      reasonRef.current?.focus();
      return;
    }
    void run(() => voidFinanceEntry({ entryId, reason }), {
      onOk: () => {
        setOpen(false);
        router.replace(entryHref(entryId, "voided"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "reason_required" || e.code === "text_too_long") {
          setReasonError(financeErrorMessage(e, "void"));
          reasonRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "void");
      },
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("outline", "nx-press")}>
        {FINANCE_COPY.detail.void}
      </button>
      <ActionSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={V.title}
        description={formatFinanceCopy(V.body, { nomor: numberText })}
        primaryLabel={V.confirm}
        cancelLabel={V.back}
        busy={busy}
        error={error}
        onSubmit={submit}
        initialFocusRef={reasonRef}
      >
        <TextareaField
          ref={reasonRef}
          id="finance-void-reason"
          label={V.reason}
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
    </>
  );
}
