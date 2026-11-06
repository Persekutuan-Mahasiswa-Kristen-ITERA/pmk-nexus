# Connection and Login to PI-CORE (cross-cutting module spec)

> Status: **APPROVED by the owner on 2026-11-06** (step 2 of the work order in `CLAUDE.md` section 9). Decisions applied: D-015 (E1 = b), D-016 (E2-E5 = a). E6 (live Auth settings check) is still open and must be done before go-live.
> Sources: `CLAUDE.md` (sections 4, 5, 6, 8, 11), `docs/PMK-NEXUS-context.md` (sections 2, 3, 4), `docs/DECISIONS.md` (D-002, D-007, D-010, D-011, D-013), `docs/modules/access-control.md` (rev. 2, L1, L4, E5, E11, AC-32 to AC-34, AC-44), `docs/picore/schema-report.md`, `supabase/README.md` (sections 1, 3, 7), and the PI-CORE app repo (read only).
> No code or SQL here. No visual design: screens are described in words only; a UX designer handles visuals later.
> Tags: **[FACT]** = verified in a file (path given), **[ASSUMPTION]** = my guess, needs the owner, **[UNVERIFIED]** = cannot be checked from the repos, **E1-E6** = open question in section 11 (also added to `docs/OPEN_QUESTIONS.md`, section E).

---

## 1. Purpose, users, scope

**Purpose.** Let a PMK member sign in to NEXUS with the SAME account they use in PI-CORE, and decide what happens when that account is not allowed in (deactivated, not linked, still on a temporary password, session ended). NEXUS builds no account system: no sign-up, no password storage, no account creation (D-002).

**Who uses it.** Every PMK member (anonymous visitor before login, then any active member). System Admin and officers use the same screen; what they may do afterwards is decided by `docs/modules/access-control.md`, not here.

**In scope:** login screen, logout, session handling, route protection, the "no access" state, the temporary-password state, the "session ended" state, the entry point after login, and the rule for where NEXUS calls `my_context()`.

**Out of scope:** what each role may do after login (access-control spec), creating accounts, resetting passwords, deactivating members (all PI-CORE), screen visuals (UX designer; C13 asks whether to reuse PI-CORE's "Masuk PMK ITERA" design).

**Analogy.** PI-CORE is the card office; NEXUS is a room with a card reader. The reader never prints cards or changes PINs. It only checks the card, and says "go to the card office" when something is wrong.

---

## 2. What PI-CORE really does today (verified, read only)

Repo: `/home/fycode/Documents/pi-core-v2` (D-005 [ASSUMPTION] that this is the source of truth). Everything below was read in files; nothing was run.

| # | Fact | Where |
|---|---|---|
| P1 | Login is email + password through Supabase Auth. `signInWithPassword` runs **in the browser** (so Supabase rate-limits per member IP, not per Vercel server IP). Afterwards a Server Action re-issues the auth cookies from the server (`sameSite=lax`, `secure` in production, 400 days) so Safari's 7-day cap on browser-written cookies does not log out installed PWAs. | `src/app/login/login-form.tsx`, `src/app/login/actions.ts`, `docs/ARCHITECTURE.md` D-09 |
| P2 | One error message for unknown email, wrong password, and banned (deactivated) account. A separate 429 message ("too many attempts"). | `login-form.tsx`; `src/lib/i18n/id.ts` keys `login.generic`, `login.tooMany`, `login.enterBoth`, `login.inactive`; `docs/SECURITY.md` "Account enumeration" |
| P3 | No sign-up, no email sent. `enable_signup = false`; there is no SMTP, so no invite and no reset email. Accounts are created by an admin with a random 14-character temporary password shown once. "Forgot password" on the login page only shows a note: ask a PI-CORE admin for a temporary password. | `supabase/config.toml` `[auth]`; `docs/ARCHITECTURE.md` D-04; `src/lib/i18n/id.ts` `login.forgotNote` |
| P4 | New accounts and admin-reset accounts have `members.must_change_password = true`. PI-CORE then forces `/change-password` (pages redirect, Server Actions refuse). The flag is enforced **in app code only**, not in RLS. | `src/lib/auth.ts` (`requireMember`, `requireActionMember`); `docs/SECURITY.md` line 24; RLS in migrations never mentions the flag |
| P5 | The password change needs the **service-role key**: PI-CORE re-verifies the current password, sets the new one with `auth.admin.updateUserById`, and clears the flag with the admin client. Members cannot update their own `members` row (RLS update policy is admin only). | `src/app/actions/password.ts`; `docs/SECURITY.md` lines 55-56 |
| P6 | Password change does not revoke the member's other sessions (a known PI-CORE limitation). | `docs/ARCHITECTURE.md` "Known limitations" |
| P7 | Deactivating a member sets `is_active = false` AND bans the Auth user (`ban_duration = 876000h`). If the ban call fails, PI-CORE reports a partial state ("login could not be blocked; they still see no data"). Reactivation lifts the ban. | `src/app/(app)/members/actions.ts` (`deactivateMember`), `src/lib/members/provisioning.ts` (`DEACTIVATED_BAN`) |
| P8 | RLS: a member reads only their own row and only while active (`members_select`), so a deactivated member's still-valid token reads nothing. | `supabase/migrations/20261031171704_members_select_requires_active.sql`; `docs/ARCHITECTURE.md` D-05 |
| P9 | Route protection: `src/proxy.ts` (Next.js 16 name for middleware) refreshes the session with `getClaims()` and redirects visitors without a session to `/login?next=...`. Public paths: `/login`, `/offline`. It is declared a coarse gate; every page (`requireMember`) and Server Action (`requireActionMember`) re-checks. | `src/proxy.ts`, `src/lib/supabase/proxy.ts`, `src/lib/auth.ts` |
| P10 | `?next=` goes through `safeRedirectPath()`: same-origin absolute path only, max 512 chars, no control characters, rejects `//` and `/\`, never returns to `/login`. | `src/lib/safe-redirect.ts` |
| P11 | Logout is a Server Action calling `signOut({ scope: "local" })`, then redirect to `/login`. | `src/app/actions/auth.ts` |
| P12 | PI-CORE treats "signed in but no active member row" (unlinked OR inactive) as one state `no-member` and sends it to `/login?reason=inactive` with "Akun ini tidak aktif. Hubungi admin PMK ITERA." and drops the local session. | `src/lib/auth.ts` (`getSessionState`, `requireMember`), `login-form.tsx` |
| P13 | Auth settings in the repo (local only): `jwt_expiry = 3600`, refresh-token rotation on, `minimum_password_length = 8`, `password_requirements = letters_digits`, `sign_in_sign_ups = 30` per 5 minutes per IP. Session `timebox` and `inactivity_timeout` are commented out (not used). | `supabase/config.toml` `[auth]`, `[auth.rate_limit]`, `[auth.sessions]` |
| P14 | Hosted project: only three Auth keys were ever pushed (`enable_signup = false`, `minimum_password_length = 8`, `password_requirements = letters_digits`), the rest left at hosted defaults. Site URL = `https://pi-core-v2.vercel.app`. PI-CORE sends no email, so redirect URLs are not used yet. | `docs/OPERATIONS.md` 2026-11-01 and 2026-11-02 entries |
| P15 | Changing a member's email in PI-CORE also updates the Auth login email (rolls back if Auth refuses). | `src/app/(app)/members/actions.ts` lines 127-138 |
| P16 | Login page also shows a disabled "Masuk dengan Google / Segera hadir" row. | `src/app/login/page.tsx` |

**From NEXUS's own database (already written, not applied yet):**
- `nexus.my_context()` is SECURITY INVOKER and reads `public.members` under PI-CORE's RLS. **Zero rows = No access** (no session, not linked, or inactive). It never reads `must_change_password` (checklist item 6 in `supabase/README.md`, locked rule L4); the flag is read only by the dedicated caller-only function `nexus.my_password_change_pending()` (D-015, migration `20261106100000_nexus_password_change_pending.sql`), which returns true only for an active linked member with a temporary password, else false. Source: `supabase/migrations/20261105100000_nexus_schema_and_access.sql`.
- `nexus.my_permissions()` and the RLS helpers (`current_member_id()`, `is_system_admin()`) also require an active member, so a valid token of a deactivated member returns nothing from NEXUS tables either.
- The functions can be called only by the signed-in user's own session (`authenticated`), never by `anon` or `service_role`.

**Could not verify (needs the owner or the PI-CORE maintainer) [UNVERIFIED]:** live hosted values for sign-up disabled (B12), JWT expiry, refresh-token and session limits, real rate limits, whether `nexus` is already exposed, any SMTP setting, any CAPTCHA. See E6.

---

## 3. What NEXUS handles itself, and what it sends to PI-CORE

| Topic | NEXUS does | PI-CORE does | Recommendation |
|---|---|---|---|
| Sign in | Own login screen, calls Supabase Auth with the shared account | Owns the account | NEXUS handles (needed; sessions are not shared across domains) |
| Create account / sign up | Nothing. No sign-up link, no route | Admin creates the account | PI-CORE only (D-002) |
| Deactivate / reactivate | Nothing; reads the result | Admin deactivates (ban + `is_active`) | PI-CORE only |
| First-login password change | Detects it (if E1 b/c), blocks the app, shows a link | Shows the change screen, clears the flag | PI-CORE only (NEXUS cannot do it: P5) |
| Normal password change | Link "Ganti kata sandi" to PI-CORE profile [ASSUMPTION] | PI-CORE Profile page | PI-CORE only |
| Forgot password | Static note, same wording idea as PI-CORE (P3) | Admin issues a temporary password | PI-CORE only (E2) |
| Logout | Ends the NEXUS session only | n/a | NEXUS handles |
| Session refresh and expiry | Refreshes cookies per request, sends to login when refresh fails | Supabase Auth | NEXUS handles |

### 3.1 Temporary password (`must_change_password = true`): options

The problem: PI-CORE accounts start with a temporary password that an admin has seen. PI-CORE blocks the member until they choose their own. NEXUS cannot read the flag (L4) and cannot clear it (P5, no service role). Decide what NEXUS does when such a person logs in.

| Option | How it works | Pros | Cons / security trade-off |
|---|---|---|---|
| **A. Ignore the flag** | NEXUS never checks. Person logs in with the temporary password and uses NEXUS normally. | Zero new data exposure; L4 stays as written; simplest. | The temporary password stays a working key into NEXUS for as long as the person never opens PI-CORE (no expiry). The admin who issued it, or anyone who saw it, can open NEXUS as that member, including Finance or BPH views. This defeats the point of the forced change. Weakest option. |
| **B. Narrow own-flag function + app-level gate + redirect** (recommended) | New `nexus` function (invoker, answers only about the caller, returns one boolean such as "password change pending"). The app calls it with `my_context()`. If true: show the "change password in PI-CORE" state, no module data, link to PI-CORE `/change-password`. After the change, the NEXUS session continues (P6: other sessions survive) and the next request passes. | Same protection PI-CORE itself has (P4: also app-level only). Exposure is one boolean about yourself, readable already by the user in PI-CORE (`select` on own row works for the user). No service role needed. | Needs the owner to amend L4 and the checklist rule ("never read `must_change_password`") to "read only as a caller-only boolean through this one function; never returned for anyone else". RLS does not enforce it, so a user with the temporary password who calls the NEXUS API directly (not the app) is not stopped; same limit as PI-CORE today. |
| **C. B plus database enforcement** | As B, and also `nexus.current_member_id()` returns null while the flag is true, so every NEXUS RLS policy denies. | Strongest: even direct API calls are blocked. | Every RLS check now reads the flag (slower, wider reach of the sensitive column); changes the engine that is already written and tested; goes beyond what PI-CORE itself does. Overkill for Phase 1. |
| **D. NEXUS runs its own change-password screen** | NEXUS sets the new password and clears the flag. | One place for the user. | **Not possible without the service role** (P5): members cannot update their own row, and `updateUser` as the user would change the password but leave the flag true, so PI-CORE would force the change again. Violates the no-service-role rule. Rejected. |

**Recommendation: B.** It restores the intent of the forced change at small cost. Fallback if the owner wants zero change to L4 in Phase 1: A, accepted as a documented risk, with the PI-CORE admin told to hand out temporary passwords only to people who will log in to PI-CORE first (E1).

---

## 4. User flows

Names: **NEXUS** = this app. **PI-CORE** = the other app on another domain. Sessions are NOT shared between them (different domains), so a person signs in once per app with the same email and password.

### F1. First visit (anonymous)
1. The person opens the NEXUS address.
2. The server sees no session and redirects to `/login` (no `?next=` when the target is the home page).
3. The login screen shows (section 6.1). No sign-up link, no "create account".

### F2. Login success, active member
1. The person enters email and password and presses "Masuk".
2. The browser asks Supabase Auth to sign in (browser-side, so the rate limit counts the member's own IP).
3. On success the app re-issues the session cookies from the server and goes to `next` (checked, section 8.5) or the home page.
4. The first server render calls `my_context()` (section 8.2). One row = active member. [If E1 b/c: also the password-pending check.]
5. The member lands on the Dashboard (the shell entry point, section 6.5). The menu and cards follow `my_permissions()` (access-control spec).

### F3. Wrong credentials
1. Supabase Auth refuses.
2. The form shows one message: "Email atau kata sandi salah." Same message for an unknown email, a wrong password, and a deactivated (banned) account, so the form cannot be used to find out who exists (P2).
3. Fields stay filled except the password. No hint about which part is wrong. No counter of attempts left.
4. On HTTP 429: "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi." Button stays usable after the wait.
5. Empty field: "Isi email dan kata sandi kamu." (checked in the browser first, no request sent).

### F4. Deactivated member
Two cases.
- **Deactivated before login (normal case).** PI-CORE banned the Auth user, so sign-in fails and the person sees the F3 message. NEXUS cannot and should not say "deactivated" here (enumeration). Nothing else happens.
- **Ban call failed, or deactivated while a session exists (section 8.4).** Sign-in or the next request succeeds at the Auth level, `my_context()` returns 0 rows, and the person sees the No-access state (F5 screen). The local session is dropped.

### F5. Auth user without a member row (unlinked)
1. Sign-in succeeds (the Auth account exists).
2. `my_context()` returns 0 rows.
3. The person sees the No-access state: "Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA." plus a "Keluar" button. No data, no menu. The local session is dropped when they press "Keluar" (or immediately, see section 8.4).
4. NEXUS does not try to tell "unlinked" from "deactivated": it cannot (one function, zero rows) and showing the difference would reveal account status (E5).
5. This state appears only AFTER correct credentials, so it does not help someone guessing passwords.

### F6. Still on a temporary password (`must_change_password = true`)
Depends on E1. With the recommended option B:
1. Sign-in succeeds; `my_context()` returns one row; the password-pending check says true.
2. The app shows the "Ganti kata sandi dulu" state (section 6.3): short text, a primary button "Buka PI-CORE" (opens PI-CORE `/change-password` in a new tab, D-017, so this NEXUS page stays open for "Sudah ganti? Muat ulang"), "Keluar", and a secondary "Sudah ganti? Muat ulang".
3. While the flag is true, every NEXUS page and Server Action returns this state and no module data (app-level gate, same as PI-CORE).
4. The person opens PI-CORE (separate login there, same temporary password; PI-CORE then lands on its change-password page because it keeps `next=/change-password` through its login), chooses a new password, returns to NEXUS and presses "Muat ulang". The next check says false and they enter normally. No new NEXUS login is needed (P6).
5. With option A: no state; the flow is F2.

### F7. Forgot password
1. On the login screen the person presses "Lupa kata sandi?".
2. An inline note opens (no form, no email): "Kata sandi direset oleh admin PMK ITERA. Minta kata sandi sementara kepada mereka, lalu ganti di PI-CORE." (adapted from PI-CORE's `login.forgotNote`).
3. After the admin issues a temporary password, the person logs in (F2 then F6).
4. No self-service reset exists anywhere because PI-CORE has no email delivery (P3). If PI-CORE adds SMTP later, a reset page can be added (E2).

### F8. Logout
1. The person opens the menu and presses "Keluar".
2. A Server Action ends THIS browser's NEXUS session (local scope) and redirects to `/login`.
3. It does not sign the person out of PI-CORE (other domain). The confirmation text on the login screen is not needed.
4. After logout, pressing Back shows the login screen again (pages are not cached for signed-out users; the proxy and page checks both apply).

### F9. Session expiry
1. Access tokens are short-lived (1 hour by default, P13) and refreshed automatically on each request by the proxy; the refresh token lives in the cookie (400 days, P1).
2. When refresh fails (the Auth user was banned or deleted, refresh token revoked or reused, long offline), the next request has no valid session.
3. A page request redirects to `/login?next=<current page>` with the notice "Sesi kamu berakhir. Masuk lagi."
4. A Server Action returns a "session ended" result; the screen shows the same notice and a "Masuk" button. Unsaved form text is kept in the browser if technically simple; otherwise the person is told their last action was not saved [ASSUMPTION].

### F10. Deep link to a protected page while logged out
1. The person opens `/finance` (for example) with no session.
2. The server redirects to `/login?next=%2Ffinance`.
3. After a successful login the person goes to `/finance`.
4. If they are signed in but lack the right, they get the "no permission" page of the access-control spec (not the No-access state), never the data.
5. `next` is validated (section 8.5). Anything invalid becomes the home page.
6. If the person lands in No access or password-pending, `next` is dropped.

### F11. Logged in, but only baseline rights
1. `my_context()` returns a row; `my_permissions()` returns only what baseline rules give (default: `inventory.view`) plus the fixed own-request rights (L9).
2. The person sees the normal shell and Dashboard with only the cards they may open (AC-31). This is NOT the No-access state: they are a valid member with few rights.
3. Empty areas show a plain empty state, not "no access" wording. A module the person cannot view is absent from the menu; a direct link shows the "no permission" page.
4. Lecturers (`member_type = lecturer`) and members with no assignment in the active period are in this group [A-B15].

### F12. Member opens NEXUS during a period change or with no active period
1. Login does not depend on the period. A valid active member always passes the login gate.
2. `my_context()` returns `active_period_id = null`; the shell shows the banner from access-control R11 ("Belum ada periode aktif") and baseline-only behavior.

---

## 5. Business rules

| # | Rule |
|---|---|
| AR1 | NEXUS has no sign-up, no invite, no account creation, no password reset, no password change, and no way to change `is_active`. These routes do not exist (not hidden: absent). |
| AR2 | The only identity is the Supabase Auth user of PI-CORE. A person is a NEXUS user if and only if `my_context()` returns a row for their session (L1). |
| AR3 | NEXUS never uses the service-role key. It is not in NEXUS's environment variables at all. The browser and server use only the project URL and the publishable (anon-level) key. |
| AR4 | A valid token is never enough. Every request re-checks `my_context()` on the server (AR8). The result is cached only inside one request, never across requests, in cookies, or in the JWT (R3). |
| AR5 | Error wording must not reveal whether an email exists or whether an account is deactivated or unlinked before the correct password is given. |
| AR6 | System access and organizational position stay separate: login says nothing about roles; admin status is `is_system_admin` from `my_context()` (L2). |
| AR7 | Messages shown to people are Indonesian, short, plain. Server codes and Supabase messages are never shown raw. |
| AR8 | **Every** protected page, Server Action, and route handler calls the shared session check itself. A layout check alone is not enough, because Next.js layouts are not re-run on every in-app navigation. The proxy is only a first, coarse gate (same design as PI-CORE, P9). |
| AR9 | The login screen is the only public screen (plus static assets, PWA files, and an offline page if the scaffold adds one). Everything else needs a session. |
| AR10 | If `my_context()` fails with an error (network, `nexus` schema not exposed, database down), NEXUS fails closed: it shows the "gangguan" error state, no data, and it does NOT treat the error as "no access" and does NOT sign the person out. |
| AR11 | Permissions are not stored by login. After login the app calls `my_permissions()` per request (access-control R3). |
| AR12 | NEXUS never reads or logs a password, never puts one in a URL, and never writes the email into a URL. |

---

## 6. Screens and states (words only)

### 6.1 Login (`/login`, public)
- **Purpose:** sign in with the PI-CORE account.
- **Elements:** short heading ("Masuk"), one-line lead saying it uses the PI-CORE email and password, email field (mobile keyboard for email, no auto-capitalize, username autofill), password field with show/hide toggle (label for assistive tech), "Lupa kata sandi?" link that opens the inline note, submit button.
- **Not shown:** sign-up, "create account", social login (PI-CORE shows a disabled Google row, P16; NEXUS shows no dead control).
- **Footer line:** "Akun dibuat oleh admin PMK ITERA." (same as PI-CORE).
- **States:** idle; submitting (button disabled with "Memeriksa..." and a progress indicator); error (alert text above the form, announced to screen readers); notice from redirect ("Sesi kamu berakhir. Masuk lagi."); forgot-note open.
- **If already signed in as an active member:** redirect to `next` or home (as PI-CORE does).
- **Visuals:** open (C13, A6): reuse PI-CORE's "Masuk PMK ITERA" design or NEXUS's Stitch style. Palette and layout come from the UX designer.

### 6.2 No-access state (signed in, `my_context()` has 0 rows)
- Reached after correct credentials only. Heading "Belum ada akses". Text: "Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA." Button "Keluar". No menu, no data, no links into modules.
- Drops the local session on the first render, so refresh sends the person to login.
- Same screen for deactivated mid-session and unlinked (E5).

### 6.3 Password-pending state (only with E1 b or c)
- Heading "Ganti kata sandi dulu". Text: "Kamu masih memakai kata sandi sementara. Ganti kata sandi di PI-CORE, lalu kembali ke sini." Buttons: "Buka PI-CORE" (primary, goes to PI-CORE `/change-password`), "Sudah ganti? Muat ulang" (secondary, re-checks), "Keluar".
- No menu and no data. The PI-CORE address comes from one configuration value, not hard-coded text [ASSUMPTION A-AUTH-2].

### 6.4 Loading, error, and offline states
- **Loading (after login, while `my_context()` runs):** a simple skeleton of the shell, no spinner-only page. Never shows module data before the check ends.
- **Error ("Terjadi gangguan"):** "Terjadi gangguan. Coba lagi sebentar lagi." with a "Coba lagi" button. Used for AR10 and any 5xx. No technical detail on screen.
- **No network:** on the login form: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi." The form stays filled.
- **Session ended:** a notice on the login screen (F9), never a blank page or a raw 401.

### 6.4a Proposed Indonesian copy (to be reviewed by the owner; reuses PI-CORE wording where it exists)

| Key | Text |
|---|---|
| Wrong credentials | "Email atau kata sandi salah." |
| Too many attempts | "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi." |
| Empty fields | "Isi email dan kata sandi kamu." |
| No network | "Tidak bisa terhubung. Periksa internetmu lalu coba lagi." |
| Server problem | "Terjadi gangguan. Coba lagi sebentar lagi." |
| Session ended | "Sesi kamu berakhir. Masuk lagi." |
| Forgot note | "Kata sandi direset oleh admin PMK ITERA. Minta kata sandi sementara kepada mereka, lalu ganti di PI-CORE." |
| No access (heading, body) | "Belum ada akses" / "Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA." |
| Password pending (heading, body) | "Ganti kata sandi dulu" / "Kamu masih memakai kata sandi sementara. Ganti kata sandi di PI-CORE, lalu kembali ke sini." |
| Rights changed mid-use | "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA." |
| Buttons | "Masuk", "Keluar", "Buka PI-CORE", "Sudah ganti? Muat ulang", "Coba lagi" |

### 6.5 Logged-in shell entry point
- After login the person goes to `next` or `/` (Dashboard). The Dashboard is visible to every active member (A-n1); each card appears only if the matching `*.view` permission exists.
- Header shows the person's first name or full name from `my_context().full_name` and a "Keluar" action in the menu. The active period label (`active_period_label`) shows where the design has a place for it.
- System Admin sees the settings entry because `is_system_admin` is true (L3); nobody else does.

---

## 7. Roles: who may do what at the login layer

Login itself is the same for everyone. This table covers only the login and session layer.

| Actor | Sign in to NEXUS | See the app after sign-in | Notes |
|---|---|---|---|
| Anonymous | Can open `/login` only | Nothing; every other path redirects to login | AC AUTH-01 |
| Active member (any position, lecturer, no assignments) | Yes | Shell + whatever the access rules give | Rights come from access-control |
| System Admin (`access_level` admin or super_admin, active) | Yes | Same shell; plus settings (L3) | Admin status never comes from a position (D-007) |
| Deactivated member | No (banned at Auth). If a session still exists: No-access state | Nothing | L1, P7 |
| Auth user without member row | Auth succeeds, then No-access state | Nothing | L1, E11 |
| Member on a temporary password | Auth succeeds, then password-pending state (E1 b/c) | Nothing until PI-CORE password change | E1 |
| Any role, changing their own password | Not in NEXUS; PI-CORE only | n/a | P5 |
| Any role, creating or deactivating accounts | Not in NEXUS | n/a | AR1 |

---

## 8. Server-side rules

### 8.1 Route protection (three layers, none alone is trusted)
1. **Proxy** (Next.js 16 `proxy.ts`): refreshes session cookies and redirects visitors without a session to `/login?next=...`. Coarse gate only. Static assets and PWA files are excluded so they load without a session. It must not be the only check (AR8).
2. **Page / route-handler check:** every protected page and route handler calls the single shared session function (section 8.2) and renders or redirects from its result.
3. **Server Action check:** every Server Action calls the same function first and returns an error result (not a redirect, not data) when the state is not "member". RLS is then the last layer; it checks `is_active` itself through `nexus.current_member_id()` (L1, R10).

The login Server Action that re-issues cookies (P1) and the logout Server Action are the only actions that run without a member check; they must do nothing but handle the caller's own session.

### 8.2 Where `my_context()` is called
- In **one** function in `src/lib/picore/` (the only place that talks to PI-CORE-backed functions; CLAUDE.md section 4), wrapped by one session function in `src/lib/auth/` that returns one of: `anonymous`, `no-access`, `password-pending` (E1), `member` (with `member_id`, `full_name`, `member_type`, `is_system_admin`, `active_period_id`, `active_period_label`), or `error`.
- The session function first validates the JWT (`getClaims()`), then calls `my_context()` with the user's own session client. No other file calls `my_context()`.
- Cached per request only (one call per page render or action).
- `my_permissions()` is called next, only when the state is `member`.

### 8.3 What the database already guarantees
- `my_context()` and the RLS helpers return nothing for an inactive or unlinked user even with a valid token (P8, L1). So a UI bug cannot leak data.
- The service-role key is not available to NEXUS code or to the NEXUS functions (`supabase/README.md` section 3).

### 8.4 Member deactivated during a session
1. PI-CORE sets `is_active = false` and bans the Auth user. The current access token stays cryptographically valid until it expires (about 1 hour by default, P13, [UNVERIFIED] for hosted). Refresh stops working because of the ban.
2. From the next NEXUS request on, `my_context()` returns 0 rows, so the session check says `no-access`. Data calls fail at once (RLS, L1), even before the token expires.
3. The app shows the No-access state, drops the local session, and Server Actions return the "Aksesmu sudah berubah" result.
4. Open pages do not update by themselves; the next click or action fails with that message (E5/E22 in access-control).
5. NEXUS does not need Realtime or polling for this in Phase 1.

### 8.5 `next` (return address) safety
NEXUS implements its own check (it must not import PI-CORE code), with the same rules as PI-CORE's `safeRedirectPath` (P10): same-origin absolute path starting with `/`; at most 512 characters; no control characters; reject `//` and `/\`; never `/login`; anything else becomes `/`. Never redirect to a full URL from a query value.

### 8.6 Brute force and rate limiting (what already exists)
- Supabase Auth limits sign-in attempts per client IP (local config: 30 per 5 minutes per IP, P13). Because sign-in runs in the browser, the limit is per member, not per Vercel server. A server-side login would put all members on a few Vercel IPs and could lock everybody out during a busy meeting (PI-CORE D-09). NEXUS follows the same design.
- Counters are per project, so NEXUS and PI-CORE sign-ins from the same IP share the budget.
- Supabase does not lock an account after N failed attempts and PI-CORE has no CAPTCHA (docs/SECURITY.md). Gap accepted for Phase 1; a CAPTCHA (Turnstile or hCaptcha) is the upgrade path [ASSUMPTION A-AUTH-4].
- NEXUS adds no own counter and no own throttling table (keeps the database free of login data).
- Hosted values are [UNVERIFIED] (E6).

### 8.7 Secrets and cookies
- Client code holds only the project URL and the publishable key. The service-role key never exists in NEXUS (AR3). `.env.example` lists names only.
- Session cookies come from `@supabase/ssr`, `SameSite=Lax`, `Secure` in production. Because PI-CORE re-issues them from the server for iOS (P1), NEXUS does the same so an installed PWA is not logged out after 7 days [ASSUMPTION A-AUTH-3].
- Logout and login are Server Actions (POST, origin check). No GET route changes session state.
- Security response headers and no caching of authenticated pages: same intent as PI-CORE (docs/SECURITY.md "Stale authorization in caches").

### 8.8 Supabase project settings NEXUS depends on
- Sign-up must stay disabled (B12). NEXUS relies on "every Auth user is created by PI-CORE".
- `nexus` must be in "Exposed schemas" before `my_context()` can be called (supabase/README.md section 1); until then the login works but the app shows the "gangguan" state.
- NEXUS needs no redirect URL now (no email links). If email is added later, the NEXUS address must be added to the shared project's redirect list, which is a shared setting.

---

## 9. Data needed

**Read (through the user's session):** result of `my_context()` (member_id, full_name, member_type, is_system_admin, active_period_id, active_period_label); [E1 b/c only] one caller-only boolean "password change pending"; `my_permissions()`.

**Never read, stored, or logged by this module:** passwords, tokens beyond what `@supabase/ssr` keeps in its own cookies, email addresses in NEXUS tables, `email`, `phone`, `nim`, `nip` (L4), any Auth admin data.

**Stored by NEXUS for login:** nothing. No login table, no login history table (Supabase Auth keeps its own logs).

**Configuration values:** Supabase project URL, publishable key, PI-CORE base URL for the "Buka PI-CORE" button (not secret).

---

## 10. Edge cases

| # | Case | Expected behavior |
|---|---|---|
| EC1 | Period switches while someone is logged in | Login is unaffected. Next request: permissions recompute (access-control R3); `active_period_id` in `my_context()` changes; no logout needed. |
| EC2 | No active period | Login works (F12). Banner shown; baseline only. |
| EC3 | Member deactivated mid-session | Section 8.4: No-access on the next request; session dropped. |
| EC4 | Member reactivated | Ban lifted by PI-CORE; login works again; nothing cached in NEXUS, so no stale state. |
| EC5 | Member holds multiple assignments | Irrelevant to login; permissions are the union (access-control R2). |
| EC6 | Member email changed in PI-CORE | PI-CORE keeps the Auth email in sync (P15), so the new email is the login. Old sessions stay valid. |
| EC7 | Admin issues a new temporary password to a member who is logged in to NEXUS | PI-CORE sets the flag true again; the existing NEXUS session survives (P6); with E1 b/c the next request shows password-pending. With A: nothing. |
| EC8 | Admin's `access_level` lowered while on settings | Next request: no admin rights (access-control E13); login unaffected. |
| EC9 | Same person logged in on two devices | Independent sessions. Logout ends only the device that pressed it. |
| EC10 | Person logs in to NEXUS but never to PI-CORE | Fine; sessions are separate. If the flag is true, E1 decides. |
| EC11 | Supabase Auth or the database is down | Login shows "Terjadi gangguan" (not "wrong password"). An existing session shows the error state, not No access (AR10). |
| EC12 | Supabase project paused (free tier inactivity) | Same as EC11. Documented as a handover note: someone must open the project to wake it, then retry. [ASSUMPTION: free-tier pause behavior, to verify with devops] |
| EC13 | Two users share one computer | Logout ends the local session; the password field is not prefilled by NEXUS; shared-device warning is not added. |
| EC14 | Direct visit to `/no-access` or the password-pending page without being in that state | Redirect to home (or login when anonymous); the pages are not bookmarkable standalone. |
| EC15 | Link opened from chat apps with extra query values | Only the checked `next` value is used; other values are ignored. |
| EC16 | Browser blocks cookies | Login cannot keep a session; the person returns to login. A short hint "Aktifkan cookie di browser" is optional [ASSUMPTION]. |
| EC17 | Person signs in at PI-CORE, expecting to be signed in at NEXUS | Not shared (other domain). The login screen's lead line says "Pakai email dan kata sandi PI-CORE" so it is not a surprise. |

---

## 11. Open questions for the owner

Also appended to `docs/OPEN_QUESTIONS.md`, section E. One short question each.

**E1. What should NEXUS do when a member still has a temporary password (`must_change_password = true`)?** Needs a change to locked rule L4.
- (a) Ignore it; the temporary password works in NEXUS until the person changes it in PI-CORE.
- (b) NEXUS reads ONLY the caller's own flag through one narrow function, blocks the app, and sends the person to PI-CORE to change the password.
- (c) As (b), and the database also refuses every NEXUS query while the flag is true.
- Recommendation: **(b)**. (a) leaves a shared secret open; (c) is heavier than PI-CORE itself. (b) matches PI-CORE's own protection with one boolean about yourself. If (a): record as an accepted risk.

**E2. Where do password reset and password change happen?**
- (a) Only in PI-CORE; NEXUS shows a note and a link (PI-CORE has no email delivery, so no self-service reset exists).
- (b) Ask the PI-CORE maintainer to add email (SMTP) and a reset page, then NEXUS adds a reset link later.
- (c) NEXUS builds its own change/reset screen (not possible without the service role; listed only for completeness).
- Recommendation: **(a)** now; (b) later if members forget passwords often.

**E3. How long may a NEXUS session last?**
- (a) Supabase defaults, same as PI-CORE: access token about 1 hour, automatic refresh, session lasts until logout or ban.
- (b) Add an app-side idle limit (for example 7 days without use, then login again).
- (c) Turn on Supabase session time-box or inactivity timeout (a shared project setting; it also affects PI-CORE and may need a paid plan [UNVERIFIED]).
- Recommendation: **(a)** for Phase 1 (parity with PI-CORE), revisit (b) once Finance holds real data.

**E4. Should "deactivated" and "not linked" accounts see different messages?**
- (a) One message for both ("Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA.").
- (b) Two messages, which needs a new function that reads inactive member rows and reveals account status.
- Recommendation: **(a)**. It matches `my_context()` (zero rows) and PI-CORE (P12). This changes the wording of access-control E11 and AC-33 ("account not linked" becomes the combined message).

**E5. Is the NEXUS login screen Indonesian only?**
- (a) Indonesian only.
- (b) Indonesian with an English switch like PI-CORE.
- Recommendation: **(a)**; one language, less to maintain at handover. [ASSUMPTION A-AUTH-1]

**E6. Who verifies the live Supabase Auth settings before go-live?** Sign-up disabled, access-token lifetime, rate limits, SMTP, CAPTCHA, exposed schemas (B12).
- (a) The owner reads the dashboard values and pastes them into `docs/ops/`.
- (b) The PI-CORE maintainer confirms.
- (c) Skip, trust the repo.
- Recommendation: **(a)**, because an open sign-up would let strangers become "unlinked users" and weaken the whole login model.

---

## 12. Assumptions made in this spec

| Id | Assumption |
|---|---|
| A-AUTH-1 | NEXUS login is Indonesian only (E5). |
| A-AUTH-2 | The PI-CORE address for "Buka PI-CORE" is `https://pi-core-v2.vercel.app` (from `docs/OPERATIONS.md`) and the change page is `/change-password`. Kept in one configuration value because a custom domain may replace it. PI-CORE keeps `next=/change-password` through its own login (P9, P10), so this deep link works for a person who is not signed in there. |
| A-AUTH-3 | NEXUS re-issues auth cookies from the server after login, like PI-CORE (P1), to avoid iOS PWA logout after 7 days. |
| A-AUTH-4 | No CAPTCHA and no own throttling in Phase 1; Supabase's per-IP limit is enough. |
| A-AUTH-5 | The "Ganti kata sandi" link in the menu points to PI-CORE's profile page; the path is not verified here. |
| A-AUTH-6 | Logout uses local scope (this browser only), as PI-CORE does (P11). |
| A-AUTH-7 | Unsaved form text after session expiry is kept only if cheap; otherwise the person is told the last action was not saved (F9). |
| A-AUTH-8 | Free-tier project pause shows as the "gangguan" state (EC12). |

---

## 13. Acceptance criteria

Personas (same names as `docs/modules/access-control.md` section 9, plus two new): P-PLAIN (active member, no assignments), P-KETUM (Ketua Umum, `access_level = member`), P-ADMIN (`access_level = admin`, active), P-INACTIVE (`is_active = false`, Auth user banned), P-INACTIVE-NOBAN (`is_active = false`, Auth user NOT banned), P-UNLINKED (Auth user without `members.user_id` match), **P-TEMPPW** (active member, `must_change_password = true`), **P-ANON** (no session). Criteria marked (E1 b/c) apply only if the owner picks option b or c.

**Anonymous and route protection**
- AUTH-01 P-ANON opening any NEXUS path other than the login screen (and static/PWA assets) is redirected to `/login`, with `?next=` holding the original path when it is not the home page.
- AUTH-02 P-ANON calling a NEXUS Server Action or route handler gets a "session ended" result and no data.
- AUTH-03 The login screen has no sign-up, create-account, or social-login control, and no route exists for sign-up, invite, or password reset.
- AUTH-04 A direct call with the publishable key and no user token to any `nexus` function or table returns no data or an error.
- AUTH-05 A signed-in user who is not in the No-access or password-pending state, visiting `/login`, is redirected to the home page (or to a valid `next`).

**Login success and failure**
- AUTH-06 P-PLAIN signs in with correct credentials and lands on the Dashboard, showing only the cards and menu entries their permissions allow.
- AUTH-07 A wrong password and an unknown email show exactly the same message, "Email atau kata sandi salah."
- AUTH-08 P-INACTIVE signing in with the correct password sees the same message as AUTH-07 (no "deactivated" wording).
- AUTH-09 An empty email or password shows "Isi email dan kata sandi kamu." and sends no request to Supabase Auth.
- AUTH-10 When Supabase Auth answers 429, the form shows "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi."
- AUTH-11 When Supabase Auth or the network is unreachable, the form shows a connection or "gangguan" message, never the wrong-credentials message, and keeps the email filled.
- AUTH-12 Sign-in is performed from the browser, not from a NEXUS server function (the rate limit counts the member's own IP).
- AUTH-13 After login the session cookies are set by a server response and are `Secure` and `SameSite=Lax` in production.

**No access (deactivated and unlinked)**
- AUTH-14 P-UNLINKED signing in with correct credentials sees the No-access state, no menu, no data, and a "Keluar" button.
- AUTH-15 P-INACTIVE-NOBAN signing in sees the same No-access state and the local session is dropped.
- AUTH-16 In the No-access state every NEXUS page, Server Action, and `nexus` API call with that user's token returns no data or an error.
- AUTH-17 The No-access state shows the same text for P-UNLINKED and P-INACTIVE-NOBAN (no difference revealed).
- AUTH-18 If `my_context()` returns an error (not zero rows), the person sees the "gangguan" state, not No access, and is not signed out.

**Temporary password**
- AUTH-19 (E1 b/c) P-TEMPPW signing in sees the password-pending state with "Buka PI-CORE", "Sudah ganti? Muat ulang", and "Keluar", and no module data.
- AUTH-20 (E1 b/c) While the flag is true, every NEXUS page and Server Action returns the password-pending state and no module data.
- AUTH-21 (E1 b/c) After P-TEMPPW changes the password in PI-CORE and presses "Sudah ganti? Muat ulang", they enter NEXUS without logging in again.
- AUTH-22 (E1 b/c) The function that returns the password-pending flag answers only about the caller, returns a single boolean, and no NEXUS response ever contains the flag of another member.
- AUTH-23 (E1 b) A direct API call with P-TEMPPW's token is NOT blocked by the database; this limit is documented (same as PI-CORE). (E1 c) The same call returns no data.
- AUTH-24 (E1 a) The decision to ignore the flag is recorded in `docs/DECISIONS.md` as an accepted risk, and `must_change_password` is not read anywhere in NEXUS.
- AUTH-25 NEXUS has no change-password screen and no code path that calls an Auth admin API.

**Forgot password**
- AUTH-26 Pressing "Lupa kata sandi?" shows the note that an admin issues a temporary password; it contains no email field and sends no request.

**Logout and session**
- AUTH-27 P-PLAIN pressing "Keluar" ends the NEXUS session and shows `/login`; pressing Back does not show protected data.
- AUTH-28 Logout in NEXUS does not end the person's PI-CORE session.
- AUTH-29 When the session cannot be refreshed, a page request redirects to `/login?next=...` with the notice "Sesi kamu berakhir. Masuk lagi."
- AUTH-30 When the session cannot be refreshed during a Server Action, the action returns a "session ended" result and the screen shows the same notice.
- AUTH-31 Opening a protected link while logged out, then logging in with valid access, ends on that page.
- AUTH-32 `next` values `https://evil.example`, `//evil.example`, `/\evil.example`, a value longer than 512 characters, a value with control characters, and `/login` all end on the home page.

**Deactivation during a session**
- AUTH-33 After PI-CORE deactivates P-PLAIN or P-KETUM, their next NEXUS request shows the No-access state even though the access token has not expired (matches access-control AC-44).
- AUTH-34 After PI-CORE deactivates P-PLAIN, a direct `nexus` API call with the still-valid token returns no data.
- AUTH-35 After PI-CORE reactivates the member and lifts the ban, they can sign in again and see their normal access with no manual cleanup in NEXUS.

**Baseline and System Admin**
- AUTH-36 P-PLAIN lands on a normal Dashboard (not the No-access state), sees no card for a module they cannot view, and a direct link to such a module shows the "no permission" page.
- AUTH-37 P-ADMIN signs in, `is_system_admin` is true, and the settings entry is shown. P-KETUM (a position that makes `private.is_admin()` true in PI-CORE) does not get the settings entry.
- AUTH-38 After the active period switches, a signed-in person is not logged out; their permissions change on the next request.
- AUTH-39 With no active period, P-PLAIN and P-ADMIN can still sign in and see the "Belum ada periode aktif" banner.

**Security checks**
- AUTH-40 No NEXUS bundle, page source, response, or environment file contains the service-role key; the NEXUS environment has no variable for it.
- AUTH-41 `my_context()` is called from exactly one function in `src/lib/picore/`, and only `src/lib/auth/` consumes it.
- AUTH-42 Every protected page and Server Action in the scaffold calls the shared session check (an automated test or lint list proves no route skips it).
- AUTH-43 No message shown to a person contains a raw Supabase error, a stack trace, a user id, or the word "banned".
- AUTH-44 The password field never appears in a URL, a log line, or an error report.

---

## 14. Conflicts and notes for other documents (not changed here)

1. `docs/modules/access-control.md` E11 and AC-33 say P-UNLINKED sees "Your account is not linked to a member". With one `my_context()` (zero rows) and E4(a), the message is the combined No-access text. Update after the owner answers E4.
2. L4 and `supabase/README.md` checklist item 6 say NEXUS never reads `must_change_password`. E1 (b/c) needs a narrow exception. Update only after the owner approves.
3. `docs/PMK-NEXUS-context.md` section 5 says login is "via PI-CORE; no screen exists in Figma yet". Still true; this spec describes states only.
4. CLAUDE.md section 4 says "PI-CORE's Supabase Auth. One account for all apps." True for credentials; sessions are not shared across domains, so people log in once per app (stated on the login screen, EC17).
5. `docs/OPEN_QUESTIONS.md` D3 (deactivated members get no access) is now also covered by L1 and AUTH-33; it can be marked answered by the owner.
6. B12 (live Auth settings) is the same check as E6.
