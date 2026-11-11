"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Paperclip, Wallet } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { FieldError, describedBy } from "@/components/ui/field-error";
import { fieldBoxClass, fieldHintClass, fieldLabelClass } from "@/components/ui/field-styles";
import { DateField } from "@/components/ui/form-fields";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import {
  FINANCE_COPY,
  FINANCE_ENTRY_TYPE_LABEL,
  FINANCE_LIMITS,
  FINANCE_RECORD_FIELD_ORDER,
  checkRupiahAmount,
  financeErrorMessage,
  formatFinanceCopy,
  groupRupiahDigits,
  isOutsideFinancePeriod,
  isValidFinanceDate,
  normaliseRupiahInput,
  rupiahInputDisplay,
  type FinanceEntryType,
  type FinanceError,
  type FinanceRecordInput,
} from "../types";
import { goToLogin, useFinanceAction, type ActionError } from "./action-sheet";
import { AmountField } from "./amount-field";
import { UI_COPY } from "./copy";
import { formatDate } from "./format";
import type { FormValues } from "./form-values";
import { EMPTY_PROOFS, ProofPicker, type ProofSummary } from "./proof-picker";
import { entryHref } from "./routes";
import { recordFinanceEntry } from "./server-actions";

const F = FINANCE_COPY.form;
const C = FINANCE_COPY.check;

type FieldKey = "entryDate" | "amount" | "description" | "notes" | "files";
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Field order on screen (the contract's order), for focusing the first problem. */
const ORDER: FieldKey[] = (FINANCE_RECORD_FIELD_ORDER as readonly string[]).filter((k): k is FieldKey =>
  ["entryDate", "amount", "description", "notes", "files"].includes(k),
);
const fieldId = (key: FieldKey) => `finance-${key}`;

/** The active period's dates for the soft warning of R5 (no block). */
export type FinancePeriodDates = { label: string | null; startsOn: string | null; endsOn: string | null };

/** What the person typed: the type is only a choice for income and expense. */
type Values = FormValues;

/** Frozen at "Lanjut": the check sheet shows and the save sends exactly these (and the one submit key). */
type Frozen = { values: Values; amount: string; key: string; files: ProofSummary["files"] };

type Props = {
  /** "entry" = Pemasukan / Pengeluaran (screens 3 and 5); "opening" = Saldo awal (screen 4). */
  mode: "entry" | "opening";
  /** Jakarta date: the entry date may not be after it. */
  today: string;
  period: FinancePeriodDates | null;
  initial: Values;
  /** "Koreksi atas {nomor}": the link target when the form was opened by "Buat koreksi". */
  correction: { entryId: string; numberText: string } | null;
  /** Opening form: the previous period's closing balance as a hint (never prefilled). */
  previous: { label: string | null; balanceText: string; digits: string | null } | null;
  cancelHref: string;
};

/**
 * "Catat Transaksi" (screens 3 and 5) and "Catat Saldo Awal" (screen 4). The amount is a digits-only field with
 * the thousands dots inserted while typing; it becomes digits TEXT with normaliseRupiahInput() and is never a
 * JS number. "Lanjut" validates, then opens the check sheet "Cek dulu" and makes ONE new submit key; "Simpan
 * transaksi" sends that key with the frozen values, so a double tap or a retry after a timeout saves one entry
 * (FN-17). Going "Kembali" to change something makes a new key at the next "Lanjut" (the same key with other
 * values would be refused). The save button is never greyed: a refusal is a message next to the problem.
 * Leaving with unsaved typing asks first. A saved entry can never be edited (K2 a).
 */
export function RecordForm(props: Props) {
  const { mode, today, period, initial, correction, previous, cancelHref } = props;
  const { router, busy, run, busyRef } = useFinanceAction();
  const topRef = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Values>(initial);
  const [files, setFiles] = useState<ProofSummary>(EMPTY_PROOFS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [top, setTop] = useState<ActionError | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [sheetError, setSheetError] = useState<ActionError | null>(null);
  const saved = useRef(false);
  const action = mode === "opening" ? "recordOpening" : "record";
  const entryType: FinanceEntryType = mode === "opening" ? "opening" : values.entryType;

  const dirty = files.count > 0 || JSON.stringify(values) !== JSON.stringify(initial);

  // A reload, a closed tab or a typed address with unsaved typing: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (saved.current) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }));
    setUnder(null);
  }

  function leave() {
    if (busyRef.current) return;
    if (dirty) setLeaveOpen(true);
    else router.push(cancelHref);
  }

  function text(error: FinanceError): string {
    return financeErrorMessage(error, action) ?? FINANCE_COPY.list.error;
  }

  // ---- Validation (the same rules the server applies; the server stays the judge) ----

  function validate(): { errors: FieldErrors; amount: string } {
    const next: FieldErrors = {};
    const amount = normaliseRupiahInput(values.amount);
    const check = checkRupiahAmount(amount, entryType);
    if (check !== "ok") next.amount = text({ code: check, field: "amount" });
    if (values.entryDate === "") next.entryDate = text({ code: "date_required", field: "entryDate" });
    else if (!isValidFinanceDate(values.entryDate)) next.entryDate = text({ code: "invalid_dates", field: "entryDate" });
    else if (values.entryDate > today) next.entryDate = text({ code: "date_in_future", field: "entryDate" });
    const description = values.description.replace(/\s+/g, " ").trim();
    if (description === "") next.description = text({ code: "text_required", field: "description" });
    else if ([...description].length > FINANCE_LIMITS.description) next.description = text({ code: "text_too_long", field: "description" });
    if ([...values.notes.trim()].length > FINANCE_LIMITS.notes) next.notes = text({ code: "text_too_long", field: "notes" });
    return { errors: next, amount };
  }

  function showErrors(next: FieldErrors) {
    setErrors(next);
    const first = ORDER.find((key) => next[key]);
    if (first) {
      requestAnimationFrame(() => {
        const target = document.getElementById(fieldId(first));
        target?.scrollIntoView({ block: "center" });
        target?.focus();
      });
    }
  }

  /** "Lanjut": validate, then freeze the values and make a NEW submit key for this look at the sheet. */
  function onNext(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setTop(null);
    setUnder(null);
    const found = validate();
    if (Object.values(found.errors).some(Boolean)) {
      showErrors(found.errors);
      return;
    }
    setErrors({});
    if (files.pending) {
      setUnder(UI_COPY.fileStillBusy);
      return;
    }
    // A proof that did not upload is never dropped silently: the person retries or removes it.
    if (files.failed) {
      setUnder(financeErrorMessage({ code: "unavailable" }, "upload"));
      return;
    }
    setSheetError(null);
    setFrozen({ values: { ...values }, amount: found.amount, key: crypto.randomUUID(), files: files.files });
  }

  /** "Simpan transaksi": the frozen values with the ONE key of this sheet. */
  function onSave() {
    if (!frozen || busyRef.current) return;
    const f = frozen;
    void run(
      () =>
        recordFinanceEntry({
          entryType,
          entryDate: f.values.entryDate,
          amount: f.amount,
          description: f.values.description,
          notes: f.values.notes,
          files: f.files,
          // A Saldo awal is never a correction (the schema and the database refuse it).
          correctsEntryId: entryType === "opening" ? null : (correction?.entryId ?? null),
          submitKey: f.key,
        } as FinanceRecordInput),
      {
        onOk: (data) => {
          saved.current = true;
          // replayed = true is a success too: the first save of this key already made the entry.
          router.push(entryHref(data.entryId, "recorded"), { scroll: true });
        },
        onError: (error) => handleError(error),
      },
    );
  }

  function handleError(error: FinanceError): ActionError | null {
    if (error.code === "unauthenticated") {
      goToLogin(router);
      return null;
    }
    // A refusal tied to one field goes back to the form, next to that field.
    if ("field" in error && isFieldKey(error.field)) {
      setFrozen(null);
      showErrors({ [error.field]: text(error) });
      return null;
    }
    // Same key with other values can only be a bug of this screen; the safe way out is a fresh look.
    if (error.code === "idempotency_conflict") {
      setFrozen(null);
      setTop({ text: text(error), reload: true });
      return null;
    }
    const reload = ["state_changed", "entry_voided", "closed_period", "not_found", "no_active_period", "opening_exists"].includes(error.code);
    // Keep the sheet open on a network or database hiccup so "Simpan transaksi" can retry with the SAME key.
    const message: ActionError = { text: text(error), reload };
    setSheetError(message);
    return message;
  }

  const outside = period !== null && values.entryDate !== "" && isOutsideFinancePeriod(values.entryDate, period.startsOn, period.endsOn);

  return (
    <>
      <button
        type="button"
        onClick={leave}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
      >
        <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
        {F.back}
      </button>
      <div className="nx-rise flex flex-col gap-1">
        <h1 className="font-heading text-display-sm text-title">{mode === "opening" ? FINANCE_COPY.opening.title : F.title}</h1>
        <p className="text-body-md text-ink-body">{mode === "opening" ? UI_COPY.openingSubtitle : UI_COPY.recordSubtitle}</p>
      </div>

      <form noValidate onSubmit={onNext} aria-busy={busy || undefined} className="flex flex-col gap-4">
        {top ? (
          <div ref={topRef} tabIndex={-1} className="flex flex-col gap-2">
            <AlertMessage role="alert" tone="warning" icon={top.icon}>
              {top.text}
            </AlertMessage>
            {top.reload ? (
              <button type="button" onClick={() => router.refresh()} className={buttonClass("outline")}>
                {UI_COPY.reload}
              </button>
            ) : null}
          </div>
        ) : null}

        <FormCard legend={mode === "opening" ? FINANCE_COPY.opening.title : F.title} icon={<Wallet strokeWidth={2} />} className="nx-rise nx-delay-1">
          {mode === "entry" ? (
            correction ? (
              <>
                <TypeLine type={entryType} />
                <p className="rounded-lg border border-gold-tint-line bg-gold-tint px-3 py-2 text-body-md text-ink">
                  {formatFinanceCopy(F.correctsLine, { nomor: correction.numberText })}
                </p>
              </>
            ) : (
              <TypeSegments value={values.entryType} disabled={busy} onChange={(next) => set("entryType", next)} />
            )
          ) : (
            <TypeLine type="opening" />
          )}

          {mode === "opening" && previous ? (
            <PreviousHint previous={previous} onUse={() => previous.digits !== null && set("amount", rupiahInputDisplay(previous.digits))} />
          ) : null}

          <AmountField
            id={fieldId("amount")}
            label={F.amount}
            value={values.amount}
            readOnly={busy}
            error={errors.amount}
            hint={mode === "opening" ? FINANCE_COPY.opening.amountHelp : F.amountHelp}
            onValueChange={(next) => set("amount", next)}
          />

          <div className="flex flex-col gap-2">
            <DateField
              id={fieldId("entryDate")}
              label={F.date}
              max={today}
              min={FINANCE_LIMITS.minDate}
              value={values.entryDate}
              readOnly={busy}
              error={errors.entryDate}
              onChange={(event) => set("entryDate", event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <TextField
              id={fieldId("description")}
              label={F.description}
              value={values.description}
              maxLength={FINANCE_LIMITS.description}
              autoComplete="off"
              readOnly={busy}
              invalid={Boolean(errors.description)}
              aria-describedby={describedBy(`${fieldId("description")}-help`, errors.description ? `${fieldId("description")}-error` : null)}
              onChange={(event) => set("description", event.target.value)}
            />
            <p id={`${fieldId("description")}-help`} className={fieldHintClass}>
              {F.descriptionHelp}
            </p>
            {errors.description ? <FieldError id={`${fieldId("description")}-error`}>{errors.description}</FieldError> : null}
          </div>

          <NotesField
            id={fieldId("notes")}
            label={F.notes}
            value={values.notes}
            readOnly={busy}
            error={errors.notes}
            onChange={(next) => set("notes", next)}
          />
        </FormCard>

        <FormCard legend={F.proof} icon={<Paperclip strokeWidth={2} />} className="nx-rise nx-delay-2">
          <ProofPicker
            id={fieldId("files")}
            disabled={busy}
            onChange={(summary) => {
              setFiles(summary);
              setUnder(null);
            }}
            error={errors.files ?? null}
          />
        </FormCard>

        <div className="flex flex-col gap-2 pt-1">
          <button type="submit" className={buttonClass("primary", "nx-press")}>
            {F.next}
          </button>
          {under ? (
            <p role="status" className="text-center text-body-sm text-ink-body">
              {under}
            </p>
          ) : null}
          <button type="button" onClick={leave} className={buttonClass("outline", "h-11")}>
            {F.cancel}
          </button>
        </div>
      </form>

      <Sheet
        open={frozen !== null}
        onOpenChange={(open) => {
          if (!open) setFrozen(null);
        }}
        title={C.title}
        busy={busy}
        footer={
          <>
            {sheetError ? (
              <div className="flex flex-col gap-2">
                <AlertMessage role="alert" tone="warning" icon={sheetError.icon}>
                  {sheetError.text}
                </AlertMessage>
                {sheetError.reload ? (
                  <button type="button" onClick={() => router.refresh()} className={buttonClass("outline")}>
                    {UI_COPY.reload}
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={onSave}
              aria-busy={busy || undefined}
              className={buttonClass("primary", busy ? "cursor-progress" : "nx-press")}
            >
              {busy ? <Spinner /> : null}
              {busy ? UI_COPY.saving : C.save}
            </button>
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => !busy && setFrozen(null)}
              className={buttonClass("text", "self-center")}
            >
              {C.back}
            </button>
          </>
        }
      >
        {frozen ? (
          <div className="flex flex-col gap-3">
            <p className="text-body-lg font-bold break-words text-ink tabular-nums">
              {formatFinanceCopy(C.summary, {
                Jenis: FINANCE_ENTRY_TYPE_LABEL[entryType],
                jumlah: groupRupiahDigits(frozen.amount),
                tanggal: formatDate(frozen.values.entryDate),
              })}
            </p>
            <p className="text-body-md break-words text-ink">{frozen.values.description.replace(/\s+/g, " ").trim()}</p>
            {frozen.files.length > 0 ? (
              <p className="text-body-sm text-ink-body">{formatFinanceCopy(UI_COPY.checkProofCount, { n: frozen.files.length })}</p>
            ) : null}
            {correction ? <p className="text-body-sm text-ink-body">{formatFinanceCopy(F.correctsLine, { nomor: correction.numberText })}</p> : null}
            {outside ? (
              <AlertMessage role="status" tone="info" icon="schedule">
                {formatFinanceCopy(C.outsidePeriod, { label: period?.label ?? "" })}
              </AlertMessage>
            ) : null}
            <AlertMessage role="status" tone="warning">
              {C.warning}
            </AlertMessage>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={FINANCE_COPY.leave.title}
        description={FINANCE_COPY.leave.body}
        footer={
          <>
            <button type="button" onClick={() => setLeaveOpen(false)} className={buttonClass("primary")}>
              {FINANCE_COPY.leave.stay}
            </button>
            <button
              type="button"
              onClick={() => {
                saved.current = true;
                router.push(cancelHref);
              }}
              className={buttonClass("text", "self-center")}
            >
              {FINANCE_COPY.leave.leave}
            </button>
          </>
        }
      />
    </>
  );
}

function isFieldKey(field: string): field is FieldKey {
  return (ORDER as string[]).includes(field);
}

/** A fieldset drawn as a card, its legend as the card title with a small walnut icon. */
function FormCard({ legend, icon, className, children }: { legend: string; icon: ReactNode; className?: string; children: ReactNode }) {
  return (
    <fieldset className={`flex min-w-0 flex-col gap-4 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 md:p-5 ${className ?? ""}`}>
      <legend className="float-left mb-0 flex w-full items-center gap-2 border-b border-row-line pb-2.5 text-headline-sm text-ink">
        <span aria-hidden="true" className="text-walnut [&_svg]:size-5">
          {icon}
        </span>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

/** "Jenis": two segments, Pemasukan and Pengeluaran (screen 3). Radios drawn as segments: arrow keys work. */
function TypeSegments({ value, disabled, onChange }: { value: FinanceEntryType; disabled: boolean; onChange: (type: FinanceEntryType) => void }) {
  const options = ["income", "expense"] as const;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className={`${fieldLabelClass} mb-1.5`}>{F.type}</legend>
      <div role="radiogroup" aria-label={UI_COPY.typeSegments} className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const checked = value === option;
          return (
            <label
              key={option}
              className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-field-line bg-surface px-3 text-label-lg text-ink hover:border-walnut has-[input:checked]:border-2 has-[input:checked]:border-walnut has-[input:checked]:bg-ivory has-[input:checked]:font-bold has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-walnut"
            >
              <input
                type="radio"
                name="finance-entry-type"
                value={option}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              {FINANCE_ENTRY_TYPE_LABEL[option]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A type that cannot be changed here (Saldo awal, or a correction's opposite type): a quiet ivory line. */
function TypeLine({ type }: { type: FinanceEntryType }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className={fieldLabelClass}>{F.type}</p>
      <p className="flex min-h-12 items-center rounded-lg border border-surface-line bg-ivory/60 px-3 text-field text-ink">{FINANCE_ENTRY_TYPE_LABEL[type]}</p>
    </div>
  );
}

/** "Saldo akhir periode {label}: Rp ..." with "Pakai angka ini" (K3 a): a hint, never a silent prefill (FN-21). */
function PreviousHint({
  previous,
  onUse,
}: {
  previous: { label: string | null; balanceText: string; digits: string | null };
  onUse: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border border-gold-tint-line bg-gold-tint px-3 py-2.5">
      <p className="text-body-md text-ink tabular-nums">
        {formatFinanceCopy(FINANCE_COPY.opening.previousHint, { label: previous.label ?? "-", jumlah: previous.balanceText })}
      </p>
      {previous.digits !== null ? (
        <button type="button" onClick={onUse} className={buttonClass("text", "-ml-2")}>
          {FINANCE_COPY.opening.usePrevious}
        </button>
      ) : (
        <p className="text-body-sm text-ink-body">{UI_COPY.previousNegativeNote}</p>
      )}
    </div>
  );
}

/** Catatan: a long text box that keeps line breaks (R16: plain text, never run). */
function NotesField({
  id,
  label,
  value,
  readOnly,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  readOnly: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={FINANCE_LIMITS.notes}
        value={value}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error ? errorId : null)}
        onChange={(event) => onChange(event.target.value)}
        className={fieldBoxClass({ invalid: Boolean(error), className: "min-h-[5.5rem] max-h-60 resize-none px-3 py-2.5 leading-relaxed field-sizing-content" })}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

/** The record form's initial values live in ./form-values (a plain module the server pages can call). */
