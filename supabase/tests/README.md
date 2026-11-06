# NEXUS database tests

`nexus_access_control.test.sql` is a pgTAP file. **Local / throwaway database only.** It inserts test personas into PI-CORE tables (`auth.users`, `public.members`, `public.periods`, `public.assignments`), switches the active period, and creates a helper schema `nexus_test`, all inside one transaction that ends with `ROLLBACK`. Never run it against the hosted project.

## Safety guard (W1)
The file refuses to run unless the session sets `nexus.allow_destructive_tests = 'yes'`. The guard sits right after `BEGIN`, and the file starts with `\set ON_ERROR_STOP on`, so a run without the setting stops at the guard and writes nothing (even a runner that ignored `ON_ERROR_STOP` would only meet an aborted transaction). The guard cannot test itself; check it by hand once: run the file WITHOUT the setting and confirm it stops with "local throwaway database only".

A `-c "set ..."` before `-f` does NOT work: each `-c`/`-f` item is separate and `set` would be undone by the file's own transaction handling. Pass the setting as a connection option instead.

## How to run (local)
1. Use a THROWAWAY `supabase/postgres:17.11.0.003` container (recommended; this is how every recorded run was done): start it on a free port (e.g. 54399), apply PI-CORE's 5 migrations from the PI-CORE repo, then all NEXUS migrations, then `create extension if not exists pgtap with schema extensions`. Do not use the NEXUS dev stack (`pnpm db:start`, port 55432): its seeded test accounts break this file's "fresh install" assumptions. Never use PI-CORE's stack (54322).
2. Apply all three NEXUS migrations in file-name order (see `../README.md`).
3. Run:
   ```bash
   PGOPTIONS='-c nexus.allow_destructive_tests=yes' \
     psql "postgresql://postgres:postgres@127.0.0.1:54399/postgres" -f supabase/tests/nexus_access_control.test.sql
   ```
   Any line starting with `not ok` is a failure. (`pg_prove` also works with the same `PGOPTIONS`.)

Assumes a fresh NEXUS install (exactly the 31 seeded rules and 31 seed log rows).

**Status:** **244/244 passed on 2026-11-06** (adds 19 D-015 tests: 6 structural in section 1, 13 persona tests in section 7) in a throwaway `supabase/postgres:17.11.0.003` container after PI-CORE's 5 migrations and the 3 NEXUS migrations. Expected total: 244 (the file uses `no_plan()`; update this number when adding tests). The W1 guard was checked by hand the same day: without the setting the run stops at line 37 with "local throwaway database only" and writes nothing. After the run: 0 test members left, 31 rules, 31 log rows, no `nexus_test` schema, no decoy function left (rollback confirmed). Earlier versions: 225/225 on 2026-11-06 (before D-015), 178/178 on 2026-11-05.

## Persona map (spec section 9, with forced deviations)
PI-CORE allows one holder per unique position, unit, and period, so: P-BEND = Bendahara Umum 1; P-BEND-SEK = Bendahara Umum 2 + Sekretaris Departemen of Departemen **Talenta**; P-ADMIN-BEND = P-BEND promoted to `admin` mid-test; P-SEKDEP2 = secretary of Pelayanan Khusus + Biro Kewirausahaan. P-TEMPPW (auth-login spec) = P-PLAIN with `must_change_password = true` (section 7). PI-CORE's column default is `true`, so section 7 first sets every persona to `false`.

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

**Need module tables first (later migrations):** AC-15, 41, 42, 58 (closed-period edits, L7), 27 and 30 (own requests, L9), 37 (assignment removal: same engine, add when convenient), 45 (records of deactivated members), 48 (signed URLs), 51 (no delete on module tables).

**Manual / app level:** AUTH-19/20/21 screens and the fail-closed "gangguan" state when the pending check errors (AR10), AC-31 (Dashboard cards), AC-34 (no session redirect; anon is already denied in DB), AC-63 (UI warning text), AC-08/AC-56 export file contents, UI parts of AC-19 and AC-61, the W1 guard (see above).

## Manual check on the hosted project after applying (read-only)
1. As the owner in the SQL editor: `select count(*) from nexus.access_rules;` = 31 and `select count(*) from nexus.access_rule_log where action = 'seed';` = 31.
2. `select key from nexus.permissions where allow_baseline order by key;` = inventory.export, inventory.view, letters.export, letters.view, minutes.export, minutes.view.
3. From the app with a regular member token: `.schema('nexus').rpc('my_permissions')` returns only `inventory.view`.
4. With a regular member token: `.schema('nexus').from('access_rules').select()` returns `[]`.
5. Without a session (anon key only): any `nexus` call fails (permission denied / schema not usable).
6. With a regular member token: `.schema('nexus').rpc('my_password_change_pending')` returns `false` (or `true` right after an admin issued a temporary password); it accepts no arguments.
