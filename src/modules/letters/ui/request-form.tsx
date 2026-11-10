"use client";

import { useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { describedBy, FieldError } from "@/components/ui/field-error";
import { fieldHintClass } from "@/components/ui/field-styles";
import { DateField, TextareaField } from "@/components/ui/form-fields";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { TextField } from "@/components/ui/text-field";
import {
  LETTER_FIELD_ERROR_COPY,
  LETTER_LIMITS,
  letterErrorMessage,
  type LetterError,
  type LetterRequestCaps,
} from "../types";
import { DiscardSheet, FormCard, FormSummary, goToLogin, useLetterAction, type ActionError } from "./action-sheet";
import { COPY } from "./copy";
import { EMPTY_FILES, FilePicker, type FileSummary } from "./file-picker";
import { requestHref } from "./routes";
import { submitRequest } from "./server-actions";

type FieldKey = "subject" | "addressee" | "purpose" | "onBehalfOf" | "neededBy" | "files";
type FieldErrors = Partial<Record<FieldKey, string>>;
const ORDER: FieldKey[] = ["subject", "addressee", "purpose", "onBehalfOf", "neededBy", "files"];
const fieldId = (key: FieldKey) => `request-${key}`;
const hintId = (key: FieldKey) => `${fieldId(key)}-hint`;

export type RequestFormValues = { subject: string; addressee: string; purpose: string; onBehalfOf: string; neededBy: string };

/**
 * "Ajukan Surat" (design screen 6, section 9): three required fields and a few optional ones, each with
 * a plain hint that says what the secretary needs (K6). The requester and the period are set by the
 * server, never sent. A cap that is already reached shows above the form and again on submit (3.4).
 */
export function RequestForm({
  initial,
  prefilled,
  today,
  caps,
  cancelHref,
}: {
  initial: RequestFormValues;
  /** "Ajukan lagi" (P14): filled from an earlier request; attachments are not copied (G15). */
  prefilled: boolean;
  today: string;
  caps: LetterRequestCaps | null;
  cancelHref: string;
}) {
  const { router, busy, run, busyRef } = useLetterAction();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<RequestFormValues>(initial);
  const [files, setFiles] = useState<FileSummary>(EMPTY_FILES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<FieldKey[] | null>(null);
  const [top, setTop] = useState<ActionError | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const capText = capMessage(caps);
  const dirty = files.count > 0 || JSON.stringify(values) !== JSON.stringify(initial);

  function set<K extends keyof RequestFormValues>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    setUnder(null);
  }

  function leave() {
    if (busyRef.current) return;
    if (dirty) setDiscardOpen(true);
    else router.push(cancelHref);
  }

  function validate(): FieldErrors {
    const copy = LETTER_FIELD_ERROR_COPY.request;
    const next: FieldErrors = {};
    if (values.subject.trim() === "") next.subject = copy.subject?.text_required;
    if (values.addressee.trim() === "") next.addressee = copy.addressee?.text_required;
    if (values.purpose.trim() === "") next.purpose = copy.purpose?.text_required;
    if (values.neededBy !== "" && values.neededBy < today) next.neededBy = copy.neededBy?.date_in_past;
    return next;
  }

  function showErrors(next: FieldErrors) {
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
    if (files.pending) {
      setUnder(COPY.fileStillBusy);
      return;
    }
    // A file that did not upload is never dropped silently: the person retries or removes it (9.4).
    if (files.failed) {
      setUnder(COPY.fileFailed);
      return;
    }
    void run(
      () =>
        submitRequest({
          subject: values.subject,
          addressee: values.addressee,
          purpose: values.purpose,
          onBehalfOf: values.onBehalfOf,
          neededBy: values.neededBy,
          files: files.files,
        }),
      {
        onOk: (data) => router.push(requestHref(data.requestId, "sent"), { scroll: true }),
        onError: handleError,
      },
    );
  }

  function handleError(error: LetterError): null {
    if (error.code === "unauthenticated") {
      goToLogin(router);
      return null;
    }
    const text = letterErrorMessage(error, "submitRequest") ?? COPY.unavailable;
    if ("field" in error && (ORDER as string[]).includes(error.field)) {
      showErrors({ [error.field as FieldKey]: text });
      return null;
    }
    setTop({ text });
    requestAnimationFrame(() => summaryRef.current?.focus());
    return null;
  }

  const problems = (summary ?? []).flatMap((key) => (errors[key] ? [{ id: fieldId(key), text: errors[key] as string }] : []));

  return (
    <>
      <button
        type="button"
        onClick={leave}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
      >
        <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
        Kembali
      </button>
      <h1 className="font-heading text-display-sm text-title">Ajukan Surat</h1>

      <AlertMessage tone="info">{COPY.requestFormInfo}</AlertMessage>
      {prefilled ? (
        <AlertMessage role="status" tone="info">
          {COPY.againInfo}
        </AlertMessage>
      ) : null}
      {capText ? (
        <AlertMessage role="status" tone="warning">
          {capText}
        </AlertMessage>
      ) : null}

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        <FormSummary ref={summaryRef} problems={problems} message={top} />

        <FormCard legend="Isi surat">
          <TextareaField
            id={fieldId("subject")}
            label="Perihal (wajib)"
            rows={2}
            value={values.subject}
            maxLength={LETTER_LIMITS.subject}
            readOnly={busy}
            hint={COPY.subjectHint}
            error={errors.subject}
            onChange={(event) => set("subject", event.target.value)}
          />
          <HintedTextField
            id={fieldId("addressee")}
            label="Ditujukan kepada (wajib)"
            value={values.addressee}
            max={LETTER_LIMITS.addressee}
            hint={COPY.addresseeHint}
            error={errors.addressee}
            busy={busy}
            onChange={(value) => set("addressee", value)}
            hintElementId={hintId("addressee")}
          />
          <TextareaField
            id={fieldId("purpose")}
            label="Keperluan (wajib)"
            rows={4}
            className="[&_textarea]:max-h-56 [&_textarea]:min-h-[7.5rem]"
            value={values.purpose}
            maxLength={LETTER_LIMITS.purpose}
            readOnly={busy}
            hint={COPY.purposeHint}
            error={errors.purpose}
            onChange={(event) => set("purpose", event.target.value)}
          />
        </FormCard>

        <FormCard legend="Tambahan">
          <HintedTextField
            id={fieldId("onBehalfOf")}
            label="Atas nama (boleh kosong)"
            value={values.onBehalfOf}
            max={LETTER_LIMITS.onBehalfOf}
            hint={COPY.onBehalfHint}
            error={errors.onBehalfOf}
            busy={busy}
            onChange={(value) => set("onBehalfOf", value)}
            hintElementId={hintId("onBehalfOf")}
          />
          <DateField
            id={fieldId("neededBy")}
            label="Dibutuhkan paling lambat (boleh kosong)"
            min={today}
            value={values.neededBy}
            readOnly={busy}
            hint={COPY.neededByHint}
            error={errors.neededBy}
            onChange={(event) => set("neededBy", event.target.value)}
          />
        </FormCard>

        <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
          <legend className="float-left w-full text-headline-sm text-ink">Lampiran</legend>
          <FilePicker
            id={fieldId("files")}
            label="Berkas (boleh kosong, maksimal 3)"
            hint={COPY.attachmentsHint}
            action="uploadRequestFile"
            onChange={(next) => {
              setFiles(next);
              setUnder(null);
            }}
            error={errors.files ?? null}
          />
        </fieldset>

        <div className="flex flex-col gap-2">
          <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : "nx-press")}>
            {busy ? <Spinner /> : null}
            {busy ? "Mengirim..." : "Ajukan Surat"}
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

      <DiscardSheet open={discardOpen} onOpenChange={setDiscardOpen} onDiscard={() => router.push(cancelHref)} />
    </>
  );
}

/** TextField with a hint line and an error line, both read with the field (design 9.5). */
function HintedTextField({
  id,
  label,
  value,
  max,
  hint,
  error,
  busy,
  onChange,
  hintElementId,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  hint: string;
  error?: string;
  busy: boolean;
  onChange: (value: string) => void;
  hintElementId: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <TextField
        id={id}
        label={label}
        value={value}
        maxLength={max}
        autoComplete="off"
        readOnly={busy}
        invalid={Boolean(error)}
        aria-describedby={describedBy(hintElementId, error && `${id}-error`)}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={hintElementId} className={fieldHintClass}>
        {hint}
      </p>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

/** The cap that is already reached (design 3.4): the open cap first, then the daily cap. */
function capMessage(caps: LetterRequestCaps | null): string | null {
  if (!caps || !caps.hasActivePeriod) return null;
  if (caps.openCount >= caps.openLimit) {
    return letterErrorMessage({ code: "too_many_open_requests", limit: caps.openLimit }, "submitRequest");
  }
  if (caps.todayCount >= caps.dailyLimit) {
    return letterErrorMessage({ code: "daily_request_limit", limit: caps.dailyLimit }, "submitRequest");
  }
  return null;
}
