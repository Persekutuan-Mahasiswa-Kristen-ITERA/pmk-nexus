"use client";

import { useEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { CalendarDays, ChevronLeft, NotebookPen, Paperclip } from "lucide-react";
import { AlertMessage } from "@/components/ui/alert-message";
import { describedBy, FieldError } from "@/components/ui/field-error";
import { fieldBoxClass, fieldHintClass, fieldLabelClass } from "@/components/ui/field-styles";
import { DateField, SelectField } from "@/components/ui/form-fields";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import {
  formatMinuteCopy,
  isOutsideMinutePeriod,
  isValidMinuteDate,
  MINUTE_COPY,
  MINUTE_ERROR_COPY,
  MINUTE_LIMITS,
  minuteErrorMessage,
  minuteUnitLabel,
  type MinuteError,
  type MinuteUnitOption,
} from "../types";
import { goToLogin, useMinuteAction, type ActionError } from "./action-sheet";
import { UI_COPY } from "./copy";
import { EMPTY_FILES, FilePicker, type FileSummary } from "./file-picker";
import { minuteHref } from "./routes";
import { recordMinute, updateMinute } from "./server-actions";

const F = MINUTE_COPY.form;

type FieldKey = "unitId" | "meetingDate" | "title" | "topic" | "content" | "decision" | "files";
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Field order on screen, for focusing the first problem. */
const ORDER: FieldKey[] = ["unitId", "meetingDate", "title", "topic", "content", "decision", "files"];
const fieldId = (key: FieldKey) => `minute-${key}`;

export type MinuteFormValues = { meetingDate: string; title: string; topic: string; content: string; decision: string };

/** The active period's dates for the soft warning of R9 (no block). */
export type PeriodDates = { label: string | null; startsOn: string | null; endsOn: string | null };

type Props = {
  initial: MinuteFormValues;
  /** Jakarta date: the meeting date may not be after it. */
  today: string;
  period: PeriodDates | null;
  /** Where "Kembali ke daftar" and "Batal" go. */
  cancelHref: string;
} & (
  | { mode: "record"; units: MinuteUnitOption[] }
  | { mode: "edit"; minuteId: string; version: number; unitLabel: string }
);

/**
 * "Catat Notulensi" and "Ubah Notulensi" (spec 7 screens 3 and 4, Stitch 08 adapted). Record: the unit
 * is a select limited to the units this person may write for, or a read-only line with "Sesuai
 * jabatanmu." when there is one; attachments are optional. Edit: unit and period are fixed (A-MN4), files
 * are managed on the detail. The server validates again; the save button is never greyed, a refusal is a
 * message next to the problem. Leaving with unsaved typing asks first (A-MN11).
 */
export function MinuteForm(props: Props) {
  const { initial, today, period, cancelHref, mode } = props;
  const { router, busy, run, busyRef } = useMinuteAction();
  const topRef = useRef<HTMLDivElement>(null);
  const recordUnits = mode === "record" ? props.units : [];
  const [unitId, setUnitId] = useState(recordUnits.length === 1 ? recordUnits[0].unitId : "");
  const [values, setValues] = useState<MinuteFormValues>(initial);
  const [files, setFiles] = useState<FileSummary>(EMPTY_FILES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [top, setTop] = useState<ActionError | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const saved = useRef(false);

  const dirty =
    files.count > 0 ||
    (mode === "record" && recordUnits.length > 1 && unitId !== "") ||
    JSON.stringify(values) !== JSON.stringify(initial);

  // A reload, a closed tab or a typed address with unsaved typing: the browser asks first (A-MN11).
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (saved.current) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function set<K extends keyof MinuteFormValues>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    setUnder(null);
  }

  function leave() {
    if (busyRef.current) return;
    if (dirty) setLeaveOpen(true);
    else router.push(cancelHref);
  }

  function text(error: MinuteError): string {
    return minuteErrorMessage(error, mode === "record" ? "record" : "edit") ?? MINUTE_COPY.unavailable;
  }

  // ---- Validation (the same rules the server applies; the server stays the judge) ----

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (mode === "record" && unitId === "") next.unitId = MINUTE_ERROR_COPY.unit_required ?? undefined;
    if (values.meetingDate === "") next.meetingDate = text({ code: "date_required", field: "meetingDate" });
    else if (!isValidMinuteDate(values.meetingDate)) next.meetingDate = text({ code: "invalid_dates", field: "meetingDate" });
    else if (values.meetingDate > today) next.meetingDate = text({ code: "date_in_future", field: "meetingDate" });
    if (values.title.trim() === "") next.title = text({ code: "text_required", field: "title" });
    if (values.topic.trim() === "") next.topic = text({ code: "text_required", field: "topic" });
    if (values.content.trim() === "") next.content = text({ code: "text_required", field: "content" });
    return next;
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
    if (files.pending) {
      setUnder(UI_COPY.fileStillBusy);
      return;
    }
    // A file that did not upload is never dropped silently: the person retries or removes it.
    if (files.failed) {
      setUnder(minuteErrorMessage({ code: "unavailable" }, "upload"));
      return;
    }
    const fields = {
      meetingDate: values.meetingDate,
      title: values.title,
      topic: values.topic,
      content: values.content,
      decision: values.decision,
    };
    if (mode === "record") {
      void run(() => recordMinute({ unitId, ...fields, files: files.files }), {
        onOk: (data) => {
          saved.current = true;
          router.push(minuteHref(data.minuteId, "recorded"), { scroll: true });
        },
        onError: handleError,
      });
      return;
    }
    const { minuteId, version } = props;
    void run(() => updateMinute({ minuteId, version, ...fields }), {
      onOk: (data) => {
        if (!data.changed) {
          setUnder(F.unchanged);
          return;
        }
        saved.current = true;
        router.push(minuteHref(minuteId, "updated"), { scroll: true });
        router.refresh();
      },
      onError: handleError,
    });
  }

  function handleError(error: MinuteError): null {
    if (error.code === "unauthenticated") {
      goToLogin(router);
      return null;
    }
    if (error.code === "unit_not_allowed" || error.code === "invalid_unit" || error.code === "unit_required") {
      showErrors({ unitId: text(error) });
      return null;
    }
    if ("field" in error && isFieldKey(error.field)) {
      showErrors({ [error.field]: text(error) });
      return null;
    }
    const reload = ["state_changed", "minute_voided", "closed_period", "not_found", "no_active_period"].includes(error.code);
    setTop({ text: text(error), reload });
    requestAnimationFrame(() => topRef.current?.focus());
    return null;
  }

  const outside =
    period !== null && values.meetingDate !== "" && isOutsideMinutePeriod(values.meetingDate, period.startsOn, period.endsOn);

  return (
    <>
      <button
        type="button"
        onClick={leave}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
      >
        <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
        {mode === "record" ? F.back : UI_COPY.backToMinute}
      </button>
      <div className="nx-rise flex flex-col gap-1">
        <h1 className="font-heading text-display-sm text-title">{mode === "record" ? F.recordTitle : F.editTitle}</h1>
        <p className="text-body-md text-ink-body">{F.subtitle}</p>
      </div>

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
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

        <FormCard legend={F.meetingCard} icon={<CalendarDays strokeWidth={2} />} className="nx-rise nx-delay-1">
          {mode === "record" ? (
            <UnitField units={recordUnits} value={unitId} busy={busy} error={errors.unitId} onChange={(id) => {
              setUnitId(id);
              setErrors((prev) => ({ ...prev, unitId: undefined }));
            }} />
          ) : (
            <ReadOnlyLine label={F.unit} value={props.unitLabel} />
          )}

          <div className="flex flex-col gap-2">
            <DateField
              id={fieldId("meetingDate")}
              label={F.meetingDate}
              max={today}
              min={MINUTE_LIMITS.minDate}
              value={values.meetingDate}
              readOnly={busy}
              error={errors.meetingDate}
              onChange={(event) => set("meetingDate", event.target.value)}
            />
            {outside && !errors.meetingDate ? (
              <AlertMessage role="status" tone="info" icon="schedule">
                {formatMinuteCopy(F.outsidePeriod, { periode: period?.label ?? "" })}
              </AlertMessage>
            ) : null}
          </div>

          <LineField
            id={fieldId("title")}
            label={F.title}
            placeholder={F.titlePlaceholder}
            maxLength={MINUTE_LIMITS.title}
            value={values.title}
            busy={busy}
            error={errors.title}
            onChange={(value) => set("title", value)}
          />
          <LineField
            id={fieldId("topic")}
            label={F.topic}
            placeholder={F.topicPlaceholder}
            maxLength={MINUTE_LIMITS.topic}
            value={values.topic}
            busy={busy}
            error={errors.topic}
            onChange={(value) => set("topic", value)}
          />
        </FormCard>

        <FormCard legend={F.resultCard} icon={<NotebookPen strokeWidth={2} />} className="nx-rise nx-delay-2">
          <LongTextField
            id={fieldId("content")}
            label={F.content}
            placeholder={F.contentPlaceholder}
            rows={5}
            maxLength={MINUTE_LIMITS.content}
            value={values.content}
            readOnly={busy}
            error={errors.content}
            onChange={(event) => set("content", event.target.value)}
            className="min-h-[8.75rem] max-h-[60vh]"
          />
          <LongTextField
            id={fieldId("decision")}
            label={F.decision}
            rows={4}
            maxLength={MINUTE_LIMITS.decision}
            value={values.decision}
            readOnly={busy}
            error={errors.decision}
            onChange={(event) => set("decision", event.target.value)}
            className="min-h-[7.25rem] max-h-80"
          />
        </FormCard>

        {mode === "record" ? (
          <FormCard legend={F.filesCard} icon={<Paperclip strokeWidth={2} />} className="nx-rise nx-delay-3">
            <FilePicker
              id={fieldId("files")}
              disabled={busy}
              onChange={(summary) => {
                setFiles(summary);
                setUnder(null);
                if (errors.files) setErrors((prev) => ({ ...prev, files: undefined }));
              }}
              error={errors.files ?? null}
            />
          </FormCard>
        ) : null}

        <div className="flex flex-col gap-2 pt-1">
          <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : "nx-press")}>
            {busy ? <Spinner /> : null}
            {busy ? UI_COPY.saving : mode === "record" ? F.submitRecord : F.submitEdit}
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
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={F.leaveTitle}
        description={F.leaveBody}
        footer={
          <>
            <button type="button" onClick={() => setLeaveOpen(false)} className={buttonClass("primary")}>
              {F.leaveStay}
            </button>
            <button
              type="button"
              onClick={() => {
                saved.current = true;
                router.push(cancelHref);
              }}
              className={buttonClass("text", "self-center")}
            >
              {F.leaveGo}
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

/** A fieldset drawn as a card, its legend as the card title with a small walnut icon (Stitch 08 cards). */
function FormCard({ legend, icon, className, children }: { legend: string; icon: ReactNode; className?: string; children: ReactNode }) {
  return (
    <fieldset
      className={`flex min-w-0 flex-col gap-4 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1 md:p-5 ${className ?? ""}`}
    >
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

/** The unit: a select when there are several, a read-only line with "Sesuai jabatanmu." when there is one. */
function UnitField({
  units,
  value,
  busy,
  error,
  onChange,
}: {
  units: MinuteUnitOption[];
  value: string;
  busy: boolean;
  error?: string;
  onChange: (unitId: string) => void;
}) {
  if (units.length === 1) {
    return (
      <div className="flex flex-col gap-1.5">
        <ReadOnlyLine label={F.unit} value={minuteUnitLabel(units[0])} hint={F.unitHint} id={fieldId("unitId")} />
        {error ? <FieldError id={`${fieldId("unitId")}-error`}>{error}</FieldError> : null}
      </div>
    );
  }
  return (
    <SelectField
      id={fieldId("unitId")}
      label={F.unit}
      value={value}
      disabled={busy}
      error={error}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        {UI_COPY.unitPlaceholder}
      </option>
      {units.map((unit) => (
        <option key={unit.unitId} value={unit.unitId}>
          {minuteUnitLabel(unit)}
        </option>
      ))}
    </SelectField>
  );
}

/** A value that cannot be changed here: label above, the value in a quiet ivory box, an optional hint. */
function ReadOnlyLine({ label, value, hint, id }: { label: string; value: string; hint?: string; id?: string }) {
  const hintId = id && hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <p className={fieldLabelClass}>{label}</p>
      <p
        id={id}
        tabIndex={id ? -1 : undefined}
        aria-describedby={hintId}
        className="flex min-h-12 items-center rounded-lg border border-surface-line bg-ivory/60 px-3 text-field break-words text-ink"
      >
        {value}
      </p>
      {hint ? (
        <p id={hintId} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** TextField with its error under it (one-line fields: title, topic). */
function LineField({
  id,
  label,
  placeholder,
  maxLength,
  value,
  busy,
  error,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  maxLength: number;
  value: string;
  busy: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <TextField
        id={id}
        label={label}
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        autoComplete="off"
        readOnly={busy}
        invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

/**
 * A long text box (content, decision): the NEXUS field box, `rows` tall at first, growing with the text
 * where the browser supports field-sizing, then scrolling inside. Line breaks are kept (R10).
 */
function LongTextField({
  id,
  label,
  error,
  className,
  ...props
}: { id: string; label: string; error?: string; className: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error ? errorId : null)}
        className={fieldBoxClass({ invalid: Boolean(error), className: `resize-none px-3 py-2.5 leading-relaxed field-sizing-content ${className}` })}
        {...props}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
