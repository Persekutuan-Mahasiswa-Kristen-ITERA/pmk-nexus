import { DetailSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of the request form (design 9.5).
export default function Loading() {
  return <DetailSkeleton text="Memuat form..." />;
}
