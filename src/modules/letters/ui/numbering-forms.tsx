"use client";

import { useRef, useState } from "react";
import { describedBy, FieldError } from "@/components/ui/field-error";
import { fieldBoxClass, fieldHintClass, fieldLabelClass } from "@/components/ui/field-styles";
import { SelectField, TextareaField } from "@/components/ui/form-fields";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import {
  formatLetterNumber,
  LETTER_FIELD_ERROR_COPY,
  LETTER_LIMITS,
  letterErrorMessage,
  NUMBER_SEPARATORS,
  NUMBERING_FIELD_LABEL,
  NUMBERING_TYPE_WORD,
  padLetterSequence,
  type LetterError,
  type NumberingSettings,
  type NumberingTypeState,
  type NumberSeparator,
} from "../types";
import { ActionSheet, FormSummary, goToLogin, useLetterAction, type ActionError } from "./action-sheet";
import { COPY } from "./copy";
import { NumberText } from "./letter-number";
import { numberingHref } from "./routes";
import { setNextNumber, updateNumberingFormat } from "./server-actions";

type FormatKey = "prefix" | "incomingCode" | "outgoingCode" | "seqDigits" | "separator";
type FormatErrors = Partial<Record<FormatKey | "codes", string>>;
const ORDER: FormatKey[] = ["prefix", "incomingCode", "outgoingCode", "seqDigits", "separator"];
const fieldId = (key: FormatKey) => `numbering-${key}`;
const PART = /^[A-Za-z0-9/.-]+$/;

/**
 * "Format nomor" for the System Admin (design 13.1-13.3). A live preview shows the real next number of
 * each type under the new format (role=status, so a screen reader hears it). The year is always part
 * of the number (owner): there is no "Sertakan tahun" checkbox. "Simpan format" opens a check sheet.
 */
export function FormatForm({ settings }: { settings: NumberingSettings }) {
  const { router, busy, run, busyRef } = useLetterAction();
  const summaryRef = useRef<HTMLDivElement>(null);
  const initial = {
    prefix: settings.prefix,
    incomingCode: settings.incomingCode,
    outgoingCode: settings.outgoingCode,
    seqDigits: String(settings.seqDigits),
    separator: settings.separator,
  };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FormatErrors>({});
  const [summary, setSummary] = useState<FormatKey[] | null>(null);
  const [top, setTop] = useState<ActionError | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const copy = LETTER_FIELD_ERROR_COPY.numberingFormat;

  function set<K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, codes: key === "incomingCode" || key === "outgoingCode" ? undefined : prev.codes }));
    setUnder(null);
  }

  const digits = /^\d{1,2}$/.test(values.seqDigits) ? Number(values.seqDigits) : NaN;
  const digitsValid = Number.isInteger(digits) && digits >= LETTER_LIMITS.seqDigitsMin && digits <= LETTER_LIMITS.seqDigitsMax;
  const preview = (state: NumberingTypeState) =>
    formatLetterNumber(
      { prefix: values.prefix.trim(), seqDigits: digitsValid ? digits : settings.seqDigits, separator: values.separator },
      state.type === "incoming" ? values.incomingCode.trim() : values.outgoingCode.trim(),
      settings.year,
      state.nextSeq,
    );

  function validate(): FormatErrors {
    const next: FormatErrors = {};
    const part = (key: "prefix" | "incomingCode" | "outgoingCode", max: number) => {
      const text = values[key].trim();
      if (text === "") next[key] = copy[key]?.text_required;
      else if (text.length > max || !PART.test(text)) next[key] = copy[key]?.invalid_number_format;
    };
    part("prefix", LETTER_LIMITS.prefix);
    part("incomingCode", LETTER_LIMITS.typeCode);
    part("outgoingCode", LETTER_LIMITS.typeCode);
    if (!next.incomingCode && !next.outgoingCode && values.incomingCode.trim().toLowerCase() === values.outgoingCode.trim().toLowerCase()) {
      next.outgoingCode = copy.codes?.invalid_number_format;
    }
    if (!digitsValid) next.seqDigits = (copy.seqDigits?.invalid_number_format ?? "").replace("{max}", String(LETTER_LIMITS.seqDigitsMax));
    return next;
  }

  function showErrors(next: FormatErrors) {
    setErrors(next);
    setSummary(ORDER.filter((key) => next[key]));
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setTop(null);
    setUnder(null);
    const found = validate();
    if (Object.values(found).some(Boolean)) {
      showErrors(found);
      return;
    }
    setErrors({});
    setSummary(null);
    if (JSON.stringify(values) === JSON.stringify(initial)) {
      setUnder(COPY.nothingChanged);
      return;
    }
    setCheckOpen(true);
  }

  function save() {
    setCheckOpen(false);
    void run(
      () =>
        updateNumberingFormat({
          version: settings.version,
          prefix: values.prefix,
          incomingCode: values.incomingCode,
          outgoingCode: values.outgoingCode,
          seqDigits: digits,
          separator: values.separator,
        }),
      {
        onOk: (data) => {
          if (!data.changed) {
            setUnder(COPY.nothingChanged);
            return;
          }
          router.replace(numberingHref("format_saved"), { scroll: true });
          router.refresh();
        },
        onError: handleError,
      },
    );
  }

  function handleError(error: LetterError): null {
    if (error.code === "unauthenticated") {
      goToLogin(router);
      return null;
    }
    const text = letterErrorMessage(error, "numberingFormat") ?? COPY.unavailable;
    if ("field" in error) {
      const field = error.field === "codes" ? "outgoingCode" : error.field;
      if ((ORDER as string[]).includes(field)) {
        showErrors({ [field]: text });
        return null;
      }
    }
    setTop({ text, reload: error.code === "state_changed" || error.code === "year_not_current" });
    requestAnimationFrame(() => summaryRef.current?.focus());
    return null;
  }

  const problems = (summary ?? []).flatMap((key) => (errors[key] ? [{ id: fieldId(key), text: errors[key] as string }] : []));
  const changes = settings.types.filter((state) => preview(state) !== state.nextNumber);

  return (
    <>
      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        <FormSummary ref={summaryRef} problems={problems} message={top} onReload={() => router.refresh()} />
        <PartField id={fieldId("prefix")} label={`${NUMBERING_FIELD_LABEL.prefix} (wajib)`} value={values.prefix} max={LETTER_LIMITS.prefix} error={errors.prefix} busy={busy} onChange={(v) => set("prefix", v)} />
        {/* Labels wrap on a phone; two reserved lines keep the boxes of a row level. */}
        <div className="grid grid-cols-2 gap-3 [&_label]:min-h-9 md:[&_label]:min-h-0">
          <PartField id={fieldId("incomingCode")} label={`${NUMBERING_FIELD_LABEL.incomingCode} (wajib)`} value={values.incomingCode} max={LETTER_LIMITS.typeCode} error={errors.incomingCode} busy={busy} onChange={(v) => set("incomingCode", v)} />
          <PartField id={fieldId("outgoingCode")} label={`${NUMBERING_FIELD_LABEL.outgoingCode} (wajib)`} value={values.outgoingCode} max={LETTER_LIMITS.typeCode} error={errors.outgoingCode} busy={busy} onChange={(v) => set("outgoingCode", v)} />
        </div>
        <div className="grid grid-cols-2 gap-3 [&_label]:min-h-9 md:[&_label]:min-h-0">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={fieldId("seqDigits")} className={fieldLabelClass}>
              {NUMBERING_FIELD_LABEL.seqDigits} (wajib)
            </label>
            <input
              id={fieldId("seqDigits")}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={1}
              value={values.seqDigits}
              readOnly={busy}
              aria-invalid={errors.seqDigits ? true : undefined}
              aria-describedby={describedBy(`${fieldId("seqDigits")}-hint`, errors.seqDigits && `${fieldId("seqDigits")}-error`)}
              onChange={(event) => set("seqDigits", event.target.value.replace(/\D/g, ""))}
              className={fieldBoxClass({ invalid: Boolean(errors.seqDigits), className: "h-12 px-3 tabular-nums" })}
            />
            <p id={`${fieldId("seqDigits")}-hint`} className={fieldHintClass}>
              1 sampai {LETTER_LIMITS.seqDigitsMax}
            </p>
            {errors.seqDigits ? <FieldError id={`${fieldId("seqDigits")}-error`}>{errors.seqDigits}</FieldError> : null}
          </div>
          <SelectField
            id={fieldId("separator")}
            label={`${NUMBERING_FIELD_LABEL.separator} (wajib)`}
            value={values.separator}
            error={errors.separator}
            onChange={(event) => set("separator", event.target.value as NumberSeparator)}
          >
            {NUMBER_SEPARATORS.map((sep) => (
              <option key={sep} value={sep}>
                {sep}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="rounded-lg border border-gold-tint-line bg-gold-tint px-3 py-3">
          <p className="text-body-sm text-ink-body">{COPY.previewTitle}</p>
          <ul role="status" aria-live="polite" className="mt-1 flex flex-col gap-0.5">
            {settings.types.map((state) => (
              <li key={state.type} className="text-body-md break-words text-ink">
                <span className="sr-only">{NUMBERING_TYPE_WORD[state.type]}: </span>
                <NumberText value={preview(state)} />
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : "nx-press")}>
            {busy ? <Spinner /> : null}
            {busy ? "Menyimpan..." : "Simpan format"}
          </button>
          {under ? (
            <p role="status" className="text-center text-body-sm text-ink-body">
              {under}
            </p>
          ) : null}
        </div>
      </form>

      <Sheet
        open={checkOpen}
        onOpenChange={setCheckOpen}
        title={COPY.formatCheckTitle}
        description={
          <>
            {changes.map((state) => (
              <span key={state.type} className="block">
                Nomor berikutnya {NUMBERING_TYPE_WORD[state.type]} akan menjadi{" "}
                <strong className="font-bold text-ink tabular-nums">{preview(state)}</strong>, bukan{" "}
                <span className="tabular-nums">{state.nextNumber}</span>.
              </span>
            ))}
            <span className="mt-1 block">Nomor yang sudah ada tidak berubah. Perubahan ini dicatat.</span>
          </>
        }
        footer={
          <>
            <button type="button" onClick={save} className={buttonClass("primary")}>
              Simpan format
            </button>
            <button type="button" onClick={() => setCheckOpen(false)} className={buttonClass("text", "self-center")}>
              Periksa lagi
            </button>
          </>
        }
      />
    </>
  );
}

function PartField({
  id,
  label,
  value,
  max,
  error,
  busy,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  error?: string;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <TextField
        id={id}
        label={label}
        value={value}
        maxLength={max}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        readOnly={busy}
        invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="tabular-nums"
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

/**
 * "Atur nomor berikutnya" (design 13.3, P11, G6): System Admin, current year only, only up, with a
 * reason. The live result shows the number the next letter of this type will get.
 */
export function SetNextButton({ settings, state }: { settings: NumberingSettings; state: NumberingTypeState }) {
  const [open, setOpen] = useState(false);
  const { router, busy, error, setError, run } = useLetterAction();
  const seqRef = useRef<HTMLInputElement>(null);
  const [seq, setSeq] = useState("");
  const [reason, setReason] = useState("");
  const [seqError, setSeqError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const last = state.lastUsed;
  const lastText = last === null ? "belum ada" : padLetterSequence(last, settings.seqDigits);
  const lowerText = padLetterSequence(last ?? 0, settings.seqDigits);
  const tooLowText = `Isi angka bulat yang lebih besar dari ${lowerText}.`;
  const value = /^\d{1,7}$/.test(seq) ? Number(seq) : NaN;
  const valid = Number.isInteger(value) && value > (last ?? 0) && value <= LETTER_LIMITS.nextSeqMax;
  const result = valid ? formatLetterNumber(settings, state.code, settings.year, value) : null;

  function submit() {
    let bad = false;
    if (!valid) {
      setSeqError(tooLowText);
      bad = true;
    }
    if (reason.trim() === "") {
      setReasonError(COPY.setNextReasonMissing);
      bad = true;
    }
    if (bad) {
      if (!valid) seqRef.current?.focus();
      return;
    }
    void run(() => setNextNumber({ type: state.type, year: settings.year, nextSeq: value, reason }), {
      onOk: () => {
        setOpen(false);
        router.replace(numberingHref("next_set"), { scroll: true });
        router.refresh();
      },
      onError: (e) => {
        if (e.code === "sequence_not_higher" || (e.code === "invalid_input" && e.field === "nextSeq")) {
          setSeqError(letterErrorMessage(e, "numberingSetNext", { seqDigits: settings.seqDigits, lastUsed: last }) ?? tooLowText);
          return null;
        }
        if (e.code === "reason_required") {
          setReasonError(COPY.setNextReasonMissing);
          return null;
        }
        return { text: letterErrorMessage(e, "numberingSetNext", { seqDigits: settings.seqDigits }) ?? COPY.unavailable, reload: e.code === "state_changed" || e.code === "year_not_current" };
      },
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-ml-2 inline-flex min-h-11 items-center self-start rounded-lg px-2 text-label-lg text-walnut underline underline-offset-2 hover:bg-ivory"
      >
        {COPY.setNextTitle}
        <span className="sr-only"> {NUMBERING_TYPE_WORD[state.type]}</span>
      </button>
      <ActionSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={COPY.setNextTitle}
        description={
          <span className="flex flex-col">
            <span>Jenis: {NUMBERING_TYPE_WORD[state.type].replace(/^s/, "S")}</span>
            <span className="tabular-nums">Tahun: {settings.year}</span>
          </span>
        }
        primaryLabel="Simpan nomor"
        busy={busy}
        error={error}
        onSubmit={submit}
        initialFocusRef={seqRef}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="next-seq" className={fieldLabelClass}>
            Nomor berikutnya (wajib)
          </label>
          <input
            ref={seqRef}
            id="next-seq"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={7}
            value={seq}
            readOnly={busy}
            aria-invalid={seqError ? true : undefined}
            aria-describedby={describedBy("next-seq-hint", "next-seq-result", seqError && "next-seq-error")}
            onChange={(event) => {
              setSeq(event.target.value.replace(/\D/g, ""));
              setSeqError(null);
            }}
            className={fieldBoxClass({ invalid: Boolean(seqError), className: "h-12 px-3 tabular-nums" })}
          />
          <p id="next-seq-hint" className={fieldHintClass}>
            Terakhir dipakai: {lastText}.{last !== null ? " Isi angka yang lebih besar dari itu." : ""}
          </p>
          <p id="next-seq-result" role="status" aria-live="polite" className="text-body-md text-ink empty:hidden">
            {result ? (
              <>
                Hasilnya: <NumberText value={result} />
              </>
            ) : null}
          </p>
          {seqError ? <FieldError id="next-seq-error">{seqError}</FieldError> : null}
        </div>
        <TextareaField
          id="next-seq-reason"
          label="Alasan (wajib)"
          placeholder={COPY.setNextReasonPlaceholder}
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
