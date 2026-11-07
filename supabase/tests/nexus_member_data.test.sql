-- pgTAP tests for the Member Data module (migration 20261106200000_nexus_member_data.sql).
-- Spec: docs/modules/member-data.md (rev. 2) sections 2, 4, 4.2, 5, 7, 9 (MD-xx); D-019.
--
-- LOCAL / THROWAWAY DATABASE ONLY. Never run against the hosted (shared) project, and not on the NEXUS
-- dev stack either (its seeded accounts break the "fresh install" counts). Same guards as
-- nexus_access_control.test.sql: it refuses to run without nexus.allow_destructive_tests = 'yes', and
-- stops if ANY account or member has a non-test email address. Everything (personas written into
-- PI-CORE tables, temporary renames, export log rows, helper schema nexus_test) is rolled back.
--   PGOPTIONS='-c nexus.allow_destructive_tests=yes' psql "<throwaway url>" -f supabase/tests/nexus_member_data.test.sql
-- Preconditions: PI-CORE's 5 migrations, then ALL NEXUS migrations, then pgtap (see tests/README.md).
--
-- Personas: same numbers as nexus_access_control.test.sql (auth uid 10000000-...-NN, member id
-- 20000000-...-NN), plus two local to this module:
--   1 P-ADMIN  2 P-SUPER  3 P-KETUM  4 P-SEKJEN  5 P-BEND (also P-ADMIN-BEND when promoted)
--   6 P-SEKDEP  7 P-KADEP-OPS  8 P-STAFF-LOG  9 P-STAFF-AKO  10 P-STAFF-PUB  11 P-PLAIN
--   12 P-BEND-SEK  13 P-OPS-BPH  14 P-OLD  15 P-INACTIVE  16 P-LECT  17 P-UNLINKED  18 P-SEKDEP2
--   19 P-KABIRO   = Kepala Biro in Biro Kewirausahaan (member-data spec section 7)
--   20 P-MULTI    = Sekretaris Departemen in Departemen CMIT (rank 50) + Staff in Musik (rank 70):
--                   MD-16 analogue (Departemen Internal's secretary seat is taken by P-SEKDEP) and
--                   the "non-primary assignment" case of the unit filter (R6).

\set ON_ERROR_STOP on
begin;

-- W1 guard (see tests/README.md).
do $$
begin
  if coalesce(current_setting('nexus.allow_destructive_tests', true), '') <> 'yes' then
    raise exception 'nexus_member_data.test.sql writes test rows into PI-CORE tables: local throwaway database only. Set nexus.allow_destructive_tests=yes (see supabase/tests/README.md) to run it.';
  end if;
end
$$;

-- Data guard (security review M1): a real project always holds real members.
do $$
begin
  if exists (select 1 from auth.users u where u.email is null or u.email !~* '@(example\.test|nexus\.test)$')
     or exists (select 1 from public.members m where m.email is not null and m.email !~* '@(example\.test|nexus\.test)$') then
    raise exception 'nexus_member_data.test.sql: found a non-test email address, so this is NOT a throwaway local database. Nothing was written.';
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
    raise exception 'nexus_member_data.test.sql: found the NEXUS dev stack seed accounts (@nexus.test). Run it only in a fresh throwaway container (see supabase/tests/README.md). Nothing was written.';
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
-- Persona number from a member id (works for every fixture id pattern used here).
create function nexus_test.n_of(p_id uuid) returns int language sql immutable
as $$ select right(p_id::text, 12)::int $$;
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
  perform set_config('request.jwt.claim.sub', nexus_test.uid(n)::text, true);
  perform set_config('role', 'authenticated', true);
end
$$;
create function nexus_test.logout() returns void language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;
-- Error HINT of a statement, or 'no_error'. Always rolls the statement back.
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
-- 'ok' or the SQLSTATE. Unlike hint_of, a SUCCESSFUL statement keeps its effects (an export writes
-- its log row), which is exactly what the permission matrix wants to observe.
create function nexus_test.outcome(p_sql text) returns text language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;
-- The five Member Data entry points, as the current caller:
-- [list, unit options, dashboard count, export, export-log read]
create function nexus_test.matrix() returns text[] language plpgsql
as $$
begin
  return array[
    nexus_test.outcome('select * from nexus.member_data_list()'),
    nexus_test.outcome('select * from nexus.member_data_unit_options()'),
    nexus_test.outcome('select nexus.member_data_active_count()'),
    nexus_test.outcome('select * from nexus.member_data_export(''csv'')'),
    nexus_test.outcome('select * from nexus.member_data_export_log_list()')];
end
$$;
-- Persona numbers returned by a list/export query, in row_no order.
create function nexus_test.ids(p_sql text) returns int[] language plpgsql
as $$
declare
  v int[];
begin
  execute format('select coalesce(array_agg(nexus_test.n_of(q.member_id) order by q.row_no), ''{}''::int[]) from (%s) q', p_sql)
    into v;
  return v;
end
$$;
-- Primary-assignment display of persona n, as the current caller sees it in the list.
create function nexus_test.row_of(n int) returns text[] language sql
as $$
  select array[l.unit_name, l.unit_type, l.parent_unit_name, l.position_name]
  from nexus.member_data_list(p_status => 'all', p_page_size => 50) l
  where l.member_id = nexus_test.mid(n)
$$;
-- Owner-side truth (bypasses PI-CORE RLS), so expectations never depend on the caller's rights.
create function nexus_test.log_count() returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from nexus.member_data_export_logs $$;
create function nexus_test.last_log() returns nexus.member_data_export_logs language sql stable security definer set search_path = ''
as $$ select l.* from nexus.member_data_export_logs l order by l.id desc limit 1 $$;
create function nexus_test.active_members() returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from public.members m where m.is_active $$;
-- Spec order (R15): name A-Z case-insensitive, ties by members.id.
create function nexus_test.expected_order(p_status text) returns int[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(nexus_test.n_of(m.id) order by lower(m.full_name) collate "C", m.id), '{}'::int[])
  from public.members m
  where p_status = 'all' or m.is_active = (p_status = 'active')
$$;
-- Output column names of a set-returning function (structural whitelist check).
create function nexus_test.out_cols(p regprocedure) returns text[] language sql stable
as $$
  select array_agg(a.n order by a.i)
  from pg_proc f, unnest(f.proargnames, f.proargmodes::text[]) with ordinality as a(n, m, i)
  where f.oid = p and a.m = 't'
$$;
grant execute on all functions in schema nexus_test to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select nexus_test.uid(n), 'nexus-test-' || n || '@example.test', 'authenticated', 'authenticated'
from generate_series(1, 20) n;

insert into public.members (id, user_id, full_name, email, access_level, member_type)
select nexus_test.mid(n), nexus_test.uid(n), 'Test Persona ' || n, 'nexus-test-' || n || '@example.test',
       (case n when 1 then 'admin' when 2 then 'super_admin' else 'member' end)::public.access_level,
       (case n when 16 then 'lecturer' else 'student' end)::public.member_type
from generate_series(1, 20) n
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
  (18, 'Biro Kewirausahaan',          'bureau',     'Sekretaris Biro',       2),
  (19, 'Biro Kewirausahaan',          'bureau',     'Kepala Biro',           2),
  (20, 'Departemen CMIT',             'department', 'Sekretaris Departemen', 2),
  (20, 'Musik',                       'division',   'Staff',                 2)
) as v(n, unit_name, unit_type, position_name, p);

-- P-INACTIVE is deactivated AFTER getting an assignment (PI-CORE refuses assignments for inactive members).
update public.members set is_active = false where id = nexus_test.mid(15);

select is((select count(*)::int from public.assignments where member_id::text like '20000000-%'), 19,
  'fixtures: 19 persona assignments created (PI-CORE names match the test)');
select is((select count(*)::int from public.members), 19,
  'fixtures: exactly the 19 persona members exist (fresh database, no other members)');
select is(nexus_test.log_count(), 0, 'fixtures: export log starts empty');

-- =============================================================================================
-- 1. Structure: table, privileges, RLS, function shape, column whitelist (MD-10, MD-41, AC-47)
-- =============================================================================================
select has_table('nexus', 'member_data_export_logs', 'export log table exists');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'nexus.member_data_export_logs'::regclass),
  'MD-41: RLS is enabled on the export log');
select is((select count(*)::int from pg_policies where schemaname = 'nexus' and tablename = 'member_data_export_logs'), 0,
  'export log has no policy at all (default deny; reading only through the function)');
select ok(not has_table_privilege('authenticated', 'nexus.member_data_export_logs', 'select')
          and not has_table_privilege('authenticated', 'nexus.member_data_export_logs', 'insert')
          and not has_table_privilege('authenticated', 'nexus.member_data_export_logs', 'update')
          and not has_table_privilege('authenticated', 'nexus.member_data_export_logs', 'delete')
          and not has_table_privilege('authenticated', 'nexus.member_data_export_logs', 'truncate'),
  'MD-33: authenticated has no privilege at all on the export log');
select ok(not has_table_privilege('anon', 'nexus.member_data_export_logs', 'select, insert, update, delete, truncate'),
  'anon has no privilege on the export log');
select ok(has_table_privilege('service_role', 'nexus.member_data_export_logs', 'select')
          and not has_table_privilege('service_role', 'nexus.member_data_export_logs', 'insert, update, delete, truncate'),
  'W2: service_role reads the export log (ops) and cannot write it');
select ok(not has_sequence_privilege('authenticated', 'nexus.member_data_export_logs_id_seq', 'usage, select, update'),
  'authenticated has no privilege on the log id sequence');

-- MD-32: the log can hold no PII because it has no column for it.
select is((select array_agg(a.attname::text order by a.attnum) from pg_attribute a
           where a.attrelid = 'nexus.member_data_export_logs'::regclass and a.attnum > 0 and not a.attisdropped),
          array['id', 'exporter_member_id', 'created_at', 'format', 'filter_unit_id', 'filter_status', 'search_used', 'period_id'],
  'MD-32: export log columns are exactly ids, time, format, filters, search yes/no, period');

-- The five client functions: DEFINER, empty search_path, EXECUTE for authenticated only.
select is((select count(*)::int from pg_proc p
           where p.oid in ('nexus.member_data_list(text,uuid,text,integer,integer)'::regprocedure,
                           'nexus.member_data_unit_options()'::regprocedure,
                           'nexus.member_data_active_count()'::regprocedure,
                           'nexus.member_data_export(text,text,uuid,text)'::regprocedure,
                           'nexus.member_data_export_log_list(integer,integer)'::regprocedure)
             and p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)), 5,
  'D-010: all five Member Data functions are SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from pg_proc p
           where p.oid in ('nexus.member_data_list(text,uuid,text,integer,integer)'::regprocedure,
                           'nexus.member_data_unit_options()'::regprocedure,
                           'nexus.member_data_active_count()'::regprocedure,
                           'nexus.member_data_export(text,text,uuid,text)'::regprocedure,
                           'nexus.member_data_export_log_list(integer,integer)'::regprocedure)
             and has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute')
             and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)), 5,
  'only authenticated may execute the five functions (not anon, service_role, PUBLIC)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus'
             and p.proname in ('_require_permission', '_member_data_clean_status', '_member_data_clean_search',
                               '_member_data_rows', '_member_data_export_log_guard')
             and (has_function_privilege('authenticated', p.oid, 'execute')
                  or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'internal helpers (_member_data_rows etc.) are not executable by any API role');
select ok((select p.provolatile = 'v' from pg_proc p where p.oid = 'nexus.member_data_export(text,text,uuid,text)'::regprocedure),
  'export is VOLATILE (it writes the log; never runs in a read-only GET transaction)');

-- MD-10 / MD-41: output columns are exactly the whitelist.
select is(nexus_test.out_cols('nexus.member_data_list(text,uuid,text,integer,integer)'),
          array['row_no', 'member_id', 'full_name', 'member_type', 'is_active', 'unit_name', 'unit_type',
                'parent_unit_name', 'position_name', 'total_count', 'page', 'page_size'],
  'MD-10: list returns exactly the whitelisted columns');
select is(nexus_test.out_cols('nexus.member_data_export(text,text,uuid,text)'),
          array['row_no', 'member_id', 'full_name', 'member_type', 'is_active', 'unit_name', 'unit_type',
                'parent_unit_name', 'position_name'],
  'MD-10: export returns exactly the whitelisted columns (same as the screen)');
select is(nexus_test.out_cols('nexus.member_data_unit_options()'), array['id', 'name', 'type', 'sort_order'],
  'unit options return only id, name, type, sort_order');
select is(nexus_test.out_cols('nexus.member_data_export_log_list(integer,integer)'),
          array['log_id', 'created_at', 'exporter_member_id', 'exporter_name', 'format', 'filter_unit_id',
                'filter_unit_name', 'filter_status', 'search_used', 'period_id', 'period_label',
                'total_count', 'page', 'page_size'],
  'export-log read returns exactly the whitelisted columns');
select ok((select p.prorettype = 'integer'::regtype and not p.proretset and p.pronargs = 0
           from pg_proc p where p.oid = 'nexus.member_data_active_count()'::regprocedure),
  'dashboard count returns one integer and takes no input');

-- MD-10 / L4: no Member Data function takes, returns or even mentions a forbidden PI-CORE column.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname like 'member\_data%' or p.proname like '\_member\_data%'
                                          or p.proname = '_require_permission')
             and p.proargnames && array['email', 'phone', 'nim', 'nip', 'user_id', 'access_level',
                                        'must_change_password', 'deactivated_at']), 0,
  'MD-10: no Member Data function has an email/phone/nim/nip/user_id/access_level/must_change_password/deactivated_at argument or column');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname like 'member\_data%' or p.proname like '\_member\_data%'
                                          or p.proname = '_require_permission')
             and p.prosrc ~* '\m(email|phone|nim|nip|user_id|access_level|must_change_password|deactivated_at|audit_log|org_settings|grants_admin)\M'), 0,
  'MD-10: no Member Data function body mentions a forbidden column or table');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname like 'member\_data%' or p.proname like '\_member\_data%')), 9,
  'exactly 9 Member Data functions exist (5 API + 4 internal), so the checks above cover them all');

-- =============================================================================================
-- 2. Catalog, default rules D32/D33, L12 (MD-09, AC-71)
-- =============================================================================================
select ok((select pk.is_sensitive and not pk.allow_baseline and pk.module = 'member_data'
                  and pk.includes_key is null and pk.requires_key is null
           from nexus.permissions pk where pk.key = 'member_data.view_export_log'),
  'catalog: member_data.view_export_log is sensitive and never baseline-safe');
select is((select array_agg(s.scope) from nexus.permission_scopes s where s.permission_key = 'member_data.view_export_log'),
          array['all'], 'catalog: member_data.view_export_log allows scope all only');
select ok((select r.subject_type = 'role' and r.role_key = 'kepala_departemen' and r.permission_key = 'member_data.view'
                  and r.scope = 'all' and r.is_enabled and char_length(btrim(r.note)) > 0
           from nexus.access_rules r where r.default_code = 'D32'),
  'D32: role kepala_departemen -> member_data.view, enabled, with a written reason');
select ok((select r.subject_type = 'role' and r.role_key = 'bph' and r.permission_key = 'member_data.view_export_log'
                  and r.scope = 'all' and r.is_enabled and char_length(btrim(r.note)) > 0
           from nexus.access_rules r where r.default_code = 'D33'),
  'D33: role bph -> member_data.view_export_log, enabled, with a written reason');
select is((select count(*)::int from nexus.access_rule_log l join nexus.access_rules r on r.id = l.rule_id
           where r.default_code in ('D32', 'D33') and l.action = 'seed' and l.actor_member_id is null and l.is_sensitive), 2,
  'D32/D33 each have one sensitive seed log row without an actor');
select is((select count(*)::int from nexus.access_rules where default_code is not null), 36,
  'exactly 36 default rules, D01-D36 (no duplicates; D-022 added D34-D36)');

reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'member_data.view_export_log',
                                p_note => 'x', p_confirm_sensitive => true)$$),
  'baseline_not_allowed', 'L12: member_data.view_export_log to every active member rejected (RPC)');
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'member_data.export',
                                p_note => 'x', p_confirm_sensitive => true)$$),
  'baseline_not_allowed', 'MD-09/L12: member_data.export to every active member rejected (RPC)');
select is(nexus_test.hint_of($$select nexus.add_access_rule('role', 'member_data.view_export_log', 'all', 'staff',
                                p_confirm_sensitive => true)$$),
  'note_required', 'MD-09/L12: member_data.view_export_log to a role without a reason rejected');
select is(nexus_test.hint_of($$select nexus.add_access_rule('role', 'member_data.view', 'all', 'staff',
                                p_confirm_sensitive => true)$$),
  'note_required', 'MD-09/L12: member_data.view to a role without a reason rejected');
reset role; select nexus_test.logout();
select is(nexus_test.hint_of($$insert into nexus.access_rules (subject_type, permission_key, scope, note)
                                values ('all_members', 'member_data.view_export_log', 'all', 'x')$$),
  'baseline_not_allowed', 'L12: direct insert of member_data.view_export_log for every active member rejected (owner)');

-- =============================================================================================
-- 3. Permission matrix (spec section 7, MD-01..MD-06, MD-34)
--    [list, unit options, dashboard count, export, export-log read]; 42501 = refused.
--    Allowed exports write a log row; refused ones must not (MD-02, MD-31).
-- =============================================================================================
reset role; select nexus_test.login_as(3);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', 'ok', 'ok'], 'MD-01: P-KETUM (BPH) has list, count, export, log');
select ok((select bool_and(permission_key in (select permission_key from nexus.my_permissions()))
           from unnest(array['member_data.view', 'member_data.export', 'member_data.view_export_log']) as k(permission_key)),
  'MD-01: P-KETUM''s my_permissions lists view, export and view_export_log');
reset role; select nexus_test.login_as(4);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', 'ok', 'ok'], 'MD-01: P-SEKJEN (BPH) has everything');
reset role; select nexus_test.login_as(5);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', 'ok', 'ok'], 'MD-01: P-BEND (BPH) has everything');
reset role; select nexus_test.login_as(12);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', 'ok', 'ok'], 'R17: P-BEND-SEK has everything through bph');
reset role; select nexus_test.login_as(13);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', 'ok', 'ok'], 'R17: P-OPS-BPH has everything through bph');
select is(nexus_test.log_count(), 5, 'MD-31: the five allowed exports wrote exactly five log rows');

-- MD-04: P-ADMIN-BEND (admin + Bendahara Umum 1) gets it through the position, not admin status.
reset role; select nexus_test.logout();
update public.members set access_level = 'admin' where id = nexus_test.mid(5);
select nexus_test.login_as(5);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', 'ok', 'ok'], 'MD-04: P-ADMIN-BEND has list and export (position)');
reset role; select nexus_test.logout();
update public.members set access_level = 'member' where id = nexus_test.mid(5);

-- MD-02: department/bureau heads: view only.
select nexus_test.login_as(7);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', '42501', '42501'], 'MD-02: P-KADEP-OPS views, cannot export or read the log');
select ok(nexus.has_permission('member_data.view') and not nexus.has_permission('member_data.export'),
  'AC-70: P-KADEP-OPS holds member_data.view (D32) but not export');
reset role; select nexus_test.login_as(19);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', '42501', '42501'], 'MD-02: P-KABIRO views, cannot export or read the log');
select is(nexus_test.log_count(), 6, 'MD-02: refused exports of department/bureau heads wrote no log row');

-- MD-03: System Admin without a position: no list, but reads the log (fixed right, A-MD10).
reset role; select nexus_test.login_as(1);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', 'ok'], 'MD-03/MD-34: P-ADMIN reads only the export log');
reset role; select nexus_test.login_as(2);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', 'ok'], 'MD-03/MD-34: P-SUPER reads only the export log');

-- MD-05: secretaries, staff, plain member, lecturer, previous-period officer: nothing.
reset role; select nexus_test.login_as(6);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-05: P-SEKDEP gets nothing');
reset role; select nexus_test.login_as(18);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-05: P-SEKDEP2 (Sekretaris Biro too) gets nothing');
reset role; select nexus_test.login_as(8);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-05: P-STAFF-LOG gets nothing');
reset role; select nexus_test.login_as(10);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-05: P-STAFF-PUB gets nothing');
reset role; select nexus_test.login_as(20);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-05: P-MULTI (secretary + staff) gets nothing');
reset role; select nexus_test.login_as(11);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-05: P-PLAIN gets nothing');
reset role; select nexus_test.login_as(16);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-05: P-LECT gets nothing');
reset role; select nexus_test.login_as(14);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'spec 7: P-OLD (BPH of a previous period) gets nothing');

-- MD-06 / L1: inactive, unlinked, no JWT subject, anon.
reset role; select nexus_test.login_as(15);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-06: P-INACTIVE (was Kepala Departemen) gets nothing');
reset role; select nexus_test.login_as(17);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-06: P-UNLINKED gets nothing');
reset role; select nexus_test.logout();
set local role authenticated;
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-06: authenticated without auth.uid() gets nothing');
reset role;
set local role anon;
select throws_ok($$select * from nexus.member_data_list()$$, '42501', null, 'MD-06: anon cannot call the list');
select throws_ok($$select nexus.member_data_active_count()$$, '42501', null, 'MD-06: anon cannot call the count');
select throws_ok($$select * from nexus.member_data_export('csv')$$, '42501', null, 'MD-06: anon cannot call the export');
select throws_ok($$select * from nexus.member_data_export_log_list()$$, '42501', null, 'MD-06: anon cannot read the log');
reset role;
select is(nexus_test.log_count(), 6, 'MD-31: no refused call wrote a log row (still 6)');

-- The refusal carries the stable hint the backend maps to "Aksesmu sudah berubah" (F6).
select nexus_test.login_as(7);
select is(nexus_test.hint_of($$select * from nexus.member_data_export('csv')$$), 'permission_required',
  'refusal hint is permission_required');

-- =============================================================================================
-- 4. List content (as P-KETUM): one row per member, primary assignment, display fields
-- =============================================================================================
reset role; select nexus_test.login_as(3);

select is((select count(*)::int from nexus.member_data_list(p_status => 'all', p_page_size => 50)), 19,
  'MD-15/R1: status all lists every member once (19), with or without an assignment');
select is((select count(distinct member_id)::int from nexus.member_data_list(p_status => 'all', p_page_size => 50)), 19,
  'MD-15: no member is duplicated (P-OPS-BPH, P-BEND-SEK, P-SEKDEP2, P-MULTI hold two assignments)');
select is(nexus_test.ids('select * from nexus.member_data_list(p_status => ''all'', p_page_size => 50)'),
          nexus_test.expected_order('all'), 'MD-27/R15: order is name A-Z (case-insensitive), ties by member id');
select is((select array_agg(row_no order by row_no) from nexus.member_data_list(p_status => 'all', p_page_size => 50)),
          (select array_agg(g::bigint order by g) from generate_series(1, 19) g), 'row_no is the running number 1..N');

select is(nexus_test.row_of(3), array['BPH PMK ITERA', 'bph', null, 'Ketua Umum']::text[],
  'MD-18: Ketua Umum shows BPH PMK ITERA / Ketua Umum');
select is(nexus_test.row_of(8), array['Logistik', 'division', 'Departemen Operasional', 'Staff']::text[],
  'MD-18: a division assignment carries its department (Departemen Operasional · Logistik / Staff)');
select is(nexus_test.row_of(19), array['Biro Kewirausahaan', 'bureau', null, 'Kepala Biro']::text[],
  'MD-18: Kepala Biro shows Biro Kewirausahaan / Kepala Biro');
select is(nexus_test.row_of(13), array['BPH PMK ITERA', 'bph', null, 'Sekretaris Umum 2']::text[],
  'M3: primary = lowest rank (Sekretaris Umum 2, 30) over Staff in Logistik (70)');
select is(nexus_test.row_of(20), array['Departemen CMIT', 'department', null, 'Sekretaris Departemen']::text[],
  'MD-16: Sekretaris Departemen (50) beats Staff (70)');
select is(nexus_test.row_of(11), array[null, null, null, null]::text[], 'MD-19: no assignment = empty unit and position');
select is(nexus_test.row_of(14), array[null, null, null, null]::text[],
  'MD-20: an assignment of a non-active period never appears (P-OLD)');
select is(nexus_test.row_of(15), array['Departemen Eksternal', 'department', null, 'Kepala Departemen']::text[],
  'R9/A-MD3: a deactivated member shows what PI-CORE records for the active period');
select ok((select member_type = 'lecturer' and unit_name is null and position_name is null and is_active
           from nexus.member_data_list(p_status => 'all', p_page_size => 50) where member_id = nexus_test.mid(16)),
  'MD-24/R10: the lecturer row has member_type lecturer (Pembina marker) and no unit/position');
select is((select member_type from nexus.member_data_list() where member_id = nexus_test.mid(3)), 'student',
  'MD-24: a student has no marker (member_type student)');

-- MD-17 tie-break, level 1: equal rank (50) -> lower org_units.sort_order (Pelayanan Khusus 40 < Biro 90).
select is(nexus_test.row_of(18), array['Departemen Pelayanan Khusus', 'department', null, 'Sekretaris Departemen']::text[],
  'MD-17: equal rank -> lower unit sort_order wins');
-- Level 2: equal rank AND equal sort_order -> unit name A-Z.
reset role; select nexus_test.logout();
update public.org_units set sort_order = 40 where id = nexus_test.unit('Biro Kewirausahaan');
select nexus_test.login_as(3);
select is(nexus_test.row_of(18), array['Biro Kewirausahaan', 'bureau', null, 'Sekretaris Biro']::text[],
  'MD-17: equal rank and sort_order -> unit name A-Z (Biro before Departemen)');
reset role; select nexus_test.logout();
update public.org_units set sort_order = 90 where id = nexus_test.unit('Biro Kewirausahaan');
-- Level 3: same unit, equal rank (30) -> position name A-Z. Renaming proves it is the name, not
-- insertion order, and that renames show at once (R7, MD-21).
insert into public.assignments (member_id, org_unit_id, position_id, period_id)
values (nexus_test.mid(12), nexus_test.unit('BPH PMK ITERA'), nexus_test.pos('bph', 'Sekretaris Umum 1'), nexus_test.period(2));
select nexus_test.login_as(3);
select is(nexus_test.row_of(12), array['BPH PMK ITERA', 'bph', null, 'Bendahara Umum 2']::text[],
  'MD-17: same unit and rank -> position name A-Z (Bendahara Umum 2 before Sekretaris Umum 1)');
select is(nexus_test.row_of(12), nexus_test.row_of(12), 'MD-17: the same primary on every request');
reset role; select nexus_test.logout();
update public.positions set name = 'Zz Bendahara Umum 2' where id = nexus_test.pos('bph', 'Bendahara Umum 2');
select nexus_test.login_as(3);
select is(nexus_test.row_of(12), array['BPH PMK ITERA', 'bph', null, 'Sekretaris Umum 1']::text[],
  'MD-17/R7: after a rename the position name decides again, at once');
reset role; select nexus_test.logout();
update public.positions set name = 'Bendahara Umum 2' where name = 'Zz Bendahara Umum 2' and unit_type = 'bph';
delete from public.assignments
where member_id = nexus_test.mid(12) and position_id = nexus_test.pos('bph', 'Sekretaris Umum 1');

-- A-MD8 option (b) (owner 2026-11-06): equal rank in divisions of DIFFERENT departments -> the
-- department order decides, not the division's local sort_order. Each case below would give the
-- other answer under option (a) (compare the unit's own sort_order).
insert into public.assignments (member_id, org_unit_id, position_id, period_id) values
  (nexus_test.mid(8),  nexus_test.unit('Musik'),        nexus_test.pos('division', 'Staff'), nexus_test.period(2)),
  (nexus_test.mid(10), nexus_test.unit('Gospel Group'), nexus_test.pos('division', 'Staff'), nexus_test.period(2)),
  (nexus_test.mid(9),  nexus_test.unit('Harmonisasi'),  nexus_test.pos('division', 'Staff'), nexus_test.period(2));
select nexus_test.login_as(3);
select is(nexus_test.row_of(8), array['Musik', 'division', 'Departemen Pelayanan Khusus', 'Staff']::text[],
  'A-MD8 (b): Staff Musik (Pelayanan Khusus 40) beats Staff Logistik (Operasional 60); (a) would pick Logistik (10 < 30)');
select is(nexus_test.row_of(10), array['Pubdok', 'division', 'Departemen CMIT', 'Staff']::text[],
  'A-MD8 (b): Staff Pubdok (CMIT 70) beats Staff Gospel Group (Pembinaan Rohani 80); (a) would pick Gospel Group (tie 10, name)');
select is(nexus_test.row_of(9), array['Harmonisasi', 'division', 'Departemen Internal', 'Staff']::text[],
  'A-MD8 (b): Staff Harmonisasi (Internal 20, own 20) beats Staff Akomodasi (Operasional 60, own 20)');
reset role; select nexus_test.logout();
insert into public.assignments (member_id, org_unit_id, position_id, period_id)
values (nexus_test.mid(10), nexus_test.unit('IT'), nexus_test.pos('division', 'Staff'), nexus_test.period(2));
select nexus_test.login_as(3);
select is(nexus_test.row_of(10), array['Pubdok', 'division', 'Departemen CMIT', 'Staff']::text[],
  'A-MD8 (b): same department -> the division''s own sort_order (Pubdok 10 before IT 30)');
select is((select array_agg(o.name order by o.sort_order) from nexus.member_data_unit_options() o
           where o.name in ('Departemen Pelayanan Khusus', 'Departemen Operasional')),
          array['Departemen Pelayanan Khusus', 'Departemen Operasional'],
  'A-MD8 (b): the tie-break follows the same unit order as the filter options');
reset role; select nexus_test.logout();
delete from public.assignments
where period_id = nexus_test.period(2)
  and ((member_id = nexus_test.mid(8)  and org_unit_id = nexus_test.unit('Musik'))
    or (member_id = nexus_test.mid(10) and org_unit_id in (nexus_test.unit('Gospel Group'), nexus_test.unit('IT')))
    or (member_id = nexus_test.mid(9)  and org_unit_id = nexus_test.unit('Harmonisasi')));
select is((select count(*)::int from public.assignments where member_id::text like '20000000-%'), 19,
  'cleanup: back to the 19 fixture assignments');

-- MD-21 / R7: renaming a unit changes the row text and the option on the next request.
update public.org_units set name = 'Logistik Baru' where id = nexus_test.unit('Logistik');
update public.org_units set name = 'Departemen Operasional Baru' where id = nexus_test.unit('Departemen Operasional');
select nexus_test.login_as(3);
select is(nexus_test.row_of(8), array['Logistik Baru', 'division', 'Departemen Operasional Baru', 'Staff']::text[],
  'MD-21/R7: renamed units show at once in the row');
select ok(exists (select 1 from nexus.member_data_unit_options() where name = 'Departemen Operasional Baru'),
  'MD-21: the renamed department is offered under its new name');
reset role; select nexus_test.logout();
update public.org_units set name = 'Logistik' where name = 'Logistik Baru';
update public.org_units set name = 'Departemen Operasional' where name = 'Departemen Operasional Baru';

-- =============================================================================================
-- 5. Status filter, unit filter, unit options, dashboard count
-- =============================================================================================
select nexus_test.login_as(3);

-- MD-23 status filter.
select is(nexus_test.ids('select * from nexus.member_data_list()'), nexus_test.expected_order('active'),
  'MD-23: default status is active (P-INACTIVE absent)');
select is((select total_count::int from nexus.member_data_list() limit 1), 18, 'MD-23: 18 active members by default');
select is(nexus_test.ids('select * from nexus.member_data_list(p_status => ''inactive'')'), array[15],
  'MD-23: status inactive shows only P-INACTIVE');
select is((select total_count::int from nexus.member_data_list(p_status => null) limit 1), 18,
  'MD-23: a null status falls back to the default (active)');
select is((select total_count::int from nexus.member_data_list(p_status => '  ALL ') limit 1), 19,
  'status input is trimmed and case-insensitive');
select is(nexus_test.hint_of($$select * from nexus.member_data_list(p_status => 'cuti')$$), 'invalid_status',
  'M1: only active / inactive / all are accepted (no Cuti/Alumni)');

-- MD-22 / R6 unit filter: ANY active-period assignment, divisions fold into their department.
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_unit_id => %L)', nexus_test.unit('Departemen Operasional'))),
          array[13, 7, 8, 9], 'MD-22: Operasional = its head + Logistik + Akomodasi, incl. P-OPS-BPH (primary is BPH)');
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_unit_id => %L)', nexus_test.unit('Departemen CMIT'))),
          array[10, 20], 'MD-22: CMIT = Pubdok staff + P-MULTI (primary there)');
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_unit_id => %L)', nexus_test.unit('Departemen Pelayanan Khusus'))),
          array[18, 20], 'MD-22: Pelayanan Khusus includes P-MULTI through a non-primary division assignment (Musik)');
select is((select count(*)::int from nexus.member_data_list(p_status => 'all', p_page_size => 50) where member_id = nexus_test.mid(20)), 1,
  'MD-22: P-MULTI appears under two unit filters and once in the full list');
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_unit_id => %L)', nexus_test.unit('BPH PMK ITERA'))),
          array[12, 13, 3, 4, 5], 'MD-22: BPH filter = active-period BPH holders only (not P-OLD)');
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_unit_id => %L)', nexus_test.unit('Biro Kewirausahaan'))),
          array[18, 19], 'MD-22: bureau filter');
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_unit_id => %L)', nexus_test.unit('Departemen Eksternal'))),
          '{}'::int[], 'MD-22 + MD-23: unit filter AND default status (P-INACTIVE hidden)');
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_unit_id => %L, p_status => ''all'')', nexus_test.unit('Departemen Eksternal'))),
          array[15], 'MD-22 + MD-23: same unit with status all shows the deactivated head');
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_unit_id => %L)', nexus_test.unit('Logistik'))),
          array[13, 8], 'a division id filters that division only');
select is(nexus_test.hint_of(format('select * from nexus.member_data_list(p_unit_id => %L)', gen_random_uuid())),
  'invalid_unit', 'review L2: an unknown unit id is refused (list)');

-- MD-21 / R5 / A-MD4 unit options.
select is((select array_agg(name order by sort_order) from nexus.member_data_unit_options()),
          array['BPH PMK ITERA', 'Departemen Internal', 'Departemen Eksternal', 'Departemen Pelayanan Khusus',
                'Departemen Talenta', 'Departemen Operasional', 'Departemen CMIT', 'Departemen Pembinaan Rohani',
                'Biro Kewirausahaan'],
  'MD-21/R5: options = live bph/department/bureau units in PI-CORE order; no root, no divisions');
reset role; select nexus_test.logout();
update public.org_units set is_active = false where id = nexus_test.unit('Departemen Pembinaan Rohani');
select nexus_test.login_as(3);
select ok(not exists (select 1 from nexus.member_data_unit_options() where name = 'Departemen Pembinaan Rohani')
          and (select count(*) from nexus.member_data_unit_options()) = 8,
  'R8/A-MD4: a deactivated unit is not offered');
reset role; select nexus_test.logout();
update public.org_units set is_active = true where id = nexus_test.unit('Departemen Pembinaan Rohani');

-- MD-38 / M5b dashboard count.
select nexus_test.login_as(3);
select is(nexus.member_data_active_count(), nexus_test.active_members(),
  'MD-38: count = every active member (students and lecturers, with or without assignment)');
select is(nexus.member_data_active_count()::bigint, (select total_count from nexus.member_data_list() limit 1),
  'MD-38: count = list total under the default filter');
reset role; select nexus_test.login_as(19);
select is(nexus.member_data_active_count(), 18, 'P-KABIRO sees the same count (18, incl. the lecturer)');

-- =============================================================================================
-- 6. Search and pagination (F2, F4, MD-12, MD-25, MD-26, MD-27)
-- =============================================================================================
reset role; select nexus_test.logout();
update public.members set full_name = 'Budi 100% Hadir' where id = nexus_test.mid(10);
update public.members set full_name = 'Ani_Wijaya' where id = nexus_test.mid(9);
update public.members set full_name = 'Dewi   Lestari' where id = nexus_test.mid(6);
-- PII to search for (MD-12). PI-CORE checks: nim 6-12 digits, phone 8-15 digits, nip for lecturers only.
update public.members set nim = '120140003', phone = '+6281234567890' where id = nexus_test.mid(3);
update public.members set nip = '198001012005011001' where id = nexus_test.mid(16);
select nexus_test.login_as(4);

select is(nexus_test.ids('select * from nexus.member_data_list(p_search => ''%'')'), array[10],
  'MD-25: % is a literal character, not a wildcard');
select is(nexus_test.ids('select * from nexus.member_data_list(p_search => ''_'')'), array[9],
  'MD-25: _ is a literal character, not a wildcard');
select is(nexus_test.ids(E'select * from nexus.member_data_list(p_search => ''\\\\'')'), '{}'::int[],
  'a backslash is searched literally (no error, no match)');
select is(nexus_test.ids('select * from nexus.member_data_list(p_search => ''  bUdI   100%  '')'), array[10],
  'F2: case-insensitive, trimmed, extra spaces ignored');
select is(nexus_test.ids('select * from nexus.member_data_list(p_search => ''dewi lestari'')'), array[6],
  'F2: extra spaces inside the stored name are ignored too');
select is(nexus_test.ids('select * from nexus.member_data_list(p_search => ''ersona 1'')'),
          array[1, 11, 12, 13, 14, 16, 18, 19],
  'MD-25: partial match anywhere in the name (inactive 15 hidden by default status)');
select is((select total_count::int from nexus.member_data_list(p_search => '   ') limit 1), 18,
  'a blank search is no search');
select is(nexus_test.hint_of(format('select * from nexus.member_data_list(p_search => %L)', repeat('a', 121))),
  'search_too_long', 'search text is capped at 120 characters');
select is(nexus_test.hint_of(format('select * from nexus.member_data_list(p_search => %L)', repeat(' ', 481))),
  'search_too_long', 'review L1: raw input over 480 characters is refused before trimming (even if blank)');
select is((select total_count::int from nexus.member_data_list(p_search => repeat(' ', 400) || 'budi') limit 1), 1,
  'review L1: raw input up to 480 characters is accepted when the cleaned text fits 120');
select is(nexus_test.ids(format('select * from nexus.member_data_list(p_search => ''persona'', p_unit_id => %L)',
                                nexus_test.unit('Departemen Operasional'))),
          array[13, 7, 8], 'MD-25: search AND unit filter combine (Ani_Wijaya in Akomodasi is not a "persona")');

-- MD-12: searching PII never matches (only the name is searched).
select is((select count(*)::int from nexus.member_data_list(p_search => 'nexus-test-3@example.test', p_status => 'all')), 0,
  'MD-12: exact email matches nobody');
select is((select count(*)::int from nexus.member_data_list(p_search => '120140003', p_status => 'all')), 0,
  'MD-12: exact NIM matches nobody');
select is((select count(*)::int from nexus.member_data_list(p_search => '+6281234567890', p_status => 'all')), 0,
  'MD-12: exact phone matches nobody');
select is((select count(*)::int from nexus.member_data_list(p_search => '198001012005011001', p_status => 'all')), 0,
  'MD-12: exact NIP matches nobody');

-- MD-26 pagination (18 active members, 5 per page = 4 pages).
select is((select array[min(row_no), max(row_no), min(total_count), min(page), min(page_size)]::bigint[]
           from nexus.member_data_list(p_page => 1, p_page_size => 5)),
          array[1, 5, 18, 1, 5]::bigint[], 'MD-26: page 1 of size 5 = rows 1-5 of 18');
select is((select array[min(row_no), max(row_no), min(page)]::bigint[] from nexus.member_data_list(p_page => 4, p_page_size => 5)),
          array[16, 18, 4]::bigint[], 'MD-26: last page holds rows 16-18');
select is((select array[min(row_no), max(row_no), min(page)]::bigint[] from nexus.member_data_list(p_page => 99, p_page_size => 5)),
          array[16, 18, 4]::bigint[], 'F4/MD-26: a page beyond the last returns the last page (and says page 4)');
select is((select array_agg(x.n order by x.p, x.r) from (
             select 1 as p, row_no as r, nexus_test.n_of(member_id) as n from nexus.member_data_list(p_page => 1, p_page_size => 5)
             union all select 2, row_no, nexus_test.n_of(member_id) from nexus.member_data_list(p_page => 2, p_page_size => 5)
             union all select 3, row_no, nexus_test.n_of(member_id) from nexus.member_data_list(p_page => 3, p_page_size => 5)
             union all select 4, row_no, nexus_test.n_of(member_id) from nexus.member_data_list(p_page => 4, p_page_size => 5)) x),
          nexus_test.expected_order('active'),
  'MD-27: pages are stable: together they give every member once, in order');
select is(nexus_test.hint_of('select * from nexus.member_data_list(p_page_size => 51)'), 'invalid_page_size',
  'MD-26/R16: page size above the server maximum (50) is refused');
select is(nexus_test.hint_of('select * from nexus.member_data_list(p_page_size => 0)'), 'invalid_page_size',
  'page size 0 is refused');
select is(nexus_test.hint_of('select * from nexus.member_data_list(p_page => 0)'), 'invalid_page', 'page 0 is refused');
select is(nexus_test.hint_of('select * from nexus.member_data_list(p_page => null)'), 'invalid_page', 'page null is refused');
select is((select count(*)::int from nexus.member_data_list(p_page_size => 50)), 18, 'page size 50 is allowed');
select is((select count(*)::int from nexus.member_data_list(p_search => 'zzz-nobody')), 0,
  'MD-28: no match = zero rows (the app shows the no-match state)');

-- R12: same name twice = two rows, ordered by member id.
reset role; select nexus_test.logout();
update public.members set full_name = 'Sama Nama' where id in (nexus_test.mid(11), nexus_test.mid(5));
select nexus_test.login_as(4);
select is(nexus_test.ids('select * from nexus.member_data_list(p_search => ''sama nama'')'), array[5, 11],
  'R12/R15: two members with the same name are two rows, tie broken by member id');

-- =============================================================================================
-- 7. Period switch, no active period, rule changes (MD-07, MD-08, MD-11, R13)
-- =============================================================================================
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(1);
select nexus_test.login_as(14);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', 'ok', 'ok'], 'MD-07: P-OLD gets the module when their period is active');
select is(nexus_test.row_of(14), array['BPH PMK ITERA', 'bph', null, 'Sekretaris Jenderal']::text[],
  'MD-07/F7: the list shows the newly active period''s assignments');
select is(nexus_test.row_of(3), array[null, null, null, null]::text[], 'MD-07: P-KETUM has no assignment in that period');
select ok((select l.exporter_member_id = nexus_test.mid(14) and l.period_id = nexus_test.period(1) from nexus_test.last_log() l),
  'the export log stores the same (newly active) period the rows were built from');
reset role; select nexus_test.login_as(3);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'],
  'MD-07: P-KETUM loses the module on the next request after the switch');

-- R13 / MD-39: no active period at all. Nobody holds the key, and the shared row builder still works.
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
select nexus_test.login_as(4);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'R13: with no active period nobody has the module');
reset role; select nexus_test.logout();
select is((select count(*)::int from nexus._member_data_rows(null, null, 'all', nexus.active_period_id()) where unit_name is null), 19,
  'no active period = every row without unit/position, never an error');
update public.periods set is_active = true where id = nexus_test.period(2);

-- MD-08: disabling D32 removes department heads at once; enabling it gives it back.
select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where default_code = 'D32'), 'test MD-08'),
  'MD-08: P-ADMIN disables D32');
reset role; select nexus_test.login_as(7);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-08: P-KADEP-OPS loses the list at once');
reset role; select nexus_test.login_as(3);
select is(nexus_test.matrix()::text[], array['ok', 'ok', 'ok', 'ok', 'ok'], 'MD-08: BPH keeps it through D12');
reset role; select nexus_test.login_as(1);
select ok(nexus.enable_access_rule((select id from nexus.access_rules where default_code = 'D32'), 'test MD-08 restore', true),
  'MD-08: P-ADMIN enables D32 again (note + confirmation)');
reset role; select nexus_test.login_as(19);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', '42501', '42501'], 'MD-08: P-KABIRO has the list again');

-- MD-11: view + export granted to a unit rule still return only the whitelisted columns; the log key
-- is separate (export rights do not unlock the log).
reset role; select nexus_test.login_as(1);
select lives_ok($$select nexus.add_access_rule('org_unit', 'member_data.view', p_org_unit_id => nexus_test.unit('Pubdok'),
                   p_note => 'test MD-11', p_confirm_sensitive => true)$$, 'MD-11: grant view to unit Pubdok');
select lives_ok($$select nexus.add_access_rule('org_unit', 'member_data.export', p_org_unit_id => nexus_test.unit('Pubdok'),
                   p_note => 'test MD-11', p_confirm_sensitive => true)$$, 'MD-11: grant export to unit Pubdok');
reset role; select nexus_test.login_as(10);
select is(nexus_test.matrix(), array['ok', 'ok', 'ok', 'ok', '42501'], 'MD-11: P-STAFF-PUB can list and export, not read the log');
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where org_unit_id = nexus_test.unit('Pubdok')
                                     and permission_key = 'member_data.view'))
          and nexus.disable_access_rule((select id from nexus.access_rules where org_unit_id = nexus_test.unit('Pubdok')
                                         and permission_key = 'member_data.export')),
  'cleanup: disable the MD-11 rules');
reset role; select nexus_test.login_as(10);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'], 'MD-11: P-STAFF-PUB loses it again');

-- =============================================================================================
-- 8. Export and its log row (F5, MD-29, MD-31, MD-32, MD-35)
-- =============================================================================================
reset role; select nexus_test.login_as(3);

select nexus_test.log_count() as log_before \gset
select is((select array_agg(row(e.row_no, e.member_id, e.full_name, e.member_type, e.is_active, e.unit_name, e.unit_type,
                                e.parent_unit_name, e.position_name)::text order by e.row_no)
           from nexus.member_data_export(' XLSX ', 'persona', nexus_test.unit('Departemen Operasional'), 'all') e),
          (select array_agg(row(l.row_no, l.member_id, l.full_name, l.member_type, l.is_active, l.unit_name, l.unit_type,
                                l.parent_unit_name, l.position_name)::text order by l.row_no)
           from nexus.member_data_list('persona', nexus_test.unit('Departemen Operasional'), 'all', 1, 50) l),
  'MD-29: export rows = list rows for the same search and filters, same order, same fields');
select is(nexus_test.log_count(), :log_before + 1, 'MD-31: one export wrote exactly one log row');
select ok((select l.exporter_member_id = nexus_test.mid(3) and l.format = 'xlsx'
                  and l.filter_unit_id = nexus_test.unit('Departemen Operasional') and l.filter_status = 'all'
                  and l.search_used and l.period_id = nexus_test.period(2)
                  and l.created_at is not null
           from nexus_test.last_log() l),
  'MD-31: log row = exporter from the session, format, unit filter, status, search used, active period');

select is((select count(*)::int from nexus.member_data_export('csv')), 18,
  'MD-29: default export = all 18 active members (not a page)');
select ok((select l.format = 'csv' and l.filter_unit_id is null and l.filter_status = 'active' and not l.search_used
           from nexus_test.last_log() l),
  'MD-31: default export logs no unit, status active, no search');
select is((select count(*)::int from nexus.member_data_export('pdf', '   ')), 18, 'PDF export works; blank search = no search');
select ok((select l.format = 'pdf' and not l.search_used from nexus_test.last_log() l),
  'A-MD11: a blank search is logged as "no search"');
select is(nexus_test.log_count(), :log_before + 3, 'three exports, three log rows');

select nexus_test.log_count() as log_before \gset
select is(nexus_test.hint_of($$select * from nexus.member_data_export('docx')$$), 'invalid_format', 'only xlsx, csv, pdf');
select is(nexus_test.hint_of($$select * from nexus.member_data_export(null)$$), 'invalid_format', 'format is required');
select is(nexus_test.hint_of($$select * from nexus.member_data_export('csv', p_status => 'cuti')$$), 'invalid_status',
  'invalid status refused');
select is(nexus_test.hint_of(format('select * from nexus.member_data_export(%L, %L)', 'csv', repeat('a', 121))),
  'search_too_long', 'over-long search refused');
select is(nexus_test.hint_of(format('select * from nexus.member_data_export(%L, p_unit_id => %L)', 'csv', gen_random_uuid())),
  'invalid_unit', 'review L2: an unknown unit id is refused (export)');
select is(nexus_test.log_count(), :log_before, 'MD-31: refused exports wrote no log row');

-- MD-35 / A-MD12: if the log row cannot be written, the export fails and returns nothing.
reset role; select nexus_test.logout();
create function nexus_test.fail_log_insert() returns trigger language plpgsql
as $$ begin raise exception 'simulated export log failure'; end $$;
create trigger zz_test_fail_log before insert on nexus.member_data_export_logs
  for each row execute function nexus_test.fail_log_insert();
select nexus_test.login_as(4);
select throws_ok($$select * from nexus.member_data_export('csv')$$, 'P0001', 'simulated export log failure',
  'MD-35: export fails (no rows returned) when the log insert fails');
select is(nexus_test.log_count(), :log_before, 'MD-35: and no log row exists');
reset role; select nexus_test.logout();
drop trigger zz_test_fail_log on nexus.member_data_export_logs;

-- =============================================================================================
-- 9. Export log: append-only, no direct insert, readers (MD-33, MD-34, MD-36)
-- =============================================================================================
select nexus_test.login_as(1);
select throws_ok($$select * from nexus.member_data_export_logs$$, '42501', null,
  'MD-34: even P-ADMIN cannot read the table directly (only through the function)');
select throws_ok($$insert into nexus.member_data_export_logs (exporter_member_id, format, filter_status, search_used, period_id)
                   values (nexus_test.mid(1), 'csv', 'all', false, nexus_test.period(2))$$, '42501', null,
  'MD-33: direct insert refused (P-ADMIN)');
select throws_ok($$update nexus.member_data_export_logs set format = 'pdf'$$, '42501', null, 'MD-33: update refused (P-ADMIN)');
select throws_ok($$delete from nexus.member_data_export_logs$$, '42501', null, 'MD-33: delete refused (P-ADMIN)');
reset role; select nexus_test.login_as(3);
select throws_ok($$delete from nexus.member_data_export_logs$$, '42501', null, 'MD-33: delete refused (P-KETUM, a log reader)');
select throws_ok($$insert into nexus.member_data_export_logs (exporter_member_id, format, filter_status, search_used, period_id)
                   values (nexus_test.mid(3), 'csv', 'all', false, nexus_test.period(2))$$, '42501', null,
  'MD-33: direct insert refused (P-KETUM, an exporter)');
reset role; select nexus_test.logout();
set local role service_role;
select throws_ok($$insert into nexus.member_data_export_logs (exporter_member_id, format, filter_status, search_used, period_id)
                   values (gen_random_uuid(), 'csv', 'all', false, gen_random_uuid())$$, '42501', null,
  'MD-33: service_role cannot insert');
select throws_ok($$update nexus.member_data_export_logs set format = 'pdf'$$, '42501', null, 'MD-33: service_role cannot update');
reset role;
-- As the owner (SQL editor): the triggers still refuse.
select is(nexus_test.hint_of($$update nexus.member_data_export_logs set format = 'pdf'$$), 'append_only',
  'MD-33: update refused for the owner too (append-only trigger)');
select is(nexus_test.hint_of($$delete from nexus.member_data_export_logs$$), 'append_only',
  'MD-33: delete refused for the owner too');
select is(nexus_test.hint_of($$truncate nexus.member_data_export_logs$$), 'append_only', 'MD-33: truncate refused');
select is(nexus_test.hint_of($$insert into nexus.member_data_export_logs (exporter_member_id, format, filter_status, search_used, period_id)
                                values (gen_random_uuid(), 'csv', 'all', false, gen_random_uuid())$$),
  'export_log_direct_insert', 'MD-33: a hand-written insert by the owner is refused (only the export function writes)');

-- Readers.
select nexus_test.login_as(1);
select is((select count(*)::int from nexus.member_data_export_log_list()), nexus_test.log_count(),
  'MD-34: P-ADMIN reads every log row');
select is((select count(*)::int from nexus.member_data_export_log_list(p_page_size => 2)), 2, 'log read is paged');
select ok((select bool_and(l.total_count = nexus_test.log_count()) from nexus.member_data_export_log_list() l),
  'log read reports the total');
select ok((select l.exporter_name = 'Test Persona 3' and l.format = 'xlsx' and l.filter_unit_name = 'Departemen Operasional'
                  and l.filter_status = 'all' and l.search_used and l.period_label = '2091/2092'
           from nexus.member_data_export_log_list() l
           where l.log_id = (select min(x.log_id) from nexus.member_data_export_log_list() x
                             where x.exporter_member_id = nexus_test.mid(3) and x.format = 'xlsx')),
  'MD-34: the reader sees the exporter''s name, unit name and period label (looked up at read time)');
select is((select array_agg(l.log_id order by l.created_at desc, l.log_id desc) from nexus.member_data_export_log_list(p_page_size => 50) l),
          (select array_agg(l.log_id) from nexus.member_data_export_log_list(p_page_size => 50) l),
  'log is newest first');
select is(nexus_test.hint_of('select * from nexus.member_data_export_log_list(p_page_size => 51)'), 'invalid_page_size',
  'log page size is capped at 50');
reset role; select nexus_test.login_as(4);
select is((select count(*)::int from nexus.member_data_export_log_list()), nexus_test.log_count(),
  'MD-34: P-SEKJEN (BPH, D33) reads the log');

-- MD-36 / R22: the exporter is deactivated later; their rows and name stay.
reset role; select nexus_test.logout();
update public.members set is_active = false where id = nexus_test.mid(3);
select nexus_test.login_as(1);
select ok((select count(*) >= 3 and bool_and(l.exporter_name = 'Test Persona 3')
           from nexus.member_data_export_log_list() l where l.exporter_member_id = nexus_test.mid(3)),
  'MD-36: rows of a deactivated exporter remain, with their name');
reset role; select nexus_test.login_as(3);
select is(nexus_test.matrix(), array['42501', '42501', '42501', '42501', '42501'],
  'L1: the deactivated P-KETUM now gets nothing, token still valid');

-- =============================================================================================
-- 10. More than one page of members: export is never paged; members without a login are listed (R11)
-- =============================================================================================
reset role; select nexus_test.logout();
insert into public.members (id, full_name, email)
select ('30000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Bulk Member ' || lpad(g::text, 2, '0'),
       'bulk-' || g || '@example.test'
from generate_series(1, 45) g;
select nexus_test.login_as(4);
select is((select count(*)::int from nexus.member_data_list(p_search => 'bulk member', p_page_size => 50)), 45,
  'R11: members without a login (user_id null) are listed');
select is((select count(*)::int from nexus.member_data_list(p_page_size => 50)), 50, 'the list returns at most one page (50)');
select is((select total_count::int from nexus.member_data_list() limit 1), nexus_test.active_members(),
  'list total counts every active member');
select is((select count(*)::int from nexus.member_data_export('csv')), nexus_test.active_members(),
  'MD-29: export returns ALL matching rows (more than one page)');
select is(nexus.member_data_active_count(), nexus_test.active_members(), 'MD-38: count follows new members at once');

select * from finish();
rollback;
