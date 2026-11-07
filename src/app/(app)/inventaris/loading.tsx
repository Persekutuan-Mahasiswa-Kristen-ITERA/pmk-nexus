import { CatalogSkeleton } from "@/modules/inventory-borrowing/ui/skeletons";

// First load of Katalog (design 5.3): the screen's shape with flat bars, no item data yet.
export default function Loading() {
  return <CatalogSkeleton />;
}
