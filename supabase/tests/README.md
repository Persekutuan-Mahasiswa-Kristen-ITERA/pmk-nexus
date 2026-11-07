# NEXUS database tests

Three pgTAP files: `nexus_access_control.test.sql` (engine, rules, D-015, D-022 amendment), `nexus_member_data.test.sql` (Member Data module, D-019) and `nexus_inventory_borrowing.test.sql` (Inventory and Borrowing, D-022). All work the same way; `nexus_access_control.test.sql` is described first. **Local / throwaway database only.** It inserts test personas into PI-CORE tables (`auth.users`, `public.members`, `public.periods`, `public.assignments`), switches the active period, and creates a helper schema `nexus_test`, all inside one transaction that ends with `ROLLBACK`. Never run it against the hosted project.

## Safety guards (W1, M1, L5)
All three files: (1) the setting below, (2) a data guard that stops if any email is not a fake test address, (3) a dev-stack guard that stops if the NEXUS dev stack's seed accounts (`@nexus.test`) exist, because the files need a FRESH database. All three run before anything is written.

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
   ```
   Any line starting with `not ok` is a failure. (`pg_prove` also works with the same `PGOPTIONS`.)

Assumes a fresh NEXUS install (exactly the 36 default rules D01-D36 with D30 retired, 36 seed log rows + 1 retirement row, empty export logs, an empty catalog, and no members other than the test personas). Sequences (INV-/PJM- numbers) are not rolled back by Postgres; the inventory file therefore checks code format and order, never fixed numbers, and can run repeatedly in the same container.

**Status 2026-11-08 (fixes migration 20261108100000, section 15 of the inventory file):** `nexus_access_control.test.sql` **247/247**, `nexus_member_data.test.sql` **198/198**, `nexus_inventory_borrowing.test.sql` **522/522** (468 + 54: detail by reference, once-only correction button and the hints `already_corrected` / `correction_conflict` / `stock_mismatch`, catalog export = list per caller, borrowing period filter and its period list `borrowing_period_list()`, structure) in a FRESH throwaway `supabase/postgres:17.11.0.003` container WITH the Storage stub, after PI-CORE's 5 migrations and the 8 NEXUS migrations. Fault check: with the four old function bodies loaded inside the test transaction, exactly 7 checks fail (Fix 2 and Fix 3), as expected.

**Status 2026-11-07, review version** (owner caps, date cap, single correction, lost-correction conflict, restore = `inventory.manage`, array caps, upload flood guard, bucket/policy guards, stub refuses @nexus.test, faster request lists): `nexus_access_control.test.sql` **247/247**, `nexus_member_data.test.sql` **198/198**, `nexus_inventory_borrowing.test.sql` **468/468** in a FRESH throwaway container WITH the Storage stub, and the same counts WITHOUT it (then 20 Storage checks report `# SKIP`). Also 247/198/468 on a database that first ran the earlier draft of M5-M7 and then the review version (upgrade path of the dev stack). Idempotence: M4-M7 applied a second time; `pg_dump` of schema `nexus` (DDL + data) plus counts of rules, log rows, policies, buckets, functions, tables and constraints identical (7,867 lines). The inventory output contains ONE expected `ERROR` line: the stub refusing a `@nexus.test` member (test 2). Count results with `grep -c '^ok [0-9]'`.

**Status 2026-11-07 (first version of migrations 20261107100000-100200, D-022):** `nexus_access_control.test.sql` **247/247**, `nexus_member_data.test.sql` **198/198**, `nexus_inventory_borrowing.test.sql` **417/417** (with the Storage stub; without it the 12 Storage policy checks are reported as `skip`) in a FRESH throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 7 NEXUS migrations. The engine file's expectations changed with D-022: 22 keys, 35 enabled + 1 retired default rule, 36 seed log rows + the D30 retirement, P-STAFF-LOG and P-OPS-BPH handle but no longer approve, `borrowing.approve` has one holder in the fixtures (warning `single_holder`), restore re-enables 35 and never D30 (+3 tests). Idempotence: M4-M7 applied a second time on the same database; a `pg_dump` of schema `nexus` (DDL + all data) plus counts of rules, log rows, keys, policies, buckets, functions and tables was identical before and after. Fault checks: item lock removed -> 1 failure (the lock test); L6 guard removed -> 6 failures. A two-session run (outside pgTAP) showed a second head's overlapping approval waiting on the item lock until the first committed, then refused with `insufficient_stock`.

Earlier status: `nexus_access_control.test.sql` **244/244** and `nexus_member_data.test.sql` **198/198 passed on 2026-11-06** (after the security-review follow-up: A-MD8 option b, invalid_unit, raw search cap, one period read) in a FRESH throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 4 NEXUS migrations; 20261106200000 was applied twice (second run: no change). Fault checks: export gated by view or LIKE escaping removed -> 8 failures; tie-break switched back to option (a) -> 4 failures. Guards checked by hand: W1 (stops at line 32) and the dev-stack guard (an `@nexus.test` account stops both files) write nothing. Earlier run of the member-data file before the follow-up: 188/188. After both runs: 0 test members, 0 export-log rows, 33 rules, 33 log rows, no `nexus_test` schema.

Earlier status of the engine file: **244/244 passed on 2026-11-06** (adds 19 D-015 tests: 6 structural in section 1, 13 persona tests in section 7) in a throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 3 NEXUS migrations. Expected total: 244 (the file uses `no_plan()`; update this number when adding tests). The W1 guard was checked by hand the same day: without the setting the run stops at line 37 with "local throwaway database only" and writes nothing. After the run: 0 test members left, 31 rules, 31 log rows, no `nexus_test` schema, no decoy function left (rollback confirmed). Earlier versions: 225/225 on 2026-11-06 (before D-015), 178/178 on 2026-11-05.

## Persona map (spec section 9, with forced deviations)
Inventory file adds P-KADIV-LOG (19, Kepala Divisi in Logistik), P-KADIV-AKO (20, Kepala Divisi in Akomodasi) and P-SEKDEP-OPS (21, Sekretaris Departemen in Departemen Operasional); P-OLD (14) also holds Staff in Logistik in the OLD period. During the period-switch section, P-SEKDEP (6) becomes Kepala Departemen Operasional and P-STAFF-PUB (10) Staff in Logistik of the NEW period.

Member-data file adds P-KABIRO (19, Kepala Biro in Biro Kewirausahaan) and P-MULTI (20, Sekretaris Departemen in Departemen CMIT + Staff in Musik: the MD-16 case, because Departemen Internal's secretary seat is held by P-SEKDEP, and the "filter matches a non-primary assignment" case). PI-CORE allows one holder per unique position, unit, and period, so: P-BEND = Bendahara Umum 1; P-BEND-SEK = Bendahara Umum 2 + Sekretaris Departemen of Departemen **Talenta**; P-ADMIN-BEND = P-BEND promoted to `admin` mid-test; P-SEKDEP2 = secretary of Pelayanan Khusus + Biro Kewirausahaan. P-TEMPPW (auth-login spec) = P-PLAIN with `must_change_password = true` (section 7). PI-CORE's column default is `true`, so section 7 first sets every persona to `false`.

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
| Output columns | exact whitelist; no function argument, column or body mentions email, phone, nim, nip, user_id, access_level, must_change_password, deactivated_at | MD-10, MD-41 |

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

### Storage bucket `nexus-borrowing-evidence` (private; policies on `storage.objects`)
| Action | Allowed | Must be refused | Test |
|---|---|---|---|
| Upload (INSERT policy) | `borrowing.handle` holder, into `<id of a Dipinjam request>/<uuid>.<jpg|jpeg|png|webp>` | the requester, other members, a request not Dipinjam, bad names/types, other buckets, anon | Storage section |
| Read / signed URL (SELECT policy) | `borrowing.view_all` holders; the requester for photos attached to a saved return | other members (they see only their own request's photos), anon, unattached uploads for the requester | Storage section, A-IB31 |
| Update / delete | nobody (no policy) | every client | IB-32 |
| Flood guard | upload refused once 10 files wait unattached in one request folder | (review L6) | Storage section |
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

**Still need module tables (later migrations):** AC-15, 41, 58 (finance/minutes closed-period edits, L7), letter-request parts of AC-27/30, 37 (assignment removal: same engine, add when convenient), 48 (signed URLs for minutes/letters), 51 (no delete on later module tables).

**Manual / app level:** AUTH-19/20/21 screens and the fail-closed "gangguan" state when the pending check errors (AR10), AC-31 (Dashboard cards), AC-34 (no session redirect; anon is already denied in DB), AC-63 (UI warning text), AC-08/AC-56 export file contents, UI parts of AC-19 and AC-61, the W1 guard (see above).

## Manual check on the hosted project after applying (read-only)
1. As the owner in the SQL editor: `select count(*) from nexus.access_rules;` = 36 and `select count(*) from nexus.access_rule_log where action = 'seed';` = 36 (33 before 20261107100000, 31 before 20261106200000).
2. `select key from nexus.permissions where allow_baseline order by key;` = inventory.export, inventory.view, letters.export, letters.view, minutes.export, minutes.view.
3. From the app with a regular member token: `.schema('nexus').rpc('my_permissions')` returns only `inventory.view`.
4. With a regular member token: `.schema('nexus').from('access_rules').select()` returns `[]`.
5. Without a session (anon key only): any `nexus` call fails (permission denied / schema not usable).
6. With a regular member token: `.schema('nexus').rpc('my_password_change_pending')` returns `false` (or `true` right after an admin issued a temporary password); it accepts no arguments.
7. With a regular member token: `.schema('nexus').rpc('member_data_list')` fails with code 42501, hint `permission_required`; with a BPH member token it returns rows whose keys are exactly the whitelisted columns.
8. After M5-M7: `select count(*) from nexus.permissions;` = 22; `select default_code, is_enabled from nexus.access_rules where default_code in ('D30','D34','D35','D36') order by 1;` = D30 false, D34-D36 true; with a regular member token `.schema('nexus').rpc('inventory_item_list')` returns `[]` (the catalog starts empty) and `.rpc('inventory_category_add', {p_name: 'x'})` fails with hint `permission_required`; with a Staff Operasional token `.rpc('my_permissions')` contains `borrowing.handle` but not `borrowing.approve`.
9. Storage (M7): Dashboard > Storage shows `nexus-borrowing-evidence` as private; an anonymous (no session) download of any file in it fails.
10. Dashboard > Project Settings > Data API (or the PostgREST config): the transaction-end setting (`db-tx-end`) is the default `commit`, never `rollback-allowed` (otherwise a client could receive export rows while the export-log row is rolled back; see `../README.md` section 6). Read only; do not change it.
