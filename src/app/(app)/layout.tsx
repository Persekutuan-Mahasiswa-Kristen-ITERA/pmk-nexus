import { Suspense, type ReactNode } from "react";
import { getAccessState } from "@/lib/auth/session";
import { picoreChangePasswordUrl } from "@/lib/auth/config";
import { AppFrame } from "@/components/shell/app-frame";
import { buildNavData } from "@/components/shell/nav";
import { ErrorScreen } from "@/components/auth/error-screen";
import { LoadingShell } from "@/components/auth/loading-shell";
import { NoAccessScreen } from "@/components/auth/no-access-screen";
import { PasswordPendingScreen } from "@/components/auth/password-pending-screen";
import { RedirectToLogin } from "@/components/auth/redirect-to-login";

// Authenticated area: rendered per request, never statically cached (spec 8.7).
export const dynamic = "force-dynamic";

/**
 * Protected area gate. The loading shell shows while the access check runs (design section 7).
 * UI gate only: every page and Server Action still calls getAccessState() itself, and RLS
 * is the last layer (spec 8.1). Layouts do not re-run on client navigation.
 */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <AccessGate>{children}</AccessGate>
    </Suspense>
  );
}

async function AccessGate({ children }: { children: ReactNode }) {
  const state = await getAccessState();

  switch (state.kind) {
    case "anonymous":
      return <RedirectToLogin />;
    case "error":
      return (
        <AppFrame>
          <ErrorScreen />
        </AppFrame>
      );
    case "no_access":
      return (
        <AppFrame>
          <NoAccessScreen />
        </AppFrame>
      );
    case "password_pending":
      return (
        <AppFrame>
          <PasswordPendingScreen changePasswordUrl={picoreChangePasswordUrl} />
        </AppFrame>
      );
    case "member":
      // Drawer items are computed here on the server (D-021); pages still check access themselves.
      return (
        <AppFrame nav={buildNavData(state)} column="page">
          {children}
        </AppFrame>
      );
  }
}
