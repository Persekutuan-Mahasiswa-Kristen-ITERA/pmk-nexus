"use client";

import { useState, type RefObject } from "react";
import {
  addStock,
  addUnits,
  moveStock,
  restoreLostUnit,
  setItemActive,
  setUnitActive,
  setUnitCondition,
  writeOffStock,
  writeOffUnit,
} from "../server/manage-actions";
import { SelectField, TextareaField } from "@/components/ui/form-fields";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { RadioRow } from "@/components/ui/radio-row";
import { FieldError } from "@/components/ui/field-error";
import {
  CONDITION_LABEL,
  formatInventoryCopy,
  INVENTORY_LIMITS,
  type CatalogUnit,
  type InventoryError,
  type ItemCondition,
  type ItemDetail,
  type ListEntry,
} from "../types";
import { ActionSheet, defaultActionError, useInventoryAction, type ActionError } from "./action-sheet";
import { atMostText, STAFF_COPY, tooLongText, unitsSavedText } from "./copy";
import { formatCount } from "./format";

// The named stock dialogs of the item edit screen (design 7.6, owner P6 a): every change states its
// reason and ends in one history row. The reason is always required (contract reasonSchema).

const CONDITIONS: ItemCondition[] = ["good", "needs_service", "damaged"];
const RANK: Record<ItemCondition, number> = { good: 0, needs_service: 1, damaged: 2 };

export type DialogKind =
  | { kind: "stock_add" }
  | { kind: "stock_move" }
  | { kind: "stock_write_off" }
  | { kind: "item_archive" }
  | { kind: "unit_add" }
  | { kind: "unit_condition"; unit: CatalogUnit }
  | { kind: "unit_write_off"; unit: CatalogUnit }
  | { kind: "unit_archive"; unit: CatalogUnit }
  | { kind: "unit_restore"; unit: CatalogUnit };

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a save, with the notice the edit screen shows. */
  onDone: (notice: string) => void;
};

/** Focus target by id (Sheet takes a ref; selects and steppers are found by their id). */
function idRef(id: string): RefObject<HTMLElement | null> {
  return {
    get current() {
      return document.getElementById(id);
    },
  };
}

function stockOf(item: ItemDetail, condition: ItemCondition): number {
  if (condition === "good") return item.stock.good;
  if (condition === "needs_service") return item.stock.needsService;
  return item.stock.damaged;
}

/** Errors that belong to the reason field or the quantity; anything else goes above the buttons. */
function fieldError(
  e: InventoryError,
  marks: { note: (text: string) => void; quantity?: (text: string) => void; missingNote: string; maxQuantity?: number },
): boolean {
  if ((e.code === "reason_required" || e.code === "text_required" || e.code === "note_required") && e.field !== "quantity") {
    marks.note(marks.missingNote);
    return true;
  }
  if (e.code === "text_too_long") {
    marks.note(tooLongText("Catatan", INVENTORY_LIMITS.note));
    return true;
  }
  if (e.code === "quantity_invalid" && marks.quantity) {
    marks.quantity(marks.maxQuantity !== undefined ? atMostText(marks.maxQuantity) : STAFF_COPY.quantityFromOne);
    return true;
  }
  return false;
}

function NoteField({
  id,
  value,
  onChange,
  error,
  busy,
  required = true,
  hint,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  busy: boolean;
  required?: boolean;
  hint?: string;
}) {
  return (
    <TextareaField
      id={id}
      label={required ? "Catatan (wajib)" : "Catatan (boleh kosong)"}
      hint={hint}
      value={value}
      maxLength={INVENTORY_LIMITS.note}
      readOnly={busy}
      error={error ?? undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** "Dari kondisi": only conditions that have stock, each with its count (design 7.6b). */
function FromConditionSelect({
  id,
  item,
  value,
  onChange,
}: {
  id: string;
  item: ItemDetail;
  value: ItemCondition;
  onChange: (value: ItemCondition) => void;
}) {
  return (
    <SelectField id={id} label="Dari kondisi" value={value} onChange={(event) => onChange(event.target.value as ItemCondition)}>
      {CONDITIONS.filter((c) => stockOf(item, c) > 0).map((c) => (
        <option key={c} value={c}>
          {`${CONDITION_LABEL[c]} (${formatCount(stockOf(item, c))})`}
        </option>
      ))}
    </SelectField>
  );
}

function firstWithStock(item: ItemDetail): ItemCondition {
  return CONDITIONS.find((c) => stockOf(item, c) > 0) ?? "good";
}

// ---- Quantity items ----

/** a. "Tambah jumlah": new stock of a quantity item arrived. */
export function StockAddDialog({ item, ...dialog }: DialogProps & { item: ItemDetail }) {
  const { busy, error, run } = useInventoryAction();
  const [condition, setCondition] = useState<ItemCondition>("good");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const room = Math.max(1, INVENTORY_LIMITS.stockMax - stockOf(item, condition));

  function submit() {
    if (note.trim() === "") {
      setNoteError(STAFF_COPY.reasonMissing);
      document.getElementById("stock-add-note")?.focus();
      return;
    }
    void run(() => addStock({ itemId: item.itemId, condition, quantity, note }), {
      onOk: () => dialog.onDone(STAFF_COPY.itemSaved),
      onError: (e) =>
        fieldError(e, { note: setNoteError, quantity: setQuantityError, missingNote: STAFF_COPY.reasonMissing })
          ? null
          : defaultActionError(e, "manage"),
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title="Tambah jumlah"
      primaryLabel="Tambah"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={idRef("stock-add-condition")}
    >
      <SelectField
        id="stock-add-condition"
        label="Kondisi"
        value={condition}
        onChange={(event) => setCondition(event.target.value as ItemCondition)}
      >
        {CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {CONDITION_LABEL[c]}
          </option>
        ))}
      </SelectField>
      <QuantityField
        id="stock-add-quantity"
        label="Jumlah (wajib)"
        value={quantity}
        max={room}
        busy={busy}
        error={quantityError}
        onChange={(value) => {
          setQuantity(value);
          setQuantityError(null);
        }}
      />
      <NoteField
        id="stock-add-note"
        value={note}
        onChange={(v) => {
          setNote(v);
          setNoteError(null);
        }}
        error={noteError}
        busy={busy}
      />
    </ActionSheet>
  );
}

/** b. "Ubah kondisi" for a quantity item: move a number of pieces from one condition to another. */
export function StockMoveDialog({ item, ...dialog }: DialogProps & { item: ItemDetail }) {
  const { busy, error, run } = useInventoryAction();
  const [from, setFrom] = useState<ItemCondition>(() => firstWithStock(item));
  const [to, setTo] = useState<ItemCondition>(() => CONDITIONS.find((c) => c !== firstWithStock(item)) ?? "needs_service");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const available = stockOf(item, from);
  const worse = RANK[to] > RANK[from];
  const missingNote = worse ? STAFF_COPY.reasonWorseMissing : STAFF_COPY.reasonMissing;

  function chooseFrom(next: ItemCondition) {
    setFrom(next);
    if (to === next) setTo(CONDITIONS.find((c) => c !== next) ?? "good");
    setQuantity(1);
    setQuantityError(null);
  }

  function submit() {
    if (note.trim() === "") {
      setNoteError(missingNote);
      document.getElementById("stock-move-note")?.focus();
      return;
    }
    void run(() => moveStock({ itemId: item.itemId, from, to, quantity, note }), {
      onOk: () => dialog.onDone(STAFF_COPY.itemSaved),
      onError: (e) =>
        fieldError(e, { note: setNoteError, quantity: setQuantityError, missingNote, maxQuantity: available })
          ? null
          : defaultActionError(e, "manage"),
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title="Ubah kondisi"
      primaryLabel="Simpan"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={idRef("stock-move-from")}
    >
      <FromConditionSelect id="stock-move-from" item={item} value={from} onChange={chooseFrom} />
      <SelectField id="stock-move-to" label="Ke kondisi" value={to} onChange={(event) => setTo(event.target.value as ItemCondition)}>
        {CONDITIONS.filter((c) => c !== from).map((c) => (
          <option key={c} value={c}>
            {CONDITION_LABEL[c]}
          </option>
        ))}
      </SelectField>
      <QuantityField
        id="stock-move-quantity"
        label="Jumlah (wajib)"
        value={quantity}
        max={Math.max(1, available)}
        busy={busy}
        error={quantityError}
        onChange={(value) => {
          setQuantity(value);
          setQuantityError(null);
        }}
      />
      <NoteField
        id="stock-move-note"
        value={note}
        onChange={(v) => {
          setNote(v);
          setNoteError(null);
        }}
        error={noteError}
        busy={busy}
      />
    </ActionSheet>
  );
}

/** c. "Keluarkan dari stok" for a quantity item: lost or thrown away; never a delete. */
export function StockWriteOffDialog({ item, ...dialog }: DialogProps & { item: ItemDetail }) {
  const { busy, error, run } = useInventoryAction();
  const [condition, setCondition] = useState<ItemCondition>(() => firstWithStock(item));
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const available = stockOf(item, condition);

  function submit() {
    if (note.trim() === "") {
      setNoteError(STAFF_COPY.reasonMissing);
      document.getElementById("stock-write-off-note")?.focus();
      return;
    }
    void run(() => writeOffStock({ itemId: item.itemId, condition, quantity, note }), {
      onOk: () => dialog.onDone(STAFF_COPY.itemSaved),
      onError: (e) =>
        fieldError(e, {
          note: setNoteError,
          quantity: setQuantityError,
          missingNote: STAFF_COPY.reasonMissing,
          maxQuantity: available,
        })
          ? null
          : defaultActionError(e, "manage"),
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title="Keluarkan dari stok"
      description={STAFF_COPY.writeOffQuantityBody}
      primaryLabel="Keluarkan dari stok"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={idRef("stock-write-off-from")}
    >
      <FromConditionSelect
        id="stock-write-off-from"
        item={item}
        value={condition}
        onChange={(next) => {
          setCondition(next);
          setQuantity(1);
          setQuantityError(null);
        }}
      />
      <QuantityField
        id="stock-write-off-quantity"
        label="Jumlah (wajib)"
        value={quantity}
        max={Math.max(1, available)}
        busy={busy}
        error={quantityError}
        onChange={(value) => {
          setQuantity(value);
          setQuantityError(null);
        }}
      />
      <NoteField
        id="stock-write-off-note"
        value={note}
        hint={STAFF_COPY.writeOffHint}
        onChange={(v) => {
          setNote(v);
          setNoteError(null);
        }}
        error={noteError}
        busy={busy}
      />
    </ActionSheet>
  );
}

// ---- Archive ----

/**
 * d. "Nonaktifkan barang?" Blocked while lines are open: the dialog then shows the count and no
 * confirm button (design 7.6d, count only, no names).
 */
export function ItemArchiveDialog({ item, ...dialog }: DialogProps & { item: ItemDetail }) {
  const { busy, error, run } = useInventoryAction();
  const [blocked, setBlocked] = useState(false);

  function submit() {
    void run(() => setItemActive({ itemId: item.itemId, isActive: false }), {
      onOk: () => dialog.onDone(STAFF_COPY.itemSaved),
      onError: (e) => {
        if (e.code === "open_requests_exist") setBlocked(true);
        return defaultActionError(e, "manage");
      },
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title={STAFF_COPY.archiveItemTitle}
      description={STAFF_COPY.archiveItemBody}
      primaryLabel="Nonaktifkan"
      cancelLabel={blocked ? "Tutup" : "Batal"}
      busy={busy}
      error={error}
      hidePrimary={blocked}
      onSubmit={submit}
    />
  );
}

/** "Nonaktifkan {kode}?" for one unit (unit variant of 7.6d). */
export function UnitArchiveDialog({ unit, ...dialog }: DialogProps & { unit: CatalogUnit }) {
  const { busy, error, run } = useInventoryAction();
  const [blocked, setBlocked] = useState(false);

  function submit() {
    void run(() => setUnitActive({ unitId: unit.unitId, isActive: false }), {
      onOk: () => dialog.onDone(STAFF_COPY.itemSaved),
      onError: (e) => {
        if (e.code === "open_requests_exist" || e.code === "unit_on_loan") setBlocked(true);
        return defaultActionError(e, "manage");
      },
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title={`Nonaktifkan ${unit.code}?`}
      description={STAFF_COPY.archiveUnitBody}
      primaryLabel="Nonaktifkan"
      cancelLabel={blocked ? "Tutup" : "Batal"}
      busy={busy}
      error={error}
      hidePrimary={blocked}
      onSubmit={submit}
    />
  );
}

// ---- Tracked items: one unit ----

/** b. "Ubah kondisi {kode}": the other two conditions as radio cards. */
export function UnitConditionDialog({ unit, ...dialog }: DialogProps & { unit: CatalogUnit }) {
  const { busy, error, run } = useInventoryAction();
  const others = CONDITIONS.filter((c) => c !== unit.condition);
  const [condition, setCondition] = useState<ItemCondition | null>(null);
  const [conditionError, setConditionError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const worse = condition !== null && RANK[condition] > RANK[unit.condition];
  const missingNote = worse ? STAFF_COPY.reasonWorseMissing : STAFF_COPY.reasonMissing;

  function submit() {
    if (condition === null) {
      setConditionError(STAFF_COPY.unitConditionMissing);
      document.getElementById(`unit-condition-new-${others[0]}`)?.focus();
      return;
    }
    if (note.trim() === "") {
      setNoteError(missingNote);
      document.getElementById("unit-condition-note")?.focus();
      return;
    }
    void run(() => setUnitCondition({ unitId: unit.unitId, condition, note }), {
      onOk: () => dialog.onDone(STAFF_COPY.itemSaved),
      onError: (e) => {
        if (e.code === "invalid_condition") {
          setConditionError(STAFF_COPY.unitConditionMissing);
          return null;
        }
        return fieldError(e, { note: setNoteError, missingNote }) ? null : defaultActionError(e, "manage");
      },
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title={`Ubah kondisi ${unit.code}`}
      description={`Sekarang: ${CONDITION_LABEL[unit.condition]}.`}
      primaryLabel="Simpan"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={idRef(`unit-condition-new-${others[0]}`)}
    >
      <fieldset className="flex flex-col gap-2" aria-describedby={conditionError ? "unit-condition-error" : undefined}>
        <legend className="mb-1.5 text-label-lg text-ink-label">Kondisi baru (wajib)</legend>
        {others.map((c) => (
          <RadioRow
            key={c}
            id={`unit-condition-new-${c}`}
            name="unit-condition-new"
            value={c}
            label={CONDITION_LABEL[c]}
            checked={condition === c}
            readOnly={busy}
            onChange={() => {
              setCondition(c);
              setConditionError(null);
            }}
          />
        ))}
        {conditionError ? <FieldError id="unit-condition-error">{conditionError}</FieldError> : null}
      </fieldset>
      <NoteField
        id="unit-condition-note"
        value={note}
        onChange={(v) => {
          setNote(v);
          setNoteError(null);
        }}
        error={noteError}
        busy={busy}
      />
    </ActionSheet>
  );
}

/** c. "Keluarkan" one unit: status Hilang, code kept in the history. */
export function UnitWriteOffDialog({ unit, ...dialog }: DialogProps & { unit: CatalogUnit }) {
  const { busy, error, run } = useInventoryAction();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  function submit() {
    if (note.trim() === "") {
      setNoteError(STAFF_COPY.reasonMissing);
      document.getElementById("unit-write-off-note")?.focus();
      return;
    }
    void run(() => writeOffUnit({ unitId: unit.unitId, note }), {
      onOk: () => dialog.onDone(STAFF_COPY.itemSaved),
      onError: (e) =>
        fieldError(e, { note: setNoteError, missingNote: STAFF_COPY.reasonMissing }) ? null : defaultActionError(e, "manage"),
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title="Keluarkan dari stok"
      description={`Unit ${unit.code} berstatus Hilang. Kodenya tidak dipakai lagi dan tetap ada di riwayat.`}
      primaryLabel="Keluarkan dari stok"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={idRef("unit-write-off-note")}
    >
      <NoteField
        id="unit-write-off-note"
        value={note}
        hint={STAFF_COPY.writeOffHint}
        onChange={(v) => {
          setNote(v);
          setNoteError(null);
        }}
        error={noteError}
        busy={busy}
      />
    </ActionSheet>
  );
}

/** "Ditemukan kembali" (G7, A-IB45): a lost unit returns to stock with its condition now. */
export function UnitRestoreDialog({ unit, ...dialog }: DialogProps & { unit: CatalogUnit }) {
  const { busy, error, run } = useInventoryAction();
  const [condition, setCondition] = useState<ItemCondition>("good");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  function submit() {
    if (note.trim() === "") {
      setNoteError(STAFF_COPY.reasonMissing);
      document.getElementById("unit-restore-note")?.focus();
      return;
    }
    void run(() => restoreLostUnit({ unitId: unit.unitId, condition, note }), {
      onOk: () => dialog.onDone(STAFF_COPY.itemSaved),
      onError: (e) =>
        fieldError(e, { note: setNoteError, missingNote: STAFF_COPY.reasonMissing }) ? null : defaultActionError(e, "manage"),
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title={STAFF_COPY.restoreTitle}
      description={formatInventoryCopy(STAFF_COPY.restoreBody, { kode: unit.code })}
      primaryLabel="Simpan"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={idRef("unit-restore-condition")}
    >
      <SelectField
        id="unit-restore-condition"
        label="Kondisi sekarang (wajib)"
        value={condition}
        onChange={(event) => setCondition(event.target.value as ItemCondition)}
      >
        {CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {CONDITION_LABEL[c]}
          </option>
        ))}
      </SelectField>
      <NoteField
        id="unit-restore-note"
        value={note}
        onChange={(v) => {
          setNote(v);
          setNoteError(null);
        }}
        error={noteError}
        busy={busy}
      />
    </ActionSheet>
  );
}

/** "+ Tambah unit" for a tracked item: n new units with one condition and location; codes by the database. */
export function UnitAddDialog({ item, locations, ...dialog }: DialogProps & { item: ItemDetail; locations: ListEntry[] }) {
  const { busy, error, run } = useInventoryAction();
  const [count, setCount] = useState(1);
  const [condition, setCondition] = useState<ItemCondition>("good");
  const [locationId, setLocationId] = useState("");
  const active = locations.filter((l) => l.isActive);

  function submit() {
    const units = new Array(count).fill(null).map(() => ({ condition, locationId: locationId || null }));
    void run(() => addUnits({ itemId: item.itemId, units }), {
      onOk: (data) => {
        const codes = data.unitCodes;
        dialog.onDone(codes.length > 0 ? unitsSavedText(codes.length, codes[0], codes[codes.length - 1]) : STAFF_COPY.itemSaved);
      },
      onError: (e): ActionError | null =>
        e.code === "quantity_invalid" ? { text: STAFF_COPY.unitsMissing } : defaultActionError(e, "manage"),
    });
  }

  return (
    <ActionSheet
      {...dialog}
      title="Tambah unit"
      description={STAFF_COPY.unitCodeAuto}
      primaryLabel="Tambah"
      busy={busy}
      error={error}
      onSubmit={submit}
      initialFocusRef={idRef("unit-add-count")}
    >
      <QuantityField
        id="unit-add-count"
        label="Jumlah unit"
        value={count}
        max={INVENTORY_LIMITS.unitsPerCall}
        busy={busy}
        error={null}
        onChange={setCount}
      />
      <SelectField id="unit-add-condition" label="Kondisi" value={condition} onChange={(e) => setCondition(e.target.value as ItemCondition)}>
        {CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {CONDITION_LABEL[c]}
          </option>
        ))}
      </SelectField>
      <SelectField id="unit-add-location" label="Lokasi (boleh kosong)" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
        <option value="">{active.length === 0 ? STAFF_COPY.noLocationOption : "Pilih lokasi"}</option>
        {active.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </SelectField>
    </ActionSheet>
  );
}

/** Label above a stepper, with its error under it (the stepper has no frame of its own). */
function QuantityField({
  id,
  label,
  value,
  max,
  busy,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  busy: boolean;
  error: string | null;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-lg text-ink-label">
        {label}
      </label>
      <QuantityStepper
        id={id}
        value={value}
        min={1}
        max={max}
        label={label.replace(" (wajib)", "").toLowerCase()}
        readOnly={busy}
        invalid={Boolean(error)}
        describedBy={error ? `${id}-error` : undefined}
        onChange={onChange}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
