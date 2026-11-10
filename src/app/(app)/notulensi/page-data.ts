import "server-only";
import { getAccessState } from "@/lib/auth/session";

// The (app) layout may show a status screen instead of the page; the tab title follows it.
const STATUS_TITLES = {
  anonymous: "Masuk",
  error: "Terjadi gangguan",
  no_access: "Belum ada akses",
  password_pending: "Ganti kata sandi dulu",
} as const;

/** Tab title of a Meeting Minutes page: its own title, or the status title. */
export async function minutesPageTitle(title: string): Promise<string> {
  const state = await getAccessState(); // cached per request
  if (state.kind !== "member") return STATUS_TITLES[state.kind];
  return title;
}
