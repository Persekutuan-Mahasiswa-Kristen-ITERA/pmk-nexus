import type { Metadata } from "next";
import Link from "next/link";
import { getAccessState } from "@/lib/auth/session";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { ListNavigationProvider } from "@/components/list/list-navigation";
import { buttonClass } from "@/components/ui/nx-button";
import { getLetterDetail } from "@/modules/letters/server/register";
import { jakartaToday, letterCapabilities } from "@/modules/letters/types";
import { COPY } from "@/modules/letters/ui/copy";
import { LetterForm } from "@/modules/letters/ui/letter-form";
import { NarrowPage } from "@/modules/letters/ui/letters-header";
import { pageFailure } from "@/modules/letters/ui/page-errors";
import { INCOMING_PATH, isGuid, letterEditHref, letterHref } from "@/modules/letters/ui/routes";
import { NotFoundCard, UnavailableNotice } from "@/modules/letters/ui/states";
import { lettersPageTitle } from "../../page-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Ubah rincian") };
}

/**
 * "Ubah rincian" (design 7.3): letters.manage, an Aktif letter of the active period (the database's
 * actions.canEdit). Otherwise the address answers "Surat ini tidak bisa diubah." (7.7).
 */
export default async function EditLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const state = await getAccessState();
  if (state.kind !== "member") return null;

  const capabilities = letterCapabilities(state);
  if (!capabilities.canManageRegister) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  const { id } = await params;
  const notFound = (
    <NarrowPage>
      <NotFoundCard text={COPY.letterNotFound} backHref={INCOMING_PATH} backLabel={COPY.backToList} />
    </NarrowPage>
  );
  if (!isGuid(id)) return notFound;

  const detail = await getLetterDetail(id);
  if (!detail.ok) {
    const failure = pageFailure(detail.error, letterEditHref(id));
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

  const letter = detail.data;
  if (!letter.actions.canEdit) {
    return (
      <NarrowPage>
        <div className="rounded-xl border border-surface-line bg-surface p-5 shadow-elevation-1">
          <p role="status" className="text-body-md text-ink">
            {COPY.notEditable}
          </p>
          <Link href={letterHref(letter.letterId)} className={buttonClass("text", "mt-2 -ml-2")}>
            {COPY.backToLetter}
          </Link>
        </div>
      </NarrowPage>
    );
  }

  return (
    <NarrowPage>
      <LetterForm
        mode="edit"
        type={letter.type}
        today={jakartaToday()}
        cancelHref={letterHref(letter.letterId)}
        letterId={letter.letterId}
        version={letter.version}
        numberText={letter.numberText}
        initial={{
          receivedDate: letter.receivedDate ?? "",
          letterDate: letter.letterDate ?? "",
          counterpart: letter.counterpart,
          subject: letter.subject,
          counterpartNumber: letter.counterpartNumber ?? "",
          notes: letter.notes ?? "",
        }}
      />
    </NarrowPage>
  );
}
