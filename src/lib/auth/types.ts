// Contract between the auth backend (src/lib/auth, src/lib/picore) and the UI (src/app, src/components).
// Fixed by the tech lead on 2026-11-06. Change it only after telling the tech lead: both sides depend on it.
// Spec: docs/modules/auth-login.md (sections 4, 6, 8). Design: docs/design/login.md.

/** Who the signed-in person is in NEXUS. Comes from nexus.my_context() (never email, phone, NIM, NIP). */
export type MemberContext = {
  memberId: string;
  fullName: string;
  memberType: "student" | "lecturer";
  isSystemAdmin: boolean;
  activePeriodId: string | null;
  activePeriodLabel: string | null;
};

/** One permission the caller holds. Comes from nexus.my_permissions(). */
export type PermissionGrant = {
  key: string;
  /** "all" = every record; "units" = only records of unitIds. */
  scope: "all" | "units";
  unitIds: string[];
  isSensitive: boolean;
};

/**
 * Result of the single session check. Order of evaluation (D-015):
 * anonymous > error > no_access > password_pending > member.
 * - anonymous: no valid session.
 * - error: a check failed or returned something unexpected (fail closed: show "Terjadi gangguan", keep the session).
 * - no_access: signed in, but my_context() returned 0 rows (inactive or unlinked; one combined message, D-016).
 * - password_pending: active member still on a temporary password (D-015).
 * - member: full access state; permissions are already loaded.
 */
export type AccessState =
  | { kind: "anonymous" }
  | { kind: "error" }
  | { kind: "no_access" }
  | { kind: "password_pending" }
  | { kind: "member"; member: MemberContext; permissions: PermissionGrant[] };

/** Error codes the login form maps to the Indonesian copy in docs/design/login.md section 2.8. */
export type SignInErrorCode =
  | "empty_fields"
  | "invalid_credentials"
  | "rate_limited"
  | "network"
  | "server";

/** Result of the browser-side sign-in helper (sign-in runs in the browser so rate limits are per member IP). */
export type SignInResult = { ok: true; redirectTo: string } | { ok: false; error: SignInErrorCode };

/*
 * Functions the backend provides (signatures are part of this contract):
 *
 * src/lib/auth/session.ts (server only)
 *   getAccessState(): Promise<AccessState>
 *     Cached per request (React cache). The only caller of the picore context/permission readers.
 *
 * src/lib/auth/sign-in.ts ("use client")
 *   signInWithPassword(email: string, password: string, next: string | null): Promise<SignInResult>
 *     Trims email, validates non-empty, signs in with the browser Supabase client, then calls the
 *     finalizeSignIn Server Action. redirectTo is already safe (see safeRedirectPath).
 *
 * src/lib/auth/actions.ts ("use server")
 *   finalizeSignIn(next: string | null): Promise<{ redirectTo: string }>
 *     Re-issues the session cookies server-side (iOS PWA cookie cap, A-AUTH-3) and returns a safe path.
 *   signOut(): Promise<void>
 *     Ends the NEXUS session only (local scope) and redirects to /login.
 *
 * src/lib/auth/redirect.ts (shared, pure)
 *   safeRedirectPath(value: string | null | undefined): string
 *     Rules in docs/modules/auth-login.md section 8.5. Anything unsafe becomes "/".
 *
 * src/lib/auth/config.ts (shared)
 *   picoreChangePasswordUrl: string   // `${NEXT_PUBLIC_PICORE_URL}/change-password`
 *
 * Login query flags the UI reads on /login: `next` (return path), `reason=session_ended` (show notice).
 */
