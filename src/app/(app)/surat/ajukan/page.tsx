import type { Metadata } from "next";
import Link from "next/link";
import { getAccessState } from "@/lib/auth/session";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import { getMyRequestCaps, getRequestDetail } from "@/modules/letters/server/requests";
import { jakartaToday, letterCapabilities } from "@/modules/letters/types";
import { COPY } from "@/modules/letters/ui/copy";
import { NarrowPage } from "@/modules/letters/ui/letters-header";
import { RequestForm, type RequestFormValues } from "@/modules/letters/ui/request-form";
import { MY_REQUESTS_PATH, readAgainId, type SearchParams } from "@/modules/letters/ui/routes";
import { lettersPageTitle } from "../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Ajukan Surat") };
}

const EMPTY: RequestFormValues = { subject: "", addressee: "", purpose: "", onBehalfOf: "", neededBy: "" };

/**
 * "Ajukan Surat" (design screen 6). Any active member with an active period (L9, R11); without one the
 * form is replaced by the period message (9.4). "Ajukan lagi" prefills from the person's OWN earlier
 * request (P14); someone else's id simply gives an empty form.
 */
export default async function RequestLetterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = letterCapabilities(state);
  if (!capabilities.canSubmitRequest) {
    return (
      <NarrowPage>
        <AlertMessage role="status" tone="warning">
          {COPY.noPeriodRequest}
        </AlertMessage>
        <Link href={MY_REQUESTS_PATH} className={buttonClass("text", "-ml-2 self-start")}>
          Kembali
        </Link>
      </NarrowPage>
    );
  }

  const againId = readAgainId(await searchParams);
  const [caps, earlier] = await Promise.all([getMyRequestCaps(), againId ? getRequestDetail(againId) : null]);

  let initial = EMPTY;
  const source = earlier?.ok && earlier.data.isOwn ? earlier.data : null;
  if (source) {
    initial = {
      subject: source.subject,
      addressee: source.addressee,
      purpose: source.purpose,
      onBehalfOf: source.onBehalfOf ?? "",
      neededBy: source.neededBy && source.neededBy >= jakartaToday() ? source.neededBy : "",
    };
  }

  return (
    <NarrowPage>
      <RequestForm
        initial={initial}
        prefilled={source !== null}
        today={jakartaToday()}
        caps={caps.ok ? caps.data : null}
        cancelHref={MY_REQUESTS_PATH}
      />
    </NarrowPage>
  );
}
