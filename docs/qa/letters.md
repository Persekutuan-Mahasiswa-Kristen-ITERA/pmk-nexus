# QA: Letters / Surat Menyurat

Spec: `docs/modules/letters.md` (criteria LT-01..LT-52, flows F1-F9, rules R1-R20, owner decisions L1-L11, amendment G1 "Ambil nomor"). Decisions: D-024, D-025. Design: `docs/design/letters.md`.
Owner of this file: QA (`nexus-qa-tester`). Last updated 2026-11-11. Format follows `docs/qa/inventory-borrowing.md`. Code under test: commits `93295a1` (database fix), `dacf327` (server layer and screens), `5f5874a` (bidi and zero-width characters dropped from file names).

## 1. How to run

Prerequisites: NEXUS local stack running (`bash scripts/dev-db.sh start`), `.env.local` pointing at it (API `http://127.0.0.1:55431`), and an app server on port 3100 (`pnpm dev`, or `pnpm build` and let Playwright start `next start`). `playwright.config.ts` reuses a server that already answers on 3100, so these specs ran against the tech lead's `pnpm dev` server. Do NOT run `pnpm build` while `pnpm dev` is serving from the same `.next` folder.

| What | Command | Notes |
|---|---|---|
| Unit tests | `pnpm test` | No stack needed. 4 Letters files (section 2). |
| Letters e2e only | `pnpm exec playwright test tests/e2e/surat- --project=mobile` | Files `surat-*.spec.ts`, 390 px. |
| Whole suite | `pnpm test:e2e` | About 30 minutes. |
| Same, when the daily request cap is used up | `QA_RELIEVE_DAILY_CAP=1 pnpm exec playwright test ...` | See the next paragraph. |

**The caps shape re-runs (L10 b).** At most 5 open and 10 new requests per member per Jakarta day, counting cancelled ones; requests cannot be deleted. `requesterWithRoom()` in `surat-helpers.ts` spreads the tests over seven plain members (`regular`, `pembina`, `kabiro`, `admin`, `kadep`, `kadivLogistik`, `staffOps`; none holds a letter key) by remaining room, and a test SKIPS with the reason when nobody has room. `sekdep` is kept out of the pool so its "empty Permohonan Saya" state stays testable. The cap test (`surat-edge.spec.ts`, "6th open request refused") uses up a whole member-day on purpose and skips when no member has a clean day. `QA_RELIEVE_DAILY_CAP=1` makes `global-setup.ts` move the creation time of today's requests whose Perihal starts with `QA` back by one day (one transaction, triggers skipped, nothing else touched). Local stack only.

**Storage is off on the local stack** (`supabase/config.toml` `[storage] enabled = false`; `storage.objects` does not exist). So a real upload never reaches Storage here. The upload route is tested up to the Storage call (type by magic bytes, size, shape, session, period: a valid file answers 503 `unavailable`, and the specs assert 200 with an own-folder path when Storage is installed). Browser flows that need a file stub only the upload route (`stubLetterUpload`, returning the well-formed path in the caller's own folder); the database functions skip the object check when `storage.objects` is missing, so Terbitkan and "Tambah berkas" run for real. Signed links, bucket policies and the "10 unattached uploads" cap need Storage: see the manual checklist (section 8).

Safety: `global-setup.ts` refuses to run unless the API is `127.0.0.1:55431`. Sessions come from `signedInContext()` (cached, `throttleSignIn`). No `db:reset`, drop, truncate or delete is run, not even inside a rolled-back block: "append-only" is proven by reading `pg_trigger`, `pg_policies` and `relrowsecurity`, and by REST calls that must change nothing. Setup data is created only through the app's own database functions with the persona's token; every Perihal carries a unique `QA<tag>` and `sweepQa()` ends what is open (requests cancelled or rejected, QA letters voided). Things a test flips for a moment (active period, a temporary 2025/2026 Sekretaris Jenderal assignment of `member.regular`, rules D15-D22, a `CHECK (false)` named `qa_block_lt_log_write` on the export log, the numbering format, member `is_active`) are restored in `finally`, and `global-setup.ts` repairs them if a run died (except the numbering format, which a test restores through the admin function).

## 2. Test layout

| File | Covers |
|---|---|
| `tests/unit/letters-contract.test.ts` | Jakarta dates (23:30 UTC = next day), `isValidLetterDate`, number format and padding, magic bytes, `cleanLetterFileName` (control characters, the bidi and zero-width ranges of 5f5874a, 200 code points, fallback name), upload path pattern, declared file limits (5 MiB), every zod input schema (A-LT18 limits counted in characters, required fields, dates, files 0..3 / 1..3, version, no client-supplied requester or period), search cleaning, list and queue defaults, `parseInput` error shape, capabilities and segments per persona, request stages, database hint mapping (prototype names and unknown SQLSTATE fail closed), copy texts. |
| `tests/unit/letters-routes.test.ts` | Upload route and export route with the database mocked: mixed-case multipart boundary, real file type, 5 MiB boundary, streamed oversized body, shape (one `file` field), CSRF, session states, no active period, Storage answers, error code to HTTP status, export body parser (JSON, urlencoded, multipart), log-before-file, cut result 422, CSV formula neutralising. |
| `tests/unit/letters-static-rules.test.ts` | Source rules: RPC names, tables and bucket only in `src/lib/picore/letters.ts`; UI never calls the database; no service-role key; nothing deletes or overwrites; links short-lived and never exported; routes POST-only; every entry guarded and wrapped in `safely()`; no PII fields; no notification channel; module self-contained; drawer item not behind a key. |
| `tests/unit/nav-and-cn.test.ts`, `tests/unit/static-rules.test.ts` | Existing files, expectations updated (section 6). |
| `tests/e2e/surat-access.spec.ts` | Persona matrix (11 accounts) on screens, forbidden pages, buttons absent, numbering page edit / read-only / none; direct database-function calls per persona; direct table access through REST (reads limited to the policies, writes change nothing); catalog check of triggers and RLS; export and upload routes; Server Actions called with the `Next-Action` header; rule D15-D22 switched off without logout. |
| `tests/e2e/surat-flow.spec.ts` | Full request flow in the browser; L6; rejection after "Ambil nomor"; cancel rules and "Ajukan lagi"; register, edit and void of incoming and outgoing letters; "Nomor lama"; number sequence and format; concurrency; format change and "next sequence" rules; register / request rules (A-LT24, G4); 390 px overflow with long unbroken text. |
| `tests/e2e/surat-edge.spec.ts` | Upload route with real files, picker messages, file attach rules, limits and dates at the database, caps (5 open, 10 per day), Jakarta clock functions, search, malformed addresses, empty states, output escaping. |
| `tests/e2e/surat-export.spec.ts` | Excel, CSV and PDF against the screen (rows, order, voided marked, header, WIB), one log row each, filters against `letter_list`, headers, formula injection, no PII, bad bodies, log failure = no file, refused calls write no log row. |
| `tests/e2e/surat-period.spec.ts` | Dashboard card per persona against the tables; period switch both ways with sessions kept open; no active period. |
| `tests/e2e/surat-deactivated.spec.ts` | Requester deactivated mid-request, secretary deactivated. |
| `tests/e2e/surat-helpers.ts` | Shared helpers: persona-token calls, read-only oracles, fixtures through the app's functions, `requesterWithRoom`, fake upload paths, `stubLetterUpload`, Server Action caller. |
| `tests/e2e/global-setup.ts`, `tests/support/local-stack.ts` | New personas (`sekjen`, `sekum1`, `sekdep`), reset of the Letters rules and the log blocker, opt-in cap relief. |
| Existing e2e specs | Drawer lists updated for the new item (section 6). |

## 3. Persona matrix (what each must see and what must be blocked)

Local accounts from `supabase/local/seed_test_accounts.sql`. Default rules D06-D08, D15-D22.

| Persona (account) | Must see and do | Must be blocked | Automated |
|---|---|---|---|
| System Admin, no position (`admin`) | Drawer item, Permohonan Saya, Ajukan Surat, **Penomoran Surat with edit forms** (also with no active period). | Register, queue, any letter (forbidden page, functions refused), export, processing; no Dashboard card. | Yes. |
| Treasurer (`bendahara`, Bendahara Umum 1 = BPH) | As the other BPH below. | As below. | Yes. |
| Secretary, BPH (`sekjen`, `sekum1`) | Register tabs, register / edit / add files / void, queue, process (Proses, Ambil nomor, Terbitkan, Tolak) other members' requests, export, Penomoran Surat read-only, Dashboard card with waiting requests. | Process their OWN request (screen and every function step; the other secretary can), edit numbering, edit or void letters of a previous period, void or add files while the request is Diproses. | Yes. |
| Other BPH (`ketum`, `bendahara`) | Register tabs, letter detail, queue and request detail (view only), export, Dashboard card. | Catat / edit / void, process (no buttons, function `permission_required`), numbering page, own requests aside. | Yes. |
| Operations head / staff, Kepala Biro (`kadep`, `kadivLogistik`, `staffOps`, `kabiro`) | Only the member area: drawer item, Permohonan Saya, Ajukan Surat. | Everything else (letter keys are not theirs). | Yes. |
| Department secretary (`sekdep`) | Member area only (B17). | Register, queue, export. | Yes. |
| Regular member (`regular`), lecturer (`pembina`) | Member area; own requests, number and file of their own request. | Register, other members' requests (shown as "not found"), numbering page. | Yes. |
| User with NO assignment | Same as a regular member (`pembina`, `admin`). | Same. | Yes. |
| Deactivated member (`inactive`) | "Belum ada akses" on every URL. | Every function, even with a valid token (L1). | Yes. |
| Unlinked account (`unlinked`) | Same as deactivated. | Same. | Yes. |
| Requester deactivated mid-request | Secretaries still see their name and an info marker and can process, take a number, issue, reject; the file stays. | The member's own access. | Yes (`surat-deactivated`). |
| Secretary deactivated | Their records keep their name; the other secretary carries on. | Their own rights, at once. | Yes. |
| Officer from a PREVIOUS period (`sekjen` after the switch; `regular` with a temporary 2025/2026 Sekretaris Jenderal assignment) | After the switch the old secretary keeps only the member area; the 2025/2026 secretary gains the register, the queue and the old open requests. | Old-period letters stay read-only for everyone (`closed_period`). | Yes (`surat-period`). |
| Anonymous | Redirect to login. | Pages (302), routes (401/403), functions, tables. | Yes. |

## 4. Period change (spec F9, R15, LT-30, LT-04, LT-18)

Automated in `surat-period.spec.ts`, sessions kept open the whole time (no logout):
1. In 2026/2027: a letter, a request that is still Diajukan, a request with a taken number. `member.regular` gets a temporary Sekretaris Jenderal assignment in 2025/2026 (the seed has no such account).
2. Switch to 2025/2026. `sekjen` loses register, queue, numbering page and the Dashboard card on the next request, functions answer `permission_required`, but still opens Permohonan Saya. `regular` gains the register, sees the 2026/2027 letter only behind "Semua periode", and it is read-only for him: no buttons, the edit page says so, update / void / add files answer `closed_period`.
3. LT-30: `regular` processes the old open request, takes its number (the letter is created in the ACTIVE period 2025/2026, linked to the old request, the request keeps 2026/2027; the sequence continues, no reset), and issues the request whose number was taken BEFORE the switch (the letter keeps 2026/2027). The handover list "Belum selesai (semua periode)" shows. The requester still reads and downloads their own old request; the register stays closed to them.
4. Back to 2026/2027: `regular` is a member again, `sekjen` has the register again, the letter created during the interlude is now history (read-only, behind "Semua periode"), and a current holder can still finish the request that was Diproses during the interlude. Nothing was deleted; every record keeps its period.
5. No active period (LT-31, R7): the register and queue show the forbidden page with "Belum ada periode aktif.", the request form is replaced by the message, `letter_request_create` answers `no_active_period`, processing and Ambil nomor are refused, the upload route answers 409, own requests stay readable, the admin still reaches and edits Penomoran Surat, the Dashboard card is absent.

## 5. Acceptance criteria coverage

A = automated, M = manual checklist item (section 8), DB = called with the persona's token.

| Criterion | Where | Status |
|---|---|---|
| LT-01 | access (functions as `sekjen` / `sekum1`; Server Action sanity), flow (register, edit, void, process) | A |
| LT-02 | access (screens, functions, Server Actions: BPH view-only cannot write or process) | A |
| LT-03 | access (sekdep, plain, lecturer, admin: no register / queue / other's request / export; drawer opens the member area) | A |
| LT-04 | access (inactive, unlinked, anonymous), period (previous-period secretary) | A |
| LT-05 | access (D15-D22 switched off, next request, no logout) | A |
| LT-06 | pgTAP only (`supabase/tests`, not run by QA); the "every active member" grant is an admin-screen action that does not exist yet | M |
| LT-07 | flow (requester and period are the session's; caps for client-supplied fields in unit tests) | A |
| LT-08 | edge (field limits, required fields, dates, caps, files), flow | A |
| LT-09 | access (own requests only, other's detail = not found, tables by REST) | A |
| LT-10 | flow (cancel only while Diajukan; refused after Proses by function and UI; stranger refused) | A |
| LT-11 | flow (L6 on screen and at every step), access (Server Action) | A |
| LT-12 | flow (rejection note, history rows), edge (blank / 501 characters) | A |
| LT-13, LT-14, LT-15, LT-15a, LT-15b | flow (number first, Terbitkan needs a number and a file, number visible to the requester without file, two secretaries at once, rejection voids the row, open request blocks void and files) | A (file download itself: M) |
| LT-16 | the hints (one processor, nobody) need a rule edit or a second persona being removed; lone-processor hint covered in part by `surat-deactivated` | M (the "nobody can use it" warning belongs to the admin rules screen, not built) |
| LT-17 | flow (format, one sequence per type, never typed except "Nomor lama"), unit | A |
| LT-18 | edge (database year function at 16:59 / 17:00 UTC), flow (a 2025 letter date gets the current year), period (no reset on switch); the live 1 January rollover: M | A, M |
| LT-19 | flow (concurrent registrations, failed saves use no number, voided and rejected numbers never reissued) | A |
| LT-20 | flow (format change affects only later letters; collision and bad formats refused; restored) | A |
| LT-21 | edge (required, limits, dates, wrong side), unit | A |
| LT-22 | flow (history before / after, number untouched, unchanged form writes nothing), period (old letter read-only) | A |
| LT-23, LT-24 | flow (void with reason, row stays, request stays Diterbitkan with "Nomor dibatalkan"), export (voided rows) | A |
| LT-25 | edge (number part, counterpart, Perihal, case, wildcards literal, notes not searched) | A |
| LT-26 | edge and unit (real bytes, size, count, path, own folder), routes unit | A (a real upload to Storage: M) |
| LT-27 | the route and the link function are tested up to Storage; bucket policy, expiry after 300 s, another member's link: M | M |
| LT-28 | flow (a withdrawn file stays recorded, not counted toward 3), static rules (nothing deletes) | A |
| LT-29 | the 11th unattached upload is a bucket policy | M |
| LT-30 | period | A |
| LT-31 | period (no active period) | A |
| LT-32 | deactivated | A |
| LT-33 | pgTAP (union of two assignments); on screen no persona holds both a secretary and a second role | M |
| LT-34 | access (REST writes change nothing, triggers and RLS read from the catalog), static rules | A |
| LT-35 | access (no PII column in any readable row), export (no PII in files), static rules | A |
| LT-36 | access (reads by policy), export (no links in files), static rules | A |
| LT-37 | access (routes, refused, 405), export, routes unit | A |
| LT-38 | export (Excel, CSV, PDF equal the screen; filters equal `letter_list`; WIB; voided marked) | A |
| LT-39 | export (one row per success, none per refusal, no file when the log fails, no search text) | A |
| LT-40 | period (card per persona against the tables, no title or number, absent without a period) | A (neutral empty state: M) |
| LT-41 | access (admin edits, `letters.manage` reads, others refused; Server Action) | A |
| LT-42 | flow (no horizontal scroll on 11 screens with long text; 44 px / 16 px on the register form; 16 px on the request form) | A (phones: M) |
| LT-43 | pgTAP (`supabase/tests`, not run by QA); through the API: access (REST reads, RLS flag per table, no write policy) | A for the API part |
| LT-44 | edge (limits and caps by direct call) | A (one gap: BUG-LT-01) |
| LT-45 | edge (5 open, 10 per day, message on the page, Jakarta day) | A |
| LT-46 | access, period | A |
| LT-47 | edge (database clock functions), unit | A |
| LT-48 | static rules (self-contained, no cross-module import); period id on every record: flow, period | A |
| LT-49 | flow (no bracket count on the tabs, no chip on an Aktif letter, chips for Dibatalkan and Nomor lama) | A |
| LT-50 | flow (last issued file, replacement first, withdrawn not counted) | A |
| LT-51 | flow (only up, reason, current year); "never set" flag: first-use hint text not asserted | A, M |
| LT-52 | period (tiles and card count Aktif only; waiting counts all periods) | A |

## 6. Existing specs updated

The drawer item "Surat Menyurat" (spec section 2: every active member, D-025, an explicit exception to D-021) broke every hard-coded drawer list. Updated, no assertion weakened: `tests/unit/nav-and-cn.test.ts` (every persona now gets Dashboard, [Data Anggota], Surat Menyurat; new tests: needs no key and no period, appears once, stays after Data Anggota and before the inventory item, `/surat` highlighting without look-alikes), `tests/unit/static-rules.test.ts` (route allow-list gains `/surat/**`, `/pengaturan/penomoran-surat`, `/api/letters/export`, `/api/letters/files`; the "nothing sign-up-like" assertion is kept), and the e2e specs `data-anggota.spec.ts`, `data-anggota-period.spec.ts`, `inventaris-access.spec.ts`, `inventaris-period.spec.ts` (drawer lists in drawer order).

On the exact drawer rule: the tech lead's brief said "every active member with an active period". The spec (section 2, "Drawer"; LT-46; R7: own requests stay readable with no active period) and the code (`src/components/shell/nav.ts`) say: every active member, **no period needed**. The tests assert the spec. This is a wording difference in the brief, not a contradiction between spec and code.

## 7. Bugs and observations

| Id | Severity | Where | What |
|---|---|---|---|
| BUG-LT-01 | **FIXED 2026-11-11** (was Low, database, bypass only) | `supabase/migrations/20261110100000_nexus_letters.sql`, `nexus._lt_text` (used by `_lt_required_text`) | `btrim()` strips spaces only. A required text made of a newline and a tab (`"\n\t"`) passes as "not blank" when the Server Action is bypassed (a secretary calling `letter_register` with their own token). Repro: `select` the function as `sekjen` with `p_subject => E'\n\t'` and `p_counterpart => 'x'`: the letter is saved with a whitespace Perihal (seen: `length(subject) = 2`). Expected `text_required` (LT-21, LT-44: "refused by the database even when the page is bypassed"). The Server Actions are not affected (zod trims with JS `trim()`), so this is a defence-in-depth gap. Same helper is used for the other required texts and reasons (purpose, void reason, rejection note). Suggested fix: `btrim(p, E' \t\r\n')` or a regex test for `^\s*$`. **Fix:** `nexus._lt_text` now uses `btrim(p_text, E' \t\r\n\f\v')` (edited in place in M10, not yet on hosted, like 93295a1; also applied to the local database). The `test.fail` in `surat-edge.spec.ts` is now a normal passing test, and `nexus_letters.test.sql` has a pgTAP case (written, not run: see section 9). |
| BUG-LT-02 | Low (UX) | `src/lib/picore/letters.ts` / `src/app/(app)/surat/masuk` (search) | A NUL character in the search address (`/surat/masuk?q=%00`) is refused by PostgREST (`\u0000` is not valid), the mapper answers `unavailable` and the screen shows the outage message "Terjadi gangguan." instead of "no results". No crash (status 200, page usable). Expected: treat it like any text without a match, or strip control characters in the search schema. Covered by an expected-failure test in `surat-edge.spec.ts`. |
| OBS-LT-03 | Info (spec text) | `docs/modules/letters.md` L11 (a) versus `docs/design/letters.md` P12 / section 15 and the code | The spec says the Dashboard "permohonan menunggu" line is for `process` holders; the approved design and the code give it to `letter_requests.view_all` (so BPH view-only also sees it). The tests follow the design (the design wins, spec 10b). One of the two texts should be corrected. |
| OBS-LT-04 | Info (navigation gap) | `src/components/shell/nav.ts`, design G10 | "Penomoran Surat" has no link in the drawer or the settings area (no settings area exists). A BPH secretary reaches it from the register form ("Lihat pengaturan nomor."), but a System Admin without a BPH position has no register and therefore **no way to find the page except typing `/pengaturan/penomoran-surat`**. Owner question below. |
| OBS-LT-05 | Info (local stack) | `supabase/config.toml` | Storage is disabled, so real uploads, signed links and the 10-uploads cap cannot be tested locally (section 1, section 8). The browser flows use a stub for the upload route only. |
| OBS-LT-06 | Info (REST) | PostgREST, all `nexus.letter_*` functions | A "not found" raised with `P0002` reaches a direct REST caller as HTTP 500 (hint `request_not_found`). The app maps it to "tidak ditemukan", so users never see it; same as Inventory. |
| OBS-LT-07 | Info (build), resolved 2026-11-11 | `tsconfig.json` | `pnpm typecheck` failed only in `src/modules/minutes/**` (files of the Minutes work in progress: `./export-file`, `@/app/(app)/notulensi/actions` not yet present). No Letters or test file has a type error. |

Probed and found correct (no defect): number first then file (Terbitkan refused without a number or a file, by function and screen); two secretaries pressing "Ambil nomor" or "Terbitkan" at once (one wins, one number used, the other gets `state_changed`); a rejected request voids the taken row with the note as reason and the number is never reissued; an own request is blocked at every step and by the Server Action; the register / detail / forms are refused to every persona without the key (screens, pages, functions, REST); old-period letters are read-only even for the new manager; a request keeps its own period while its letter takes the active one when the number is taken after a switch; `%` and `_` in the search are literal; HTML in Perihal, counterpart, notes and purpose is shown as text and never runs; formula-looking cells are text in CSV and Excel (no `<f>` element); export writes its log row before the file and returns no file when the log cannot be written; exports equal the screen in rows, order and count.

### Questions for the owner (not decided by QA)

1. **How does the System Admin reach "Penomoran Surat"?** (OBS-LT-04.) Options: (a) a link in the drawer visible to the System Admin only, (b) wait for the settings area design (G10) and accept typing the address until then, (c) show the "Lihat pengaturan nomor." link to the admin on the Permohonan Saya page. Recommendation: (a), because "set the next number once at go-live" (L7) is the first thing the admin must do and the page is otherwise hidden.
2. **Whitespace-only text through a direct call** (BUG-LT-01): **answered 2026-11-11, fixed** (owner chose the fix).
3. **Dashboard "permohonan menunggu"** (OBS-LT-03): keep the design (every `view_all` holder, so BPH view-only too) and correct spec L11, or restrict it to `process` holders as L11 says? Recommendation: keep the design.

## 8. Manual checklist (what automation cannot cover here)

1. **Real upload and signed links** (needs `[storage] enabled = true` and a stack restart, or the hosted project after the storage migration): upload a PDF and a phone photo (JPG and PNG are resized in the browser to about 2000 px) in a request, in Terbitkan and in "Tambah berkas"; check the file opens through "Lihat" / "Unduh"; open the same link after 5 minutes (300 s) and expect it to fail; as a member who is neither the requester nor a `view_all` holder, ask for a link to someone else's file and expect "Berkas tidak bisa dibuka"; as a plain member try to open a register file; upload 11 files without saving anything in 24 hours and expect the 11th to be refused (429 "Terlalu banyak unggahan..."); a GIF and a Word file are refused; a PDF renamed `.jpg` is refused.
2. **Download of the issued letter by the requester** in a real browser (the new tab opens with the signed link; popup blockers; Safari).
3. **1 January rollover (LT-18)**: with the clock set (or on the first real day of a year) the first letter of each type is `001` and the sequence of the old year is untouched; the database year function is tested at 16:59 / 17:00 UTC.
4. **Midnight restart of the daily cap (LT-45)**: a member at 10 requests can request again after 00:00 WIB.
5. **LT-06 and LT-43**: run `supabase/tests/nexus_letters.test.sql` (pgTAP) in a fresh container; granting `letters.manage` to "every active member" or without a reason must be refused by the database.
6. **LT-16 and AC-64**: with all rules D16, D19, D22 disabled, requests wait; the admin sees the "nobody can use it" warning (needs the admin rules screen, not built).
7. **First-use hint** (design 7.6): on a database where the next sequence was never set, the register form shows "Nomor pertama akan menjadi 001..." and it disappears after the System Admin sets the start.
8. **Phones**: 390 px on a real Android and an iPhone (camera "Ambil foto", date picker, keyboard over the dialogs, the "Salin nomor" button) and the 1024 px register table.
9. **Dashboard card empty state (LT-40)** on a database with no letters in the period: "Belum ada surat di periode ini."
10. **Backup and restore of storage** (letter files are never purged): follow `docs/ops` once the bucket exists on hosted.

## 9. Run record

Run of 2026-11-11 (local stack, production build from `pnpm build`, Playwright started `next start` on 3100):

| Suite | Command | Result |
|---|---|---|
| Unit | `pnpm test` | 24 files, 751 tests passed |
| Types | `pnpm exec tsc --noEmit` | no errors (OBS-LT-07 is gone: the Minutes files now compile) |
| Lint | `eslint` on the Letters source and test files | no findings |
| Letters e2e | `pnpm exec playwright test tests/e2e/surat- --project=mobile` | 88 passed, 1 skipped (a `test.skip` guard; the reason is not printed by the line reporter and was not identified), 0 failed |
| Desktop | `pnpm exec playwright test tests/e2e/desktop.spec.ts --project=desktop` | 4 passed |

Expected failure that still holds: BUG-LT-02 (the `test.fail` in `surat-edge.spec.ts`). BUG-LT-01 was fixed later the same day, see the next paragraph.

**Stale build trap (found in this run).** A first run on the old `.next` build (made 2026-11-10 00:21, before the Minutes work) gave 86 passed, 2 failed: `registerLetter...forbidden` and `processing your own request...` in `surat-access.spec.ts`. Both received "Server Action unavailable." from Next.js, not a Letters answer. `serverActionTarget()` reads the action ids from the newest `server-reference-manifest.json`, and a build that is older than the source gives ids the running server no longer knows. After `pnpm build` both passed with no code change. Rule: run `pnpm build` before the e2e suite whenever any file under `src` changed.

**Re-run after the BUG-LT-01 fix** (same day): `pnpm exec playwright test tests/e2e/surat- --project=mobile`: 86 passed, 3 skipped, 0 failed. The 3 skips are the daily request guard ("no requester has daily room left"; the cap of L10 b was used up by the repeated runs of this day, use `QA_RELIEVE_DAILY_CAP=1`). The BUG-LT-01 test passes as a normal test. The first run of the day skipped 1 for the same reason.

Not run: section 8 (manual checklist), and the pgTAP file `supabase/tests/nexus_letters.test.sql` (it refuses to run on the NEXUS dev stack by design; it needs a throwaway container). The new pgTAP case for BUG-LT-01 is therefore written but not executed.
