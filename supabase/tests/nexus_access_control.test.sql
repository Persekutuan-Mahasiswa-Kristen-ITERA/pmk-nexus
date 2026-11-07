-- pgTAP tests for the NEXUS access-control engine (migrations 20261105100000 + 20261105100100) and the
-- D-015 temporary-password check (20261106100000, section 7 plus the L4 whitelist tests in section 1).
-- Counts include the Member Data additions of 20261106200000 (key member_data.view_export_log, rules
-- D32/D33) and the Inventory and Borrowing amendment of 20261107100000 (D-022: key borrowing.handle,
-- D30 retired = disabled, D34-D36 added). The module functions are tested in their own files.
--
-- LOCAL / THROWAWAY DATABASE ONLY. Never run against the hosted (shared) project.
-- It WRITES to PI-CORE tables (auth.users, public.members, public.periods, public.assignments) inside
-- a transaction that ends with ROLLBACK. To make an accidental run harmless, the file refuses to do
-- anything unless the session sets nexus.allow_destructive_tests = 'yes' (see tests/README.md):
--   PGOPTIONS='-c nexus.allow_destructive_tests=yes' psql "<local url>" -f supabase/tests/nexus_access_control.test.sql
-- Preconditions: local Supabase with the PI-CORE migrations applied, then all NEXUS migrations.
-- Everything runs inside ONE transaction that ends with ROLLBACK: the test personas, periods, and
-- assignments written into PI-CORE tables, and the helper schema `nexus_test`, never persist.
--
-- Personas follow docs/modules/access-control.md section 9, with these unavoidable deviations
-- (PI-CORE allows one holder per unique position per unit and period):
--   * P-BEND = Bendahara Umum 1; P-BEND-SEK = Bendahara Umum 2 + Sekretaris Departemen in
--     Departemen TALENTA (P-SEKDEP already holds Departemen Internal).
--   * P-ADMIN-BEND (AC-68) is tested by promoting P-BEND to access_level 'admin' mid-test.
--   * P-SEKDEP2 (AC-21) = Sekretaris Departemen in Pelayanan Khusus + Sekretaris Biro in Biro Kewirausahaan.
--
-- Persona numbers (auth uid 10000000-...-0000000000NN, member id 20000000-...-0000000000NN):
--   1 P-ADMIN  2 P-SUPER  3 P-KETUM  4 P-SEKJEN  5 P-BEND  6 P-SEKDEP  7 P-KADEP-OPS  8 P-STAFF-LOG
--   9 P-STAFF-AKO  10 P-STAFF-PUB  11 P-PLAIN  12 P-BEND-SEK  13 P-OPS-BPH  14 P-OLD  15 P-INACTIVE
--   16 P-LECT  17 P-UNLINKED (auth user, no member)  18 P-SEKDEP2
--   P-TEMPPW (auth-login spec) = P-PLAIN (11) with must_change_password = true in section 7.

\set ON_ERROR_STOP on
begin;

-- W1 guard. Runs inside the transaction on purpose: even if a runner ignores ON_ERROR_STOP, the failed
-- guard leaves the transaction aborted, so every later statement fails and nothing is written.
do $$
begin
  if coalesce(current_setting('nexus.allow_destructive_tests', true), '') <> 'yes' then
    raise exception 'nexus_access_control.test.sql writes test rows into PI-CORE tables: local throwaway database only. Set nexus.allow_destructive_tests=yes (see supabase/tests/README.md) to run it.';
  end if;
end
$$;

-- Data guard (security review M1): the flag above only proves intent. A real project (hosted, shared with
-- PI-CORE) always holds real members, so stop if ANY account or member has an email outside the fake
-- test domains. Checked before anything is written.
do $$
begin
  if exists (select 1 from auth.users u where u.email is null or u.email !~* '@(example\.test|nexus\.test)$')
     or exists (select 1 from public.members m where m.email is not null and m.email !~* '@(example\.test|nexus\.test)$') then
    raise exception 'nexus_access_control.test.sql: found a non-test email address, so this is NOT a throwaway local database. Nothing was written.';
  end if;
end
$$;

-- Dev-stack guard (review L5): the NEXUS dev stack is seeded with fake accounts under @nexus.test
-- (supabase/local/seed_test_accounts.sql, e.g. ketum@nexus.test). This file assumes a FRESH database
-- and only uses @example.test, so any @nexus.test account means "wrong database": stop before writing.
do $$
begin
  if exists (select 1 from auth.users u where u.email ~* '@nexus\.test$')
     or exists (select 1 from public.members m where m.email ~* '@nexus\.test$') then
    raise exception 'nexus_access_control.test.sql: found the NEXUS dev stack seed accounts (@nexus.test). Run it only in a fresh throwaway container (see supabase/tests/README.md). Nothing was written.';
  end if;
end
$$;

create extension if not exists pgtap with schema extensions;
-- no_plan: expected total is documented in tests/README.md (update it when adding tests).
select no_plan();

-- ---------------------------------------------------------------------------------------------
-- Test helpers (rolled back with everything else)
-- ---------------------------------------------------------------------------------------------
create schema nexus_test;
grant usage on schema nexus_test to authenticated;

create function nexus_test.uid(n int) returns uuid language sql immutable
as $$ select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function nexus_test.mid(n int) returns uuid language sql immutable
as $$ select ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function nexus_test.period(n int) returns uuid language sql immutable
as $$ select ('f0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function nexus_test.unit(p_name text) returns uuid language sql stable security definer set search_path = ''
as $$ select u.id from public.org_units u where u.name = p_name $$;
create function nexus_test.pos(p_unit_type text, p_name text) returns uuid language sql stable security definer set search_path = ''
as $$ select po.id from public.positions po where po.unit_type::text = p_unit_type and po.name = p_name $$;

-- Impersonate persona n exactly like PostgREST does (role + JWT claims). Call after `reset role;`.
create function nexus_test.login_as(n int) returns void language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', nexus_test.uid(n), 'role', 'authenticated')::text, true);
  -- Older auth.uid() (bare supabase/postgres image) reads the legacy per-claim setting instead.
  perform set_config('request.jwt.claim.sub', nexus_test.uid(n)::text, true);
  perform set_config('role', 'authenticated', true);
end
$$;
-- Back to the migration role with no JWT (call after `reset role;`).
create function nexus_test.logout() returns void language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;
-- Runs p_sql and returns the error HINT it raised (our stable error ids), or 'no_error'. Always rolls
-- the statement back (the success path raises too), so a test never leaves side effects behind.
create function nexus_test.hint_of(p_sql text) returns text language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  raise exception 'statement succeeded' using hint = 'no_error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'no_hint: ' || sqlerrm);
end
$$;
grant execute on all functions in schema nexus_test to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select nexus_test.uid(n), 'nexus-test-' || n || '@example.test', 'authenticated', 'authenticated'
from generate_series(1, 18) n;

insert into public.members (id, user_id, full_name, email, access_level, member_type)
select nexus_test.mid(n), nexus_test.uid(n), 'Test Persona ' || n, 'nexus-test-' || n || '@example.test',
       (case n when 1 then 'admin' when 2 then 'super_admin' else 'member' end)::public.access_level,
       (case n when 16 then 'lecturer' else 'student' end)::public.member_type
from generate_series(1, 18) n
where n <> 17;  -- P-UNLINKED has an Auth user but no member row

insert into public.periods (id, label) values
  (nexus_test.period(1), '2090/2091'),
  (nexus_test.period(2), '2091/2092'),
  (nexus_test.period(3), '2092/2093');
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(2);

insert into public.assignments (member_id, org_unit_id, position_id, period_id)
select nexus_test.mid(v.n), nexus_test.unit(v.unit_name), nexus_test.pos(v.unit_type, v.position_name), nexus_test.period(v.p)
from (values
  ( 3, 'BPH PMK ITERA',               'bph',        'Ketua Umum',            2),
  ( 4, 'BPH PMK ITERA',               'bph',        'Sekretaris Jenderal',   2),
  ( 5, 'BPH PMK ITERA',               'bph',        'Bendahara Umum 1',      2),
  ( 6, 'Departemen Internal',         'department', 'Sekretaris Departemen', 2),
  ( 7, 'Departemen Operasional',      'department', 'Kepala Departemen',     2),
  ( 8, 'Logistik',                    'division',   'Staff',                 2),
  ( 9, 'Akomodasi',                   'division',   'Staff',                 2),
  (10, 'Pubdok',                      'division',   'Staff',                 2),
  (12, 'BPH PMK ITERA',               'bph',        'Bendahara Umum 2',      2),
  (12, 'Departemen Talenta',          'department', 'Sekretaris Departemen', 2),
  (13, 'Logistik',                    'division',   'Staff',                 2),
  (13, 'BPH PMK ITERA',               'bph',        'Sekretaris Umum 2',     2),
  (14, 'BPH PMK ITERA',               'bph',        'Sekretaris Jenderal',   1),
  (15, 'Departemen Eksternal',        'department', 'Kepala Departemen',     2),
  (18, 'Departemen Pelayanan Khusus', 'department', 'Sekretaris Departemen', 2),
  (18, 'Biro Kewirausahaan',          'bureau',     'Sekretaris Biro',       2)
) as v(n, unit_name, unit_type, position_name, p);

-- P-INACTIVE is deactivated AFTER getting an assignment (PI-CORE refuses assignments for inactive members).
update public.members set is_active = false where id = nexus_test.mid(15);

select is((select count(*)::int from public.assignments where member_id::text like '20000000-%'), 16,
  'fixtures: 16 persona assignments created (PI-CORE names match the test)');

-- =============================================================================================
-- 1. Structure, privileges, catalog, seed
-- =============================================================================================
select has_schema('nexus');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'AC-50: RLS is enabled on every nexus table');

select ok(not has_schema_privilege('anon', 'nexus', 'usage'), 'anon has no USAGE on schema nexus');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p', 'v')
             and has_table_privilege('anon', c.oid, 'select, insert, update, delete')), 0,
  'anon has no table privileges in nexus');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p')
             and has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')), 0,
  'L11: authenticated cannot write any nexus table directly');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and has_function_privilege('anon', p.oid, 'execute')), 0,
  'anon cannot execute any nexus function');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like '\_%'
             and has_function_privilege('authenticated', p.oid, 'execute')), 0,
  'authenticated cannot execute internal nexus._* functions');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.prosecdef
             and not coalesce(p.proconfig @> array['search_path=""'], false)), 0,
  'D-010: every SECURITY DEFINER function pins search_path to empty');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus'
             and p.proargnames && array['email', 'phone', 'nim', 'nip', 'must_change_password']), 0,
  'AC-47/AC-56: no nexus function takes or returns email, phone, nim, nip, must_change_password');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus'
             and p.prosrc ~* '(\m(email|phone|nim|nip|audit_log|org_settings|grants_admin)\M|private\.)'), 0,
  'AC-47/AC-49/L4: no nexus function body reads PII, audit_log, org_settings, grants_admin, or private.*');

-- L4 / D-015: must_change_password may appear in EXACTLY one function body, identified by its full
-- signature (an overload with a parameter would have a different signature and is caught).
create function nexus_test.mcp_readers() returns text[] language sql stable
as $$
  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'nexus' and p.prosrc ~* '\mmust_change_password\M'
$$;
select is(nexus_test.mcp_readers(), array['nexus.my_password_change_pending()'],
  'L4/D-015: only nexus.my_password_change_pending() reads must_change_password');

-- The whitelist must still catch any other function. Decoy = the most dangerous shape: an overload of
-- the whitelisted name that takes a member id. Created and dropped inside this rolled-back transaction.
create function nexus.my_password_change_pending(p_member_id uuid) returns boolean language sql stable
as $$ select m.must_change_password from public.members m where m.id = p_member_id $$;
select isnt(nexus_test.mcp_readers(), array['nexus.my_password_change_pending()'],
  'L4/D-015: the whitelist check fails for any other function (decoy overload with a member id)');
drop function nexus.my_password_change_pending(uuid);
create function nexus.zz_decoy_flag() returns boolean language sql stable
as $$ select bool_or(must_change_password) from public.members $$;
select isnt(nexus_test.mcp_readers(), array['nexus.my_password_change_pending()'],
  'L4/D-015: the whitelist check fails for a differently named function');
drop function nexus.zz_decoy_flag();
select is(nexus_test.mcp_readers(), array['nexus.my_password_change_pending()'],
  'L4/D-015: decoys removed again (later structural tests see the real schema)');

-- Shape of the one exception: no parameters, one scalar boolean, INVOKER (PI-CORE RLS applies),
-- empty search_path, EXECUTE for authenticated only (no PUBLIC entry in the ACL).
select ok((select p.pronargs = 0 and p.prorettype = 'boolean'::regtype and not p.proretset
                  and not p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)
           from pg_proc p where p.oid = 'nexus.my_password_change_pending()'::regprocedure),
  'D-015: my_password_change_pending() takes no argument, returns one boolean, INVOKER, empty search_path');
select ok(has_function_privilege('authenticated', 'nexus.my_password_change_pending()', 'execute')
          and not has_function_privilege('anon', 'nexus.my_password_change_pending()', 'execute')
          and not has_function_privilege('service_role', 'nexus.my_password_change_pending()', 'execute')
          and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                          where p.oid = 'nexus.my_password_change_pending()'::regprocedure and a.grantee = 0),
  'D-015: only authenticated may execute my_password_change_pending() (not anon, service_role, PUBLIC)');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p')
             and has_table_privilege('service_role', c.oid, 'insert, update, delete, truncate')), 0,
  'W2: service_role cannot insert/update/delete/truncate any nexus table');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and has_function_privilege('service_role', p.oid, 'execute')), 0,
  'W2: service_role cannot execute any nexus function (server code uses the user session)');

select ok(has_table_privilege('service_role', 'nexus.access_rule_log', 'select'),
  'service_role keeps SELECT on nexus tables (ops/backups)');

select ok((select p.prosecdef from pg_proc p where p.oid = 'nexus.current_member_id()'::regprocedure)
          and (select p.prosecdef from pg_proc p where p.oid = 'nexus.is_system_admin()'::regprocedure),
  'identity helpers are SECURITY DEFINER (independent of PI-CORE RLS/column grants)');

select is((select count(*)::int from nexus.permissions), 22, 'catalog has the 22 permission keys (D-022 added borrowing.handle)');
select is((select array_agg(key order by key) from nexus.permissions where allow_baseline),
          array['inventory.export', 'inventory.view', 'letters.export', 'letters.view', 'minutes.export', 'minutes.view'],
  'L12: exactly these 6 keys may be granted to every active member');
select is((select count(*)::int from nexus.permissions
           where allow_baseline
             and (is_sensitive or module in ('finance', 'member_data') or key ~ '\.(manage|approve|process|handle)$')), 0,
  'L12: no sensitive or power key is baseline-safe');
select throws_ok($$insert into nexus.permissions (key, module, label, description, is_sensitive, allow_baseline)
                   values ('finance.peek', 'finance', 'Peek', 'test', false, true)$$, '23514', null,
  'L12: the catalog constraint refuses a baseline-safe finance key');
select throws_ok($$insert into nexus.permissions (key, module, label, description, is_sensitive, allow_baseline)
                   values ('minutes.approve', 'minutes', 'Approve', 'test', false, true)$$, '23514', null,
  'L12: the catalog constraint refuses a baseline-safe *.approve key');
select is((select count(*)::int from nexus.permission_scopes where scope <> 'all'), 6,
  'only minutes.* (3 keys x 2 unit scopes) accept unit scopes');
select is((select count(*)::int from nexus.access_rules where default_code is not null and is_enabled), 35,
  'seed: 35 enabled default rules (D01-D36 without the retired D30, D-022)');
select ok((select not is_enabled from nexus.access_rules where default_code = 'D30')
          and exists (select 1 from nexus.retired_default_rules where default_code = 'D30'),
  'D-022: D30 is retired (disabled, kept, listed in retired_default_rules)');
select is((select count(*)::int from nexus.access_rule_log where action = 'seed' and actor_member_id is null), 36,
  'seed: 36 seed log rows without an actor');
select is((select position_id from nexus.access_rules where default_code = 'D15'),
          nexus_test.pos('bph', 'Sekretaris Jenderal'), 'seed: D15 stores the Sekretaris Jenderal position id');
select ok((select org_unit_id = nexus_test.unit('Departemen Operasional') and include_child_units
           from nexus.access_rules where default_code = 'D28'),
  'seed: D28 stores Departemen Operasional with include_child_units');
select is((select count(*)::int from nexus.access_rules r join nexus.permissions pk on pk.key = r.permission_key
           where r.default_code is not null and not pk.allow_baseline and r.note is not null), 28,
  'L12: the 28 seeded rules with sensitive/power keys all carry a note');
select is((select array_agg(r.default_code) from nexus.access_rules r where r.subject_type = 'all_members'),
          array['D01'], 'L12: D01 (inventory.view) is the only seeded baseline rule');

-- anon must not even reach the engine (no schema USAGE)
reset role; select nexus_test.logout();
set local role anon;
select throws_ok($$select nexus.has_permission('inventory.view')$$, '42501', null,
  'anon calling nexus.has_permission fails with permission denied');
reset role;

-- =============================================================================================
-- 2. Personas with the default rules
-- =============================================================================================

-- P-UNLINKED (AC-33, AC-50, AC-55 baseline)
reset role; select nexus_test.login_as(17);
select is_empty('select * from nexus.my_context()', 'AC-33: P-UNLINKED has no context (no access)');
select ok(not nexus.has_permission('inventory.view'), 'AC-33: P-UNLINKED gets not even the baseline');
select is((select count(*)::int from nexus.permissions), 0, 'AC-50: P-UNLINKED reads zero catalog rows');
select is((select count(*)::int from nexus.access_rules), 0, 'AC-50: P-UNLINKED reads zero rules');
select is((select count(*)::int from nexus.access_rule_log), 0, 'AC-50: P-UNLINKED reads zero log rows');
select is_empty('select * from nexus.list_positions()', 'L1: P-UNLINKED gets no positions from the picker');
select is_empty('select * from nexus.list_org_units()', 'L1: P-UNLINKED gets no units from the picker');

-- P-INACTIVE (AC-32, L1)
reset role; select nexus_test.login_as(15);
select is_empty('select * from nexus.my_context()', 'AC-32: P-INACTIVE has no context');
select is_empty('select * from nexus.my_permissions()', 'AC-32: P-INACTIVE has no permissions');
select ok(nexus.active_period_id() is null, 'AC-32: P-INACTIVE cannot even see the active period');
select ok(nexus.current_member_id() is null and not nexus.is_system_admin(),
  'L1: DEFINER identity helpers still return nothing for P-INACTIVE');
select is_empty('select * from nexus.list_org_units()', 'L1: P-INACTIVE gets no units from the picker');

-- P-PLAIN (AC-27..AC-29, E7)
reset role; select nexus_test.login_as(11);
select is((select count(*)::int from nexus.my_context()), 1, 'P-PLAIN has a context row');
select ok(not nexus.is_system_admin(), 'P-PLAIN is not System Admin');
select is(nexus.current_member_id(), nexus_test.mid(11), 'current_member_id() answers only about the caller');
select ok((select count(*) from nexus.list_org_units()) > 0, 'an active member sees the unit picker');
select is((select array_agg(permission_key order by permission_key) from nexus.my_permissions()),
          array['inventory.view'], 'AC-28: P-PLAIN has only inventory.view (D01)');
select ok(not nexus.has_permission('finance.view'), 'AC-29: P-PLAIN cannot view Finance');
select ok(not nexus.has_permission('member_data.view'), 'AC-29: P-PLAIN cannot view Member Data');
select is((select count(*)::int from nexus.access_rules), 0, 'AC-29: P-PLAIN reads no rules');
select is((select count(*)::int from nexus.access_rule_log), 0, 'AC-29/AC-60: P-PLAIN cannot read the log');
select throws_ok($$select nexus.add_access_rule('all_members', 'minutes.view')$$, '42501', null,
  'AC-01: P-PLAIN cannot add a rule');

-- P-LECT (AC-46)
reset role; select nexus_test.login_as(16);
select is((select array_agg(permission_key order by permission_key) from nexus.my_permissions()),
          array['inventory.view'], 'AC-46: P-LECT has baseline only');

-- P-ADMIN (AC-02, AC-03, AC-68)
reset role; select nexus_test.login_as(1);
select ok(nexus.is_system_admin(), 'AC-02: P-ADMIN is System Admin');
select ok(not nexus.has_permission('finance.view'), 'AC-03: P-ADMIN cannot view Finance');
select ok(not nexus.has_permission('minutes.view'), 'AC-03: P-ADMIN cannot view minutes');
select ok(not nexus.has_permission('letters.view'), 'AC-03: P-ADMIN cannot view the letter register');
select ok(not nexus.has_permission('member_data.view'), 'AC-03: P-ADMIN cannot view Member Data');
select is((select array_agg(permission_key order by permission_key) from nexus.my_permissions()),
          array['inventory.view'], 'AC-68: being admin alone adds no business rights');
select is((select count(*)::int from nexus.list_access_rules()), 36, 'AC-02: P-ADMIN lists all 36 rules (incl. the retired D30)');
select is((select count(*)::int from nexus.access_rules), 36, 'P-ADMIN can read the rules table');
select is((select count(*)::int from nexus.access_rule_log), 37, 'L3: P-ADMIN can read the log (36 seed rows + the D30 retirement)');
select is((select count(*)::int from nexus.list_access_rules() where stale_reason is not null), 0,
  'no default rule is stale on a fresh database');

-- P-SUPER (AC-02)
reset role; select nexus_test.login_as(2);
select ok(nexus.is_system_admin(), 'AC-02: P-SUPER is System Admin');

-- P-KETUM (AC-06..AC-08, AC-60, AC-01)
reset role; select nexus_test.login_as(3);
select ok(not nexus.is_system_admin(), 'AC-01: P-KETUM is not System Admin');
select ok(nexus.has_permission('finance.view'), 'AC-06: P-KETUM views Finance');
select ok(nexus.has_permission('minutes.view'), 'AC-06: P-KETUM views all minutes');
select ok(nexus.has_permission('minutes.view', nexus_test.unit('Departemen Eksternal')), 'AC-06: ... of every unit');
select ok(nexus.has_permission('letters.view'), 'AC-06: P-KETUM views the letter register');
select ok(nexus.has_permission('letter_requests.view_all'), 'AC-06: P-KETUM views all letter requests');
select ok(nexus.has_permission('inventory.view'), 'AC-06: P-KETUM views inventory');
select ok(nexus.has_permission('borrowing.view_all'), 'AC-06: P-KETUM views all borrowing');
select ok(nexus.has_permission('member_data.view'), 'AC-06: P-KETUM views Member Data');
select ok(nexus.has_permission('finance.export') and nexus.has_permission('member_data.export')
          and nexus.has_permission('inventory.export') and nexus.has_permission('borrowing.export'),
  'AC-08: P-KETUM can export what they view');
select ok(not nexus.has_permission('finance.manage'), 'AC-07: P-KETUM cannot manage Finance');
select ok(not nexus.has_permission('minutes.manage'), 'AC-07: P-KETUM cannot manage minutes');
select ok(not nexus.has_permission('letters.manage'), 'AC-07: P-KETUM cannot manage letters');
select ok(not nexus.has_permission('inventory.manage'), 'AC-07: P-KETUM cannot manage inventory');
select ok(not nexus.has_permission('borrowing.approve'), 'AC-07: P-KETUM cannot approve borrowing');
select is((select count(*)::int from nexus.access_rule_log), 37, 'AC-60: P-KETUM (BPH) reads the log');
select is((select count(*)::int from nexus.access_rules), 0, 'AC-01: P-KETUM reads no rows of the rules table');
select throws_ok($$select * from nexus.list_access_rules()$$, '42501', null, 'AC-01: P-KETUM cannot open the rules list');
select throws_ok($$select nexus.disable_access_rule((select rule_id from nexus.access_rule_log limit 1))$$, '42501', null,
  'AC-60: P-KETUM cannot disable a rule');

-- P-KADEP-OPS (AC-04, AC-22)
reset role; select nexus_test.login_as(7);
select ok(not nexus.is_system_admin(), 'AC-04: Kepala Departemen is not System Admin (PI-CORE organization_admin ignored)');
select ok(nexus.has_permission('inventory.manage') and nexus.has_permission('borrowing.approve'),
  'AC-22: P-KADEP-OPS manages inventory and approves borrowing');
select ok(not nexus.has_permission('finance.view'), 'P-KADEP-OPS cannot view Finance');

-- P-SEKJEN (AC-09..AC-12)
reset role; select nexus_test.login_as(4);
select ok(nexus.has_permission('letters.manage') and nexus.has_permission('letters.view'),
  'AC-09: P-SEKJEN manages (and therefore views) letters');
select ok(nexus.has_permission('letter_requests.process') and nexus.has_permission('letter_requests.view_all'),
  'AC-09: P-SEKJEN processes letter requests (includes view_all)');
select ok(nexus.has_permission('minutes.manage', nexus_test.unit('BPH PMK ITERA')),
  'AC-10: P-SEKJEN manages minutes of any unit, including BPH');
select ok(not nexus.has_permission('finance.manage'), 'AC-11: P-SEKJEN cannot manage Finance');
select ok(not nexus.has_permission('borrowing.approve'), 'AC-11: P-SEKJEN cannot approve borrowing');
select ok(not nexus.can_process_request('letter_requests.process', nexus_test.mid(4)),
  'AC-12/L6: P-SEKJEN cannot process their own letter request');
select ok(nexus.can_process_request('letter_requests.process', nexus_test.mid(11)),
  'AC-09: P-SEKJEN can process another member''s request');

-- P-BEND (AC-14, AC-16)
reset role; select nexus_test.login_as(5);
select ok(nexus.has_permission('finance.manage') and nexus.has_permission('finance.view')
          and nexus.has_permission('finance.export'), 'AC-14: P-BEND manages, views, exports Finance');
select ok(not nexus.has_permission('minutes.manage') and not nexus.has_permission('letters.manage')
          and not nexus.has_permission('borrowing.approve'), 'AC-16: P-BEND has no minutes/letters/borrowing management');

-- P-SEKDEP (AC-17..AC-20, AC-67)
reset role; select nexus_test.login_as(6);
select ok(nexus.has_permission('minutes.manage', nexus_test.unit('Departemen Internal')),
  'AC-17: P-SEKDEP manages minutes of Departemen Internal');
select ok(not nexus.has_permission('minutes.manage', nexus_test.unit('Departemen Eksternal')),
  'AC-17: ... and not of another unit');
select ok(not nexus.has_permission('minutes.manage'), 'own-unit scope never answers true without a unit');
select ok(not nexus.has_permission('minutes.view', nexus_test.unit('Departemen Eksternal')),
  'AC-18: P-SEKDEP cannot see minutes of Departemen Eksternal');
select ok(nexus.has_permission('minutes.export', nexus_test.unit('Departemen Internal')),
  'D27: P-SEKDEP exports own-unit minutes');
select is(nexus.permission_unit_ids('minutes.manage'), array[nexus_test.unit('Departemen Internal')],
  'AC-67: own-unit scope = exactly the assignment unit');
select ok(not nexus.has_permission('letters.view') and not nexus.has_permission('letter_requests.process'),
  'AC-19: P-SEKDEP cannot view the register or process letter requests');
select ok(not nexus.has_permission('finance.view') and not nexus.has_permission('member_data.view'),
  'AC-20: P-SEKDEP cannot view Finance or Member Data');

-- P-SEKDEP2 (AC-21, E9)
reset role; select nexus_test.login_as(18);
select ok(nexus.has_permission('minutes.manage', nexus_test.unit('Departemen Pelayanan Khusus'))
          and nexus.has_permission('minutes.manage', nexus_test.unit('Biro Kewirausahaan')),
  'AC-21: secretary of two units manages minutes of both');
select ok(not nexus.has_permission('minutes.manage', nexus_test.unit('Departemen Internal')),
  'AC-21: ... and of no other unit');
select is((select cardinality(unit_ids) from nexus.my_permissions() where permission_key = 'minutes.manage'), 2,
  'my_permissions lists both units for minutes.manage');

-- Operations (AC-22, AC-23, AC-24, AC-26)
reset role; select nexus_test.login_as(8);
select ok(nexus.has_permission('inventory.manage') and nexus.has_permission('borrowing.handle')
          and not nexus.has_permission('borrowing.approve'),
  'AC-22 (D-022): P-STAFF-LOG (child division) manages inventory and handles borrowing, but does not approve');
select ok(not nexus.can_process_request('borrowing.approve', nexus_test.mid(8)),
  'AC-24/L6: P-STAFF-LOG cannot approve their own borrowing request');
select ok(not nexus.can_process_request('borrowing.approve', nexus_test.mid(11))
          and not nexus.can_process_request('borrowing.handle', nexus_test.mid(11)),
  'AC-22 (D-022): P-STAFF-LOG approves nobody''s request; handle is not an approval key');
select ok(not nexus.has_permission('finance.view') and not nexus.has_permission('letters.view')
          and not nexus.has_permission('minutes.view'), 'AC-26: P-STAFF-LOG cannot view Finance, register, minutes');
reset role; select nexus_test.login_as(9);
select ok(nexus.has_permission('inventory.manage'), 'AC-22: Staff in Akomodasi manages inventory');
reset role; select nexus_test.login_as(10);
select ok(not nexus.has_permission('inventory.manage') and not nexus.has_permission('borrowing.approve'),
  'AC-23: P-STAFF-PUB (not Operations) cannot manage inventory or approve borrowing');

-- Combining (AC-35, AC-36, E1, E2)
reset role; select nexus_test.login_as(12);
select ok(nexus.has_permission('finance.manage'), 'AC-35: P-BEND-SEK manages Finance');
select ok(nexus.has_permission('minutes.view', nexus_test.unit('Departemen Eksternal')),
  'AC-35: P-BEND-SEK views minutes of every unit (via bph)');
select ok(nexus.has_permission('minutes.manage', nexus_test.unit('Departemen Talenta')),
  'AC-35: P-BEND-SEK manages minutes of own secretary unit');
select ok(not nexus.has_permission('minutes.manage', nexus_test.unit('Departemen Eksternal')),
  'AC-35: P-BEND-SEK cannot manage minutes of another unit');
select ok(not nexus.has_permission('letter_requests.process'), 'E1: P-BEND-SEK cannot process letter requests');
reset role; select nexus_test.login_as(13);
select ok(nexus.has_permission('borrowing.handle') and not nexus.has_permission('borrowing.approve')
          and nexus.has_permission('letter_requests.process')
          and nexus.has_permission('letters.manage') and nexus.has_permission('finance.view')
          and nexus.has_permission('member_data.view'), 'AC-36: P-OPS-BPH unions Operations, BPH, BPH secretary');

-- P-OLD before any switch (AC-40 precondition)
reset role; select nexus_test.login_as(14);
select ok(not nexus.has_permission('letters.manage') and not nexus.has_permission('finance.view'),
  'R1: P-OLD (previous-period assignment only) gets nothing from it');

-- Warnings with everybody in place (AC-64 baseline)
reset role; select nexus_test.login_as(1);
select is((select array_agg(permission_key || ':' || warning) from nexus.access_rule_warnings() where warning is not null),
          array['borrowing.approve:single_holder'],
  'AC-64/B29: only borrowing.approve warns: the fixtures have one Operations head (D34/D35)');
select is((select holder_count from nexus.access_rule_warnings() where permission_key = 'borrowing.approve'), 1,
  'borrowing.approve holders (D-022): KADEP-OPS only');
select is((select holder_count from nexus.access_rule_warnings() where permission_key = 'borrowing.handle'), 4,
  'borrowing.handle holders (D36): KADEP-OPS, STAFF-LOG, STAFF-AKO, OPS-BPH');

-- =============================================================================================
-- 3. Rule management by the System Admin (AC-52..AC-67)
-- =============================================================================================
reset role; select nexus_test.login_as(1);

select throws_ok($$select nexus.add_access_rule('member', 'inventory.manage')$$, '22023', null,
  'AC-61: no subject type for an individual member');
select throws_ok($$select nexus.add_access_rule('role', 'finance.view', 'own_unit', 'staff', p_confirm_sensitive => true)$$,
  '22023', null, 'AC-62: own_unit rejected on finance.view');
select throws_ok($$select nexus.add_access_rule('all_members', 'minutes.view', 'own_unit')$$, '22023', null,
  'AC-62: own_unit rejected on a baseline rule');
select throws_ok($$select nexus.add_access_rule('role', 'nexus.nothing')$$, '22023', null, 'unknown permission key rejected');
select throws_ok($$select nexus.add_access_rule('role', 'minutes.view', 'all', 'no_such_role')$$, '22023', null,
  'role key missing in PI-CORE rejected (B30)');
select throws_ok($$select nexus.add_access_rule('position', 'minutes.view', p_position_id => gen_random_uuid())$$,
  '22023', null, 'unknown position rejected');
select throws_ok($$select nexus.add_access_rule('org_unit', 'minutes.view', p_org_unit_id => nexus_test.unit('Pubdok'),
                    p_position_id => nexus_test.pos('department', 'Kepala Departemen'))$$,
  '22023', null, 'position limit that can never be held in the unit is rejected');
select throws_ok($$select nexus.add_access_rule('role', 'minutes.view', 'all', 'staff', p_position_id => nexus_test.pos('division', 'Staff'))$$,
  '22023', null, 'fields of another subject type are rejected');
select throws_ok($$select nexus.add_access_rule('role', 'finance.view', 'all', 'bph', p_note => 'dup', p_confirm_sensitive => true)$$,
  '23505', null, 'AC-65: duplicate of D02 rejected');
select throws_ok($$select nexus.add_access_rule('role', 'finance.view', 'all', 'staff', p_note => 'why')$$, 'P0001', null,
  'AC-63: sensitive grant without confirmation rejected');

-- L12 / D-013: sensitive and power keys never go to every active member (RPC path)
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'finance.view', p_note => 'x', p_confirm_sensitive => true)$$),
  'baseline_not_allowed', 'L12: finance.view to all_members rejected (RPC)');
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'finance.manage', p_note => 'x', p_confirm_sensitive => true)$$),
  'baseline_not_allowed', 'L12: finance.manage to all_members rejected (RPC)');
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'member_data.view', p_note => 'x', p_confirm_sensitive => true)$$),
  'baseline_not_allowed', 'L12: member_data.view to all_members rejected (RPC)');
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'letters.manage', p_note => 'x')$$),
  'baseline_not_allowed', 'L12: letters.manage to all_members rejected (RPC)');
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'borrowing.approve', p_note => 'x')$$),
  'baseline_not_allowed', 'L12: borrowing.approve to all_members rejected (RPC)');
select is((select array_agg(pk.key order by pk.key) from nexus.permissions pk
           where not pk.allow_baseline
             and nexus_test.hint_of(format(
                   'select nexus.add_access_rule(%L, %L, p_note => %L, p_confirm_sensitive => true)',
                   'all_members', pk.key, 'x')) is distinct from 'baseline_not_allowed'),
          null, 'L12: every one of the 16 locked keys is rejected for all_members (RPC)');
select throws_ok($$select nexus.add_access_rule('all_members', 'finance.view', p_note => 'x', p_confirm_sensitive => true)$$,
  '22023', null, 'L12: rejection uses errcode 22023');

-- L12: a role/position/unit grant of a sensitive or power key needs a written reason
select is(nexus_test.hint_of($$select nexus.add_access_rule('role', 'finance.view', 'all', 'staff', p_confirm_sensitive => true)$$),
  'note_required', 'L12: finance.view to a role without a note rejected');
select is(nexus_test.hint_of($$select nexus.add_access_rule('role', 'finance.manage', 'all', 'staff', p_note => '   ', p_confirm_sensitive => true)$$),
  'note_required', 'L12: a blank (spaces only) note counts as no note');
select is(nexus_test.hint_of($$select nexus.add_access_rule('position', 'member_data.view',
                                p_position_id => nexus_test.pos('department', 'Kepala Departemen'), p_confirm_sensitive => true)$$),
  'note_required', 'L12: member_data.view to a position without a note rejected');
select is(nexus_test.hint_of($$select nexus.add_access_rule('position', 'letters.manage',
                                p_position_id => nexus_test.pos('department', 'Kepala Departemen'))$$),
  'note_required', 'L12: letters.manage to a position without a note rejected');
select is(nexus_test.hint_of($$select nexus.add_access_rule('org_unit', 'borrowing.approve', p_org_unit_id => nexus_test.unit('Pubdok'))$$),
  'note_required', 'L12: borrowing.approve to a unit without a note rejected');
select is(nexus_test.hint_of($$select nexus.add_access_rule('role', 'minutes.view', 'all', 'staff', p_note => repeat('x', 501))$$),
  'note_too_long', 'over-long note gets a friendly hint, not a raw constraint error');
select is(nexus_test.hint_of($$select nexus.add_access_rule('role', 'minutes.view', 'all', 'staff')$$),
  'no_error', 'a baseline-safe key to a role still needs no note');

select lives_ok($$select nexus.add_access_rule('role', 'finance.manage', 'all', 'staff',
                   p_note => '  L12 test: reason given  ', p_confirm_sensitive => true)$$,
  'L12: finance.manage to a role WITH a note works');
select lives_ok($$select nexus.add_access_rule('position', 'letters.manage',
                   p_position_id => nexus_test.pos('department', 'Kepala Departemen'), p_note => 'L12 test')$$,
  'L12: letters.manage to a position WITH a note works');
select ok((select r.note = 'L12 test: reason given' and l.note = 'L12 test: reason given'
           from nexus.access_rules r join nexus.access_rule_log l on l.rule_id = r.id
           where r.subject_type = 'role' and r.role_key = 'staff' and r.permission_key = 'finance.manage'),
  'the note is stored trimmed in the rule AND in the log');
select ok(nexus.disable_access_rule((select r.id from nexus.access_rules r
                                     where r.role_key = 'staff' and r.permission_key = 'finance.manage'))
          and nexus.disable_access_rule((select r.id from nexus.access_rules r
                                         where r.subject_type = 'position' and r.permission_key = 'letters.manage'
                                           and r.position_id = nexus_test.pos('department', 'Kepala Departemen'))),
  'cleanup: disable the two L12 test rules (disabling needs no note)');

-- L12 in the database itself: direct inserts as the owner (SQL editor) are rejected too
reset role; select nexus_test.logout();
select is(nexus_test.hint_of($$insert into nexus.access_rules (subject_type, permission_key, scope, note)
                                values ('all_members', 'finance.view', 'all', 'x')$$),
  'baseline_not_allowed', 'L12: direct insert of finance.view for all_members rejected (owner)');
select is(nexus_test.hint_of($$insert into nexus.access_rules (subject_type, permission_key, scope, note)
                                values ('all_members', 'finance.manage', 'all', 'x')$$),
  'baseline_not_allowed', 'L12: direct insert of finance.manage for all_members rejected (owner)');
select is(nexus_test.hint_of($$insert into nexus.access_rules (subject_type, permission_key, scope, note)
                                values ('all_members', 'member_data.view', 'all', 'x')$$),
  'baseline_not_allowed', 'L12: direct insert of member_data.view for all_members rejected (owner)');
select is(nexus_test.hint_of($$insert into nexus.access_rules (subject_type, permission_key, scope, note)
                                values ('all_members', 'letters.manage', 'all', 'x')$$),
  'baseline_not_allowed', 'L12: direct insert of letters.manage for all_members rejected (owner)');
select is(nexus_test.hint_of($$insert into nexus.access_rules (subject_type, permission_key, scope, note)
                                values ('all_members', 'borrowing.approve', 'all', 'x')$$),
  'baseline_not_allowed', 'L12: direct insert of borrowing.approve for all_members rejected (owner)');
select is(nexus_test.hint_of($$insert into nexus.access_rules (subject_type, role_key, permission_key, scope)
                                values ('role', 'staff', 'finance.manage', 'all')$$),
  'note_required', 'L12: direct insert of finance.manage for a role without a note rejected (owner)');
select is(nexus_test.hint_of($$insert into nexus.access_rules (subject_type, role_key, permission_key, scope, note)
                                values ('role', 'staff', 'borrowing.approve', 'all', '  ')$$),
  'note_required', 'L12: direct insert with a blank note rejected (owner)');
select nexus_test.login_as(1);

-- AC-52 / AC-53: position Staff in unit Pubdok gets inventory.manage
select lives_ok($$select nexus.add_access_rule('org_unit', 'inventory.manage',
                   p_org_unit_id => nexus_test.unit('Pubdok'), p_position_id => nexus_test.pos('division', 'Staff'),
                   p_note => 'test AC-52')$$, 'AC-52: admin adds a unit+position rule');
reset role; select nexus_test.login_as(10);
select ok(nexus.has_permission('inventory.manage'), 'AC-52: P-STAFF-PUB gets it on the next request');
reset role; select nexus_test.login_as(1);
select ok((select l.action = 'add' and l.actor_member_id = nexus_test.mid(1) and l.before_data is null
                  and not l.is_self_benefit and l.note = 'test AC-52'
           from nexus.access_rule_log l
           join nexus.access_rules r on r.id = l.rule_id
           where r.org_unit_id = nexus_test.unit('Pubdok') and r.permission_key = 'inventory.manage'),
  'AC-59: add is logged with actor, empty before, note, no self-benefit');
select ok(nexus.disable_access_rule((select r.id from nexus.access_rules r
                                     where r.org_unit_id = nexus_test.unit('Pubdok') and r.permission_key = 'inventory.manage')),
  'AC-53: admin disables the rule');
select ok(not nexus.disable_access_rule((select r.id from nexus.access_rules r
                                         where r.org_unit_id = nexus_test.unit('Pubdok') and r.permission_key = 'inventory.manage')),
  'disabling twice is a no-op');
reset role; select nexus_test.login_as(10);
select ok(not nexus.has_permission('inventory.manage'), 'AC-53: P-STAFF-PUB loses it on the next request');
reset role; select nexus_test.login_as(1);
select is((select count(*)::int from nexus.list_access_rules()
           where org_unit_id = nexus_test.unit('Pubdok') and permission_key = 'inventory.manage' and not is_enabled), 1,
  'AC-53: the disabled rule stays in the list');
select is(nexus_test.hint_of($$select nexus.enable_access_rule((select r.id from nexus.access_rules r
                                where r.org_unit_id = nexus_test.unit('Pubdok') and r.permission_key = 'inventory.manage'))$$),
  'note_required', 'L12: re-enabling a power-key rule needs a note');
select ok(nexus.enable_access_rule((select r.id from nexus.access_rules r
                                    where r.org_unit_id = nexus_test.unit('Pubdok') and r.permission_key = 'inventory.manage'),
                                   p_note => 'test re-enable'),
  'AC-53: admin enables it again (with a note)');
reset role; select nexus_test.login_as(10);
select ok(nexus.has_permission('inventory.manage'), 'AC-53: P-STAFF-PUB has it again');
reset role; select nexus_test.login_as(1);
select is((select array_agg(l.action order by l.id) from nexus.access_rule_log l
           join nexus.access_rules r on r.id = l.rule_id
           where r.org_unit_id = nexus_test.unit('Pubdok') and r.permission_key = 'inventory.manage'),
          array['add', 'disable', 'enable'], 'AC-59: add, disable, enable each logged once');
select ok((select l.before_data ->> 'is_enabled' = 'true' and l.after_data ->> 'is_enabled' = 'false'
           from nexus.access_rule_log l join nexus.access_rules r on r.id = l.rule_id
           where r.org_unit_id = nexus_test.unit('Pubdok') and r.permission_key = 'inventory.manage' and l.action = 'disable'),
  'AC-59: disable log row holds the full rule before and after');

-- AC-66: include_child_units on / off
select lives_ok($$select nexus.add_access_rule('org_unit', 'minutes.view', p_org_unit_id => nexus_test.unit('Departemen CMIT'))$$,
  'AC-66: unit rule without child units');
reset role; select nexus_test.login_as(10);
select ok(not nexus.has_permission('minutes.view'), 'AC-66: flag off does not cover a division (Pubdok)');
reset role; select nexus_test.login_as(1);
select lives_ok($$select nexus.add_access_rule('org_unit', 'minutes.view', p_org_unit_id => nexus_test.unit('Departemen CMIT'),
                   p_include_child_units => true)$$, 'AC-66: same unit with child units is not a duplicate');
reset role; select nexus_test.login_as(10);
select ok(nexus.has_permission('minutes.view'), 'AC-66: flag on covers the division');

-- R15: export never exceeds view
reset role; select nexus_test.login_as(1);
select lives_ok($$select nexus.add_access_rule('role', 'member_data.export', p_role_key => 'staff',
                   p_note => 'test R15', p_confirm_sensitive => true)$$,
  'admin grants member_data.export to role staff (no view)');
reset role; select nexus_test.login_as(8);
select ok(not nexus.has_permission('member_data.export'), 'R15: export without view grants nothing');

-- AC-55 / E20: a broad baseline rule (finance.view is impossible since L12, so minutes.view)
reset role; select nexus_test.login_as(1);
select lives_ok($$select nexus.add_access_rule('all_members', 'minutes.view')$$,
  'E20: a baseline rule for a baseline-safe key is saved (no note needed)');
select ok((select l.is_self_benefit and not l.is_sensitive from nexus.access_rule_log l
           join nexus.access_rules r on r.id = l.rule_id
           where r.subject_type = 'all_members' and r.permission_key = 'minutes.view'),
  'B28: a baseline grant is flagged self-benefit');
reset role; select nexus_test.login_as(11);
select ok(nexus.has_permission('minutes.view'), 'E20: every active member now views minutes');
select ok(not nexus.has_permission('finance.view'), 'L12: ... but still never Finance');
reset role; select nexus_test.login_as(15);
select ok(not nexus.has_permission('minutes.view'), 'AC-55: P-INACTIVE still gets nothing');
reset role; select nexus_test.login_as(17);
select ok(not nexus.has_permission('minutes.view'), 'AC-55: P-UNLINKED still gets nothing');
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select r.id from nexus.access_rules r
                                     where r.subject_type = 'all_members' and r.permission_key = 'minutes.view')),
  'cleanup: disable the baseline minutes rule');

-- AC-57: self-approval stays blocked even when a broad rule grants the approval key
-- (a baseline approve rule is impossible since L12, so the whole bph role gets it)
select lives_ok($$select nexus.add_access_rule('role', 'borrowing.approve', 'all', 'bph', p_note => 'test AC-57')$$,
  'borrowing.approve for role bph');
reset role; select nexus_test.login_as(3);
select ok(not nexus.can_process_request('borrowing.approve', nexus_test.mid(3)), 'AC-57: P-KETUM cannot approve own request');
select ok(nexus.can_process_request('borrowing.approve', nexus_test.mid(11)), 'AC-57: ... but can approve another''s');
reset role; select nexus_test.login_as(5);
select ok(not nexus.can_process_request('finance.manage', nexus_test.mid(3)),
  'can_process_request only accepts approval keys (P-BEND holds finance.manage)');
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select r.id from nexus.access_rules r
                                     where r.role_key = 'bph' and r.permission_key = 'borrowing.approve')),
  'cleanup: disable the bph approve rule');

-- AC-68 + B28 self-benefit through an assignment: P-BEND becomes admin (as P-ADMIN-BEND)
reset role; select nexus_test.logout();
update public.members set access_level = 'admin' where id = nexus_test.mid(5);
select nexus_test.login_as(5);
select ok(nexus.is_system_admin() and nexus.has_permission('finance.manage'),
  'AC-68: admin + Treasurer keeps Finance rights through the position');
select lives_ok($$select nexus.add_access_rule('position', 'letters.view', p_position_id => nexus_test.pos('bph', 'Bendahara Umum 1'))$$,
  'P-ADMIN-BEND adds a rule for their own position');
select ok((select l.is_self_benefit from nexus.access_rule_log l join nexus.access_rules r on r.id = l.rule_id
           where r.subject_type = 'position' and r.permission_key = 'letters.view'),
  'B28: rule matching the actor''s own assignment is flagged self-benefit');

-- AC-54 / R10: a stale rule written by hand (bypassing the RPC) grants nothing and is flagged
reset role; select nexus_test.logout();
insert into nexus.access_rules (subject_type, position_id, permission_key, scope, note)
values ('position', '00000000-0000-4000-8000-00000000dead', 'letters.manage', 'all', 'test R10 hand edit');
select is((select count(*)::int from nexus.access_rule_log l join nexus.access_rules r on r.id = l.rule_id
           where r.position_id = '00000000-0000-4000-8000-00000000dead' and l.actor_member_id is null and l.action = 'add'), 1,
  'R10: a hand-written rule is still logged (actor null)');
select is((select l.note from nexus.access_rule_log l join nexus.access_rules r on r.id = l.rule_id
           where r.position_id = '00000000-0000-4000-8000-00000000dead'),
  'test R10 hand edit', 'R10: a hand-written rule''s note is copied into the log');
select nexus_test.login_as(1);
select is((select stale_reason from nexus.list_access_rules() where position_id = '00000000-0000-4000-8000-00000000dead'),
  'position_missing', 'AC-54: stale rule is flagged');
select is((select matching_members from nexus.list_access_rules() where position_id = '00000000-0000-4000-8000-00000000dead'),
  0, 'AC-54: stale rule matches nobody');

-- AC-59 / L5 / L11: immutability
select throws_ok($$update nexus.access_rules set is_enabled = false$$, '42501', null,
  'L11: even the admin cannot write the rules table directly');
select throws_ok($$delete from nexus.access_rule_log$$, '42501', null, 'L11: even the admin cannot delete log rows');
reset role; select nexus_test.logout();
select throws_ok($$update nexus.access_rule_log set note = 'tampered'$$, '42501', null, 'L11: log rows cannot be edited (owner)');
select throws_ok($$delete from nexus.access_rule_log$$, '42501', null, 'L11: log rows cannot be deleted (owner)');
select throws_ok($$truncate nexus.access_rule_log$$, '42501', null, 'L11: log cannot be truncated');
select throws_ok($$delete from nexus.access_rules where default_code = 'D01'$$, '42501', null, 'L5: rules cannot be deleted');
select throws_ok($$update nexus.access_rules set scope = 'own_unit' where default_code = 'D04'$$, '42501', null,
  'A-n8: rule content cannot be edited in place');

-- =============================================================================================
-- 4. Period change (AC-38..AC-43, AC-64, R11)
-- =============================================================================================

-- Switch to an empty new period
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(3);
select nexus_test.login_as(1);
select is((select array_agg(warning order by permission_key) from nexus.access_rule_warnings()),
          array['no_holder', 'no_holder', 'no_holder', 'no_holder', 'no_holder'],
  'AC-64: every watched key warns after a period switch with no rule edit');
reset role; select nexus_test.login_as(4);
select ok(not nexus.has_permission('letters.manage'), 'AC-38: P-SEKJEN loses old-period rights on the next request');
reset role; select nexus_test.login_as(3);
select ok(not nexus.has_permission('finance.view'), 'AC-38: P-KETUM loses old-period rights');
select ok(nexus.has_permission('inventory.view'), 'AC-38: ... but keeps baseline');

-- AC-39: new treasurer in the new period works at once
reset role; select nexus_test.logout();
insert into public.assignments (member_id, org_unit_id, position_id, period_id)
values (nexus_test.mid(11), nexus_test.unit('BPH PMK ITERA'), nexus_test.pos('bph', 'Bendahara Umum 1'), nexus_test.period(3));
select nexus_test.login_as(11);
select ok(nexus.has_permission('finance.manage'), 'AC-39: new-period Bendahara Umum 1 manages Finance at once');

-- R1 inverse: P-OLD's period becomes active again
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(1);
select nexus_test.login_as(14);
select ok(nexus.has_permission('letters.manage'), 'R1: rights follow whichever period is active (P-OLD)');
reset role; select nexus_test.login_as(4);
select ok(not nexus.has_permission('letters.manage'), 'AC-40 analogue: holder of a non-active period has nothing');

-- AC-43 / R11: no active period at all
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
select nexus_test.login_as(3);
select ok(nexus.active_period_id() is null, 'R11: no active period');
select ok(not nexus.has_permission('finance.view'), 'AC-43: officers get baseline only');
select ok(nexus.has_permission('inventory.view'), 'AC-43: baseline still works');
reset role; select nexus_test.login_as(1);
select is((select count(*)::int from nexus.list_access_rules()) > 0, true, 'AC-43: P-ADMIN can still open settings');

-- back to the main period
reset role; select nexus_test.logout();
update public.periods set is_active = true where id = nexus_test.period(2);

-- =============================================================================================
-- 5. Deactivation and admin demotion (AC-05, AC-44, E13)
-- =============================================================================================
update public.members set access_level = 'member' where id = nexus_test.mid(1);
select nexus_test.login_as(1);
select ok(not nexus.is_system_admin(), 'AC-05: demoted admin is no longer System Admin');
select throws_ok($$select * from nexus.list_access_rules()$$, '42501', null, 'AC-05: next settings request is denied');
select is((select count(*)::int from nexus.access_rules), 0, 'AC-05: rules table no longer readable');

reset role; select nexus_test.logout();
update public.members set is_active = false where id = nexus_test.mid(3);
select nexus_test.login_as(3);
select is_empty('select * from nexus.my_context()', 'AC-44: deactivated P-KETUM has no context');
select ok(not nexus.has_permission('finance.view'), 'AC-44: ... and no permissions, token still valid');
select is((select count(*)::int from nexus.access_rule_log), 0, 'AC-44: ... and cannot read the log any more');

-- =============================================================================================
-- 6. Everything disabled, then restore defaults (AC-69, E16, B28)
-- =============================================================================================
reset role; select nexus_test.logout();
update nexus.access_rules set is_enabled = false where is_enabled;  -- hand edit, still logged
select nexus_test.login_as(2);
select ok((select count(*)::int from nexus.list_access_rules()) > 0, 'AC-69: P-SUPER still opens the rules screen');
select ok((select count(*)::int from nexus.access_rule_log) > 0, 'AC-69: ... and the log');
select is_empty('select * from nexus.my_permissions()', 'E16: with every rule disabled nobody has a key');
select throws_ok($$select nexus.restore_default_access_rules()$$, 'P0001', null,
  'AC-63: restore re-enabling sensitive defaults needs confirmation');
select is(nexus_test.hint_of($$select nexus.restore_default_access_rules(null, true)$$), 'note_required',
  'L12: restore re-granting sensitive/power defaults needs a note');
select is(nexus_test.hint_of($$select nexus.restore_default_access_rules('   ', true)$$), 'note_required',
  'L12: ... a blank note is not enough');
select is(nexus.restore_default_access_rules('test restore', true), 35, 'B28: restore re-enables the 35 active defaults');
select ok((select not is_enabled from nexus.access_rules where default_code = 'D30'),
  'B28/D-022: restore never brings the retired D30 back');
select is((select count(*)::int from nexus.access_rules where default_code is null and is_enabled), 0,
  'B28: restore never touches custom rules');
select is((select count(*)::int from nexus.access_rule_log where action = 'restore_default'
           and actor_member_id = nexus_test.mid(2) and note = 'test restore'), 35,
  'B28: each restored rule is logged with actor and note');
select ok(nexus.has_permission('inventory.view'), 'restored baseline works again');

-- =============================================================================================
-- 7. Temporary-password gate (D-015, docs/modules/auth-login.md F6, AUTH-19..AUTH-23)
--    PI-CORE's column default is must_change_password = true, so every fixture member starts "true".
--    Reset all personas to false first, then P-TEMPPW = P-PLAIN (11) gets the flag.
--    State here: P-KETUM (3) deactivated in section 5, P-INACTIVE (15) inactive, P-SUPER (2) super_admin.
-- =============================================================================================
reset role; select nexus_test.logout();
update public.members set must_change_password = false where id::text like '20000000-%';
update public.members set must_change_password = true where id in (nexus_test.mid(11), nexus_test.mid(15), nexus_test.mid(3));

reset role; select nexus_test.login_as(11);
select is(nexus.my_password_change_pending(), true, 'AUTH-19: P-TEMPPW (flag true) gets true');
select isnt_empty('select * from nexus.my_context()',
  'AUTH-23: P-TEMPPW still has a context; the gate is app-level only (documented D-015 limit)');

reset role; select nexus_test.login_as(4);
select is(nexus.my_password_change_pending(), false, 'D-015: normal active member (P-SEKJEN) gets false');

-- PI-CORE admins may SELECT every member row (members_select), yet the answer is still only their own.
reset role; select nexus_test.login_as(2);
select is(nexus.my_password_change_pending(), false,
  'AUTH-22: P-SUPER (can read all rows in PI-CORE) gets only their own false, not P-TEMPPW''s true');

reset role; select nexus_test.login_as(15);
select is(nexus.my_password_change_pending(), false, 'D-015: P-INACTIVE with flag true gets false (row hidden; No access decides)');
reset role; select nexus_test.login_as(3);
select is(nexus.my_password_change_pending(), false, 'D-015: member deactivated mid-term with flag true gets false');

reset role; select nexus_test.login_as(17);
select is(nexus.my_password_change_pending(), false, 'D-015: P-UNLINKED gets false (never null)');

-- authenticated role but no JWT subject (auth.uid() is null)
reset role; select nexus_test.logout();
set local role authenticated;
select is(nexus.my_password_change_pending(), false, 'D-015: authenticated without auth.uid() gets false');

reset role; select nexus_test.logout();
set local role anon;
select throws_ok($$select nexus.my_password_change_pending()$$, '42501', null,
  'D-015: anon cannot call my_password_change_pending() (permission denied)');
reset role;
set local role service_role;
select throws_ok($$select nexus.my_password_change_pending()$$, '42501', null,
  'D-015: service_role cannot call my_password_change_pending() (permission denied)');
reset role;

-- Flip the flags: the caller always sees exactly their own value, so nobody can learn another's flag.
update public.members set must_change_password = false where id = nexus_test.mid(11);
update public.members set must_change_password = true where id = nexus_test.mid(2);
select nexus_test.login_as(11);
select is(nexus.my_password_change_pending(), false,
  'AUTH-21: after the change in PI-CORE, P-TEMPPW gets false on the next call (same session)');
reset role; select nexus_test.login_as(2);
select is(nexus.my_password_change_pending(), true,
  'EC7: an admin-issued temporary password shows up for that caller only (P-SUPER now true)');
reset role; select nexus_test.login_as(4);
select is(nexus.my_password_change_pending(), false, 'AUTH-22: ... while P-SEKJEN still gets their own false');
reset role; select nexus_test.logout();

select * from finish();
rollback;
