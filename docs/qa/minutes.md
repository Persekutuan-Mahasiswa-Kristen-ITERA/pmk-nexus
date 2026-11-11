# QA: Notulensi Rapat / Meeting Minutes

Spec: `docs/modules/meeting-minutes.md` (criteria MN-01..MN-30, flows F1-F7, rules R1-R13, owner decisions N1-N6, assumptions A-MN1..A-MN18). Decision: D-027. Contract: `src/modules/minutes/types.ts`.
Last updated 2026-11-11. Format follows `docs/qa/finance.md`. Code under test: commits `c499dc0` (server layer and screens) and `d0c7ff7` (drawer, Dashboard card, route allow-list), and the migrations `20261111100000_nexus_minutes_access_rules.sql`, `20261111100100_nexus_minutes.sql`, `20261111100200_nexus_minutes_storage.sql`.

**Status: NOT cleared for the hosted project.** The database, the server layer and the screens are tested (255 pgTAP, 77 unit, 51 end-to-end tests against the local stack), and the review found nothing CRITICAL, HIGH or MEDIUM (section 5). Two things remain that a test cannot do: a human click-through at 390 px (MN-29 by eye), and the owner's approval with a backup before the migrations go to the hosted project (R13). Real Supabase Storage was never available locally (section 6).

## 1. How to run

| What | Command | Notes |
|---|---|---|
| Unit tests | `pnpm test` | No stack needed. Minutes: `minutes-types.test.ts` 48, `minutes-server.test.ts` 29. |
| Typecheck, lint, build | `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` | Clean on 2026-11-11, lint 0 warnings. |
| pgTAP (database) | Throwaway container, recipe in `docs/qa/finance.md` section 1 | File `supabase/tests/nexus_minutes.test.sql`. Never on the dev stack. |
| End to end | `pnpm exec playwright test tests/e2e/notulensi- --project=mobile` | Needs the local stack (port 55431) and `next start -p 3100` on a fresh build. |

## 2. Test layout

| File | Covers |
|---|---|
| `supabase/tests/nexus_minutes.test.sql` | 255 pgTAP tests: structure and privileges, RLS per persona (own-unit isolation), immutability and no delete, every function and its error hints, files and the upload cap, the export and its log, the Storage policies, period switch. **255/255 passed, 0 skipped.** Every criterion except MN-29 (screen size) is named. |
| `tests/unit/minutes-types.test.ts` | The contract: field limits, the Jakarta date, error mapping, capabilities, file rules. |
| `tests/unit/minutes-server.test.ts` | The server layer with a fake client: error mapping fails closed; the gate runs before every RPC; signed links only for readable files. |
| `tests/e2e/notulensi-helpers.ts` | Persona-token calls, read-only oracles, `sweepQa()` (voids what a run made; minutes are never deleted). |
| `tests/e2e/notulensi-access.spec.ts` | 25 tests, 390 px: persona matrix (drawer, Dashboard card, buttons absent, forbidden pages), D37 on and off, two units, assignment moved, functions with each persona's own token, direct table access, both route handlers and the Server Actions called directly. |
| `tests/e2e/notulensi-flow.spec.ts` | 14 tests: Catat (validation, limits, future date), edit with history, void with reason, two managers at once (version), markup shown as text, files (add, withdraw, limit of 3; the upload route is stubbed because Storage is off locally), search and filters, 390 px layout, leave-with-unsaved-typing prompt. |
| `tests/e2e/notulensi-export.spec.ts` | 10 tests: Excel, CSV and PDF by Ketua Umum against the filtered screen (rows, order, voided with reason, content in full, WIB, name not email, no ids or paths, no formulas); seven filter combinations against `minute_list`; a department secretary's scope; single-minute export from the detail (log row stores the minute id); 404 outside the scope; headers; bad bodies 400; log write failure gives no file; direct database calls. |
| `tests/e2e/notulensi-period.spec.ts` | 2 tests: 2026/2027 to 2025/2026 and back with sessions kept open (officers lose access without logout; a 2025/2026 Sekretaris Departemen reads the unit's earlier minutes read-only, records into the active period, exports both periods); no active period (nothing readable, nothing writable, nothing written). |

## 3. Criteria map

| Criterion | pgTAP | Unit | E2E |
|---|---|---|---|
| MN-01..MN-08 access per persona | yes | gate | access |
| MN-09 validation on the server | yes | yes | flow |
| MN-10 no active period | yes | | period |
| MN-11 edit, history | yes | | flow, access |
| MN-12 old period read-only | yes | | period, access |
| MN-13 void | yes | | flow |
| MN-14 concurrent save | yes | | flow |
| MN-15 nothing deleted | yes | | access |
| MN-16 markup as text | yes | | flow, export (cells) |
| MN-17 file types and count | yes | yes | access, flow (stubbed upload) |
| MN-18 private bucket, signed link | yes (stand-in) | yes (fake Storage) | access (no path in the page) |
| MN-19 withdrawn file | yes | | flow |
| MN-20 upload cap of 10 per 24 h | yes | | not run (Storage off) |
| MN-21, MN-22 search and filters | yes | | flow, export |
| MN-23 period switch | yes | | period |
| MN-24 deactivated author | yes | | access |
| MN-25..MN-27 export and log | yes | | export, access |
| MN-28 Dashboard card | yes | | access, period |
| MN-29 390 px | | | flow and period check no horizontal scroll; the rest needs a human (section 6) |
| MN-30 RLS per persona | yes | | access |

## 4. Run record (2026-11-11)

| What | Result |
|---|---|
| `pnpm run typecheck`, `pnpm run lint` | Clean, 0 warnings. |
| `pnpm run test` | 788 passed. |
| pgTAP `nexus_minutes.test.sql` | 255 ok, 0 not ok, 0 skipped. |
| pgTAP, other NEXUS files on the same database | access_control 247, member_data 204, letters 486, inventory_borrowing 549, finance 328: all ok. |
| E2E `notulensi-*` | 51 passed (2.2 min). Database afterwards: one active period, D37 enabled, no `qa_block_*` constraint, every `QA` minute voided. |
| Hosted project | Nothing applied. |

Two problems found while writing the specs, both in the tests, not the app: the list streams after the header (wait for the cards before reading them), and `pdftotext` starts page 2 with a form feed (the block-heading pattern allows it). Writing the export spec also showed that the drawer and rule counts in the older Data Anggota and Inventaris specs predate Finance and Notulensi; those expectations were updated.

## 5. Security review (spec R13)

Method: read the code and the migrations, and checked the local database with queries. Not a penetration test.

**Result: no CRITICAL, no HIGH, no MEDIUM.**

- **Tables:** RLS on all four `minute*` tables; no INSERT, UPDATE or DELETE grant or policy for `anon` or `authenticated`; `minute_export_logs` has neither policy nor grant.
- **Functions:** all 12 API functions are `security definer` with a fixed `search_path`, none executable by `anon`; the 28 `_mn_*` helpers are not executable by `authenticated`.
- **Rules:** D37 (Kepala Departemen, `minutes.view`, own unit) is seeded only when no equal custom rule exists, and is re-enabled by the existing repair path.
- **App code:** no service-role key or admin client; no `dangerouslySetInnerHTML`; database and Storage calls only inside `src/lib/picore/minutes.ts`; both routes (`/api/minutes/export`, `/api/minutes/files`) are POST only and check the origin; the page HTML never holds a `storage_path` or another member's id (checked in `notulensi-flow`).
- **Export:** the log row is written in the same transaction as the rows, so a failed log write returns no file (tested with a blocking constraint); cells that start with `=`, `+`, `-` or `@` are text in CSV (prefixed `'`) and in Excel (no formula element).
- **Dependencies:** `pnpm audit --prod`: no known vulnerabilities.
- **Open (accepted):** the Content-Security-Policy is still open (F1). Plain-text rendering (R10, MN-16) is the mitigation and is tested.

## 6. What was NOT run

- **No human click-through.** The specs open every screen at 390 px and check text, buttons, overflow and the flows; nobody has judged MN-29 by eye (44 px fields, 16 px text, the file picker on a phone).
- **Real Storage.** Storage is off on the local stack. Uploads were tested up to the Storage call (route stubbed in the browser), the signed link with a fake client and the pgTAP stand-in. Not run end to end: the real upload, the signed link expiry, MN-20 (the cap of 10 unattached uploads) against Storage.
- **No test against the hosted project.**

## 7. Open before the hosted project (R13)

1. Click through every screen at 390 px as Sekretaris Jenderal, a Sekretaris Departemen, a Kepala Departemen and a member without access, and write the results here.
2. Backup, the owner's approval, then apply the three migrations to the hosted project (with the Finance ones, in file order).
3. After deploy: one real upload, open the signed link, withdraw it; then void the test minute.
