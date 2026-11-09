# supabase/ (PMK-NEXUS database)

NEXUS owns schema `nexus` only. PI-CORE owns `public` and `private` in the SAME Supabase project and is read-only for NEXUS. Nothing in this folder creates, alters, grants, or writes anything in `public`/`private`.

| Path | What |
|---|---|
| `migrations/20261105100000_nexus_schema_and_access.sql` | Schema `nexus`, permission catalog, access rules, change log, permission engine, admin RPCs, RLS |
| `migrations/20261105100100_nexus_default_access_rules.sql` | Seeds default rules D01-D31 (looks PI-CORE positions/units up by name ONCE; raises if any name is missing) |
| `migrations/20261106100000_nexus_password_change_pending.sql` | D-015: `nexus.my_password_change_pending()`, the caller-only temporary-password check (the single L4 exception) |
| `migrations/20261106200000_nexus_member_data.sql` | Member Data (D-019): key `member_data.view_export_log`, default rules D32/D33, append-only `nexus.member_data_export_logs`, five restricted read/export functions |
| `migrations/20261107100000_nexus_borrowing_access_rules.sql` | D-022 access amendment: key `borrowing.handle` (22 keys), extra L12 check for `*.handle`, table `nexus.retired_default_rules`, D30 retired (disabled, kept), default rules D34/D35 (heads approve) and D36 (Operations handle), `restore_default_access_rules()` skips retired rules, `access_rule_warnings()` also watches `borrowing.handle` |
| `migrations/20261107100100_nexus_inventory_borrowing.sql` | Inventory and Borrowing (D-022): 16 tables (catalog, units, stock, lists, requests, lines, returns, units on loan, corrections, evidence records, extensions, timeline, item history, export log), guard triggers (no delete, append-only, immutable codes/modes), SELECT-only RLS, 44 functions (state machine, reads, exports, Storage checks) |
| `migrations/20261107100200_nexus_inventory_storage.sql` | Private Storage bucket `nexus-borrowing-evidence` + two policies on `storage.objects` (insert, select). The ONLY file that touches a schema other than `nexus` (Supabase Storage, not PI-CORE). Does nothing where Storage is not installed |
| `migrations/20261108100000_nexus_inventory_borrowing_fixes.sql` | Owner-approved fixes of 2026-11-08 (functions only, no table change): `borrowing_request_detail_by_ref(p_reference)` (detail by `PJM-0001`, same visibility, no existence probing); `can_correct_return` false after the one correction; hints `already_corrected` and `stock_mismatch` split off `correction_conflict`; `inventory_export` = `inventory_item_list` rows for managers (archived/lost units); optional `p_period_id` on `borrowing_queue` and `borrowing_export` (old overloads dropped in the file; new hint `invalid_period`); `borrowing_period_list()` (period choices for that filter, `borrowing.view_all` only, newest first, read-only from PI-CORE `periods`). 46 module functions |
| `migrations/20261109100000_nexus_export_totals_and_evidence_window.sql` | Security-review fixes approved 2026-11-08 (functions only, no table change): `inventory_export`, `borrowing_export` and `member_data_export` end with an extra column `total_count bigint` (`count(*) over ()` of the full filtered result, so the server can see a PostgREST `max_rows` cut); the three are dropped and re-created (return type change), grants restored. `borrowing_evidence_can_upload` counts only unattached files of the last 24 hours toward the cap of 10, so abandoned uploads stop blocking a request |
| `tests/nexus_access_control.test.sql` | pgTAP tests for the engine (local DB only; everything rolled back) |
| `tests/nexus_member_data.test.sql` | pgTAP tests for Member Data (local DB only; everything rolled back) |
| `tests/nexus_inventory_borrowing.test.sql` | pgTAP tests for Inventory and Borrowing (local DB only; everything rolled back) |
| `tests/support/storage_stub.sql` | Throwaway-container-only stand-in for the Storage tables, so the Storage policies can be tested |
| `tests/README.md` | RLS / permission test checklist mapped to the spec's personas and ACs |

Spec: `docs/modules/access-control.md` (rev. 2, locked rules L1-L12, amended 2026-11-07), `docs/modules/auth-login.md` (temporary-password gate), `docs/modules/member-data.md` (rev. 2) and `docs/modules/inventory-borrowing.md` (rev. 2). Decisions: D-007 to D-013, D-015, D-019 and D-022 in `docs/DECISIONS.md`.

## 1. Project settings (read before applying)

1. **Sign-up disabled** on the hosted project (open question B12). NEXUS relies on "every Auth user is created by PI-CORE".
2. **Exposed schemas: do this only AFTER all NEXUS migrations are applied** (section 2, step 8). `supabase-js` can only call `.schema('nexus')...` if `nexus` is in Dashboard > Project Settings > Data API > "Exposed schemas". That field REPLACES the whole list (it is shared with PI-CORE): copy the current list first, add only `nexus`, save, then smoke-test one PI-CORE API call (e.g. PI-CORE login + its member page) to confirm PI-CORE still works. Tell the PI-CORE maintainer. Locally the list lives in `[api] schemas` of the `config.toml` that started the stack (PI-CORE's file, which NEXUS must not edit).

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
   from unnest(array['bph', 'bendahara', 'sekretaris', 'kepala_departemen']) k  -- kepala_departemen: needed by M4 (D32)
   union all
   select 'bph position ' || n, (select count(*) from public.positions p
                                 where p.unit_type = 'bph' and lower(btrim(p.name)) = lower(n))
   from unnest(array['Sekretaris Jenderal', 'Sekretaris Umum 1', 'Sekretaris Umum 2']) n
   union all
   select 'unit Departemen Operasional', (select count(*) from public.org_units u
     where u.type = 'department' and lower(btrim(u.name)) = 'departemen operasional' and u.is_active)
   union all  -- needed by M5 (D34, D35)
   select 'department position Kepala Departemen', (select count(*) from public.positions p
     where p.unit_type = 'department' and lower(btrim(p.name)) = 'kepala departemen')
   union all
   select 'division position Kepala Divisi', (select count(*) from public.positions p
     where p.unit_type = 'division' and lower(btrim(p.name)) = 'kepala divisi');
   ```
   If any row is not 1, stop and ask the owner (open question A3) before running M2.
5. **Apply M2** (`20261105100100_nexus_default_access_rules.sql`) the same way (`psql ... -1 -v ON_ERROR_STOP=1 -f ...`). Right after: `select count(*) from nexus.access_rules;` = 31 and `select count(*) from nexus.access_rule_log where action = 'seed';` = 31. If it stops with "NEXUS seed: expected exactly 1 ...", nothing was inserted; the engine works with zero rules (baseline-only, locked rules still apply). Fix the name with the owner, then run M2 again.
6. **Apply M3** (`20261106100000_nexus_password_change_pending.sql`) the same way (`psql ... -1 -v ON_ERROR_STOP=1 -f ...`). It adds one function only and needs M1 (not M2). Right after, as the owner (no user session, so the answer is `false`): `select nexus.my_password_change_pending();` = `false` and `select has_function_privilege('anon', 'nexus.my_password_change_pending()', 'execute');` = `false`. Running M3 twice stops with "function ... already exists" and changes nothing (one transaction).
7. **Apply M4** (`20261106200000_nexus_member_data.sql`) the same way (`psql ... -1 -v ON_ERROR_STOP=1 -f ...`). It needs M1 AND M2: if D01-D31 are not all seeded it stops with "default rules D01-D31 are not seeded" and changes nothing (seeding D32 first would make M2 skip its own rules). It also stops if role key `bph` or `kepala_departemen` is missing in `public.roles`. Right after: `select count(*) from nexus.permissions;` = 21, `select count(*) from nexus.access_rules;` = 33, `select count(*) from nexus.access_rule_log where action = 'seed';` = 33, `select count(*) from nexus.member_data_export_logs;` = 0. Re-running M4 is safe (every statement is idempotent; nothing changes). **Not yet applied to the hosted project** (as of 2026-11-06); the owner applies it.
8. **Apply M5** (`20261107100000_nexus_borrowing_access_rules.sql`, D-022) the same way. It needs M1, M2 and M4: if D01-D33 are not all there it stops ("default rules D01-D33 are not all seeded") and changes nothing. It also stops if the step 4 check would not show 1 for `Departemen Operasional`, `Kepala Departemen` (department) or `Kepala Divisi` (division), or if D28 points at another unit. Right after: `select count(*) from nexus.permissions;` = 22, `select count(*) from nexus.access_rules;` = 36, `select count(*) from nexus.access_rules where is_enabled;` = 35 (D30 retired), `select count(*) from nexus.access_rule_log;` = 37 (36 `seed` + 1 `disable` for D30), `select default_code from nexus.retired_default_rules;` = D30. Re-running M5 changes nothing (it says "D30 was already retired"). If the System Admin later re-enables D30 on purpose, a re-run does not disable it again.
   Before applying, check that the Operations heads are actually filled in the active period (B29: with only one head, that head's own requests wait for a second head):
   ```sql
   select po.name, u.name as unit, count(*) as holders
   from public.assignments a
   join public.positions po on po.id = a.position_id
   join public.org_units u on u.id = a.org_unit_id
   join public.periods pe on pe.id = a.period_id and pe.is_active
   where (po.unit_type = 'department' and po.name = 'Kepala Departemen' and u.name = 'Departemen Operasional')
      or (po.unit_type = 'division' and po.name = 'Kepala Divisi' and u.name in ('Logistik', 'Akomodasi'))
   group by po.name, u.name;
   ```
9. **Apply M6** (`20261107100100_nexus_inventory_borrowing.sql`) the same way. Needs M1 and M5. Right after: `select count(*) from pg_tables where schemaname = 'nexus';` = 22, `select count(*) from nexus.inventory_items;` = 0, `select count(*) from nexus.inventory_categories;` = 0 (the lists start EMPTY, IB10), `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'nexus' and c.relkind = 'r' and not c.relrowsecurity;` = 0. Re-running M6 is safe (every statement is idempotent).
10. **Read-only Storage pre-check, then apply M7** (approved by the owner 2026-11-07). The Storage area is SHARED with PI-CORE, so first look (changes nothing):
    ```sql
    -- a) Every existing policy on storage.objects must name a bucket. A row with scoped = false is a
    --    permissive policy that would ALSO open the evidence photos (policies are OR-ed).
    select policyname, cmd, roles, qual, with_check,
           (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'bucket_id' as scoped
    from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname;
    -- b) Does the bucket id already exist (and how is it set)?
    select id, public, file_size_limit, allowed_mime_types, created_at
    from storage.buckets where id = 'nexus-borrowing-evidence';
    -- c) Can postgres (owner of the nexus functions) read storage.objects? The return function checks
    --    that an evidence file was uploaded, and the upload check counts waiting files.
    select has_table_privilege('postgres', 'storage.objects', 'select') as postgres_can_read_objects;
    ```
    - (a) **Any row with `scoped = false`: STOP.** Do not apply M7; the migration would refuse anyway (hint `storage_policy_unscoped`). Show the policy to the owner and the PI-CORE maintainer: it is either a mistake (it already exposes every bucket) or needs a `bucket_id` condition. Re-check after it is fixed.
    - (b) **No row**: normal, M7 creates the bucket. **A row with `public = false`, `file_size_limit = 1572864`, types `{image/jpeg,image/png,image/webp}`**: fine (an earlier run); M7 leaves it and only adds missing policies. **A row with anything else, or `public = true`: STOP.** Somebody else uses this id; M7 refuses (hint `bucket_conflict`) and changes nothing. Ask the owner; never change that bucket from NEXUS.
    - (c) **`false`: STOP.** Without it, every return with a photo fails and uploads cannot be counted. Ask the owner to raise it with Supabase support; do not grant anything on Storage from NEXUS.
    Then apply M7 the same way, SEPARATELY from M6 (it is the only file that writes outside `nexus`: it may add one row to `storage.buckets` and two policies on `storage.objects`; it never updates an existing bucket). Right after: `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'nexus-borrowing-evidence';` = one row, `public = false`, 1572864, `{image/jpeg,image/png,image/webp}`; `select policyname, cmd from pg_policies where schemaname = 'storage' and policyname like 'nexus_%';` = `nexus_borrowing_evidence_insert` (INSERT) and `nexus_borrowing_evidence_select` (SELECT), nothing for UPDATE or DELETE.
    **If it stops with "must be owner of table objects"** (newer Supabase projects may not let the SQL editor's `postgres` role add policies to Storage tables; this could not be verified locally): nothing was changed (one transaction). Then create the same thing in the Dashboard instead: Storage > New bucket `nexus-borrowing-evidence`, Public OFF, file size limit 1.5 MB, allowed MIME types `image/jpeg, image/png, image/webp`; Storage > Policies on that bucket: one INSERT policy for `authenticated` with the check `bucket_id = 'nexus-borrowing-evidence' and nexus.borrowing_evidence_can_upload(name)`, and one SELECT policy for `authenticated` with `bucket_id = 'nexus-borrowing-evidence' and nexus.borrowing_evidence_can_read(name)`. No UPDATE and no DELETE policy. Record which route was used in `docs/ops/`.
10b. **Apply M8** (`20261108100000_nexus_inventory_borrowing_fixes.sql`) the same way, after M6 (M7 not required). It replaces functions only and drops three OLD function signatures of this module (`borrowing_queue`, `borrowing_export`, `_ib_queue_rows`, replaced by versions with `p_period_id`); no data, table or policy changes. Right after: `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'nexus' and (p.proname like 'inventory\_%' or p.proname like 'borrowing\_%');` = 46, and `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'nexus' and p.proname in ('borrowing_queue', 'borrowing_export');` = 2 (one version each). Re-running M8 is safe.
10c. **Apply M9** (`20261109100000_nexus_export_totals_and_evidence_window.sql`) the same way, after M8 (it needs M4, M6 and M8; M7 not required). It replaces functions only: it drops and re-creates `inventory_export`, `borrowing_export` and `member_data_export` with the same arguments plus a trailing `total_count bigint` column (a return type cannot change with `create or replace`; nothing depends on these three), restores their grants, and replaces `borrowing_evidence_can_upload` (24-hour window for the upload cap). No data, table or policy changes. **Deploy the matching app version right after** (the backend reads `total_count`; the old app keeps working because PostgREST returns the extra column as one more key). Right after: `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'nexus' and p.proname in ('inventory_export', 'borrowing_export', 'member_data_export');` = 3, `select pg_get_function_result('nexus.member_data_export(text,text,uuid,text)'::regprocedure) like '%total_count bigint)';` = `true`, and `select p.oid::regprocedure, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'nexus' and p.proname in ('inventory_export', 'borrowing_export', 'member_data_export');` shows only `postgres` and `authenticated` for each. Re-running M9 is safe.
11. Run the read-only checks in `tests/README.md` ("Manual check on the hosted project").
12. Only now: add `nexus` to "Exposed schemas" (section 1, item 2) and smoke-test PI-CORE.
13. Record what was applied in `docs/ops/` (file name, date, who). NEXUS does NOT write to `supabase_migrations.schema_migrations`.
14. Undo (only with the owner's explicit OK): nothing in PI-CORE depends on `nexus`, so the schema can be removed as a whole. This is destructive (rules and log are lost); restore from the backup instead whenever possible. M7's bucket and two policies live in Storage and must be removed separately (Dashboard), and only while the bucket holds no evidence photos.

**Not yet applied to the hosted project** (as of 2026-11-07): M4, M5, M6, M7. M5-M7 are applied to the local dev stack in an EARLIER draft; see "Local development" for bringing it up to date.

### Local development
NEXUS has its OWN local stack (D-018): `pnpm db:start` (or `bash scripts/dev-db.sh start`). It applies PI-CORE's migrations read-only from the PI-CORE repo, then the NEXUS migrations, then the local-only test accounts. Database: `postgresql://postgres:postgres@127.0.0.1:55432/postgres`, API `http://127.0.0.1:55431`. Do not apply NEXUS files to PI-CORE's local stack (54322): its config does not expose `nexus`. Full guide: `docs/ops/local-setup.md`.

After a new migration: `pnpm db:migrate` (applies only new files, then re-runs the idempotent seed). The seed adds, for Inventory and Borrowing, `kadiv.logistik@nexus.test` (Kepala Divisi Logistik: approves, handles) and `staff.ops@nexus.test` (Staff Akomodasi: handles, does not approve) next to `kadep@nexus.test` (Kepala Departemen Operasional), plus a FAKE catalog: `Kategori Uji A/B`, `Lokasi Uji 1/2`, `Barang Uji 01`..`03` (quantity) and `Barang Uji 04`/`05` (tracked).

**Storage is OFF on the local stack** (`[storage] enabled = false` in `config.toml`), so M7 skips itself there ("Supabase Storage is not installed here") and evidence photos cannot be uploaded locally; `borrowing_request_return` then skips the "file was uploaded" check (there are no files). To work on photos locally: set `[storage] enabled = true`, `pnpm db:stop && pnpm db:start` (not reset), then run M7 by hand: `PGOPTIONS='' psql "postgresql://postgres:postgres@127.0.0.1:55432/postgres" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261107100200_nexus_inventory_storage.sql`. Storage needs extra RAM.

**Bringing the local stack up to the 2026-11-07 review version of M5-M7** (they changed after `pnpm db:migrate` recorded them in `local_dev.applied_files`, so `db:migrate` will not re-run them). Two ways, owner's choice:
1. *Keep the data:* re-run the three files by hand (all idempotent), then restart the API:
   ```bash
   for f in 20261107100000_nexus_borrowing_access_rules 20261107100100_nexus_inventory_borrowing 20261107100200_nexus_inventory_storage; do
     docker exec -i supabase_db_pmk-nexus psql -U postgres -d postgres -X -q -1 -v ON_ERROR_STOP=1 < supabase/migrations/$f.sql; done
   docker restart supabase_rest_pmk-nexus
   ```
   This leaves one unused internal function from the draft, `nexus._ib_request_rows()` (no arguments; no client can execute it). It is harmless; removing it is an owner-run `drop function nexus._ib_request_rows();` and only cosmetic.
2. *Rebuild from scratch:* `pnpm db:reset` (DELETES the local database, asks first). Local test data only.

## 3. API for the backend (`src/lib/picore/` and `src/lib/auth/` only)

All functions live in `nexus`, are callable by `authenticated` only (never `anon`, never `service_role`), and answer only about the caller (`auth.uid()`). Call them with the USER's session client. The service role has SELECT on every nexus table (and bypasses RLS) but no write privilege and no EXECUTE.

**L12 (D-013):** keys with `allow_baseline = false` (all except inventory.view/export, minutes.view/export, letters.view/export) can never go to "every active member", and adding or re-enabling a rule for them (or restoring defaults that re-enable them) needs a non-empty `p_note`. Enforced in the RPCs and by the trigger on `nexus.access_rules`.

| Function | Security | Returns / does |
|---|---|---|
| `my_context()` | invoker | 0 rows = No access (L1). Else member_id, full_name, member_type, is_system_admin, active_period_id, active_period_label |
| `my_permissions()` | definer | (permission_key, scope `all`/`units`, unit_ids, is_sensitive) for menus and Dashboard cards |
| `has_permission(p_key, p_unit_id default null)` | definer | The single engine. Null unit = needs scope "all". With a unit = "all" or that unit is in the caller's unit set |
| `permission_unit_ids(p_key)` | definer | Units where the caller holds the key with a unit scope (empty if none or if "all") |
| `can_process_request(p_key, p_requester_member_id)` | invoker | L6: approval keys (`letter_requests.process`, `borrowing.approve`) never apply to the caller's own request. `borrowing.handle` is deliberately not in the list (D-022) |
| `current_member_id()`, `is_system_admin()` | definer | Identity helpers (also used by RLS). Answer only about the caller; independent of PI-CORE RLS |
| `active_period_id()`, `is_active_period(uuid)` | invoker | Period helpers (also used by RLS) |
| `list_access_rules()` | definer, admin | All rules with current PI-CORE names, `stale_reason`, `matching_members` (count only) |
| `access_rule_warnings()` | definer, admin | `no_holder` / `single_holder` for letters.manage, letter_requests.process, finance.manage, borrowing.approve; `no_holder` for borrowing.handle (D-022) |
| `add_access_rule(...)`, `disable_access_rule(id, note)`, `enable_access_rule(id, note, confirm)`, `restore_default_access_rules(note, confirm)` | definer, admin | The only write path to rules. Each change writes one log row in the same transaction. Restore skips retired defaults (`nexus.retired_default_rules`, today D30) |
| `list_rule_roles()` | definer, admin | Role picker (role_key, name, description, is_targetable) |
| `list_positions()`, `list_org_units()` | invoker | Pickers; empty unless the caller is an active member |
| `member_data_list(p_search text default null, p_unit_id uuid default null, p_status text default 'active', p_page integer default 1, p_page_size integer default 20)` | definer, `member_data.view` | Member Data list (D-019). Returns `row_no, member_id, full_name, member_type, is_active, unit_name, unit_type, parent_unit_name, position_name, total_count, page, page_size`. One row per member; unit/position = PRIMARY active-period assignment (null = "-"); `parent_unit_name` only for a division (show "Parent · Unit"). Search = name only, case-insensitive, partial, `%`/`_` literal, max 120 chars after trimming (raw input over 480 chars refused first). An unknown `p_unit_id` is refused (`invalid_unit`). Status `active` / `inactive` / `all`. Unit filter matches ANY active-period assignment in the unit or its divisions. Sorted name A-Z, ties by id. Page size 1..50; a page past the end returns the last page (`page` says which). 0 rows = no match |
| `member_data_unit_options()` | definer, `member_data.view` | `(id, name, type, sort_order)`: active units of type bph/department/bureau, PI-CORE order |
| `member_data_active_count()` | definer, `member_data.view` | One integer: all members with `is_active` (Dashboard "Members") |
| `member_data_export(p_format text, p_search text default null, p_unit_id uuid default null, p_status text default 'active')` | definer, `member_data.export` (+ view, R15) | Same rows/columns as the list without paging (no `page/page_size`), plus a trailing `total_count bigint` (M9: rows of the full filtered result on every row; compare with the rows received to detect a PostgREST `max_rows` cut; 0 rows = total 0). `p_format` = `xlsx`/`csv`/`pdf`. Writes ONE export-log row in the same transaction; if that fails, the call fails and returns nothing. VOLATILE: call with `.rpc()` (POST); a GET fails closed |
| `member_data_export_log_list(p_page integer default 1, p_page_size integer default 50)` | definer, System Admin or `member_data.view_export_log` | Newest first: `log_id, created_at, exporter_member_id, exporter_name, format, filter_unit_id, filter_unit_name, filter_status, search_used, period_id, period_label, total_count, page, page_size`. Page size 1..50 |
| `my_password_change_pending()` | invoker | D-015. One non-null boolean about the CALLER only, no parameters. `true` = active linked member whose PI-CORE password is still temporary. `false` = no pending change; also for inactive and unlinked users (their `my_context()` is 0 rows, which decides first). anon/service_role: permission denied |

Tables readable directly: `nexus.permissions`, `nexus.permission_scopes` (any active member), `nexus.access_rules` (System Admin), `nexus.access_rule_log` (System Admin or `access_rules.view_log`), `nexus.retired_default_rules` (System Admin). `nexus.member_data_export_logs` is NOT readable directly by any client (no grant, no policy): read it only through `member_data_export_log_list()`, which adds the exporter's current name. No client may write any of them.

### 3.1 Inventory and Borrowing (D-022)

All functions: `authenticated` only, SECURITY DEFINER, `search_path = ''`, permission checked first. Reads are STABLE (GET or `.rpc()`); every write and both exports are VOLATILE: call them with `.rpc()` (POST). Stored values are English (`tracked`/`quantity`; `good`/`needs_service`/`damaged`; units `active`/`archived`/`lost`; requests `submitted`/`approved`/`rejected`/`cancelled`/`borrowed`/`returned`; outcomes `good`/`damaged`/`lost`); the UI maps them to Indonesian. Dates are Jakarta calendar dates (`date`), timestamps are UTC (`timestamptz`). Derived states are returned as flags (`is_overdue`, `overdue_days`, `is_not_picked_up`, `is_partially_returned`), never stored. Request actions take `p_version` (from the list/detail) and return `(request_id, status, version)`; a stale version gives `state_changed` ("Data sudah berubah").

**Catalog reads** (`inventory.view` = every active member, D01)
| Function | Returns / notes |
|---|---|
| `inventory_item_list(p_search text=null, p_category_id uuid=null, p_location_id uuid=null, p_condition text=null, p_status text='active', p_available_from date=null, p_available_to date=null, p_page int=1, p_page_size int=20)` | `row_no, item_id, code, name, mode, category_id, category_name, location_id, location_name, location_count, is_active, unit_count, qty_good, qty_needs_service, qty_damaged, qty_total, lendable_qty, free_qty, units (jsonb, tracked only), total_count, page, page_size`. Search = item name, item code or unit code. `p_status` `archived`/`all` needs `inventory.manage`. Both dates = "Tersedia pada tanggal" (P2): `free_qty` filled, items with 0 free sort last. Page size 1..50 |
| `inventory_item_detail(p_item_id uuid)` | jsonb: fields, `stock {good, needs_service, damaged, total}`, `lendable_qty`, `units[]`. Archived item for non-managers = `item_not_found` |
| `inventory_item_availability(p_item_id uuid, p_from date, p_to date)` | `item_id, lendable_qty, free_qty, held_qty`. Counts only, never who (R8) |
| `inventory_availability_bulk(p_item_ids uuid[], p_from date, p_to date)` | Same shape for up to 100 items; archived/unknown ids are left out |
| `inventory_category_list(p_include_inactive boolean=true)`, `inventory_location_list(...)` | `id, name, is_active, item_count`, A-Z |
| `inventory_status_counts()` | `good_count` (incl. on loan), `good_on_loan_count`, `needs_service_count`, `item_count` (Dashboard, no percentage) |
| `inventory_item_history_list(p_item_id uuid, p_page int=1, p_page_size int=20)` | `inventory.manage` or `borrowing.view_all`. Newest first, actor = current PI-CORE name |

**Catalog writes** (`inventory.manage`, Operations D28). Every one writes an item history row.
| Function | Notes |
|---|---|
| `inventory_category_add(p_name text) -> uuid`, `inventory_category_rename(p_category_id uuid, p_name text) -> uuid`, `inventory_category_set_active(p_category_id uuid, p_is_active boolean) -> uuid` | Names 1..60, unique ignoring case (`duplicate_name`). Never deleted |
| `inventory_location_add/rename/set_active(...)` | Same, names 1..80 |
| `inventory_item_create(p_mode text, p_name text, p_description text=null, p_category_id uuid=null, p_location_id uuid=null, p_stock jsonb=null, p_units jsonb=null, p_note text=null)` | Returns `item_id, item_code, unit_codes text[]`. Quantity: `p_stock = {"good": n, "needs_service": n, "damaged": n}` (0..9999 each, total >= 1). Tracked: `p_units = [{"condition": "good", "location_id": "<uuid or null>"}, ...]` (1..200), `p_location_id` must be null (`location_per_unit`). Name 1..120, description <= 1000. Codes come from the database |
| `inventory_item_update(p_item_id uuid, p_name text, p_description text=null, p_category_id uuid=null, p_location_id uuid=null, p_note text=null) -> boolean` | Send every field as on the form; false = nothing changed. Mode and code cannot change |
| `inventory_unit_add(p_item_id uuid, p_units jsonb, p_note text=null) -> text[]`, `inventory_unit_update(p_unit_id uuid, p_location_id uuid, p_note text=null) -> boolean` | Tracked items |
| `inventory_stock_add(p_item_id uuid, p_condition text, p_quantity int, p_note text) -> int` | "Tambah jumlah". Reason required (P6) |
| `inventory_stock_move(p_item_id uuid, p_from text, p_to text, p_quantity int, p_note text)` | "Ubah kondisi". Reason required. Out of good: `reserved_stock` if it would cut into approved/borrowed requests (detail = reserved count) |
| `inventory_stock_write_off(p_item_id uuid, p_condition text, p_quantity int, p_note text)` | "Keluarkan dari stok". Reason required |
| `inventory_unit_set_condition(p_unit_id uuid, p_condition text, p_note text)`, `inventory_unit_write_off(p_unit_id uuid, p_note text)` | Not while the unit is on loan (`unit_on_loan`). Write-off = status `lost`, code kept |
| `inventory_item_set_active(p_item_id uuid, p_is_active boolean, p_note text=null) -> boolean`, `inventory_unit_set_active(p_unit_id uuid, p_is_active boolean, p_note text=null) -> boolean` | Archive/reactivate. Archiving refused with open request lines (`open_requests_exist`, detail = count) or a unit on loan |
| `inventory_unit_restore_lost(p_unit_id uuid, p_condition text, p_note text)` | A-IB45 "Ditemukan kembali". **`inventory.manage`** (tech lead 2026-11-07, review L3; earlier draft: `borrowing.handle`), active item only (`item_archived`), reason required |

**Borrowing reads**
| Function | Permission | Returns / notes |
|---|---|---|
| `borrowing_my_requests(p_filter text='open', p_page int=1, p_page_size int=20)` | L9 (any active member) | Own requests only (also outside-party requests the caller recorded). `open`/`closed`/`all`. Columns: `row_no, request_id, reference, status, version, period_label, is_outside_party, outside_org_name, outside_contact_name, purpose, start_date, end_date, items (jsonb), qty_outstanding, is_overdue, overdue_days, is_not_picked_up, is_partially_returned, has_issue, extension_count, decided_by_name, decision_note, created_at, total_count, page, page_size` |
| `borrowing_queue(p_view text='pending', p_search text=null, p_from date=null, p_to date=null, p_item_id uuid=null, p_page int=1, p_page_size int=20)` | `borrowing.view_all` | Views `pending`, `ready`, `borrowed`, `overdue`, `closed`, `all` (active period), `open_all_periods`. Adds `period_id, requester_member_id, requester_name, is_own, pending_overlap_count`. Search = reference, requester, organisation, contact person, item |
| `borrowing_queue_counts()` | `borrowing.view_all` | `pending, ready, borrowed, overdue, open_all_periods, action_needed` ("Antrean (n)") |
| `borrowing_open_loans()` | `borrowing.view_all` | Every unfinished request of every period, oldest period first, overdue first (handover helper) |
| `borrowing_request_detail(p_request_id uuid)` | own or `borrowing.view_all` | jsonb: header, `lines[]` (quantities, `units[]`, `returns[]` with `photos[]` paths, `available` for view_all holders), `timeline[]` (oldest first, with `actor_name`), `other_approver_count` (B29 hint), `actions {can_approve, can_reject, can_extend, can_hand_over, can_return, can_cancel, cancel_reason_required, can_correct_return}`. Someone else's request = `request_not_found` |
| `borrowing_handover_units(p_request_id uuid)` | `borrowing.handle` | `line_id, item_id, unit_id, code, location_id, location_name`: units that may be handed over |

**Borrowing state machine** (all return `request_id, status, version`)
| Function | Permission and rules |
|---|---|
| `borrowing_request_create(p_start_date date, p_end_date date, p_purpose text, p_lines jsonb, p_note text=null, p_outside_org_name text=null, p_outside_contact_name text=null)` | Any active member (L9). `p_lines = [{"item_id": "<uuid>", "quantity": n}]`, 1..50, each item once. Start not before today (Jakarta), no lead time; end at most start + 365 days (`date_range_too_long`, owner 2026-11-07); no infinity, nothing before 2000 (`invalid_dates`). Owner caps per requester of record: at most 5 requests waiting (`too_many_open_requests`, detail 5) and 20 new requests per Jakarta day (`daily_request_limit`, detail 20); outside-party requests count for the recorder. Outside party: both names (1..120) and `borrowing.handle`; the recorder is the requester. Returns `request_id, reference, status, version` |
| `borrowing_request_approve(p_request_id uuid, p_version int, p_note text=null, p_lines jsonb=null)` | `borrowing.approve`, never own (L6). `p_lines = [{"line_id": .., "quantity": n}]` (max 50) to approve less (note required). Re-checks stock under the item lock |
| `borrowing_request_reject(p_request_id uuid, p_version int, p_note text)` | `borrowing.approve`, never own. Note required |
| `borrowing_request_cancel(p_request_id uuid, p_version int, p_reason text=null)` | Requester: Diajukan (reason optional) or Disetujui (reason required). `borrowing.handle`: Disetujui only, reason required |
| `borrowing_request_extend(p_request_id uuid, p_version int, p_new_end_date date, p_note text)` | `borrowing.approve`, never own. Later date, note required, added days checked under the lock. The new end may not pass the ORIGINAL start + 365 (`date_range_too_long`, detail = last allowed date) |
| `borrowing_request_hand_over(p_request_id uuid, p_version int, p_lines jsonb, p_note text=null)` | `borrowing.handle` (own request allowed). Not before the start date. `p_lines = [{"line_id": .., "quantity": n}]` (quantity items) or `[{"line_id": .., "unit_ids": [..]}]` (tracked; max 200 ids, `too_many_units`), max 50 lines, optional `"note"` per line, required when less than approved |
| `borrowing_request_return(p_request_id uuid, p_version int, p_outcomes jsonb)` | `borrowing.handle` (own request allowed). `p_outcomes = [{"line_id": .., "outcome": "good"/"damaged"/"lost", "quantity": n` (quantity items) or `"unit_id": ..` (tracked)`, "resulting_condition": "needs_service"/"damaged"` (damaged only)`, "note": ".."` (required for damaged/lost)`, "photos": ["<request id>/<uuid>.jpg", ..]` (1..3 for damaged/lost, none for good)`}]`. Partial returns allowed |
| `borrowing_request_correct_return(p_request_id uuid, p_version int, p_reason text)` | `borrowing.handle`. Dikembalikan -> Dipinjam, reverses the LAST return; ONCE per request (review L1); only for a request of the active period (`closed_period`). `correction_conflict` when already corrected, when a unit changed since, or (counted "lost") when the item's stock history has any later added/written-off/condition/restore row (review L2). There is no handover correction (owner 2026-11-07) |

**Exports** (one log row per successful call, same transaction; no rows without it)
| Function | Permission | Notes |
|---|---|---|
| `inventory_export(p_format text, p_search text=null, p_category_id uuid=null, p_location_id uuid=null, p_condition text=null, p_status text='active', p_available_from date=null, p_available_to date=null)` | `inventory.export` (+view) | One row per quantity item, one per unit: `row_no, item_id, code, item_name, mode, category_name, location_name, unit_condition, unit_status, qty_good, qty_needs_service, qty_damaged, qty_total, item_is_active, free_qty, total_count` (`total_count bigint`, M9: rows of the full filtered result, on every row) |
| `borrowing_export(p_format text, p_view text='all', p_search text=null, p_from date=null, p_to date=null, p_item_id uuid=null, p_period_id uuid=null)` | `borrowing.export` (+view_all) | Same filter/order as the queue: `row_no, reference, status, period_label, requester_name, is_outside_party, outside_org_name, outside_contact_name, purpose, items, units_handed_over, start_date, end_date, extension_count, decided_by_name, decided_at, decision_note, handed_over_at, returned_at, returned_good, returned_damaged, returned_lost, has_issue, is_overdue, overdue_days, is_not_picked_up, is_partially_returned, total_count` (`total_count bigint`, M9) |

**Storage checks** (used by the Storage policies, callable by the app): `borrowing_evidence_can_upload(p_object_name text) -> boolean` (also false once 10 uploads created in the last 24 hours wait unattached in that request's folder, review L6; older abandoned uploads no longer count, M9), `borrowing_evidence_can_read(p_object_name text) -> boolean`. Upload path = `<request id>/<random uuid>.<jpg|jpeg|png|webp>` (lowercase) in bucket `nexus-borrowing-evidence`; upload when picked (A-IB39), then pass the paths to `borrowing_request_return`. Read with `createSignedUrl()` (short expiry, e.g. 60 s) with the USER's session: the SELECT policy decides.

Tables readable directly (SELECT only, RLS): catalog tables for `inventory.view` (archived rows only for `inventory.manage`); request tables for the requester and `borrowing.view_all`; item history for `inventory.manage` or `borrowing.view_all`. `nexus.inventory_borrowing_export_logs` has no client grant (read through the database until the log screen exists).

Hints of this module: `permission_required`, `not_active_member`, `self_approval_blocked`, `closed_period`, `immutable_column`, `export_log_direct_insert`, `append_only` (42501); `request_not_found`, `item_not_found`, `unit_not_found`, `category_not_found`, `location_not_found`, `line_not_found` (P0002); `no_active_period`, `state_changed`, `insufficient_stock`, `reserved_stock`, `item_not_lendable`, `open_requests_exist`, `unit_on_loan`, `item_archived`, `unit_not_available`, `too_early`, `nothing_to_hand_over`, `correction_conflict`, `photo_missing`, `too_many_open_requests`, `daily_request_limit` (P0001); `duplicate_name` (23505); `date_range_too_long`, `too_many_units`, `invalid_input`, `invalid_mode`, `invalid_condition`, `invalid_status`, `invalid_view`, `invalid_dates`, `start_in_past`, `quantity_invalid`, `text_required`, `text_too_long`, `reason_required`, `note_required`, `duplicate_item`, `too_many_lines`, `outside_party_incomplete`, `location_per_unit`, `item_not_tracked`, `item_not_quantity`, `invalid_photo`, `photo_count`, `search_too_long`, `invalid_page`, `invalid_page_size`, `invalid_format` (22023). `detail` carries the field name, the item/line/unit id or a count; never a person. Migration-only (M7, owner-run): `bucket_conflict`, `storage_policy_unscoped` (P0001).

**Temporary-password gate (D-015, auth-login F6 and AR10).** The session function in `src/lib/auth/` calls `my_context()` and `my_password_change_pending()` in parallel, both with the user's session, once per request, and then applies the precedence below to the two results (the order of the calls does not matter). Precedence: anonymous > error > no-access > password-pending > member. If the pending call errors or returns anything other than exactly `true`/`false`, the state is `error` ("gangguan": no data, no sign-out); an error is never read as `false`, and `false` never grants access by itself. Known limit: the gate is app-level only (same as PI-CORE); RLS does not stop a direct API call made with a temporary password.

Errors from the RPCs carry a stable `hint` (e.g. `not_system_admin`, `baseline_not_allowed`, `note_required`, `note_too_long`, `scope_not_allowed`, `duplicate_rule`, `sensitive_confirmation_required`, `position_missing`; Member Data: `permission_required` (42501, `detail` = the missing key), `invalid_status`, `invalid_page`, `invalid_page_size`, `invalid_format`, `invalid_unit`, `search_too_long`) for the backend to map to Indonesian messages. Error codes: `42501` not allowed, `22023` invalid input (incl. L12 and note errors), `23505` duplicate, `P0001` needs confirmation / not seeded, `P0002` not found.

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

**Inventory and Borrowing.** The request lists compute derived flags on read (no stored "overdue", no background job, R9), but only for the rows they need: "Peminjaman Saya" filters by the caller first, each queue view by its statuses, and the pending-overlap warning is computed only for the 20 rows on the page and in the detail. Measured on 10,000 synthetic requests (20,000 lines, 6,000 returns; throwaway container, 2026-11-07): `borrowing_my_requests` about 15 ms; `borrowing_queue` 50-70 ms (pending, ready, borrowed, overdue), about 145 ms (closed, open_all_periods), about 190 ms (all); `borrowing_queue_counts` about 130 ms; `borrowing_open_loans` (5,000 rows) about 145 ms. PMK has perhaps a few hundred requests a year.

**Storage (evidence photos).** The Supabase free tier includes about 1 GB of Storage (verify the current limit before launch, open question C9). Evidence photos are resized in the browser to about 1 MB at most (the bucket refuses files over 1.5 MB), typically about 300 KB, and only damaged or lost returns have them (1 to 3 each). 100 such returns a year with 2 photos is about 60 MB a year. Attached photos are evidence and are never deleted (IB9, L5). Files uploaded but never attached to a saved return are NOT evidence (A-IB39); list them read-only and remove them in the Dashboard (Storage) when the owner agrees:
```sql
-- Uploaded more than 7 days ago and never attached to a saved return (safe to remove).
select o.name, o.created_at, (o.metadata ->> 'size')::int as bytes
from storage.objects o
where o.bucket_id = 'nexus-borrowing-evidence'
  and o.created_at < now() - interval '7 days'
  and not exists (select 1 from nexus.borrowing_evidence_photos e where e.storage_path = o.name)
order by o.created_at;
```
Watch the total: `select pg_size_pretty(sum((metadata ->> 'size')::bigint)) from storage.objects where bucket_id = 'nexus-borrowing-evidence';`. Storage is shared with PI-CORE and later modules (minutes attachments); warn the owner at 70 %.

## 6. What the database can and cannot protect (W4)
- The guard and log triggers stop every API role (`authenticated`, `service_role`) and ordinary hand edits. The change log is therefore **tamper-evident** against the app and API keys.
- It is **not tamper-proof against the owner**: the table owner (`postgres`, i.e. anyone with Supabase dashboard / SQL editor access) can disable triggers, edit rules, and rewrite the log. **Dashboard access = full control over rules and log.** Give it to as few people as possible and remove it at handover.
- Keep an off-database audit copy: periodically (e.g. monthly and before each handover) run
  `pg_dump "$DB_URL" -Fc -t nexus.access_rule_log -t nexus.access_rules -f nexus-audit-$(date +%Y%m%d).dump`
  and store it like the backups above (encrypted, outside the repo). Comparing two copies shows any rewrite.
- **Never enable PostgREST `db-tx-end = rollback-allowed`** (or any "rollback" transaction-end setting) on this project. With it, a client could ask for a rolled-back request and still receive `member_data_export()` rows while the export-log insert is rolled back, i.e. an untraced export. The default (`commit`) keeps rows and log row in one committed transaction.
- **Inventory/borrowing export log (`nexus.inventory_borrowing_export_logs`)**: same rules as the Member Data log below (append-only, no PII, no pruning, no client grant). Include it in the off-database audit copy (`-t nexus.inventory_borrowing_export_logs`).
- **Item history, request timeline, return outcomes, corrections, evidence records** are append-only for every API role and ordinary hand edits; the owner could still disable the triggers (tamper-evident, not tamper-proof).
- **Export log (`nexus.member_data_export_logs`): no rate limit, no pruning.** Every successful export adds one small row (ids and settings only, about 100 bytes), and nothing limits how often a holder of `member_data.export` can export. Rows cannot be deleted without disabling the append-only guard trigger. Retention/cleanup is an **owner-approved operation only**: take the off-database copy above first (`-t nexus.member_data_export_logs`), record the decision in `docs/DECISIONS.md`, then the owner disables the trigger, deletes rows older than the agreed cut-off, and re-enables the trigger in the SAME transaction. At hundreds of members and a few exports per month this is not needed for years; no throttle is built (review L3). If exports ever look abusive, read the log (BPH/System Admin) and disable the export rule instead.

## 7. Checklist for every future nexus migration (W5)
1. Only `nexus` objects; never create, alter, grant, or write anything in `public`/`private`.
2. Every new table: `revoke all ... from public, anon, authenticated, service_role;` grant only what is needed; `enable row level security`; explicit policies (default deny). No DELETE grant; archive instead (L5).
3. Every new function: `revoke all on function ... from public, anon, service_role;` (plus `authenticated` for internal `_*` helpers), then grant EXECUTE to `authenticated` only for client API functions. Default privileges do NOT remove the global EXECUTE-to-PUBLIC.
4. Every SECURITY DEFINER function: `set search_path = ''`, fully qualified names, and an explicit caller check (`auth.uid()`-based helper or `nexus._require_system_admin()`).
5. New permission keys: set `allow_baseline` explicitly (no default); `true` only if safe for every active member.
6. Never read email, phone, nim, nip, must_change_password, audit_log, org_settings, grants_admin, or `private.*`. Sole exception (D-015): ONE dedicated function returns the caller's own `must_change_password` as a boolean (never for another member); the structural test must allow exactly that function by name and keep blocking every other.
7. Re-run ALL pgTAP files on a throwaway database and update the expected test counts in `tests/README.md` (adding a key or default rule changes counts in `nexus_access_control.test.sql` section 1 and in `nexus_member_data.test.sql`).
8. Module functions gate on `nexus._require_permission('<key>')` (42501, hint `permission_required`) as their first statement; do not re-implement the permission check.
9. Retiring a default rule: never delete or edit it (A-n8); disable it in the migration and insert its code into `nexus.retired_default_rules` once (see 20261107100000), so "restore defaults" does not bring it back.
10. Anything outside `nexus` (today only Storage, M7) goes in its own migration file, scoped to its own bucket, with the logic in `nexus` functions.
