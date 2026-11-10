import Link from "next/link";
import { Plus } from "lucide-react";
import { ListLink, ListNavigationProvider, PendingRegion } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { buttonClass } from "@/components/ui/nx-button";
import { LETTER_ERROR_COPY_VARIANTS, LETTER_PARAMS, LETTER_TYPE_LABEL, type LetterCapabilities, type LetterPage, type LetterType } from "../types";
import { COPY, rangeText } from "./copy";
import { formatCount } from "./format";
import { LettersExport } from "./letters-export";
import { LettersHeader, ListColumn, type LetterTiles } from "./letters-header";
import { RegisterFilters } from "./register-filters";
import { RegisterList } from "./register-list";
import { registerFormHref, registerHref, registerParams, registerPath, REGISTER_DEFAULTS, type RegisterUrlState } from "./routes";
import { UnavailableNotice } from "./states";

export type RegisterResult = { kind: "ok"; page: LetterPage } | { kind: "search_too_long" } | { kind: "unavailable" };

/**
 * Surat Masuk / Surat Keluar (design screen 2, section 5) for letters.view holders. The register
 * button needs letters.manage and an active period; "Ekspor" needs letters.export. Each tab lists only
 * its own type, newest registered first (G8).
 */
export function RegisterScreen({
  type,
  result,
  values,
  years,
  capabilities,
  periodLabel,
  tiles,
  actionNeeded,
}: {
  type: LetterType;
  result: RegisterResult;
  values: RegisterUrlState;
  years: number[];
  capabilities: LetterCapabilities;
  periodLabel: string | null;
  tiles: LetterTiles | null;
  actionNeeded: number | null;
}) {
  const countBox = result.kind === "ok" ? { label: "Hasil", value: formatCount(result.page.total), unit: "surat" } : null;

  return (
    <ListNavigationProvider>
      <ListColumn wide>
        <LettersHeader
          capabilities={capabilities}
          periodLabel={periodLabel}
          current={type}
          countBox={countBox}
          tiles={tiles}
          actionNeeded={actionNeeded}
        />

        {capabilities.canRegister ? (
          <Link href={registerFormHref(type)} className={buttonClass("primary", "nx-press nx-rise nx-delay-2 lg:w-auto lg:self-start")}>
            <Plus aria-hidden="true" className="size-5" strokeWidth={2} />
            Catat {LETTER_TYPE_LABEL[type]}
          </Link>
        ) : null}

        <RegisterFilters
          type={type}
          values={values}
          years={years}
          searchError={result.kind === "search_too_long" ? LETTER_ERROR_COPY_VARIANTS.invalidInput.search : null}
          exportSlot={
            result.kind === "ok" && capabilities.canExportRegister && result.page.total > 0 ? (
              <LettersExport filters={result.page.filters} />
            ) : null
          }
        />

        {result.kind === "unavailable" ? (
          <UnavailableNotice />
        ) : result.kind === "search_too_long" ? null : (
          <RegisterBody
            type={type}
            page={result.page}
            values={values}
            canRegister={capabilities.canRegister}
            olderExist={years.length > 0}
          />
        )}
      </ListColumn>
    </ListNavigationProvider>
  );
}

function RegisterBody({
  type,
  page,
  values,
  canRegister,
  olderExist,
}: {
  type: LetterType;
  page: LetterPage;
  values: RegisterUrlState;
  canRegister: boolean;
  olderExist: boolean;
}) {
  const noun = type === "incoming" ? "surat masuk" : "surat keluar";
  if (page.total === 0 || page.rows.length === 0) {
    return (
      <PendingRegion>
        <EmptyState type={type} values={values} canRegister={canRegister} olderExist={olderExist} />
      </PendingRegion>
    );
  }

  const from = page.rows[0].rowNo;
  const to = page.rows[page.rows.length - 1].rowNo;
  return (
    <PendingRegion className="flex flex-col gap-4">
      <RegisterList rows={page.rows} type={type} caption={`Daftar ${noun}, halaman ${page.page} dari ${page.pageCount}`} />
      <div className="flex flex-col items-center gap-2 pb-4">
        <Pagination
          page={page.page}
          pageCount={page.pageCount}
          basePath={registerPath(type)}
          params={registerParams(values)}
          pageParam={LETTER_PARAMS.page}
          label={`Halaman daftar ${noun}`}
        />
        <p role="status" className="text-body-sm text-ink-body tabular-nums">
          {rangeText(from, to, page.total, "surat", formatCount)}
        </p>
      </div>
    </PendingRegion>
  );
}

/** The three empty states of 5.3: first use, nothing in this period, and no match. */
function EmptyState({
  type,
  values,
  canRegister,
  olderExist,
}: {
  type: LetterType;
  values: RegisterUrlState;
  canRegister: boolean;
  /** The register holds numbered letters of some year, so older periods are worth a look. */
  olderExist: boolean;
}) {
  const searched = values.search.trim() !== "";
  const filtered = values.year !== null || values.status !== REGISTER_DEFAULTS.status || values.withoutFiles;
  const card = "rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1";

  if (searched || filtered) {
    return (
      <div className={card}>
        <p role="status" className="text-body-md text-ink">
          {COPY.noMatch}
        </p>
        <div className="mt-2 -ml-2 flex flex-wrap gap-x-2">
          {searched ? (
            <ListLink href={registerHref(type, { ...values, search: "", page: 1 })} className={buttonClass("text")}>
              Hapus pencarian
            </ListLink>
          ) : null}
          <ListLink href={registerHref(type)} className={buttonClass("text")}>
            Reset
          </ListLink>
        </div>
      </div>
    );
  }

  if (values.period === "active" && olderExist) {
    // Nothing in the active period, but older letters exist (5.3).
    return (
      <div className={card}>
        <p role="status" className="text-body-md font-semibold text-ink">
          {COPY.emptyPeriod}
        </p>
        <ListLink href={registerHref(type, { period: "all" })} className={buttonClass("text", "mt-2 -ml-2")}>
          Lihat semua periode
        </ListLink>
      </div>
    );
  }

  return (
    <div className={card}>
      <p role="status" className="text-body-md font-semibold text-ink">
        {type === "incoming" ? COPY.emptyIncoming : COPY.emptyOutgoing}
      </p>
      <p className="mt-1 text-body-md text-ink-body">{canRegister ? COPY.emptyManager : COPY.emptyViewer}</p>
    </div>
  );
}
