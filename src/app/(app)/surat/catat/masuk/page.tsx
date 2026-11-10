import type { Metadata } from "next";
import { getAccessState } from "@/lib/auth/session";
import { lettersPageTitle } from "../../page-data";
import { renderRegisterForm } from "../register-form-page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await lettersPageTitle("Catat Surat Masuk") };
}

/** Catat Surat Masuk (design screen 4): letters.manage and an active period, checked here and again on save. */
export default async function IncomingRegisterFormPage() {
  const state = await getAccessState();
  if (state.kind !== "member") return null;
  return renderRegisterForm(state, "incoming");
}
