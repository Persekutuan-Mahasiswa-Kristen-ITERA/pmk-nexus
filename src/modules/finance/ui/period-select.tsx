"use client";

import { useListNavigation } from "@/components/list/list-navigation";
import { SelectField } from "@/components/ui/form-fields";
import { FINANCE_COPY, type FinancePeriodOption } from "../types";
import { UI_COPY } from "./copy";
import { listHref } from "./routes";

/**
 * The "Periode" select (spec 7 screen 1): every period that has data, the active one first. Choosing one
 * reloads the list for that period with the other filters reset (a date range of one period means little
 * in another). It changes the address; the server reads the period again and the database checks it.
 */
export function PeriodSelect({ periods, value }: { periods: FinancePeriodOption[]; value: string }) {
  const { navigate } = useListNavigation();
  return (
    <SelectField
      id="finance-period"
      label={FINANCE_COPY.page.periodSelect}
      value={value}
      className="md:max-w-xs"
      onChange={(event) => {
        const chosen = periods.find((p) => p.periodId === event.target.value);
        // The active period is the plain address; any other period is named in it.
        navigate(listHref(chosen && !chosen.isActive ? { period: chosen.periodId } : {}));
      }}
    >
      {periods.map((period) => (
        <option key={period.periodId} value={period.periodId}>
          {period.periodLabel ?? "-"}
          {period.isActive ? ` ${UI_COPY.activeSuffix}` : ""}
        </option>
      ))}
    </SelectField>
  );
}
