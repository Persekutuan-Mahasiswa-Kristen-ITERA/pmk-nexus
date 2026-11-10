import type { ReactNode } from "react";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { Pagination } from "@/components/list/pagination";
import { AlertMessage } from "@/components/ui/alert-message";
import { Timeline, type TimelineEntry } from "@/components/ui/timeline";
import {
  formatLetterCopy,
  LETTER_PARAMS,
  NUMBERING_CHANGE_LABEL,
  NUMBERING_FIELD_LABEL,
  NUMBERING_TYPE_WORD,
  padLetterSequence,
  type NumberingChange,
  type NumberingFormatValues,
  type NumberingHistoryPage,
  type NumberingSettings,
  type NumberingTypeState,
} from "../types";
import { COPY } from "./copy";
import { formatDateTime } from "./format";
import { NumberText } from "./letter-number";
import { NarrowPage } from "./letters-header";
import { FormatForm, SetNextButton } from "./numbering-forms";
import { NUMBERING_PATH, type NumberingNotice } from "./routes";
import { BackLink, DetailRows, SectionCard, SuccessNotice, UnavailableNotice } from "./states";

const TYPE_TITLE = { incoming: "Surat masuk", outgoing: "Surat keluar" } as const;
const FORMAT_KEYS = ["prefix", "incomingCode", "outgoingCode", "seqDigits", "separator"] as const;

/**
 * Penomoran Surat (design screen 10, section 13): "Nomor berikutnya" first (what the admin does at
 * go-live), then "Format nomor", then the change history. The System Admin edits; letters.manage
 * holders read the same page without fields (13.4). From 1024 px the two cards sit side by side.
 */
export function NumberingScreen({
  settings,
  history,
  notice,
  back,
}: {
  settings: NumberingSettings;
  history: { kind: "ok"; page: NumberingHistoryPage } | { kind: "unavailable" };
  notice: NumberingNotice | null;
  back: { href: string; label: string };
}) {
  const notSet = settings.types.some((state) => !state.startSet);
  return (
    <ListNavigationProvider>
      <NarrowPage wide>
        <div className="flex flex-col gap-4">
          <BackLink href={back.href}>{back.label}</BackLink>
          <h1 className="font-heading text-display-sm text-title">{COPY.numberingTitle}</h1>
          {notice ? <SuccessNotice>{notice === "format_saved" ? COPY.formatSaved : COPY.nextSet}</SuccessNotice> : null}
          <AlertMessage role="status" tone="info">
            {settings.canEdit ? COPY.numberingInfo : COPY.numberingReadOnly}
          </AlertMessage>
          {settings.canEdit && notSet ? (
            <AlertMessage role="status" tone="warning">
              {COPY.numberingNotSet}
            </AlertMessage>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
          <SectionCard
            title={COPY.nextTitle}
            id="numbering-next"
            action={<span className="text-body-sm text-ink-body tabular-nums">Tahun {settings.year}</span>}
          >
            <ul className="flex flex-col divide-y divide-row-line">
              {settings.types.map((state) => (
                <li key={state.type} className="flex flex-col gap-1 py-3.5 first:pt-0 last:pb-0">
                  <h3 className="text-label-lg text-ink-label">{TYPE_TITLE[state.type]}</h3>
                  <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-body-md">
                    <dt className="text-ink-meta">Terakhir dipakai</dt>
                    <dd className="text-ink tabular-nums">{lastUsedText(state, settings.seqDigits)}</dd>
                    <dt className="text-ink-meta">Nomor berikutnya</dt>
                    <dd className="break-words text-ink">
                      <NumberText value={state.nextNumber} />
                    </dd>
                  </dl>
                  {settings.canEdit ? <SetNextButton settings={settings} state={state} /> : null}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title={COPY.formatTitle} id="numbering-format">
            {settings.canEdit ? <FormatForm settings={settings} /> : <DetailRows rows={formatRows(settings)} />}
          </SectionCard>
        </div>

        <SectionCard title={COPY.changeHistoryTitle} id="numbering-history">
          {history.kind === "unavailable" ? (
            <UnavailableNotice />
          ) : history.page.total === 0 ? (
            <p className="text-body-md text-ink-body">{COPY.historyEmpty}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <Timeline label="Riwayat perubahan penomoran" entries={history.page.rows.map((row) => changeEntry(row, settings.seqDigits))} />
              <Pagination
                page={history.page.page}
                pageCount={history.page.pageCount}
                basePath={NUMBERING_PATH}
                params={{}}
                pageParam={LETTER_PARAMS.page}
                label="Halaman riwayat perubahan"
              />
            </div>
          )}
        </SectionCard>
      </NarrowPage>
    </ListNavigationProvider>
  );
}

function lastUsedText(state: NumberingTypeState, digits: number): string {
  return state.lastUsed === null ? "belum ada" : padLetterSequence(state.lastUsed, digits);
}

/** The read-only variant (13.4): the values as text; the year is always part of the number. */
function formatRows(settings: NumberingSettings): { label: string; value: ReactNode }[] {
  return [
    ...FORMAT_KEYS.map((key) => ({ label: NUMBERING_FIELD_LABEL[key], value: <span className="tabular-nums">{String(settings[key])}</span> })),
    { label: "Tahun disertakan", value: "Ya" },
  ];
}

/** One "Riwayat perubahan" row (13.1): who changed what, with the before and after and the reason. */
function changeEntry(change: NumberingChange, digits: number): TimelineEntry {
  const name = change.actorName ?? "-";
  if (change.kind === "format") {
    const lines = FORMAT_KEYS.flatMap((key) => {
      const before = String(change.before[key as keyof NumberingFormatValues]);
      const after = String(change.after[key as keyof NumberingFormatValues]);
      return before === after ? [] : [`${NUMBERING_FIELD_LABEL[key]}: "${before}" menjadi "${after}"`];
    });
    return {
      key: String(change.changeId),
      title: formatLetterCopy(NUMBERING_CHANGE_LABEL.format, { nama: name }),
      dateTime: change.occurredAt,
      dateText: formatDateTime(change.occurredAt),
      details:
        lines.length > 0 || change.reason ? (
          <>
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {change.reason ? <p>{formatLetterCopy(NUMBERING_CHANGE_LABEL.reason, { alasan: change.reason })}</p> : null}
          </>
        ) : undefined,
    };
  }
  return {
    key: String(change.changeId),
    title: formatLetterCopy(NUMBERING_CHANGE_LABEL.next_sequence, {
      jenis: NUMBERING_TYPE_WORD[change.type],
      tahun: change.year,
      nomor: padLetterSequence(change.after.nextSeq, digits),
      nama: name,
    }),
    dateTime: change.occurredAt,
    dateText: formatDateTime(change.occurredAt),
    details: <p>{formatLetterCopy(NUMBERING_CHANGE_LABEL.reason, { alasan: change.reason })}</p>,
  };
}
