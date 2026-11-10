import { ListSkeleton } from "@/modules/minutes/ui/skeletons";

// First load of the list (spec 3 states: skeleton rows).
export default function Loading() {
  return <ListSkeleton />;
}
