import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import type { SearchParams } from "@/modules/letters/ui/routes";
import { lettersPageTitle } from "../page-data";
import { renderRegister } from "../register-page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Surat Keluar") };
}

/** Surat Keluar (design screen 2): letters.view; checked here, by the read and by the database. */
export default async function OutgoingLettersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;
  return renderRegister(state, "outgoing", await searchParams);
}
