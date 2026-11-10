import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { getNumberingSettings, listNumberingHistory } from "@/modules/letters/server/numbering";
import { letterCapabilities } from "@/modules/letters/types";
import { NarrowPage } from "@/modules/letters/ui/letters-header";
import { NumberingScreen } from "@/modules/letters/ui/numbering-screen";
import { pageFailure } from "@/modules/letters/ui/page-errors";
import { firstParam, INCOMING_PATH, NUMBERING_PATH, readNumberingNotice, readPage, type SearchParams } from "@/modules/letters/ui/routes";
import { UnavailableNotice } from "@/modules/letters/ui/states";

const STATUS_TITLES = {
  anonymous: "Masuk",
  error: "Terjadi gangguan",
  no_access: "Belum ada akses",
  password_pending: "Ganti kata sandi dulu",
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const state = await getAccessState();
  if (state.kind !== "member") return { title: STATUS_TITLES[state.kind] };
  return { title: letterCapabilities(state).canReadNumbering ? "Penomoran Surat" : "Tidak punya akses" };
}

/**
 * Penomoran Surat (design screen 10). The System Admin edits; letters.manage holders read it (A-LT12).
 * Works without an active period (access control AC-43). The NEXUS settings area has no design yet
 * (G10), so this page stands alone with a "Kembali" link.
 */
export default async function LetterNumberingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = letterCapabilities(state);
  if (!capabilities.canReadNumbering) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const query = await searchParams;
  const page = readPage(firstParam(query, "page"));
  const [settings, history] = await Promise.all([getNumberingSettings(), listNumberingHistory({ page })]);

  if (!settings.ok) {
    if (pageFailure(settings.error, NUMBERING_PATH) === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    return (
      <ListNavigationProvider>
        <NarrowPage>
          <UnavailableNotice />
        </NarrowPage>
      </ListNavigationProvider>
    );
  }

  const back = capabilities.canViewRegister ? { href: INCOMING_PATH, label: "Kembali" } : { href: "/", label: "Kembali" };
  return (
    <NumberingScreen
      settings={settings.data}
      history={history.ok ? { kind: "ok", page: history.data } : { kind: "unavailable" }}
      notice={readNumberingNotice(query)}
      back={back}
    />
  );
}
