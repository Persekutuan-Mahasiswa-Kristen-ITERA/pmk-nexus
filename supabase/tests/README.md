# NEXUS database tests

Two pgTAP files: `nexus_access_control.test.sql` (engine, rules, D-015) and `nexus_member_data.test.sql` (Member Data module, D-019). Both work the same way; `nexus_access_control.test.sql` is described first. **Local / throwaway database only.** It inserts test personas into PI-CORE tables (`auth.users`, `public.members`, `public.periods`, `public.assignments`), switches the active period, and creates a helper schema `nexus_test`, all inside one transaction that ends with `ROLLBACK`. Never run it against the hosted project.

## Safety guards (W1, M1, L5)
Both files: (1) the setting below, (2) a data guard that stops if any email is not a fake test address, (3) a dev-stack guard that stops if the NEXUS dev stack's seed accounts (`@nexus.test`) exist, because the files need a FRESH database. All three run before anything is written.

### W1
The file refuses to run unless the session sets `nexus.allow_destructive_tests = 'yes'`. The guard sits right after `BEGIN`, and the file starts with `\set ON_ERROR_STOP on`, so a run without the setting stops at the guard and writes nothing (even a runner that ignored `ON_ERROR_STOP` would only meet an aborted transaction). The guard cannot test itself; check it by hand once: run the file WITHOUT the setting and confirm it stops with "local throwaway database only".

A `-c "set ..."` before `-f` does NOT work: each `-c`/`-f` item is separate and `set` would be undone by the file's own transaction handling. Pass the setting as a connection option instead.

## How to run (local)
1. Use a THROWAWAY `supabase/postgres:17.11.0.003` container (recommended; this is how every recorded run was done): start it on a free port (e.g. 54399), apply PI-CORE's 5 migrations from the PI-CORE repo, then all NEXUS migrations, then `create extension if not exists pgtap with schema extensions`. Do not use the NEXUS dev stack (`pnpm db:start`, port 55432): its seeded test accounts break this file's "fresh install" assumptions. Never use PI-CORE's stack (54322).
2. Apply all NEXUS migrations in file-name order (see `../README.md`).
3. Run each file (separately; each ends with ROLLBACK, so the order does not matter):
   ```bash
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -f supabase/tests/nexus_access_control.test.sql
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -f supabase/tests/nexus_member_data.test.sql
   ```
   Any line starting with `not ok` is a failure. (`pg_prove` also works with the same `PGOPTIONS`.)

Assumes a fresh NEXUS install (exactly the 33 seeded rules D01-D33, 33 seed log rows, an empty export log, and no members other than the test personas).

**Status:** `nexus_access_control.test.sql` **244/244** and `nexus_member_data.test.sql` **198/198 passed on 2026-11-06** (after the security-review follow-up: A-MD8 option b, invalid_unit, raw search cap, one period read) in a FRESH throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 4 NEXUS migrations; 20261106200000 was applied twice (second run: no change). Fault checks: export gated by view or LIKE escaping removed -> 8 failures; tie-break switched back to option (a) -> 4 failures. Guards checked by hand: W1 (stops at line 32) and the dev-stack guard (an `@nexus.test` account stops both files) write nothing. Earlier run of the member-data file before the follow-up: 188/188. After both runs: 0 test members, 0 export-log rows, 33 rules, 33 log rows, no `nexus_test` schema.

Earlier status of the engine file: **244/244 passed on 2026-11-06** (adds 19 D-015 tests: 6 structural in section 1, 13 persona tests in section 7) in a throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 3 NEXUS migrations. Expected total: 244 (the file uses `no_plan()`; update this number when adding tests). The W1 guard was checked by hand the same day: without the setting the run stops at line 37 with "local throwaway database only" and writes nothing. After the run: 0 test members left, 31 rules, 31 log rows, no `nexus_test` schema, no decoy function left (rollback confirmed). Earlier versions: 225/225 on 2026-11-06 (before D-015), 178/178 on 2026-11-05.

## Persona map (spec section 9, with forced deviations)
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

**Need module tables first (later migrations):** AC-15, 41, 42, 58 (closed-period edits, L7), 27 and 30 (own requests, L9), 37 (assignment removal: same engine, add when convenient), 45 (records of deactivated members), 48 (signed URLs), 51 (no delete on module tables).

**Manual / app level:** AUTH-19/20/21 screens and the fail-closed "gangguan" state when the pending check errors (AR10), AC-31 (Dashboard cards), AC-34 (no session redirect; anon is already denied in DB), AC-63 (UI warning text), AC-08/AC-56 export file contents, UI parts of AC-19 and AC-61, the W1 guard (see above).

## Manual check on the hosted project after applying (read-only)
1. As the owner in the SQL editor: `select count(*) from nexus.access_rules;` = 33 and `select count(*) from nexus.access_rule_log where action = 'seed';` = 33 (31 before migration 20261106200000).
2. `select key from nexus.permissions where allow_baseline order by key;` = inventory.export, inventory.view, letters.export, letters.view, minutes.export, minutes.view.
3. From the app with a regular member token: `.schema('nexus').rpc('my_permissions')` returns only `inventory.view`.
4. With a regular member token: `.schema('nexus').from('access_rules').select()` returns `[]`.
5. Without a session (anon key only): any `nexus` call fails (permission denied / schema not usable).
6. With a regular member token: `.schema('nexus').rpc('my_password_change_pending')` returns `false` (or `true` right after an admin issued a temporary password); it accepts no arguments.
7. With a regular member token: `.schema('nexus').rpc('member_data_list')` fails with code 42501, hint `permission_required`; with a BPH member token it returns rows whose keys are exactly the whitelisted columns.
8. Dashboard > Project Settings > Data API (or the PostgREST config): the transaction-end setting (`db-tx-end`) is the default `commit`, never `rollback-allowed` (otherwise a client could receive export rows while the export-log row is rolled back; see `../README.md` section 6). Read only; do not change it.
