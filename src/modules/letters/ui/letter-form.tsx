"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { DateField, TextareaField } from "@/components/ui/form-fields";
import { FieldError } from "@/components/ui/field-error";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/utils";
import {
  LETTER_COUNTERPART_LABEL,
  LETTER_FIELD_ERROR_COPY,
  LETTER_LIMITS,
  LETTER_TYPE_LABEL,
  letterErrorMessage,
  type LetterError,
  type LetterInputField,
  type LetterType,
} from "../types";
import { DiscardSheet, FormCard, FormSummary, goToLogin, useLetterAction, type ActionError } from "./action-sheet";
import { COPY } from "./copy";
import { EMPTY_FILES, FilePicker, type FileSummary } from "./file-picker";
import { NumberText } from "./letter-number";
import { letterHref, NUMBERING_PATH } from "./routes";
import { registerLetter, updateLetter } from "./server-actions";

type FieldKey = "legacyNumber" | "receivedDate" | "letterDate" | "counterpart" | "subject" | "counterpartNumber" | "notes" | "files";
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Field order on screen, for the summary and for focusing the first problem (design 7.1, 7.2). */
const ORDER: Record<LetterType, FieldKey[]> = {
  incoming: ["legacyNumber", "receivedDate", "counterpart", "subject", "letterDate", "counterpartNumber", "notes", "files"],
  outgoing: ["legacyNumber", "letterDate", "counterpart", "subject", "notes", "files"],
};

const fieldId = (key: FieldKey) => (key === "files" ? "letter-files" : `letter-${key}`);

export type LetterFormValues = {
  receivedDate: string;
  letterDate: string;
  counterpart: string;
  subject: string;
  counterpartNumber: string;
  notes: string;
};

/**
 * "Catat Surat Masuk / Keluar" and "Ubah rincian" (design screen 4, section 7). Register: the number
 * comes at save (or, with "Surat lama", is typed and checked in a sheet first, P9); files are optional
 * (K5). Edit: the number is read-only, files are managed on the detail. The server validates again;
 * the save button is never greyed, a refusal is a message next to the problem (K8).
 */
export function LetterForm({
  mode,
  type,
  initial,
  today,
  cancelHref,
  letterId,
  version,
  numberText,
  firstUseHint = false,
  canReadNumbering = false,
}: {
  mode: "register" | "edit";
  type: LetterType;
  initial: LetterFormValues;
  /** Jakarta date: dates may not be after it. */
  today: string;
  cancelHref: string;
  letterId?: string;
  version?: number;
  numberText?: string;
  /** Design 7.6 (P10): no automatic number of this type has been issued or set this year. */
  firstUseHint?: boolean;
  canReadNumbering?: boolean;
}) {
  const { router, busy, run, busyRef } = useLetterAction();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [legacy, setLegacy] = useState(false);
  const [legacyNumber, setLegacyNumber] = useState("");
  const [values, setValues] = useState<LetterFormValues>(initial);
  const [files, setFiles] = useState<FileSummary>(EMPTY_FILES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<FieldKey[] | null>(null);
  const [top, setTop] = useState<ActionError | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const action = mode === "register" ? "register" : "edit";
  const form = type === "incoming" ? "letterIncoming" : "letterOutgoing";
  const dirty = legacy || legacyNumber !== "" || files.count > 0 || JSON.stringify(values) !== JSON.stringify(initial);

  function set<K extends keyof LetterFormValues>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    setUnder(null);
  }

  function leave() {
    if (busyRef.current) return;
    if (dirty) setDiscardOpen(true);
    else router.push(cancelHref);
  }

  function fieldText(field: LetterInputField, code: "text_required" | "date_required" | "date_in_future" | "text_too_long"): string {
    return (
      LETTER_FIELD_ERROR_COPY[form][field]?.[code] ??
      letterErrorMessage({ code, field } as LetterError, action, { letterType: type }) ??
      COPY.unavailable
    );
  }

  // ---- Validation (the same rules the server applies; the server stays the judge) ----

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (mode === "register" && legacy && legacyNumber.trim() === "") next.legacyNumber = fieldText("legacyNumber", "text_required");
    if (type === "incoming") {
      if (values.receivedDate === "") next.receivedDate = fieldText("receivedDate", "date_required");
      else if (values.receivedDate > today) next.receivedDate = fieldText("receivedDate", "date_in_future");
      if (values.letterDate !== "" && values.letterDate > today) next.letterDate = fieldText("letterDate", "date_in_future");
    } else if (values.letterDate === "") next.letterDate = fieldText("letterDate", "date_required");
    else if (values.letterDate > today) next.letterDate = fieldText("letterDate", "date_in_future");
    if (values.counterpart.trim() === "") next.counterpart = fieldText("counterpart", "text_required");
    if (values.subject.trim() === "") next.subject = fieldText("subject", "text_required");
    return next;
  }

  function showErrors(next: FieldErrors) {
    setErrors(next);
    setSummary(ORDER[type].filter((key) => next[key]));
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
    if (files.pending) {
      setUnder(COPY.fileStillBusy);
      return;
    }
    // A file that did not upload is never dropped silently: the person retries or removes it (9.4).
    if (files.failed) {
      setUnder(COPY.fileFailed);
      return;
    }
    if (mode === "register" && legacy) {
      setCheckOpen(true);
      return;
    }
    save();
  }

  function save() {
    setCheckOpen(false);
    if (mode === "register") {
      const common = { subject: values.subject, counterpart: values.counterpart, notes: values.notes, legacyNumber: legacy ? legacyNumber : null };
      void run(
        () =>
          registerLetter(
            type === "incoming"
              ? {
                  type,
                  ...common,
                  receivedDate: values.receivedDate,
                  letterDate: values.letterDate,
                  counterpartNumber: values.counterpartNumber,
                  files: files.files,
                }
              : { type, ...common, letterDate: values.letterDate, files: files.files },
          ),
        {
          onOk: (data) => router.push(letterHref(data.letterId, "registered"), { scroll: true }),
          onError: handleError,
        },
      );
      return;
    }
    if (!letterId || version === undefined) return;
    const common = { letterId, version, subject: values.subject, counterpart: values.counterpart, notes: values.notes };
    void run(
      () =>
        updateLetter(
          type === "incoming"
            ? { type, ...common, receivedDate: values.receivedDate, letterDate: values.letterDate, counterpartNumber: values.counterpartNumber }
            : { type, ...common, letterDate: values.letterDate },
        ),
      {
        onOk: (data) => {
          if (!data.changed) {
            setUnder(COPY.nothingChanged);
            return;
          }
          router.push(letterHref(letterId, "edited"), { scroll: true });
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
    const text = letterErrorMessage(error, action, { letterType: type }) ?? COPY.unavailable;
    if ("field" in error && isFieldKey(error.field)) {
      showErrors({ [error.field]: text });
      return null;
    }
    if (error.code === "duplicate_number") {
      showErrors({ legacyNumber: text });
      return null;
    }
    const reload = ["state_changed", "letter_voided", "closed_period", "not_found"].includes(error.code);
    setTop({ text, reload });
    requestAnimationFrame(() => summaryRef.current?.focus());
    return null;
  }

  const problems = (summary ?? []).flatMap((key) => (errors[key] ? [{ id: fieldId(key), text: errors[key] as string }] : []));
  const backLabel = mode === "register" ? LETTER_TYPE_LABEL[type] : `Detail ${LETTER_TYPE_LABEL[type]}`;
  const title = mode === "register" ? `Catat ${LETTER_TYPE_LABEL[type]}` : "Ubah rincian";

  return (
    <>
      <button
        type="button"
        onClick={leave}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
      >
        <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
        {backLabel}
      </button>
      <h1 className="font-heading text-display-sm text-title">{title}</h1>

      {firstUseHint && mode === "register" && !legacy ? (
        <AlertMessage role="status" tone="info">
          {COPY.firstUseHint}
        </AlertMessage>
      ) : null}

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        <FormSummary ref={summaryRef} problems={problems} message={top} onReload={() => router.refresh()} />

        <NumberCard
          mode={mode}
          type={type}
          legacy={legacy}
          numberText={numberText}
          canReadNumbering={canReadNumbering}
        />

        {mode === "register" ? (
          <label
            className={cn(
              "flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-walnut",
              legacy ? "border-2 border-walnut bg-ivory" : "border-[1.5px] border-field-line bg-surface hover:border-walnut",
            )}
          >
            <input
              type="checkbox"
              checked={legacy}
              onChange={(event) => {
                if (busyRef.current) return;
                setLegacy(event.target.checked);
                setErrors((prev) => ({ ...prev, legacyNumber: undefined }));
              }}
              className="mt-0.5 size-5 shrink-0 accent-walnut"
            />
            <span className="min-w-0">
              <span className={cn("block text-body-md text-ink", legacy && "font-semibold")}>{COPY.legacyTitle}</span>
              <span className="mt-0.5 block text-body-sm text-ink-body">{COPY.legacyHint}</span>
            </span>
          </label>
        ) : null}

        <FormCard legend="Surat">
          {mode === "register" && legacy ? (
            <div className="flex flex-col gap-2">
              <TextField
                id={fieldId("legacyNumber")}
                label="Nomor lama (wajib)"
                value={legacyNumber}
                maxLength={LETTER_LIMITS.legacyNumber}
                autoComplete="off"
                spellCheck={false}
                readOnly={busy}
                invalid={Boolean(errors.legacyNumber)}
                aria-describedby={errors.legacyNumber ? `${fieldId("legacyNumber")}-error` : undefined}
                onChange={(event) => {
                  setLegacyNumber(event.target.value);
                  setErrors((prev) => ({ ...prev, legacyNumber: undefined }));
                }}
              />
              {errors.legacyNumber ? <FieldError id={`${fieldId("legacyNumber")}-error`}>{errors.legacyNumber}</FieldError> : null}
              <AlertMessage tone="info">{COPY.legacyInfo}</AlertMessage>
            </div>
          ) : null}

          {type === "incoming" ? (
            <DateField
              id={fieldId("receivedDate")}
              label="Tanggal diterima (wajib)"
              max={today}
              value={values.receivedDate}
              readOnly={busy}
              error={errors.receivedDate}
              onChange={(event) => set("receivedDate", event.target.value)}
            />
          ) : (
            <DateField
              id={fieldId("letterDate")}
              label="Tanggal surat (wajib)"
              max={today}
              value={values.letterDate}
              readOnly={busy}
              error={errors.letterDate}
              onChange={(event) => set("letterDate", event.target.value)}
            />
          )}
          <div className="flex flex-col gap-1.5">
            <TextField
              id={fieldId("counterpart")}
              label={`${LETTER_COUNTERPART_LABEL[type]} (wajib)`}
              value={values.counterpart}
              maxLength={LETTER_LIMITS.counterpart}
              autoComplete="off"
              readOnly={busy}
              invalid={Boolean(errors.counterpart)}
              aria-describedby={errors.counterpart ? `${fieldId("counterpart")}-error` : undefined}
              onChange={(event) => set("counterpart", event.target.value)}
            />
            {errors.counterpart ? <FieldError id={`${fieldId("counterpart")}-error`}>{errors.counterpart}</FieldError> : null}
          </div>
          <TextareaField
            id={fieldId("subject")}
            label="Perihal (wajib)"
            value={values.subject}
            maxLength={LETTER_LIMITS.subject}
            readOnly={busy}
            error={errors.subject}
            onChange={(event) => set("subject", event.target.value)}
          />
          {type === "incoming" ? (
            <>
              <DateField
                id={fieldId("letterDate")}
                label="Tanggal surat (boleh kosong)"
                max={today}
                value={values.letterDate}
                readOnly={busy}
                error={errors.letterDate}
                onChange={(event) => set("letterDate", event.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <TextField
                  id={fieldId("counterpartNumber")}
                  label="Nomor surat dari pengirim (boleh kosong)"
                  value={values.counterpartNumber}
                  maxLength={LETTER_LIMITS.counterpartNumber}
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={busy}
                  invalid={Boolean(errors.counterpartNumber)}
                  aria-describedby={errors.counterpartNumber ? `${fieldId("counterpartNumber")}-error` : undefined}
                  onChange={(event) => set("counterpartNumber", event.target.value)}
                />
                {errors.counterpartNumber ? (
                  <FieldError id={`${fieldId("counterpartNumber")}-error`}>{errors.counterpartNumber}</FieldError>
                ) : null}
              </div>
            </>
          ) : null}
          <TextareaField
            id={fieldId("notes")}
            label="Catatan (boleh kosong)"
            value={values.notes}
            maxLength={LETTER_LIMITS.notes}
            readOnly={busy}
            error={errors.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </FormCard>

        {mode === "register" ? (
          <div className="rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
            <FilePicker
              id={fieldId("files")}
              label="Berkas (boleh kosong, maksimal 3)"
              action="uploadLetterFile"
              onChange={(summary) => {
                setFiles(summary);
                setUnder(null);
              }}
              error={errors.files ?? null}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : "nx-press")}>
            {busy ? <Spinner /> : null}
            {busy ? "Menyimpan..." : mode === "register" ? "Simpan Surat" : "Simpan Perubahan"}
          </button>
          {under ? (
            <p role="status" className="text-center text-body-sm text-ink-body">
              {under}
            </p>
          ) : null}
          <button type="button" onClick={leave} className={buttonClass("text", "self-center")}>
            Batal
          </button>
        </div>
      </form>

      <Sheet
        open={checkOpen}
        onOpenChange={setCheckOpen}
        title={COPY.legacyCheckTitle}
        description={
          <>
            Nomor yang kamu tulis: <strong className="font-bold text-ink tabular-nums">{legacyNumber.trim()}</strong>. Nomor ini tidak
            bisa diubah setelah disimpan.
          </>
        }
        footer={
          <>
            <button type="button" onClick={save} className={buttonClass("primary")}>
              Simpan Surat
            </button>
            <button type="button" onClick={() => setCheckOpen(false)} className={buttonClass("text", "self-center")}>
              Periksa lagi
            </button>
          </>
        }
      />
      <DiscardSheet open={discardOpen} onOpenChange={setDiscardOpen} onDiscard={() => router.push(cancelHref)} />
    </>
  );
}

function isFieldKey(field: string): field is FieldKey {
  return ["legacyNumber", "receivedDate", "letterDate", "counterpart", "subject", "counterpartNumber", "notes", "files"].includes(field);
}

/** The first card: where the number comes from (design 7.1, 7.2) or the number itself (7.3). */
function NumberCard({
  mode,
  type,
  legacy,
  numberText,
  canReadNumbering,
}: {
  mode: "register" | "edit";
  type: LetterType;
  legacy: boolean;
  numberText?: string;
  canReadNumbering: boolean;
}) {
  if (mode === "edit" && numberText) {
    return (
      <section aria-labelledby="letter-number-title" className="rounded-xl border border-gold-tint-line bg-gold-tint px-4 py-3.5">
        <h2 id="letter-number-title" className="text-body-sm text-ink-body">
          {COPY.plateLabel}
        </h2>
        <p className="text-numeric-metric break-words text-ink">
          <NumberText value={numberText} />
        </p>
        <p className="mt-1 text-body-sm text-ink-body">{COPY.numberLocked}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="letter-number-title" className="rounded-xl border border-gold-tint-line bg-gold-tint px-4 py-3.5 text-walnut">
      <h2 id="letter-number-title" className="text-label-lg">
        {COPY.plateLabel}
      </h2>
      <p className="mt-0.5 text-body-md">
        {legacy ? COPY.numberLegacyFirstCard : type === "incoming" ? COPY.numberAutoIncoming : COPY.numberAutoOutgoing}{" "}
        {!legacy && canReadNumbering ? (
          <Link href={NUMBERING_PATH} className="underline underline-offset-2">
            {COPY.numberSettingsLink}
          </Link>
        ) : null}
      </p>
    </section>
  );
}
