"use client";

import { useRef, useState } from "react";
import { approveRequest, rejectRequest } from "../server/borrowing-actions";
import { AlertMessage } from "@/components/ui/alert-message";
import { TextareaField } from "@/components/ui/form-fields";
import { buttonClass } from "@/components/ui/nx-button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { INVENTORY_LIMITS, type RequestDetail, type RequestLine } from "../types";
import { ActionSheet, defaultActionError, useInventoryAction } from "./action-sheet";
import { STAFF_COPY, tooLongText } from "./copy";
import { formatCount, formatDate, formatRange } from "./format";
import { requestHref } from "./routes";

/** Highest quantity a head may approve on a line: the requested one, never above "Tersedia sekarang". */
function lineMax(line: RequestLine): number {
  return line.available ? Math.max(0, Math.min(line.quantityRequested, line.available.free)) : line.quantityRequested;
}

/**
 * The head's review (design 11.2, 11.3): per line "Tersedia sekarang", the approved quantity (default
 * the requested one, can be lower), then "Setujui" and "Tolak", each with its dialog. Rendered only
 * when the database says this viewer may decide (actions.canApprove); never on an own request (L6).
 */
export function ReviewPanel({ detail }: { detail: RequestDetail }) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(detail.lines.map((line) => [line.lineId, lineMax(line)])),
  );
  const [nothing, setNothing] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  // After a refresh (stock changed), a quantity may now be above what is free: keep it inside.
  const shown = Object.fromEntries(
    detail.lines.map((line) => [line.lineId, Math.min(quantities[line.lineId] ?? lineMax(line), lineMax(line))]),
  );
  const total = Object.values(shown).reduce((sum, n) => sum + n, 0);
  const lowered = detail.lines.some((line) => shown[line.lineId] < line.quantityRequested);

  return (
    <>
      <section aria-labelledby="review-title" className="rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
        <h2 id="review-title" className="text-headline-sm text-ink">
          Barang dan ketersediaan
        </h2>
        <ul className="mt-3 flex flex-col divide-y divide-row-line">
          {detail.lines.map((line) => {
            const short = line.available !== null && line.available.free < line.quantityRequested;
            return (
              <li key={line.lineId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <p className="text-body-md font-semibold break-words text-ink">{line.itemName}</p>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm tabular-nums">
                  <span className="text-ink-body">Diminta {formatCount(line.quantityRequested)}</span>
                  {line.available ? (
                    <span className={short ? "font-semibold text-danger" : "text-ink-body"}>
                      Tersedia sekarang {formatCount(line.available.free)} dari {formatCount(line.available.lendable)}
                    </span>
                  ) : null}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <label htmlFor={`approve-${line.lineId}`} className="text-label-lg text-ink-label">
                    Disetujui
                  </label>
                  <QuantityStepper
                    id={`approve-${line.lineId}`}
                    value={shown[line.lineId]}
                    min={0}
                    max={lineMax(line)}
                    label={`jumlah disetujui ${line.itemName}`}
                    onChange={(value) => {
                      setQuantities((prev) => ({ ...prev, [line.lineId]: value }));
                      setNothing(false);
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-col gap-2">
        {nothing ? (
          <AlertMessage role="alert" tone="warning">
            {STAFF_COPY.approveNothing}
          </AlertMessage>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (total === 0) {
              setNothing(true);
              return;
            }
            setApproveOpen(true);
          }}
          className={buttonClass("primary")}
        >
          Setujui
        </button>
        <button type="button" onClick={() => setRejectOpen(true)} className={buttonClass("outline")}>
          Tolak
        </button>
      </div>

      <ApproveDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        detail={detail}
        quantities={shown}
        total={total}
        noteRequired={lowered}
      />
      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} detail={detail} />
    </>
  );
}

function ApproveDialog({
  open,
  onOpenChange,
  detail,
  quantities,
  total,
  noteRequired,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: RequestDetail;
  quantities: Record<string, number>;
  total: number;
  noteRequired: boolean;
}) {
  const { router, busy, error, run } = useInventoryAction();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  function submit() {
    if (noteRequired && note.trim() === "") {
      setNoteError(STAFF_COPY.approveNoteLowered);
      noteRef.current?.focus();
      return;
    }
    void run(
      () =>
        approveRequest({
          requestId: detail.requestId,
          version: detail.version,
          note,
          lines: detail.lines.map((line) => ({ lineId: line.lineId, quantity: quantities[line.lineId] ?? 0 })),
        }),
      {
        onOk: () => {
          onOpenChange(false);
          router.replace(requestHref(detail.reference, "approved"), { scroll: true });
          router.refresh();
        },
        onError: (e) => {
          if (e.code === "note_required" || e.code === "text_required") {
            setNoteError(STAFF_COPY.approveNoteLowered);
            noteRef.current?.focus();
            return null;
          }
          if (e.code === "text_too_long") {
            setNoteError(tooLongText("Catatan", INVENTORY_LIMITS.note));
            noteRef.current?.focus();
            return null;
          }
          if (e.code === "quantity_invalid") return { text: STAFF_COPY.approveNothing };
          // Stock ran out meanwhile: the lines refresh to the new numbers behind the dialog (11.3).
          if (e.code === "insufficient_stock") router.refresh();
          return defaultActionError(e, "approve", formatDate);
        },
      },
    );
  }

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Setujui pengajuan"
      description={`${formatCount(total)} barang, ${formatRange(detail.startDate, detail.endDate)}`}
      primaryLabel="Setujui pengajuan"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={noteRef}
    >
      <TextareaField
        ref={noteRef}
        id="approve-note"
        label={noteRequired ? "Catatan (wajib)" : "Catatan (boleh kosong)"}
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

function RejectDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (open: boolean) => void; detail: RequestDetail }) {
  const { router, busy, error, run } = useInventoryAction();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  function submit() {
    if (note.trim() === "") {
      setNoteError(STAFF_COPY.rejectMissing);
      noteRef.current?.focus();
      return;
    }
    void run(() => rejectRequest({ requestId: detail.requestId, version: detail.version, note }), {
      onOk: () => {
        onOpenChange(false);
        router.replace(requestHref(detail.reference, "rejected"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "note_required" || e.code === "text_required") {
          setNoteError(STAFF_COPY.rejectMissing);
          noteRef.current?.focus();
          return null;
        }
        if (e.code === "text_too_long") {
          setNoteError(tooLongText("Alasan", INVENTORY_LIMITS.note));
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
      onOpenChange={onOpenChange}
      title="Tolak pengajuan"
      primaryLabel="Tolak pengajuan"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={noteRef}
    >
      <TextareaField
        ref={noteRef}
        id="reject-note"
        label="Alasan penolakan (wajib)"
        hint={STAFF_COPY.rejectHint}
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
