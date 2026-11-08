"use client";

import { useRef, useState, type FormEvent } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { moveUnit, setItemActive, setUnitActive, updateItem } from "../server/manage-actions";
import { TextareaField, SelectField } from "@/components/ui/form-fields";
import { FieldError } from "@/components/ui/field-error";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { TextField } from "@/components/ui/text-field";
import {
  INVENTORY_LIMITS,
  ITEM_MODE_LABEL,
  UNIT_STATUS_LABEL,
  type CatalogUnit,
  type InventoryError,
  type ItemCondition,
  type ItemDetail,
  type ListEntry,
} from "../types";
import { ActionErrorBlock, defaultActionError, SavedNotice, useInventoryAction } from "./action-sheet";
import { ConditionChip, UnitChip } from "./chips";
import { COPY, STAFF_COPY, tooLongText } from "./copy";
import { formatCount } from "./format";
import { DiscardSheet, FormCard, FormSummary } from "./form-parts";
import { EntrySelect } from "./item-form";
import { itemHref, itemNoticeHref, listsHref } from "./routes";
import {
  ItemArchiveDialog,
  StockAddDialog,
  StockMoveDialog,
  StockWriteOffDialog,
  UnitAddDialog,
  UnitArchiveDialog,
  UnitConditionDialog,
  UnitRestoreDialog,
  UnitWriteOffDialog,
  type DialogKind,
} from "./stock-dialogs";

type FieldKey = "name" | "description";
const FIELD_ID: Record<FieldKey, string> = { name: "item-name", description: "item-description" };

const STOCK_ROWS: { key: ItemCondition; count: (s: ItemDetail["stock"]) => number }[] = [
  { key: "good", count: (s) => s.good },
  { key: "needs_service", count: (s) => s.needsService },
  { key: "damaged", count: (s) => s.damaged },
];

/**
 * "Ubah barang" (design 7.3). Name, description, category and location are edited here and saved with
 * "Simpan"; stock never changes through a number field, only through the named dialogs (P6 a), each
 * with a reason. Code and the way of recording are fixed. Archive and reactivate sit at the bottom.
 */
export function ItemEditForm({ item, categories, locations }: { item: ItemDetail; categories: ListEntry[]; locations: ListEntry[] }) {
  const { router, busy, error, setError, run } = useInventoryAction();
  // One-tap actions (Aktifkan kembali) answer in their own message, near the top of the screen.
  const quick = useInventoryAction();
  const summaryRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [categoryId, setCategoryId] = useState(item.categoryId ?? "");
  const [locationId, setLocationId] = useState(item.locationId ?? "");
  /** Unit locations changed on this form, saved with "Simpan" (unit id -> location id or ""). */
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogSeq, setDialogSeq] = useState(0);

  const detailHref = itemHref(item.itemId);
  const activeCategories = categories.filter((c) => c.isActive);
  const activeLocations = locations.filter((l) => l.isActive);
  const keepCategory = categories.find((c) => c.id === item.categoryId && !c.isActive) ?? null;
  const keepLocation = locations.find((l) => l.id === item.locationId && !l.isActive) ?? null;

  const unitMoves = item.units.filter((u) => u.unitId in moved && (moved[u.unitId] || null) !== u.locationId);
  const dirty =
    name !== item.name ||
    description !== (item.description ?? "") ||
    categoryId !== (item.categoryId ?? "") ||
    locationId !== (item.locationId ?? "") ||
    unitMoves.length > 0;

  function leave(target: string) {
    if (busy) return;
    if (dirty) setDiscardTarget(target);
    else router.push(target);
  }

  function openDialog(next: DialogKind) {
    setNotice(null);
    setDialog(next);
    setDialogSeq((n) => n + 1);
    setDialogOpen(true);
  }

  function dialogDone(text: string) {
    setDialogOpen(false);
    setNotice(text);
    router.refresh();
  }

  function fieldsFor(e: InventoryError): Partial<Record<FieldKey, string>> | null {
    if (e.code === "text_required" && e.field === "name") return { name: STAFF_COPY.nameMissing };
    if (e.code === "text_too_long" && e.field === "name") return { name: tooLongText("Nama barang", INVENTORY_LIMITS.itemName) };
    if (e.code === "text_too_long" && e.field === "description") {
      return { description: tooLongText("Deskripsi", INVENTORY_LIMITS.itemDescription) };
    }
    return null;
  }

  function showErrors(next: Partial<Record<FieldKey, string>>) {
    setErrors(next);
    setError(null);
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const found: Partial<Record<FieldKey, string>> = {};
    if (name.trim() === "") found.name = STAFF_COPY.nameMissing;
    else if ([...name.trim()].length > INVENTORY_LIMITS.itemName) found.name = tooLongText("Nama barang", INVENTORY_LIMITS.itemName);
    if ([...description.trim()].length > INVENTORY_LIMITS.itemDescription) {
      found.description = tooLongText("Deskripsi", INVENTORY_LIMITS.itemDescription);
    }
    if (found.name || found.description) {
      showErrors(found);
      return;
    }
    setErrors({});
    setNotice(null);

    // One call for the item fields, then one per moved unit. Each writes its own history row.
    await run(
      async () => {
        const saved = await updateItem({
          itemId: item.itemId,
          name,
          description,
          categoryId: categoryId || null,
          locationId: item.mode === "quantity" ? locationId || null : null,
        });
        if (!saved.ok) return saved;
        let changed = saved.data.changed;
        for (const unit of unitMoves) {
          const result = await moveUnit({ unitId: unit.unitId, locationId: moved[unit.unitId] || null });
          if (!result.ok) return result;
          changed = changed || result.data.changed;
        }
        return { ok: true as const, data: { changed } };
      },
      {
        onOk: (data) => router.push(data.changed ? itemNoticeHref(item.itemId, { kind: "saved" }) : detailHref, { scroll: true }),
        onError: (e) => {
          const fields = fieldsFor(e);
          if (fields) {
            showErrors(fields);
            return null;
          }
          requestAnimationFrame(() => summaryRef.current?.focus());
          return defaultActionError(e, "manage");
        },
      },
    );
  }

  async function reactivateItem() {
    await quick.run(() => setItemActive({ itemId: item.itemId, isActive: true }), {
      onOk: () => router.push(itemNoticeHref(item.itemId, { kind: "reactivated" }), { scroll: true }),
      onError: (e) => defaultActionError(e, "manage"),
    });
  }

  async function reactivateUnit(unit: CatalogUnit) {
    setNotice(null);
    await quick.run(() => setUnitActive({ unitId: unit.unitId, isActive: true }), {
      onOk: () => {
        setNotice(STAFF_COPY.itemSaved);
        router.refresh();
      },
      onError: (e) => defaultActionError(e, "manage"),
    });
  }

  const problems = (["name", "description"] as const).flatMap((key) =>
    errors[key] ? [{ id: FIELD_ID[key], text: errors[key] as string }] : [],
  );
  const total = item.stock.total;

  return (
    <>
      <button
        type="button"
        onClick={() => leave(detailHref)}
        className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-label-lg text-walnut hover:bg-ivory"
      >
        <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2} />
        Kembali
      </button>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-display-sm text-title">Ubah barang</h1>
          {item.isActive ? null : <StatusChip tone="ivory">{UNIT_STATUS_LABEL.archived}</StatusChip>}
        </div>
        {item.mode === "quantity" && item.code ? (
          <p className="text-body-md text-ink-body tabular-nums">
            Kode <span className="font-semibold text-ink">{item.code}</span>
            <span className="block text-body-sm">{STAFF_COPY.codeFixed}</span>
          </p>
        ) : null}
        <p className="text-body-md text-ink-body">{ITEM_MODE_LABEL[item.mode]} (tidak bisa diubah)</p>
      </div>

      <SavedNotice text={notice} />
      <ActionErrorBlock error={quick.error} onReload={() => router.refresh()} />

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        <FormSummary ref={summaryRef} problems={problems} message={problems.length > 0 ? null : error} />

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
                if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
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
              if (errors.description) setErrors((prev) => ({ ...prev, description: undefined }));
            }}
          />
          <EntrySelect
            id="item-category"
            label="Kategori (boleh kosong)"
            placeholder="Pilih kategori"
            emptyOption={STAFF_COPY.noCategoryOption}
            addLabel={STAFF_COPY.addCategoryLink}
            entries={activeCategories}
            keep={keepCategory}
            value={categoryId}
            onChange={setCategoryId}
            onAdd={() => leave(listsHref("category"))}
          />
          {item.mode === "quantity" ? (
            <EntrySelect
              id="item-location"
              label="Lokasi (boleh kosong)"
              placeholder="Pilih lokasi"
              emptyOption={STAFF_COPY.noLocationOption}
              addLabel={STAFF_COPY.addLocationLink}
              entries={activeLocations}
              keep={keepLocation}
              value={locationId}
              onChange={setLocationId}
              onAdd={() => leave(listsHref("location"))}
            />
          ) : null}
        </FormCard>

        {item.mode === "quantity" ? (
          <section aria-labelledby="item-stock-title" className="rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
            <h2 id="item-stock-title" className="text-headline-sm text-ink">
              Stok per kondisi
            </h2>
            <dl className="mt-3 flex flex-col gap-2">
              {STOCK_ROWS.map(({ key, count }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <dt>
                    <ConditionChip condition={key} />
                  </dt>
                  <dd className="text-body-md font-semibold text-ink tabular-nums">{formatCount(count(item.stock))}</dd>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-row-line pt-2">
                <dt className="text-body-md font-semibold text-ink">Total</dt>
                <dd className="text-body-md font-bold text-ink tabular-nums">{formatCount(total)}</dd>
              </div>
            </dl>
            {item.isActive ? (
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                <button type="button" onClick={() => openDialog({ kind: "stock_add" })} className={buttonClass("text", "-ml-2")}>
                  Tambah jumlah
                </button>
                {total > 0 ? (
                  <>
                    <button type="button" onClick={() => openDialog({ kind: "stock_move" })} className={buttonClass("text")}>
                      Ubah kondisi
                    </button>
                    <button type="button" onClick={() => openDialog({ kind: "stock_write_off" })} className={buttonClass("text", "-ml-2")}>
                      Keluarkan dari stok
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : (
          <section aria-labelledby="item-units-title" className="rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
            <h2 id="item-units-title" className="text-headline-sm text-ink">
              Unit
            </h2>
            {item.units.length === 0 ? <p className="mt-2 text-body-md text-ink-body">{STAFF_COPY.unitsMissing}</p> : null}
            <ul className="mt-2 flex flex-col divide-y divide-row-line">
              {item.units.map((unit) => (
                <li key={unit.unitId} className="flex flex-col gap-2 py-3 last:pb-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-body-md font-semibold text-ink tabular-nums">{unit.code}</span>
                    <UnitChip condition={unit.condition} status={unit.status} />
                  </p>
                  {unit.status === "active" ? (
                    <>
                      <SelectField
                        id={`unit-location-${unit.unitId}`}
                        label={`Lokasi ${unit.code}`}
                        value={unit.unitId in moved ? moved[unit.unitId] : (unit.locationId ?? "")}
                        disabled={busy}
                        onChange={(event) => {
                          const value = event.target.value;
                          setMoved((prev) => ({ ...prev, [unit.unitId]: value }));
                        }}
                      >
                        <option value="">{COPY.noLocation}</option>
                        {unitLocationOptions(locations, unit.locationId).map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.isActive ? l.name : `${l.name} (nonaktif)`}
                          </option>
                        ))}
                      </SelectField>
                      {item.isActive ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          <button
                            type="button"
                            aria-label={`Ubah kondisi ${unit.code}`}
                            onClick={() => openDialog({ kind: "unit_condition", unit })}
                            className={buttonClass("text", "-ml-2")}
                          >
                            Ubah kondisi
                          </button>
                          <button
                            type="button"
                            aria-label={`Keluarkan ${unit.code}`}
                            onClick={() => openDialog({ kind: "unit_write_off", unit })}
                            className={buttonClass("text")}
                          >
                            Keluarkan
                          </button>
                          <button
                            type="button"
                            aria-label={`Nonaktifkan ${unit.code}`}
                            onClick={() => openDialog({ kind: "unit_archive", unit })}
                            className={buttonClass("text")}
                          >
                            Nonaktifkan
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="text-body-sm text-ink-body">{unit.locationName ?? COPY.noLocation}</p>
                      {unit.status === "archived" ? (
                        <button
                          type="button"
                          aria-label={`Aktifkan kembali ${unit.code}`}
                          onClick={() => void reactivateUnit(unit)}
                          className={buttonClass("text", "-ml-2 self-start")}
                        >
                          Aktifkan kembali
                        </button>
                      ) : item.isActive ? (
                        <button
                          type="button"
                          aria-label={`Ditemukan kembali ${unit.code}`}
                          onClick={() => openDialog({ kind: "unit_restore", unit })}
                          className={buttonClass("text", "-ml-2 self-start")}
                        >
                          Ditemukan kembali
                        </button>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {item.isActive ? (
              <button type="button" onClick={() => openDialog({ kind: "unit_add" })} className={buttonClass("outline", "mt-3")}>
                <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
                Tambah unit
              </button>
            ) : null}
          </section>
        )}

        <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : undefined)}>
          {busy ? <Spinner /> : null}
          {busy ? "Menyimpan..." : "Simpan"}
        </button>
        <button type="button" onClick={() => leave(detailHref)} className={buttonClass("text", "self-center")}>
          Batal
        </button>
      </form>

      <div className="flex flex-col gap-3 border-t border-surface-line pt-4">
        {item.isActive ? (
          <button type="button" onClick={() => openDialog({ kind: "item_archive" })} className={buttonClass("outline")}>
            Nonaktifkan barang
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void reactivateItem()}
            aria-busy={quick.busy || undefined}
            className={buttonClass("outline", quick.busy ? "cursor-progress" : undefined)}
          >
            {quick.busy ? <Spinner /> : null}
            {quick.busy ? "Menyimpan..." : "Aktifkan kembali"}
          </button>
        )}
      </div>

      <ItemDialog
        key={dialogSeq}
        dialog={dialog}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDone={dialogDone}
        item={item}
        locations={locations}
      />

      <DiscardSheet
        open={discardTarget !== null}
        onOpenChange={(open) => !open && setDiscardTarget(null)}
        onDiscard={() => discardTarget && router.push(discardTarget)}
      />
    </>
  );
}

/** Active locations, plus the unit's own location when it was deactivated (it may be kept). */
function unitLocationOptions(locations: ListEntry[], current: string | null): ListEntry[] {
  return locations.filter((l) => l.isActive || l.id === current);
}

function ItemDialog({
  dialog,
  item,
  locations,
  ...props
}: {
  dialog: DialogKind | null;
  item: ItemDetail;
  locations: ListEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (notice: string) => void;
}) {
  if (!dialog) return null;
  switch (dialog.kind) {
    case "stock_add":
      return <StockAddDialog item={item} {...props} />;
    case "stock_move":
      return <StockMoveDialog item={item} {...props} />;
    case "stock_write_off":
      return <StockWriteOffDialog item={item} {...props} />;
    case "item_archive":
      return <ItemArchiveDialog item={item} {...props} />;
    case "unit_add":
      return <UnitAddDialog item={item} locations={locations} {...props} />;
    case "unit_condition":
      return <UnitConditionDialog unit={dialog.unit} {...props} />;
    case "unit_write_off":
      return <UnitWriteOffDialog unit={dialog.unit} {...props} />;
    case "unit_archive":
      return <UnitArchiveDialog unit={dialog.unit} {...props} />;
    case "unit_restore":
      return <UnitRestoreDialog unit={dialog.unit} {...props} />;
  }
}
