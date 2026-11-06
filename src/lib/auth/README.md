# src/lib/auth

Session handling and permission mapping: turns the user's assignments in the ACTIVE period into NEXUS permissions (see CLAUDE.md section 6). System access (Admin or Member) and organizational position (BPH, Treasurer, ...) are separate things; never mix them.

Spec: `docs/modules/auth-login.md`. Contract with the UI: `types.ts` (fixed; change only via the tech lead).

| File | Runs on | What |
|---|---|---|
| `types.ts` | both | The contract: `AccessState`, `MemberContext`, `PermissionGrant`, `SignInResult`, `SignInErrorCode` |
| `session.ts` | server | `getAccessState()`: the single session check. Call it in EVERY protected page, route handler, and Server Action (AR8) |
| `sign-in.ts` | browser | `signInWithPassword()`: browser sign-in (per-IP rate limit), then `finalizeSignIn` |
| `actions.ts` | server (Server Actions) | `finalizeSignIn()` re-issues cookies from the server; `signOut()` ends this browser's session |
| `redirect.ts` | both | `safeRedirectPath()`: the only way to turn `?next=` into a redirect target |
| `config.ts` | both | `picoreChangePasswordUrl` from `NEXT_PUBLIC_PICORE_URL` |

## getAccessState() order (D-015)

1. JWT validated with `getClaims()`. No/expired/revoked session = `anonymous`. Auth unreachable = `error`.
2. `my_context()` and `my_password_change_pending()` (in parallel, user's session). Either fails = `error`.
3. 0 context rows = `no_access`. Flag `true` = `password_pending`.
4. `my_permissions()`. Fails = `error`. Else `member` with permissions.

`error` never signs anyone out and never grants anything. Results are cached for one request only.

## Related

- `src/lib/supabase/`: server, browser, and proxy clients (publishable key only), JWT check, cookie options.
- `src/proxy.ts`: refreshes cookies, sends GET requests without a session to `/login?next=...` (adds `reason=session_ended` when a stale session cookie was sent). Coarse gate only.
