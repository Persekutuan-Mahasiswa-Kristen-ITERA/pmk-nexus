import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import {
  LETTER_CHIP_LABEL,
  LETTER_REQUEST_STATUS_LABEL,
  LETTER_STATUS_LABEL,
  letterRequestStage,
  type LetterRequestStatus,
  type LetterStatus,
} from "../types";

// Screen 13 (docs/design/letters.md section 16): one chip family for request statuses, register
// statuses and markers. Five tones cover every meaning because the words do the work.

export const REQUEST_STATUS_TONE: Record<LetterRequestStatus, ChipTone> = {
  submitted: "ivory",
  processing: "warning",
  issued: "success",
  rejected: "danger",
  cancelled: "grey",
};

export const LETTER_STATUS_TONE: Record<LetterStatus, ChipTone> = { active: "success", voided: "grey" };

/**
 * A request's chips: the status, plus "Menunggu file" (number taken) or "Nomor dibatalkan", plus
 * "Lewat tanggal" for secretaries. At most two on a list row (design 16, last line): the status and the
 * marker that matters most.
 */
export function RequestChips({
  source,
  compact = false,
}: {
  source: { status: LetterRequestStatus; numberText: string | null; numberVoided?: boolean; isPastDue?: boolean | null };
  compact?: boolean;
}) {
  const stage = letterRequestStage(source);
  const markers: { key: string; tone: ChipTone; text: string }[] = [];
  if (stage === "awaiting_file") markers.push({ key: "file", tone: "ivory", text: LETTER_CHIP_LABEL.awaitingFile });
  if (stage === "issued_number_voided") markers.push({ key: "void", tone: "grey", text: LETTER_CHIP_LABEL.numberVoided });
  if (source.isPastDue) markers.push({ key: "due", tone: "warning", text: LETTER_CHIP_LABEL.pastDue });
  const shown = compact ? markers.slice(0, 1) : markers;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusChip tone={REQUEST_STATUS_TONE[source.status]}>{LETTER_REQUEST_STATUS_LABEL[source.status]}</StatusChip>
      {shown.map((chip) => (
        <StatusChip key={chip.key} tone={chip.tone}>
          {chip.text}
        </StatusChip>
      ))}
    </span>
  );
}

/** Register status chip ("Aktif" only on the detail; rows show only the exceptions, K9). */
export function LetterStatusChip({ status }: { status: LetterStatus }) {
  return <StatusChip tone={LETTER_STATUS_TONE[status]}>{LETTER_STATUS_LABEL[status]}</StatusChip>;
}

/** The quiet register row (K9, P3): only "Dibatalkan" and "Nomor lama" get a chip. */
export function RegisterRowChips({ status, isLegacyNumber }: { status: LetterStatus; isLegacyNumber: boolean }) {
  if (status === "active" && !isLegacyNumber) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {status === "voided" ? <LetterStatusChip status="voided" /> : null}
      {isLegacyNumber ? <StatusChip tone="ivory">{LETTER_CHIP_LABEL.legacyNumber}</StatusChip> : null}
    </span>
  );
}
