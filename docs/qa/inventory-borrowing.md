# QA: Inventory and Borrowing / Manajemen & Inventaris

Spec: `docs/modules/inventory-borrowing.md` (criteria IB-01..IB-57, personas section 2, flows F1-F12, rules R1-R31, owner decisions section 11c). Decisions: D-022 (with the follow-ups of 2026-11-07 and 2026-11-08). Design: `docs/design/inventory-borrowing.md`.
Owner of this file: QA (`nexus-qa-tester`). Last updated 2026-11-09. Format follows `docs/qa/member-data.md`.

## 1. How to run

Prerequisites: NEXUS local stack running (`bash scripts/dev-db.sh start`), `.env.local` pointing at it (API `http://127.0.0.1:55431`), `pnpm build` done (the Playwright web server runs `next start` from `.next`, so rebuild after every source change; `pnpm build` also type-checks `tests/**`).

| What | Command | Notes |
|---|---|---|
| Unit tests | `pnpm test` | No stack needed. 3 new files (section 2). |
| Whole e2e suite | `pnpm test:e2e` | About 15 minutes. |
| Inventory e2e only | `pnpm exec playwright test tests/e2e/inventaris --project=mobile` | Files `inventaris-*.spec.ts`. |
| Same, when the daily request cap is used up | `QA_RELIEVE_DAILY_CAP=1 pnpm exec playwright test tests/e2e/inventaris --project=mobile` | See the next paragraph. |

**The daily cap shapes re-runs.** The owner's rule (R29) is: at most 20 new requests per member per Jakarta day, counting cancelled ones, and requests can never be deleted. A full run creates about 60 requests, spread over six login-capable members (`regular`, `pembina`, `kabiro`, `bendahara`, `admin`, `ketum`, picked by `requesterWithRoom()` in `inventaris-helpers.ts` by remaining room). When a member has no room left, the test **skips with the reason** (it does not fail). To run again on the same day, `QA_RELIEVE_DAILY_CAP=1` makes `global-setup.ts` move the creation time of today's QA requests (items named `QA...`) back by one day, in one transaction with triggers skipped, touching nothing else. Use it only on the local stack.

**Storage is off on the local stack** (`supabase/config.toml` `[storage] enabled = false`). So a real photo upload can never reach Supabase Storage here: the evidence route is tested up to the Storage call (type, size, magic bytes, access), and answers 503 `unavailable` for a valid JPEG. Browser flows that need a photo path stub only the evidence route (`stubEvidenceRoute`), and the return function (which skips the object check when the `storage` schema is missing) does the rest. Signed URLs, the bucket policies and the "10 unattached uploads" cap need Storage: see the manual checklist (section 8).

Safety: `global-setup.ts` refuses to run unless the API is `127.0.0.1:55431`. All specs sign in through `signedInContext()` (cached sessions, `throttleSignIn`); two seed personas were added to `tests/support/local-stack.ts` (`kadivLogistik`, `staffOps`). No `db:reset`, drop or truncate is used. Data the tests create is **append-only by design** (items are archived, requests ended); every name carries a unique `QA<tag>` so it can be told apart. Things a test flips for a moment (active period, a temporary previous-period assignment of `member.regular`, default rule D36, a `CHECK (false)` named `qa_block_ib_log_write` on the export log, deactivating `kadep`, a QA member) are restored in `finally`, and `global-setup.ts` / `global-teardown.ts` repair them if a run died.

## 2. Test layout

| File | Covers |
|---|---|
| `tests/unit/inventory-borrowing-contract.test.ts` | Jakarta dates (23:30 UTC = next day, leap years), `maxRequestEndDate`, `rangeDays`, `isRequestOverdue`, `inventoryCapabilities` per persona, every zod limit (365 days, 500 characters counted as characters, 50 lines, 200 units, stock 0-9999, photo rules, return outcomes, reference format), copy texts and variants, database-hint mapping (prototype names fail closed), export status label. |
| `tests/unit/inventory-borrowing-static-rules.test.ts` | Source rules: RPC and table names only in `src/lib/picore/inventory-borrowing.ts`, UI never calls the database, no service-role key, nothing deletes or overwrites, routes POST-only, Server Actions marked, no deposit/contact/notification code, no catalog photo input. |
| `tests/unit/multipart-mixed-case-boundary.test.ts` | Regression for the multipart bug (section 7, BUG-IB-01): a browser-style body with boundary `----WebKitFormBoundaryAbC123xYz` is accepted by the evidence route, the inventory export fallback and the Member Data export parser. |
| `tests/e2e/inventaris-flow.spec.ts` | The state machine in the browser at 390 px: submit, approve with a lower quantity, hand over (tracked units), return good / damaged / lost with photos, "Ada masalah", once-only correction, reject, cancel (with and without reason), no cancel after pick-up, extend and its conflict, too-early handover, outside party, L6, overdue. |
| `tests/e2e/inventaris-access.spec.ts` | Persona matrix on screens, forbidden pages, buttons absent, direct database-function calls per persona, direct table access, route handlers, Server Actions called with the `Next-Action` header, catalog of keys and RLS facts. |
| `tests/e2e/inventaris-limits.spec.ts` | Caps (5 open, 20 per day), date rules, field limits, double booking (concurrent), the same request decided or returned twice, partial return, overlap, reserved stock, photo and return rules at the database, extension cap. |
| `tests/e2e/inventaris-edge.spec.ts` | Evidence route with real files (wrong type by magic bytes, over 1.5 MiB, malformed), photo picker messages, empty and no-match states, malformed addresses, very long text, request-form refusals, every screen at 390 px with 44 px / 16 px fields. |
| `tests/e2e/inventaris-export.spec.ts` | Catalog and borrowing exports in xlsx, csv and pdf against the screen (rows, order, filters, period filter), one log row each, WIB times, no PII, log failure means no file, the log is immutable. |
| `tests/e2e/inventaris-manage.spec.ts` | Create both modes with automatic codes, stock dialogs need a reason, write-off and restore, archive rules, lists, what members never see. |
| `tests/e2e/inventaris-period.spec.ts` | Dashboard card counts against the tables, period switch (both directions and "no period"), rule D36 switched off. |
| `tests/e2e/inventaris-deactivated.spec.ts` | Requester deactivated mid-loan, single head in office (B29), privacy of availability. |
| `tests/e2e/inventaris-helpers.ts` | Shared helpers: persona-token function calls, read-only oracles, fixtures through the app's database functions, `requesterWithRoom`, xlsx reader, JPEG made by the browser. |
| `tests/e2e/data-anggota.spec.ts`, `data-anggota-period.spec.ts` | Existing specs, drawer expectations updated for the new item (section 6). |

Oracles: every number a test compares against is read at test time with a read-only `SELECT` (`sql()`): stock, counts, the Dashboard card, export rows, log rows, requests per member per day, the oracle list of references for each queue view.

## 3. Persona matrix (what each must see and what must be blocked)

Local accounts from `docs/ops/local-setup.md` section 3. Default rules D01, D09-D11, D28, D29, D31, D34-D36.

| Persona (account) | Must see and do | Must be blocked | Automated |
|---|---|---|---|
| System Admin, no position (`admin`) | Drawer item, Katalog, Peminjaman Saya, "Ajukan Peminjaman", Dashboard card. | Antrean, Kelola Barang (forbidden page), Ekspor, another member's request (not found, B18), every write function, export 403. | Yes. |
| Treasurer (`bendahara`, Bendahara Umum 1 = BPH) | As BPH below. | As BPH. | Yes (screens, queue read, export). |
| Secretary | Sekretaris Umum is BPH; Sekretaris Departemen Operasional is Operations (IB-02). | - | **Not seeded**: no Secretary login exists. The Operations code path is exercised by `staffOps` and heads. |
| Operations head (`kadivLogistik`, `kadep`) | Everything: Antrean (default view Menunggu persetujuan), Kelola Barang, approve / reject / extend, hand over, return, correction, outside party, exports. | Approve, reject or extend their OWN request (L6, message shown, buttons absent); the other head can. | Yes. |
| Operations staff (`staffOps`, Staff Akomodasi) | Antrean (default Siap diambil), Kelola Barang, hand over, return, correction, outside party, exports, handle on own request. | Approve, reject, extend (buttons absent; function `permission_required`). | Yes. |
| BPH (`ketum`) | Katalog, Antrean (view only, all requests), exports of both lists. | Setujui, Tolak, Serahkan, Terima pengembalian, Koreksi, Kelola Barang, item writes, evidence upload. | Yes. |
| Regular member (`regular`, `pembina` as lecturer, `kabiro`) | Katalog, Peminjaman Saya, request, cancel own until pick-up, own detail and timeline. | Antrean, Kelola, Ekspor, another member's request (not found), every write function. | Yes. |
| User with NO assignment (`pembina`, `admin`) | Same as a regular member. | Same. | Yes. |
| Deactivated member (`inactive`) | "Belum ada akses" on every URL. | Every function even with a valid token (L1). | Yes. |
| Unlinked account (`unlinked`) | Same as deactivated. | Same. | Yes. |
| Requester deactivated mid-loan | Their requests and name stay; Operations take the return. | Everything for the member himself. | Yes (`inventaris-deactivated`). |
| Officer from a PREVIOUS period (`regular` with a temporary 2025/2026 head assignment, and the staff / BPH of 2026/2027 after the switch) | Own requests, catalog. | Operations and BPH rights of the other period. | Yes (`inventaris-period`). |
| Anonymous | Redirect to login. | Pages (302), routes (401/403), database functions. | Yes. |

## 4. Period change (IB-38, IB-40, F11, AC-42)

Automated in `inventaris-period.spec.ts`, with sessions kept open the whole time (no logout):
1. Four requests are made in 2026/2027: waiting, approved, on loan, closed. Switch the active period to 2025/2026 (the seed has no previous-period Operations account, so `member.regular` gets a temporary Kepala Divisi Logistik assignment there).
2. `staffOps` (Operations in 2026/2027) loses Antrean and Kelola on the next request, direct URLs show the forbidden page, hand over and create item answer `permission_required`; `ketum` loses Antrean; the drawer keeps the module (baseline). `regular` gains Antrean and Kelola, reads the open list "Belum selesai, semua periode", reads the CLOSED old request (read-only, no correction button), approves the waiting old request and takes back the loan (L7), and the correction of the closed one is refused with `closed_period`. The requester still reads their own old requests (L9). A new request belongs to the new period. All four old requests keep their period id; the 2026/2027 assignments are unchanged (history).
3. No active period: the catalog stays readable, the banner "Belum ada periode aktif. Pengajuan belum bisa dibuat." shows, "Ajukan Peminjaman" is absent, create answers `no_active_period`, Operations rights match nothing.
4. Back to 2026/2027: staff and BPH regain access by themselves, the temporary officer loses it again, nothing was lost.
5. Rule D36 switched off (IB-06): the handover button vanishes on the next request without a logout, the function refuses, and it returns when the rule is on again.

## 5. Acceptance criteria coverage

A = automated, M = manual checklist item (section 8). "DB" = checked by calling the database function with the persona's token.

| Criterion | Where | Status |
|---|---|---|
| IB-01 | access (screens, forbidden pages, item writes by call) | A |
| IB-02 | access, manage (Operations staff and heads); Sekretaris Departemen not seeded | A, M for that persona |
| IB-03 | access (inactive, unlinked, anonymous; DB) | A |
| IB-04 | access (BPH reads, exports; refused write calls) | A |
| IB-05 | access (admin not found; DB) | A |
| IB-06 | period (rule D36) | A |
| IB-07, IB-09, IB-11 | manage (both modes, totals, codes unique and increasing, concurrent create, guard on code updates) | A |
| IB-08 | manage (no mode on update, trigger guard) | A |
| IB-10 | manage (lists, duplicates, deactivate keeps items) | A |
| IB-12, IB-13 | manage (archive blocked with a count, no names), limits (reserved stock) | A |
| IB-14, IB-15 | flow (requester = session), access (own list only) | A |
| IB-16 | limits (dates, quantities, text, archived, not lendable), edge (form) | A |
| IB-17 | flow (cancel rules, no cancel after pick-up, stranger refused) | A |
| IB-18 | deactivated (counts only, no names in functions or HTML) | A |
| IB-19 | flow (submit holds nothing, approval holds) | A |
| IB-20, IB-21, IB-22 | access, flow (L6 on screen and by call, note rules) | A |
| IB-23 | deactivated (single head, `kadep` deactivated for a moment) | A |
| IB-24 | limits (two approvals at the same moment) | A |
| IB-25 | flow (extend), limits | A |
| IB-26, IB-27, IB-28 | flow, limits (units, partial return, over-return) | A |
| IB-29, IB-30 | flow (browser), limits (photo and note rules at the database) | A (real upload part: M) |
| IB-31 | static rules (no money words) | A |
| IB-32 | limits (photo records cannot be changed even by the owner), static rules (no catalog photo input) | A |
| IB-33, IB-34 | flow (outside party) | A |
| IB-35, IB-36 | flow (overdue with aged dates), limits (23:30 UTC at the database, overdue keeps blocking) | A |
| IB-37 | limits (one shared day overlaps) | A |
| IB-38, IB-40 | period | A |
| IB-39 | deactivated | A |
| IB-41 | access (tables by REST, guards under rollback), static rules | A |
| IB-42 | access (no PII in detail), export (no PII), static rules | A |
| IB-43, IB-44 | export, access (routes, refused, no log row, log failure = no file, immutable log) | A |
| IB-45 | period (card against the tables, no percent, every member) | A (empty state of the card: M) |
| IB-46 | static rules (no channel, no contact field) | A |
| IB-47 | edge (390 px, 44 px, 16 px), flow | A |
| IB-48 | access (RLS facts, direct reads), limits (state_changed) | A for what runs through the API; pgTAP per persona is in `supabase/tests` (not run by QA) |
| IB-49, IB-50 | limits (5 open, 20 per day, cancelled count, outside party counts for the recorder); the midnight restart: M | A, M |
| IB-51 | unit, limits (create and extend, original start) | A |
| IB-52 | flow, limits (good return frees at once) | A |
| IB-53 | flow (once only, gone after use), limits (conflict after a stock edit) | A |
| IB-54 | manage (manage-only, active item, reason, original row stays) | A |
| IB-55 | unit, limits | A |
| IB-56 | edge (route), limits (path and photo rules); bucket, signed URLs, 10 unattached: M | A, M |
| IB-57 | access (22 keys, 35 + 1, D30 stays off); "restore default rules" does not re-enable D30: M (it writes) | A, M |

## 6. Existing specs updated

The new drawer item "Manajemen & Inventaris" (D-021: every active member once a period is active) broke the hard-coded drawer lists. Updated, no assertion weakened: `data-anggota.spec.ts` (BPH and Operations-head list, non-viewers, the keyboard-focus loop of the drawer) and `data-anggota-period.spec.ts` (all `drawerItems` expectations, including "no active period" and the previous-period case) now expect the item through one constant, in drawer order. `global-setup.ts` also restores the seed accounts of the new personas, rule D36 and the log-blocker constraint.

## 7. Bugs and observations

| Id | Severity | Where | What |
|---|---|---|---|
| BUG-IB-01 | High (found by the security review, **fixed** in the working tree) | `src/modules/inventory-borrowing/server/evidence.ts`, `server/export.ts` (multipart fallback), `src/modules/member-data/server/export.ts` | The handlers lower-cased the whole `Content-Type` before parsing a multipart body, but the boundary is case-sensitive. Chrome and Safari send `----WebKitFormBoundaryAbC...`, so every real browser upload failed with `invalid_input`, while Node's `FormData` (lower-case boundary) passed the old tests. Regression: `tests/unit/multipart-mixed-case-boundary.test.ts`, and the e2e upload tests use Playwright's browser-style multipart. |
| BUG-IB-02 | Low (UX) | `src/modules/inventory-borrowing/ui/photo-picker.tsx` lines 132-137 (`add()`, `catch` around `resizePhoto`) | A file that claims to be a JPEG/PNG/WebP but cannot be decoded (corrupt or renamed) shows "Foto masih terlalu besar setelah diperkecil. Coba foto lain." The cause is not the size. Repro: in "Terima pengembalian", mark a unit Rusak and choose a text file named `x.jpg` with type `image/jpeg`. Expected: a message that the photo cannot be read (the owner chooses the words); actual: the "too large" text. **Fixed 2026-11-09 (48c2a08):** owner chose "Foto ini tidak bisa dibuka. Coba foto lain."; the "too large" text now appears only for a decoded photo that stays over the limit. The e2e asserts the exact text. |
| OBS-IB-03 | Info (build) | `tsconfig.json` (`include: **/*.ts`), `next build` | `pnpm build` type-checks `tests/**` too, so a type error in a test file breaks the production build (seen while writing these specs). Consider a separate `tsconfig` for the build or keeping tests out of it. |
| OBS-IB-04 | Info (rerun limits) | spec A-IB49, `borrowing_request_create` | The daily cap counts cancelled requests, as decided. Consequence for the team: about two full QA runs per Jakarta day (section 1). |
| BUG-IB-05 | Medium (UI, fixed) | `request-detail-screen.tsx`, `item-detail-screen.tsx`, `lists-screen.tsx` (grid columns `..._1fr`) | Found by the Tech Lead re-run on 2026-11-09: on the member's request detail at 390 px, an unbroken 500-character purpose or note pushed the page sideways (a `1fr` grid column never shrinks below its longest word, so `break-words` had no effect). Fixed with `minmax(0,1fr)` in all three grids; the long-text e2e passes. |
| OBS-IB-06 | Info (tests, fixed) | `inventaris-limits.spec.ts`, block "request validation by direct call" | When its setup skipped (daily cap reached), the following tests crashed on the missing item instead of skipping. It now uses the same `ready` guard as the other serial blocks. |

No other defect was found in the application code. Deliberately probed and found correct: order of caps before line-count validation; availability is refused at creation when stock is held by a loan (counts only: "Only 0 available"); BPH may read module tables through RLS only where a `view_all` policy allows (the export log has no read policy at all); the start date input keeps a typed past date and the form refuses it.

## 8. Manual checklist (what automation cannot cover)

1. **Real photo upload and signed URLs** (needs `[storage] enabled = true` in `supabase/config.toml` and a stack restart, or the hosted project after the migration): upload a JPEG from a phone (HEIC from an iPhone must be converted by the browser resize), see it in the request detail as the requester and as BPH; open the link after 5 minutes (A-IB51: 300 s) and expect it to fail; a member who is neither requester nor `view_all` must not get a link; try uploading as BPH and while the request is not Dipinjam (bucket policy `upload_refused`); upload 11 photos to one request folder without saving a return (the 11th is refused); a PNG and a WebP are accepted, a GIF is not.
2. **Midnight restart of the daily cap (IB-50)**: with a member at 20 requests, the next request after 00:00 WIB must be accepted (the database logic is tested with fixed timestamps; the live restart is not).
3. **Overdue at the day border (IB-35)**: a loan ending today turns "Terlambat" at 00:00 WIB, not at 07:00 WIB.
4. **Sekretaris Departemen Operasional** (IB-02, IB-20): create the account in the seed or on the hosted project, confirm manage and handle but no approve.
5. **Restore default rules (IB-57)**: in the admin screen (when built) press "restore default access rules" and confirm D30 stays off.
6. **Dashboard card empty state (IB-45)**: on a database with no items, the card says "Belum ada barang di inventaris." and shows no "0%".
7. **Export of very large lists**: since 2026-11-09 the server compares the rows received with the database's `total_count` (migration 20261109100000), so an export of up to the API row limit (1000 by default) works and only a cut answer (more than that many rows) returns `export_too_large`. Try with real data volume before launch.
8. **Phones**: 390 px on a real Android and an iPhone (date picker, camera "Ambil foto", keyboard covering the dialog notes), plus the 1280 px desktop layout.
9. **Backup and restore of storage** (evidence photos are never purged): follow `docs/ops` after the Storage bucket exists on hosted.

## 9. Run record

Run of 2026-11-09 (local stack, fresh `pnpm build` including the multipart fix, `QA_RELIEVE_DAILY_CAP=1`):

| Check | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm lint` | clean (0 warnings) |
| `pnpm test` (Vitest) | 17 files, 501 tests passed (3 new files: contract 37, static rules 13, multipart regression 5) |
| `pnpm test:e2e` (whole suite) | **300 passed, 2 skipped, 0 failed** in 14.3 minutes. The 2 skips: `fault.spec.ts` (opt-in on purpose, untouched) and "Peminjaman Saya is empty for a member who never asked" (every pooled member already has requests from earlier runs; the test then proves the empty state through an empty filter when one exists, otherwise skips) |

Inventory e2e per file (mobile 390 px): access 37, deactivated 3, edge 11 (+1 skip), export 16, flow 17, limits 17, manage 10, period 9 = **120 passed**. Existing specs: data-anggota 39, data-anggota-export 41, data-anggota-period 8, data-anggota-desktop 3, desktop 7, login-screen 34, personas 23, security 28.

Before the specs were corrected, the first baseline of the old suite on the new build had 11 failures, all of them hard-coded drawer lists (section 6); the first full run of the new specs had 2 failures, both test defects (a BPH account listed as a "stranger"; a date typed before React had hydrated the form), fixed in the helpers (`fillDate` waits for hydration).

Local data left behind by a run (append-only by design, see section 1): items named `QA...` (all archived), requests of those items (all ended: returned, cancelled or rejected), roughly 60 new request references per run, export-log rows (the table was empty before), item-history rows. Nothing outside the QA names was changed; the active period is 2026/2027, rule D36 is on, `kadep` is active, and no temporary assignment is left.

