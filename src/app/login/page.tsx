import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccessState } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { AppFrame } from "@/components/shell/app-frame";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

// Reads the session cookie on every request; never cache this page.
export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = firstValue(params.next);
  const sessionEnded = firstValue(params.reason) === "session_ended";

  // A full member has nothing to do here (AUTH-05). No-access, password-pending and error
  // states still get the form, so the person can sign in with another account (design 4.3).
  const state = await getAccessState();
  if (state.kind === "member") {
    redirect(safeRedirectPath(next));
  }

  return (
    <AppFrame
      footer={
        <footer className="px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center text-body-sm text-ink-meta">
          Akun dibuat oleh admin PMK ITERA.
        </footer>
      }
    >
      <LoginForm next={next} sessionEnded={sessionEnded} />
    </AppFrame>
  );
}
