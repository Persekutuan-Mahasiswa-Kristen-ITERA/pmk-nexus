import type { ReactNode } from "react";

/**
 * Status chip (docs/design/inventory-borrowing.md section 17): pill, 24 px, 1 px border, 11 px bold,
 * sentence case, no dot, no icon, no motion. The words carry the meaning; the tone only repeats it.
 * Pills are reserved for status chips and filter tags (D-014).
 */
export type ChipTone = "success" | "warning" | "danger" | "ivory" | "grey";

const toneClass: Record<ChipTone, string> = {
  success: "border-success-line bg-success-soft text-success", // 7.01:1
  warning: "border-warn-line bg-warn-soft text-warn", // 5.59:1
  // Stitch gives the destructive chip no border; a same-colour border keeps the 24 px box identical.
  danger: "border-danger-soft bg-danger-soft text-danger", // 7.04:1
  ivory: "border-ivory-line bg-ivory text-walnut", // 7.43:1
  grey: "border-grey-line bg-grey-soft text-grey", // 7.30:1
};

export function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-label-sm font-bold whitespace-nowrap ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}
