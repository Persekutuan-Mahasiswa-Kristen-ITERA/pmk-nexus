"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CircleAlert, CircleCheck, Info, LoaderCircle, Plus, TriangleAlert } from "lucide-react";
import { submitRequest } from "../server/borrowing-actions";
import { AlertMessage } from "@/components/ui/alert-message";
import { DateField, TextareaField } from "@/components/ui/form-fields";
import { describedBy, FieldError } from "@/components/ui/field-error";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/utils";
import {
  INVENTORY_ERROR_COPY,
  INVENTORY_LIMITS,
  inventoryErrorMessage,
  maxRequestEndDate,
  rangeDays,
  type BulkAvailabilityQueryInput,
  type InventoryError,
  type InventoryResult,
  type ItemAvailability,
  type ItemMode,
} from "../types";
import { COPY, FIELD_ERRORS, fixCountText, onlyFreeText, tooLongText } from "./copy";
import { formatCount, formatRangeShort } from "./format";
import { ItemPicker, type PickerItem, type SearchItems } from "./item-picker";
import { requestHref } from "./routes";

export type FormLine = {
  itemId: string;
  name: string;
  code: string | null;
  mode: ItemMode;
  unitCount: number;
  quantity: number;
};

export type RequestFormInitial = {
  startDate: string;
  endDate: string;
  lines: FormLine[];
  purpose: string;
  note: string;
  outsideParty: { orgName: string; contactName: string } | null;
};

type CheckAvailability = (input: BulkAvailabilityQueryInput) => Promise<InventoryResult<ItemAvailability[]>>;

type FieldKey = "orgName" | "contactName" | "startDate" | "endDate" | "lines" | "purpose" | "note" | `qty:${string}`;
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Field ids, so the error summary can link to each field (design 3.4). */
const FIELD_ID: Record<Exclude<FieldKey, `qty:${string}`>, string> = {
  orgName: "req-org",
  contactName: "req-contact",
  startDate: "req-start",
  endDate: "req-end",
  lines: "req-add-item",
  purpose: "req-purpose",
  note: "req-note",
};
const FIELD_ORDER: Exclude<FieldKey, `qty:${string}`>[] = ["orgName", "contactName", "startDate", "endDate", "lines", "purpose", "note"];
const qtyId = (itemId: string) => `req-qty-${itemId}`;
const lineStatusId = (itemId: string) => `req-line-status-${itemId}`;

/** Wait after a date change before asking for availability (design 9.3: "short pause"). */
const AVAILABILITY_PAUSE_MS = 400;

type Availability =
  | { key: string; kind: "loading" }
  | { key: string; kind: "ok"; byItem: Map<string, ItemAvailability> }
  | { key: string; kind: "error" };

type TopMessage = { tone: "warning" | "error"; text: string };

/**
 * "Ajukan Peminjaman" (design screen 6, 9.1-9.6). Dates first, then items, so every line can say at
 * once whether the stock is there (K4). The availability lines are a preview; the server checks again
 * on submit (spec F3.4). "Untuk pihak luar" appears only with borrowing.handle (F10); the server and
 * the database refuse it for anyone else.
 */
export function RequestForm({
  initial,
  today,
  canRecordOutsideParty,
  cancelHref,
  checkAvailability,
  searchItems,
}: {
  initial: RequestFormInitial;
  today: string;
  canRecordOutsideParty: boolean;
  /** Where "Kembali" and "Batal" lead (catalog, the item, or the old request). */
  cancelHref: string;
  checkAvailability: CheckAvailability;
  searchItems: SearchItems;
}) {
  const router = useRouter();
  const busyRef = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focusAfterPick = useRef<string | null>(null);

  const [forOutside, setForOutside] = useState(canRecordOutsideParty && initial.outsideParty !== null);
  const [orgName, setOrgName] = useState(initial.outsideParty?.orgName ?? "");
  const [contactName, setContactName] = useState(initial.outsideParty?.contactName ?? "");
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [lines, setLines] = useState<FormLine[]>(initial.lines);
  const [purpose, setPurpose] = useState(initial.purpose);
  const [note, setNote] = useState(initial.note);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<FieldKey[] | null>(null);
  const [top, setTop] = useState<TopMessage | null>(null);
  const [changedItems, setChangedItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const datesValid = isValidRange(startDate, endDate, today);
  const itemIds = lines.map((l) => l.itemId);
  const availabilityKey = datesValid && itemIds.length > 0 ? `${startDate}|${endDate}|${[...itemIds].sort().join(",")}|${retryToken}` : null;

  // Live availability (design 9.3): one bulk call for all lines after a short pause.
  useEffect(() => {
    if (availabilityKey === null) return;
    let cancelled = false;
    const [from, to] = availabilityKey.split("|");
    const ids = availabilityKey.split("|")[2].split(",");
    const timer = setTimeout(async () => {
      setAvailability({ key: availabilityKey, kind: "loading" });
      try {
        const result = await checkAvailability({ itemIds: ids, from, to });
        if (cancelled) return;
        setAvailability(
          result.ok
            ? { key: availabilityKey, kind: "ok", byItem: new Map(result.data.map((a) => [a.itemId, a])) }
            : { key: availabilityKey, kind: "error" },
        );
      } catch {
        if (!cancelled) setAvailability({ key: availabilityKey, kind: "error" });
      }
    }, AVAILABILITY_PAUSE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [availabilityKey, checkAvailability]);

  const current = availability && availability.key === availabilityKey ? availability : null;

  function freeFor(itemId: string): ItemAvailability | null {
    return current?.kind === "ok" ? (current.byItem.get(itemId) ?? null) : null;
  }

  const dirty =
    JSON.stringify([forOutside, orgName, contactName, startDate, endDate, lines, purpose, note]) !==
    JSON.stringify([
      canRecordOutsideParty && initial.outsideParty !== null,
      initial.outsideParty?.orgName ?? "",
      initial.outsideParty?.contactName ?? "",
      initial.startDate,
      initial.endDate,
      initial.lines,
      initial.purpose,
      initial.note,
    ]);

  function leave() {
    if (busyRef.current) return;
    if (dirty) setDiscardOpen(true);
    else router.push(cancelHref);
  }

  function clearError(key: FieldKey) {
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  // ---- Validation (the same rules the server applies; the server stays the judge) ----

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (forOutside) {
      if (orgName.trim() === "") next.orgName = FIELD_ERRORS.orgMissing;
      if (contactName.trim() === "") next.contactName = FIELD_ERRORS.contactMissing;
    }
    if (startDate === "") next.startDate = FIELD_ERRORS.startMissing;
    else if (startDate < today) next.startDate = INVENTORY_ERROR_COPY.start_in_past ?? undefined;
    if (endDate === "") next.endDate = FIELD_ERRORS.endMissing;
    else if (startDate !== "" && endDate < startDate) next.endDate = INVENTORY_ERROR_COPY.invalid_dates ?? undefined;
    else if (startDate !== "" && endDate > maxRequestEndDate(startDate)) next.endDate = INVENTORY_ERROR_COPY.date_range_too_long ?? undefined;
    if (lines.length === 0) next.lines = FIELD_ERRORS.linesMissing;
    for (const line of lines) {
      const free = freeFor(line.itemId);
      if (free && free.freeQty > 0 && line.quantity > free.freeQty) next[`qty:${line.itemId}`] = onlyFreeText(free.freeQty);
    }
    if (purpose.trim() === "") next.purpose = FIELD_ERRORS.purposeMissing;
    return next;
  }

  function showErrors(next: FieldErrors) {
    setErrors(next);
    const keys = orderedKeys(next, lines);
    setSummary(keys);
    // Read the summary first; it links to every field (design 3.4).
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setTop(null);
    const found = validate();
    if (Object.values(found).some(Boolean)) {
      showErrors(found);
      return;
    }
    setErrors({});
    setSummary(null);
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await submitRequest({
        startDate,
        endDate,
        purpose,
        note,
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        outsideParty: forOutside ? { orgName, contactName } : null,
      });
      if (result.ok) {
        router.push(requestHref(result.data.reference, forOutside ? "sent_outside" : "sent"), { scroll: true });
        return;
      }
      handleServerError(result.error);
    } catch {
      setTop({ tone: "warning", text: COPY.network });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleServerError(error: InventoryError) {
    if (error.code === "unauthenticated") {
      const next = `${window.location.pathname}${window.location.search}`;
      router.push(`/login?reason=session_ended&next=${encodeURIComponent(next)}`);
      return;
    }
    const field = fieldErrorFor(error);
    if (field) {
      showErrors({ [field.key]: field.text });
      return;
    }
    if (error.code === "insufficient_stock" || error.code === "item_not_lendable") {
      // Keep every input, refresh the availability lines and mark the changed line (design 9.5).
      if (error.itemId) setChangedItems([error.itemId]);
      setRetryToken((n) => n + 1);
    }
    setTop({ tone: "warning", text: inventoryErrorMessage(error, "submitRequest") ?? COPY.unavailable });
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  // ---- Lines ----

  function addLine(item: PickerItem) {
    if (lines.some((l) => l.itemId === item.itemId)) return;
    setLines((prev) => [...prev, { itemId: item.itemId, name: item.name, code: item.code, mode: item.mode, unitCount: item.unitCount, quantity: 1 }]);
    clearError("lines");
    focusAfterPick.current = item.itemId;
    setPickerOpen(false);
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
    setChangedItems((prev) => prev.filter((id) => id !== itemId));
    clearError(`qty:${itemId}`);
  }

  function setQuantity(itemId: string, quantity: number) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)));
    clearError(`qty:${itemId}`);
  }

  const duration = datesValid ? rangeDays(startDate, endDate) : null;
  const rangeLabel = datesValid ? formatRangeShort(startDate, endDate, today) : "";
  const errorCount = summary?.length ?? 0;

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
      <h1 className="font-heading text-display-sm text-title">Ajukan Peminjaman</h1>

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        {summary && errorCount > 0 ? (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-danger">
            <CircleAlert aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
            <div className="text-body-md">
              <p>{fixCountText(errorCount)}</p>
              <ul className="mt-1 flex flex-col">
                {summary.map((key) => (
                  <li key={key}>
                    <a
                      href={`#${idForKey(key)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(idForKey(key))?.focus();
                      }}
                      className="inline-flex min-h-11 items-center underline underline-offset-2"
                    >
                      {errors[key]}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : top ? (
          <div ref={summaryRef} tabIndex={-1}>
            <AlertMessage role="alert" tone={top.tone}>
              {top.text}
            </AlertMessage>
          </div>
        ) : null}

        {canRecordOutsideParty ? (
          <FormCard legend="Untuk siapa">
            <div className="flex flex-col gap-2">
              <RadioRow name="req-for" checked={!forOutside} onChange={() => setForOutside(false)} label="Untuk saya" disabled={busy} />
              <RadioRow name="req-for" checked={forOutside} onChange={() => setForOutside(true)} label="Untuk pihak luar" disabled={busy} />
            </div>
          </FormCard>
        ) : null}

        {forOutside ? (
          <FormCard legend="Pihak peminjam">
            <TextField
              id={FIELD_ID.orgName}
              label="Nama organisasi (wajib)"
              value={orgName}
              maxLength={INVENTORY_LIMITS.outsidePartyName}
              autoComplete="organization"
              readOnly={busy}
              invalid={Boolean(errors.orgName)}
              aria-describedby={errors.orgName ? `${FIELD_ID.orgName}-error` : undefined}
              onChange={(event) => {
                setOrgName(event.target.value);
                clearError("orgName");
              }}
            />
            {errors.orgName ? <FieldError id={`${FIELD_ID.orgName}-error`}>{errors.orgName}</FieldError> : null}
            <TextField
              id={FIELD_ID.contactName}
              label="Nama penanggung jawab (wajib)"
              value={contactName}
              maxLength={INVENTORY_LIMITS.outsidePartyName}
              autoComplete="off"
              readOnly={busy}
              invalid={Boolean(errors.contactName)}
              aria-describedby={errors.contactName ? `${FIELD_ID.contactName}-error` : undefined}
              onChange={(event) => {
                setContactName(event.target.value);
                clearError("contactName");
              }}
            />
            {errors.contactName ? <FieldError id={`${FIELD_ID.contactName}-error`}>{errors.contactName}</FieldError> : null}
            <p className="text-body-sm text-ink-body">{COPY.outsidePartyNote}</p>
          </FormCard>
        ) : null}

        <FormCard legend="Tanggal">
          <DateField
            id={FIELD_ID.startDate}
            label="Mulai (wajib)"
            min={today}
            value={startDate}
            readOnly={busy}
            error={errors.startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              clearError("startDate");
            }}
          />
          <DateField
            id={FIELD_ID.endDate}
            label="Sampai (wajib)"
            min={startDate || today}
            max={startDate ? maxRequestEndDate(startDate) : undefined}
            value={endDate}
            readOnly={busy}
            hint={COPY.inclusiveHint}
            error={errors.endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
              clearError("endDate");
            }}
          />
          <p aria-live="polite" className="text-body-md font-semibold text-ink tabular-nums empty:hidden">
            {duration !== null ? `${duration} hari` : ""}
          </p>
        </FormCard>

        <FormCard legend="Barang">
          {lines.length > 0 ? (
            <ul className="flex flex-col divide-y divide-row-line">
              {lines.map((line) => {
                const qtyError = errors[`qty:${line.itemId}`];
                return (
                  <li key={line.itemId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-body-md font-semibold break-words text-ink">{line.name}</p>
                      <p className="text-body-sm text-ink-meta tabular-nums">
                        {line.mode === "quantity" ? line.code : `${formatCount(line.unitCount)} unit`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="flex items-center gap-3">
                        <span aria-hidden="true" className="text-label-lg text-ink-label">
                          Jumlah
                        </span>
                        <QuantityStepper
                          id={qtyId(line.itemId)}
                          value={line.quantity}
                          min={1}
                          max={INVENTORY_LIMITS.stockMax}
                          label={`Jumlah ${line.name}`}
                          readOnly={busy}
                          invalid={Boolean(qtyError)}
                          describedBy={describedBy(lineStatusId(line.itemId), qtyError && `${qtyId(line.itemId)}-error`)}
                          onChange={(value) => setQuantity(line.itemId, value)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => !busy && removeLine(line.itemId)}
                        aria-label={`Hapus ${line.name}`}
                        className={buttonClass("text")}
                      >
                        Hapus
                      </button>
                    </div>
                    {qtyError ? <FieldError id={`${qtyId(line.itemId)}-error`}>{qtyError}</FieldError> : null}
                    <LineAvailability
                      id={lineStatusId(line.itemId)}
                      quantity={line.quantity}
                      datesValid={datesValid}
                      state={current?.kind ?? (availabilityKey ? "loading" : null)}
                      free={freeFor(line.itemId)}
                      rangeLabel={rangeLabel}
                      changed={changedItems.includes(line.itemId)}
                      onRetry={() => setRetryToken((n) => n + 1)}
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}
          <button
            id={FIELD_ID.lines}
            type="button"
            onClick={() => !busy && setPickerOpen(true)}
            aria-describedby={errors.lines ? `${FIELD_ID.lines}-error` : undefined}
            className={buttonClass("outline")}
          >
            <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
            Tambah barang
          </button>
          {errors.lines ? <FieldError id={`${FIELD_ID.lines}-error`}>{errors.lines}</FieldError> : null}
        </FormCard>

        <FormCard legend="Keperluan">
          <TextareaField
            id={FIELD_ID.purpose}
            label="Keperluan atau kegiatan (wajib)"
            placeholder="Nama kegiatan atau tim"
            maxLength={INVENTORY_LIMITS.note}
            value={purpose}
            readOnly={busy}
            error={errors.purpose}
            onChange={(event) => {
              setPurpose(event.target.value);
              clearError("purpose");
            }}
          />
          <TextareaField
            id={FIELD_ID.note}
            label="Catatan (boleh kosong)"
            maxLength={INVENTORY_LIMITS.note}
            value={note}
            readOnly={busy}
            error={errors.note}
            onChange={(event) => {
              setNote(event.target.value);
              clearError("note");
            }}
          />
        </FormCard>

        <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : undefined)}>
          {busy ? <Spinner /> : null}
          {busy ? "Mengirim..." : "Ajukan Peminjaman"}
        </button>
        <button type="button" onClick={leave} className={buttonClass("text", "self-center")}>
          Batal
        </button>
      </form>

      <ItemPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedIds={itemIds}
        onPick={addLine}
        searchItems={searchItems}
        onCloseAutoFocus={(event) => {
          const picked = focusAfterPick.current;
          focusAfterPick.current = null;
          if (picked) {
            event.preventDefault();
            document.getElementById(qtyId(picked))?.focus();
          }
        }}
      />

      <Sheet
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={COPY.discardTitle}
        footer={
          <>
            <button type="button" onClick={() => router.push(cancelHref)} className={buttonClass("primary")}>
              Buang
            </button>
            <button type="button" onClick={() => setDiscardOpen(false)} className={buttonClass("text", "self-center")}>
              Lanjut mengisi
            </button>
          </>
        }
      />
    </>
  );
}

/** A fieldset drawn as a card, its legend as the card title (design 9.6). */
function FormCard({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
      <legend className="float-left mb-1 w-full text-headline-sm text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** A 48 px radio row (radio cards, design 3.7): selected = 2 px walnut border plus the filled dot. */
function RadioRow({
  name,
  label,
  checked,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-walnut",
        checked ? "border-2 border-walnut bg-ivory" : "border-field-line bg-surface hover:border-walnut",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => !disabled && onChange()}
        className="size-5 shrink-0 accent-walnut"
      />
      <span className={cn("text-body-md text-ink", checked && "font-semibold")}>{label}</span>
    </label>
  );
}

/** Per-line availability text (design 9.3): icon plus text, never a name, only counts. */
function LineAvailability({
  id,
  quantity,
  datesValid,
  state,
  free,
  rangeLabel,
  changed,
  onRetry,
}: {
  id: string;
  quantity: number;
  datesValid: boolean;
  state: "loading" | "ok" | "error" | null;
  free: ItemAvailability | null;
  rangeLabel: string;
  changed: boolean;
  onRetry: () => void;
}) {
  let content: React.ReactNode;
  if (!datesValid) {
    content = <Line icon={Info} tone="text-ink-body" text={COPY.pickDatesFirst} />;
  } else if (state === "loading" || state === null) {
    content = <Line icon={LoaderCircle} spin tone="text-ink-body" text={COPY.checking} />;
  } else if (state === "error") {
    content = (
      <span className="flex flex-wrap items-center gap-x-2">
        <Line icon={TriangleAlert} tone="text-warn" text={COPY.availabilityLineError} />
        <button type="button" onClick={onRetry} className={buttonClass("text")}>
          Coba lagi
        </button>
      </span>
    );
  } else if (!free || free.freeQty <= 0) {
    content = <Line icon={CircleAlert} tone="text-danger" text="Tidak tersedia pada tanggal itu. Hapus barang ini atau ganti tanggal." />;
  } else if (quantity > free.freeQty) {
    content = (
      <Line icon={TriangleAlert} tone="text-warn" text={`Hanya ${formatCount(free.freeQty)} tersedia pada tanggal itu. Kurangi jumlahnya.`} />
    );
  } else {
    content = (
      <Line
        icon={CircleCheck}
        tone="text-success"
        text={`Tersedia ${formatCount(free.freeQty)} dari ${formatCount(free.lendableQty)} pada ${rangeLabel}.`}
      />
    );
  }
  return (
    <div id={id} role="status" className={cn("text-body-sm", changed && "rounded-lg bg-warn-soft px-2 py-1")}>
      {changed ? <span className="sr-only">Stok berubah. </span> : null}
      {content}
    </div>
  );
}

function Line({ icon: Icon, tone, text, spin }: { icon: typeof Info; tone: string; text: string; spin?: boolean }) {
  return (
    <span className={cn("flex items-start gap-1.5", tone)}>
      <Icon aria-hidden="true" className={cn("mt-px size-4 shrink-0", spin && "animate-spin motion-reduce:animate-none")} strokeWidth={2} />
      <span>{text}</span>
    </span>
  );
}

function isValidRange(start: string, end: string, today: string): boolean {
  return start !== "" && end !== "" && start >= today && end >= start && end <= maxRequestEndDate(start);
}

function idForKey(key: FieldKey): string {
  return key.startsWith("qty:") ? qtyId(key.slice(4)) : FIELD_ID[key as Exclude<FieldKey, `qty:${string}`>];
}

/** Error keys in page order: the form's fields, with each line's quantity where the lines are. */
function orderedKeys(errors: FieldErrors, lines: FormLine[]): FieldKey[] {
  const out: FieldKey[] = [];
  for (const key of FIELD_ORDER) {
    if (key === "purpose") {
      for (const line of lines) if (errors[`qty:${line.itemId}`]) out.push(`qty:${line.itemId}`);
    }
    if (errors[key]) out.push(key);
  }
  return out;
}

/** Server refusals that belong to one field (contract codes the UI words per field, design 9.2). */
function fieldErrorFor(error: InventoryError): { key: FieldKey; text: string } | null {
  switch (error.code) {
    case "text_required":
    case "outside_party_incomplete":
      if ("field" in error && error.field === "outsideContactName") return { key: "contactName", text: FIELD_ERRORS.contactMissing };
      if ("field" in error && (error.field === "outsideOrgName" || error.field === "outsideParty")) {
        return { key: "orgName", text: FIELD_ERRORS.orgMissing };
      }
      if ("field" in error && error.field === "purpose") return { key: "purpose", text: FIELD_ERRORS.purposeMissing };
      return null;
    case "text_too_long":
      if (error.field === "purpose") return { key: "purpose", text: tooLongText("Keperluan", INVENTORY_LIMITS.note) };
      if (error.field === "note") return { key: "note", text: tooLongText("Catatan", INVENTORY_LIMITS.note) };
      if (error.field === "outsideOrgName") return { key: "orgName", text: tooLongText("Nama organisasi", INVENTORY_LIMITS.outsidePartyName) };
      if (error.field === "outsideContactName") {
        return { key: "contactName", text: tooLongText("Nama penanggung jawab", INVENTORY_LIMITS.outsidePartyName) };
      }
      return null;
    case "start_in_past":
      return { key: "startDate", text: INVENTORY_ERROR_COPY.start_in_past ?? "" };
    case "invalid_dates":
      return error.field === "startDate"
        ? { key: "startDate", text: FIELD_ERRORS.startMissing }
        : { key: "endDate", text: INVENTORY_ERROR_COPY.invalid_dates ?? "" };
    case "date_range_too_long":
      return { key: "endDate", text: INVENTORY_ERROR_COPY.date_range_too_long ?? "" };
    case "quantity_invalid":
      if (error.field === "lines" && !error.ref) return { key: "lines", text: FIELD_ERRORS.linesMissing };
      if (error.ref) return { key: `qty:${error.ref}`, text: FIELD_ERRORS.quantityInvalid };
      return { key: "lines", text: FIELD_ERRORS.quantityInvalid };
    case "duplicate_item":
      return { key: "lines", text: INVENTORY_ERROR_COPY.duplicate_item ?? "" };
    case "too_many_lines":
      return { key: "lines", text: INVENTORY_ERROR_COPY.too_many_lines ?? "" };
    default:
      return null;
  }
}
