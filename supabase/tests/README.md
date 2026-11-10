# NEXUS database tests

Six pgTAP files: `nexus_access_control.test.sql` (engine, rules, D-015, D-022 amendment), `nexus_member_data.test.sql` (Member Data module, D-019), `nexus_inventory_borrowing.test.sql` (Inventory and Borrowing, D-022), `nexus_letters.test.sql` (Letters, D-024/D-025), `nexus_minutes.test.sql` (Meeting Minutes, D-027) and `nexus_finance.test.sql` (Finance, D-028). All work the same way; `nexus_access_control.test.sql` is described first. **Local / throwaway database only.** It inserts test personas into PI-CORE tables (`auth.users`, `public.members`, `public.periods`, `public.assignments`), switches the active period, and creates a helper schema `nexus_test`, all inside one transaction that ends with `ROLLBACK`. Never run it against the hosted project.

## Safety guards (W1, M1, L5)
All six files: (1) the setting below, (2) a data guard that stops if any email is not a fake test address, (3) a dev-stack guard that stops if the NEXUS dev stack's seed accounts (`@nexus.test`) exist, because the files need a FRESH database. All three run before anything is written. The letters file adds (4) a fresh-install guard: it stops if any letter, request or counter row exists (it checks exact numbers; counters are table rows and are rolled back, so it can run repeatedly in the same container). The minutes file stops if any minute or minute export-log row exists; the finance file stops if any entry or finance export-log row exists or the KAS counter is not 0 (the counter is a table row, rolled back, so both files can also run repeatedly in the same container).

### W1
The file refuses to run unless the session sets `nexus.allow_destructive_tests = 'yes'`. The guard sits right after `BEGIN`, and the file starts with `\set ON_ERROR_STOP on`, so a run without the setting stops at the guard and writes nothing (even a runner that ignored `ON_ERROR_STOP` would only meet an aborted transaction). The guard cannot test itself; check it by hand once: run the file WITHOUT the setting and confirm it stops with "local throwaway database only".

A `-c "set ..."` before `-f` does NOT work: each `-c`/`-f` item is separate and `set` would be undone by the file's own transaction handling. Pass the setting as a connection option instead.

## How to run (local)
1. Use a THROWAWAY `supabase/postgres:17.11.0.003` container (recommended; this is how every recorded run was done): start it on a free port (e.g. 54399), apply PI-CORE's 5 migrations from the PI-CORE repo, then all NEXUS migrations, then `create extension if not exists pgtap with schema extensions`. Do not use the NEXUS dev stack (`pnpm db:start`, port 55432): its seeded test accounts break this file's "fresh install" assumptions. Never use PI-CORE's stack (54322).
   ```bash
   docker run -d --rm --name nexus-test -e POSTGRES_PASSWORD=postgres -p 54399:5432 public.ecr.aws/supabase/postgres:17.11.0.003
   # wait until `docker exec nexus-test pg_isready -U postgres -h localhost` succeeds, then:
   for f in $(ls ../pi-core-v2/supabase/migrations/*.sql | sort); do
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -X -q -1 -v ON_ERROR_STOP=1 -f "$f"; done
   ```
   **Optional, for the Storage policy tests** (otherwise they are reported as `skip`): BEFORE the NEXUS migrations load the Storage stand-in as `supabase_admin` (the bare image has an empty `storage` schema owned by that role and no Storage service):
   `docker exec -i nexus-test psql -U supabase_admin -d postgres -X -q -1 -v ON_ERROR_STOP=1 < supabase/tests/support/storage_stub.sql`
2. Apply all NEXUS migrations in file-name order (see `../README.md`), each with `psql ... -1 -v ON_ERROR_STOP=1 -f`.
3. Run each file (separately; each ends with ROLLBACK, so the order does not matter):
   ```bash
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -f supabase/tests/nexus_access_control.test.sql
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -f supabase/tests/nexus_member_data.test.sql
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -X -At -f supabase/tests/nexus_inventory_borrowing.test.sql
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -X -At -f supabase/tests/nexus_letters.test.sql
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -X -At -f supabase/tests/nexus_minutes.test.sql
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -X -At -f supabase/tests/nexus_finance.test.sql
   ```
   Run the files with `-f <path>` (not through stdin): the inventory file includes `support/storage_stub.sql` with `\ir`, relative to its own location. If the host has no `psql`, copy the folder into the container (`docker cp supabase/tests <container>:/tmp/tests`) and run `docker exec -e PGOPTIONS=... <container> psql -U postgres -h localhost -d postgres -X -At -f /tmp/tests/<file>`.
   Any line starting with `not ok` is a failure. (`pg_prove` also works with the same `PGOPTIONS`.)

Assumes a fresh NEXUS install (exactly the 36 default rules D01-D36 with D30 retired, 36 seed log rows + 1 retirement row, empty export logs, an empty catalog, and no members other than the test personas). Sequences (INV-/PJM- numbers) are not rolled back by Postgres; the inventory file therefore checks code format and order, never fixed numbers, and can run repeatedly in the same container.

**Status 2026-11-10 (Meeting Minutes and Finance, migrations 20261111100000 .. 20261111200100 = M12-M16, steps 10f-10j in `../README.md`):** `nexus_access_control.test.sql` **247/247** and `nexus_member_data.test.sql` **204/204** (both updated for D37: 37 default rules, 36 enabled, 38 seed/retire log rows; same totals as before), `nexus_inventory_borrowing.test.sql` **549/549**, `nexus_letters.test.sql` **485/485** (unchanged), the new `nexus_minutes.test.sql` **255/255** and the new `nexus_finance.test.sql` **315/315**, in a FRESH throwaway `supabase/postgres:17.11.0.003` container WITH the Storage stub, after PI-CORE's 5 migrations and the 16 NEXUS migrations. WITHOUT the stub: the same 247/204/549/485/255/315, of which 26 (inventory), 26 (letters), 14 (minutes) and 18 (finance) Storage checks report `# SKIP`. (Count with the plan line `1..N` plus `grep -c '^not ok'` = 0: one letters `ok` line is prefixed by a psql notice, so `grep -c '^ok'` shows 484; the inventory output keeps its one expected `ERROR` line from the stub refusing a `@nexus.test` member.) The first draft of the minutes file stopped at its old line 454 with `null value in column "id" of relation "ids"`: a TEST bug, not a migration bug (a sub-select in the SAME statement as `minute_record()` cannot see the row the function inserted; split into two statements). Idempotence: M12-M16 applied a second time on the same database; `pg_dump -n nexus` (DDL + data, 16,465 lines) plus all `nexus`/`storage` policies, buckets, rule and log counts identical (only pg_dump's random `\restrict` token differs); the minutes, finance and engine files still pass on that database. Fault checks: `nexus._fn_guard` replaced by a no-op -> exactly the 5 immutability checks of finance section 8 fail; `nexus._mn_is_recordable_unit` accepting any unit -> exactly the 3 unit checks (division, unknown, inactive) of minutes section 4 fail. Guards checked by hand for both new files: without the setting they stop at the W1 guard; with an `@nexus.test` account present they stop at the dev-stack guard; nothing written either time. Two-session check (outside pgTAP, committed fixtures in a throwaway container): two `finance_entry_record` calls by the same Treasurer with the same submit key at the same moment -> the second waited about 3 s on the counter lock and returned the FIRST entry (`replayed = true`); the other Treasurer saving at the same moment got `KAS-0002`; 2 entries, counter 2 (FN-17, FN-18). The local dev stack got M12-M16 with `pnpm db:migrate` (Storage off: M14 and M16 skipped themselves); no seed change was needed.

**Status 2026-11-10 (Letters, migrations 20261110100000_nexus_letters and 20261110100100_nexus_letters_storage, steps 10d/10e in `../README.md`):** `nexus_access_control.test.sql` **247/247**, `nexus_member_data.test.sql` **204/204**, `nexus_inventory_borrowing.test.sql` **549/549** (all unchanged: no key, rule or existing object changed) and the new `nexus_letters.test.sql` **481/481** (451 + 5 after the owner's approval with "year mandatory": named CHECK present, hand update refused, `year_required` for false, null and false-with-other-changes; + 25 on 2026-11-10 for the backend-contract gaps: request detail returns the register row's current values, Terbitkan refuses a stale `p_letter_version` and keeps a register edit, `letter_my_request_caps()`, queue `letter_status` / `number_voided` / `period_total_count`, one version of the changed functions) in a FRESH throwaway `supabase/postgres:17.11.0.003` container WITH the Storage stub, after PI-CORE's 5 migrations and the 11 NEXUS migrations. WITHOUT the stub: the same 247/204/549/481, of which 26 Storage checks report `# SKIP` in the inventory file and 26 in the letters file. Idempotence: both letter files applied a second time; `pg_dump -n nexus` (DDL + data) plus all `nexus`/`storage` policies and buckets identical (only pg_dump's random `\restrict` token differs). Fault check: `nexus._lt_require_not_own` replaced by a no-op -> exactly the 4 L6 checks fail (LT-11 x3, LT-33); restored -> 451/451 (run before the year change). The local dev stack, after re-applying the edited M10 and the seed, has a `nexus` schema identical to a fresh install (`pg_dump --schema-only -n nexus`, no diff). Two-session check (outside pgTAP, committed fixtures in the throwaway container): two secretaries registering an outgoing letter at the same moment got `.../001` and `.../002`, the second session waited about 3.2 s on the counter row lock; two secretaries pressing "Ambil nomor" on one request at the same moment: the first got the number, the second waited and was refused with `state_changed`; one letter for the request, counter 3, 3 letters with 3 distinct numbers.

**Status 2026-11-09 (migration 20261109100000_nexus_export_totals_and_evidence_window, step 10c in `../README.md`):** `nexus_access_control.test.sql` **247/247**, `nexus_member_data.test.sql` **204/204** (198 + 6: export columns end with `total_count`, one version of the export, `total_count` = rows returned for the default and a filtered export and on more than one page, empty export = no rows, still one log row per export), `nexus_inventory_borrowing.test.sql` **549/549** (522 + 27: section 14 "Fix 1" = the upload cap counts only unattached files of the last 24 hours: 11 files aged 25 h no longer block (function and Storage policy), 10 recent files still block (function and policy), a 23 h old file still counts; section 16 = both export column lists end with `total_count bigint`, one version each, SECURITY DEFINER / VOLATILE / empty `search_path` / EXECUTE for `authenticated` only kept, `total_count` = rows returned for several filters and callers, empty export = no rows, one log row per export with the right `row_count`, a failing log insert still returns no data, refusals for P-PLAIN, P-STAFF-PUB and anon unchanged) in a FRESH throwaway `supabase/postgres:17.11.0.003` container WITH the Storage stub after PI-CORE's 5 migrations and the 9 NEXUS migrations. WITHOUT the stub: the same 247/204/549, of which 26 Storage checks report `# SKIP`. Fault check: the updated files against the 8 migrations WITHOUT 20261109100000: the member-data file fails MD-10 (column list) and then stops at the first `total_count` reference; the inventory file fails the two Fix 1 "no longer block" checks and the three column checks of section 16, then stops at the first `total_count` reference. Before this migration the counts were 247/198/522.

**Status 2026-11-08 (fixes migration 20261108100000, section 15 of the inventory file):** `nexus_access_control.test.sql` **247/247**, `nexus_member_data.test.sql` **198/198**, `nexus_inventory_borrowing.test.sql` **522/522** (468 + 54: detail by reference, once-only correction button and the hints `already_corrected` / `correction_conflict` / `stock_mismatch`, catalog export = list per caller, borrowing period filter and its period list `borrowing_period_list()`, structure) in a FRESH throwaway `supabase/postgres:17.11.0.003` container WITH the Storage stub, after PI-CORE's 5 migrations and the 8 NEXUS migrations. Fault check: with the four old function bodies loaded inside the test transaction, exactly 7 checks fail (Fix 2 and Fix 3), as expected.

**Status 2026-11-07, review version** (owner caps, date cap, single correction, lost-correction conflict, restore = `inventory.manage`, array caps, upload flood guard, bucket/policy guards, stub refuses @nexus.test, faster request lists): `nexus_access_control.test.sql` **247/247**, `nexus_member_data.test.sql` **198/198**, `nexus_inventory_borrowing.test.sql` **468/468** in a FRESH throwaway container WITH the Storage stub, and the same counts WITHOUT it (then 20 Storage checks report `# SKIP`). Also 247/198/468 on a database that first ran the earlier draft of M5-M7 and then the review version (upgrade path of the dev stack). Idempotence: M4-M7 applied a second time; `pg_dump` of schema `nexus` (DDL + data) plus counts of rules, log rows, policies, buckets, functions, tables and constraints identical (7,867 lines). The inventory output contains ONE expected `ERROR` line: the stub refusing a `@nexus.test` member (test 2). Count results with `grep -c '^ok [0-9]'`.

**Status 2026-11-07 (first version of migrations 20261107100000-100200, D-022):** `nexus_access_control.test.sql` **247/247**, `nexus_member_data.test.sql` **198/198**, `nexus_inventory_borrowing.test.sql` **417/417** (with the Storage stub; without it the 12 Storage policy checks are reported as `skip`) in a FRESH throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 7 NEXUS migrations. The engine file's expectations changed with D-022: 22 keys, 35 enabled + 1 retired default rule, 36 seed log rows + the D30 retirement, P-STAFF-LOG and P-OPS-BPH handle but no longer approve, `borrowing.approve` has one holder in the fixtures (warning `single_holder`), restore re-enables 35 and never D30 (+3 tests). Idempotence: M4-M7 applied a second time on the same database; a `pg_dump` of schema `nexus` (DDL + all data) plus counts of rules, log rows, keys, policies, buckets, functions and tables was identical before and after. Fault checks: item lock removed -> 1 failure (the lock test); L6 guard removed -> 6 failures. A two-session run (outside pgTAP) showed a second head's overlapping approval waiting on the item lock until the first committed, then refused with `insufficient_stock`.

Earlier status: `nexus_access_control.test.sql` **244/244** and `nexus_member_data.test.sql` **198/198 passed on 2026-11-06** (after the security-review follow-up: A-MD8 option b, invalid_unit, raw search cap, one period read) in a FRESH throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 4 NEXUS migrations; 20261106200000 was applied twice (second run: no change). Fault checks: export gated by view or LIKE escaping removed -> 8 failures; tie-break switched back to option (a) -> 4 failures. Guards checked by hand: W1 (stops at line 32) and the dev-stack guard (an `@nexus.test` account stops both files) write nothing. Earlier run of the member-data file before the follow-up: 188/188. After both runs: 0 test members, 0 export-log rows, 33 rules, 33 log rows, no `nexus_test` schema.

Earlier status of the engine file: **244/244 passed on 2026-11-06** (adds 19 D-015 tests: 6 structural in section 1, 13 persona tests in section 7) in a throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 3 NEXUS migrations. Expected total: 244 (the file uses `no_plan()`; update this number when adding tests). The W1 guard was checked by hand the same day: without the setting the run stops at line 37 with "local throwaway database only" and writes nothing. After the run: 0 test members left, 31 rules, 31 log rows, no `nexus_test` schema, no decoy function left (rollback confirmed). Earlier versions: 225/225 on 2026-11-06 (before D-015), 178/178 on 2026-11-05.

## Persona map (spec section 9, with forced deviations)
Letters file: personas 1-18 as in the engine file (P-OLD = 14 is Sekretaris Jenderal of the OLD period only) plus P-SEKUM1 (19, Sekretaris Umum 1: the second BPH secretary) and P-PLAIN2 (20, a second plain member). P-OPS-BPH (13) is Sekretaris Umum 2 + Staff Logistik (the R10 / LT-33 case). During the period-switch section P-SEKDEP (6) becomes Sekretaris Jenderal of the NEW period.
Inventory file adds P-KADIV-LOG (19, Kepala Divisi in Logistik), P-KADIV-AKO (20, Kepala Divisi in Akomodasi) and P-SEKDEP-OPS (21, Sekretaris Departemen in Departemen Operasional); P-OLD (14) also holds Staff in Logistik in the OLD period. During the period-switch section, P-SEKDEP (6) becomes Kepala Departemen Operasional and P-STAFF-PUB (10) Staff in Logistik of the NEW period.

Member-data file adds P-KABIRO (19, Kepala Biro in Biro Kewirausahaan) and P-MULTI (20, Sekretaris Departemen in Departemen CMIT + Staff in Musik: the MD-16 case, because Departemen Internal's secretary seat is held by P-SEKDEP, and the "filter matches a non-primary assignment" case). PI-CORE allows one holder per unique position, unit, and period, so: P-BEND = Bendahara Umum 1; P-BEND-SEK = Bendahara Umum 2 + Sekretaris Departemen of Departemen **Talenta**; P-ADMIN-BEND = P-BEND promoted to `admin` mid-test; P-SEKDEP2 = secretary of Pelayanan Khusus + Biro Kewirausahaan. P-TEMPPW (auth-login spec) = P-PLAIN with `must_change_password = true` (section 7). PI-CORE's column default is `true`, so section 7 first sets every persona to `false`.

Minutes file: personas as in the engine file plus P-SEKUM1 (19), P-KADEP-INT (21, Kepala Departemen of Departemen Internal: same unit as P-SEKDEP, D37), P-KABIRO (22, Kepala Biro Kewirausahaan, D37) and P-KADIV (23, Kepala Divisi Logistik: nothing). P-KADEP-OPS (7) also reads Departemen Operasional through D37; P-INACTIVE (15) is Kepala Departemen Eksternal, deactivated. During the period switch P-PLAIN (11) becomes Sekretaris Departemen Internal and P-SEKDEP (6) Sekretaris Departemen Eksternal of the NEW period (MN-08, MN-23).
Finance file: personas as in the engine file plus P-SEKUM1 (19) and P-KADIV (20). P-OLD (14) is Bendahara Umum 1 of the OLD period 2090/2091, which is active first so he keeps its books (the FN-10 example: 1.000.000 + 500.000 - 200.000 = 1.300.000); P-INACTIVE (15) is Sekretaris Umum 2, deactivated. During the period switch P-PLAIN (11) becomes Bendahara Umum 1 of the NEW period (AC-39).

## Checklist per table / policy

### `nexus.permissions`, `nexus.permission_scopes` (policy `*_select`: any active member)
| Who | Expected | Test |
|---|---|---|
| Active member (any) | reads all rows | implicit (P-ADMIN etc.) |
| P-INACTIVE, P-UNLINKED | 0 rows | AC-50 (P-UNLINKED) |
| anon | no schema usage, no privilege; calling `nexus.has_permission` fails | structure tests |
| service_role | SELECT only; no INSERT/UPDATE/DELETE/TRUNCATE | W2 structure tests |
| anyone (incl. admin) | cannot insert/update/delete | no grants (structure test) |
| Future migration | cannot mark a sensitive/power key `allow_baseline` (check constraint `permissions_l12_baseline`) | L12 catalog tests |

### `nexus.access_rules` (policy `access_rules_select`: System Admin only)
| Who | Expected | Test |
|---|---|---|
| P-ADMIN, P-SUPER | read all rules; change only via RPCs | AC-02 |
| P-KETUM (BPH), P-PLAIN | 0 rows; RPCs raise 42501 | AC-01, AC-29, AC-60 |
| Demoted admin | 0 rows on next request | AC-05 |
| Admin writing the table directly | permission denied | L11 test |
| Admin adding a locked key (14 keys) to "every active member" | rejected, hint `baseline_not_allowed` | L12 (RPC) |
| Admin adding a locked key to a role/position/unit without a note (or blank note) | rejected, hint `note_required` | L12 |
| Same with a note | saved; note stored trimmed in rule and log | L12 |
| Admin re-enabling a locked-key rule / restoring defaults without a note | rejected, hint `note_required` | L12 |
| Owner / SQL editor | delete and content edits blocked by trigger; locked key to every member, or locked key without note, blocked by trigger; enable/disable allowed but logged (actor null) | L5, A-n8, R10, L12 (direct insert) |

### `nexus.access_rule_log` (policy `access_rule_log_select`: System Admin or `access_rules.view_log`)
| Who | Expected | Test |
|---|---|---|
| P-ADMIN | reads all | L3 |
| P-KETUM (via D14) | reads all, cannot change rules | AC-60 |
| P-PLAIN, P-UNLINKED, deactivated P-KETUM | 0 rows | AC-29, AC-50, AC-44 |
| Anyone incl. owner (with triggers on) | update/delete/truncate raise | AC-59, L11 |
| Owner who disables triggers | CAN change it (not testable as a "deny"; see `../README.md` section 6 for the off-database copy) | none |

### `nexus.member_data_export_logs` (NO policy, NO client grant: read only through `member_data_export_log_list()`)
| Who | Expected | Test |
|---|---|---|
| Any client role (P-ADMIN, P-KETUM, ...) reading the table directly | permission denied | MD-34 |
| Any client role inserting, updating, deleting | permission denied (no grant) | MD-33 |
| service_role | SELECT only; insert/update denied | W2, MD-33 |
| Owner / SQL editor | update, delete, truncate refused by the append-only trigger; a hand-written insert refused (`export_log_direct_insert`) | MD-33 |
| `member_data_export()` by a holder of `member_data.export` | exactly one row: exporter from the session, format, unit filter, status, search yes/no, active period | MD-31 |
| Refused or failing export (no right, bad format/status/search, log insert fails) | no row, no data returned | MD-02, MD-31, MD-35 |
| Exporter deactivated later | rows and name stay | MD-36 |
| Owner who disables triggers | CAN change it (tamper-evident only; see `../README.md` section 6) | none |

### Member Data functions (default rules D12, D13, D32, D33)
[list, unit options, count, export, export-log read]:
| Persona | Expected | Test |
|---|---|---|
| P-KETUM, P-SEKJEN, P-BEND, P-BEND-SEK, P-OPS-BPH, P-ADMIN-BEND | all five | MD-01, MD-04, R17 |
| P-KADEP-OPS, P-KABIRO | list, options, count; export and log refused (42501) | MD-02, AC-70 |
| P-ADMIN, P-SUPER | only the log | MD-03, MD-34 |
| P-SEKDEP, P-SEKDEP2, P-STAFF-LOG, P-STAFF-PUB, P-MULTI, P-PLAIN, P-LECT, P-OLD | nothing (42501) | MD-05 |
| P-INACTIVE, P-UNLINKED, no JWT subject, anon | nothing | MD-06, L1 |
| D32 disabled | department heads lose it at once, BPH keep it; re-enabled gives it back | MD-08 |
| Unit rule with view + export (MD-11) | list + export work, log still refused, output columns unchanged | MD-11 |
| Period switch / no active period | rights and displayed assignments follow the active period; none = nobody | MD-07, R13 |
| `member_data.view_export_log` / `member_data.export` to "every active member" | rejected (RPC and direct insert) | MD-09, L12 |
| Output columns | exact whitelist (export: plus trailing `total_count`, 20261109100000); no function argument, column or body mentions email, phone, nim, nip, user_id, access_level, must_change_password, deactivated_at | MD-10, MD-41 |

### Inventory and Borrowing tables (D-022). Every table: RLS on, SELECT-only policy, no client INSERT/UPDATE/DELETE grant, no delete or truncate (trigger), writes only through the SECURITY DEFINER functions
| Table (policy) | Who reads | Who must get nothing | Writes | Test |
|---|---|---|---|---|
| `inventory_categories`, `inventory_locations` (`*_select`: `inventory.view`) | every active member (filters) | P-INACTIVE, P-UNLINKED, anon | `inventory.manage` via functions; never deleted (IB-10) | IB-10, IB-01 |
| `inventory_items` (`inventory_items_select`: view AND (active OR manage)) | members: active items; managers: also archived | members never see archived (A-IB5); P-INACTIVE nothing | manage via functions; mode and code immutable (trigger) | IB-07..IB-09, IB-12, A-IB5 |
| `inventory_units` (`inventory_units_select`: view AND (active unit of active item OR manage)) | members: active units; managers: archived and lost too | as above | manage; lost = status, code kept | IB-07, IB-30, A-IB45 |
| `inventory_stock` (`inventory_stock_select`: parent item visible) | as items | as items | manage; reasoned dialogs (P6) | IB-07, P6, R18 |
| `inventory_item_history` (`..._select`: manage OR view_all) | Operations, BPH | P-PLAIN, P-STAFF-PUB, P-ADMIN, P-INACTIVE | append-only, functions only | A-IB6, IB-41, IB-48 |
| `borrowing_requests` (`..._select`: requester OR view_all) | the requester (L9), BPH, Operations | other members, P-ADMIN without position (B18), P-OLD, P-INACTIVE | state machine functions only; L6 for approve/reject/extend | IB-14..IB-22, IB-48 |
| `borrowing_request_lines`, `borrowing_return_batches`, `borrowing_extensions`, `borrowing_status_history`, `borrowing_line_returns`, `borrowing_line_units`, `borrowing_return_reversals`, `borrowing_evidence_photos` (`*_select`: parent request visible) | same as the request | same as the request | functions only; all except lines/line units append-only | IB-15, IB-25, IB-41, IB-48 |
| `inventory_borrowing_export_logs` (NO policy, NO client grant) | nobody through the API (database only until the log screen) | every client role | export functions only (writer check) | IB-44 |
| `retired_default_rules` (`..._select`: System Admin) | System Admin | everyone else | migrations only, append-only | D-022 |

### Inventory and Borrowing functions (default rules D01, D09-D11, D28, D29, D31, D34-D36)
| Persona | Catalog read | Catalog write | Own requests (L9) | Queue / all requests | Approve, reject, extend | Handover, return, cancel approved, correct, outside party | Exports | Test |
|---|---|---|---|---|---|---|---|---|
| P-KADEP-OPS, P-KADIV-LOG, P-KADIV-AKO | yes | yes | yes | yes | yes, never own (L6) | yes (own too) | both | IB-20, IB-22, AC-73 |
| P-STAFF-LOG, Staff Akomodasi, P-SEKDEP-OPS, P-OPS-BPH | yes | yes | yes | yes | no | yes (own too, AC-75) | both | IB-02, IB-20, IB-26, AC-74 |
| P-KETUM, P-SEKJEN | yes | no | yes | view only | no | no | both | IB-04 |
| P-PLAIN, P-STAFF-PUB, P-LECT, P-ADMIN, P-OLD | yes | no | yes | no | no | no | no | IB-01, IB-05, IB-15, IB-38 |
| P-INACTIVE, P-UNLINKED, no subject, anon | no | no | no | no | no | no | no | IB-03 |

Fixes 2026-11-08 (section 15): `borrowing_request_detail_by_ref` follows the same rows as `borrowing_request_detail` (requester or `borrowing.view_all`; P-STAFF-PUB and P-ADMIN get `request_not_found` for r1, P-INACTIVE/P-UNLINKED `not_active_member`, anon 42501). `inventory_export` returns exactly the `inventory_item_list` rows of the same caller (managers: archived and lost units; P-KETUM: active only). The borrowing period filter works only with `borrowing.view_all` (P-STAFF-PUB refused) and is logged as `filters.period_id`. `borrowing_period_list()`: view_all holders (P-STAFF-LOG, P-KETUM) get every period newest first; P-PLAIN gets the queue's `permission_required`, as do P-INACTIVE and P-UNLINKED; anon 42501.

Fixes 2026-11-09 (section 16, migration 20261109100000): `inventory_export` and `borrowing_export` (and `member_data_export`, member-data file) keep their callers exactly: managers and P-KETUM export (rows unchanged, plus `total_count` = rows returned on every row), P-PLAIN and P-STAFF-PUB get `permission_required`, anon 42501; EXECUTE stays `authenticated` only (not PUBLIC, anon, service_role); a failing log insert still returns no rows (no log row, no data).

### Storage bucket `nexus-borrowing-evidence` (private; policies on `storage.objects`)
| Action | Allowed | Must be refused | Test |
|---|---|---|---|
| Upload (INSERT policy) | `borrowing.handle` holder, into `<id of a Dipinjam request>/<uuid>.<jpg|jpeg|png|webp>` | the requester, other members, a request not Dipinjam, bad names/types, other buckets, anon | Storage section |
| Read / signed URL (SELECT policy) | `borrowing.view_all` holders; the requester for photos attached to a saved return | other members (they see only their own request's photos), anon, unattached uploads for the requester | Storage section, A-IB31 |
| Update / delete | nobody (no policy) | every client | IB-32 |
| Flood guard | upload refused once 10 files created in the last 24 hours wait unattached in one request folder; older abandoned uploads no longer count (20261109100000) | (review L6); a 23 h old file still counts | Storage section ("Fix 1") |
| Migration guard (M7) | creates the bucket only if missing; identical bucket = no-op | an existing bucket that is public or has other size/types (`bucket_conflict`); any storage.objects policy without `bucket_id` (`storage_policy_unscoped`) | Storage section |
| Stub guard | loads only where every account/member is `@example.test` | the NEXUS dev stack (`@nexus.test`), real data | test 2 |

### Owner caps and limits (2026-11-07)
| Rule | Refused with | Test |
|---|---|---|
| More than 5 requests waiting (submitted) per requester of record | `too_many_open_requests` | caps section |
| More than 20 new requests per requester per Jakarta day | `daily_request_limit` | caps section |
| End later than start + 365 days, on create or extension (from the ORIGINAL start; also a table constraint) | `date_range_too_long` (constraint: 23514) | sections 4, 5 |
| Infinity or a date before 2000 | `invalid_dates` | section 4, 5 |
| More than 50 lines (create, approve, hand over), 200 unit ids per line | `too_many_lines`, `too_many_units` | sections 4, 6, 8 |
| A second return correction | `already_corrected` (detail: `can_correct_return` false) | sections 7, 15 |
| A correction after the unit, the stock or a counted "lost" changed since the return | `correction_conflict` | sections 7, 15 |
| A damaged/lost return whose good stock no longer covers the loan (hand-edited stock) | `stock_mismatch` | section 15 |
| Detail by reference: malformed / unknown or not visible | `invalid_input` / `request_not_found` (identical for both) | section 15 |
| Borrowing period filter with an unknown period id; without `borrowing.view_all` | `invalid_period`; `permission_required` | section 15 |
| Restore a lost unit without `inventory.manage`, or of an archived item | `permission_required`, `item_archived` | section 3 |

### Letters tables (D-025). Every table: RLS on, SELECT-only policy, no client INSERT/UPDATE/DELETE grant, no delete or truncate (trigger), writes only through the SECURITY DEFINER functions
| Table (policy) | Who reads | Who must get nothing | Writes | Test |
|---|---|---|---|---|
| `letters` (`letters_select`: `letters.view`) | BPH (D06), secretaries | members, department secretaries (A-LT14), P-ADMIN (B18), P-OLD, requesters (L9: never the register), P-INACTIVE, P-UNLINKED | `letters.manage` (register, edit, file, void) or `letter_requests.process` (take number, issue, reject) via functions; number, type, year, period, origin immutable; voided = read-only (trigger) | sections 4, 6, 7, 16, 17 |
| `letter_history` (parent letter visible) | as `letters` | as `letters` | append-only | sections 6, 7, 17 |
| `letter_requests` (`..._select`: requester or `letter_requests.view_all`) | the requester (L9), BPH (D08), secretaries | other members, P-SEKDEP, P-ADMIN, P-INACTIVE | state machine functions only; L6 for process/take number/issue/reject; fields immutable, status moves checked by trigger | sections 10-13, 16, 17 |
| `letter_request_history` (parent request visible) | as the request | as the request | append-only | sections 10, 16 |
| `letter_files` (parent visible; withdrawn letter files only for `letters.manage`) | as the parent | viewers for withdrawn files; members for letter files | functions only; only the withdraw columns change, once | sections 5, 16, 17 |
| `letter_numbering_settings`, `letter_number_counters`, `letter_numbering_changes` (System Admin or `letters.manage`) | System Admin, secretaries | BPH without manage, members, P-INACTIVE | System Admin via functions (settings, next number); the year can never be switched off (CHECK, `year_required`); counters by assignments; counters only go up; changes append-only | sections 1, 3, 9, 16 |
| `letter_export_logs` (NO policy, NO client grant) | nobody through the API | every client role | `letter_export()` only (writer check), append-only | section 15 |

### Letters functions (default rules D06-D08, D15-D23)
| Persona | Register read | Register write, void | Own requests (L9) | All requests | Process, Ambil nomor, Terbitkan, Tolak | Export | Numbering settings | Test |
|---|---|---|---|---|---|---|---|---|
| P-SEKJEN, P-SEKUM1, P-OPS-BPH | yes | yes | yes | yes | yes, never own (L6, also with an extra rule) | yes | read | LT-01, LT-11, LT-33 |
| P-KETUM, P-BEND, P-BEND-SEK | yes | no | yes | view only | no | yes | no | LT-02 |
| P-SEKDEP, P-SEKDEP2, P-PLAIN, P-STAFF-PUB, P-LECT, P-ADMIN, P-OLD | no | no | yes | no | no | no | P-ADMIN: read and change (L3) | LT-03, LT-04, LT-41 |
| P-INACTIVE, P-UNLINKED, no subject, anon | no | no | no | no | no | no | no | LT-04 |

### Storage bucket `nexus-letter-files` (private; policies on `storage.objects`)
| Action | Allowed | Must be refused | Test |
|---|---|---|---|
| Upload (INSERT policy) | any active member, into `<own members.id>/<uuid>.<pdf|jpg|jpeg|png>`, while a period is active | another member's folder, bad names/types, other buckets, anon, no active period, P-INACTIVE | section 18 |
| Read / signed URL (SELECT policy) | request attachments: requester and `view_all`; letter files: `letters.view`; letter made from a request: also `view_all`, and the requester while Diterbitkan and Aktif; withdrawn: `letters.manage` only | other members; the requester after a void (G5); viewers for withdrawn files; unattached uploads (everyone, also the uploader); anon | sections 11, 18 |
| Update / delete | nobody (no policy) | every client | section 18 |
| Upload cap | refused once 10 unattached files of the last 24 hours wait in the member's folder (A-LT13) | older uploads do not count; a 23 h old one does | section 18 |
| Migration guard (M11) | creates the bucket only if missing; identical bucket = no-op; same types in another order accepted | public bucket, other size, other types (`bucket_conflict`); any unscoped policy (`storage_policy_unscoped`) | section 18 |

### Letters limits and refusals (spec L10, A-LT18, R2-R5, L7)
| Rule | Refused with | Test |
|---|---|---|
| More than 5 open (Diajukan or Diproses) requests per member; more than 10 new per Jakarta day | `too_many_open_requests`, `daily_request_limit` | section 13 |
| Field limits (Perihal 200, counterpart 150, sender number 60, notes 500, Keperluan 1000, Atas nama 120, Nomor lama 60) | `text_too_long` (detail = field) | sections 4, 8, 10 |
| A date in the future (letter, received), before 2000, a needed-by date before today | `date_in_future`, `invalid_dates`, `date_in_past` | sections 4, 10 |
| A 4th visible file, a foreign upload, a wrong type or size, a file attached twice | `file_count`, `invalid_file`, `file_too_large`, `file_already_attached`, `file_missing` | section 5 |
| A typed number that exists for the type (any case) | `duplicate_number` | section 8 |
| Next number not higher than the last used, another year, no reason | `sequence_not_higher`, `year_not_current`, `reason_required` | section 9 |
| A format whose next number already exists; bad characters, equal codes, digits, separator | `format_collision`, `invalid_number_format` | section 9 |
| Edit, file or void of a voided letter, of a previous period's letter, or while the request is Diproses | `letter_voided`, `closed_period`, `request_open` | sections 7, 11, 19 |
| Terbitkan without "Ambil nomor"; a second "Ambil nomor" | `number_not_taken`, `state_changed` | section 11 |
| Withdrawing the only file of an issued request letter | `last_issued_file` | section 11 |

### Meeting Minutes tables (D-027). Every table: RLS on, SELECT-only policy, no client INSERT/UPDATE/DELETE grant, no delete or truncate (trigger), writes only through the SECURITY DEFINER functions
| Table (policy) | Who reads | Who must get nothing | Writes | Test |
|---|---|---|---|---|
| `minutes` (`minutes_select`: `minutes.view` scope all, or the row's unit in the caller's view units) | BPH all (D04), BPH secretaries all, department/bureau secretaries own unit (D26), Kepala Departemen / Kepala Biro own unit (D37); "Seluruh organisasi" minutes: scope all only (N2 c) | other units' secretaries and heads, Kepala Divisi, staff, members, P-ADMIN (B18), P-OLD, P-INACTIVE, P-UNLINKED, anon | `minutes.manage` in the unit's scope via functions; unit, period, creator immutable; voided = read-only, never restored (trigger) | sections 4, 5, 6, 8, 11, 14 |
| `minute_files` (parent visible; withdrawn files only for `minutes.manage` of that unit) | as `minutes` | readers (heads, BPH viewers) for withdrawn files | functions only; only the withdraw columns change, once | sections 7, 11, 12 |
| `minute_history` (parent visible; `file_withdrawn` rows only for managers of the unit) | as `minutes` | as `minutes`; readers for withdraw rows | append-only | sections 6-8, 11, 12 |
| `minute_export_logs` (NO policy, NO client grant) | nobody through the API | every client role | `minute_export()` only (writer check), append-only, no PII | section 10 |

### Meeting Minutes functions (default rules D04, D05, D17, D20, D23, D26, D27, D37)
| Persona | Read | Record, edit, void, files | Export | Test |
|---|---|---|---|---|
| P-SEKJEN, P-SEKUM1 | all units | all recordable units (root, BPH, departments, bureau; never a division, inactive or unknown unit) | all | MN-01 |
| P-KETUM, P-BEND | all | no | all | MN-04 |
| P-BEND-SEK (BPH + Sekretaris Departemen Talenta) | all | Talenta only | all | R7 |
| P-SEKDEP, P-SEKDEP2 | own unit(s) | own unit(s) | own unit(s) | MN-02, MN-03, MN-07 |
| Kepala Departemen, Kepala Biro (D37) | own unit; nothing with D37 disabled | no | no | MN-05 |
| P-ADMIN, P-SUPER, P-PLAIN, P-STAFF-*, P-LECT, Kepala Divisi, P-OLD, P-INACTIVE, P-UNLINKED, no subject, anon | no | no | no | MN-06 |
| Anyone, after a period switch | old minutes read-only (`closed_period`); a new secretary of the unit reads its earlier minutes; a moved secretary loses the old unit | | | MN-08, MN-12, MN-23 |

### Storage bucket `nexus-minute-files` (private; policies on `storage.objects`)
| Action | Allowed | Must be refused | Test |
|---|---|---|---|
| Upload (INSERT policy) | a `minutes.manage` holder (any scope), into `<own members.id>/<uuid>.<pdf|jpg|jpeg|png>`, while a period is active | readers (heads, BPH viewers), members, another member's folder, bad names/types, no active period, anon | section 13 |
| Read / signed URL (SELECT policy) | whoever may read the parent minute; withdrawn files only managers of that unit | other units, members, unattached uploads, anon | section 13 |
| Update / delete | nobody (no policy) | every client | section 13 |
| Upload cap / migration guard | 10 unattached per 24 h; identical bucket = no-op | an 11th upload; a public bucket (`bucket_conflict`) | section 13 |

### Finance tables (D-028; SENSITIVE). Every table: RLS on, SELECT-only policy, no client INSERT/UPDATE/DELETE grant, no delete or truncate (trigger), writes only through the SECURITY DEFINER functions
| Table (policy) | Who reads | Who must get nothing (zero rows, tested per persona) | Writes | Test |
|---|---|---|---|---|
| `finance_entries` (`finance_entries_select`: `finance.view`) | all six BPH positions (D02), Treasurers (D24 includes view); every period (L8) | P-ADMIN, P-SUPER (B18), P-SEKDEP, P-KADEP-OPS, Kepala Divisi, staff, members, P-LECT, P-OLD (also his own old period), P-INACTIVE, P-UNLINKED, no subject, anon, everyone while no period is active | `finance.manage` via functions; NOTHING changes after saving except the void columns, once (trigger, also for the owner); amount CHECK 1..9 999 999 999 bigint; one Aktif Saldo awal per period (unique index) | sections 2, 5-8, 13, 15 |
| `finance_entry_files` (`finance.view`; withdrawn proofs only `finance.manage`) | as entries | as entries; viewers for withdrawn proofs | functions only; only the withdraw columns change, once | sections 9, 13 |
| `finance_entry_history` (`finance.view`; `file_withdrawn` rows only `finance.manage`) | as entries | as entries; viewers for withdraw rows | append-only | sections 5, 6, 9, 13 |
| `finance_counter` (`finance.manage` only) | Treasurers | viewers (BPH), everyone else | inside `finance_entry_record` under a row lock; never goes back, never deleted (trigger) | sections 8, 13 |
| `finance_export_logs` (NO policy, NO client grant) | nobody through the API (not even the Treasurer, A-FN15) | every client role | `finance_export()` only (writer check), append-only, no PII, no amounts, no search text | section 11 |

### Finance functions (default rules D02, D03, D24, D25; no unit scope)
| Persona | Read, summary, Dashboard card | Record, void, proof | Export | Test |
|---|---|---|---|---|
| P-BEND, P-BEND-SEK (Bendahara Umum 1/2) | yes | yes, active period only; either may void the other's entry (K6 a) | yes | FN-01 |
| P-KETUM, P-SEKJEN, P-SEKUM1 | yes | no (direct calls refused) | yes | FN-02 |
| P-ADMIN-BEND (P-BEND promoted to admin) | yes (through the position) | yes | yes | FN-06, AC-68 |
| Everyone else, incl. P-ADMIN, P-SUPER, P-OLD, P-INACTIVE, P-UNLINKED | no | no | no | FN-03, FN-04 |
| D24 disabled / D02 disabled | Treasurer keeps view through D02 / BPH loses view AND export (R15) | refused at once | | FN-06 |

### Finance money and ledger rules
| Rule | Refused with | Test |
|---|---|---|
| Amount not digits-only 1..9 999 999 999 ("12.5", "1e3", "-5", "+5", "0", "007", blanks, separators, letters, non-ASCII digits); more than 10 digits | `invalid_amount`, `amount_too_large` (function); CHECK 23514 (direct insert of 0, negative, too large) | sections 5, 8 |
| No float/numeric/money column or function argument/result anywhere in the module; 10,000 x Rp 1 = Rp 10.000 and 1000 x Rp 9.999.999.999 exact | structure | sections 1, 12 |
| Any change of a saved entry, un-void, a second void reason, counter going back, a renamed proof | `immutable_column` | section 8 |
| Second Aktif Saldo awal; correction link to a voided/unknown entry or on an opening | `opening_exists` (and unique index 23505 by hand), `invalid_correction` | sections 5, 7, 8 |
| Same submit key with other values; a repeat with the same values returns the first entry | `idempotency_conflict`; `replayed = true` | section 5 |
| Void, proof or withdraw on an old-period entry; proof on a voided entry; second void | `closed_period`, `entry_voided`, `state_changed` | sections 6, 7, 15 |
| Export over 1000 rows (before any log row) | `too_many_rows` | section 11 |

### Storage bucket `nexus-finance-proofs` (private; policies on `storage.objects`)
| Action | Allowed | Must be refused | Test |
|---|---|---|---|
| Upload (INSERT policy) | a `finance.manage` holder, into `<own members.id>/<uuid>.<pdf|jpg|jpeg|png>`, while a period is active | BPH viewers, members, another member's folder, bad names/types, no active period, anon | section 14 |
| Read / signed URL (SELECT policy) | `finance.view`; withdrawn proofs only `finance.manage` | members, P-SEKDEP, P-OLD, P-INACTIVE, unattached uploads (also the uploader), anon | section 14 |
| Update / delete | nobody (no policy) | every client | section 14 |
| Upload cap / migration guard | 10 unattached per 24 h; identical bucket = no-op | an 11th upload; a public bucket (`bucket_conflict`) | section 14 |

### Functions
| Check | Test |
|---|---|
| anon cannot execute any `nexus` function; `authenticated` cannot execute `nexus._*` internals | structure tests |
| service_role cannot execute any `nexus` function | W2 structure test |
| Every SECURITY DEFINER function has `search_path = ''` | D-010 test |
| `current_member_id()` and `is_system_admin()` are SECURITY DEFINER and still return nothing for P-INACTIVE | hardening tests |
| `list_positions()` / `list_org_units()` return nothing for inactive/unlinked users | L1 picker tests |
| No function takes/returns email, phone, nim, nip, must_change_password; no body mentions email, phone, nim, nip, `audit_log`, `org_settings`, `grants_admin`, or `private.` | AC-47, AC-49, AC-56 |
| `must_change_password` appears in exactly one function body, `nexus.my_password_change_pending()` (full signature); a decoy overload with a member id and a decoy with another name both make the check fail | L4 / D-015 whitelist |
| `my_password_change_pending()`: no arguments, returns one scalar boolean, SECURITY INVOKER, empty `search_path`; EXECUTE for `authenticated` only (no PUBLIC, anon, service_role) | D-015 structure |

### `nexus.my_password_change_pending()` (D-015, no table; reads PI-CORE `members` under PI-CORE RLS)
| Who | Expected | Test |
|---|---|---|
| P-TEMPPW (active, flag true) | `true`; `my_context()` still returns a row (app-level gate only, documented limit) | AUTH-19, AUTH-23 |
| Active member, flag false (P-SEKJEN) | `false` | D-015 |
| PI-CORE admin (P-SUPER, can SELECT every member row) | only their OWN flag, never another member's | AUTH-22 |
| P-INACTIVE / member deactivated mid-term, flag true | `false` (own row hidden by PI-CORE RLS; No access decides via `my_context()`) | D-015 |
| P-UNLINKED | `false` (never null) | D-015 |
| `authenticated` without `auth.uid()` | `false` | D-015 |
| anon, service_role | permission denied (42501) | D-015 |
| Flag flips in PI-CORE (changed / new temporary password) | next call in the same session shows the new value, for that caller only | AUTH-21, EC7 |

## AC coverage
**Automated (pgTAP):** AC-01, 02, 03, 04, 05, 06, 07, 08 (rights only), 09 (rights), 10, 11, 12, 13 (via 52/53), 14 (rights), 16, 17, 18, 19 (rights), 20, 21, 22, 23, 24, 25 (via 53), 26, 28, 29, 32, 33, 35, 36, 38, 39, 40 (analogue), 43, 44, 46, 47 (structural), 49 (structural), 50, 52, 53, 54, 55 (with `minutes.view`; a `finance.view` baseline rule is impossible since L12), 56 (structural), 57 (via a `bph` role rule; a baseline approve rule is impossible since L12), 59, 60, 61, 62, 63 (API side), 64, 65, 66, 67, 68, 69; plus R1, R10, R11, R15, B28, L5, L6, L11, **L12**; auth-login AUTH-19 (DB side), AUTH-21 (DB side), AUTH-22, AUTH-23 (documents the limit), EC7 (DB side).

**Member Data (`nexus_member_data.test.sql`):** MD-01 to MD-12, MD-15 to MD-27, MD-29 (rows; not file formats), MD-31 to MD-36 (DB side), MD-38, MD-39 (DB side), MD-41; AC-70, AC-71; R1-R3, R5-R13, R15-R17, R21, R22. App/manual: MD-13, MD-14, MD-28 (screens), MD-29 file contents, MD-30, MD-37, MD-40.

**Inventory and Borrowing (`nexus_inventory_borrowing.test.sql`):** IB-01 to IB-30, IB-32 to IB-41 (DB side), IB-42, IB-43 (rows; not file formats), IB-44, IB-45 (DB side), IB-46 (DB side), IB-48; AC-22, AC-24, AC-27, AC-30, AC-36, AC-42, AC-43, AC-57, AC-64, AC-72 to AC-77 for borrowing; L6, L7, L9, R3-R6, R8-R11, R18-R20, A-IB5, A-IB6, A-IB8, A-IB14, A-IB15, A-IB26..A-IB31, A-IB34, A-IB45, A-IB46, P2, P6. App/manual: IB-31 and IB-46 screens, IB-47 (layout), IB-29 browser resize, IB-43 file contents, signed-URL expiry.

**Letters (`nexus_letters.test.sql`):** LT-01 to LT-41 (DB side; LT-15 also by the two-session check above), LT-43 to LT-45, LT-47, LT-48, LT-50 to LT-52; letter-request parts of AC-27/30, AC-57, AC-64 (single holder); L6, L7, L9, R2-R8, R10, R11, R13, R15, R17, R19, R20; A-LT1, A-LT6..A-LT14, A-LT18..A-LT21, A-LT23, A-LT24; G3-G6, G9, G11, G12, P15. App/manual: LT-42, LT-46, LT-49 (screens), LT-38 file contents and WIB header (A-LT16), signed-URL expiry, the browser image resize and the magic-byte check before upload.

**Meeting Minutes (`nexus_minutes.test.sql`):** MN-01 to MN-15, MN-16 (DB side: stored verbatim), MN-17 to MN-20 (DB side; the magic-byte check and resize are app-level), MN-21 to MN-28, MN-30; N1 b (D37), N2 c (incl. "Seluruh organisasi" readable by scope all only), N3 a, A-MN2..A-MN8, A-MN13, A-MN15, A-MN18; L5, L7, L8, R11, R15, E9. App/manual: MN-29 (layout, leave prompt), MN-16 screen and export escaping, export file contents and WIB header, signed-URL expiry.

**Finance (`nexus_finance.test.sql`):** FN-01 to FN-11, FN-12 (DB side: Jakarta date), FN-13 to FN-20, FN-21 (the hint is returned, never prefilled), FN-22, FN-23, FN-25 to FN-27 (DB side), FN-28, FN-29 (rows and summary; not file formats), FN-31, FN-32, FN-33 (data side), FN-34 (structural + detail JSON), FN-35, FN-37 (DB side: stored verbatim), FN-38, FN-39 (structural); K1 a to K6 a; AC-03, AC-14, AC-15, AC-39 to AC-41, AC-44, AC-45, AC-58, AC-68 for Finance; L1, L5, L7, L8, L12, R15. App/manual: FN-24 (soft date warning), FN-30 (CSV/Excel formula neutralising), FN-36 (layout), FN-40 (security review), file contents, signed-URL expiry.

**Still open:** AC-37 (assignment removal: same engine, add when convenient).

**Manual / app level:** AUTH-19/20/21 screens and the fail-closed "gangguan" state when the pending check errors (AR10), AC-31 (Dashboard cards), AC-34 (no session redirect; anon is already denied in DB), AC-63 (UI warning text), AC-08/AC-56 export file contents, UI parts of AC-19 and AC-61, the W1 guard (see above).

## Manual check on the hosted project after applying (read-only)
1. As the owner in the SQL editor: `select count(*) from nexus.access_rules;` = 37 and `select count(*) from nexus.access_rule_log where action = 'seed';` = 37 (36 before 20261111100000, 33 before 20261107100000, 31 before 20261106200000).
2. `select key from nexus.permissions where allow_baseline order by key;` = inventory.export, inventory.view, letters.export, letters.view, minutes.export, minutes.view.
3. From the app with a regular member token: `.schema('nexus').rpc('my_permissions')` returns only `inventory.view`.
4. With a regular member token: `.schema('nexus').from('access_rules').select()` returns `[]`.
5. Without a session (anon key only): any `nexus` call fails (permission denied / schema not usable).
6. With a regular member token: `.schema('nexus').rpc('my_password_change_pending')` returns `false` (or `true` right after an admin issued a temporary password); it accepts no arguments.
7. With a regular member token: `.schema('nexus').rpc('member_data_list')` fails with code 42501, hint `permission_required`; with a BPH member token it returns rows whose keys are exactly the whitelisted columns.
8. After M5-M7: `select count(*) from nexus.permissions;` = 22; `select default_code, is_enabled from nexus.access_rules where default_code in ('D30','D34','D35','D36') order by 1;` = D30 false, D34-D36 true; with a regular member token `.schema('nexus').rpc('inventory_item_list')` returns `[]` (the catalog starts empty) and `.rpc('inventory_category_add', {p_name: 'x'})` fails with hint `permission_required`; with a Staff Operasional token `.rpc('my_permissions')` contains `borrowing.handle` but not `borrowing.approve`.
9. Storage (M7): Dashboard > Storage shows `nexus-borrowing-evidence` as private; an anonymous (no session) download of any file in it fails.
10. Dashboard > Project Settings > Data API (or the PostgREST config): the transaction-end setting (`db-tx-end`) is the default `commit`, never `rollback-allowed` (otherwise a client could receive export rows while the export-log row is rolled back; see `../README.md` section 6). Read only; do not change it.
11. After M10/M11: `select count(*) from nexus.letter_numbering_settings;` = 1; with a regular member token `.schema('nexus').rpc('letter_list', {p_type: 'incoming'})` fails with hint `permission_required` and `.rpc('letter_my_requests')` returns `[]`; with a BPH secretary token `.rpc('letter_numbering_settings')` returns the format `PMK/NEX`; Dashboard > Storage shows `nexus-letter-files` as private.
12. After M12-M14: with a regular member token `.schema('nexus').rpc('minute_list')` fails with hint `permission_required`; with the `sekdep@`-like token of a department secretary `.rpc('minute_unit_options')` returns exactly her unit with `can_record = true`; with a Kepala Departemen token it returns his unit with `can_record = false`; Dashboard > Storage shows `nexus-minute-files` as private.
13. After M15/M16 (Finance; sensitive): `select id, last_value from nexus.finance_counter;` = `t | 0` before go-live; with a regular member token AND with the System Admin's token (no BPH position) `.schema('nexus').rpc('finance_summary')` fails with hint `permission_required` and `.from('finance_entries').select()` returns `[]`; with a BPH (non-Treasurer) token `.rpc('finance_entry_record', {...})` fails with `permission_required`; Dashboard > Storage shows `nexus-finance-proofs` as private.
