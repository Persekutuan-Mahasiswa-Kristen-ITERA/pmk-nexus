-- pgTAP tests for the Meeting Minutes (Notulensi Rapat) module:
--   20261111100000_nexus_minutes_access_rules.sql  (D37, minutes.manage text, null-safe is_active_period)
--   20261111100100_nexus_minutes.sql               (tables, RLS, functions, export)
--   20261111100200_nexus_minutes_storage.sql       (private bucket nexus-minute-files + Storage policies)
-- Spec: docs/modules/meeting-minutes.md (approved 2026-11-09, D-027): sections 2-5, 8, 11 (MN-01..MN-30).
--
-- LOCAL / THROWAWAY DATABASE ONLY. Same guards as the other files: it refuses to run without
-- nexus.allow_destructive_tests = 'yes', stops if ANY account or member has a non-test email, and stops
-- on the NEXUS dev stack (@nexus.test accounts). Everything is rolled back.
--   PGOPTIONS='-c nexus.allow_destructive_tests=yes' psql "<throwaway url>" -X -At -f supabase/tests/nexus_minutes.test.sql
-- Storage policy tests run only when a storage schema exists (tests/support/storage_stub.sql loaded
-- before the migrations); otherwise they are reported as skipped.
--
-- Personas (auth uid 10000000-...-NN, member id 20000000-...-NN), as in the other files plus:
--   21 P-KADEP-INT = Kepala Departemen of Departemen Internal (same unit as P-SEKDEP; D37)
--   22 P-KABIRO    = Kepala Biro of Biro Kewirausahaan (role kepala_departemen; D37)
--   23 P-KADIV     = Kepala Divisi Logistik (no minutes right, B19)
--   12 P-BEND-SEK  = Bendahara Umum 2 + Sekretaris Departemen Talenta (view all via bph, manage Talenta)
--   18 P-SEKDEP2   = Sekretaris Departemen Pelayanan Khusus + Sekretaris Biro Kewirausahaan (two units, MN-07)

\set ON_ERROR_STOP on
begin;

-- W1 guard (see tests/README.md).
do $$
begin
  if coalesce(current_setting('nexus.allow_destructive_tests', true), '') <> 'yes' then
    raise exception 'nexus_minutes.test.sql writes test rows into PI-CORE tables: local throwaway database only. Set nexus.allow_destructive_tests=yes (see supabase/tests/README.md) to run it.';
  end if;
end
$$;

-- Data guard (security review M1).
do $$
begin
  if exists (select 1 from auth.users u where u.email is null or u.email !~* '@(example\.test|nexus\.test)$')
     or exists (select 1 from public.members m where m.email is not null and m.email !~* '@(example\.test|nexus\.test)$') then
    raise exception 'nexus_minutes.test.sql: found a non-test email address, so this is NOT a throwaway local database. Nothing was written.';
  end if;
end
$$;

-- Dev-stack guard (review L5).
do $$
begin
  if exists (select 1 from auth.users u where u.email ~* '@nexus\.test$')
     or exists (select 1 from public.members m where m.email ~* '@nexus\.test$') then
    raise exception 'nexus_minutes.test.sql: found the NEXUS dev stack seed accounts (@nexus.test). Run it only in a fresh throwaway container (see supabase/tests/README.md). Nothing was written.';
  end if;
end
$$;

-- Fresh-install guard: counts below assume no minute exists yet.
do $$
begin
  if exists (select 1 from nexus.minutes) or exists (select 1 from nexus.minute_export_logs) then
    raise exception 'nexus_minutes.test.sql: minutes or export-log rows already exist; use a fresh throwaway container. Nothing was written.';
  end if;
end
$$;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------------------------
-- Helpers (rolled back with everything else)
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

create function nexus_test.login_as(n int) returns void language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', nexus_test.uid(n), 'role', 'authenticated')::text, true);
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
create function nexus_test.detail_of(p_sql text) returns text language plpgsql
as $$
declare
  v_detail text;
begin
  execute p_sql;
  return 'no_error';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end
$$;
create function nexus_test.msg_of(p_sql text) returns text language plpgsql
as $$
begin
  execute p_sql;
  return 'no_error';
exception when others then
  return sqlerrm;
end
$$;

create table nexus_test.ids (name text primary key, id uuid not null);
create function nexus_test.put(p_name text, p_id uuid) returns uuid language sql security definer set search_path = ''
as $$ insert into nexus_test.ids values (p_name, p_id) on conflict (name) do update set id = excluded.id returning id $$;
create function nexus_test.id(p_name text) returns uuid language sql stable security definer set search_path = ''
as $$ select i.id from nexus_test.ids i where i.name = p_name $$;
-- Oracles (owner view, bypasses RLS on purpose).
create function nexus_test.mv(p_name text) returns int language sql stable security definer set search_path = ''
as $$ select m.version from nexus.minutes m where m.id = nexus_test.id(p_name) $$;
create function nexus_test.ms(p_name text) returns text language sql stable security definer set search_path = ''
as $$ select m.status from nexus.minutes m where m.id = nexus_test.id(p_name) $$;
create function nexus_test.d(n int) returns date language sql stable
as $$ select (now() at time zone 'Asia/Jakarta')::date + n $$;
create function nexus_test.has_storage() returns boolean language sql stable
as $$ select to_regclass('storage.objects') is not null $$;
create function nexus_test.fpath(n int, p_ext text default 'pdf', p_size bigint default 120000, p_mime text default null)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v text := nexus_test.mid(n)::text || '/' || gen_random_uuid()::text || '.' || p_ext;
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)'
      using 'nexus-minute-files', v,
            jsonb_build_object('size', p_size, 'mimetype',
                               coalesce(p_mime, case p_ext when 'pdf' then 'application/pdf' when 'png' then 'image/png' else 'image/jpeg' end));
  end if;
  return v;
end
$$;
create function nexus_test.files(n int, k int) returns jsonb language sql volatile
as $$ select coalesce(jsonb_agg(jsonb_build_object('path', nexus_test.fpath(n), 'name', 'lampiran-' || g || '.pdf')), '[]'::jsonb)
      from generate_series(1, k) g $$;
create function nexus_test.file1(p_path text, p_name text default 'notulen.pdf') returns jsonb language sql immutable
as $$ select jsonb_build_array(jsonb_build_object('path', p_path, 'name', p_name)) $$;
-- The caller's scope for a key: 'all', the sorted unit names, or 'none'.
create function nexus_test.scope(p_key text) returns text language sql stable security definer set search_path = ''
as $$
  select case when nexus.has_permission(p_key) then 'all'
              else coalesce((select string_agg(u.name, ',' order by u.name)
                             from unnest(nexus.permission_unit_ids(p_key)) x join public.org_units u on u.id = x), 'none') end
$$;
create function nexus_test.scopes() returns text language sql stable
as $$ select nexus_test.scope('minutes.view') || ' | ' || nexus_test.scope('minutes.manage') || ' | ' || nexus_test.scope('minutes.export') $$;
-- Records a minute as the current caller (simple valid values).
create function nexus_test.rec(p_name text, p_unit text, p_title text default 'Rapat uji', p_files jsonb default null) returns uuid
language sql volatile
as $$ select nexus_test.put(p_name, (select minute_id from nexus.minute_record(nexus_test.unit(p_unit), nexus_test.d(-1), p_title,
                                                                                'Topik uji', 'Isi notulensi uji', null, p_files))) $$;
create function nexus_test.log_count() returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from nexus.minute_export_logs $$;
create function nexus_test.out_cols(p_fn regprocedure) returns text[] language sql stable
as $$
  select coalesce(array_agg(a.n order by a.i), '{}')
  from pg_proc f, unnest(f.proargnames, f.proargmodes::text[]) with ordinality as a(n, m, i)
  where f.oid = p_fn and a.m = 't'
$$;
create function nexus_test.sto(p_sql text) returns text language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;
create function nexus_test.sto_count(p_where text) returns int language plpgsql
as $$
declare
  n int;
begin
  if to_regclass('storage.objects') is null then
    return -1;
  end if;
  execute 'select count(*)::int from storage.objects where ' || p_where into n;
  return n;
end
$$;
create function nexus_test.sto_val(p_sql text) returns text language plpgsql
as $$
declare
  v text;
begin
  if to_regclass('storage.objects') is null then
    return '';
  end if;
  execute p_sql into v;
  return v;
end
$$;
grant execute on all functions in schema nexus_test to authenticated;
grant usage on schema nexus_test to anon;
grant execute on function nexus_test.has_storage(), nexus_test.sto_count(text), nexus_test.sto(text) to anon;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select nexus_test.uid(n), 'nexus-test-' || n || '@example.test', 'authenticated', 'authenticated'
from generate_series(1, 23) n;

insert into public.members (id, user_id, full_name, email, access_level, member_type)
select nexus_test.mid(n), nexus_test.uid(n), 'Test Persona ' || n, 'nexus-test-' || n || '@example.test',
       (case n when 1 then 'admin' when 2 then 'super_admin' else 'member' end)::public.access_level,
       (case n when 16 then 'lecturer' else 'student' end)::public.member_type
from generate_series(1, 23) n
where n <> 17;

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
  (10, 'Pubdok',                      'division',   'Staff',                 2),
  (12, 'BPH PMK ITERA',               'bph',        'Bendahara Umum 2',      2),
  (12, 'Departemen Talenta',          'department', 'Sekretaris Departemen', 2),
  (14, 'BPH PMK ITERA',               'bph',        'Sekretaris Jenderal',   1),
  (15, 'Departemen Eksternal',        'department', 'Kepala Departemen',     2),
  (18, 'Departemen Pelayanan Khusus', 'department', 'Sekretaris Departemen', 2),
  (18, 'Biro Kewirausahaan',          'bureau',     'Sekretaris Biro',       2),
  (19, 'BPH PMK ITERA',               'bph',        'Sekretaris Umum 1',     2),
  (21, 'Departemen Internal',         'department', 'Kepala Departemen',     2),
  (22, 'Biro Kewirausahaan',          'bureau',     'Kepala Biro',           2),
  (23, 'Logistik',                    'division',   'Kepala Divisi',         2)
) as v(n, unit_name, unit_type, position_name, p);
update public.members set is_active = false where id = nexus_test.mid(15);

select is((select count(*)::int from public.assignments where member_id::text like '20000000-%'), 17,
  'fixtures: 17 persona assignments created (PI-CORE names match the test)');

-- =============================================================================================
-- 1. Structure, privileges, catalog, D37 (MN-15, MN-30)
-- =============================================================================================
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'MN-30: RLS is enabled on every nexus table');
select is((select count(*)::int from pg_tables where schemaname = 'nexus'
           and tablename in ('minutes', 'minute_files', 'minute_history', 'minute_export_logs')), 4, 'the 4 minute tables exist');
select is((select count(*)::int from pg_policies where schemaname = 'nexus' and tablename like 'minute%' and cmd <> 'SELECT'), 0,
  'MN-30: SELECT policies only (no insert, update or delete policy)');
select is((select count(*)::int from pg_policies where schemaname = 'nexus' and tablename = 'minute_export_logs'), 0,
  'MN-27: the export log has no policy at all');
select ok(not has_table_privilege('authenticated', 'nexus.minute_export_logs', 'select'), 'MN-27: ... and no client grant');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p')
             and (has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')
                  or has_table_privilege('service_role', c.oid, 'insert, update, delete, truncate'))), 0,
  'MN-30/W2: neither authenticated nor service_role can write any nexus table directly');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'minute\_%'), 12, 'module API has 12 minute_* functions');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'minute\_%'
             and (not has_function_privilege('authenticated', p.oid, 'execute')
                  or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute')
                  or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                  or not p.prosecdef
                  or not coalesce(p.proconfig @> array['search_path=""'], false))), 0,
  'module API: SECURITY DEFINER, empty search_path, EXECUTE for authenticated only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like '\_mn\_%'
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0,
  'internal _mn_* helpers are not executable by clients');
select is((select count(*)::int from information_schema.columns c
           where c.table_schema = 'nexus' and c.table_name like 'minute%' and c.column_name ~* '(email|phone|nim|nip|whatsapp|user_id)'), 0,
  'MN-30/L4: no minute table has a contact, identity-number or auth column');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'minute\_%'
             and p.proargnames && array['p_member_id', 'p_period_id', 'p_created_by', 'p_creator']), 0,
  'MN-09: no function lets a client give a member, period or creator');
select ok(not exists (select 1 from pg_proc p where p.proname = 'minute_update' and p.proargnames && array['p_org_unit_id', 'p_unit_id']),
  'MN-11: the unit is not even a parameter of the edit');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'nexus' and p.proname ~ '^minute_.*(delete|remove|purge)'),
  'MN-15: no delete function exists');
select is(nexus_test.out_cols('nexus.minute_dashboard_counts()'),
          array['period_id', 'period_label', 'period_starts_on', 'period_ends_on', 'minute_count', 'latest_meeting_date'],
  'MN-28/N5 a: the Dashboard function returns counts and a date only, no title');
select is(nexus_test.out_cols('nexus.minute_export(text,text,uuid,text,text,uuid)'),
          array['row_no', 'minute_id', 'meeting_date', 'unit_name', 'unit_type', 'title', 'topic', 'content', 'decision', 'status',
                'void_reason', 'period_label', 'created_by_name', 'created_at', 'file_count', 'total_count'],
  'spec 8: export columns (full content and decision, no file path or link) plus total_count');
select ok((select bool_and(p.provolatile = 'v') from pg_proc p
           where p.oid in ('nexus.minute_export(text,text,uuid,text,text,uuid)'::regprocedure,
                           'nexus.minute_record(uuid,date,text,text,text,text,jsonb)'::regprocedure)),
  'exports and writes are VOLATILE');
select is((select count(*)::int from nexus.permissions), 22, 'no new permission key (22 keys)');
select ok((select subject_type = 'role' and role_key = 'kepala_departemen' and permission_key = 'minutes.view' and scope = 'own_unit'
                  and is_enabled and note is not null
           from nexus.access_rules where default_code = 'D37'),
  'D37 (N1 b): role kepala_departemen -> minutes.view, own unit, enabled, with a written note');
select is((select count(*)::int from nexus.access_rule_log l join nexus.access_rules r on r.id = l.rule_id
           where r.default_code = 'D37' and l.action = 'seed' and l.actor_member_id is null), 1, 'D37 is logged once as seed');
select ok((select description ~ 'void' and description !~ 'archive' from nexus.permissions where key = 'minutes.manage'),
  'A-MN15: the minutes.manage text says void, not archive');
select ok(nexus.is_active_period(null) is false, 'is_active_period(null) is false');

-- =============================================================================================
-- 2. Who holds what (spec section 2 table; MN-01..MN-07)
-- =============================================================================================
select nexus_test.login_as(4);
select is(nexus_test.scopes(), 'all | all | all', 'MN-01: P-SEKJEN views, manages and exports every unit');
reset role; select nexus_test.login_as(19);
select is(nexus_test.scopes(), 'all | all | all', 'MN-01: P-SEKUM1 the same');
reset role; select nexus_test.login_as(3);
select is(nexus_test.scopes(), 'all | none | all', 'MN-04: P-KETUM views and exports all, manages nothing');
reset role; select nexus_test.login_as(5);
select is(nexus_test.scopes(), 'all | none | all', 'MN-04: P-BEND the same');
reset role; select nexus_test.login_as(6);
select is(nexus_test.scopes(), 'Departemen Internal | Departemen Internal | Departemen Internal',
  'MN-02: P-SEKDEP views, manages and exports Departemen Internal only');
reset role; select nexus_test.login_as(18);
select is(nexus_test.scopes(), 'Biro Kewirausahaan,Departemen Pelayanan Khusus | Biro Kewirausahaan,Departemen Pelayanan Khusus | Biro Kewirausahaan,Departemen Pelayanan Khusus',
  'MN-07/E9: secretary of two units holds both units, no other');
reset role; select nexus_test.login_as(12);
select is(nexus_test.scopes(), 'all | Departemen Talenta | all', 'R7: P-BEND-SEK views all (bph) and manages only Talenta');
reset role; select nexus_test.login_as(21);
select is(nexus_test.scopes(), 'Departemen Internal | none | none', 'MN-05/D37: the Kepala Departemen reads own unit only, no manage, no export');
reset role; select nexus_test.login_as(22);
select is(nexus_test.scopes(), 'Biro Kewirausahaan | none | none', 'D37: the Kepala Biro reads the bureau only');
reset role; select nexus_test.login_as(7);
select is(nexus_test.scopes(), 'Departemen Operasional | none | none', 'D37: P-KADEP-OPS reads Departemen Operasional only');
-- MN-06: everybody else holds nothing
reset role; select nexus_test.login_as(1);
select is(nexus_test.scopes(), 'none | none | none', 'MN-06/B18: P-ADMIN (no position) holds nothing');
reset role; select nexus_test.login_as(2);
select is(nexus_test.scopes(), 'none | none | none', 'MN-06: P-SUPER holds nothing');
reset role; select nexus_test.login_as(11);
select is(nexus_test.scopes(), 'none | none | none', 'MN-06: P-PLAIN holds nothing');
reset role; select nexus_test.login_as(10);
select is(nexus_test.scopes(), 'none | none | none', 'MN-06: P-STAFF-PUB holds nothing');
reset role; select nexus_test.login_as(8);
select is(nexus_test.scopes(), 'none | none | none', 'B19: P-STAFF-LOG holds nothing');
reset role; select nexus_test.login_as(23);
select is(nexus_test.scopes(), 'none | none | none', 'B19: a Kepala Divisi holds nothing');
reset role; select nexus_test.login_as(16);
select is(nexus_test.scopes(), 'none | none | none', 'MN-06: P-LECT holds nothing');
reset role; select nexus_test.login_as(14);
select is(nexus_test.scopes(), 'none | none | none', 'MN-06: P-OLD (Sekjen of the previous period) holds nothing');
reset role; select nexus_test.login_as(15);
select is(nexus_test.scopes(), 'none | none | none', 'MN-06: P-INACTIVE holds nothing');
reset role; select nexus_test.login_as(17);
select is(nexus_test.scopes(), 'none | none | none', 'MN-06: P-UNLINKED holds nothing');

-- D37 is a normal default rule: disable -> gone at once; restore-defaults brings it back.
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where default_code = 'D37'), 'test D37'), 'admin disables D37');
reset role; select nexus_test.login_as(21);
select is(nexus_test.scope('minutes.view'), 'none', 'MN-05: with D37 disabled the Kepala Departemen reads nothing');
reset role; select nexus_test.login_as(1);
select is(nexus.restore_default_access_rules('test restore D37', true), 1, 'restore_default_access_rules() re-enables D37 (it knows the new default)');
reset role; select nexus_test.login_as(21);
select is(nexus_test.scope('minutes.view'), 'Departemen Internal', '... and the head reads own unit again');

-- =============================================================================================
-- 3. Unit options (F1 filter, F3 unit select; N2 c)
-- =============================================================================================
reset role; select nexus_test.login_as(4);
select is((select count(*)::int from nexus.minute_unit_options() where can_record), 10,
  'N2 c: a BPH secretary may record for the root, BPH, the 7 departments and the bureau (10 units)');
select ok(not exists (select 1 from nexus.minute_unit_options() where unit_type = 'division'), 'A-MN18: divisions are not offered');
select ok(exists (select 1 from nexus.minute_unit_options() where unit_type = 'organization' and can_record and can_read),
  'N2 c: the root "Seluruh organisasi" is offered');
reset role; select nexus_test.login_as(6);
select is((select array_agg(unit_name order by unit_name) from nexus.minute_unit_options() where can_record), array['Departemen Internal'],
  'MN-02: P-SEKDEP may record for Departemen Internal only');
select is((select count(*)::int from nexus.minute_unit_options() where can_read), 1, 'MN-22: one readable unit (the filter is hidden)');
reset role; select nexus_test.login_as(21);
select ok((select count(*) = 1 and bool_and(can_read and not can_record) from nexus.minute_unit_options()),
  'D37: the head reads one unit and records none');
reset role; select nexus_test.login_as(12);
select ok((select count(*) filter (where can_record) = 1 and count(*) filter (where can_read) >= 10 from nexus.minute_unit_options()),
  'R7: P-BEND-SEK reads every unit, records only Talenta');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of('select * from nexus.minute_unit_options()'), 'permission_required', 'MN-06: P-PLAIN gets no unit list');

-- =============================================================================================
-- 4. Record (F3, MN-01, MN-02, MN-09, R1, R2, R9, R10, A-MN2, A-MN3)
-- =============================================================================================
reset role; select nexus_test.login_as(4);
select nexus_test.put('m_bph', minute_id) from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0),
  '  Rapat   koordinasi   BPH ', 'Persiapan kegiatan', E'Poin 1\r\nPoin 2\n\n', '   ');
select ok((select org_unit_id = nexus_test.unit('BPH PMK ITERA') and period_id = nexus_test.period(2) and created_by = nexus_test.mid(4)
                  and status = 'active' and version = 1 and meeting_date = nexus_test.d(0)
           from nexus.minutes where id = nexus_test.id('m_bph')),
  'MN-09: saved Aktif, unit as chosen, period = active period, creator from the session');
select ok((select title = 'Rapat koordinasi BPH' and content = E'Poin 1\nPoin 2' and decision is null from nexus.minutes where id = nexus_test.id('m_bph')),
  'M2/A-MN2: title on one line, content keeps line breaks (CRLF -> LF, trimmed), a blank decision is empty');
select is((select kind from nexus.minute_history where minute_id = nexus_test.id('m_bph')), 'recorded', 'F3.3: one history row "Dicatat"');
select nexus_test.rec('m_root', 'PMK ITERA', 'Rapat pleno');
select nexus_test.rec('m_ext', 'Departemen Eksternal', 'Rapat eksternal', nexus_test.files(4, 1));
select ok(nexus_test.ms('m_root') = 'active' and nexus_test.ms('m_ext') = 'active', 'N2 c: minutes for the root and another department');
-- Refusals (no row is written)
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('Logistik'), nexus_test.d(0), 'x', 'y', 'z')$$), 'invalid_unit',
  'A-MN18/M1: a division is refused');
select is(nexus_test.hint_of($$select * from nexus.minute_record(null, nexus_test.d(0), 'x', 'y', 'z')$$), 'invalid_unit', 'a unit is required');
select is(nexus_test.hint_of($$select * from nexus.minute_record(gen_random_uuid(), nexus_test.d(0), 'x', 'y', 'z')$$), 'invalid_unit', 'an unknown unit is refused');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(1), 'x', 'y', 'z')$$), 'date_in_future',
  'R9/A-MN5: the meeting date cannot be in the future (Jakarta)');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), null, 'x', 'y', 'z')$$), 'date_required', 'the meeting date is required');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), date '1999-12-31', 'x', 'y', 'z')$$), 'invalid_dates', 'dates before 2000 are refused');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), 'infinity'::date, 'x', 'y', 'z')$$), 'invalid_dates', 'infinity is refused');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0), '  ', 'y', 'z')$$), 'text_required', 'the title is required');
select is(nexus_test.detail_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0), 'x', '', 'z')$$), 'topic', 'the topic is required');
select is(nexus_test.detail_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0), 'x', 'y', E' \n ')$$), 'content', 'the content is required');
select is(nexus_test.hint_of(format('select * from nexus.minute_record(nexus_test.unit(%L), nexus_test.d(0), %L, %L, %L)', 'BPH PMK ITERA', repeat('t', 151), 'y', 'z')),
  'text_too_long', 'A-MN3: title max 150');
select is(nexus_test.detail_of(format('select * from nexus.minute_record(nexus_test.unit(%L), nexus_test.d(0), %L, %L, %L)', 'BPH PMK ITERA', 'x', repeat('t', 201), 'z')),
  'topic', 'A-MN3: topic max 200');
select is(nexus_test.detail_of(format('select * from nexus.minute_record(nexus_test.unit(%L), nexus_test.d(0), %L, %L, %L)', 'BPH PMK ITERA', 'x', 'y', repeat('c', 20001))),
  'content', 'A-MN3: content max 20000');
-- Two statements: a row inserted by a function is not visible to another subquery of the SAME statement.
select nexus_test.put('m_long', minute_id) from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(-3), 'Batas isi', 'Topik', repeat('c', 20000));
select is((select char_length(content) from nexus.minutes where id = nexus_test.id('m_long')), 20000,
  'A-MN3: exactly 20000 characters of content are accepted');
select is(nexus_test.detail_of(format('select * from nexus.minute_record(nexus_test.unit(%L), nexus_test.d(0), %L, %L, %L, %L)', 'BPH PMK ITERA', 'x', 'y', 'z', repeat('d', 5001))),
  'decision', 'A-MN3: decision max 5000');
select nexus_test.put('m_xss', minute_id) from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(-2),
  '<script>alert(1)</script>', 'Topik <b>tebal</b>', '<img src=x onerror=alert(1)>', '=SUM(A1)');
select ok((select title = '<script>alert(1)</script>' and content = '<img src=x onerror=alert(1)>' and decision = '=SUM(A1)'
           from nexus.minutes where id = nexus_test.id('m_xss')),
  'MN-16/R10: markup is stored verbatim as plain text (escaping is the screen''s and export''s job)');
-- CMIT deactivated in PI-CORE: no new minute for it (M1). Rolled back right after.
reset role; select nexus_test.logout();
update public.org_units set is_active = false where id = nexus_test.unit('Departemen CMIT');
select nexus_test.login_as(4);
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('Departemen CMIT'), nexus_test.d(0), 'x', 'y', 'z')$$), 'invalid_unit',
  'M1: an inactive unit gets no new minute');
reset role; select nexus_test.logout();
update public.org_units set is_active = true where id = nexus_test.unit('Departemen CMIT');

-- Department secretary: own unit only (MN-02)
select nexus_test.login_as(6);
select nexus_test.rec('m_int1', 'Departemen Internal', 'Rapat internal satu', nexus_test.files(6, 2));
select nexus_test.rec('m_int2', 'Departemen Internal', 'Rapat internal dua');
select is((select count(*)::int from nexus.minute_files where minute_id = nexus_test.id('m_int1')), 2, 'F3: two attachments saved with the minute');
select is((select count(*)::int from nexus.minute_history where minute_id = nexus_test.id('m_int1') and kind = 'file_added'), 2, 'one history row per file');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('Departemen Eksternal'), nexus_test.d(0), 'x', 'y', 'z')$$), 'unit_not_allowed',
  'MN-02: a direct call with another unit''s id is refused');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0), 'x', 'y', 'z')$$), 'unit_not_allowed',
  'MN-02: ... also for BPH');
reset role; select nexus_test.login_as(18);
select nexus_test.rec('m_biro', 'Biro Kewirausahaan', 'Rapat biro');
select nexus_test.rec('m_pk', 'Departemen Pelayanan Khusus', 'Rapat pelayanan khusus');
select ok(nexus_test.ms('m_biro') = 'active' and nexus_test.ms('m_pk') = 'active', 'MN-07: the two-unit secretary records for both units');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('Departemen Internal'), nexus_test.d(0), 'x', 'y', 'z')$$), 'unit_not_allowed',
  'MN-07: ... and for no other unit');
reset role; select nexus_test.login_as(12);
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0), 'x', 'y', 'z')$$), 'unit_not_allowed',
  'R7: viewing all does not mean managing all (P-BEND-SEK, BPH unit)');
-- Everybody without manage
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0), 'x', 'y', 'z')$$), 'permission_required',
  'MN-04: P-KETUM cannot record (direct call)');
reset role; select nexus_test.login_as(21);
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('Departemen Internal'), nexus_test.d(0), 'x', 'y', 'z')$$), 'permission_required',
  'MN-05: the Kepala Departemen cannot record');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0), 'x', 'y', 'z')$$), 'permission_required',
  'MN-06: P-ADMIN cannot record');
reset role; select nexus_test.login_as(15);
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('Departemen Eksternal'), nexus_test.d(0), 'x', 'y', 'z')$$), 'permission_required',
  'MN-06: P-INACTIVE cannot record');
reset role; select nexus_test.login_as(17);
select is(nexus_test.hint_of($$select * from nexus.minute_list()$$), 'permission_required', 'MN-06: P-UNLINKED reads nothing');
reset role; select nexus_test.logout();
set local role authenticated;
select is(nexus_test.hint_of($$select * from nexus.minute_list()$$), 'permission_required', 'a token without a subject reads nothing');
reset role;

-- =============================================================================================
-- 5. Browse, scope, search, detail (F1, F2, MN-03, MN-21, MN-22, R13)
-- =============================================================================================
select nexus_test.login_as(6);
select is((select array_agg(title order by title) from nexus.minute_list()), array['Rapat internal dua', 'Rapat internal satu'],
  'MN-03: P-SEKDEP lists only Departemen Internal');
select is((select count(*)::int from nexus.minute_list(p_unit_id => nexus_test.unit('Departemen Eksternal'))), 0,
  'R13/M7: a hand-made filter for another unit returns nothing');
select is(nexus_test.hint_of(format('select nexus.minute_detail(%L)', nexus_test.id('m_ext'))), 'minute_not_found',
  'MN-03: another unit''s detail answers "not found" (like a missing id)');
select is(nexus_test.hint_of(format('select nexus.minute_detail(%L)', gen_random_uuid())), 'minute_not_found', '... same as a missing id');
select ok((select (d ->> 'unit_name') = 'Departemen Internal' and (d ->> 'period_label') = '2091/2092' and (d ->> 'created_by_name') = 'Test Persona 6'
                  and (d -> 'actions' ->> 'can_edit')::boolean and (d -> 'actions' ->> 'can_export')::boolean
                  and (d ->> 'file_count')::int = 2 and jsonb_array_length(d -> 'history') = 3
           from nexus.minute_detail(nexus_test.id('m_int1')) d),
  'F2: the detail has unit, period, recorder (PI-CORE name), files, history and the manager buttons');
reset role; select nexus_test.login_as(21);
select is((select count(*)::int from nexus.minute_list()), 2, 'MN-05: the Kepala Departemen lists own unit''s minutes');
select ok((select not (d -> 'actions' ->> 'can_edit')::boolean and not (d -> 'actions' ->> 'can_void')::boolean
                  and not (d -> 'actions' ->> 'can_add_files')::boolean and not (d -> 'actions' ->> 'can_export')::boolean
           from nexus.minute_detail(nexus_test.id('m_int1')) d),
  'MN-05: ... read only (no edit, void, file or export button)');
select is(nexus_test.hint_of(format('select nexus.minute_detail(%L)', nexus_test.id('m_bph'))), 'minute_not_found', 'MN-05: ... and nothing of BPH');
reset role; select nexus_test.login_as(22);
select is((select array_agg(title) from nexus.minute_list()), array['Rapat biro'], 'D37: the Kepala Biro reads the bureau minute only');
-- N2 c: a "Seluruh organisasi" minute is readable by scope "all" only (no secretary or head holds the root).
select is(nexus_test.hint_of(format('select nexus.minute_detail(%L)', nexus_test.id('m_root'))), 'minute_not_found',
  'N2 c: the Kepala Biro does not read the "Seluruh organisasi" minute');
reset role; select nexus_test.login_as(21);
select is(nexus_test.hint_of(format('select nexus.minute_detail(%L)', nexus_test.id('m_root'))), 'minute_not_found',
  'N2 c: ... nor the Kepala Departemen');
reset role; select nexus_test.login_as(6);
select is(nexus_test.hint_of(format('select nexus.minute_detail(%L)', nexus_test.id('m_root'))), 'minute_not_found',
  'N2 c: ... nor a department secretary');
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('PMK ITERA'), nexus_test.d(0), 'x', 'y', 'z')$$), 'unit_not_allowed',
  'N2 c: a department secretary cannot record for "Seluruh organisasi"');
select is((select count(*)::int from nexus.minutes where id = nexus_test.id('m_root')), 0, 'N2 c: ... and RLS hides the row from her');
reset role; select nexus_test.login_as(18);
select is(nexus_test.hint_of(format('select nexus.minute_detail(%L)', nexus_test.id('m_root'))), 'minute_not_found',
  'N2 c: ... nor the two-unit secretary');
reset role; select nexus_test.login_as(3);
select is((select d ->> 'unit_type' from nexus.minute_detail(nexus_test.id('m_root')) d), 'organization',
  'N2 c: BPH (scope all) reads the "Seluruh organisasi" minute');
reset role; select nexus_test.login_as(5);
select is((select count(*)::int from nexus.minutes where id = nexus_test.id('m_root')), 1, 'N2 c: ... P-BEND too (table, RLS)');
reset role; select nexus_test.login_as(3);
select is((select count(*)::int from nexus.minute_list(p_page_size => 50)), 9, 'MN-04: P-KETUM lists every Aktif minute of the period (9)');
select is((select count(*)::int from nexus.minute_list(p_search => 'INTERNAL')), 2, 'MN-21: search on the title, case-insensitive');
select is((select count(*)::int from nexus.minute_list(p_search => 'poin 2')), 1, 'MN-21: search on the content');
select is((select count(*)::int from nexus.minute_list(p_search => 'persiapan')), 1, 'MN-21: search on the topic');
select is((select count(*)::int from nexus.minute_list(p_search => '%')), 0, 'search: % is a literal character');
select is(nexus_test.hint_of(format('select * from nexus.minute_list(p_search => %L)', repeat('s', 121))), 'search_too_long', 'search max 120');
select is((select count(*)::int from nexus.minute_list(p_unit_id => nexus_test.unit('Departemen Internal'))), 2, 'MN-22: the unit filter');
select ok((select bool_and(total_count = 9 and page = 2 and page_size = 4) and count(*) = 4 from nexus.minute_list(p_page => 2, p_page_size => 4)),
  'MN-22: server pagination (page 2 of size 4, total 9)');
select ok((select page = 3 from nexus.minute_list(p_page => 99, p_page_size => 4) limit 1), 'a page past the end returns the last page');
select is(nexus_test.hint_of('select * from nexus.minute_list(p_page_size => 51)'), 'invalid_page_size', 'page size max 50');
select is(nexus_test.hint_of('select * from nexus.minute_list(p_status => ''draft'')'), 'invalid_status', 'status filter values');
select is(nexus_test.hint_of('select * from nexus.minute_list(p_period => ''old'')'), 'invalid_period', 'period filter values');
select is((select title from nexus.minute_list() where row_no = 1), 'Rapat koordinasi BPH', 'A-MN6: newest meeting date first');
select ok((select bool_and(f) from (select (lag(meeting_date) over (order by row_no) >= meeting_date) is not false as f
                                    from nexus.minute_list(p_page_size => 50)) x),
  'A-MN6: sorted by meeting date, newest first');

-- =============================================================================================
-- 6. Edit with history (F4, N3 a, MN-11, MN-14)
-- =============================================================================================
reset role; select nexus_test.login_as(6);
select ok((select changed from nexus.minute_update(nexus_test.id('m_int1'), nexus_test.mv('m_int1'), nexus_test.d(-1),
                                                   'Rapat internal satu (revisi)', 'Topik uji', 'Isi notulensi uji', 'Keputusan baru')),
  'F4: the secretary edits the title and adds a decision');
select ok((select before_data = jsonb_build_object('title', 'Rapat internal satu', 'decision', null)
                  and after_data = jsonb_build_object('title', 'Rapat internal satu (revisi)', 'decision', 'Keputusan baru')
                  and actor_member_id = nexus_test.mid(6) and period_id = nexus_test.period(2)
           from nexus.minute_history where minute_id = nexus_test.id('m_int1') and kind = 'edited'),
  'MN-11: one history row with before and after of the changed fields only, who and period');
select ok(not (select changed from nexus.minute_update(nexus_test.id('m_int1'), nexus_test.mv('m_int1'), nexus_test.d(-1),
                                                       'Rapat internal satu (revisi)', 'Topik uji', 'Isi notulensi uji', 'Keputusan baru')),
  'nothing changed = no save');
select is((select count(*)::int from nexus.minute_history where minute_id = nexus_test.id('m_int1') and kind = 'edited'), 1, '... and no history row');
select nexus_test.mv('m_int1') as v_int1 \gset
select ok((select changed from nexus.minute_update(nexus_test.id('m_int1'), :v_int1, nexus_test.d(-2), 'Rapat internal satu (revisi)', 'Topik uji', 'Isi notulensi uji', 'Keputusan baru')),
  'MN-14: the first of two saves with the same version succeeds');
select is(nexus_test.hint_of(format('select * from nexus.minute_update(%L, %s, nexus_test.d(-1), %L, %L, %L)', nexus_test.id('m_int1'), :v_int1, 'x', 'y', 'z')),
  'state_changed', 'MN-14: the second gets "Data sudah berubah"');
select is(nexus_test.hint_of(format('select * from nexus.minute_update(%L, %s, nexus_test.d(1), %L, %L, %L)', nexus_test.id('m_int1'), nexus_test.mv('m_int1'), 'x', 'y', 'z')),
  'date_in_future', 'edits are validated like recording');
select is(nexus_test.hint_of(format('select * from nexus.minute_update(%L, %s, nexus_test.d(0), %L, %L, %L)', nexus_test.id('m_ext'), nexus_test.mv('m_ext'), 'x', 'y', 'z')),
  'minute_not_found', 'MN-03: another unit''s minute cannot be edited (not even found)');
reset role; select nexus_test.login_as(19);
select ok((select changed from nexus.minute_update(nexus_test.id('m_int1'), nexus_test.mv('m_int1'), nexus_test.d(-2), 'Rapat internal satu (revisi)', 'Topik baru', 'Isi notulensi uji', 'Keputusan baru')),
  'MN-01: a BPH secretary edits a department minute (scope all)');
reset role; select nexus_test.login_as(12);
select is(nexus_test.hint_of(format('select * from nexus.minute_update(%L, %s, nexus_test.d(0), %L, %L, %L)', nexus_test.id('m_int1'), nexus_test.mv('m_int1'), 'x', 'y', 'z')),
  'permission_required', 'R7: P-BEND-SEK reads it but cannot edit outside Talenta');
reset role; select nexus_test.login_as(21);
select is(nexus_test.hint_of(format('select * from nexus.minute_update(%L, %s, nexus_test.d(0), %L, %L, %L)', nexus_test.id('m_int1'), nexus_test.mv('m_int1'), 'x', 'y', 'z')),
  'permission_required', 'MN-05: the Kepala Departemen cannot edit');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of(format('select * from nexus.minute_update(%L, %s, nexus_test.d(0), %L, %L, %L)', nexus_test.id('m_int1'), nexus_test.mv('m_int1'), 'x', 'y', 'z')),
  'permission_required', 'MN-04: P-KETUM cannot edit');
reset role; select nexus_test.logout();
select is(nexus_test.hint_of(format('update nexus.minutes set org_unit_id = %L where id = %L', nexus_test.unit('BPH PMK ITERA'), nexus_test.id('m_int1'))),
  'immutable_column', 'MN-11/A-MN4: the unit never changes, not even by hand');
select is(nexus_test.hint_of(format('update nexus.minutes set period_id = %L where id = %L', nexus_test.period(1), nexus_test.id('m_int1'))),
  'immutable_column', '... nor the period');

-- =============================================================================================
-- 7. Files: add, limits, withdraw (F5, MN-17, MN-19, A-MN7, M3)
-- =============================================================================================
select nexus_test.login_as(6);
select is((select file_count from nexus.minute_add_files(nexus_test.id('m_int1'), nexus_test.mv('m_int1'), nexus_test.files(6, 1))), 3, 'F5: a third file');
select is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int1'), nexus_test.mv('m_int1'), nexus_test.files(6, 1))),
  'file_count', 'MN-17: a fourth visible file is refused');
select is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'), '[]')),
  'file_required', 'adding nothing is refused');
select is(nexus_test.hint_of(format('select * from nexus.minute_record(nexus_test.unit(%L), nexus_test.d(0), %L, %L, %L, null, %L)',
                                    'Departemen Internal', 'x', 'y', 'z', nexus_test.files(6, 4))), 'file_count', 'MN-17: four files at recording are refused');
select is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'), nexus_test.file1(nexus_test.fpath(4)))),
  'invalid_file', 'files must come from the caller''s OWN upload folder');
select is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'),
                                    nexus_test.file1(nexus_test.mid(6)::text || '/' || gen_random_uuid()::text || '.docx'))),
  'invalid_file', 'MN-17/N6 a: no DOCX');
select (select storage_path from nexus.minute_files where minute_id = nexus_test.id('m_int1') order by id limit 1) as att_int1 \gset
select is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'), nexus_test.file1(:'att_int1'))),
  'file_already_attached', 'a stored file cannot be attached twice');
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'),
                                    nexus_test.file1(nexus_test.mid(6)::text || '/' || gen_random_uuid()::text || '.pdf'))),
          'file_missing', 'a file that was never uploaded is refused')
  else skip('Storage not installed (load tests/support/storage_stub.sql)', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'),
                                    nexus_test.file1(nexus_test.fpath(6, 'pdf', 5242881)))),
          'file_too_large', 'MN-17: a file over 5 MB is refused')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'),
                                    nexus_test.file1(nexus_test.fpath(6, 'pdf', 1000, 'text/html')))),
          'invalid_file', 'MN-17: the stored type must match the extension')
  else skip('Storage not installed', 1) end;
select (select id from nexus.minute_files where minute_id = nexus_test.id('m_int1') order by id limit 1)::text as f_int1 \gset
select is(nexus_test.hint_of(format('select * from nexus.minute_withdraw_file(%s, %s, %L)', :f_int1, nexus_test.mv('m_int1'), ' ')),
  'reason_required', 'withdrawing needs a reason');
select is((select file_count from nexus.minute_withdraw_file(:f_int1, nexus_test.mv('m_int1'), 'Berkas salah unggah')), 2, 'F5: the file is withdrawn; two visible remain');
select ok((select is_withdrawn and withdraw_reason = 'Berkas salah unggah' and withdrawn_by = nexus_test.mid(6) from nexus.minute_files where id = :f_int1),
  'MN-19: the record stays with who and why');
select is(nexus_test.hint_of(format('select * from nexus.minute_withdraw_file(%s, %s, %L)', :f_int1, nexus_test.mv('m_int1'), 'lagi')), 'state_changed', 'withdrawn once');
select is((select file_count from nexus.minute_add_files(nexus_test.id('m_int1'), nexus_test.mv('m_int1'), nexus_test.files(6, 1))), 3,
  'MN-19: withdrawn files do not count toward the limit of 3');
select ok((select jsonb_array_length(d -> 'files') = 4 and exists (select 1 from jsonb_array_elements(d -> 'history') h where h ->> 'kind' = 'file_withdrawn' and h ->> 'note' = 'Berkas salah unggah')
           from nexus.minute_detail(nexus_test.id('m_int1')) d),
  'A-MN7: the manager sees the withdrawn file and the withdraw history row with its reason');
reset role; select nexus_test.login_as(21);
select ok((select jsonb_array_length(d -> 'files') = 3
                  and not exists (select 1 from jsonb_array_elements(d -> 'history') h where h ->> 'kind' = 'file_withdrawn')
                  and (select h ->> 'file_name' from jsonb_array_elements(d -> 'history') h
                       where (h ->> 'history_id')::bigint = (select min(id) from nexus.minute_history where minute_id = nexus_test.id('m_int1') and kind = 'file_added')) is null
           from nexus.minute_detail(nexus_test.id('m_int1')) d),
  'M3: a reader (Kepala Departemen) sees neither the withdrawn file, its name, nor the withdraw row');
select is((select count(*)::int from nexus.minute_files where minute_id = nexus_test.id('m_int1')), 3, 'M3: ... not even through the table (RLS)');
select is((select count(*)::int from nexus.minute_history where minute_id = nexus_test.id('m_int1') and kind = 'file_withdrawn'), 0, 'M3: ... nor the history row');
select is(nexus_test.hint_of(format('select * from nexus.minute_withdraw_file(%s, %s, %L)', :f_int1, nexus_test.mv('m_int1'), 'x')), 'permission_required',
  'MN-05: the head cannot withdraw');
select is((select file_count from nexus.minute_list() where minute_id = nexus_test.id('m_int1')), 3, 'the list counts visible files only');

-- =============================================================================================
-- 8. Void (F5, 4.2, MN-13, A-MN15)
-- =============================================================================================
reset role; select nexus_test.login_as(6);
select is(nexus_test.hint_of(format('select * from nexus.minute_void(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'), '')),
  'reason_required', 'MN-13: voiding needs a reason');
select is((select status from nexus.minute_void(nexus_test.id('m_int2'), nexus_test.mv('m_int2'), 'Rapat ganda')), 'voided', 'MN-13: voided');
select ok((select status = 'voided' and void_reason = 'Rapat ganda' and voided_by = nexus_test.mid(6) and voided_at is not null
           from nexus.minutes where id = nexus_test.id('m_int2')),
  'MN-13: the row stays with reason and who');
select is((select note from nexus.minute_history where minute_id = nexus_test.id('m_int2') and kind = 'voided'), 'Rapat ganda', 'a history row with the reason');
select is(nexus_test.hint_of(format('select * from nexus.minute_update(%L, %s, nexus_test.d(0), %L, %L, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'), 'x', 'y', 'z')),
  'minute_voided', 'MN-13: a voided minute is read-only (edit)');
select is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'), nexus_test.files(6, 1))),
  'minute_voided', '... (files)');
select is(nexus_test.hint_of(format('select * from nexus.minute_void(%L, %s, %L)', nexus_test.id('m_int2'), nexus_test.mv('m_int2'), 'lagi')),
  'minute_voided', '... (void again)');
select ok((select not (d -> 'actions' ->> 'can_edit')::boolean and not (d -> 'actions' ->> 'can_void')::boolean and (d ->> 'void_reason') = 'Rapat ganda'
           from nexus.minute_detail(nexus_test.id('m_int2')) d), 'the detail shows the void block and no buttons');
select is((select count(*)::int from nexus.minute_list()), 1, 'A-MN6: the default status filter (Aktif) hides the voided minute');
select is((select status from nexus.minute_list(p_status => 'voided')), 'voided', 'MN-13: ... the "Dibatalkan" filter shows it');
select is((select count(*)::int from nexus.minute_list(p_status => 'all')), 2, '... and "Semua" shows both');
reset role; select nexus_test.logout();
select is(nexus_test.hint_of(format('update nexus.minutes set status = %L where id = %L', 'active', nexus_test.id('m_int2'))), 'immutable_column',
  'A-MN15: a voided minute is never restored, not even by hand');

-- =============================================================================================
-- 9. Dashboard counts and header tiles (MN-28, A-MN13)
-- =============================================================================================
select nexus_test.login_as(6);
select ok((select minute_count = 1 and latest_meeting_date = nexus_test.d(-2) and period_label = '2091/2092' from nexus.minute_dashboard_counts()),
  'MN-28: P-SEKDEP counts Aktif minutes of her unit only (the voided one not), with the latest meeting date');
reset role; select nexus_test.login_as(3);
select ok((select minute_count = 8 and latest_meeting_date = nexus_test.d(0) from nexus.minute_dashboard_counts()), 'MN-28: P-KETUM counts every unit (8 Aktif)');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of('select * from nexus.minute_dashboard_counts()'), 'permission_required', 'MN-28: no card for P-PLAIN');

-- =============================================================================================
-- 10. Export and log (F6, MN-25..MN-27, M5, M6)
-- =============================================================================================
select is(nexus_test.hint_of($$select * from nexus.minute_export('csv')$$), 'permission_required', 'MN-25: P-PLAIN cannot export');
reset role; select nexus_test.login_as(21);
select is(nexus_test.hint_of($$select * from nexus.minute_export('csv')$$), 'permission_required', 'MN-05: the Kepala Departemen cannot export');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.minute_export('docx')$$), 'invalid_format', 'xlsx, csv or pdf only');
select is(nexus_test.log_count(), 0, 'MN-27: refused exports wrote no log row');
select ok((select array_agg(minute_id order by row_no) from nexus.minute_export('csv', p_status => 'all'))
          = (select array_agg(minute_id order by row_no) from nexus.minute_list(p_status => 'all', p_page_size => 50)),
  'MN-26: export = the screen rows, same order');
select ok((select bool_and(total_count = 9) and count(*) = 9 from nexus.minute_export('xlsx', p_status => 'all')), 'total_count on every row');
select ok((select status = 'voided' and void_reason = 'Rapat ganda' from nexus.minute_export('pdf', p_status => 'all') where minute_id = nexus_test.id('m_int2')),
  'MN-13/MN-26: voided minutes are exported with status and reason');
select ok((select content = repeat('c', 20000) from nexus.minute_export('pdf', p_minute_id => nexus_test.id('m_long'))), 'spec 8: content exported in full');
reset role; select nexus_test.login_as(6);
select is((select array_agg(distinct unit_name) from nexus.minute_export('csv', p_status => 'all')), array['Departemen Internal'],
  'MN-26: P-SEKDEP exports her unit only');
select is((select count(*)::int from nexus.minute_export('csv', p_unit_id => nexus_test.unit('Departemen Eksternal'))), 0,
  'MN-26: ... another unit''s filter returns nothing');
select is((select title from nexus.minute_export('pdf', p_minute_id => nexus_test.id('m_int1'))), 'Rapat internal satu (revisi)', 'A-MN8: single-minute export from the detail');
select is(nexus_test.hint_of(format('select * from nexus.minute_export(%L, p_minute_id => %L)', 'pdf', nexus_test.id('m_ext'))), 'minute_not_found',
  'M6: a minute outside the export scope answers not found');
reset role; select nexus_test.logout();
select is(nexus_test.log_count(), 7, 'MN-27: one log row per successful export (7)');
select ok((select exporter_member_id = nexus_test.mid(6) and minute_id = nexus_test.id('m_int1') and format = 'pdf' and row_count = 1
                  and period_id = nexus_test.period(2) and filters = '{"single": true}'::jsonb
           from nexus.minute_export_logs order by id desc limit 1),
  'MN-27: single export log row stores the minute id');
select ok((select (filters ->> 'unit_id')::uuid = nexus_test.unit('Departemen Eksternal') and row_count = 0 and filters ->> 'status' = 'active'
           from nexus.minute_export_logs order by id desc offset 1 limit 1),
  'MN-27: list export log row stores the filters and the count (no search text, no names)');
select is((select count(*)::int from nexus.minute_export_logs where filters::text ~* '(persona|rapat|internal satu)'), 0, 'MN-27: no names or text in the log');
select is(nexus_test.hint_of($$insert into nexus.minute_export_logs (exporter_member_id, format, filters, row_count, period_id)
                                values (gen_random_uuid(), 'csv', '{}', 0, gen_random_uuid())$$), 'export_log_direct_insert', 'MN-27: a hand-written log row is refused');
select is(nexus_test.hint_of('update nexus.minute_export_logs set format = ''pdf'''), 'append_only', 'MN-27: the log cannot be updated');
select is(nexus_test.hint_of('delete from nexus.minute_export_logs'), 'append_only', 'MN-15: ... or deleted');
select nexus_test.login_as(4);
select throws_ok($$select * from nexus.minute_export_logs$$, '42501', null, 'MN-27: clients cannot read the log directly');
reset role; select nexus_test.logout();
create function nexus_test.fail_log() returns trigger language plpgsql as $$ begin raise exception 'log unavailable'; end $$;
create trigger zz_fail before insert on nexus.minute_export_logs for each row execute function nexus_test.fail_log();
select nexus_test.login_as(3);
select is(nexus_test.msg_of($$select * from nexus.minute_export('csv')$$), 'log unavailable', 'MN-27: when the log write fails, no data is returned');
reset role; select nexus_test.logout();
drop trigger zz_fail on nexus.minute_export_logs;
select is(nexus_test.log_count(), 7, '... and no log row was written');
-- M5: more than 1000 rows refused in the database, before any log row; exactly 1000 works.
savepoint cap;
insert into nexus.minutes (org_unit_id, period_id, meeting_date, title, topic, content, created_by)
select nexus_test.unit('Departemen Eksternal'), nexus_test.period(2), nexus_test.d(-5), 'Massal ' || g, 'Topik', 'Isi', nexus_test.mid(4)
from generate_series(1, 992) g;   -- with the 8 Aktif minutes: exactly 1000
select nexus_test.login_as(3);
select (select count(*) from nexus.minute_export('csv'))::int as cap_rows \gset
reset role; select nexus_test.logout();
insert into nexus.minutes (org_unit_id, period_id, meeting_date, title, topic, content, created_by)
values (nexus_test.unit('Departemen Eksternal'), nexus_test.period(2), nexus_test.d(-5), 'Massal extra', 'Topik', 'Isi', nexus_test.mid(4));
select nexus_test.log_count() as cap_logs_before \gset
select nexus_test.login_as(3);
select nexus_test.hint_of($$select * from nexus.minute_export('csv')$$) as cap_hint \gset
reset role; select nexus_test.logout();
select nexus_test.log_count() as cap_logs_after \gset
rollback to savepoint cap;
release savepoint cap;
select is(:cap_rows, 1000, 'M5: an export of exactly 1000 rows works');
select is(:'cap_hint'::text, 'too_many_rows', 'M5: 1001 rows are refused in the database');
select is(:cap_logs_after - :cap_logs_before, 0, 'M5: ... and the refused export left no log row');

-- =============================================================================================
-- 11. RLS per persona on the tables (MN-30)
-- =============================================================================================
select count(*) as all_minutes from nexus.minutes \gset
select count(*) as int_minutes from nexus.minutes where org_unit_id = nexus_test.unit('Departemen Internal') \gset
select count(*) as int_visible_files from nexus.minute_files f join nexus.minutes m on m.id = f.minute_id
  where m.org_unit_id = nexus_test.unit('Departemen Internal') and not f.is_withdrawn \gset
select count(*) as all_files from nexus.minute_files \gset
select count(*) as all_visible_files from nexus.minute_files where not is_withdrawn \gset
select nexus_test.login_as(11);
select is((select count(*)::int from nexus.minutes) + (select count(*)::int from nexus.minute_files) + (select count(*)::int from nexus.minute_history), 0,
  'MN-30: P-PLAIN reads zero rows of minutes, files and history');
select throws_ok($$insert into nexus.minutes (org_unit_id, period_id, meeting_date, title, topic, content, created_by)
                   values (gen_random_uuid(), gen_random_uuid(), current_date, 'x', 'y', 'z', gen_random_uuid())$$, '42501', null,
  'MN-30: no direct insert');
reset role; select nexus_test.login_as(6);
select is((select count(*) from nexus.minutes), :int_minutes::bigint, 'MN-30: P-SEKDEP reads only her unit''s rows (own-unit isolation)');
select is((select count(*)::int from nexus.minute_history h where not exists (select 1 from nexus.minutes m where m.id = h.minute_id)), 0, '... history only of those');
select throws_ok($$update nexus.minutes set title = 'x'$$, '42501', null, 'MN-30: P-SEKDEP cannot update directly');
reset role; select nexus_test.login_as(21);
select is((select count(*) from nexus.minutes), :int_minutes::bigint, 'D37: the head reads the unit''s rows');
select is((select count(*) from nexus.minute_files), :int_visible_files::bigint, 'M3: ... but no withdrawn file rows');
reset role; select nexus_test.login_as(3);
select is((select count(*) from nexus.minutes), :all_minutes::bigint, 'P-KETUM reads every minute');
select is((select count(*) from nexus.minute_files), :all_visible_files::bigint, 'M3: ... and every file except withdrawn ones');
reset role; select nexus_test.login_as(4);
select is((select count(*) from nexus.minute_files), :all_files::bigint, 'M3: a BPH secretary also reads withdrawn files');
reset role; select nexus_test.login_as(1);
select is((select count(*)::int from nexus.minutes) + (select count(*)::int from nexus.minute_files) + (select count(*)::int from nexus.minute_history), 0,
  'MN-06/B18: P-ADMIN reads nothing');
select throws_ok($$delete from nexus.minutes$$, '42501', null, 'MN-15: P-ADMIN cannot delete minutes (no privilege)');
reset role; select nexus_test.login_as(15);
select is((select count(*)::int from nexus.minutes) + (select count(*)::int from nexus.minute_files) + (select count(*)::int from nexus.minute_history), 0,
  'MN-30: P-INACTIVE reads nothing');
reset role; select nexus_test.login_as(17);
select is((select count(*)::int from nexus.minutes), 0, 'MN-30: P-UNLINKED reads nothing');
reset role; select nexus_test.logout();
set local role anon;
select throws_ok('select * from nexus.minutes', '42501', null, 'anon has no access to the schema');
reset role;

-- =============================================================================================
-- 12. Never delete, append-only (MN-15, L5)
-- =============================================================================================
select is(nexus_test.hint_of(format('delete from nexus.minutes where id = %L', nexus_test.id('m_bph'))), 'append_only', 'MN-15: the owner cannot delete a minute');
select is(nexus_test.hint_of('delete from nexus.minute_files'), 'append_only', '... nor a file record');
select is(nexus_test.hint_of('update nexus.minute_history set note = ''x'''), 'append_only', 'the history is append-only (update)');
select is(nexus_test.hint_of('delete from nexus.minute_history'), 'append_only', '... (delete)');
select is(nexus_test.hint_of('truncate nexus.minutes cascade'), 'append_only', 'no truncate');
select is(nexus_test.hint_of(format('update nexus.minute_files set storage_path = storage_path where id = %s', :f_int1)), 'immutable_column', 'a withdrawn file stays withdrawn');
select is(nexus_test.hint_of(format('update nexus.minute_files set original_name = %L where minute_id = %L', 'x.pdf', nexus_test.id('m_ext'))), 'immutable_column',
  'a stored file is never renamed or replaced');

-- =============================================================================================
-- 13. Storage (private bucket, MN-17, MN-18, MN-20)
-- =============================================================================================
select (select storage_path from nexus.minute_files where id = :f_int1) as withdrawn_path \gset
select (select storage_path from nexus.minute_files where minute_id = nexus_test.id('m_ext') limit 1) as ext_path \gset
select (select storage_path from nexus.minute_files where minute_id = nexus_test.id('m_int1') and not is_withdrawn order by id limit 1) as int_path \gset
select nexus_test.login_as(6);
select ok(nexus.minute_file_can_upload(nexus_test.mid(6)::text || '/' || gen_random_uuid()::text || '.pdf'), 'M4: a manager uploads into her own folder');
select ok(not nexus.minute_file_can_upload(nexus_test.mid(4)::text || '/' || gen_random_uuid()::text || '.pdf'), '... never into another member''s folder');
select ok(not nexus.minute_file_can_upload(nexus_test.mid(6)::text || '/' || gen_random_uuid()::text || '.docx')
          and not nexus.minute_file_can_upload(nexus_test.mid(6)::text || '/../x.pdf'), 'MN-17: bad names and types refused');
select ok(nexus.minute_file_can_read(:'int_path') and not nexus.minute_file_can_read(:'ext_path'),
  'MN-18/AC-48: P-SEKDEP reads her unit''s file, not another unit''s');
select ok(nexus.minute_file_can_read(:'withdrawn_path'), 'MN-19: the manager reads the withdrawn file');
reset role; select nexus_test.login_as(21);
select ok(nexus.minute_file_can_read(:'int_path') and not nexus.minute_file_can_read(:'withdrawn_path'),
  'D37/M3: the head reads the unit''s visible files, not the withdrawn one');
select ok(not nexus.minute_file_can_upload(nexus_test.mid(21)::text || '/' || gen_random_uuid()::text || '.pdf'), 'M4: readers cannot upload');
reset role; select nexus_test.login_as(11);
select ok(not nexus.minute_file_can_upload(nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.pdf')
          and not nexus.minute_file_can_read(:'int_path'), 'MN-18: P-PLAIN can neither upload nor read');
reset role; select nexus_test.login_as(15);
select ok(not nexus.minute_file_can_read(:'int_path'), 'L1: P-INACTIVE reads nothing');
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.sto_val($$select public::text || ':' || coalesce(file_size_limit::text, '-') || ':' || coalesce(array_to_string(allowed_mime_types, ','), '-')
                               from storage.buckets where id = 'nexus-minute-files'$$),
          'false:5242880:application/pdf,image/jpeg,image/png', 'MN-18/N6 a: the bucket is private, 5 MB, PDF/JPG/PNG')
  else skip('Storage not installed (load tests/support/storage_stub.sql)', 1) end;
select case when nexus_test.has_storage()
  then is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'nexus\_minute%'
           and cmd in ('INSERT', 'SELECT') and coalesce(qual, '') || coalesce(with_check, '') ~ 'nexus-minute-files'), 2,
          'two policies (insert, select) scoped to the bucket; none for update or delete')
  else skip('Storage not installed', 1) end;
select nexus_test.login_as(6);
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name, metadata) values ('nexus-minute-files', %L, '{"size": 1000, "mimetype": "application/pdf"}')$$,
                                nexus_test.mid(6)::text || '/' || gen_random_uuid()::text || '.pdf')), 'ok', 'Storage: a manager uploads into her folder')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'int_path')) = 1 and nexus_test.sto_count(format('name = %L', :'ext_path')) = 0,
          'Storage: P-SEKDEP sees her unit''s object, not another unit''s (MN-18)')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto($$delete from storage.objects where bucket_id = 'nexus-minute-files'$$), 'ok', 'Storage: a client delete matches nothing (no policy)')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.login_as(11);
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-minute-files', %L)$$,
                                nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.pdf')), '42501', 'Storage: P-PLAIN cannot upload (M4)')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count($$bucket_id = 'nexus-minute-files'$$), 0, 'Storage: P-PLAIN sees no object')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'int_path')) = 1, 'Storage: nothing was deleted')
  else skip('Storage not installed', 1) end;
-- MN-20: 10 unattached uploads per member per 24 h (P-SEKUM1's folder is empty)
select count(nexus_test.fpath(19)) as flood from generate_series(1, 10) \gset
select nexus_test.login_as(19);
select case when nexus_test.has_storage()
  then ok(not nexus.minute_file_can_upload(nexus_test.mid(19)::text || '/' || gen_random_uuid()::text || '.pdf'), 'MN-20: no 11th unattached upload in 24 hours')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
select nexus_test.sto(format($$update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'nexus-minute-files' and name like %L$$,
                             nexus_test.mid(19)::text || '/%')) as sto_result \gset
select nexus_test.login_as(19);
select case when nexus_test.has_storage()
  then ok(nexus.minute_file_can_upload(nexus_test.mid(19)::text || '/' || gen_random_uuid()::text || '.pdf'), 'MN-20: uploads older than 24 hours no longer count')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._mn_ensure_minute_bucket()'), 'no_error', 'migration guard: re-running with an identical bucket is a no-op')
  else is(nexus._mn_ensure_minute_bucket(), 'skipped', 'without Storage the guard skips') end;
select nexus_test.sto($$update storage.buckets set public = true where id = 'nexus-minute-files'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._mn_ensure_minute_bucket()'), 'bucket_conflict', 'an existing PUBLIC bucket stops the migration')
  else skip('Storage not installed', 1) end;
select nexus_test.sto($$update storage.buckets set public = false where id = 'nexus-minute-files'$$) as sto_result \gset

-- =============================================================================================
-- 14. Period switch (F7, MN-08, MN-12, MN-23), deactivated author (MN-24), no active period (MN-10)
-- =============================================================================================
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(3);
insert into public.assignments (member_id, org_unit_id, position_id, period_id) values
  (nexus_test.mid(4),  nexus_test.unit('BPH PMK ITERA'),        nexus_test.pos('bph', 'Sekretaris Jenderal'),          nexus_test.period(3)),
  (nexus_test.mid(11), nexus_test.unit('Departemen Internal'),  nexus_test.pos('department', 'Sekretaris Departemen'), nexus_test.period(3)),
  (nexus_test.mid(6),  nexus_test.unit('Departemen Eksternal'), nexus_test.pos('department', 'Sekretaris Departemen'), nexus_test.period(3));
select nexus_test.login_as(11);
select is((select count(*)::int from nexus.minute_list(p_period => 'all', p_status => 'all')), 2,
  'MN-23: the NEW Sekretaris Departemen of Internal reads that unit''s earlier minutes (scope is the unit)');
select is((select count(*)::int from nexus.minute_list()), 0, 'F7: the default filter shows the new period only (empty)');
select is(nexus_test.hint_of(format('select * from nexus.minute_update(%L, %s, nexus_test.d(0), %L, %L, %L)', nexus_test.id('m_int1'), nexus_test.mv('m_int1'), 'x', 'y', 'z')),
  'closed_period', 'MN-12/L7: an old-period minute cannot be edited');
select is(nexus_test.hint_of(format('select * from nexus.minute_void(%L, %s, %L)', nexus_test.id('m_int1'), nexus_test.mv('m_int1'), 'x')),
  'closed_period', 'MN-12: ... nor voided');
select is(nexus_test.hint_of(format('select * from nexus.minute_add_files(%L, %s, %L)', nexus_test.id('m_int1'), nexus_test.mv('m_int1'), nexus_test.files(11, 1))),
  'closed_period', 'MN-12: ... nor given files');
select is(nexus_test.hint_of(format('select * from nexus.minute_withdraw_file((select min(id) from nexus.minute_files where minute_id = %L and not is_withdrawn), %s, %L)',
                                    nexus_test.id('m_int1'), nexus_test.mv('m_int1'), 'x')),
  'closed_period', 'MN-12: ... nor lose a file');
select ok((select not (d ->> 'is_active_period')::boolean and not (d -> 'actions' ->> 'can_edit')::boolean and not (d -> 'actions' ->> 'can_add_files')::boolean
           from nexus.minute_detail(nexus_test.id('m_int1')) d), 'the detail says "Notulensi periode lama hanya bisa dibaca" (no buttons)');
select nexus_test.rec('m_new', 'Departemen Internal', 'Rapat periode baru');
select is((select period_id from nexus.minutes where id = nexus_test.id('m_new')), nexus_test.period(3), 'R2: a new minute belongs to the new period');
reset role; select nexus_test.login_as(4);
select is(nexus_test.hint_of(format('select * from nexus.minute_void(%L, %s, %L)', nexus_test.id('m_bph'), nexus_test.mv('m_bph'), 'x')),
  'closed_period', 'MN-12: no persona, not even a BPH secretary, changes an old-period minute');
select ok((select minute_count = 1 and period_label = '2092/2093' from nexus.minute_dashboard_counts()), 'the card counts the new period');
reset role; select nexus_test.login_as(6);
select ok((select bool_and(unit_name = 'Departemen Eksternal') and count(*) >= 1 from nexus.minute_list(p_period => 'all')),
  'MN-08: the secretary moved to Eksternal now reads Eksternal ...');
select is(nexus_test.hint_of(format('select nexus.minute_detail(%L)', nexus_test.id('m_int1'))), 'minute_not_found', 'MN-08: ... and no longer Internal');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of('select * from nexus.minute_list()'), 'permission_required', 'AC-40: last period''s BPH without a new assignment reads nothing');
reset role; select nexus_test.login_as(14);
select is(nexus_test.hint_of('select * from nexus.minute_list()'), 'permission_required', 'MN-23: P-OLD reads nothing');
-- MN-24: the author is deactivated; the minute and the name stay
reset role; select nexus_test.logout();
update public.members set is_active = false where id = nexus_test.mid(6);
select nexus_test.login_as(11);
select ok((select (d ->> 'created_by_name') = 'Test Persona 6' and (d ->> 'status') = 'active' from nexus.minute_detail(nexus_test.id('m_int1')) d),
  'MN-24/AC-45: the author (P-SEKDEP) is deactivated; the minute and the name stay');
reset role; select nexus_test.logout();
update public.members set is_active = true where id = nexus_test.mid(6);
-- MN-10: no active period
update public.periods set is_active = false where is_active;
select nexus_test.login_as(4);
select is(nexus_test.hint_of($$select * from nexus.minute_record(nexus_test.unit('BPH PMK ITERA'), nexus_test.d(0), 'x', 'y', 'z')$$), 'permission_required',
  'MN-10/R11: without an active period nobody records (officers'' rules match nothing)');
select is(nexus_test.hint_of('select * from nexus.minute_list()'), 'permission_required', 'MN-10/E4: ... and officers read nothing');
select ok(not nexus.minute_file_can_upload(nexus_test.mid(4)::text || '/' || gen_random_uuid()::text || '.pdf'), 'no upload without an active period');
reset role; select nexus_test.logout();
update public.periods set is_active = true where id = nexus_test.period(3);

select * from finish();
rollback;
