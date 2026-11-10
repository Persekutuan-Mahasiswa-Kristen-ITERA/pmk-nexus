import "server-only";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import type { AccessState } from "@/lib/auth/types";
import { listLetters, listLetterYears } from "@/modules/letters/server/register";
import { letterCapabilities, type LetterType } from "@/modules/letters/types";
import { pageFailure } from "@/modules/letters/ui/page-errors";
import { RegisterScreen, type RegisterResult } from "@/modules/letters/ui/register-screen";
import { readRegisterParams, registerHref, type SearchParams } from "@/modules/letters/ui/routes";
import { letterTilesFor, queueCountsFor } from "./page-data";

/**
 * Surat Masuk and Surat Keluar (design screen 2). The page itself checks the session; this checks
 * letters.view (without an active period the key matches nothing, R7, and the Forbidden screen says
 * why) and reads the list, the year choices, the tiles and the Antrean count side by side.
 */
export async function renderRegister(state: Extract<AccessState, { kind: "member" }>, type: LetterType, searchParams: SearchParams) {
  const capabilities = letterCapabilities(state);
  if (!capabilities.canViewRegister) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const values = readRegisterParams(searchParams);
  const [list, years, queue] = await Promise.all([
    listLetters({
      filters: {
        type,
        search: values.search,
        period: values.period,
        year: values.year,
        status: values.status,
        withoutFiles: values.withoutFiles,
      },
      page: values.page,
    }),
    listLetterYears(type),
    queueCountsFor(capabilities),
  ]);
  const tiles = await letterTilesFor(capabilities, queue);

  let result: RegisterResult;
  if (list.ok) {
    result = { kind: "ok", page: list.data };
  } else {
    const failure = pageFailure(list.error, registerHref(type, values));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    result = list.error.code === "invalid_input" && list.error.field === "search" ? { kind: "search_too_long" } : { kind: "unavailable" };
  }

  return (
    <RegisterScreen
      type={type}
      result={result}
      values={values}
      years={years.ok ? years.data : []}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      tiles={tiles}
      actionNeeded={queue?.actionNeeded ?? null}
    />
  );
}
