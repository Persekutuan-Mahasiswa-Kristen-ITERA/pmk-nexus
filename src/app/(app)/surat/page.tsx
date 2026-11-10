import { redirect } from "next/navigation";
import { getAccessState } from "@/lib/auth/session";
import { letterCapabilities, letterSegments } from "@/modules/letters/types";
import { segmentHref } from "@/modules/letters/ui/routes";

/**
 * /surat goes to the first segment this person has, in the order of the control (design 4.3, G13):
 * Surat Masuk for register holders, Permohonan Saya for everyone else. No guessing by counts.
 */
export default async function LettersIndexPage() {
  const state = await getAccessState();
  if (state.kind !== "member") return null;
  const [first] = letterSegments(letterCapabilities(state));
  redirect(segmentHref(first ?? "mine"));
}
