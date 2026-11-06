import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { parseMemberListSearchParams } from "@/modules/member-data/server/params";
import { getMemberUnitOptions, listMembers } from "@/modules/member-data/server/queries";
import { memberDataCapabilities, MEMBER_STATUS_FILTER_DEFAULT, type MemberDataError } from "@/modules/member-data/types";
import { memberListHref } from "@/modules/member-data/ui/list-url";
import { MemberListScreen, type MemberListResult } from "@/modules/member-data/ui/member-list-screen";

// The (app) layout may show a status screen instead of this page; the tab title follows it.
const STATUS_TITLES = {
  anonymous: "Masuk",
  error: "Terjadi gangguan",
  no_access: "Belum ada akses",
  password_pending: "Ganti kata sandi dulu",
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const state = await getAccessState(); // cached per request
  if (state.kind !== "member") return { title: STATUS_TITLES[state.kind] };
  return { title: memberDataCapabilities(state).canView ? "Data Anggota" : "Tidak punya akses" };
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Data Anggota (docs/modules/member-data.md). Checks the session and member_data.view itself (F2):
 * the layout and the drawer are convenience only, and the database functions check a third time.
 */
export default async function DataAnggotaPage({ searchParams }: PageProps) {
  const state = await getAccessState();
  if (state.kind !== "member") return null; // the layout already shows the right status screen

  const noActivePeriod = state.member.activePeriodId === null;
  const capabilities = memberDataCapabilities(state);
  if (!capabilities.canView) return <ForbiddenScreen noActivePeriod={noActivePeriod} />;

  const query = parseMemberListSearchParams(await searchParams);
  const [list, units] = await Promise.all([listMembers(query), getMemberUnitOptions()]);

  const filterValues = {
    search: query.search ?? "",
    unitId: query.unitId ?? null,
    status: query.status ?? MEMBER_STATUS_FILTER_DEFAULT,
  };

  const error = firstError(list.ok ? null : list.error, units.ok ? null : units.error);
  if (error?.code === "unauthenticated") {
    // Session ended between the layout check and the data call (spec F6, auth-login F9).
    const next = memberListHref({ ...filterValues, search: filterValues.search || null, page: query.page ?? 1 });
    redirect(`/login?reason=session_ended&next=${encodeURIComponent(next)}`);
  }
  if (error?.code === "forbidden") return <ForbiddenScreen noActivePeriod={noActivePeriod} />;

  let result: MemberListResult;
  if (list.ok && units.ok) {
    result = { kind: "ok", list: list.data, unitOptions: units.data };
  } else if (units.ok && error?.code === "invalid_input") {
    result = { kind: "invalid", field: error.field === "search" ? "search" : "other", unitOptions: units.data };
  } else {
    result = { kind: "unavailable" };
  }

  return (
    <MemberListScreen
      result={result}
      filterValues={filterValues}
      canExport={capabilities.canExport}
      periodLabel={state.member.activePeriodLabel}
    />
  );
}

/** Most serious first: an ended session or a lost right outranks a fault or a bad value. */
function firstError(...errors: (MemberDataError | null)[]): MemberDataError | null {
  const order: MemberDataError["code"][] = ["unauthenticated", "forbidden", "unavailable", "invalid_input"];
  for (const code of order) {
    const found = errors.find((e) => e?.code === code);
    if (found) return found;
  }
  return null;
}
