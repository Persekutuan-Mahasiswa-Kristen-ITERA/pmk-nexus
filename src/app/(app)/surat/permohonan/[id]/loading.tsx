import { COPY } from "@/modules/letters/ui/copy";
import { DetailSkeleton } from "@/modules/letters/ui/skeletons";

export default function Loading() {
  return <DetailSkeleton text={COPY.loadingRequests} />;
}
