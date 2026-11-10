"use client";

import { useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { FieldError } from "@/components/ui/field-error";
import { DateField, TextareaField } from "@/components/ui/form-fields";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import {
  LETTER_FIELD_ERROR_COPY,
  LETTER_LIMITS,
  letterErrorMessage,
  type LetterError,
  type LetterRequestDetail,
  type LetterRequestLinkedLetter,
} from "../types";
import { DiscardSheet, FormCard, FormSummary, goToLogin, useLetterAction, type ActionError } from "./action-sheet";
import { RequestChips } from "./chips";
import { COPY } from "./copy";
import { EMPTY_FILES, FilePicker, type FileSummary } from "./file-picker";
import { NumberPlate } from "./letter-number";
import { requestHref } from "./routes";
import { issueRequest } from "./server-actions";

type FieldKey = "subject" | "addressee" | "letterDate" | "note" | "files";
type FieldErrors = Partial<Record<FieldKey, string>>;
const ORDER: FieldKey[] = ["subject", "addressee", "letterDate", "note", "files"];
const fieldId = (key: FieldKey) => `issue-${key}`;

/**
 * "Terbitkan surat" (design 12.3-12.8): the number was taken earlier and is read-only on the plate; the
 * fields edit the register row that already exists (prefilled from its CURRENT values, contract), and
 * 1 to 3 final files are attached. A check sheet comes first (P7). A failure saves nothing and the
 * number stays with this request.
 */
export function IssueForm({
  detail,
  letter,
  today,
  activePeriodLabel,
}: {
  detail: LetterRequestDetail;
  letter: LetterRequestLinkedLetter;
  today: string;
  activePeriodLabel: string | null;
}) {
  const { router, busy, run, busyRef } = useLetterAction();
  const summaryRef = useRef<HTMLDivElement>(null);
  const initial = {
    subject: letter.subject,
    addressee: letter.counterpart,
    letterDate: letter.letterDate && letter.letterDate <= today ? letter.letterDate : today,
    note: "",
  };
  const [values, setValues] = useState(initial);
  const [files, setFiles] = useState<FileSummary>(EMPTY_FILES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<FieldKey[] | null>(null);
  const [top, setTop] = useState<ActionError | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const back = requestHref(detail.requestId);
  const dirty = files.count > 0 || JSON.stringify(values) !== JSON.stringify(initial);

  function set<K extends keyof typeof initial>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    setUnder(null);
  }

  function leave() {
    if (busyRef.current) return;
    if (dirty) setDiscardOpen(true);
    else router.push(back);
  }

  function validate(): FieldErrors {
    const copy = LETTER_FIELD_ERROR_COPY.issue;
    const next: FieldErrors = {};
    if (values.subject.trim() === "") next.subject = copy.subject?.text_required;
    if (values.addressee.trim() === "") next.addressee = copy.addressee?.text_required;
    if (values.letterDate === "") next.letterDate = copy.letterDate?.date_required;
    else if (values.letterDate > today) next.letterDate = copy.letterDate?.date_in_future;
    if (!files.pending && files.files.length === 0) next.files = COPY.fileRequired;
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
    setCheckOpen(true);
  }

  function save() {
    setCheckOpen(false);
    void run(
      () =>
        issueRequest({
          requestId: detail.requestId,
          version: detail.version,
          letterVersion: letter.version,
          subject: values.subject,
          addressee: values.addressee,
          letterDate: values.letterDate,
          note: values.note,
          files: files.files,
        }),
      {
        onOk: () => {
          router.push(requestHref(detail.requestId, "issued"), { scroll: true });
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
    const text = letterErrorMessage(error, "issue") ?? COPY.unavailable;
    if ("field" in error && (ORDER as string[]).includes(error.field)) {
      showErrors({ [error.field as FieldKey]: text });
      return null;
    }
    const reload = ["state_changed", "not_found", "number_not_taken"].includes(error.code);
    setTop({ text, reload });
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
        Permohonan
      </button>
      <h1 className="font-heading text-display-sm text-title">{COPY.issueTitle}</h1>

      {!detail.isActivePeriod ? (
        <AlertMessage role="status" tone="info">
          Permohonan ini dari periode {detail.periodLabel ?? "sebelumnya"}.
          {activePeriodLabel ? ` Suratnya dicatat di periode aktif ${activePeriodLabel}.` : ""}
        </AlertMessage>
      ) : null}

      <div className="flex flex-col gap-1.5 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <p className="min-w-0 text-headline-sm break-words text-ink">{detail.requesterName ?? "-"}</p>
          <RequestChips source={detail} />
        </div>
        <p className="text-body-md break-words text-ink-body">{detail.subject}</p>
      </div>

      <NumberPlate numberText={letter.numberText} note={COPY.issuePlateNote} copy />

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        <FormSummary ref={summaryRef} problems={problems} message={top} onReload={() => router.refresh()} />

        <FormCard legend="Isi surat">
          <TextareaField
            id={fieldId("subject")}
            label="Perihal (wajib)"
            rows={2}
            value={values.subject}
            maxLength={LETTER_LIMITS.subject}
            readOnly={busy}
            error={errors.subject}
            onChange={(event) => set("subject", event.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <TextField
              id={fieldId("addressee")}
              label="Ditujukan kepada (wajib)"
              value={values.addressee}
              maxLength={LETTER_LIMITS.addressee}
              autoComplete="off"
              readOnly={busy}
              invalid={Boolean(errors.addressee)}
              aria-describedby={errors.addressee ? `${fieldId("addressee")}-error` : undefined}
              onChange={(event) => set("addressee", event.target.value)}
            />
            {errors.addressee ? <FieldError id={`${fieldId("addressee")}-error`}>{errors.addressee}</FieldError> : null}
          </div>
          <DateField
            id={fieldId("letterDate")}
            label="Tanggal surat (wajib)"
            max={today}
            value={values.letterDate}
            readOnly={busy}
            error={errors.letterDate}
            onChange={(event) => set("letterDate", event.target.value)}
          />
          <TextareaField
            id={fieldId("note")}
            label="Catatan untuk pemohon (boleh kosong)"
            value={values.note}
            maxLength={LETTER_LIMITS.note}
            readOnly={busy}
            error={errors.note}
            onChange={(event) => set("note", event.target.value)}
          />
        </FormCard>

        <div className="rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
          <FilePicker
            id={fieldId("files")}
            label="Berkas surat (wajib, 1 sampai 3)"
            action="uploadLetterFile"
            onChange={(next) => {
              setFiles(next);
              setUnder(null);
              if (next.files.length > 0) setErrors((prev) => ({ ...prev, files: undefined }));
            }}
            error={errors.files ?? null}
          />
        </div>

        <div className="flex flex-col gap-2">
          <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : "nx-press")}>
            {busy ? <Spinner /> : null}
            {busy ? "Menerbitkan..." : "Terbitkan Surat"}
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
        title={COPY.issueCheckTitle}
        description={
          <>
            Berkas final dipasang pada nomor <strong className="font-bold text-ink tabular-nums">{letter.numberText}</strong>. Pemohon bisa
            mengunduhnya begitu suratnya terbit.
          </>
        }
        footer={
          <>
            <button type="button" onClick={save} className={buttonClass("primary")}>
              Terbitkan surat
            </button>
            <button type="button" onClick={() => setCheckOpen(false)} className={buttonClass("text", "self-center")}>
              Periksa lagi
            </button>
          </>
        }
      />
      <DiscardSheet open={discardOpen} onOpenChange={setDiscardOpen} onDiscard={() => router.push(back)} />
    </>
  );
}
