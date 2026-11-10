import "server-only";
import { ForbiddenScreen } from "@/components/access/forbidden-screen";
import { AlertMessage } from "@/components/ui/alert-message";
import { buttonClass } from "@/components/ui/nx-button";
import Link from "next/link";
import type { AccessState } from "@/lib/auth/types";
import { getNumberingSettings } from "@/modules/letters/server/numbering";
import { jakartaToday, letterCapabilities, type LetterType } from "@/modules/letters/types";
import { COPY } from "@/modules/letters/ui/copy";
import { LetterForm } from "@/modules/letters/ui/letter-form";
import { NarrowPage } from "@/modules/letters/ui/letters-header";
import { registerPath } from "@/modules/letters/ui/routes";

/**
 * "Catat Surat Masuk / Keluar" (design screen 4). letters.manage; without an active period the form is
 * replaced by the period message (7.7). The first-use hint (7.6) needs the numbering settings, which
 * managers may read; a failed read simply leaves the hint out.
 */
export async function renderRegisterForm(state: Extract<AccessState, { kind: "member" }>, type: LetterType) {
  const capabilities = letterCapabilities(state);
  if (!capabilities.canManageRegister) return <ForbiddenScreen noActivePeriod={!capabilities.hasActivePeriod} />;

  if (!capabilities.canRegister) {
    return (
      <NarrowPage>
        <AlertMessage role="status" tone="warning">
          {COPY.noPeriodLetter}
        </AlertMessage>
        <Link href={registerPath(type)} className={buttonClass("text", "-ml-2 self-start")}>
          Kembali
        </Link>
      </NarrowPage>
    );
  }

  let firstUseHint = false;
  try {
    const settings = await getNumberingSettings();
    if (settings.ok) firstUseHint = settings.data.types.some((t) => t.type === type && !t.startSet);
  } catch {
    firstUseHint = false;
  }

  const today = jakartaToday();
  return (
    <NarrowPage>
      <LetterForm
        mode="register"
        type={type}
        today={today}
        cancelHref={registerPath(type)}
        initial={{
          receivedDate: type === "incoming" ? today : "",
          letterDate: type === "outgoing" ? today : "",
          counterpart: "",
          subject: "",
          counterpartNumber: "",
          notes: "",
        }}
        firstUseHint={firstUseHint}
        canReadNumbering={capabilities.canReadNumbering}
      />
    </NarrowPage>
  );
}
