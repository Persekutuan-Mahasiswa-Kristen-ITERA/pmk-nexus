import { RequestListSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of Antrean (design 11.5).
export default function Loading() {
  return <RequestListSkeleton text="Memuat antrean..." />;
}
