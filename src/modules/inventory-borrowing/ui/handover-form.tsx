"use client";

import { useRef, useState, type FormEvent } from "react";
import { Plus, Search, TriangleAlert } from "lucide-react";
import { handOverRequest } from "../server/borrowing-actions";
import { AlertMessage } from "@/components/ui/alert-message";
import { FieldError } from "@/components/ui/field-error";
import { fieldBoxClass } from "@/components/ui/field-styles";
import { TextareaField } from "@/components/ui/form-fields";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { cn } from "@/lib/utils";
import {
  INVENTORY_ERROR_COPY,
  INVENTORY_LIMITS,
  inventoryErrorMessage,
  type HandoverUnit,
  type InventoryError,
  type RequestDetail,
  type RequestHandOverInput,
  type RequestLine,
} from "../types";
import { defaultActionError, useInventoryAction, type ActionError } from "./action-sheet";
import { CancelRequest } from "./cancel-request";
import { COPY, atMostText, atMostUnitsText, fewUnitsText, handoverShortText, STAFF_COPY, tooLongText } from "./copy";
import { formatCount, formatDate } from "./format";
import { DiscardSheet, FormSummary } from "./form-parts";
import { requestHref } from "./routes";

/** A tracked line shows a code search from this many units (design 12.1). */
const SEARCH_FROM_UNITS = 8;

type LineErrors = { quantity?: string; units?: string; note?: string };

/**
 * "Serahkan barang" (design screen 9): what was actually given, as a count for quantity items and as
 * ticked units for tracked items. Handing over less than approved needs a note. borrowing.handle only;
 * the own request is allowed and the page says so (IB2).
 */
export function HandoverForm({ detail, units }: { detail: RequestDetail; units: HandoverUnit[] }) {
  const { router, busy, error, setError, run } = useInventoryAction();
  const summaryRef = useRef<HTMLDivElement>(null);
  const lines = detail.lines.filter((line) => (line.quantityApproved ?? 0) > 0);

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.filter((l) => l.mode === "quantity").map((l) => [l.lineId, l.quantityApproved ?? 0])),
  );
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, LineErrors>>({});
  const [nothing, setNothing] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const back = requestHref(detail.reference);
  const handed = (line: RequestLine) => (line.mode === "quantity" ? (quantities[line.lineId] ?? 0) : (picked[line.lineId] ?? []).length);
  const dirty =
    Object.values(notes).some((n) => n.trim() !== "") ||
    Object.values(picked).some((p) => p.length > 0) ||
    lines.some((l) => l.mode === "quantity" && quantities[l.lineId] !== l.quantityApproved);

  function setLineError(lineId: string, next: LineErrors) {
    setErrors((prev) => ({ ...prev, [lineId]: next }));
  }

  function validate(): Record<string, LineErrors> {
    const found: Record<string, LineErrors> = {};
    for (const line of lines) {
      const approved = line.quantityApproved ?? 0;
      const n = handed(line);
      const e: LineErrors = {};
      if (line.mode === "tracked" && n > approved) e.units = atMostUnitsText(approved);
      if (n < approved && (notes[line.lineId] ?? "").trim() === "") e.note = STAFF_COPY.handoverNoteMissing;
      if (Object.keys(e).length > 0) found[line.lineId] = e;
    }
    return found;
  }

  function lineFor(e: InventoryError): { lineId: string; errors: LineErrors } | null {
    const ref = "ref" in e ? (e.ref ?? null) : null;
    const line = lines.find((l) => l.lineId === ref);
    if (!line) return null;
    if (e.code === "note_required") return { lineId: line.lineId, errors: { note: STAFF_COPY.handoverNoteMissing } };
    if (e.code === "text_too_long") return { lineId: line.lineId, errors: { note: tooLongText("Catatan", INVENTORY_LIMITS.note) } };
    if (e.code === "quantity_invalid") {
      const approved = line.quantityApproved ?? 0;
      return line.mode === "quantity"
        ? { lineId: line.lineId, errors: { quantity: atMostText(approved) } }
        : { lineId: line.lineId, errors: { units: atMostUnitsText(approved) } };
    }
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setNothing(false);
    if (lines.every((line) => handed(line) === 0)) {
      setErrors({});
      setError(null);
      setNothing(true);
      return;
    }
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setError(null);
      for (const [lineId, e] of Object.entries(found)) if (e.note) setNoteOpen((prev) => ({ ...prev, [lineId]: true }));
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }

    const input: RequestHandOverInput = {
      requestId: detail.requestId,
      version: detail.version,
      lines: lines.map((line) =>
        line.mode === "quantity"
          ? { lineId: line.lineId, quantity: quantities[line.lineId] ?? 0, note: notes[line.lineId] ?? null }
          : { lineId: line.lineId, unitIds: picked[line.lineId] ?? [], note: notes[line.lineId] ?? null },
      ),
    };

    await run(() => handOverRequest(input), {
      onOk: () => router.push(requestHref(detail.reference, "handed_over"), { scroll: true }),
      onError: (e): ActionError | null => {
        if (e.code === "nothing_to_hand_over") {
          setNothing(true);
          return null;
        }
        const marked = lineFor(e);
        if (marked) {
          setLineError(marked.lineId, marked.errors);
          if (marked.errors.note) setNoteOpen((prev) => ({ ...prev, [marked.lineId]: true }));
          requestAnimationFrame(() => summaryRef.current?.focus());
          return null;
        }
        requestAnimationFrame(() => summaryRef.current?.focus());
        if (e.code === "unit_not_available" && e.unitId) {
          // Someone else took the unit: untick it and load the current list (design 12.4).
          const code = units.find((u) => u.unitId === e.unitId)?.code;
          setPicked((prev) => Object.fromEntries(Object.entries(prev).map(([k, ids]) => [k, ids.filter((id) => id !== e.unitId)])));
          router.refresh();
          return { text: inventoryErrorMessage(e, "handOver", { unitCode: code }) ?? COPY.unavailable };
        }
        return defaultActionError(e, "handOver", formatDate);
      },
    });
  }

  const problems = lines.flatMap((line) => {
    const e = errors[line.lineId];
    if (!e) return [];
    const out: { id: string; text: string }[] = [];
    if (e.quantity) out.push({ id: `handover-qty-${line.lineId}`, text: `${line.itemName}: ${e.quantity}` });
    if (e.units) out.push({ id: `handover-units-${line.lineId}`, text: `${line.itemName}: ${e.units}` });
    if (e.note) out.push({ id: `handover-note-${line.lineId}`, text: `${line.itemName}: ${e.note}` });
    return out;
  });

  return (
    <>
      {detail.isOwn ? (
        <AlertMessage role="status" tone="info">
          {STAFF_COPY.handoverOwn}
        </AlertMessage>
      ) : null}

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        <FormSummary ref={summaryRef} problems={problems} message={problems.length > 0 ? null : error} />

        {lines.map((line) => {
          const approved = line.quantityApproved ?? 0;
          const n = handed(line);
          const e = errors[line.lineId] ?? {};
          const short = n < approved;
          const showNote = noteOpen[line.lineId] || short;
          const lineUnits = units.filter((u) => u.lineId === line.lineId);
          return (
            <section
              key={line.lineId}
              aria-labelledby={`handover-line-${line.lineId}`}
              className="flex flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1"
            >
              <div>
                <h2 id={`handover-line-${line.lineId}`} className="text-headline-sm break-words text-ink">
                  {line.itemName}
                </h2>
                <p className="text-body-sm text-ink-meta tabular-nums">
                  {line.mode === "quantity"
                    ? `${line.itemCode ?? ""} · Disetujui ${formatCount(approved)}`
                    : `Disetujui ${formatCount(approved)} · Dipilih ${formatCount(n)} dari ${formatCount(approved)}`}
                </p>
              </div>

              {line.mode === "quantity" ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <label htmlFor={`handover-qty-${line.lineId}`} className="text-label-lg text-ink-label">
                      Diserahkan
                    </label>
                    <QuantityStepper
                      id={`handover-qty-${line.lineId}`}
                      value={quantities[line.lineId] ?? 0}
                      min={0}
                      max={approved}
                      label={`jumlah diserahkan ${line.itemName}`}
                      readOnly={busy}
                      invalid={Boolean(e.quantity)}
                      describedBy={e.quantity ? `handover-qty-${line.lineId}-error` : undefined}
                      onChange={(value) => {
                        setQuantities((prev) => ({ ...prev, [line.lineId]: value }));
                        setLineError(line.lineId, { ...e, quantity: undefined });
                        setNothing(false);
                      }}
                    />
                  </div>
                  {e.quantity ? <FieldError id={`handover-qty-${line.lineId}-error`}>{e.quantity}</FieldError> : null}
                </div>
              ) : (
                <UnitChecklist
                  line={line}
                  units={lineUnits}
                  picked={picked[line.lineId] ?? []}
                  approved={approved}
                  error={e.units ?? null}
                  busy={busy}
                  onChange={(ids) => {
                    setPicked((prev) => ({ ...prev, [line.lineId]: ids }));
                    setLineError(line.lineId, { ...e, units: undefined });
                    setNothing(false);
                  }}
                />
              )}

              {short && n > 0 ? (
                <p className="flex items-start gap-1.5 text-body-sm text-warn">
                  <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0" strokeWidth={2} />
                  {handoverShortText(line.mode === "quantity" ? "Diserahkan" : "Dipilih", n, approved)}
                </p>
              ) : null}

              {showNote ? (
                <TextareaField
                  id={`handover-note-${line.lineId}`}
                  label={short ? "Catatan (wajib)" : "Catatan (boleh kosong)"}
                  value={notes[line.lineId] ?? ""}
                  maxLength={INVENTORY_LIMITS.note}
                  readOnly={busy}
                  error={e.note}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNotes((prev) => ({ ...prev, [line.lineId]: value }));
                    setLineError(line.lineId, { ...e, note: undefined });
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNoteOpen((prev) => ({ ...prev, [line.lineId]: true }));
                    requestAnimationFrame(() => document.getElementById(`handover-note-${line.lineId}`)?.focus());
                  }}
                  className={buttonClass("text", "-ml-2 self-start no-underline")}
                >
                  <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
                  {STAFF_COPY.addNote}
                </button>
              )}
            </section>
          );
        })}

        <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : undefined)}>
          {busy ? <Spinner /> : null}
          {busy ? "Menyimpan..." : "Catat serah terima"}
        </button>
        {nothing ? (
          <div className="flex flex-col gap-1">
            <AlertMessage role="alert" tone="warning">
              {INVENTORY_ERROR_COPY.nothing_to_hand_over}
            </AlertMessage>
            {detail.actions.canCancel ? (
              <CancelRequest
                requestId={detail.requestId}
                reference={detail.reference}
                version={detail.version}
                reasonRequired={detail.actions.cancelReasonRequired}
                variant="text"
              />
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => (busy ? undefined : dirty ? setDiscardOpen(true) : router.push(back))}
          className={buttonClass("text", "self-center")}
        >
          Batal
        </button>
      </form>

      <DiscardSheet open={discardOpen} onOpenChange={setDiscardOpen} onDiscard={() => router.push(back)} />
    </>
  );
}

/**
 * Unit picker of one tracked line (design 12.1, 12.5): a fieldset of 48 px checkbox rows, only units
 * in Baik that are on no other open loan. The number ticked is the number handed over.
 */
function UnitChecklist({
  line,
  units,
  picked,
  approved,
  error,
  busy,
  onChange,
}: {
  line: RequestLine;
  units: HandoverUnit[];
  picked: string[];
  approved: number;
  error: string | null;
  busy: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toUpperCase();
  const shown = query === "" ? units : units.filter((u) => u.code.toUpperCase().includes(query) || picked.includes(u.unitId));
  const errorId = `handover-units-${line.lineId}-error`;

  return (
    <div className="flex flex-col gap-2">
      {units.length < approved ? (
        <AlertMessage role="status" tone="warning">
          {fewUnitsText(units.length, approved)}
        </AlertMessage>
      ) : null}
      {units.length > SEARCH_FROM_UNITS ? (
        <div className="relative">
          <label htmlFor={`handover-search-${line.lineId}`} className="sr-only">
            {STAFF_COPY.searchCode}
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-field-line"
            strokeWidth={2}
          />
          <input
            id={`handover-search-${line.lineId}`}
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={STAFF_COPY.searchCode}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={fieldBoxClass({ className: "h-12 appearance-none pr-3 pl-10" })}
          />
        </div>
      ) : null}
      <fieldset
        id={`handover-units-${line.lineId}`}
        tabIndex={-1}
        aria-describedby={error ? errorId : undefined}
        className="flex min-w-0 flex-col gap-1"
      >
        <legend className="sr-only">Pilih unit untuk {line.itemName}</legend>
        <p role="status" className="sr-only">
          Dipilih {picked.length} dari {approved}
        </p>
        {shown.map((unit) => {
          const checked = picked.includes(unit.unitId);
          return (
            <label
              key={unit.unitId}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-walnut",
                checked ? "border-walnut bg-ivory" : "border-surface-line bg-surface hover:border-walnut",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (busy) return;
                  onChange(checked ? picked.filter((id) => id !== unit.unitId) : [...picked, unit.unitId]);
                }}
                className="size-5 shrink-0 accent-walnut"
              />
              <span className={cn("text-body-md text-ink tabular-nums", checked && "font-semibold")}>{unit.code}</span>
              <span className="ml-auto truncate text-body-sm text-ink-body">{unit.locationName ?? COPY.noLocation}</span>
            </label>
          );
        })}
      </fieldset>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
