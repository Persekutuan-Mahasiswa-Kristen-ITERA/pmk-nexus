import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { getRequestDetailByReference } from "@/modules/inventory-borrowing/server/borrowing";
import { INVENTORY_ERROR_COPY_VARIANTS, inventoryCapabilities, jakartaToday } from "@/modules/inventory-borrowing/types";
import { NarrowPage } from "@/modules/inventory-borrowing/ui/inventory-header";
import { pageFailure } from "@/modules/inventory-borrowing/ui/page-errors";
import { RequestDetailScreen } from "@/modules/inventory-borrowing/ui/request-detail-screen";
import {
  INVENTORY_PATH,
  MY_REQUESTS_PATH,
  QUEUE_PATH,
  readRequestNotice,
  requestHref,
  type SearchParams,
} from "@/modules/inventory-borrowing/ui/routes";
import { NotFoundCard, UnavailableNotice } from "@/modules/inventory-borrowing/ui/states";
import { loadEvidencePhotos } from "../../actions";
import { inventoryPageTitle } from "../../titles";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await inventoryPageTitle("Detail Pengajuan") };
}

type PageProps = { params: Promise<{ ref: string }>; searchParams: Promise<SearchParams> };

/**
 * Detail Pengajuan at /inventaris/pengajuan/{ref} (design 10.2, P14). The requester of record and
 * borrowing.view_all holders may read it; for everyone else, and for an unknown reference, the answer
 * is the same "Pengajuan ini tidak ditemukan." (R8: nothing to probe).
 */
export default async function RequestDetailPage({ params, searchParams }: PageProps) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = inventoryCapabilities(state);
  if (!capabilities.canViewCatalog) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const [{ ref }, query] = await Promise.all([params, searchParams]);
  const reference = safeDecode(ref);
  const notFound = (
    <NarrowPage>
      <NotFoundCard
        text={INVENTORY_ERROR_COPY_VARIANTS.notFound.request}
        backHref={MY_REQUESTS_PATH}
        backLabel="Kembali ke Peminjaman Saya"
      />
    </NarrowPage>
  );
  if (reference === null) return notFound;

  const detail = await getRequestDetailByReference(reference);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, requestHref(reference));
    if (failure === "forbidden") return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;
    if (failure === "not_found" || failure === "invalid") return notFound;
    return (
      <ListNavigationProvider>
        <NarrowPage>
          <UnavailableNotice />
        </NarrowPage>
      </ListNavigationProvider>
    );
  }

  // Own requests go back to Peminjaman Saya; others' requests are reachable only with view_all, from
  // Antrean. (The catalog is a last resort, should a key change between the two reads.)
  const back = detail.data.isOwn
    ? { href: MY_REQUESTS_PATH, label: "Peminjaman Saya" }
    : capabilities.canViewAllRequests
      ? { href: QUEUE_PATH, label: "Antrean" }
      : { href: INVENTORY_PATH, label: "Katalog" };

  return (
    <RequestDetailScreen
      detail={detail.data}
      capabilities={capabilities}
      notice={readRequestNotice(query)}
      back={back}
      loadPhotos={loadEvidencePhotos}
      today={jakartaToday()}
    />
  );
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
