# QA: Connection and login (step 2)

Spec: `docs/modules/auth-login.md` (criteria AUTH-01..AUTH-44, section 13). Design: `docs/design/login.md`. Decisions: D-015, D-016, D-017, D-018.
Owner of this file: QA (`nexus-qa-tester`). Last updated 2026-11-06.

## 1. How to run the automated tests

Prerequisites: NEXUS local stack running (`bash scripts/dev-db.sh start`), `.env.local` pointing at it (API `http://127.0.0.1:55431`), `pnpm build` done.

| What | Command | Notes |
|---|---|---|
| Unit tests (Vitest), about 1 second | `pnpm exec vitest run` | No stack needed. |
| E2E (Playwright), about 7 minutes | `pnpm exec playwright test` | Starts (or reuses) `next start` on port 3100. Projects `mobile` (390x844) and `desktop` (1280x800, `desktop.spec.ts` only). |
| One project or file | `pnpm exec playwright test tests/e2e/personas.spec.ts --project=mobile` | |
| Outage test (opt-in) | `E2E_STACK_FAULT=1 pnpm exec playwright test tests/e2e/fault.spec.ts --project=mobile` | Stops the local REST container for a few seconds, then starts it again. Local NEXUS stack only. |

Suggested `package.json` scripts: `"test": "vitest run"`, `"test:e2e": "playwright test"`, `"test:all": "vitest run && playwright test"`.

Why the E2E run is slow: Supabase Auth allows 30 sign-ins per 5 minutes per IP (`supabase/config.toml`). The helper `throttleSignIn()` in `tests/e2e/helpers.ts` keeps the suite at 22 per window and waits when needed (state in `node_modules/.cache/pmk-nexus-e2e/`). Do not log in by hand while the suite runs.

Safety: `global-setup.ts` refuses to run unless the API URL is `127.0.0.1:55431`. Tests that change data (`is_active`, `must_change_password`, ban, active period) restore it in `finally`; `global-setup` and `global-teardown` also reset every `@nexus.test` account and the periods to the documented seed state. Never run the suite against the hosted project.

## 2. Test layout

| File | Covers |
|---|---|
| `tests/unit/redirect.test.ts` | `safeRedirectPath`: all rules of spec 8.5, tricky inputs, 5000-case fuzz. |
| `tests/unit/sign-in.test.ts` | Browser sign-in helper: error mapping, empty fields, offline, finalize step. |
| `tests/unit/picore-context.test.ts` | PI-CORE readers: shape validation, fail-closed behaviour, logging hygiene. |
| `tests/unit/session.test.ts` | `getAccessState` order: anonymous > error > no_access > password_pending > member. |
| `tests/unit/claims.test.ts` | `verifySession`: which Auth errors mean "logged out" and which mean "could not tell". |
| `tests/unit/proxy.test.ts` | Proxy redirect rules (`next`, `reason`, public paths, POST, no-store). |
| `tests/unit/env-cookies.test.ts` | Cookie options, secret-key guard, PI-CORE URL guard. |
| `tests/unit/static-rules.test.ts` | Source-code rules: one `my_context` caller, no service role, every page and action checks the session, no sign-up routes, no password logging. |
| `tests/e2e/login-screen.spec.ts` | Login screen, errors, mocked 429/500/offline, keyboard, touch targets, `next` handling. |
| `tests/e2e/personas.spec.ts` | Persona results, no-access, temporary password, deactivation mid-session, logout, period change. |
| `tests/e2e/security.spec.ts` | Anonymous API denial, sign-up closed, no secret in the bundle, no raw errors. |
| `tests/e2e/desktop.spec.ts` | Desktop layout, keyboard-only sign-in, focus visibility. |
| `tests/e2e/fault.spec.ts` | Opt-in outage test for AUTH-18. |

## 3. Persona matrix (what each must see and what must be blocked)

At this step only login exists, so "permissions" means the login layer. Role rights (Finance, Letters, ...) are tested with the access-control and module steps. Personas the local seed does not have are listed as "needs seed".

| Persona (local account) | Must see and do | Must be blocked | Automated |
|---|---|---|---|
| System Admin (`admin@nexus.test`) | Signs in, Dashboard, own name, period. Settings entry only when the settings module exists (AUTH-37). | Nothing about login; admin status never comes from a position. | Dashboard yes. Settings entry: not testable yet. |
| Treasurer (`bendahara@nexus.test`) | Signs in, Dashboard. Finance rights come later. | Settings entry (later). | Dashboard yes. |
| Secretary | Same as above. | Same. | Needs seed (no Sekretaris account yet). |
| Operations Head and staff | Same as above. | Same. | Needs seed. |
| BPH (`ketum@nexus.test`, Ketua Umum) | Signs in, Dashboard. | Settings entry (AUTH-37, `private.is_admin()` is true in PI-CORE but NOT `is_system_admin`). | Dashboard yes. Settings entry: not testable yet. |
| Regular member (`member.regular@nexus.test`) | Signs in, Dashboard, no module cards. | Modules they cannot view; other members' data (API test). | Yes. |
| No assignment (member without any assignment) | Valid member, Dashboard, not "Belum ada akses" (F11). | No-access wording. | `member.regular` has an assignment. Needs seed for a pure no-assignment member. Same code path: `my_context()` does not read assignments. |
| Deactivated member (`member.inactive@nexus.test`) | If banned: "Email atau kata sandi salah." If only `is_active=false`: "Belum ada akses", session dropped, reload goes to /login. | Any data; any hint of "deactivated". | Yes (both cases, plus reactivation). |
| Unlinked (`unlinked@nexus.test`) | "Belum ada akses", same text as deactivated. | Any data. | Yes. |
| Temporary password (`member.temppw@nexus.test`) | "Ganti kata sandi dulu", link to PI-CORE in a new tab, "Sudah ganti? Muat ulang", "Keluar". | Dashboard and every page until the flag clears. | Yes. |
| Officer from a PREVIOUS period | Signs in (login ignores the period). Rights follow the active period only (access-control step). | Previous-period rights. | Needs seed with an assignment only in 2025/2026. Period switch itself is tested (AUTH-38). |
| Anonymous | `/login` only. | Everything else, including API functions and tables. | Yes. |

## 4. Period change (AUTH-38, AUTH-39, EC1, EC2)

Automated in `personas.spec.ts`: a signed-in member stays signed in when the active period is switched (label changes on the next request), and with NO active period both a member and the admin still sign in and see "Belum ada periode aktif.". Old data staying as history is a module concern (no module data exists yet).

## 5. Edge cases

| Case | Where |
|---|---|
| Empty states: empty fields, whitespace-only email, no active period | `login-screen.spec.ts`, `personas.spec.ts` |
| Very long text: 400-character email and 300-character password, 600-character and 100,000-character `next` | `login-screen.spec.ts`, `redirect.test.ts` |
| Wrong file type, duplicate letter numbers, borrowing more than the stock, expired signed URL | Not applicable to login. Belongs to Letters, Inventory, and file upload modules. |
| Expired session | `personas.spec.ts` (expired access token with unknown refresh token; banned user with expired token) |
| Auth down, network down, 429, 500 | Mocked in `login-screen.spec.ts`; real outage in `fault.spec.ts` |
| Double press on "Masuk" | `login-screen.spec.ts` (one request only) |

## 6. Manual checklist (what automation cannot cover)

Run on the hosted preview or production-like deployment before go-live. Tick and date each line.

### 6.1 Real phones (AUTH-06, design 4.5, 4.6)
- [ ] iPhone Safari: open `/login`; the keyboard does not cover the focused field; no page zoom on focus (16 px fields). (D-017 Q2)
- [ ] iPhone Safari: sign in, close the browser, reopen the next day: still signed in (server re-issued cookies, A-AUTH-3, AUTH-13).
- [ ] Android Chrome: sign in, add to home screen, reopen: still signed in.
- [ ] Both: rotate the phone; layout stays one column, no horizontal scroll.
- [ ] Both: text size at 200 percent: card grows, footer flows after the card, nothing is cut off.
- [ ] Both: all buttons are comfortable to tap with a thumb (44 px targets).

### 6.2 Password manager and autofill (AUTH-06)
- [ ] Chrome, Safari and one password manager (Bitwarden or Google Password Manager) offer to fill email and password from the PI-CORE entry.
- [ ] Autofill then pressing "Masuk" works; the email field is recognised as the username.
- [ ] After a wrong password, the password field is empty and the manager does not re-submit by itself.

### 6.3 Screen reader spot check (design 4.4)
- [ ] VoiceOver (iOS) or TalkBack (Android): the page title "Masuk ke PMK-NEXUS" is read first; fields are announced as "Email" and "Kata sandi".
- [ ] Wrong password: "Email atau kata sandi salah." is announced without moving focus away from the password field.
- [ ] Eye button: a screen reader announces "Tampilkan kata sandi", then "Sembunyikan kata sandi" after pressing (BUG-A1 fixed 2026-11-06).
- [ ] No-access and password-pending screens: the heading is read on load.
- [ ] "Buka PI-CORE" is announced as opening a new tab.

### 6.4 PI-CORE round trip on the hosted app (AUTH-19, AUTH-21, AUTH-28, E6)
- [ ] Ask a PI-CORE admin to create a test member (temporary password). Sign in to NEXUS: "Ganti kata sandi dulu" appears.
- [ ] "Buka PI-CORE" opens `https://pi-core-v2.vercel.app/change-password` in a NEW tab; if not signed in there, PI-CORE asks for login and then lands on the change page.
- [ ] Change the password in PI-CORE, return to the NEXUS tab, press "Sudah ganti? Muat ulang": the Dashboard opens without a new login.
- [ ] Sign out of NEXUS: PI-CORE stays signed in (AUTH-28).
- [ ] Ask a PI-CORE admin to deactivate the test member while signed in to NEXUS: the next click shows "Belum ada akses" (AUTH-33). Reactivate: sign in works again (AUTH-35).
- [ ] Change the member's email in PI-CORE: NEXUS sign-in works with the new email (EC6).

### 6.5 Hosted settings (E6, B12, AUTH-40)
- [ ] Dashboard shows "Allow new users to sign up" is OFF; a direct `POST /auth/v1/signup` with the publishable key is refused.
- [ ] `nexus` is in "Exposed schemas"; the app reaches the Dashboard (not "Terjadi gangguan").
- [ ] Vercel environment has only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_PICORE_URL`; no service-role variable.
- [ ] Production response sets cookies with `Secure` and `SameSite=Lax` (browser dev tools, Application tab).
- [ ] Paused free-tier project: sign-in shows "Terjadi gangguan", not "salah" (EC12).

## 7. Coverage table AUTH-01..AUTH-44

Legend: A = automated, A* = automated with a limit (see note), M = manual only, N = not testable yet (feature does not exist).

| ID | Status | Where / note |
|---|---|---|
| AUTH-01 | A | `login-screen.spec` (redirect, `next`), `proxy.test` |
| AUTH-02 | A* | `security.spec` (made-up action id gets no data). The only data-free action is `recheckAccess`; real actions arrive with modules. |
| AUTH-03 | A | `login-screen.spec`, `security.spec` (404 for sign-up/reset paths), `static-rules.test` |
| AUTH-04 | A | `security.spec` (every no-argument nexus function, tables, sign-up) |
| AUTH-05 | A | `login-screen.spec` |
| AUTH-06 | A* | `personas.spec`. "Only cards the permissions allow": no cards exist yet (N for the cards part). |
| AUTH-07 | A | `login-screen.spec`, `sign-in.test` |
| AUTH-08 | A | `personas.spec` (banned + inactive) |
| AUTH-09 | A | `login-screen.spec` (no request), `sign-in.test` |
| AUTH-10 | A | `login-screen.spec` (mocked 429), `sign-in.test` |
| AUTH-11 | A | `login-screen.spec` (abort, 500, 503, offline), `sign-in.test` |
| AUTH-12 | A | `login-screen.spec` (request origin), `sign-in.test` |
| AUTH-13 | A* | `login-screen.spec` (SameSite=Lax, Secure on the production build over localhost). Real HTTPS: manual 6.5. |
| AUTH-14 | A | `personas.spec` |
| AUTH-15 | A | `personas.spec` |
| AUTH-16 | A* | `personas.spec` (page and API). Server Action part: N (no data actions yet). |
| AUTH-17 | A | `personas.spec` (identical text) |
| AUTH-18 | A | `session.test`, `picore-context.test`, `fault.spec` (opt-in) |
| AUTH-19 | A | `personas.spec` |
| AUTH-20 | A* | `personas.spec` (pages). Server Action part: N. |
| AUTH-21 | A | `personas.spec` (flag flip + "Muat ulang"). Real PI-CORE change: manual 6.4. |
| AUTH-22 | A | `personas.spec` (caller-only, boolean, no arguments), `picore-context.test` |
| AUTH-23 | A | `personas.spec` (E1 b: direct call not blocked, documented) |
| AUTH-24 | A | Not applicable (E1 b chosen); `static-rules.test` proves the column is not read in `src` |
| AUTH-25 | A | `static-rules.test`, `security.spec` |
| AUTH-26 | A | `login-screen.spec` |
| AUTH-27 | A | `personas.spec` |
| AUTH-28 | M | 6.4 (PI-CORE is another domain and another stack; not touched by tests) |
| AUTH-29 | A | `login-screen.spec`, `personas.spec`, `proxy.test` |
| AUTH-30 | N | No Server Action that does real work exists yet. Re-test with the first module action. |
| AUTH-31 | A | `login-screen.spec` |
| AUTH-32 | A | `login-screen.spec` (UI sign-in and signed-in visitor), `redirect.test` |
| AUTH-33 | A | `personas.spec` (deactivate mid-session; ban + expired token) |
| AUTH-34 | A | `personas.spec` |
| AUTH-35 | A | `personas.spec` |
| AUTH-36 | A* | `personas.spec` (valid member, not No-access). Hidden cards and "no permission" page: N. |
| AUTH-37 | A* | Sign-in as admin and ketum: A. Settings entry shown/hidden: N (settings module not built). |
| AUTH-38 | A | `personas.spec` |
| AUTH-39 | A | `personas.spec` |
| AUTH-40 | A* | `security.spec` (bundle), `static-rules.test`, `env-cookies.test`. Hosted env: manual 6.5. |
| AUTH-41 | A | `static-rules.test` |
| AUTH-42 | A | `static-rules.test` (every page and Server Action file). Must stay green when modules are added. |
| AUTH-43 | A | `login-screen.spec`, `static-rules.test` |
| AUTH-44 | A | `login-screen.spec`, `static-rules.test`, `sign-in.test` |

## 8. Results and known issues (run of 2026-11-06)

Numbers: Vitest 8 files, 242 tests, all pass. Playwright 84 tests: 83 pass (2 of them are `test.fail()` known-bug markers, see below), 1 skipped (the opt-in outage test, which also passes when run with `E2E_STACK_FAULT=1`). No flaky test seen. Seed data was verified restored after the run.

| ID | Severity | Owner | Issue | Test marker |
|---|---|---|---|---|
| BUG-A1 | Low | frontend | Eye button keeps the accessible name "Tampilkan kata sandi" when the password is shown; design 2.5a and 4.4 say it becomes "Sembunyikan kata sandi". `src/app/login/login-form.tsx:164`. | **FIXED 2026-11-06** (name follows the state; `aria-pressed` removed). Test now passes without `test.fail()`. |
| BUG-A2 | Medium | frontend | No sign-in timeout. If Auth accepts the connection but never answers (paused or overloaded project), the button stays on "Memeriksa..." and both fields stay read-only until the person reloads. Design 4.3 asks to end the attempt after about 15 s as "no network". `src/app/login/login-form.tsx:51-80` (and `src/lib/auth/sign-in.ts`, where a timeout or AbortSignal would fit). | **FIXED 2026-11-06** (15 s timeout in `login-form.tsx`, E7). Test now passes without `test.fail()`. |
| NOTE-1 | Low | frontend | The tab title is "Dashboard | PMK-NEXUS" on the No-access and password-pending screens, because the page metadata is emitted even when the layout shows the gate. Cosmetic, nothing sensitive. `src/app/(app)/page.tsx:7`. | **FIXED 2026-11-06** (`generateMetadata` in `src/app/(app)/page.tsx` follows the access state). |
| NOTE-2 | Low | frontend | Spec F10 step 6 says `next` is dropped when the person lands in No access or password-pending. The URL keeps it (for example `/?x=1`). Harmless, but the spec and the code disagree; either update the spec or strip the query on the gate screens. | **RESOLVED 2026-11-06** by clarifying spec F10 step 6 (status screen shows at the requested address; `next` is not followed further). |
| NOTE-3 | Info | devops | No Content-Security-Policy header. Other security headers are present (`next.config.ts`). Consider a CSP before go-live (security review item). | Tracked as `OPEN_QUESTIONS.md` F1 (CSP before go-live). |
| NOTE-4 | Info | backend | The "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA." result (spec 6.4a, 8.4.3) and the Server Action "session ended" result (AUTH-30) do not exist yet because no Server Action does real work. Re-test with the first module action. | none |

When a bug is fixed, delete its `test.fail()` line: Playwright reports an unexpectedly passing `test.fail()` test as a failure, which is the reminder.


## Run record
- 2026-11-06 (tech lead re-run after fixes): Vitest 242/242; Playwright 83 passed, 1 skipped (opt-in outage test), 0 failed, 6.1 min. lint, typecheck, build clean.
