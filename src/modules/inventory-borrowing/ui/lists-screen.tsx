"use client";

import { useRef, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { addListEntry, renameListEntry, setListEntryActive } from "../server/manage-actions";
import { FieldError } from "@/components/ui/field-error";
import { ModuleNav } from "@/components/ui/module-nav";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { StatusChip } from "@/components/ui/status-chip";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/utils";
import {
  INVENTORY_ERROR_COPY,
  INVENTORY_LIMITS,
  UNIT_STATUS_LABEL,
  type InventoryError,
  type InventoryListKind,
  type ListEntry,
} from "../types";
import { ActionErrorBlock, ActionSheet, defaultActionError, useInventoryAction, type ActionError } from "./action-sheet";
import { STAFF_COPY, tooLongText } from "./copy";
import { formatCount } from "./format";
import { listsHref, MANAGE_PATH } from "./routes";
import { BackLink } from "./states";

const KIND_TEXT: Record<InventoryListKind, { noun: string; label: string; max: number; added: string; empty: string }> = {
  category: {
    noun: "kategori",
    label: "Nama kategori (wajib)",
    max: INVENTORY_LIMITS.categoryName,
    added: "Kategori ditambahkan.", // 8.2
    empty: "Belum ada kategori. Tambahkan yang pertama di atas.", // 8.3
  },
  location: {
    noun: "lokasi",
    label: "Nama lokasi (wajib)",
    max: INVENTORY_LIMITS.locationName,
    added: "Lokasi ditambahkan.", // 8.2 pattern
    empty: "Belum ada lokasi. Tambahkan yang pertama di atas.", // 8.3
  },
};

/** The name field's text for a refusal, or null when it is not about the name. */
function nameError(e: InventoryError, max: number): string | null {
  if (e.code === "text_required") return STAFF_COPY.listNameMissing;
  if (e.code === "text_too_long") return tooLongText("Nama", max);
  if (e.code === "duplicate_name") return INVENTORY_ERROR_COPY.duplicate_name;
  return null;
}

/**
 * "Kategori dan lokasi" (design screen 5, section 8). Operations keep the two pick lists, starting from
 * empty (IB10), and never delete: an entry is renamed or deactivated, and can be reactivated.
 * Entries arrive A-Z from the server (G6: no reorder).
 */
export function ListsScreen({ kind, entries }: { kind: InventoryListKind; entries: ListEntry[] }) {
  const text = KIND_TEXT[kind];
  const active = entries.filter((e) => e.isActive);
  const inactive = entries.filter((e) => !e.isActive);
  const [announce, setAnnounce] = useState("");

  return (
    <>
      <BackLink href={MANAGE_PATH}>Kelola Barang</BackLink>
      <h1 className="font-heading text-display-sm text-title">Kategori dan lokasi</h1>
      <ModuleNav
        label={STAFF_COPY.listKindNav}
        current={kind}
        items={[
          { key: "category", href: listsHref("category"), label: "Kategori" },
          { key: "location", href: listsHref("location"), label: "Lokasi" },
        ]}
      />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <AddEntryCard key={kind} kind={kind} onAdded={() => setAnnounce(text.added)} />

        <div className="flex flex-col gap-3">
          <div role="status" aria-live="polite" className="sr-only">
            {announce}
          </div>
          <section aria-label={`Daftar ${text.noun} aktif`} className="overflow-hidden rounded-xl border border-surface-line bg-surface shadow-elevation-1">
            {active.length === 0 ? (
              <p className="p-4 text-body-md text-ink-body">{text.empty}</p>
            ) : (
              <ul>
                {active.map((entry, index) => (
                  <EntryRow key={entry.id} kind={kind} entry={entry} zebra={index % 2 === 1} onChanged={setAnnounce} />
                ))}
              </ul>
            )}
          </section>

          {inactive.length > 0 ? (
            <details className="group rounded-xl border border-surface-line bg-surface shadow-elevation-1">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 text-label-lg text-ink [&::-webkit-details-marker]:hidden">
                <span>
                  Nonaktif <span className="tabular-nums">({formatCount(inactive.length)})</span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 text-walnut transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                  strokeWidth={2}
                />
              </summary>
              <ul className="border-t border-surface-line">
                {inactive.map((entry, index) => (
                  <EntryRow key={entry.id} kind={kind} entry={entry} zebra={index % 2 === 1} onChanged={setAnnounce} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** "Tambah kategori" card: adds the entry as Aktif, clears the field, keeps focus in it (design 8.2). */
function AddEntryCard({ kind, onAdded }: { kind: InventoryListKind; onAdded: () => void }) {
  const text = KIND_TEXT[kind];
  const { router, busy, error, setError, run } = useInventoryAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (name.trim() === "") {
      setFieldError(STAFF_COPY.listNameMissing);
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    await run(() => addListEntry(kind === "category" ? { kind: "category", name } : { kind: "location", name }), {
      onOk: () => {
        setName("");
        onAdded();
        router.refresh();
        inputRef.current?.focus();
      },
      onError: (e) => {
        const field = nameError(e, text.max);
        if (field) {
          setFieldError(field);
          inputRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "manage");
      },
    });
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-labelledby={`add-${kind}-title`}
      className="flex flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1"
    >
      <h2 id={`add-${kind}-title`} className="text-headline-sm text-ink">
        Tambah {text.noun}
      </h2>
      <div className="flex flex-col gap-1.5">
        <TextField
          ref={inputRef}
          id={`add-${kind}-name`}
          label={text.label}
          value={name}
          maxLength={text.max + 20}
          autoComplete="off"
          readOnly={busy}
          invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? `add-${kind}-name-error` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setFieldError(null);
            setError(null);
          }}
        />
        {fieldError ? <FieldError id={`add-${kind}-name-error`}>{fieldError}</FieldError> : null}
      </div>
      <ActionErrorBlock error={error} onReload={() => router.refresh()} />
      <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", busy ? "cursor-progress" : undefined)}>
        {busy ? <Spinner /> : null}
        {busy ? "Menyimpan..." : "Tambah"}
      </button>
    </form>
  );
}

/**
 * One entry: name, status chip, how many items use it, and its actions. "Ubah nama" turns the row into
 * a field with Simpan and Batal (Escape cancels). "Nonaktifkan" asks first; "Aktifkan kembali" does not.
 */
function EntryRow({
  kind,
  entry,
  zebra,
  onChanged,
}: {
  kind: InventoryListKind;
  entry: ListEntry;
  zebra: boolean;
  onChanged: (text: string) => void;
}) {
  const text = KIND_TEXT[kind];
  const { router, busy, error, setError, run } = useInventoryAction();
  const renameRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fieldId = `entry-${entry.id}-name`;

  function startEdit() {
    setName(entry.name);
    setFieldError(null);
    setError(null);
    setEditing(true);
    requestAnimationFrame(() => renameRef.current?.focus());
  }

  function stopEdit() {
    setEditing(false);
    setFieldError(null);
    setError(null);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (name.trim() === "") {
      setFieldError(STAFF_COPY.listNameMissing);
      renameRef.current?.focus();
      return;
    }
    await run(() => renameListEntry(kind === "category" ? { kind: "category", id: entry.id, name } : { kind: "location", id: entry.id, name }), {
      onOk: () => {
        onChanged(STAFF_COPY.listRenamed);
        stopEdit();
        router.refresh();
      },
      onError: (e) => {
        const field = nameError(e, text.max);
        if (field) {
          setFieldError(field);
          renameRef.current?.focus();
          return null;
        }
        return defaultActionError(e, "manage");
      },
    });
  }

  async function setActive(isActive: boolean) {
    await run(() => setListEntryActive({ kind, id: entry.id, isActive }), {
      onOk: () => {
        setConfirmOpen(false);
        onChanged(isActive ? `${entry.name} diaktifkan kembali.` : `${entry.name} dinonaktifkan.`);
        router.refresh();
      },
      onError: (e): ActionError => defaultActionError(e, "manage"),
    });
  }

  return (
    <li className={cn("flex flex-col gap-2 border-t border-row-line px-4 py-3 first:border-t-0", zebra ? "bg-zebra" : "bg-surface")}>
      {editing ? (
        <form
          noValidate
          onSubmit={saveName}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) {
              event.preventDefault();
              stopEdit();
            }
          }}
          className="flex flex-col gap-2"
        >
          <div className="flex flex-col gap-1.5">
            <TextField
              ref={renameRef}
              id={fieldId}
              label={`Ubah nama ${entry.name}`}
              value={name}
              maxLength={text.max + 20}
              autoComplete="off"
              readOnly={busy}
              invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? `${fieldId}-error` : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setFieldError(null);
              }}
            />
            {fieldError ? <FieldError id={`${fieldId}-error`}>{fieldError}</FieldError> : null}
          </div>
          <ActionErrorBlock error={error} onReload={() => router.refresh()} />
          <div className="flex items-center gap-2">
            <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", "w-auto flex-1")}>
              {busy ? <Spinner /> : null}
              {busy ? "Menyimpan..." : "Simpan"}
            </button>
            <button type="button" onClick={() => !busy && stopEdit()} className={buttonClass("text")}>
              Batal
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-body-md font-semibold break-words text-ink">{entry.name}</span>
              {entry.isActive ? (
                <StatusChip tone="success">{UNIT_STATUS_LABEL.active}</StatusChip>
              ) : (
                <StatusChip tone="ivory">{UNIT_STATUS_LABEL.archived}</StatusChip>
              )}
            </p>
            <span className="text-body-sm text-ink-body tabular-nums">{formatCount(entry.itemCount)} barang</span>
          </div>
          {editing || confirmOpen ? null : <ActionErrorBlock error={error} onReload={() => router.refresh()} />}
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            <button
              ref={editButtonRef}
              type="button"
              aria-label={`Ubah nama ${entry.name}`}
              onClick={startEdit}
              className={buttonClass("text", "-ml-2")}
            >
              Ubah nama
            </button>
            {entry.isActive ? (
              <button
                type="button"
                aria-label={`Nonaktifkan ${entry.name}`}
                onClick={() => {
                  setError(null);
                  setConfirmOpen(true);
                }}
                className={buttonClass("text")}
              >
                Nonaktifkan
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Aktifkan kembali ${entry.name}`}
                aria-busy={busy || undefined}
                onClick={() => void setActive(true)}
                className={buttonClass("text")}
              >
                {busy ? <Spinner /> : null}
                Aktifkan kembali
              </button>
            )}
          </div>
        </>
      )}

      <ActionSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Nonaktifkan ${entry.name}?`}
        description={STAFF_COPY.listDeactivateBody}
        primaryLabel="Nonaktifkan"
        busy={busy}
        error={confirmOpen ? error : null}
        onSubmit={() => void setActive(false)}
      />
    </li>
  );
}
