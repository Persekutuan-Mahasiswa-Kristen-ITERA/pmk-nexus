import "server-only";
import { getQueueCounts } from "@/modules/inventory-borrowing/server/borrowing";
import type { InventoryCapabilities, QueueCounts } from "@/modules/inventory-borrowing/types";
import { queueSectionVisible } from "@/modules/inventory-borrowing/ui/inventory-header";

/**
 * The "Antrean (n)" hint of the module control (design 4.4, P12). Only fetched when the person sees
 * the Antrean segment. A failed count shows no number and no error: it is a hint, not data (4.5).
 */
export async function queueCountsFor(capabilities: InventoryCapabilities): Promise<QueueCounts | null> {
  if (!queueSectionVisible(capabilities)) return null;
  try {
    const result = await getQueueCounts();
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}
