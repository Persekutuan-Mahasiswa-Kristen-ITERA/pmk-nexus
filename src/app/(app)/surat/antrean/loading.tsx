import { COPY } from "@/modules/letters/ui/copy";
import { RequestListSkeleton } from "@/modules/letters/ui/skeletons";

// First load of Antrean (design 11.2).
export default function Loading() {
  return <RequestListSkeleton text={COPY.loadingQueue} />;
}
