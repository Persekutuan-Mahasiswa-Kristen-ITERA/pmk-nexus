"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TextareaField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import { LETTER_LIMITS, letterErrorMessage, type LetterRequestDetail } from "../types";
import { ActionSheet, defaultActionError, useLetterAction } from "./action-sheet";
import { COPY } from "./copy";
import { issueHref, requestHref } from "./routes";
import { cancelRequest, processRequest, rejectRequest, takeRequestNumber } from "./server-actions";

/** "Batalkan permohonan" (design 10.4): the requester, only while Diajukan; reason optional. */
export function CancelRequestButton({ requestId, version }: { requestId: string; version: number }) {
  const [open, setOpen] = useState(false);
  const { router, busy, error, setError, run } = useLetterAction();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    void run(() => cancelRequest({ requestId, version, reason }), {
      onOk: () => {
        setOpen(false);
        router.replace(requestHref(requestId, "cancelled"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "text_too_long") {
          setReasonError(letterErrorMessage(e, "cancelRequest"));
          reasonRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "cancelRequest");
      },
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("outline")}>
        Batalkan permohonan
      </button>
      <ActionSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={COPY.cancelTitle}
        description={COPY.cancelText}
        primaryLabel="Batalkan permohonan"
        cancelLabel="Kembali"
        busy={busy}
        error={error}
        onSubmit={submit}
      >
        <TextareaField
          ref={reasonRef}
          id="cancel-reason"
          label="Alasan (boleh kosong)"
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
    </>
  );
}

/**
 * "Tindakan" (design 12.1, P8): always one primary button, the next step, then "Tolak permohonan" as
 * outline. Diajukan: "Proses permohonan"; Diproses without a number: "Ambil nomor"; with a number:
 * "Terbitkan surat" (its own page). Rendered only when the database says this viewer may act; never on
 * the viewer's own request (L6).
 */
export function ReviewPanel({ detail }: { detail: LetterRequestDetail }) {
  const { actions } = detail;
  const [dialog, setDialog] = useState<"process" | "take" | "reject" | null>(null);
  const close = (open: boolean) => !open && setDialog(null);

  return (
    <section aria-labelledby="request-actions-title" className="rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 md:p-5">
      <h2 id="request-actions-title" className="text-headline-sm text-ink">
        {COPY.actionsTitle}
      </h2>
      <div className="mt-3 flex flex-col gap-2">
        {actions.canProcess ? (
          <button type="button" onClick={() => setDialog("process")} className={buttonClass("primary", "nx-press")}>
            Proses permohonan
          </button>
        ) : actions.canTakeNumber ? (
          <button type="button" onClick={() => setDialog("take")} className={buttonClass("primary", "nx-press")}>
            Ambil nomor
          </button>
        ) : actions.canIssue ? (
          <Link href={issueHref(detail.requestId)} className={buttonClass("primary", "nx-press")}>
            Terbitkan surat
          </Link>
        ) : null}
        {actions.canReject ? (
          <button type="button" onClick={() => setDialog("reject")} className={buttonClass("outline")}>
            Tolak permohonan
          </button>
        ) : null}
      </div>
      <ProcessDialog open={dialog === "process"} onOpenChange={close} detail={detail} />
      <TakeNumberDialog open={dialog === "take"} onOpenChange={close} detail={detail} />
      <RejectDialog open={dialog === "reject"} onOpenChange={close} detail={detail} />
    </section>
  );
}

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; detail: LetterRequestDetail };

function ProcessDialog({ open, onOpenChange, detail }: DialogProps) {
  const { router, busy, error, setError, run } = useLetterAction();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  function submit() {
    void run(() => processRequest({ requestId: detail.requestId, version: detail.version, note }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(requestHref(detail.requestId, "processed"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "text_too_long") {
          setNoteError(letterErrorMessage(e, "processRequest"));
          noteRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "processRequest");
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
      title={COPY.processTitle}
      description={COPY.processText}
      primaryLabel="Proses permohonan"
      busy={busy}
      error={error}
      onSubmit={submit}
    >
      <TextareaField
        ref={noteRef}
        id="process-note"
        label="Catatan untuk pemohon (boleh kosong)"
        value={note}
        maxLength={LETTER_LIMITS.note}
        readOnly={busy}
        error={noteError ?? undefined}
        onChange={(event) => {
          setNote(event.target.value);
          setNoteError(null);
        }}
      />
    </ActionSheet>
  );
}

/**
 * "Ambil nomor" (design 12.2, G1): one calm sentence before the press, because a taken number is final.
 * No preview: the number does not exist until the button is pressed. One press, one number.
 */
function TakeNumberDialog({ open, onOpenChange, detail }: DialogProps) {
  const { router, busy, error, setError, run } = useLetterAction();

  function submit() {
    void run(() => takeRequestNumber({ requestId: detail.requestId, version: detail.version }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(requestHref(detail.requestId, "number_taken"), { scroll: true });
        router.refresh();
      },
      onError: (e) => defaultActionError(e, "takeNumber"),
    });
  }

  return (
    <ActionSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      title={COPY.takeTitle}
      description={COPY.takeText}
      primaryLabel="Ambil nomor"
      busyLabel="Mengambil nomor..."
      busy={busy}
      error={error}
      onSubmit={submit}
    />
  );
}

function RejectDialog({ open, onOpenChange, detail }: DialogProps) {
  const { router, busy, error, setError, run } = useLetterAction();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  function submit() {
    if (note.trim() === "") {
      setNoteError(COPY.rejectMissing);
      noteRef.current?.focus();
      return;
    }
    void run(() => rejectRequest({ requestId: detail.requestId, version: detail.version, note }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(requestHref(detail.requestId, "rejected"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "note_required" || e.code === "text_required") {
          setNoteError(COPY.rejectMissing);
          noteRef.current?.focus();
          return null;
        }
        if (e.code === "text_too_long") {
          setNoteError(letterErrorMessage(e, "reject"));
          noteRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "reject");
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
      title={COPY.rejectTitle}
      description={
        detail.numberText ? (
          <>
            Nomor <strong className="font-bold text-ink tabular-nums">{detail.numberText}</strong> sudah diambil. Nomornya tetap terpakai,
            dan suratnya di register menjadi Dibatalkan dengan alasan di bawah.
          </>
        ) : undefined
      }
      primaryLabel="Tolak permohonan"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={noteRef}
    >
      <TextareaField
        ref={noteRef}
        id="reject-note"
        label="Alasan penolakan (wajib)"
        hint={COPY.rejectHint}
        value={note}
        maxLength={LETTER_LIMITS.note}
        readOnly={busy}
        error={noteError ?? undefined}
        onChange={(event) => {
          setNote(event.target.value);
          setNoteError(null);
        }}
      />
    </ActionSheet>
  );
}

/** After "Ambil nomor" focus moves to the plate, so the number is read first (design 12.9). */
export function FocusOnMount({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.focus();
  }, [targetId]);
  return null;
}
