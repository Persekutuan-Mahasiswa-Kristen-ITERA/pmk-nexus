# QA: Member Data / Data Anggota

Spec: `docs/modules/member-data.md` (criteria MD-01..MD-41, persona matrix in section 7). Decisions: D-019, D-020, D-021. Assumptions: `docs/OPEN_QUESTIONS.md` section G (A-MD1..A-MD19).
Owner of this file: QA (`nexus-qa-tester`). Last updated 2026-11-07 (BUG-MD-01 and BUG-MD-02 fixed, final run record added by the analyst). Format follows `docs/qa/auth-login.md`.

## 1. How to run the automated tests

Prerequisites: NEXUS local stack running (`bash scripts/dev-db.sh start`), `.env.local` pointing at it (API `http://127.0.0.1:55431`), `pnpm build` done.

| What | Command | Notes |
|---|---|---|
| Unit tests (Vitest), about 3 seconds | `pnpm test` | No stack needed. |
| E2E (Playwright), all specs, about 8 minutes | `pnpm test:e2e` | Starts (or reuses) `next start` on port 3100. |
| Member Data E2E only, mobile 390 px | `pnpm exec playwright test tests/e2e/data-anggota --project=mobile` | Files `data-anggota.spec.ts`, `-export`, `-period`. A few minutes. |
| Member Data E2E, desktop 1280 px | `pnpm exec playwright test tests/e2e/data-anggota-desktop.spec.ts --project=desktop` | The file name ends in `desktop.spec.ts`, which is what the `desktop` project matches (and the `mobile` project ignores). |
| pgTAP (database level) | See `supabase/tests/README.md` | NOT run by QA on the shared local stack (it is for a scratch database). It covers MD-08, MD-09, MD-33, MD-36, MD-41 at SQL level. |

Safety (same rules as `auth-login.md`): `global-setup.ts` refuses to run unless the API is `127.0.0.1:55431`. The sign-in budget helper (`throttleSignIn`) and the cached sessions in `node_modules/.cache/pmk-nexus-e2e/` are reused; the new specs sign in through `signedInContext()` and add no extra sign-ins beyond 3 new personas (`kadep`, `kabiro`, `pembina`, added to `tests/support/local-stack.ts`).

Tests that change data put it back in `finally`, and `global-setup.ts`/`global-teardown.ts` also repair it (they were extended for Member Data):
- active period (2025/2026 / none), a temporary previous-period assignment of `member.regular@nexus.test`;
- temporary members `qa-tmp-N@nexus.test` (awkward names), deleted afterwards;
- `revoke execute` on a Member Data function for a few seconds (the "gangguan" test); the grant is restored in `finally` and in global-setup;
- a temporary `CHECK (false)` named `qa_block_log_write` on the export log table (the "log write fails" test); dropped in `finally` and in global-setup;
- `bendahara@nexus.test` deactivated for a moment (MD-36).
The export log is append-only: every export test ADDS rows and cannot remove them (dozens per full run). That is expected on the local stack (the table held 6 rows before QA started and 77 after development plus one full run); no test depends on the absolute number.

## 2. Test layout

| File | Covers |
|---|---|
| `tests/unit/member-data-contract.test.ts` | zod schemas, lenient page-address parsing, `mapMemberDataError`, capability derivation, URL builder, pagination window, counter text. |
| `tests/unit/export-files.test.ts` | CSV writer (BOM, CRLF, RFC 4180, formula prefix, lone "-"), Asia/Jakarta dates, XLSX never writes formulas, the three file builders. |
| `tests/unit/member-export-handler.test.ts` | Export route handler with a mocked database client: methods, CSRF, 401/403/503, 400 with field, one RPC with exact arguments, headers, stripped columns, fail-closed answers. |
| `tests/unit/member-export-body-cap.test.ts` | Export body size cap, including a chunked body without `Content-Length` (app-layer review LOW 1, fixed in 247681e). |
| `tests/unit/nav-and-cn.test.ts` | `buildNavData` per D-021 for each persona type, `isActiveHref`, `cn()` Stitch text sizes (reads the real tokens in `globals.css`). |
| `tests/unit/member-data-static-rules.test.ts` | Source rules: RPC names only in `src/lib/picore/member-data.ts` (AUTH-41 style), no private schema, no personal field names, read-only, no cache, no file storage, POST-only export, server-only guards. |
| `tests/e2e/data-anggota.spec.ts` (mobile) | Personas and drawer, forbidden screen, HTML leak checks, list, pagination, search, filters, Back, content rows, PII scan, 390 px layout, drawer accessibility. |
| `tests/e2e/data-anggota-export.spec.ts` (mobile) | Real downloads (xlsx, csv, pdf), filters in exports, export log delta, double click, GET never exports, refused personas, direct REST calls per persona, log table protection, log reading rights, mocked error states. |
| `tests/e2e/data-anggota-period.spec.ts` (mobile) | Period switch (both directions), no active period, "gangguan" states, log write failure (MD-35), awkward names in list and exports. |
| `tests/e2e/data-anggota-desktop.spec.ts` (desktop) | 1280 px layout and keyboard-only use. |
| `tests/e2e/member-data-helpers.ts`, `tests/support/zip.ts` | Shared helpers (log counting, oracles, CSV/XLSX/PDF readers). |

Why the export log is counted with `docker exec ... psql` (read-only SELECT on `nexus.member_data_export_logs`) and not with `member_data_export_log_list()`: (1) it needs no sign-in, so the 30-per-5-minutes Auth limit is untouched; (2) it sees every row, so a stray second row cannot hide behind the function's permission or paging; (3) a bug in the function under test cannot hide a bug in the count. The function itself is tested separately: admin, Ketua Umum and Bendahara can read it, department heads, members and lecturers are refused.

Oracles: expected totals are checked against plain SELECTs on `public.members`, `assignments`, `org_units` (45 active, 49 all, 4 inactive, Operasional = 4, "anggota" = 39), and the identifiers (email, NIM, phone, NIP) of all seeded members are read from the table and searched for in every page and file.

## 3. Persona matrix (what each must see and what must be blocked)

Local accounts from `docs/ops/local-setup.md` section 3. Default rules D12, D13, D32, D33.

| Persona (local account) | Must see and do | Must be blocked | Automated |
|---|---|---|---|
| System Admin, no position (`admin@nexus.test`) | Dashboard, own name. May read the export log through the function (A-MD10). | Drawer item "Data Anggota"; `/data-anggota` shows "Tidak punya akses" with no member names in the HTML; list/count/export functions answer 42501; export POST 403. | Yes. |
| Treasurer (`bendahara@nexus.test`, Bendahara Umum 1 = role `bph`) | List, Ekspor (xlsx, csv, pdf), read the export log. | Nothing in this module. | Yes (list, export, log, deactivated-exporter case). |
| Secretary (Sekretaris Umum is `bph`; Sekretaris Departemen is not) | Sekretaris Umum like BPH; Sekretaris Departemen: nothing. | Sekretaris Departemen: everything. | **Needs seed** (no Sekretaris account). Capability and drawer logic is unit-tested for "no `member_data.*` key". |
| Operations Head (`kadep@nexus.test`, Kepala Departemen Operasional) | Drawer item, full list (45, not only own unit), counter. | "Ekspor" button and its form are absent; export POST 403, export function 42501, log function 42501; no log row written. | Yes. |
| Operations staff (login-capable account) | Dashboard only. | Everything in this module (same as regular member). | **Needs seed** (Operations staff in the seed, Bulk 11, 23, 39, cannot sign in). `member.regular` (Staff, IT) exercises the same code path. |
| BPH (`ketum@nexus.test`, Ketua Umum) | List, search, filters, pagination, Ekspor in three formats, read the export log. | Not a System Admin (no settings). | Yes. |
| Regular member (`member.regular@nexus.test`) | Dashboard, drawer without "Data Anggota". | Page, functions, export, log. | Yes. |
| No assignment (`pembina@nexus.test`, lecturer without assignment) | Dashboard. | Same as regular member. | Yes. A student with login and no assignment: **needs seed** (same code path). |
| Deactivated member (`member.inactive@nexus.test`, `is_active = false`) | "Belum ada akses" at every URL. | Any member data; export POST 403; functions 42501 even with a valid token (L1). | Yes. |
| Unlinked account (`unlinked@nexus.test`) | Same as deactivated. | Same. | Yes. |
| Temporary password (`member.temppw@nexus.test`) | "Ganti kata sandi dulu". | List, export, functions. | Yes. |
| Officer from a PREVIOUS period | See section 4. | The page right of the old period. | Yes, by switching the active period (no previous-period-only account in the seed; a temporary assignment is created). |
| Anonymous | Redirect to login with `next`. | List, export (401), every function. | Yes. |

## 4. Period change (MD-07, MD-20, MD-39, F7)

Automated in `data-anggota-period.spec.ts`, with two browser sessions kept open the whole time (no logout):
1. Switch the active period to 2025/2026 while Ketua Umum is on the list. The next request shows "Tidak punya akses", the drawer loses "Data Anggota", the export POST answers 403 and writes no log row, and the drawer footer shows "Periode 2025/2026". Ketua Umum stays signed in.
2. `member.regular` (given a temporary Kepala Departemen assignment in 2025/2026 only) gains the page on its next request, without Ekspor. Every other row shows "-" (assignments of the earlier period never leak, MD-20). The Operasional filter returns just that officer.
3. The seed assignments of 2026/2027 are unchanged (counted) while the other period is active: old data stays as history.
4. Switch back: Ketua Umum has the page again, `member.regular` loses it, still no logout.
5. No active period at all: both Ketua Umum and System Admin get "Tidak punya akses" plus "Belum ada periode aktif.", and the export POST is refused.
6. Right lost while the page is open: Ekspor pressed after the period switch shows "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA.", no file, no log row (`data-anggota-export.spec.ts`).

Not automated: rule changes by the System Admin (MD-08) because the rule screens do not exist yet; pgTAP covers it at SQL level.

## 5. Edge cases

| Case | Where |
|---|---|
| Empty states: no search match (with "Hapus pencarian" and "Reset"), only spaces as search, unknown unit id, 0 results hides Ekspor and pager | `data-anggota.spec.ts` |
| Very long text: search of 121, 480 and 5000 characters (error + way out), the input stops at 120, 120 padded with spaces is valid; a 120-character unbroken member name (no sideways scroll at 390 px, wraps in its cell, exports whole) | `data-anggota.spec.ts`, `data-anggota-period.spec.ts`, `member-data-contract.test.ts` |
| Special characters: `%` and `_` are not wildcards, quotes, `<script>`, SQL text, emoji, CJK; no dialog, nothing reflected as HTML | `data-anggota.spec.ts` |
| Formula injection: names starting with `=`, `+`, `-`, `@` (CSV gets an apostrophe, Excel stores text with no `<f>`), quotes and commas in names | `export-files.test.ts`, `data-anggota-period.spec.ts` |
| Duplicate names (R12): two rows | `data-anggota-period.spec.ts` |
| Unicode: accented capitals searched in lower case, CJK, emoji in list, CSV, Excel, PDF | `data-anggota-period.spec.ts`, `export-files.test.ts` |
| Bad page numbers (0, negative, `abc`, `1e3`, 12 digits), page past the end, page size in the address | `data-anggota.spec.ts`, `member-data-contract.test.ts` |
| Export: double click (one request, one log row), GET/HEAD/PUT never export, cross-site/no-Origin/JSON/oversize/bad values refused (no log row), network failure, 401/403/400/503/502/500 answers, slow answer | `data-anggota-export.spec.ts`, `member-export-handler.test.ts` |
| Log write fails (MD-35), export function fails, list or unit-option function fails ("gangguan", still signed in, "Coba lagi" recovers) | `data-anggota-period.spec.ts` |
| Wrong file type, expired signed URL, borrowing more than stock, duplicate letter numbers | Not applicable. Member Data has no upload, no signed URL (exports are generated per request and never stored, MD-37), no stock, no letters. |

## 6. Manual checklist (what automation cannot cover)

Run on the hosted preview or a production-like deployment before go-live. Tick and date each line.

### 6.1 Real phones, downloads (MD-29, MD-40, M5)
Blob downloads behave differently on phones, and Playwright's Chromium cannot show it.
- [ ] iPhone Safari (iOS 14.5 or newer): sign in as BPH, open Data Anggota, Ekspor > CSV. The file saves to Files (or the download sheet appears); the name is `data-anggota-YYYY-MM-DD.csv`; it opens in Numbers or Excel with accents correct (BOM) and the right number of rows.
- [ ] iPhone Safari: Ekspor > Excel opens in Numbers/Excel; Ekspor > PDF opens in the viewer, table readable, "Halaman x dari y" at the bottom.
- [ ] iPhone Safari: after the download, the page shows "Unduhan dimulai: ..." and the button is usable again. If Safari opens the file in the same tab instead of downloading, note it (the fallback path of `member-export.tsx`).
- [ ] Android Chrome: same three downloads; the files appear in Downloads; the notification opens them.
- [ ] Android Chrome, installed to the home screen (PWA): export still works.
- [ ] Both phones: the export menu is fully visible above the keyboard and inside the screen; tapping outside closes it.
- [ ] Both phones: slow network (airplane mode on after tapping): the message "Tidak bisa terhubung..." appears, the button is usable again.
- [ ] Both phones: a file with all 200 members (or the biggest realistic list) downloads in under 15 seconds on campus Wi-Fi.
- [ ] Both phones, portrait and landscape: no horizontal page scroll on the list; table text wraps; Prev, page numbers and Next are tappable with a thumb (44 px).
- [ ] Both phones: typing in the search box does not zoom the page (16 px text) and the keyboard does not hide the list's first rows.
- [ ] Both phones: search field uses the keyboard's search key (`enterkeyhint`), and the list reloads after a pause.
- [ ] Text size 200 percent: columns still readable, nothing cut off; the status chip does not overlap the unit text.

### 6.2 Screen reader pass (VoiceOver iOS, TalkBack Android; NVDA on desktop)
- [ ] Heading order: "Data Anggota" (h1), "Filter Direktori" (h2). The table is announced with its caption "Daftar anggota, halaman 1 dari 3" and column headers (No = "Nomor", Nama Lengkap, Unit / Jabatan, Status).
- [ ] Search field is announced as "Cari nama anggota"; the too-long error is announced (role alert) and the field is marked invalid.
- [ ] Changing Unit or Status: the result count ("Hasil", "Menampilkan a-b dari N anggota") is announced or can be found right after; the busy state ("aria-busy") does not trap the reader.
- [ ] Pagination: "Halaman sebelumnya", "Halaman 2", "Halaman berikutnya"; the current page is announced as current; the disabled Prev/Next are announced as dimmed (they are `role=link aria-disabled`, check the wording is not confusing).
- [ ] Ekspor: announced as a button with a menu; the three formats are reachable; the status "Unduhan dimulai: ..." is read after a download; the error alert text is read.
- [ ] "Pembina" marker is read after the name; the "-" for no unit is read as something sensible ("dash"). If it is noise, ask the UX designer for a visually hidden "Tidak ada unit".
- [ ] Drawer: opening reads the dialog title "PMK-NEXUS"; focus starts on the current item; Escape closes and focus returns to "Buka menu"; the page behind is not readable while open.
- [ ] The "Tidak punya akses" screen: heading read on load; "Kembali ke Dashboard" focusable.

### 6.3 Reduced motion and zoom
- [ ] iOS "Reduce Motion" / Android "Remove animations" ON: the drawer opens without sliding and its veil does not fade (BUG-MD-02 is fixed and covered by an E2E test with `reducedMotion`; confirm on a real phone).
- [ ] Browser zoom 200 percent on desktop: no overlap, filters stack or stay usable.

### 6.4 Hosted pre-go-live checks
Use the hosted project only after the owner has applied the migration; never run the automated suite there.
- [ ] Migration `20261106200000_nexus_member_data.sql` applied; `nexus` is in "Exposed schemas"; the Data Anggota page loads (not "Terjadi gangguan").
- [ ] `select count(*) from nexus.member_data_export_logs;` works and RLS is enabled on the table; the `authenticated` role has no privilege on it (`\dp nexus.member_data_export_logs`). (MD-33, MD-41)
- [ ] Real BPH account: list shows the real members of the ACTIVE period; the counter equals the number of active members in PI-CORE.
- [ ] Real Kepala Departemen and Kepala Biro accounts: the list opens, there is no Ekspor, and a console `fetch('/api/member-data/export', {method:'POST', body: new URLSearchParams({format:'csv'})})` answers 403.
- [ ] A real ordinary member and a lecturer: no drawer item; the direct URL shows "Tidak punya akses".
- [ ] A real member of the PREVIOUS period who is not in the new one: no drawer item after the period switch, no logout needed.
- [ ] Do one export of each format with a real BPH account and check the export log through the function as System Admin: one new row per export, the exporter's name, the format, the period, "search_used" correct, no search text. (The log screen is not designed yet, A-MD14, so read it through the SQL editor.)
- [ ] Compare a real export with PI-CORE: same people, same primary unit and position (tie-break A-MD8), the "Pembina" column "Ya" for each lecturer.
- [ ] Rename a unit in PI-CORE: the filter option and the row text change on the next request (MD-21); deactivate a unit: it disappears from the filter, its members still appear (R8).
- [ ] Deactivate a test member in PI-CORE: not listed by default, listed as "Nonaktif" under Nonaktif and Semua (MD-23).
- [ ] The Vercel function that creates the PDF finds its fonts (`PlusJakartaSans-*.ttf`) in production; the downloaded PDF shows the same text as on screen, not empty boxes. (D-020 trade-off: `serverExternalPackages`.)
- [ ] A 200-row export of each format stays under the Vercel function time and memory limits (Hobby: 10 s default). Note the duration in the Vercel logs.
- [ ] Response headers of `/data-anggota` and of an export in the browser's Network tab: `Cache-Control: no-store`/`private`, `X-Content-Type-Options: nosniff`; cookies `Secure` and `SameSite=Lax`.
- [ ] The Supabase free-tier project is awake (not paused) before go-live; a paused project shows "Terjadi gangguan", not "Tidak punya akses".

## 7. Coverage table MD-01..MD-41

Legend: A = automated (unit or E2E), A* = automated with a limit (see note), P = covered by pgTAP only (`supabase/tests/nexus_member_data.test.sql`, not run by QA), M = manual only, N = not testable yet (feature does not exist), G = gap.

| ID | Status | Where / note |
|---|---|---|
| MD-01 | A* | `data-anggota.spec` (ketum, bendahara: drawer, list, Ekspor), `nav-and-cn.test`. Dashboard "Members" count: N (Dashboard module not built). Sekjen/Sekum accounts: G (not seeded; same role `bph`). |
| MD-02 | A | `data-anggota.spec`, `data-anggota-export.spec` (kadep and kabiro: UI, POST 403, function 42501, no log row), `member-export-handler.test`. |
| MD-03 | A* | admin: page, functions, export. P-SUPER: G (not seeded; same fixed-right path). |
| MD-04 | P | P-ADMIN-BEND (admin + position) is not seeded. BPH through a position is A (`bendahara`). pgTAP covers the combined persona. |
| MD-05 | A* | regular, pembina: drawer, forbidden screen, HTML has no names, functions 42501, export 403. Sekretaris Departemen, Staff Logistik and Staff Pubdok accounts: G (not seeded). Dashboard card: N. |
| MD-06 | A | inactive, unlinked, temppw, anonymous: gate screens, no names in HTML, functions refused with a valid token, export 403/401. |
| MD-07 | A | `data-anggota-period.spec` (both directions, two live sessions, no logout). |
| MD-08 | P | Admin rule screens do not exist (N in the UI). pgTAP disables D32. |
| MD-09 | P | L12 rejection is database-only. |
| MD-10 | A | `static-rules` (no personal field names in code), `data-anggota.spec` (PII scan of text and HTML on every page and filter, identifiers from the real table), exports (CSV, XLSX, PDF scanned), `data-anggota-export.spec` (function columns, whitelist), `member-export-handler.test` (extra columns stripped). |
| MD-11 | P | Temporary grant to a unit rule needs the rule API. The wrapper's strict zod shapes are unit-tested. |
| MD-12 | A | UI search of email, NIM, phone, NIP-like values returns 0; same at function level. |
| MD-13 | A* | `static-rules` (picore only, no `private.*`, table never named in src). "No table in `nexus` holds names": manual/schema review (pgTAP lists columns). |
| MD-14 | A | `static-rules` (no insert/update/delete, no "Tambah Anggota", rows not interactive), `data-anggota.spec` (no controls, row click does nothing). |
| MD-15 | A | One row per person across all pages; Bulk 11 (two assignments) appears once, also in both unit filters. |
| MD-16 | P | The Sekretaris Departemen (50) + Staff (70) case is not in the local seed; pgTAP builds it. The tie-break of equal ranks (MD-17) is A. |
| MD-17 | A | Bulk 11 (Musik vs Logistik, same rank) shows Musik on every request, in the list and in all exports. |
| MD-18 | A* | "Departemen Operasional · Logistik" / Staff (Bulk 39), "BPH PMK ITERA" / Ketua Umum, "Biro Kewirausahaan" / Kepala Biro. |
| MD-19 | A | Members without an assignment show "-". |
| MD-20 | A | `data-anggota-period.spec`: after the period switch earlier assignments do not appear anywhere. |
| MD-21 | A* | Options equal the PI-CORE units at that moment (compared with a SELECT). Renaming a unit: M (6.4). |
| MD-22 | A | Operasional = 4 including Bulk 11; Bulk 11 appears under Pelayanan Khusus too, once. |
| MD-23 | A | Exactly Aktif, Nonaktif, Semua; default Aktif; 45 / 4 / 49; Reset. |
| MD-24 | A | 3 active lecturers carry "Pembina" and "-" in list and CSV ("Ya"); students none; no NIP. |
| MD-25 | A | Case-insensitive part-of-name search across pages, AND with filters, page back to 1. |
| MD-26 | A | Counter text, Prev/Next states, page past the end, page size cannot be raised (address and function: 51 refused). |
| MD-27 | A | 45 unique names across three pages in case-insensitive A-Z order. |
| MD-28 | A | No-match state with Reset; "gangguan" with "Coba lagi" when a database function fails, not "no access", cookies kept. "PI-CORE unreachable" is simulated by revoking the function, not by stopping the stack. |
| MD-29 | A | CSV, XLSX and PDF row counts equal the on-screen total for several filters; order equals the screen. PDF rows counted by `pdftotext`. |
| MD-30 | A | One button, exactly three formats, only with export right. |
| MD-31 | A | Delta of exactly +1 per export with exporter id, format, filters, period; refused and invalid requests write none. |
| MD-32 | A | Log row keys are exactly the whitelist; search text and names absent; log function output has no personal field. |
| MD-33 | A | REST INSERT/UPDATE/DELETE/SELECT on the table refused for ketum, admin, kadep, regular and anonymous; table content hash unchanged. Function-level update/delete: P. |
| MD-34 | A | Admin, ketum, bendahara read; kadep, kabiro, regular, pembina refused (42501). P-SUPER: G. |
| MD-35 | A | Log write made to fail with a temporary CHECK: 503, "gangguan", no file, no row; works again afterwards. |
| MD-36 | A | Deactivated exporter's row stays and still shows the name. |
| MD-37 | A | `static-rules` (no file or Storage call), no export/storage route exists. |
| MD-38 | A* | Active member count function = 45 = list total. The Dashboard card itself: N. |
| MD-39 | A | No active period: "Tidak punya akses" plus "Belum ada periode aktif.", export refused. |
| MD-40 | A* | 390 px: no horizontal scroll on list, pages, empty, error, menu, drawer; 48 px fields with 16 px text, 44 px targets. Real phones: M (6.1). |
| MD-41 | P | pgTAP. QA's REST checks add RLS/no-privilege evidence. |

Totals: 41 criteria. Automated: 35 (27 fully, 8 with a limit: MD-01, 03, 05, 13, 18, 21, 38, 40). pgTAP only: 6 (MD-04, 08, 09, 11, 16, 41). Gap: 0. Persona gaps inside the automated ones (need seed accounts): Sekjen, P-SUPER, Sekretaris Departemen, login-capable Operations staff and Staff Pubdok. Not testable yet: the Dashboard "Members" card parts of MD-01, 05, 38.

## 8. Results and known issues

See the run record at the end. Bug ids are QA's; owners are the engineers named. No bug is open.

| ID | Severity | Owner | Issue | Status | Test |
|---|---|---|---|---|---|
| BUG-MD-01 | Low | backend | `INVALID_INPUT_HINTS` was a plain object, so a database hint named like an inherited property (`constructor`, `toString`, `__proto__`) mapped to `invalid_input` with a function as `field` instead of `unavailable`. Only a hostile or buggy database could send such a hint, so Low. In `src/lib/picore/member-data.ts`. | **FIXED** in 247681e (2026-11-07). | Now an ordinary test in `tests/unit/member-data-contract.test.ts` ("BUG-MD-01: prototype keys are not treated as hints"); the `it.fails` marker is gone. |
| BUG-MD-02 | Low (accessibility) | frontend | The drawer ignored `prefers-reduced-motion`: it still slid in and its veil still faded, because `data-[state=open]:animate-in` was more specific than `motion-reduce:animate-none`. In `src/components/shell/nav-drawer.tsx`. | **FIXED** in 247681e (2026-11-07). | Now an ordinary test in `tests/e2e/data-anggota.spec.ts` ("BUG-MD-02: with prefers-reduced-motion the drawer and its veil do not animate"); the `test.fail()` marker is gone and the Playwright config sets `reducedMotion: "reduce"`. |

Findings of the reviews that were fixed in the same commit (247681e): app-layer review LOW 1 (a chunked export body without `Content-Length` is now size-capped) and LOW 5 (the proxy now answers an anonymous request to any `/api/*` path with 401 JSON `{"error":{"code":"unauthenticated"}}` instead of a login redirect). Because of LOW 5, an anonymous GET of `/api/member-data/export` now returns 401, not a redirect and not 405; a signed-in GET still returns 405 and never exports. The E2E test that expected the old answer was updated.

Observations that are not bugs (decisions for the owner or notes):
- OBS-1 (Info): an authorised BPH user can create unlimited log rows by exporting repeatedly, and the log has no delete. There is no rate limit on the export route. Owner decision 2026-11-07: accepted for Phase 1 (`OPEN_QUESTIONS.md` F5); a per-user limit (for example 30 per hour) is the planned fix if needed. Cleanup of the log is owner-approved only (`supabase/README.md` section 6).
- OBS-2 (Info): if the file cannot be built after the log row was written, the log shows an export that produced no file (the handler says so in a comment). Accepted by design; a monitoring note.
- OBS-3 (Info): disabled "Prev"/"Next" use `role="link" aria-disabled="true"` on a span. Check the wording with a screen reader (checklist 6.2).
- OBS-4 (Info): 401 from the export button navigates to `/login?reason=session_ended&next=...`; a signed-in visitor on `/login` is sent back to `next` (AUTH-32). With a really ended session this is the desired path; verified only with a mocked 401.
- OBS-5 (Info): while the page streams in, the layout's loading shell (`LoadingShell`, which has its own `<main>`) and the page's `<main>` are both in the DOM for a moment; the shell is replaced when the page arrives. Tests use `getByRole("main")` for this reason.

## Run record
- 2026-11-07 (QA, local stack, production build), FIRST run, before the fixes: `pnpm test` 13 files, 443 passed + 1 expected failure (`it.fails`, BUG-MD-01) = 444 tests (earlier 8 files, 242 tests; Member Data added 5 files and about 200 tests). `pnpm build` clean, `tsc --noEmit` and `eslint tests` clean. `pnpm test:e2e`: 176 tests, 175 passed (including 1 expected failure, `test.fail()`, BUG-MD-02), 1 skipped (the opt-in outage test `fault.spec.ts`), 0 failed, 7.8 minutes. Of the 176, the new Member Data specs are 90 (38 + 41 + 8 + 3). Seed data verified after the run: 49 members (45 active), period 2026/2027 active, 18 assignments, grants restored, no leftover `qa-tmp` member, no leftover constraint.
- 2026-11-07, FINAL run after commit 247681e (fixes for BUG-MD-01, BUG-MD-02, app-review LOW 1 and LOW 5), recorded from the tech lead's verification:

| Suite | Result |
|---|---|
| Unit (Vitest) | 14 files, 446 passed, 0 expected failures |
| E2E (Playwright) | 175 passed, 1 skipped (opt-in outage test `fault.spec.ts`), 0 failed. The full run first gave 174 passed + 1 failure caused by the LOW 5 change (the old answer for an anonymous `/api/*` request); that test was updated and its spec re-run on its own: 65 passed. Then a complete re-run of the whole suite: 175 passed, 1 skipped, 0 failed, 7.6 min (2026-11-07) |
| pgTAP (throwaway container, not the shared local stack) | 244 of 244 access control, 198 of 198 Member Data |

Reviews: database review has no CRITICAL, HIGH or MEDIUM finding after fixes. App-layer review is PASS with LOW findings only: LOW 1 and LOW 5 fixed; LOW 2 (rate limit) accepted as F5; LOW 3 is the CSP, already F1; LOW 4 (Vercel forwarded-host) accepted as F6.

Still open (manual, section 6): real-phone download checks, screen-reader pass, hosted pre-go-live checks. Persona gaps that need more seed accounts: admin with a BPH position, Sekretaris Departemen, Operations staff with a login, a student with a login and no assignment.
