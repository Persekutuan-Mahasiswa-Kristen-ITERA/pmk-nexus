"use client";

import { useRef, useState, type FormEvent } from "react";
import { recordReturn } from "../server/borrowing-actions";
import { AlertMessage } from "@/components/ui/alert-message";
import { FieldError } from "@/components/ui/field-error";
import { TextareaField } from "@/components/ui/form-fields";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { RadioRow } from "@/components/ui/radio-row";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  CONDITION_LABEL,
  INVENTORY_ERROR_COPY,
  INVENTORY_LIMITS,
  type DamagedCondition,
  type RequestDetail,
  type RequestLine,
  type ReturnOutcomeInput,
} from "../types";
import { ActionErrorBlock, defaultActionError, useInventoryAction } from "./action-sheet";
import { COPY, overReturnText, STAFF_COPY, tooLongText } from "./copy";
import { formatCount } from "./format";
import { DiscardSheet, FormSummary } from "./form-parts";
import { PhotoPicker, type PhotoSummary } from "./photo-picker";
import { requestHref } from "./routes";

type UnitOutcome = "good" | "damaged" | "lost" | "none";
type Evidence = { note: string; condition: DamagedCondition | null; photos: PhotoSummary };
type QtyState = { good: number; damaged: number; lost: number };

const NO_PHOTOS: PhotoSummary = { paths: [], pending: false, failed: false };
const EMPTY_EVIDENCE: Evidence = { note: "", condition: null, photos: NO_PHOTOS };
const SEGMENTS: { value: UnitOutcome; label: string }[] = [
  { value: "good", label: "Baik" },
  { value: "damaged", label: "Rusak" },
  { value: "lost", label: "Hilang" },
  { value: "none", label: "Belum" },
];

/** A problem the form found, linked to the field that needs it (design 3.4). */
type Problem = { id: string; text: string };

/**
 * "Terima pengembalian" (design screen 10). Default: everything still out came back in good condition;
 * the person marks only the exceptions (K7). Damaged or lost needs a note and 1 to 3 photos (IB8).
 * What is not counted stays with the borrower (partial return). One calm check before saving (P15).
 */
export function ReturnForm({ detail }: { detail: RequestDetail }) {
  const { router, busy, error, setError, run } = useInventoryAction();
  const summaryRef = useRef<HTMLDivElement>(null);
  const lines = detail.lines.filter((line) => line.outstanding > 0);

  const [qty, setQty] = useState<Record<string, QtyState>>(() =>
    Object.fromEntries(lines.filter((l) => l.mode === "quantity").map((l) => [l.lineId, { good: l.outstanding, damaged: 0, lost: 0 }])),
  );
  const [unitOutcome, setUnitOutcome] = useState<Record<string, UnitOutcome>>({});
  /** Evidence per block: "{lineId}:damaged", "{lineId}:lost" for quantity items, "{unitId}" for units. */
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [problems, setProblems] = useState<Problem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const back = requestHref(detail.reference);
  const ev = (key: string) => evidence[key] ?? EMPTY_EVIDENCE;
  const outcomeOf = (unitId: string) => unitOutcome[unitId] ?? "good";
  const problemText = (id: string) => problems.find((p) => p.id === id)?.text ?? null;

  function setEv(key: string, next: Partial<Evidence>) {
    setEvidence((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_EVIDENCE), ...next } }));
  }

  function clearProblem(id: string) {
    if (problems.some((p) => p.id === id)) setProblems((prev) => prev.filter((p) => p.id !== id));
  }

  // Totals for the live "Masih di peminjam" and the check before saving.
  const totals = lines.reduce(
    (sum, line) => {
      if (line.mode === "quantity") {
        const q = qty[line.lineId];
        return { good: sum.good + q.good, damaged: sum.damaged + q.damaged, lost: sum.lost + q.lost, out: sum.out + line.outstanding };
      }
      const out = line.units.filter((u) => u.isOut);
      const count = (o: UnitOutcome) => out.filter((u) => outcomeOf(u.unitId) === o).length;
      return { good: sum.good + count("good"), damaged: sum.damaged + count("damaged"), lost: sum.lost + count("lost"), out: sum.out + out.length };
    },
    { good: 0, damaged: 0, lost: 0, out: 0 },
  );
  const remaining = Math.max(0, totals.out - totals.good - totals.damaged - totals.lost);
  const dirty =
    Object.keys(unitOutcome).length > 0 ||
    Object.keys(evidence).length > 0 ||
    lines.some((l) => l.mode === "quantity" && (qty[l.lineId].damaged > 0 || qty[l.lineId].lost > 0 || qty[l.lineId].good !== l.outstanding));

  /** The evidence blocks that are open now, each with what the form must check. */
  function openBlocks(): { key: string; damaged: boolean; label: string }[] {
    const blocks: { key: string; damaged: boolean; label: string }[] = [];
    for (const line of lines) {
      if (line.mode === "quantity") {
        if (qty[line.lineId].damaged > 0) blocks.push({ key: `${line.lineId}:damaged`, damaged: true, label: line.itemName });
        if (qty[line.lineId].lost > 0) blocks.push({ key: `${line.lineId}:lost`, damaged: false, label: line.itemName });
      } else {
        for (const unit of line.units.filter((u) => u.isOut)) {
          const o = outcomeOf(unit.unitId);
          if (o === "damaged" || o === "lost") blocks.push({ key: unit.unitId, damaged: o === "damaged", label: unit.code });
        }
      }
    }
    return blocks;
  }

  function validate(): { problems: Problem[]; message: string | null } {
    const found: Problem[] = [];
    let message: string | null = null;
    for (const line of lines) {
      if (line.mode !== "quantity") continue;
      const q = qty[line.lineId];
      if (q.good + q.damaged + q.lost > line.outstanding) {
        found.push({ id: `return-good-${line.lineId}`, text: `${line.itemName}: ${overReturnText(line.outstanding)}` });
      }
    }
    for (const block of openBlocks()) {
      const e = ev(block.key);
      if (block.damaged && e.condition === null) {
        found.push({ id: `return-cond-${block.key}`, text: `${block.label}: ${STAFF_COPY.returnConditionMissing}` });
      }
      if (e.note.trim() === "") found.push({ id: `return-note-${block.key}`, text: `${block.label}: ${STAFF_COPY.returnNoteMissing}` });
      // Still uploading wins; a failed upload blocks the save until it is retried or removed (13.3).
      if (e.photos.pending) message = STAFF_COPY.waitForPhotos;
      else if (e.photos.failed) message = message ?? STAFF_COPY.photoFailedSave;
      if (e.photos.paths.length === 0 && !e.photos.pending && !e.photos.failed) {
        found.push({ id: `return-photo-${block.key}`, text: `${block.label}: ${INVENTORY_ERROR_COPY.photo_count}` });
      }
    }
    if (found.length === 0 && message === null && totals.good + totals.damaged + totals.lost === 0) message = STAFF_COPY.returnNothing;
    return { problems: found, message };
  }

  function outcomes(): ReturnOutcomeInput[] {
    const list: ReturnOutcomeInput[] = [];
    for (const line of lines) {
      if (line.mode === "quantity") {
        const q = qty[line.lineId];
        if (q.good > 0) list.push({ outcome: "good", lineId: line.lineId, quantity: q.good });
        if (q.damaged > 0) {
          const e = ev(`${line.lineId}:damaged`);
          list.push({
            outcome: "damaged",
            lineId: line.lineId,
            quantity: q.damaged,
            resultingCondition: e.condition ?? "needs_service",
            note: e.note,
            photos: e.photos.paths,
          });
        }
        if (q.lost > 0) {
          const e = ev(`${line.lineId}:lost`);
          list.push({ outcome: "lost", lineId: line.lineId, quantity: q.lost, note: e.note, photos: e.photos.paths });
        }
      } else {
        for (const unit of line.units.filter((u) => u.isOut)) {
          const o = outcomeOf(unit.unitId);
          const e = ev(unit.unitId);
          if (o === "good") list.push({ outcome: "good", lineId: line.lineId, unitId: unit.unitId });
          if (o === "damaged") {
            list.push({
              outcome: "damaged",
              lineId: line.lineId,
              unitId: unit.unitId,
              resultingCondition: e.condition ?? "needs_service",
              note: e.note,
              photos: e.photos.paths,
            });
          }
          if (o === "lost") list.push({ outcome: "lost", lineId: line.lineId, unitId: unit.unitId, note: e.note, photos: e.photos.paths });
        }
      }
    }
    return list;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const result = validate();
    setProblems(result.problems);
    if (result.problems.length > 0 || result.message) {
      setError(result.message && result.problems.length === 0 ? { text: result.message } : null);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function save() {
    const list = outcomes();
    const issue = list.some((o) => o.outcome !== "good");
    await run(() => recordReturn({ requestId: detail.requestId, version: detail.version, outcomes: list }), {
      onOk: (data) => {
        setConfirmOpen(false);
        const notice = data.status === "borrowed" ? "returned_partial" : issue ? "returned_issue" : "returned_all";
        router.push(requestHref(detail.reference, notice), { scroll: true });
      },
      onError: (e) => {
        if (e.code === "note_required") return { text: STAFF_COPY.returnNoteMissing };
        if (e.code === "text_too_long") return { text: tooLongText("Catatan", INVENTORY_LIMITS.note) };
        if (e.code === "invalid_condition") return { text: STAFF_COPY.returnConditionMissing };
        // More than is still out: the screen shows old numbers.
        if (e.code === "quantity_invalid") return { text: COPY.stateChanged, reload: true };
        return defaultActionError(e, "return");
      },
    });
  }

  return (
    <>
      {detail.isOwn ? (
        <AlertMessage role="status" tone="info">
          {STAFF_COPY.returnOwn}
        </AlertMessage>
      ) : null}

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-4">
        <FormSummary ref={summaryRef} problems={problems} message={problems.length > 0 || confirmOpen ? null : error} />

        {lines.map((line) =>
          line.mode === "quantity" ? (
            <QuantityLine
              key={line.lineId}
              line={line}
              value={qty[line.lineId]}
              requestId={detail.requestId}
              busy={busy}
              problemText={problemText}
              evidence={ev}
              setEvidence={setEv}
              clearProblem={clearProblem}
              onChange={(next) => {
                setQty((prev) => ({ ...prev, [line.lineId]: next }));
                clearProblem(`return-good-${line.lineId}`);
              }}
            />
          ) : (
            <TrackedLine
              key={line.lineId}
              line={line}
              requestId={detail.requestId}
              busy={busy}
              outcomeOf={outcomeOf}
              problemText={problemText}
              evidence={ev}
              setEvidence={setEv}
              clearProblem={clearProblem}
              onOutcome={(unitId, outcome) => setUnitOutcome((prev) => ({ ...prev, [unitId]: outcome }))}
            />
          ),
        )}

        <p role="status" className="text-body-md font-semibold text-ink tabular-nums">
          Masih di peminjam: {formatCount(remaining)}
        </p>

        <button type="submit" className={buttonClass("primary")}>
          Catat pengembalian
        </button>
        <button
          type="button"
          onClick={() => (busy ? undefined : dirty ? setDiscardOpen(true) : router.push(back))}
          className={buttonClass("text", "self-center")}
        >
          Batal
        </button>
      </form>

      <Sheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={STAFF_COPY.returnConfirmTitle}
        description={`Kembali baik ${formatCount(totals.good)}, rusak ${formatCount(totals.damaged)}, hilang ${formatCount(totals.lost)}. Masih di peminjam: ${formatCount(remaining)}.`}
        busy={busy}
        footer={
          <>
            <ActionErrorBlock
              error={error}
              onReload={() => {
                setConfirmOpen(false);
                router.refresh();
              }}
            />
            <button
              type="button"
              onClick={() => void save()}
              aria-busy={busy || undefined}
              className={buttonClass("primary", busy ? "cursor-progress" : undefined)}
            >
              {busy ? <Spinner /> : null}
              {busy ? "Menyimpan..." : "Simpan pengembalian"}
            </button>
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => !busy && setConfirmOpen(false)}
              className={buttonClass("text", "self-center")}
            >
              Periksa lagi
            </button>
          </>
        }
      />

      <DiscardSheet open={discardOpen} onOpenChange={setDiscardOpen} onDiscard={() => router.push(back)} />
    </>
  );
}

type BlockProps = {
  requestId: string;
  busy: boolean;
  problemText: (id: string) => string | null;
  evidence: (key: string) => Evidence;
  setEvidence: (key: string, next: Partial<Evidence>) => void;
  clearProblem: (id: string) => void;
};

/** Quantity item: three steppers, then one evidence block per outcome that needs it (design 13.1). */
function QuantityLine({
  line,
  value,
  onChange,
  ...block
}: BlockProps & { line: RequestLine; value: QtyState; onChange: (next: QtyState) => void }) {
  const over = block.problemText(`return-good-${line.lineId}`);
  const rows: { key: keyof QtyState; label: string }[] = [
    { key: "good", label: "Kembali baik" },
    { key: "damaged", label: "Rusak" },
    { key: "lost", label: "Hilang" },
  ];
  const remaining = Math.max(0, line.outstanding - value.good - value.damaged - value.lost);

  function change(key: keyof QtyState, n: number) {
    const next = { ...value, [key]: n };
    // Marking an exception takes it out of "Kembali baik", so the person taps only the exception (K7).
    if (key !== "good") next.good = Math.max(0, Math.min(next.good, line.outstanding - next.damaged - next.lost));
    onChange(next);
  }

  return (
    <section aria-labelledby={`return-line-${line.lineId}`} className="flex flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
      <div>
        <h2 id={`return-line-${line.lineId}`} className="text-headline-sm break-words text-ink">
          {line.itemName}
        </h2>
        <p className="text-body-sm text-ink-meta tabular-nums">
          {line.itemCode ?? ""} · Belum kembali: {formatCount(line.outstanding)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label htmlFor={`return-${row.key}-${line.lineId}`} className="text-body-md text-ink">
              {row.label}
            </label>
            <QuantityStepper
              id={`return-${row.key}-${line.lineId}`}
              value={value[row.key]}
              min={0}
              max={line.outstanding}
              label={`${row.label.toLowerCase()} ${line.itemName}`}
              readOnly={block.busy}
              invalid={Boolean(over)}
              describedBy={over ? `return-over-${line.lineId}` : undefined}
              onChange={(n) => change(row.key, n)}
            />
          </div>
        ))}
        {over ? <FieldError id={`return-over-${line.lineId}`}>{overReturnText(line.outstanding)}</FieldError> : null}
        <p className="text-body-sm text-ink-body tabular-nums">Masih di peminjam: {formatCount(remaining)}</p>
      </div>
      {value.damaged > 0 ? (
        <EvidenceBlock {...block} blockKey={`${line.lineId}:damaged`} title={`Barang rusak (${formatCount(value.damaged)})`} damaged />
      ) : null}
      {value.lost > 0 ? (
        <EvidenceBlock {...block} blockKey={`${line.lineId}:lost`} title={`Barang hilang (${formatCount(value.lost)})`} damaged={false} />
      ) : null}
    </section>
  );
}

/** Tracked item: one four-segment choice per unit still out; Rusak or Hilang opens its block. */
function TrackedLine({
  line,
  outcomeOf,
  onOutcome,
  ...block
}: BlockProps & { line: RequestLine; outcomeOf: (unitId: string) => UnitOutcome; onOutcome: (unitId: string, o: UnitOutcome) => void }) {
  const out = line.units.filter((u) => u.isOut);
  return (
    <section aria-labelledby={`return-line-${line.lineId}`} className="flex flex-col gap-3 rounded-xl border border-surface-line bg-surface p-4 shadow-elevation-1">
      <div>
        <h2 id={`return-line-${line.lineId}`} className="text-headline-sm break-words text-ink">
          {line.itemName}
        </h2>
        <p className="text-body-sm text-ink-meta tabular-nums">Belum kembali: {formatCount(out.length)} unit</p>
      </div>
      <ul className="flex flex-col gap-4 md:grid md:grid-cols-2">
        {out.map((unit) => {
          const outcome = outcomeOf(unit.unitId);
          return (
            <li key={unit.unitId} className="flex flex-col gap-2">
              <fieldset className="flex min-w-0 flex-col gap-1.5">
                <legend className="mb-1.5 text-body-md font-semibold text-ink tabular-nums">{unit.code}</legend>
                <div className="grid grid-cols-4 gap-1 rounded-lg bg-ivory p-1">
                  {SEGMENTS.map((segment) => {
                    const checked = outcome === segment.value;
                    return (
                      <label
                        key={segment.value}
                        className={cn(
                          "flex min-h-12 cursor-pointer items-center justify-center rounded-lg px-1 text-center has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-walnut",
                          checked ? "bg-walnut font-bold text-primary-foreground" : "text-ink-body hover:bg-surface",
                        )}
                      >
                        <input
                          type="radio"
                          name={`return-unit-${unit.unitId}`}
                          value={segment.value}
                          checked={checked}
                          onChange={() => !block.busy && onOutcome(unit.unitId, segment.value)}
                          className="sr-only"
                        />
                        <span className="text-label-lg">{segment.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {outcome === "damaged" || outcome === "lost" ? (
                <EvidenceBlock {...block} blockKey={unit.unitId} title={outcome === "damaged" ? "Rusak" : "Hilang"} damaged={outcome === "damaged"} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Condition now (damaged only), note and photos for one damaged or lost outcome (design 13.2). */
function EvidenceBlock({
  blockKey,
  title,
  damaged,
  requestId,
  busy,
  problemText,
  evidence,
  setEvidence,
  clearProblem,
}: BlockProps & { blockKey: string; title: string; damaged: boolean }) {
  const e = evidence(blockKey);
  const conditionError = problemText(`return-cond-${blockKey}`);
  const noteError = problemText(`return-note-${blockKey}`);
  const photoError = problemText(`return-photo-${blockKey}`);
  const strip = (text: string | null) => (text ? text.slice(text.indexOf(": ") + 2) : null);

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-ivory p-3">
      <p className="text-body-md font-semibold text-ink">{title}</p>
      {damaged ? (
        <fieldset aria-describedby={conditionError ? `return-cond-${blockKey}-error` : undefined} className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1.5 text-label-lg text-ink-label">Kondisi sekarang (wajib)</legend>
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            {(["needs_service", "damaged"] as const).map((c, index) => (
              <RadioRow
                key={c}
                id={index === 0 ? `return-cond-${blockKey}` : undefined}
                name={`return-cond-${blockKey}`}
                value={c}
                label={CONDITION_LABEL[c]}
                checked={e.condition === c}
                readOnly={busy}
                onChange={() => {
                  setEvidence(blockKey, { condition: c });
                  clearProblem(`return-cond-${blockKey}`);
                }}
              />
            ))}
          </div>
          {conditionError ? <FieldError id={`return-cond-${blockKey}-error`}>{strip(conditionError)}</FieldError> : null}
        </fieldset>
      ) : null}
      <TextareaField
        id={`return-note-${blockKey}`}
        label="Catatan (wajib)"
        value={e.note}
        maxLength={INVENTORY_LIMITS.note}
        readOnly={busy}
        error={strip(noteError) ?? undefined}
        onChange={(event) => {
          setEvidence(blockKey, { note: event.target.value });
          clearProblem(`return-note-${blockKey}`);
        }}
      />
      <PhotoPicker
        id={`return-photo-${blockKey}`}
        requestId={requestId}
        error={strip(photoError)}
        onChange={(photos) => {
          setEvidence(blockKey, { photos });
          if (photos.paths.length > 0) clearProblem(`return-photo-${blockKey}`);
        }}
      />
    </div>
  );
}
