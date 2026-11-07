import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import {
  CONDITION_LABEL,
  REQUEST_STATUS_LABEL,
  UNIT_STATUS_LABEL,
  type ItemCondition,
  type RequestDerivedFlags,
  type RequestStatus,
  type UnitStatus,
} from "../types";

// Screen 14 (docs/design/inventory-borrowing.md section 17): one chip family for request statuses,
// derived states and conditions. Five tones cover every meaning because the text does the work.

export const REQUEST_STATUS_TONE: Record<RequestStatus, ChipTone> = {
  submitted: "ivory",
  approved: "success",
  rejected: "danger",
  cancelled: "grey",
  borrowed: "warning",
  returned: "success", // P9: green like Disetujui (A-IB40)
};

export const CONDITION_TONE: Record<ItemCondition, ChipTone> = {
  good: "success",
  needs_service: "warning",
  damaged: "danger",
};

export function RequestStatusChip({ status }: { status: RequestStatus }) {
  return <StatusChip tone={REQUEST_STATUS_TONE[status]}>{REQUEST_STATUS_LABEL[status]}</StatusChip>;
}

export function ConditionChip({ condition }: { condition: ItemCondition }) {
  return <StatusChip tone={CONDITION_TONE[condition]}>{CONDITION_LABEL[condition]}</StatusChip>;
}

/** A unit's status chip: Hilang (grey) or Nonaktif (ivory); an active unit shows its condition instead. */
export function UnitChip({ condition, status }: { condition: ItemCondition; status: UnitStatus }) {
  if (status === "lost") return <StatusChip tone="grey">{UNIT_STATUS_LABEL.lost}</StatusChip>;
  if (status === "archived") return <StatusChip tone="ivory">{UNIT_STATUS_LABEL.archived}</StatusChip>;
  return <ConditionChip condition={condition} />;
}

type ChipSource = Pick<RequestDerivedFlags, "isOverdue" | "overdueDays" | "isNotPickedUp" | "isPartiallyReturned"> & {
  status: RequestStatus;
  hasIssue: boolean;
};

/**
 * Status plus derived chips. On list rows (`compact`) at most two: the status plus the most urgent
 * derived one (Terlambat, then Belum diambil); "Sebagian kembali" is a text line there. On the detail
 * every derived chip that applies is shown.
 */
export function RequestChips({ source, compact = false }: { source: ChipSource; compact?: boolean }) {
  const derived: { key: string; tone: ChipTone; text: string }[] = [];
  if (source.isOverdue) derived.push({ key: "overdue", tone: "danger", text: `Terlambat ${source.overdueDays} hari` });
  if (source.isNotPickedUp) derived.push({ key: "pickup", tone: "warning", text: "Belum diambil" });
  if (!compact && source.isPartiallyReturned) derived.push({ key: "partial", tone: "ivory", text: "Sebagian kembali" });
  if (source.status === "returned" && source.hasIssue) derived.push({ key: "issue", tone: "danger", text: "Ada masalah" });

  const shown = compact ? derived.slice(0, 1) : derived;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <RequestStatusChip status={source.status} />
      {shown.map((chip) => (
        <StatusChip key={chip.key} tone={chip.tone}>
          {chip.text}
        </StatusChip>
      ))}
    </span>
  );
}
