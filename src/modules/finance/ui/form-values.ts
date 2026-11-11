import type { FinanceEntryType, FinanceRecordPrefill } from "../types";
import { rupiahInputDisplay } from "../types";

// Plain module (NOT "use client"): the pages call initialValues() on the server and hand the result to the client
// form as a prop. A function exported from a client module cannot be called from a server component.

/** What the person typed: the type is only a choice for income and expense. */
export type FormValues = { entryType: FinanceEntryType; entryDate: string; amount: string; description: string; notes: string };

/** The record form's initial values from a prefill ("Buat koreksi", "Catat ulang") or today's blank form. */
export function initialValues(today: string, entryType: FinanceEntryType, prefill: FinanceRecordPrefill | null, defaultDescription = ""): FormValues {
  if (prefill === null) return { entryType, entryDate: today, amount: "", description: defaultDescription, notes: "" };
  return {
    entryType: prefill.entryType,
    entryDate: prefill.entryDate !== null && prefill.entryDate <= today ? prefill.entryDate : today,
    amount: rupiahInputDisplay(prefill.amount),
    description: prefill.description,
    notes: prefill.notes ?? "",
  };
}
