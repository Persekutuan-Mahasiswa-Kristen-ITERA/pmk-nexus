import { COPY } from "@/modules/letters/ui/copy";
import { RequestListSkeleton } from "@/modules/letters/ui/skeletons";

// First load of Permohonan Saya (design 10.5).
export default function Loading() {
  return <RequestListSkeleton text={COPY.loadingRequests} />;
}
