# supabase/ (PMK-NEXUS database)

NEXUS owns schema `nexus` only. PI-CORE owns `public` and `private` in the SAME Supabase project and is read-only for NEXUS. Nothing in this folder creates, alters, grants, or writes anything in `public`/`private`.

| Path | What |
|---|---|
| `migrations/20261105100000_nexus_schema_and_access.sql` | Schema `nexus`, permission catalog, access rules, change log, permission engine, admin RPCs, RLS |
| `migrations/20261105100100_nexus_default_access_rules.sql` | Seeds default rules D01-D31 (looks PI-CORE positions/units up by name ONCE; raises if any name is missing) |
| `tests/nexus_access_control.test.sql` | pgTAP tests (local DB only; everything rolled back) |
| `tests/README.md` | RLS / permission test checklist mapped to the spec's personas and ACs |

Spec: `docs/modules/access-control.md` (rev. 2, locked rules L1-L12). Decisions: D-007 to D-013 in `docs/DECISIONS.md`.

## 1. Project settings (read before applying)

1. **Sign-up disabled** on the hosted project (open question B12). NEXUS relies on "every Auth user is created by PI-CORE".
2. **Exposed schemas: do this only AFTER both migrations are applied** (section 2, step 7). `supabase-js` can only call `.schema('nexus')...` if `nexus` is in Dashboard > Project Settings > Data API > "Exposed schemas". That field REPLACES the whole list (it is shared with PI-CORE): copy the current list first, add only `nexus`, save, then smoke-test one PI-CORE API call (e.g. PI-CORE login + its member page) to confirm PI-CORE still works. Tell the PI-CORE maintainer. Locally the list lives in `[api] schemas` of the `config.toml` that started the stack (PI-CORE's file, which NEXUS must not edit).

## 2. How to apply migrations safely (shared database)

### Why NOT `supabase db push` from this repo
Both repos share one database and therefore one migration history table, `supabase_migrations.schema_migrations`.
- `supabase db push` from NEXUS sees PI-CORE's 5 versions in the remote history that do not exist in `supabase/migrations/` here. The CLI stops and suggests `supabase migration repair --status reverted <versions>`. **Never run that**: it marks PI-CORE's migrations as not applied, and PI-CORE's next `db push` would try to re-run them (its core migration would fail on existing tables; worse outcomes are possible).
- The other way round is the same: if NEXUS versions are recorded in that table, PI-CORE's `db push` complains about unknown remote versions and its maintainer may "repair" them away.
- `supabase db pull` / `db diff` from NEXUS would pull PI-CORE's whole schema into NEXUS migrations.
- `supabase db reset` against a linked remote wipes EVERYTHING, including PI-CORE. Never.

### Recommended procedure (owner runs it)
1. **Confirm the target.** Before anything, check that `$DB_URL` points at the intended project: compare the project ref in the URL with Dashboard > Project Settings > General, and run `psql "$DB_URL" -c "select current_database(), inet_server_addr();"`. (`$DB_URL` = session-pooler or direct connection string from Dashboard > Connect; never commit it.)
2. **Back up** (read-only, safe): `pg_dump "$DB_URL" -Fc -f backup-$(date +%Y%m%d-%H%M).dump`.
   The dump contains **PI-CORE personal data** (members, emails, phones). Store it encrypted (e.g. `gpg -c` or an encrypted disk), outside the repo and outside synced/shared folders (Google Drive, Dropbox, shared laptops), and delete it after a fixed number of days (suggestion: 30). `.gitignore` already ignores `*.dump`.
3. **Apply M1** (`20261105100000_nexus_schema_and_access.sql`), primary route:
   `psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261105100000_nexus_schema_and_access.sql`
   (`-1` = one transaction: all or nothing.) Fallback: Supabase SQL editor, paste the WHOLE file, run once.
   Right after: `select count(*) from nexus.permissions;` = 20 and `select count(*) from nexus.access_rules;` = 0.
4. **Read-only name check before M2** (changes nothing). Every row must show `found = 1`:
   ```sql
   select 'role ' || k as item, (select count(*) from public.roles r where r.key = k) as found
   from unnest(array['bph', 'bendahara', 'sekretaris']) k
   union all
   select 'bph position ' || n, (select count(*) from public.positions p
                                 where p.unit_type = 'bph' and lower(btrim(p.name)) = lower(n))
   from unnest(array['Sekretaris Jenderal', 'Sekretaris Umum 1', 'Sekretaris Umum 2']) n
   union all
   select 'unit Departemen Operasional', (select count(*) from public.org_units u
     where u.type = 'department' and lower(btrim(u.name)) = 'departemen operasional' and u.is_active);
   ```
   If any row is not 1, stop and ask the owner (open question A3) before running M2.
5. **Apply M2** (`20261105100100_nexus_default_access_rules.sql`) the same way (`psql ... -1 -v ON_ERROR_STOP=1 -f ...`). Right after: `select count(*) from nexus.access_rules;` = 31 and `select count(*) from nexus.access_rule_log where action = 'seed';` = 31. If it stops with "NEXUS seed: expected exactly 1 ...", nothing was inserted; the engine works with zero rules (baseline-only, locked rules still apply). Fix the name with the owner, then run M2 again.
6. Run the read-only checks in `tests/README.md` ("Manual check on the hosted project").
7. Only now: add `nexus` to "Exposed schemas" (section 1, item 2) and smoke-test PI-CORE.
8. Record what was applied in `docs/ops/` (file name, date, who). NEXUS does NOT write to `supabase_migrations.schema_migrations`.
9. Undo (only with the owner's explicit OK): nothing in PI-CORE depends on `nexus`, so the schema can be removed as a whole. This is destructive (rules and log are lost); restore from the backup instead whenever possible.

### Local development
Start the local stack from the PI-CORE repo (it holds PI-CORE's migrations), then apply the NEXUS files with psql to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. A PI-CORE `supabase db reset` locally wipes NEXUS objects too; just re-apply the two files.

## 3. API for the backend (`src/lib/picore/` and `src/lib/auth/` only)

All functions live in `nexus`, are callable by `authenticated` only (never `anon`, never `service_role`), and answer only about the caller (`auth.uid()`). Call them with the USER's session client. The service role has SELECT on the four nexus tables (and bypasses RLS) but no write privilege and no EXECUTE.

**L12 (D-013):** keys with `allow_baseline = false` (all except inventory.view/export, minutes.view/export, letters.view/export) can never go to "every active member", and adding or re-enabling a rule for them (or restoring defaults that re-enable them) needs a non-empty `p_note`. Enforced in the RPCs and by the trigger on `nexus.access_rules`.

| Function | Security | Returns / does |
|---|---|---|
| `my_context()` | invoker | 0 rows = No access (L1). Else member_id, full_name, member_type, is_system_admin, active_period_id, active_period_label |
| `my_permissions()` | definer | (permission_key, scope `all`/`units`, unit_ids, is_sensitive) for menus and Dashboard cards |
| `has_permission(p_key, p_unit_id default null)` | definer | The single engine. Null unit = needs scope "all". With a unit = "all" or that unit is in the caller's unit set |
| `permission_unit_ids(p_key)` | definer | Units where the caller holds the key with a unit scope (empty if none or if "all") |
| `can_process_request(p_key, p_requester_member_id)` | invoker | L6: approval keys never apply to the caller's own request |
| `current_member_id()`, `is_system_admin()` | definer | Identity helpers (also used by RLS). Answer only about the caller; independent of PI-CORE RLS |
| `active_period_id()`, `is_active_period(uuid)` | invoker | Period helpers (also used by RLS) |
| `list_access_rules()` | definer, admin | All rules with current PI-CORE names, `stale_reason`, `matching_members` (count only) |
| `access_rule_warnings()` | definer, admin | `no_holder` / `single_holder` for letters.manage, letter_requests.process, finance.manage, borrowing.approve |
| `add_access_rule(...)`, `disable_access_rule(id, note)`, `enable_access_rule(id, note, confirm)`, `restore_default_access_rules(note, confirm)` | definer, admin | The only write path to rules. Each change writes one log row in the same transaction |
| `list_rule_roles()` | definer, admin | Role picker (role_key, name, description, is_targetable) |
| `list_positions()`, `list_org_units()` | invoker | Pickers; empty unless the caller is an active member |

Tables readable directly: `nexus.permissions`, `nexus.permission_scopes` (any active member), `nexus.access_rules` (System Admin), `nexus.access_rule_log` (System Admin or `access_rules.view_log`). No client may write any of them.

Errors from the RPCs carry a stable `hint` (e.g. `not_system_admin`, `baseline_not_allowed`, `note_required`, `note_too_long`, `scope_not_allowed`, `duplicate_rule`, `sensitive_confirmation_required`, `position_missing`) for the backend to map to Indonesian messages. Error codes: `42501` not allowed, `22023` invalid input (incl. L12 and note errors), `23505` duplicate, `P0001` needs confirmation / not seeded, `P0002` not found.

## 4. RLS pattern for future module tables

```sql
-- Every new nexus table: revoke, grant the minimum, enable RLS, explicit policies.
revoke all on nexus.minutes from public, anon, authenticated, service_role;
grant select, insert, update on nexus.minutes to authenticated;   -- no delete: archive instead (L5)
alter table nexus.minutes enable row level security;

-- Read: "all" scope OR one of my units. Each (select ...) runs once per statement, not per row.
create policy minutes_select on nexus.minutes for select to authenticated
  using ((select nexus.has_permission('minutes.view'))
         or org_unit_id = any ((select nexus.permission_unit_ids('minutes.view'))));

-- Write: only in the active period (L7), and only where I may manage.
create policy minutes_insert on nexus.minutes for insert to authenticated
  with check (nexus.is_active_period(period_id)
              and ((select nexus.has_permission('minutes.manage'))
                   or org_unit_id = any ((select nexus.permission_unit_ids('minutes.manage')))));
```
Approval updates use `nexus.can_process_request('borrowing.approve', requester_member_id)` (L6). Own-request rows use `requester_member_id = (select nexus.current_member_id())` (L9, R12).

## 5. Free-tier notes
The rules engine is computed per call (R3, no caching). Data sizes are tiny (tens of rules, hundreds of members), so this is cheap. If it ever gets slow, measure first; a short cache (max 60 s) is the documented fallback (A-n3).

## 6. What the database can and cannot protect (W4)
- The guard and log triggers stop every API role (`authenticated`, `service_role`) and ordinary hand edits. The change log is therefore **tamper-evident** against the app and API keys.
- It is **not tamper-proof against the owner**: the table owner (`postgres`, i.e. anyone with Supabase dashboard / SQL editor access) can disable triggers, edit rules, and rewrite the log. **Dashboard access = full control over rules and log.** Give it to as few people as possible and remove it at handover.
- Keep an off-database audit copy: periodically (e.g. monthly and before each handover) run
  `pg_dump "$DB_URL" -Fc -t nexus.access_rule_log -t nexus.access_rules -f nexus-audit-$(date +%Y%m%d).dump`
  and store it like the backups above (encrypted, outside the repo). Comparing two copies shows any rewrite.

## 7. Checklist for every future nexus migration (W5)
1. Only `nexus` objects; never create, alter, grant, or write anything in `public`/`private`.
2. Every new table: `revoke all ... from public, anon, authenticated, service_role;` grant only what is needed; `enable row level security`; explicit policies (default deny). No DELETE grant; archive instead (L5).
3. Every new function: `revoke all on function ... from public, anon, service_role;` (plus `authenticated` for internal `_*` helpers), then grant EXECUTE to `authenticated` only for client API functions. Default privileges do NOT remove the global EXECUTE-to-PUBLIC.
4. Every SECURITY DEFINER function: `set search_path = ''`, fully qualified names, and an explicit caller check (`auth.uid()`-based helper or `nexus._require_system_admin()`).
5. New permission keys: set `allow_baseline` explicitly (no default); `true` only if safe for every active member.
6. Never read email, phone, nim, nip, must_change_password, audit_log, org_settings, grants_admin, or `private.*`.
7. Re-run the structural pgTAP tests (section 1 of `tests/nexus_access_control.test.sql`) on a throwaway database and update the expected test count in `tests/README.md`.
