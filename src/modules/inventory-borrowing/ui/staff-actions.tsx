"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { correctReturn, extendRequest } from "../server/borrowing-actions";
import { DateField, TextareaField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import {
  addDays,
  INVENTORY_ERROR_COPY,
  INVENTORY_LIMITS,
  maxRequestEndDate,
  type RequestDetail,
} from "../types";
import { ActionSheet, defaultActionError, useInventoryAction } from "./action-sheet";
import { extendAfterText, STAFF_COPY, tooLongText } from "./copy";
import { formatDate } from "./format";
import { handoverHref, requestHref, returnHref } from "./routes";

/**
 * The Operations and head buttons at the foot of Detail Pengajuan (design 11.4): Serahkan barang,
 * Terima pengembalian, Ubah tanggal kembali, Koreksi pengembalian. Each exists only when the
 * database's `actions` for this viewer allow it; absent otherwise, never greyed (K9).
 */
export function StaffActions({ detail }: { detail: RequestDetail }) {
  const { actions } = detail;
  const [extendOpen, setExtendOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);

  if (!actions.canHandOver && !actions.canReturn && !actions.canExtend && !actions.canCorrectReturn) return null;

  return (
    <div className="flex flex-col gap-2">
      {actions.canHandOver ? (
        <Link href={handoverHref(detail.reference)} className={buttonClass("primary")}>
          Serahkan barang
        </Link>
      ) : null}
      {actions.canReturn ? (
        <Link href={returnHref(detail.reference)} className={buttonClass("primary")}>
          Terima pengembalian
        </Link>
      ) : null}
      {actions.canExtend ? (
        <button type="button" onClick={() => setExtendOpen(true)} className={buttonClass("outline")}>
          Ubah tanggal kembali
        </button>
      ) : null}
      {actions.canCorrectReturn ? (
        <button type="button" onClick={() => setCorrectOpen(true)} className={buttonClass("outline")}>
          Koreksi pengembalian
        </button>
      ) : null}

      {actions.canExtend ? <ExtendDialog open={extendOpen} onOpenChange={setExtendOpen} detail={detail} /> : null}
      {actions.canCorrectReturn ? <CorrectDialog open={correctOpen} onOpenChange={setCorrectOpen} detail={detail} /> : null}
    </div>
  );
}

/** "Ubah tanggal kembali" (design 11.3): later only, at most the ORIGINAL start + 365 days (R30). */
function ExtendDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (open: boolean) => void; detail: RequestDetail }) {
  const { router, busy, error, run } = useInventoryAction();
  const dateRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const min = addDays(detail.endDate, 1);
  const max = maxRequestEndDate(detail.startDate);
  const afterText = extendAfterText(formatDate(detail.endDate));

  function submit() {
    let ok = true;
    if (date === "" || date <= detail.endDate) {
      setDateError(afterText);
      ok = false;
    } else if (date > max) {
      setDateError(INVENTORY_ERROR_COPY.date_range_too_long);
      ok = false;
    }
    if (note.trim() === "") {
      setNoteError(STAFF_COPY.extendNoteMissing);
      ok = false;
    }
    if (!ok) {
      if (date === "" || date <= detail.endDate || date > max) dateRef.current?.focus();
      else noteRef.current?.focus();
      return;
    }
    void run(() => extendRequest({ requestId: detail.requestId, version: detail.version, newEndDate: date, note }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(requestHref(detail.reference, "extended"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "invalid_dates") {
          setDateError(afterText);
          dateRef.current?.focus();
          return null;
        }
        if (e.code === "date_range_too_long") {
          setDateError(INVENTORY_ERROR_COPY.date_range_too_long);
          dateRef.current?.focus();
          return null;
        }
        if (e.code === "note_required" || e.code === "text_required") {
          setNoteError(STAFF_COPY.extendNoteMissing);
          noteRef.current?.focus();
          return null;
        }
        if (e.code === "text_too_long") {
          setNoteError(tooLongText("Catatan", INVENTORY_LIMITS.note));
          noteRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "extend", formatDate);
      },
    });
  }

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Ubah tanggal kembali"
      description={`Tanggal kembali sekarang: ${formatDate(detail.endDate)}`}
      primaryLabel="Simpan tanggal baru"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={dateRef}
    >
      <DateField
        ref={dateRef}
        id="extend-date"
        label="Tanggal kembali baru (wajib)"
        min={min}
        max={max}
        value={date}
        readOnly={busy}
        error={dateError ?? undefined}
        onChange={(event) => {
          setDate(event.target.value);
          setDateError(null);
        }}
      />
      <TextareaField
        ref={noteRef}
        id="extend-note"
        label="Catatan (wajib)"
        value={note}
        maxLength={INVENTORY_LIMITS.note}
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

/** "Koreksi pengembalian" (design 11.4, A-IB15): once per request, back to Dipinjam, with a reason. */
function CorrectDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (open: boolean) => void; detail: RequestDetail }) {
  const { router, busy, error, run } = useInventoryAction();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    if (reason.trim() === "") {
      setReasonError(STAFF_COPY.correctMissing);
      reasonRef.current?.focus();
      return;
    }
    void run(() => correctReturn({ requestId: detail.requestId, version: detail.version, reason }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(requestHref(detail.reference, "corrected"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "reason_required" || e.code === "text_required") {
          setReasonError(STAFF_COPY.correctMissing);
          reasonRef.current?.focus();
          return null;
        }
        if (e.code === "text_too_long") {
          setReasonError(tooLongText("Alasan", INVENTORY_LIMITS.note));
          reasonRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "correctReturn");
      },
    });
  }

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={STAFF_COPY.correctTitle}
      description={STAFF_COPY.correctBody}
      primaryLabel="Koreksi pengembalian"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={reasonRef}
    >
      <TextareaField
        ref={reasonRef}
        id="correct-reason"
        label="Alasan (wajib)"
        value={reason}
        maxLength={INVENTORY_LIMITS.note}
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
