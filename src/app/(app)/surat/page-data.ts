import "server-only";
import { getAccessState } from "@/lib/auth/session";
import { getLetterDashboardCounts } from "@/modules/letters/server/register";
import { getLetterQueueCounts } from "@/modules/letters/server/requests";
import type { LetterCapabilities, LetterQueueCounts } from "@/modules/letters/types";
import type { LetterTiles } from "@/modules/letters/ui/letters-header";

// The (app) layout may show a status screen instead of the page; the tab title follows it.
const STATUS_TITLES = {
  anonymous: "Masuk",
  error: "Terjadi gangguan",
  no_access: "Belum ada akses",
  password_pending: "Ganti kata sandi dulu",
} as const;

/** Tab title of a Letters page: its own title, or the status title. Every active member may open the module (D-025). */
export async function lettersPageTitle(title: string): Promise<string> {
  const state = await getAccessState(); // cached per request
  if (state.kind !== "member") return STATUS_TITLES[state.kind];
  return title;
}

/**
 * The Antrean counts (design 4.4, 11.1), only for people who see the Antrean segment. A failed count
 * shows no number and no error: it is a hint, not data (4.5).
 */
export async function queueCountsFor(capabilities: LetterCapabilities): Promise<LetterQueueCounts | null> {
  if (!capabilities.canViewAllRequests) return null;
  try {
    const result = await getLetterQueueCounts();
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * The header tiles (design 3.1) on Surat Masuk, Surat Keluar and Antrean: Aktif letters of the active
 * period for letters.view, and "Permohonan menunggu" for view_all (from the queue counts when the
 * person has no letters.view, contract section 12). Hidden when a count failed.
 */
export async function letterTilesFor(capabilities: LetterCapabilities, queue: LetterQueueCounts | null): Promise<LetterTiles | null> {
  let tiles: LetterTiles = { incoming: null, outgoing: null, waiting: null };
  if (capabilities.canViewRegister) {
    try {
      const counts = await getLetterDashboardCounts();
      if (counts.ok && counts.data.periodId !== null) {
        tiles = {
          incoming: { count: counts.data.incomingCount, voided: counts.data.incomingVoidedCount },
          outgoing: { count: counts.data.outgoingCount, voided: counts.data.outgoingVoidedCount },
          waiting: counts.data.waitingRequestCount,
        };
      }
    } catch {
      // A hint, not data: no tiles.
    }
  }
  if (tiles.waiting === null && capabilities.canViewAllRequests && queue) tiles.waiting = queue.submitted;
  if (!capabilities.canViewAllRequests) tiles.waiting = null;
  return tiles.incoming || tiles.outgoing || tiles.waiting !== null ? tiles : null;
}
