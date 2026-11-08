import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import {
  getQueueCounts,
  getRequestDetail,
  listBorrowingPeriods,
  listOpenLoans,
  listQueue,
} from "@/modules/inventory-borrowing/server/borrowing";
import {
  defaultQueueView,
  INVENTORY_ERROR_COPY,
  inventoryCapabilities,
  inventoryErrorMessage,
  type QueuePage,
} from "@/modules/inventory-borrowing/types";
import { pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { QueueScreen, type QueueResult } from "@/modules/inventory-borrowing/ui/queue-screen";
import { queueHref, readQueueParams, type SearchParams } from "@/modules/inventory-borrowing/ui/routes";
import { inventoryPageTitle } from "../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Antrean") };
}

/**
 * Antrean (design screens 8 and 11) for borrowing.view_all holders. Checks the session and the key
 * itself; without an active period the keys match nothing (R11) and the Forbidden screen explains.
 */
export default async function QueuePageRoute({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  const noActivePeriod = !capabilities.hasActivePeriod;
  if (!capabilities.canViewAllRequests) return <ForbiddenScreen noActivePeriod={noActivePeriod} />;

  const values = readQueueParams(await searchParams, defaultQueueView(capabilities));
  const next = queueHref(values);

  // A date range applies only when it is complete and in order; past dates are allowed (history).
  let dateError: string | null = null;
  let range: { from: string; to: string } | null = null;
  if (values.from && values.to) {
    if (values.to < values.from) dateError = INVENTORY_ERROR_COPY.invalid_dates;
    else range = { from: values.from, to: values.to };
  }

  const [counts, periods] = await Promise.all([getQueueCounts(), listBorrowingPeriods()]);
  let result: QueueResult;
  let loneHead = false;

  if (values.view === "open_all_periods") {
    const rows = await listOpenLoans();
    if (!rows.ok && pageFailure(rows.error, next) === "forbidden") return <ForbiddenScreen noActivePeriod={noActivePeriod} />;
    result = rows.ok ? { kind: "open_loans", rows: rows.data } : { kind: "unavailable" };
  } else {
    const list = await listQueue({
      filters: {
        view: values.view,
        search: values.search,
        from: range?.from ?? null,
        to: range?.to ?? null,
        periodId: values.periodId,
      },
      page: values.page,
    });
    if (list.ok) {
      result = { kind: "ok", page: list.data };
      loneHead = capabilities.canApprove && (await isLoneHeadWithOwnRequest(list.data));
    } else {
      const failure = pageFailure(list.error, next);
      if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={noActivePeriod} />;
      if (list.error.code === "invalid_input" && list.error.field === "search") result = { kind: "search_too_long" };
      else if (list.error.code === "invalid_period") result = { kind: "refused", text: inventoryErrorMessage(list.error, "read") ?? "" };
      else result = { kind: "unavailable" };
    }
  }

  return (
    <QueueScreen
      result={result}
      values={values}
      counts={counts.ok ? counts.data : null}
      periods={periods.ok ? periods.data : []}
      capabilities={capabilities}
      periodLabel={state.member.activePeriodLabel}
      dateError={dateError}
      loneHead={loneHead}
    />
  );
}

/**
 * B29 hint on the list: true when the viewer's own Diajukan request is on this page and no other head
 * holds borrowing.approve now. The count comes only with the request detail, so one detail is read.
 */
async function isLoneHeadWithOwnRequest(page: QueuePage): Promise<boolean> {
  const own = page.rows.find((row) => row.isOwn && row.status === "submitted");
  if (!own) return false;
  const detail = await getRequestDetail(own.requestId);
  return detail.ok && detail.data.otherApproverCount === 0;
}
