"use client";

import { useRef, useState, type FormEvent } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { createItem } from "../server/manage-actions";
import { SelectField, TextareaField } from "@/components/ui/form-fields";
import { FieldError } from "@/components/ui/field-error";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { RadioRow } from "@/components/ui/radio-row";
import { TextField } from "@/components/ui/text-field";
import {
  CONDITION_LABEL,
  INVENTORY_LIMITS,
  ITEM_MODE_LABEL,
  type InventoryError,
  type ItemCondition,
  type ItemMode,
  type ListEntry,
} from "../types";
import { defaultActionError, useInventoryAction } from "./action-sheet";
import { STAFF_COPY, tooLongText } from "./copy";
import { formatCount } from "./format";
import { DiscardSheet, FormCard, FormSummary } from "./form-parts";
import { itemNoticeHref, listsHref, MANAGE_PATH } from "./routes";

const CONDITIONS: ItemCondition[] = ["good", "needs_service", "damaged"];

type UnitRow = { key: number; condition: ItemCondition; locationId: string };
type Stock = { good: number; needsService: number; damaged: number };
type FieldKey = "mode" | "name" | "description" | "stock" | "units";

const FIELD_ID: Record<FieldKey, string> = {
  mode: "item-mode-quantity",
  name: "item-name",
  description: "item-description",
  stock: "item-stock-good",
  units: "item-add-unit",
};
const FIELD_ORDER: FieldKey[] = ["mode", "name", "description", "stock", "units"];

/**
 * "Tambah barang" (design 7.1, 7.2): the way of recording comes first and never changes later (P5 a).
 * Then name, description, category, location (quantity items) and the stock per condition, or the
 * units (tracked items, each with its own condition and location). Codes are made by the database.
 */
export function ItemCreateForm({ categories, locations }: { categories: ListEntry[]; locations: ListEntry[] }) {
  const { router, busy, error, setError, run } = useInventoryAction();
  const summaryRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(2);

  const [mode, setMode] = useState<ItemMode | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [stock, setStock] = useState<Stock>({ good: 0, needsService: 0, damaged: 0 });
  const [units, setUnits] = useState<UnitRow[]>([{ key: 1, condition: "good", locationId: "" }]);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [summary, setSummary] = useState<FieldKey[]>([]);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);

  const activeCategories = categories.filter((c) => c.isActive);
  const activeLocations = locations.filter((l) => l.isActive);
  const dirty = mode !== null || name.trim() !== "" || description.trim() !== "";
  const total = stock.good + stock.needsService + stock.damaged;

  function leave(target: string) {
    if (busy) return;
    if (dirty) setDiscardTarget(target);
    else router.push(target);
  }

  function clearError(key: FieldKey) {
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function showErrors(next: Partial<Record<FieldKey, string>>) {
    setErrors(next);
    setSummary(FIELD_ORDER.filter((key) => next[key]));
    setError(null);
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  function validate(): Partial<Record<FieldKey, string>> {
    const next: Partial<Record<FieldKey, string>> = {};
    if (mode === null) next.mode = STAFF_COPY.modeMissing;
    if (name.trim() === "") next.name = STAFF_COPY.nameMissing;
    else if ([...name.trim()].length > INVENTORY_LIMITS.itemName) next.name = tooLongText("Nama barang", INVENTORY_LIMITS.itemName);
    if ([...description.trim()].length > INVENTORY_LIMITS.itemDescription) {
      next.description = tooLongText("Deskripsi", INVENTORY_LIMITS.itemDescription);
    }
    if (mode === "quantity" && total < 1) next.stock = STAFF_COPY.stockMissing;
    if (mode === "tracked" && units.length === 0) next.units = STAFF_COPY.unitsMissing;
    return next;
  }

  function fieldFor(e: InventoryError): Partial<Record<FieldKey, string>> | null {
    switch (e.code) {
      case "invalid_mode":
        return { mode: STAFF_COPY.modeMissing };
      case "text_required":
        return e.field === "name" ? { name: STAFF_COPY.nameMissing } : null;
      case "text_too_long":
        if (e.field === "name") return { name: tooLongText("Nama barang", INVENTORY_LIMITS.itemName) };
        if (e.field === "description") return { description: tooLongText("Deskripsi", INVENTORY_LIMITS.itemDescription) };
        return null;
      case "quantity_invalid":
        return mode === "tracked" ? { units: STAFF_COPY.unitsMissing } : { stock: STAFF_COPY.stockMissing };
      case "invalid_condition":
        return { units: STAFF_COPY.unitConditionMissing };
      default:
        return null;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const found = validate();
    if (Object.values(found).some(Boolean)) {
      showErrors(found);
      return;
    }
    setErrors({});
    setSummary([]);
    const common = { name, description, categoryId: categoryId || null, note: null };
    await run(
      () =>
        mode === "quantity"
          ? createItem({ mode: "quantity", ...common, locationId: locationId || null, stock })
          : createItem({ mode: "tracked", ...common, units: units.map((u) => ({ condition: u.condition, locationId: u.locationId || null })) }),
      {
        onOk: (data) => {
          const codes = data.unitCodes;
          router.push(
            data.itemCode
              ? itemNoticeHref(data.itemId, { kind: "created_quantity", code: data.itemCode })
              : codes.length > 0
                ? itemNoticeHref(data.itemId, { kind: "created_tracked", count: codes.length, first: codes[0], last: codes[codes.length - 1] })
                : itemNoticeHref(data.itemId, { kind: "saved" }),
            { scroll: true },
          );
        },
        onError: (e) => {
          const field = fieldFor(e);
          if (field) {
            showErrors(field);
            return null;
          }
          requestAnimationFrame(() => summaryRef.current?.focus());
          return defaultActionError(e, "manage");
        },
      },
    );
  }

  function addUnit() {
    if (busy || units.length >= INVENTORY_LIMITS.unitsPerCall) return;
    const last = units[units.length - 1];
    const key = nextKey.current++;
    // Copies the last row's values (design 7.2), so ten identical units take ten taps, not thirty.
    setUnits((prev) => [...prev, { key, condition: last?.condition ?? "good", locationId: last?.locationId ?? "" }]);
    clearError("units");
    requestAnimationFrame(() => document.getElementById(`unit-condition-${key}`)?.focus());
  }

  const problems = summary.flatMap((key) => (errors[key] ? [{ id: FIELD_ID[key], text: errors[key] as string }] : []));

  return (
    <>
      <button
        type="button"
        onClick={() => leave(MANAGE_PATH)}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
      >
        <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
        Kelola Barang
      </button>
      <div>
        <h1 className="font-heading text-display-sm text-title">Tambah barang</h1>
        {mode ? (
          <p className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-body-md text-ink-body">
            {ITEM_MODE_LABEL[mode]}
            <button type="button" onClick={() => !busy && setMode(null)} className={buttonClass("text", "-mr-2")}>
              Ganti pilihan
            </button>
          </p>
        ) : null}
      </div>

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        <FormSummary ref={summaryRef} problems={problems} message={error} />

        {mode === null ? (
          <FormCard legend="Cara mencatat (wajib)">
            <div className="flex flex-col gap-3 lg:flex-row">
              <RadioRow
                name="item-mode"
                value="quantity"
                className="lg:flex-1"
                label={ITEM_MODE_LABEL.quantity}
                description="Untuk barang sejenis yang cukup dihitung jumlahnya. Satu kode untuk seluruh barang."
                checked={false}
                onChange={() => {
                  setMode("quantity");
                  clearError("mode");
                }}
              />
              <RadioRow
                name="item-mode"
                value="tracked"
                className="lg:flex-1"
                label={ITEM_MODE_LABEL.tracked}
                description="Untuk barang yang kondisinya dicatat satu per satu. Setiap unit punya kode sendiri."
                checked={false}
                onChange={() => {
                  setMode("tracked");
                  clearError("mode");
                }}
              />
            </div>
            <p className="text-body-sm text-ink-body">{STAFF_COPY.modeFixed}</p>
            {errors.mode ? <FieldError id="item-mode-error">{errors.mode}</FieldError> : null}
            {/* Target of the summary link "Pilih cara mencatat barang ini." */}
            <span id={FIELD_ID.mode} tabIndex={-1} className="sr-only">
              Cara mencatat
            </span>
          </FormCard>
        ) : (
          <>
            <FormCard legend="Rincian barang">
              <div className="flex flex-col gap-1.5">
                <TextField
                  id={FIELD_ID.name}
                  label="Nama barang (wajib)"
                  value={name}
                  maxLength={INVENTORY_LIMITS.itemName + 20}
                  autoComplete="off"
                  readOnly={busy}
                  invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? `${FIELD_ID.name}-error` : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearError("name");
                  }}
                />
                {errors.name ? <FieldError id={`${FIELD_ID.name}-error`}>{errors.name}</FieldError> : null}
              </div>
              <TextareaField
                id={FIELD_ID.description}
                label="Deskripsi (boleh kosong)"
                value={description}
                maxLength={INVENTORY_LIMITS.itemDescription + 20}
                readOnly={busy}
                error={errors.description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  clearError("description");
                }}
              />
              <EntrySelect
                id="item-category"
                label="Kategori (boleh kosong)"
                placeholder="Pilih kategori"
                emptyOption={STAFF_COPY.noCategoryOption}
                addLabel={STAFF_COPY.addCategoryLink}
                entries={activeCategories}
                value={categoryId}
                onChange={setCategoryId}
                onAdd={() => leave(listsHref("category"))}
              />
              {mode === "quantity" ? (
                <EntrySelect
                  id="item-location"
                  label="Lokasi (boleh kosong)"
                  placeholder="Pilih lokasi"
                  emptyOption={STAFF_COPY.noLocationOption}
                  addLabel={STAFF_COPY.addLocationLink}
                  entries={activeLocations}
                  value={locationId}
                  onChange={setLocationId}
                  onAdd={() => leave(listsHref("location"))}
                />
              ) : null}
              {mode === "quantity" ? (
                <div>
                  <p className="text-label-lg text-ink-label">Kode</p>
                  <p className="text-body-md text-ink-body">{STAFF_COPY.codeAuto}</p>
                </div>
              ) : null}
            </FormCard>

            {mode === "quantity" ? (
              <FormCard legend="Jumlah per kondisi">
                {(
                  [
                    ["good", "good"],
                    ["needs_service", "needsService"],
                    ["damaged", "damaged"],
                  ] as const
                ).map(([condition, key]) => (
                  <div key={condition} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span aria-hidden="true" className="text-body-md text-ink">
                      {CONDITION_LABEL[condition]}
                    </span>
                    <QuantityStepper
                      id={condition === "good" ? FIELD_ID.stock : `item-stock-${condition}`}
                      value={stock[key]}
                      min={0}
                      max={INVENTORY_LIMITS.stockMax}
                      label={`jumlah ${CONDITION_LABEL[condition]}`}
                      readOnly={busy}
                      invalid={Boolean(errors.stock)}
                      describedBy={errors.stock ? "item-stock-error" : undefined}
                      onChange={(value) => {
                        setStock((prev) => ({ ...prev, [key]: value }));
                        clearError("stock");
                      }}
                    />
                  </div>
                ))}
                <p role="status" className="flex justify-between border-t border-row-line pt-2 text-body-md font-semibold text-ink tabular-nums">
                  <span>Total</span>
                  <span>{formatCount(total)}</span>
                </p>
                <p className="text-body-sm text-ink-body">{STAFF_COPY.onlyGoodLendable}</p>
                {errors.stock ? <FieldError id="item-stock-error">{errors.stock}</FieldError> : null}
              </FormCard>
            ) : (
              <FormCard legend="Unit">
                <p className="-mt-1 text-body-sm text-ink-body">{STAFF_COPY.unitCodeAuto}</p>
                <ol className="flex flex-col divide-y divide-row-line">
                  {units.map((unit, index) => (
                    <li key={unit.key} className="flex flex-col gap-3 py-3 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-body-md font-semibold text-ink">Unit {index + 1}</p>
                        <button
                          type="button"
                          aria-label={`Hapus unit ${index + 1}`}
                          onClick={() => !busy && setUnits((prev) => prev.filter((u) => u.key !== unit.key))}
                          className={buttonClass("text", "-mr-2")}
                        >
                          Hapus
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <SelectField
                          id={`unit-condition-${unit.key}`}
                          label="Kondisi"
                          value={unit.condition}
                          onChange={(event) => {
                            const condition = event.target.value as ItemCondition;
                            setUnits((prev) => prev.map((u) => (u.key === unit.key ? { ...u, condition } : u)));
                          }}
                        >
                          {CONDITIONS.map((c) => (
                            <option key={c} value={c}>
                              {CONDITION_LABEL[c]}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField
                          id={`unit-location-${unit.key}`}
                          label="Lokasi"
                          value={unit.locationId}
                          onChange={(event) => {
                            const value = event.target.value;
                            setUnits((prev) => prev.map((u) => (u.key === unit.key ? { ...u, locationId: value } : u)));
                          }}
                        >
                          <option value="">{activeLocations.length === 0 ? STAFF_COPY.noLocationOption : "Pilih lokasi"}</option>
                          {activeLocations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </SelectField>
                      </div>
                    </li>
                  ))}
                </ol>
                {units.length < INVENTORY_LIMITS.unitsPerCall ? (
                  <button
                    id={FIELD_ID.units}
                    type="button"
                    onClick={addUnit}
                    aria-describedby={errors.units ? "item-units-error" : undefined}
                    className={buttonClass("outline")}
                  >
                    <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
                    Tambah unit
                  </button>
                ) : null}
                {errors.units ? <FieldError id="item-units-error">{errors.units}</FieldError> : null}
              </FormCard>
            )}
          </>
        )}

        <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : undefined)}>
          {busy ? <Spinner /> : null}
          {busy ? "Menyimpan..." : "Simpan"}
        </button>
        <button type="button" onClick={() => leave(MANAGE_PATH)} className={buttonClass("text", "self-center")}>
          Batal
        </button>
      </form>

      <DiscardSheet
        open={discardTarget !== null}
        onOpenChange={(open) => !open && setDiscardTarget(null)}
        onDiscard={() => discardTarget && router.push(discardTarget)}
      />
    </>
  );
}

/**
 * Category or location select for a new item: active entries only. Both lists start empty (IB10), so
 * an empty list shows "Belum ada kategori" and a way to fill it (design 7.4).
 */
export function EntrySelect({
  id,
  label,
  placeholder,
  emptyOption,
  addLabel,
  entries,
  value,
  onChange,
  onAdd,
  keep,
}: {
  id: string;
  label: string;
  placeholder: string;
  emptyOption: string;
  addLabel: string;
  entries: ListEntry[];
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  /** A deactivated entry the item already uses may be kept, not newly chosen (contract itemUpdate). */
  keep?: ListEntry | null;
}) {
  if (entries.length === 0 && !keep) {
    return (
      <div className="flex flex-col items-start gap-1">
        <SelectField id={id} label={label} value="" disabled onChange={() => undefined}>
          <option value="">{emptyOption}</option>
        </SelectField>
        <button type="button" onClick={onAdd} className={buttonClass("text", "-ml-2")}>
          {addLabel}
        </button>
      </div>
    );
  }
  return (
    <SelectField id={id} label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {entries.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
      {keep && !keep.isActive ? <option value={keep.id}>{`${keep.name} (nonaktif)`}</option> : null}
    </SelectField>
  );
}
