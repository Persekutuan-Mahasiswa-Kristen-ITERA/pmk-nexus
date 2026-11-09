-- pgTAP tests for the Letters (Surat Menyurat) module:
--   20261110100000_nexus_letters.sql          (tables, numbering, RLS, request state machine, reads, export)
--   20261110100100_nexus_letters_storage.sql  (private bucket nexus-letter-files + Storage policies)
-- Spec: docs/modules/letters.md (approved 2026-11-09, incl. the "Ambil nomor" amendment G1): sections
-- 2-5, 8, 11 (LT-01..LT-52); design docs/design/letters.md; D-024, D-025.
--
-- LOCAL / THROWAWAY DATABASE ONLY. Same guards as the other files: it refuses to run without
-- nexus.allow_destructive_tests = 'yes', stops if ANY account or member has a non-test email, and stops
-- on the NEXUS dev stack (@nexus.test accounts). Everything (personas in PI-CORE tables, letters,
-- requests, counters, logs, Storage stub objects, helper schema nexus_test) is rolled back. The letter
-- counters are table rows (not sequences), so exact numbers are checked; the file assumes a FRESH
-- install (no letter, no request, no counter row).
--   PGOPTIONS='-c nexus.allow_destructive_tests=yes' psql "<throwaway url>" -X -At -f supabase/tests/nexus_letters.test.sql
-- Storage policy tests run only when a storage schema exists (load tests/support/storage_stub.sql
-- before the migrations in a throwaway container); otherwise they are reported as skipped.
--
-- Personas (auth uid 10000000-...-NN, member id 20000000-...-NN), as in the other files plus:
--   19 P-SEKUM1 = Sekretaris Umum 1 (BPH secretary, D18/D19): the "second secretary"
--   20 P-PLAIN2 = a second plain member (no assignment)
--   13 P-OPS-BPH = Sekretaris Umum 2 + Staff Logistik (R10: union of rights, still no own processing)
--   14 P-OLD = Sekretaris Jenderal of the PREVIOUS period only

\set ON_ERROR_STOP on
begin;

-- W1 guard (see tests/README.md).
do $$
begin
  if coalesce(current_setting('nexus.allow_destructive_tests', true), '') <> 'yes' then
    raise exception 'nexus_letters.test.sql writes test rows into PI-CORE tables: local throwaway database only. Set nexus.allow_destructive_tests=yes (see supabase/tests/README.md) to run it.';
  end if;
end
$$;

-- Data guard (security review M1).
do $$
begin
  if exists (select 1 from auth.users u where u.email is null or u.email !~* '@(example\.test|nexus\.test)$')
     or exists (select 1 from public.members m where m.email is not null and m.email !~* '@(example\.test|nexus\.test)$') then
    raise exception 'nexus_letters.test.sql: found a non-test email address, so this is NOT a throwaway local database. Nothing was written.';
  end if;
end
$$;

-- Dev-stack guard (review L5).
do $$
begin
  if exists (select 1 from auth.users u where u.email ~* '@nexus\.test$')
     or exists (select 1 from public.members m where m.email ~* '@nexus\.test$') then
    raise exception 'nexus_letters.test.sql: found the NEXUS dev stack seed accounts (@nexus.test). Run it only in a fresh throwaway container (see supabase/tests/README.md). Nothing was written.';
  end if;
end
$$;

-- Fresh-install guard: exact numbers below assume no letter, request or counter exists yet.
do $$
begin
  if exists (select 1 from nexus.letters) or exists (select 1 from nexus.letter_requests)
     or exists (select 1 from nexus.letter_number_counters) then
    raise exception 'nexus_letters.test.sql: letters, requests or counters already exist; use a fresh throwaway container. Nothing was written.';
  end if;
end
$$;

create extension if not exists pgtap with schema extensions;
create extension if not exists pgrowlocks with schema extensions;
-- no_plan: expected total is documented in tests/README.md.
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
-- Error DETAIL of a statement (rolled back).
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
-- Error MESSAGE of a statement (to prove a refusal names nobody).
create function nexus_test.msg_of(p_sql text) returns text language plpgsql
as $$
begin
  execute p_sql;
  return 'no_error';
exception when others then
  return sqlerrm;
end
$$;

-- Named ids, so dollar-quoted statements can refer to fixtures.
create table nexus_test.ids (name text primary key, id uuid not null);
create function nexus_test.put(p_name text, p_id uuid) returns uuid language sql security definer set search_path = ''
as $$ insert into nexus_test.ids values (p_name, p_id) on conflict (name) do update set id = excluded.id returning id $$;
create function nexus_test.id(p_name text) returns uuid language sql stable security definer set search_path = ''
as $$ select i.id from nexus_test.ids i where i.name = p_name $$;
-- State as the owner sees it (bypasses RLS on purpose; test oracle only).
create function nexus_test.rv(p_name text) returns int language sql stable security definer set search_path = ''
as $$ select r.version from nexus.letter_requests r where r.id = nexus_test.id(p_name) $$;
create function nexus_test.rs(p_name text) returns text language sql stable security definer set search_path = ''
as $$ select r.status from nexus.letter_requests r where r.id = nexus_test.id(p_name) $$;
create function nexus_test.lv(p_name text) returns int language sql stable security definer set search_path = ''
as $$ select l.version from nexus.letters l where l.id = nexus_test.id(p_name) $$;
create function nexus_test.ls(p_name text) returns text language sql stable security definer set search_path = ''
as $$ select l.status from nexus.letters l where l.id = nexus_test.id(p_name) $$;
create function nexus_test.num(p_name text) returns text language sql stable security definer set search_path = ''
as $$ select l.number_text from nexus.letters l where l.id = nexus_test.id(p_name) $$;
-- Version of the register letter linked to a request (0 when no number was taken yet).
create function nexus_test.rlv(p_name text) returns int language sql stable security definer set search_path = ''
as $$ select coalesce((select l.version from nexus.letters l join nexus.letter_requests r on r.letter_id = l.id
                       where r.id = nexus_test.id(p_name)), 0) $$;
create function nexus_test.req_letter(p_name text) returns uuid language sql stable security definer set search_path = ''
as $$ select r.letter_id from nexus.letter_requests r where r.id = nexus_test.id(p_name) $$;
create function nexus_test.counter(p_type text) returns int language sql stable security definer set search_path = ''
as $$ select c.last_value from nexus.letter_number_counters c where c.letter_type = p_type and c.number_year = nexus._lt_year_at(now()) $$;
create function nexus_test.y() returns text language sql stable
as $$ select extract(year from (now() at time zone 'Asia/Jakarta'))::int::text $$;
create function nexus_test.d(n int) returns date language sql stable
as $$ select (now() at time zone 'Asia/Jakarta')::date + n $$;
create function nexus_test.has_storage() returns boolean language sql stable
as $$ select to_regclass('storage.objects') is not null $$;
-- A fresh upload path in member n's folder; with Storage present, also the "uploaded" object.
create function nexus_test.fpath(n int, p_ext text default 'pdf', p_size bigint default 120000, p_mime text default null)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v text := nexus_test.mid(n)::text || '/' || gen_random_uuid()::text || '.' || p_ext;
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)'
      using 'nexus-letter-files', v,
            jsonb_build_object('size', p_size, 'mimetype',
                               coalesce(p_mime, case p_ext when 'pdf' then 'application/pdf' when 'png' then 'image/png' else 'image/jpeg' end));
  end if;
  return v;
end
$$;
-- k uploaded PDF files of member n as the p_files argument.
create function nexus_test.files(n int, k int) returns jsonb language sql volatile
as $$ select coalesce(jsonb_agg(jsonb_build_object('path', nexus_test.fpath(n), 'name', 'berkas-' || g || '.pdf')), '[]'::jsonb)
      from generate_series(1, k) g $$;
create function nexus_test.file1(p_path text, p_name text default 'surat.pdf') returns jsonb language sql immutable
as $$ select jsonb_build_array(jsonb_build_object('path', p_path, 'name', p_name)) $$;
-- The 5 letter keys the caller holds (sorted).
create function nexus_test.keys() returns text[] language sql stable
as $$
  select coalesce(array_agg(k order by k), '{}')
  from unnest(array['letters.view', 'letters.manage', 'letters.export', 'letter_requests.view_all',
                    'letter_requests.process']) k
  where nexus.has_permission(k)
$$;
create function nexus_test.log_count() returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from nexus.letter_export_logs $$;
-- Storage probes (dynamic SQL, so this file also parses where no storage schema exists).
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
-- A request by the current caller (simple valid values).
create function nexus_test.req(p_name text, p_subject text default 'Surat undangan uji') returns uuid language sql volatile
as $$ select nexus_test.put(p_name, (select request_id from nexus.letter_request_create(p_subject, 'Rektorat Uji', 'Keperluan uji')) ) $$;
-- Creates n requests as the current caller (open-request cap test).
create function nexus_test.create_n(p_prefix text, n int) returns int language plpgsql
as $$
begin
  for i in 1 .. n loop
    perform nexus_test.req(p_prefix || i, 'Uji batas ' || i);
  end loop;
  return n;
end
$$;
-- Creates and cancels n requests as the current caller (daily-cap test); returns how many succeeded.
create function nexus_test.create_cancel(n int) returns int language plpgsql
as $$
declare
  v_id uuid;
  v_ok int := 0;
begin
  for i in 1 .. n loop
    select request_id into v_id from nexus.letter_request_create('Uji batas harian', 'Tujuan', 'Keperluan');
    perform nexus.letter_request_cancel(v_id, (select r.version from nexus.letter_requests r where r.id = v_id));
    v_ok := v_ok + 1;
  end loop;
  return v_ok;
end
$$;
-- Output column names of a function, in order.
create function nexus_test.out_cols(p_fn regprocedure) returns text[] language sql stable
as $$
  select coalesce(array_agg(a.n order by a.i), '{}')
  from pg_proc f, unnest(f.proargnames, f.proargmodes::text[]) with ordinality as a(n, m, i)
  where f.oid = p_fn and a.m = 't'
$$;
grant execute on all functions in schema nexus_test to authenticated;
grant usage on schema nexus_test to anon;
grant execute on function nexus_test.has_storage(), nexus_test.sto_count(text), nexus_test.sto(text) to anon;

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
  (19, 'BPH PMK ITERA',               'bph',        'Sekretaris Umum 1',     2)
) as v(n, unit_name, unit_type, position_name, p);
update public.members set is_active = false where id = nexus_test.mid(15);

select is((select count(*)::int from public.assignments where member_id::text like '20000000-%'), 17,
  'fixtures: 17 persona assignments created (PI-CORE names match the test)');

-- =============================================================================================
-- 1. Structure, privileges, catalog (LT-34, LT-35, LT-43, LT-48)
-- =============================================================================================
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'LT-43: RLS is enabled on every nexus table');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind = 'r'
             and c.relname in ('letter_numbering_settings', 'letter_number_counters', 'letter_numbering_changes',
                               'letter_requests', 'letters', 'letter_files', 'letter_history', 'letter_request_history',
                               'letter_export_logs')), 9,
  'the 9 letter tables exist');
select is((select count(*)::int from pg_policies where schemaname = 'nexus'
           and tablename like 'letter%' and cmd <> 'SELECT'), 0,
  'LT-34: the letter tables have SELECT policies only (no insert, update or delete policy)');
select is((select count(*)::int from pg_policies where schemaname = 'nexus' and tablename = 'letter_export_logs'), 0,
  'LT-39: the export log has no policy at all');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p')
             and has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')), 0,
  'LT-34: authenticated cannot write any nexus table directly');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p')
             and has_table_privilege('service_role', c.oid, 'insert, update, delete, truncate')), 0,
  'W2: service_role cannot write any nexus table');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p', 'v', 'S')
             and has_table_privilege('anon', c.oid, 'select')), 0, 'anon reads nothing in nexus');
select ok(not has_table_privilege('authenticated', 'nexus.letter_export_logs', 'select'),
  'LT-39: the export log has no client grant (read through the database only)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like '\_%'
             and has_function_privilege('authenticated', p.oid, 'execute')), 0,
  'internal nexus._* helpers (incl. _lt_*) are not executable by clients');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'letter\_%'), 27,
  'module API has 27 letter_* functions (26 + letter_my_request_caps, 2026-11-10)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname in ('letter_request_issue', 'letter_request_queue')), 2,
  'one version each of letter_request_issue and letter_request_queue (old shapes dropped)');
select is(nexus_test.out_cols('nexus.letter_my_request_caps()'),
          array['open_count', 'open_limit', 'today_count', 'daily_limit', 'has_active_period', 'can_submit'],
  'design 3.4: the caps pre-check returns counts and limits only');
select ok((select 'p_letter_version' = any (p.proargnames) from pg_proc p
           where p.oid = 'nexus.letter_request_issue(uuid,integer,integer,text,text,date,jsonb,text)'::regprocedure),
  'Terbitkan takes the register letter''s version (no silent overwrite of a register edit)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'letter\_%'
             and (not has_function_privilege('authenticated', p.oid, 'execute')
                  or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute')
                  or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                  or not p.prosecdef)), 0,
  'module API: SECURITY DEFINER, EXECUTE for authenticated only (not anon, service_role, PUBLIC)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)), 0,
  'D-010: every SECURITY DEFINER function pins search_path to empty');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.prosrc ~* '(\m(email|phone|nim|nip|audit_log|org_settings|grants_admin)\M|private\.)'), 0,
  'LT-35/L4: no nexus function body mentions email, phone, nim, nip, audit_log, org_settings, grants_admin, private.*');
select is((select count(*)::int from information_schema.columns c
           where c.table_schema = 'nexus' and c.table_name like 'letter%' and c.column_name ~* '(email|phone|nim|nip|whatsapp|user_id)'), 0,
  'LT-35: no letter table has a contact, identity-number or auth column');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'letter\_%'
             and p.proargnames && array['p_number', 'p_number_text', 'p_number_seq', 'p_legacy_number']),
          array['letter_register'],
  'LT-17: the only function that accepts a typed number is letter_register ("Nomor lama", L7 b)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'letter\_%'
             and p.proargnames && array['p_requester_member_id', 'p_requester', 'p_member_id', 'p_period_id', 'p_created_by']), 0,
  'LT-07: no function lets a client give a requester, member, period or creator id');
select is(nexus_test.out_cols('nexus.letter_dashboard_counts()'),
          array['period_id', 'period_label', 'incoming_count', 'outgoing_count', 'incoming_voided_count',
                'outgoing_voided_count', 'waiting_request_count'],
  'LT-40/L11: the Dashboard function returns counts only (no title, counterpart or number)');
select is(nexus_test.out_cols('nexus.letter_export(text,text,text,text,integer,text,boolean)'),
          array['row_no', 'number_text', 'letter_type', 'is_legacy_number', 'letter_date', 'received_date', 'counterpart',
                'counterpart_number', 'subject', 'notes', 'status', 'void_reason', 'from_request', 'period_label',
                'created_by_name', 'created_at', 'file_count', 'total_count'],
  'LT-36/LT-38: export columns are the register columns plus total_count (no file path, no link)');
select ok((select bool_and(p.provolatile = 'v') from pg_proc p
           where p.oid in ('nexus.letter_export(text,text,text,text,integer,text,boolean)'::regprocedure,
                           'nexus.letter_register(text,text,text,date,date,text,text,jsonb,text)'::regprocedure,
                           'nexus.letter_request_take_number(uuid,integer)'::regprocedure)),
  'exports and writes are VOLATILE (never run in a read-only GET)');
select ok((select bool_and(p.provolatile = 's') from pg_proc p
           where p.oid in ('nexus.letter_list(text,text,text,integer,text,boolean,integer,integer)'::regprocedure,
                           'nexus.letter_detail(uuid)'::regprocedure, 'nexus.letter_request_detail(uuid)'::regprocedure,
                           'nexus.letter_my_requests(text,integer,integer)'::regprocedure)),
  'reads are STABLE');
select is((select count(*)::int from nexus.permissions), 22, 'no new permission key (22 keys)');
select is((select count(*)::int from nexus.access_rules where default_code in ('D06', 'D07', 'D08', 'D15', 'D16', 'D18', 'D19', 'D21', 'D22') and is_enabled), 9,
  'the letter default rules D06-D08, D15/D16, D18/D19, D21/D22 are seeded and enabled');
select is((select prefix || '|' || incoming_code || '|' || outgoing_code || '|' || seq_digits || '|' || number_separator || '|' || include_year
           from nexus.letter_numbering_settings),
          'PMK/NEX|SM|SK|3|/|true', 'D-024: the numbering settings row holds the provisional format (a setting, not code)');
select is((select count(*)::int from nexus.letter_numbering_settings), 1, 'exactly one numbering settings row');
select is((select pg_get_constraintdef(c.oid) from pg_constraint c
           where c.conrelid = 'nexus.letter_numbering_settings'::regclass and c.conname = 'letter_numbering_year_required'),
          'CHECK (include_year)', 'owner 2026-11-09: the year is mandatory in the number (named CHECK on the settings row)');
select throws_ok($$update nexus.letter_numbering_settings set include_year = false$$, '23514', null,
  'owner 2026-11-09: switching the year off is impossible even by hand');
select throws_ok($$insert into nexus.letter_numbering_settings (id, prefix, incoming_code, outgoing_code, seq_digits, number_separator, include_year)
                   values (false, 'X', 'A', 'B', 3, '/', true)$$, '23514', null,
  'a second settings row is impossible (check id)');

-- =============================================================================================
-- 2. Who holds what (spec section 2 table, LT-01..LT-06)
-- =============================================================================================
select nexus_test.login_as(4);
select is(nexus_test.keys(), array['letter_requests.process', 'letter_requests.view_all', 'letters.export', 'letters.manage', 'letters.view'],
  'LT-01: P-SEKJEN holds all five letter keys');
reset role; select nexus_test.login_as(19);
select is(nexus_test.keys(), array['letter_requests.process', 'letter_requests.view_all', 'letters.export', 'letters.manage', 'letters.view'],
  'LT-01: P-SEKUM1 (second secretary) holds all five');
reset role; select nexus_test.login_as(13);
select is(nexus_test.keys(), array['letter_requests.process', 'letter_requests.view_all', 'letters.export', 'letters.manage', 'letters.view'],
  'R10: P-OPS-BPH (Sekum 2 + Staff Logistik) holds all five (union of rights)');
reset role; select nexus_test.login_as(3);
select is(nexus_test.keys(), array['letter_requests.view_all', 'letters.export', 'letters.view'],
  'LT-02: P-KETUM reads the register, all requests and exports; no manage, no process');
reset role; select nexus_test.login_as(5);
select is(nexus_test.keys(), array['letter_requests.view_all', 'letters.export', 'letters.view'], 'LT-02: P-BEND the same');
reset role; select nexus_test.login_as(6);
select is(nexus_test.keys(), '{}'::text[], 'LT-03/A-LT14: P-SEKDEP (department secretary) holds no letter key');
reset role; select nexus_test.login_as(18);
select is(nexus_test.keys(), '{}'::text[], 'LT-03: P-SEKDEP2 (department + bureau secretary) holds none');
reset role; select nexus_test.login_as(11);
select is(nexus_test.keys(), '{}'::text[], 'LT-03: P-PLAIN holds none');
reset role; select nexus_test.login_as(10);
select is(nexus_test.keys(), '{}'::text[], 'LT-03: P-STAFF-PUB holds none');
reset role; select nexus_test.login_as(16);
select is(nexus_test.keys(), '{}'::text[], 'LT-03: P-LECT holds none');
reset role; select nexus_test.login_as(1);
select is(nexus_test.keys(), '{}'::text[], 'LT-03/B18: P-ADMIN (no position) holds none');
reset role; select nexus_test.login_as(14);
select is(nexus_test.keys(), '{}'::text[], 'LT-04: P-OLD (Sekjen of the previous period) holds none');
reset role; select nexus_test.login_as(15);
select is(nexus_test.keys(), '{}'::text[], 'LT-04: P-INACTIVE holds none');
reset role; select nexus_test.login_as(17);
select is(nexus_test.keys(), '{}'::text[], 'LT-04: P-UNLINKED holds none');

-- LT-05: disabling D15 removes letters.manage from the Sekjen on the next request, no logout.
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where default_code = 'D15'), 'test LT-05'), 'admin disables D15');
reset role; select nexus_test.login_as(4);
select ok(not nexus.has_permission('letters.manage') and nexus.has_permission('letters.view'),
  'LT-05: P-SEKJEN loses letters.manage at once (keeps view through D06)');
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'x', 'y', p_received_date => nexus_test.d(0))$$),
  'permission_required', 'LT-05: ... and a direct register call is refused');
reset role; select nexus_test.login_as(1);
select ok(nexus.enable_access_rule((select id from nexus.access_rules where default_code = 'D15'), 'test LT-05 restore'), 'admin re-enables D15');
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'letter_requests.process', p_note => 'x')$$), 'baseline_not_allowed',
  'LT-06: letter_requests.process can never go to every active member');
select is(nexus_test.hint_of($$select nexus.add_access_rule('role', 'letters.manage', p_role_key => 'bph')$$), 'note_required',
  'LT-06: granting letters.manage needs a written reason');
reset role; select nexus_test.login_as(4);
select ok(nexus.has_permission('letters.manage'), 'LT-05: D15 back, P-SEKJEN manages again');

-- =============================================================================================
-- 3. Numbering settings read (A-LT12, design 13, G6 "never set")
-- =============================================================================================
select ok((select (s -> 'types' -> 0 ->> 'next_number') = 'PMK/NEX/SM/' || nexus_test.y() || '/001'
                  and (s -> 'types' -> 1 ->> 'next_number') = 'PMK/NEX/SK/' || nexus_test.y() || '/001'
                  and not (s -> 'types' -> 0 ->> 'start_set')::boolean and not (s -> 'types' -> 1 ->> 'start_set')::boolean
                  and (s -> 'types' -> 0 -> 'last_used') = 'null'::jsonb
                  and not (s ->> 'can_edit')::boolean and (s ->> 'year') = nexus_test.y()
           from nexus.letter_numbering_settings() s),
  'LT-17/G6: a secretary reads the settings: next numbers 001 from the setting, "never set", read-only');
reset role; select nexus_test.login_as(1);
select ok((nexus.letter_numbering_settings() ->> 'can_edit')::boolean, 'LT-41: the System Admin reads the settings and may edit');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of('select nexus.letter_numbering_settings()'), 'permission_required',
  'LT-41: P-KETUM (view only) cannot read the numbering settings');
select is((select count(*)::int from nexus.letter_numbering_settings) + (select count(*)::int from nexus.letter_numbering_changes)
          + (select count(*)::int from nexus.letter_number_counters), 0, 'LT-43: ... nor the settings tables directly');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of('select nexus.letter_numbering_settings()'), 'permission_required', 'LT-41: P-PLAIN cannot read them');
select is(nexus_test.hint_of('select * from nexus.letter_numbering_history()'), 'permission_required', 'LT-41: ... nor their history');
reset role; select nexus_test.login_as(4);
select is((select count(*)::int from nexus.letter_numbering_settings), 1, 'A-LT12: a secretary reads the settings row through RLS');

-- =============================================================================================
-- 4. Register incoming and outgoing letters directly (F2, F3, LT-17, LT-19, LT-21, L4)
-- =============================================================================================
select nexus_test.put('in1', letter_id) from nexus.letter_register('incoming', 'Undangan rapat', 'Pengirim Uji A',
  p_received_date => nexus_test.d(0), p_letter_date => nexus_test.d(-2), p_counterpart_number => '12/ABC/2091');
select is(nexus_test.num('in1'), 'PMK/NEX/SM/' || nexus_test.y() || '/001', 'LT-17: the first incoming letter is PMK/NEX/SM/{year}/001');
select ok((select status = 'active' and period_id = nexus_test.period(2) and created_by = nexus_test.mid(4) and not is_legacy_number
                  and number_code = 'SM' and number_year::text = nexus_test.y() and number_seq = 1 and version = 1
           from nexus.letters where id = nexus_test.id('in1')),
  'F2.3: saved Aktif, period = active period, creator from the session, number parts stored');
select is((select kind from nexus.letter_history where letter_id = nexus_test.id('in1')), 'registered', 'F2.3: one history row "Dicatat"');

-- Refusals (LT-21, A-LT18, A-LT19). None of them uses a number (R2).
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'Perihal', 'Pengirim')$$), 'date_required',
  'LT-21: incoming needs a received date');
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'Perihal', 'Pengirim', p_received_date => nexus_test.d(1))$$), 'date_in_future',
  'LT-21/A-LT19: the received date cannot be in the future (Jakarta)');
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'Perihal', 'Pengirim', p_received_date => nexus_test.d(0), p_letter_date => nexus_test.d(1))$$),
  'date_in_future', 'A-LT19: ... nor the letter date');
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'Perihal', 'Pengirim', p_received_date => date '1999-12-31')$$), 'invalid_dates',
  'dates before 2000 are refused');
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', '  ', 'Pengirim', p_received_date => nexus_test.d(0))$$), 'text_required',
  'LT-21: Perihal is required');
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'Perihal', '', p_received_date => nexus_test.d(0))$$), 'text_required',
  'LT-21: the sender is required');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_received_date => nexus_test.d(0))', 'incoming', repeat('p', 201), 'x')),
  'text_too_long', 'LT-44/A-LT18: Perihal max 200');
select is(nexus_test.detail_of(format('select * from nexus.letter_register(%L, %L, %L, p_received_date => nexus_test.d(0))', 'incoming', 'x', repeat('c', 151))),
  'counterpart', 'LT-44: counterpart max 150 (detail names the field)');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_received_date => nexus_test.d(0), p_counterpart_number => %L)', 'incoming', 'x', 'y', repeat('n', 61))),
  'text_too_long', 'LT-44: the sender''s own number max 60');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_received_date => nexus_test.d(0), p_notes => %L)', 'incoming', 'x', 'y', repeat('n', 501))),
  'text_too_long', 'LT-44: notes max 500');
select is(nexus_test.hint_of($$select * from nexus.letter_register('outgoing', 'Perihal', 'Tujuan')$$), 'date_required',
  'LT-21: outgoing needs a letter date');
select is(nexus_test.hint_of($$select * from nexus.letter_register('outgoing', 'Perihal', 'Tujuan', p_letter_date => nexus_test.d(0), p_received_date => nexus_test.d(0))$$),
  'invalid_input', 'an outgoing letter has no received date');
select is(nexus_test.hint_of($$select * from nexus.letter_register('outgoing', 'Perihal', 'Tujuan', p_letter_date => nexus_test.d(0), p_counterpart_number => 'x')$$),
  'invalid_input', 'an outgoing letter has no sender number');
select is(nexus_test.hint_of($$select * from nexus.letter_register('memo', 'Perihal', 'Tujuan', p_letter_date => nexus_test.d(0))$$), 'invalid_type',
  'only incoming and outgoing exist');
select is(nexus_test.counter('incoming'), 1, 'R2/LT-19: the refused saves consumed no number');

select nexus_test.put('in2', letter_id) from nexus.letter_register('incoming', 'Permohonan data', 'Pengirim Uji B', p_received_date => nexus_test.d(-1));
select nexus_test.put('in3', letter_id) from nexus.letter_register('incoming', 'Pemberitahuan', 'Pengirim Uji C', p_received_date => nexus_test.d(0));
select is(array[nexus_test.num('in2'), nexus_test.num('in3')],
          array['PMK/NEX/SM/' || nexus_test.y() || '/002', 'PMK/NEX/SM/' || nexus_test.y() || '/003'],
  'LT-19: numbers continue without gaps (002, 003)');

-- R3 lock proof: an assignment holds the settings row FOR SHARE until the transaction ends (a format
-- change waits); the counter row is locked FOR UPDATE inside _lt_assign_number (two-session check in
-- tests/README.md).
reset role; select nexus_test.logout();
select ok(exists (select 1 from extensions.pgrowlocks('nexus.letter_numbering_settings') l
                  where 'For Share' = any (l.modes) and pg_backend_pid() = any (l.pids)),
  'R3: a number assignment holds the numbering settings FOR SHARE in this transaction');
select nexus_test.login_as(4);

-- Outgoing directly (F3, L4): number at registration, files optional.
select nexus_test.put('out1', letter_id) from nexus.letter_register('outgoing', 'Undangan ibadah', 'Gereja Uji',
  p_letter_date => nexus_test.d(0), p_files => nexus_test.files(4, 2));
select is(nexus_test.num('out1'), 'PMK/NEX/SK/' || nexus_test.y() || '/001', 'LT-17: the first outgoing letter is PMK/NEX/SK/{year}/001 (own sequence per type)');
select is((select count(*)::int from nexus.letter_files where letter_id = nexus_test.id('out1')), 2, 'F3: two files attached at registration');
select is((select count(*)::int from nexus.letter_history where letter_id = nexus_test.id('out1') and kind = 'file_added'), 2,
  'one history row per file');
reset role; select nexus_test.login_as(19);
select nexus_test.put('out2', letter_id) from nexus.letter_register('outgoing', 'Peminjaman ruang', 'Kampus Uji', p_letter_date => nexus_test.d(-3));
select is(nexus_test.num('out2'), 'PMK/NEX/SK/' || nexus_test.y() || '/002', 'LT-01: the second secretary registers the next outgoing number');
select is((select register_number from (select number_text as register_number from nexus.letter_list('outgoing') where letter_id = nexus_test.id('out2')) x),
          nexus_test.num('out2'), 'F1: the letter is in the register list');

-- Every other persona is refused (LT-02, LT-03, LT-04).
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'x', 'y', p_received_date => nexus_test.d(0))$$), 'permission_required',
  'LT-02: P-KETUM cannot register (direct call)');
reset role; select nexus_test.login_as(6);
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'x', 'y', p_received_date => nexus_test.d(0))$$), 'permission_required',
  'LT-03: P-SEKDEP cannot register');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'x', 'y', p_received_date => nexus_test.d(0))$$), 'permission_required',
  'LT-03: P-ADMIN cannot register');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.letter_list('incoming')$$), 'permission_required', 'LT-03: P-PLAIN cannot read the register');
select is(nexus_test.hint_of(format('select nexus.letter_detail(%L)', nexus_test.id('in1'))), 'permission_required', 'LT-03: ... nor a letter detail');
reset role; select nexus_test.login_as(15);
select is(nexus_test.hint_of($$select * from nexus.letter_list('incoming')$$), 'permission_required', 'LT-04: P-INACTIVE gets nothing');
reset role; select nexus_test.login_as(17);
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'x', 'y', p_received_date => nexus_test.d(0))$$), 'permission_required',
  'LT-04: P-UNLINKED gets nothing');
reset role; select nexus_test.logout();
set local role authenticated;
select is(nexus_test.hint_of($$select * from nexus.letter_list('incoming')$$), 'permission_required', 'LT-04: a token without a subject gets nothing');
reset role;

-- =============================================================================================
-- 5. Files on a letter: add, limits, withdraw (F4.2, LT-26, LT-28, LT-50, G4, A-LT9)
-- =============================================================================================
select nexus_test.login_as(4);
select is((select file_count from nexus.letter_add_files(nexus_test.id('out1'), nexus_test.lv('out1'), nexus_test.files(4, 1))), 3,
  'F4.2: a third file is added');
select is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('out1'), nexus_test.lv('out1'), nexus_test.files(4, 1))),
  'file_count', 'LT-26: a fourth visible file is refused');
select is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('out1'), nexus_test.lv('out1'), '[]')),
  'file_required', 'adding nothing is refused');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_letter_date => nexus_test.d(0), p_files => %L)',
                                    'outgoing', 'x', 'y', nexus_test.files(4, 4))),
  'file_count', 'LT-26: four files at registration are refused (and no number is used)');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_letter_date => nexus_test.d(0), p_files => %L)',
                                    'outgoing', 'x', 'y', nexus_test.file1(nexus_test.fpath(11)))),
  'invalid_file', 'files must come from the caller''s OWN upload folder (another member''s upload is refused)');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_letter_date => nexus_test.d(0), p_files => %L)',
                                    'outgoing', 'x', 'y', nexus_test.file1(nexus_test.mid(4)::text || '/' || gen_random_uuid()::text || '.docx'))),
  'invalid_file', 'LT-26: only pdf, jpg, jpeg, png names are accepted');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_letter_date => nexus_test.d(0), p_files => %L)',
                                    'outgoing', 'x', 'y', nexus_test.file1(nexus_test.mid(4)::text || '/../x.pdf'))),
  'invalid_file', 'a path with another shape is refused');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_letter_date => nexus_test.d(0), p_files => %L)',
                                    'outgoing', 'x', 'y', nexus_test.file1(nexus_test.fpath(4), '  '))),
  'invalid_file', 'a file needs a name');
select fpath as dup_path from nexus_test.fpath(4) \gset
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_letter_date => nexus_test.d(0), p_files => %L)',
                                    'outgoing', 'x', 'y', jsonb_build_array(jsonb_build_object('path', :'dup_path', 'name', 'a.pdf'),
                                                                            jsonb_build_object('path', :'dup_path', 'name', 'b.pdf')))),
  'invalid_file', 'the same file twice in one call is refused');
select (select storage_path from nexus.letter_files where letter_id = nexus_test.id('out1') order by id limit 1) as attached_path \gset
select is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('in1'), nexus_test.lv('in1'), nexus_test.file1(:'attached_path'))),
  'file_already_attached', 'LT-28: a stored file cannot be attached a second time');
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('in1'), nexus_test.lv('in1'),
                                    nexus_test.file1(nexus_test.mid(4)::text || '/' || gen_random_uuid()::text || '.pdf'))),
          'file_missing', 'a file that was never uploaded is refused')
  else skip('Storage not installed (load tests/support/storage_stub.sql)', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('in1'), nexus_test.lv('in1'),
                                    nexus_test.file1(nexus_test.fpath(4, 'pdf', 5242881)))),
          'file_too_large', 'LT-26: a file over 5 MB is refused, also by direct call')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('in1'), nexus_test.lv('in1'),
                                    nexus_test.file1(nexus_test.fpath(4, 'pdf', 1000, 'application/x-msdownload')))),
          'invalid_file', 'LT-26: the stored type must match (an executable named .pdf is refused)')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is((select size_bytes || ':' || mime_type from nexus.letter_files where letter_id = nexus_test.id('out1') order by id limit 1),
          '120000:application/pdf', 'size and type are taken from the Storage metadata')
  else is((select mime_type from nexus.letter_files where letter_id = nexus_test.id('out1') order by id limit 1), 'application/pdf',
          'without Storage the type follows the extension') end;

-- Withdraw (A-LT9, G4)
select (select id from nexus.letter_files where letter_id = nexus_test.id('out1') order by id limit 1)::text as f_out1 \gset
select is(nexus_test.hint_of(format('select * from nexus.letter_withdraw_file(%s, %s, %L)', :f_out1, nexus_test.lv('out1'), ' ')),
  'reason_required', 'A-LT9: withdrawing needs a reason');
select is((select file_count from nexus.letter_withdraw_file(:f_out1, nexus_test.lv('out1'), 'Berkas salah')), 2,
  'A-LT9: the file is withdrawn; two visible files remain');
select ok((select is_withdrawn and withdraw_reason = 'Berkas salah' and withdrawn_by = nexus_test.mid(4) from nexus.letter_files where id = :f_out1),
  'LT-28: the record stays, marked withdrawn with who and why');
select is(nexus_test.hint_of(format('select * from nexus.letter_withdraw_file(%s, %s, %L)', :f_out1, nexus_test.lv('out1'), 'lagi')),
  'state_changed', 'a file is withdrawn once');
select is((select file_count from nexus.letter_add_files(nexus_test.id('out1'), nexus_test.lv('out1'), nexus_test.files(4, 1))), 3,
  'LT-50/G4: withdrawn files do not count toward the limit of 3');
select ok((select jsonb_array_length(nexus.letter_detail(nexus_test.id('out1')) -> 'files') = 4
                  and (nexus.letter_detail(nexus_test.id('out1')) -> 'files' -> 0 ->> 'withdraw_reason') = 'Berkas salah'),
  'A-LT9: a manager sees the withdrawn file with its reason');
select is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('out1'), nexus_test.lv('out1') - 1, nexus_test.files(4, 1))),
  'state_changed', 'a stale version is refused ("Data sudah berubah")');
reset role; select nexus_test.login_as(3);
select ok((select jsonb_array_length(nexus.letter_detail(nexus_test.id('out1')) -> 'files') = 3
                  and not exists (select 1 from jsonb_array_elements(nexus.letter_detail(nexus_test.id('out1')) -> 'files') e
                                  where (e ->> 'is_withdrawn')::boolean)),
  'A-LT9/LT-28: a viewer (P-KETUM) does not see the withdrawn file');
select is((select count(*)::int from nexus.letter_files where letter_id = nexus_test.id('out1')), 3,
  'A-LT9: ... not even through the table (RLS)');
select is((select file_count from nexus.letter_list('outgoing') where letter_id = nexus_test.id('out1')), 3,
  'the list counts visible files only');
select is(nexus_test.hint_of(format('select * from nexus.letter_withdraw_file(%s, %s, %L)', :f_out1, nexus_test.lv('out1'), 'x')),
  'permission_required', 'LT-02: P-KETUM cannot withdraw');

-- =============================================================================================
-- 6. Edit details with history (F4.1, LT-22, L6, G3)
-- =============================================================================================
reset role; select nexus_test.login_as(19);
select ok((select changed from nexus.letter_update(nexus_test.id('in1'), nexus_test.lv('in1'), 'Undangan rapat pleno', 'Pengirim Uji A',
                                                   nexus_test.d(-2), nexus_test.d(-1), '12/ABC/2091')),
  'LT-22: a manager edits Perihal and the received date (G3)');
select ok((select before_data = jsonb_build_object('subject', 'Undangan rapat', 'received_date', nexus_test.d(0))
                  and after_data = jsonb_build_object('subject', 'Undangan rapat pleno', 'received_date', nexus_test.d(-1))
                  and actor_member_id = nexus_test.mid(19)
           from nexus.letter_history where letter_id = nexus_test.id('in1') and kind = 'edited'),
  'L6: one history row with before and after of the changed fields only, and who');
select is(nexus_test.num('in1'), 'PMK/NEX/SM/' || nexus_test.y() || '/001', 'LT-22: the number did not change');
select ok(not (select changed from nexus.letter_update(nexus_test.id('in1'), nexus_test.lv('in1'), 'Undangan rapat pleno', 'Pengirim Uji A',
                                                       nexus_test.d(-2), nexus_test.d(-1), '12/ABC/2091')),
  'design 7.5: nothing changed = no save');
select is((select count(*)::int from nexus.letter_history where letter_id = nexus_test.id('in1') and kind = 'edited'), 1,
  '... and no history row');
select is(nexus_test.hint_of(format('select * from nexus.letter_update(%L, %s, %L, %L, p_received_date => nexus_test.d(0))', nexus_test.id('in1'), nexus_test.lv('in1') - 1, 'x', 'y')),
  'state_changed', 'a stale version is refused');
select is(nexus_test.hint_of(format('select * from nexus.letter_update(%L, %s, %L, %L, p_received_date => nexus_test.d(2))', nexus_test.id('in1'), nexus_test.lv('in1'), 'x', 'y')),
  'date_in_future', 'LT-21: edits are validated like registration');
select is(nexus_test.hint_of(format('select * from nexus.letter_update(%L, %s, %L, %L, p_letter_date => nexus_test.d(0), p_received_date => nexus_test.d(0))', nexus_test.id('out2'), nexus_test.lv('out2'), 'x', 'y')),
  'invalid_input', 'an outgoing letter still cannot get a received date');
select ok(not exists (select 1 from pg_proc p where p.proname = 'letter_update' and p.proargnames && array['p_number_text', 'p_type', 'p_letter_type', 'p_number_year']),
  'LT-22: number, type and year are not even parameters of the edit');
reset role; select nexus_test.login_as(5);
select is(nexus_test.hint_of(format('select * from nexus.letter_update(%L, %s, %L, %L, p_received_date => nexus_test.d(0))', nexus_test.id('in1'), nexus_test.lv('in1'), 'x', 'y')),
  'permission_required', 'LT-02: P-BEND cannot edit');
reset role; select nexus_test.logout();
select is(nexus_test.hint_of(format('update nexus.letters set number_text = %L where id = %L', 'X/1', nexus_test.id('in1'))), 'immutable_column',
  'LT-17: the number is not editable even by hand (owner)');
select is(nexus_test.hint_of(format('update nexus.letters set number_year = 2000 where id = %L', nexus_test.id('in1'))), 'immutable_column',
  '... nor the year or type');

-- =============================================================================================
-- 7. Void ("Batalkan nomor", F4.3, LT-23, A-LT8)
-- =============================================================================================
select nexus_test.login_as(4);
select is(nexus_test.hint_of(format('select * from nexus.letter_void(%L, %s, %L)', nexus_test.id('in2'), nexus_test.lv('in2'), '')),
  'reason_required', 'LT-23: voiding needs a reason');
select is((select status from nexus.letter_void(nexus_test.id('in2'), nexus_test.lv('in2'), 'Salah catat')), 'voided', 'LT-23: the number is voided');
select ok((select status = 'voided' and void_reason = 'Salah catat' and voided_by = nexus_test.mid(4) and number_text = 'PMK/NEX/SM/' || nexus_test.y() || '/002'
           from nexus.letters where id = nexus_test.id('in2')),
  'LT-23: the row stays with its number, reason and who');
select is((select note from nexus.letter_history where letter_id = nexus_test.id('in2') and kind = 'voided'), 'Salah catat', 'a history row with the reason');
select is(nexus_test.hint_of(format('select * from nexus.letter_update(%L, %s, %L, %L, p_received_date => nexus_test.d(0))', nexus_test.id('in2'), nexus_test.lv('in2'), 'x', 'y')),
  'letter_voided', 'A-LT8: a voided letter is read-only (edit)');
select is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('in2'), nexus_test.lv('in2'), nexus_test.files(4, 1))),
  'letter_voided', '... (files)');
select is(nexus_test.hint_of(format('select * from nexus.letter_void(%L, %s, %L)', nexus_test.id('in2'), nexus_test.lv('in2'), 'lagi')),
  'letter_voided', '... (void again)');
select ok((select bool_or(status = 'voided') from nexus.letter_list('incoming')) and (select count(*) = 1 from nexus.letter_list('incoming', p_status => 'voided')),
  'F1: the voided letter stays in the register and is found by the status filter');
select nexus_test.put('in4', letter_id) from nexus.letter_register('incoming', 'Surat baru', 'Pengirim Uji D', p_received_date => nexus_test.d(0));
select is(nexus_test.num('in4'), 'PMK/NEX/SM/' || nexus_test.y() || '/004', 'LT-23/R2: the voided number 002 is never reissued; the next is 004');
reset role; select nexus_test.logout();
select is(nexus_test.hint_of(format('update nexus.letters set status = %L where id = %L', 'active', nexus_test.id('in2'))), 'immutable_column',
  'A-LT8: a voided letter is never restored, not even by hand');

-- =============================================================================================
-- 8. "Nomor lama" (L7 b, design P9, G7): typed number, unique per type, never moves the counter
-- =============================================================================================
select nexus_test.login_as(4);
select nexus_test.put('lg1', letter_id) from nexus.letter_register('incoming', 'Surat lama', 'Pengirim Lama',
  p_received_date => date '2088-01-01' - 365 * 80, p_legacy_number => '  045/PMK/2025  ');
select ok((select is_legacy_number and number_text = '045/PMK/2025' and number_year is null and number_seq is null and number_code is null
           from nexus.letters where id = nexus_test.id('lg1')),
  'L7 b: an old letter is registered with its typed number (trimmed), marked Nomor lama');
select is(nexus_test.counter('incoming'), 4, 'L7 b: a Nomor lama does not move the counter');
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'x', 'y', p_received_date => nexus_test.d(0), p_legacy_number => '045/pmk/2025')$$),
  'duplicate_number', 'L7 b: the same number text again (any case) is refused');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_received_date => nexus_test.d(0), p_legacy_number => %L)',
                                    'incoming', 'x', 'y', 'PMK/NEX/SM/' || nexus_test.y() || '/001')),
  'duplicate_number', 'L7 b: a typed number equal to a system number is refused');
select is(nexus_test.hint_of(format('select * from nexus.letter_register(%L, %L, %L, p_received_date => nexus_test.d(0), p_legacy_number => %L)',
                                    'incoming', 'x', 'y', repeat('9', 61))),
  'text_too_long', 'A-LT18: a typed number has at most 60 characters');
select nexus_test.put('lg2', letter_id) from nexus.letter_register('outgoing', 'Surat lama keluar', 'Tujuan Lama',
  p_letter_date => date '2025-03-01', p_legacy_number => '045/PMK/2025');
select is(nexus_test.ls('lg2'), 'active', 'spec 4.3: unique per TYPE: the same text is allowed once for outgoing');
-- A typed number that the counter would produce later is skipped by the system (no duplicate ever).
select nexus_test.put('lg3', letter_id) from nexus.letter_register('incoming', 'Surat lama 2', 'Pengirim Lama',
  p_received_date => nexus_test.d(-30), p_legacy_number => 'PMK/NEX/SM/' || nexus_test.y() || '/005');
select nexus_test.put('in5', letter_id) from nexus.letter_register('incoming', 'Surat sesudah nomor lama', 'Pengirim Uji E', p_received_date => nexus_test.d(0));
select is(nexus_test.num('in5'), 'PMK/NEX/SM/' || nexus_test.y() || '/006',
  'R5: the system skips a sequence whose text a Nomor lama already holds (005 -> 006)');
select is(nexus_test.counter('incoming'), 6, '... and the counter moves past it');
select ok((select bool_or(is_legacy_number) from nexus.letter_list('incoming', p_period => 'all')),
  'design P3: the list tells which rows are Nomor lama');

-- =============================================================================================
-- 9. Numbering settings changes (P11, G6, LT-20, LT-41, LT-51, R4, R5)
-- =============================================================================================
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_set_next(%L, %s, 50, %L)', 'incoming', nexus_test.y(), 'x')),
  'not_system_admin', 'LT-41: a secretary cannot set the next number');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_update_format(1, %L, %L, %L, 3, %L, true)', 'X', 'A', 'B', '/')),
  'not_system_admin', 'LT-41: ... nor change the format');
reset role; select nexus_test.login_as(1);
select is((select next_number from nexus.letter_numbering_set_next('incoming', nexus_test.y()::int, 46, 'Melanjutkan buku surat')),
          'PMK/NEX/SM/' || nexus_test.y() || '/046', 'L7 a/P11: the System Admin sets the next incoming number to 046');
select is(nexus_test.counter('incoming'), 45, '... stored as "last used 045"');
select ok((select kind = 'next_sequence' and letter_type = 'incoming' and number_year::text = nexus_test.y() and reason = 'Melanjutkan buku surat'
                  and before_data = '{"last_used": 6, "next_seq": 7}'::jsonb and after_data = '{"last_used": 45, "next_seq": 46}'::jsonb
                  and actor_member_id = nexus_test.mid(1)
           from nexus.letter_numbering_changes order by id desc limit 1),
  'LT-41: the change is logged with before, after, reason and who');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_set_next(%L, %s, 40, %L)', 'incoming', nexus_test.y(), 'x')),
  'sequence_not_higher', 'LT-51/G6: the next number can never go down');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_set_next(%L, %s, 45, %L)', 'incoming', nexus_test.y(), 'x')),
  'sequence_not_higher', 'LT-51: ... nor repeat the last one used');
select is(nexus_test.detail_of(format('select * from nexus.letter_numbering_set_next(%L, %s, 45, %L)', 'incoming', nexus_test.y(), 'x')),
  '45', '... (detail = the last used sequence, for the message)');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_set_next(%L, %s, 60, %L)', 'incoming', nexus_test.y(), '')),
  'reason_required', 'LT-51: a reason is required');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_set_next(%L, %s, 60, %L)', 'incoming', nexus_test.y()::int - 1, 'x')),
  'year_not_current', 'LT-51/G6: only the current year can be set');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_set_next(%L, %s, 0, %L)', 'incoming', nexus_test.y(), 'x')),
  'invalid_input', 'the next number is a whole number from 1');
reset role; select nexus_test.login_as(4);
select nexus_test.put('in6', letter_id) from nexus.letter_register('incoming', 'Sesudah atur nomor', 'Pengirim Uji F', p_received_date => nexus_test.d(0));
select is(nexus_test.num('in6'), 'PMK/NEX/SM/' || nexus_test.y() || '/046', 'L7 a: the next letter continues at 046');
select ok((select (s -> 'types' -> 0 ->> 'start_set')::boolean and (s -> 'types' -> 0 ->> 'last_used') = '46'
                  and (s -> 'types' -> 0 ->> 'next_number') = 'PMK/NEX/SM/' || nexus_test.y() || '/047'
           from nexus.letter_numbering_settings() s),
  'G6: the settings show last used 046, next 047, start set');

-- Format changes (LT-20, R5)
reset role; select nexus_test.login_as(1);
select (nexus.letter_numbering_settings() ->> 'version')::int as set_v \gset
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 3, %L, true)', :set_v - 1, 'PMK/NEX', 'SM', 'SK', '/')),
  'state_changed', 'a stale settings version is refused');
select ok(not (select changed from nexus.letter_numbering_update_format(:set_v, 'PMK/NEX', 'SM', 'SK', 3, '/', true)),
  'the same format = nothing saved');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 3, %L, true)', :set_v, 'PMK NEX', 'SM', 'SK', '/')),
  'invalid_number_format', 'design 13.2: the prefix allows letters, digits, slash, dot, hyphen only');
select is(nexus_test.detail_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 3, %L, true)', :set_v, 'PMK/NEX', 'SK', 'sk', '/')),
  'codes_equal', 'design 13.2: the two codes must differ');
select is(nexus_test.detail_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 7, %L, true)', :set_v, 'PMK/NEX', 'SM', 'SK', '/')),
  'seq_digits', 'digits 1..6');
select is(nexus_test.detail_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 3, %L, true)', :set_v, 'PMK/NEX', 'SM', 'SK', '_')),
  'separator', 'separator / - . only');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 3, %L, false)', :set_v, 'PMK/NEX', 'SM', 'SK', '/')),
  'year_required', 'owner 2026-11-09: the System Admin cannot switch the year off');
select is(nexus_test.detail_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 3, %L, null)', :set_v, 'PMK/NEX', 'SM', 'SK', '/')),
  'include_year', '... nor leave it empty (detail names the field)');
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 4, %L, false)', :set_v, 'PMK/NEX', 'SM', 'SK', '-')),
  'year_required', '... also together with other changes (nothing saved)');
reset role; select nexus_test.login_as(4);
select nexus_test.put('lg4', letter_id) from nexus.letter_register('incoming', 'Surat lama 3', 'Pengirim Lama',
  p_received_date => nexus_test.d(-10), p_legacy_number => 'PMK/NEX/SM/' || nexus_test.y() || '/0047');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 4, %L, true)', :set_v, 'PMK/NEX', 'SM', 'SK', '/')),
  'format_collision', 'R5/LT-20: a format whose next number already exists is refused');
select is(nexus_test.detail_of(format('select * from nexus.letter_numbering_update_format(%s, %L, %L, %L, 4, %L, true)', :set_v, 'PMK/NEX', 'SM', 'SK', '/')),
  'PMK/NEX/SM/' || nexus_test.y() || '/0047', '... naming the number it would repeat');
select ok((select changed from nexus.letter_numbering_update_format(:set_v, 'PMK/NEXUS', 'SM', 'SK', 3, '/', true, 'Uji format')),
  'P11: the System Admin changes the prefix');
reset role; select nexus_test.login_as(4);
select nexus_test.put('in7', letter_id) from nexus.letter_register('incoming', 'Format baru', 'Pengirim Uji G', p_received_date => nexus_test.d(0));
select is(nexus_test.num('in7'), 'PMK/NEXUS/SM/' || nexus_test.y() || '/047', 'LT-20: the next letter uses the new format with the continuing sequence');
select is(nexus_test.num('in1'), 'PMK/NEX/SM/' || nexus_test.y() || '/001', 'LT-20: existing numbers are untouched (stored, never recomputed)');
reset role; select nexus_test.login_as(1);
select ok((select changed from nexus.letter_numbering_update_format((nexus.letter_numbering_settings() ->> 'version')::int, 'PMK/NEX', 'SM', 'SK', 3, '/', true)),
  'the prefix goes back (next number 048 is free)');
select ok((select kind = 'format' and before_data ->> 'prefix' = 'PMK/NEXUS' and after_data ->> 'prefix' = 'PMK/NEX' and reason is null
           from nexus.letter_numbering_changes order by id desc limit 1),
  'LT-41: format changes are logged with before and after');
reset role; select nexus_test.login_as(19);
select is((select count(*)::int from nexus.letter_numbering_history()), 3, 'A-LT12: a secretary reads the change history (3 changes)');
select ok((select bool_and(actor_name = 'Test Persona 1') from nexus.letter_numbering_history()), '... with the actor''s PI-CORE name');
reset role; select nexus_test.logout();
select is(nexus_test.hint_of('update nexus.letter_numbering_changes set reason = null'), 'append_only', 'the change history is append-only');
select is(nexus_test.hint_of($$update nexus.letter_number_counters set last_value = 1 where letter_type = 'incoming'$$), 'immutable_column',
  'R2: a counter never goes back, not even by hand');

-- Year rule (A-LT1, R4, LT-18, LT-47) and growth past the digit count (spec 4.3).
select is(nexus._lt_year_at('2026-12-31 23:30:00+00'), 2027, 'LT-18/LT-47: 23:30 UTC on 31 December is already the next Jakarta year');
select is(nexus._lt_year_at('2026-12-31 16:59:59+00'), 2026, 'LT-18: 16:59:59 UTC is still the old Jakarta year');
select is(nexus._lt_format_number('PMK/NEX', 'SK', '/', true, 3, 2026, 1000), 'PMK/NEX/SK/2026/1000', 'spec 4.3: past 999 the sequence grows to four digits');
select is(nexus._lt_format_number('PMK-NEX', 'SK', '-', true, 4, 2026, 7), 'PMK-NEX-SK-2026-0007', 'format parts come from the settings (separator, 4 digits)');
insert into nexus.letter_number_counters (letter_type, number_year, last_value) values ('outgoing', nexus_test.y()::int - 1, 500);
select nexus_test.login_as(4);
select nexus_test.put('out3', letter_id) from nexus.letter_register('outgoing', 'Tahun ini', 'Tujuan Uji', p_letter_date => nexus_test.d(0));
select is(nexus_test.num('out3'), 'PMK/NEX/SK/' || nexus_test.y() || '/003',
  'R4/LT-18: one sequence per type and YEAR: last year''s counter (500) does not affect this year');

-- =============================================================================================
-- 10. Requests: submit, read own, cancel (F5, F7, LT-07..LT-10, L9)
-- =============================================================================================
reset role; select nexus_test.login_as(11);
select nexus_test.put('r1', request_id) from nexus.letter_request_create('Surat rekomendasi lomba', 'Kemahasiswaan Uji',
  'Untuk lomba debat bulan depan', p_on_behalf_of => 'Panitia Uji', p_needed_by => nexus_test.d(7), p_files => nexus_test.files(11, 2));
select ok((select requester_member_id = nexus_test.mid(11) and status = 'submitted' and period_id = nexus_test.period(2) and version = 1
                  and on_behalf_of = 'Panitia Uji' and letter_id is null
           from nexus.letter_requests where id = nexus_test.id('r1')),
  'LT-07: any active member submits; requester = session member, period = active period, status Diajukan');
select is((select count(*)::int from nexus.letter_files where request_id = nexus_test.id('r1')), 2, 'L3 b: two attachments saved with the request');
select is((select event from nexus.letter_request_history where request_id = nexus_test.id('r1')), 'submitted', 'LT-12: the submit is in the timeline');
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('', 'Tujuan', 'Keperluan')$$), 'text_required', 'LT-08: Perihal is required');
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('Perihal', ' ', 'Keperluan')$$), 'text_required', 'LT-08: the addressee is required');
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('Perihal', 'Tujuan', '')$$), 'text_required', 'LT-08: Keperluan is required');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_create(%L, %L, %L)', 'P', 'T', repeat('k', 1001))), 'text_too_long',
  'LT-44/A-LT18: Keperluan max 1000');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_create(%L, %L, %L, p_on_behalf_of => %L)', 'P', 'T', 'K', repeat('a', 121))), 'text_too_long',
  'LT-44/A-LT18: Atas nama max 120');
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('P', 'T', 'K', p_needed_by => nexus_test.d(-1))$$), 'date_in_past',
  'design 9.2: "Dibutuhkan paling lambat" not before today');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_create(%L, %L, %L, p_files => %L)', 'P', 'T', 'K', nexus_test.files(4, 1))),
  'invalid_file', 'LT-08: attachments only from the requester''s own uploads');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_create(%L, %L, %L, p_files => %L)', 'P', 'T', 'K', nexus_test.files(11, 4))),
  'file_count', 'LT-08: at most 3 attachments');
select ok((select count(*) = 1 and bool_and(request_id = nexus_test.id('r1')) and bool_and(number_text is null)
           from nexus.letter_my_requests()),
  'LT-09: "Permohonan Saya" lists the own request (no number yet)');
select ok((select (d ->> 'status') = 'submitted' and (d ->> 'is_own')::boolean and jsonb_array_length(d -> 'attachments') = 2
                  and (d -> 'actions' ->> 'can_cancel')::boolean and not (d -> 'actions' ->> 'can_process')::boolean
                  and (d -> 'requester_is_active') = 'null'::jsonb and (d -> 'letter_id') = 'null'::jsonb
           from nexus.letter_request_detail(nexus_test.id('r1')) d),
  'LT-09: the requester reads the detail with attachments and may cancel; internal markers are hidden');
select is(nexus_test.hint_of('select * from nexus.letter_request_queue()'), 'permission_required', 'LT-03: P-PLAIN has no queue');

reset role; select nexus_test.login_as(20);
select is(nexus_test.hint_of(format('select nexus.letter_request_detail(%L)', nexus_test.id('r1'))), 'request_not_found',
  'LT-09/AC-27: another member cannot read the request (same answer as a missing id)');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_cancel(%L, %s)', nexus_test.id('r1'), nexus_test.rv('r1'))), 'request_not_found',
  'LT-10/AC-30: ... nor cancel it');
select is((select count(*)::int from nexus.letter_my_requests()), 0, 'LT-09: their own list is empty');
select is((select count(*)::int from nexus.letter_requests) + (select count(*)::int from nexus.letter_files), 0,
  'LT-43: nothing of another member through the tables');
reset role; select nexus_test.login_as(6);
select is(nexus_test.hint_of(format('select nexus.letter_request_detail(%L)', nexus_test.id('r1'))), 'request_not_found', 'LT-03: P-SEKDEP cannot read it');
select is(nexus_test.hint_of('select * from nexus.letter_request_queue()'), 'permission_required', 'LT-03: P-SEKDEP has no queue');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of('select * from nexus.letter_request_queue()'), 'permission_required', 'LT-03/B18: P-ADMIN has no queue');
reset role; select nexus_test.login_as(3);
select ok((select (d ->> 'subject') = 'Surat rekomendasi lomba' and (d ->> 'requester_name') = 'Test Persona 11'
                  and (d ->> 'requester_is_active')::boolean and not (d -> 'actions' ->> 'can_process')::boolean
                  and jsonb_array_length(d -> 'attachments') = 2
           from nexus.letter_request_detail(nexus_test.id('r1')) d),
  'LT-02: P-KETUM (view_all) reads every request with attachments, no action buttons');
select is((select count(*)::int from nexus.letter_request_queue()), 1, 'LT-02: ... and the queue');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_process(%L, %s)', nexus_test.id('r1'), nexus_test.rv('r1'))), 'permission_required',
  'LT-02: P-KETUM cannot process (direct call)');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_cancel(%L, %s)', nexus_test.id('r1'), nexus_test.rv('r1'))), 'not_requester',
  'LT-10: only the requester cancels');

-- Cancel while Diajukan (L9, A-LT6)
reset role; select nexus_test.login_as(11);
select nexus_test.req('rc');
select is((select status from nexus.letter_request_cancel(nexus_test.id('rc'), nexus_test.rv('rc'), 'Tidak jadi')), 'cancelled',
  'LT-10: the requester cancels while Diajukan');
select is((select note from nexus.letter_request_history where request_id = nexus_test.id('rc') and event = 'cancelled'), 'Tidak jadi',
  'the reason is in the timeline');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_cancel(%L, %s)', nexus_test.id('rc'), nexus_test.rv('rc'))), 'state_changed',
  'a cancelled request is terminal');

-- =============================================================================================
-- 11. Process, "Ambil nomor", Terbitkan (F6, LT-11..LT-15b, A-LT23, A-LT24, R20)
-- =============================================================================================
reset role; select nexus_test.login_as(4);
select ok((select (d -> 'actions' ->> 'can_process')::boolean and not (d -> 'actions' ->> 'can_take_number')::boolean
                  and not (d -> 'actions' ->> 'can_issue')::boolean and (d -> 'actions' ->> 'can_reject')::boolean
           from nexus.letter_request_detail(nexus_test.id('r1')) d),
  'P8: on Diajukan the secretary may Proses or Tolak');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_take_number(%L, %s)', nexus_test.id('r1'), nexus_test.rv('r1'))), 'state_changed',
  'A-LT23: no number from Diajukan (Proses first)');
select is((select status from nexus.letter_request_process(nexus_test.id('r1'), nexus_test.rv('r1'), 'Sedang disiapkan')), 'processing',
  'F6.3: Proses moves it to Diproses');
select ok((select processed_by = nexus_test.mid(4) and processed_at is not null from nexus.letter_requests where id = nexus_test.id('r1')),
  '... recording who');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of(format('select * from nexus.letter_request_cancel(%L, %s)', nexus_test.id('r1'), nexus_test.rv('r1'))), 'state_changed',
  'LT-10/A-LT6: after Diproses the requester can no longer cancel');
select ok((select processed_by_name = 'Test Persona 4' and note = 'Sedang disiapkan' and note_by_name = 'Test Persona 4' and number_text is null
           from nexus.letter_my_requests() where request_id = nexus_test.id('r1')),
  'G11: the requester sees who prepares it and the processor note');
reset role; select nexus_test.login_as(4);
select is(nexus_test.hint_of(format('select * from nexus.letter_request_issue(%L, %s, %s, %L, %L, nexus_test.d(0), %L)',
                                    nexus_test.id('r1'), nexus_test.rv('r1'), nexus_test.rlv('r1'), 'P', 'T', nexus_test.files(4, 1))),
  'number_not_taken', 'LT-13/A-LT23: Terbitkan without a taken number is refused (direct call)');
select is((select count(*)::int from nexus.letter_request_queue('processing') where request_id = nexus_test.id('r1')), 1,
  'design 11.1: the request is in "Sedang diproses" (no number yet)');
select count(*)::int as out_before from nexus.letters where letter_type = 'outgoing' \gset
select ok((select number_text = 'PMK/NEX/SK/' || nexus_test.y() || '/004' and status = 'processing'
           from nexus.letter_request_take_number(nexus_test.id('r1'), nexus_test.rv('r1'))),
  'LT-13: "Ambil nomor" assigns the next outgoing number; the request stays Diproses');
select ok((select l.letter_type = 'outgoing' and l.status = 'active' and l.source_request_id = nexus_test.id('r1')
                  and l.period_id = nexus_test.period(2) and l.subject = 'Surat rekomendasi lomba' and l.counterpart = 'Kemahasiswaan Uji'
                  and l.letter_date = nexus_test.d(0) and l.created_by = nexus_test.mid(4)
                  and not exists (select 1 from nexus.letter_files f where f.letter_id = l.id)
           from nexus.letters l where l.id = nexus_test.req_letter('r1')),
  'LT-13: in the same transaction the linked register row exists: outgoing, Aktif, no file, active period, from the request');
select nexus_test.put('r1_letter', nexus_test.req_letter('r1'));
select ok((select number_taken_by = nexus_test.mid(4) and number_taken_at is not null from nexus.letter_requests where id = nexus_test.id('r1')),
  'who took the number is recorded');
select is((select event || ':' || coalesce(letter_id::text, '') from nexus.letter_request_history where request_id = nexus_test.id('r1') order by id desc limit 1),
  'number_taken:' || nexus_test.req_letter('r1')::text, 'LT-12: "Ambil nomor" is a timeline event linked to the letter');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_take_number(%L, %s)', nexus_test.id('r1'), nexus_test.rv('r1'))), 'state_changed',
  'LT-13: only once per request');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_take_number(%L, %s)', nexus_test.id('r1'), nexus_test.rv('r1') - 1)), 'state_changed',
  'LT-15: a second press with the old screen ("Data sudah berubah")');
select is((select count(*)::int from nexus.letters where letter_type = 'outgoing'), :out_before + 1, 'LT-15: exactly one number and one letter were used');
select is(nexus_test.counter('outgoing'), 4, 'LT-15: the counter moved by one');
select ok((select awaiting_final_file and from_request and file_count = 0 from nexus.letter_list('outgoing') where letter_id = nexus_test.id('r1_letter')),
  'R20/design 5.2: the register row shows "Menunggu file final", from a request, no file');
select ok((select (d ->> 'awaiting_final_file')::boolean and not (d -> 'actions' ->> 'can_void')::boolean
                  and not (d -> 'actions' ->> 'can_add_files')::boolean and (d -> 'request' ->> 'request_id')::uuid = nexus_test.id('r1')
           from nexus.letter_detail(nexus_test.id('r1_letter')) d),
  'G18/A-LT24: the letter detail offers no void and no file while the request is open');
select is(nexus_test.hint_of(format('select * from nexus.letter_void(%L, %s, %L)', nexus_test.id('r1_letter'), nexus_test.lv('r1_letter'), 'x')),
  'request_open', 'LT-15b: the letter cannot be voided through the register while Diproses');
select is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('r1_letter'), nexus_test.lv('r1_letter'), nexus_test.files(4, 1))),
  'request_open', 'LT-15b: ... nor get a file through the register');
select is((select count(*)::int from nexus.letter_request_queue('awaiting_file') where request_id = nexus_test.id('r1')), 1,
  'design 11.1: the request moved to "Menunggu file final"');
select is((select number_text from nexus.letter_request_queue('awaiting_file') where request_id = nexus_test.id('r1')),
  'PMK/NEX/SK/' || nexus_test.y() || '/004', '... showing the taken number');

-- The requester sees the number before the file exists (R20, LT-14) and never the register (L9).
reset role; select nexus_test.login_as(11);
select ok((select number_text = 'PMK/NEX/SK/' || nexus_test.y() || '/004' and not has_issued_file and not number_voided
           from nexus.letter_my_requests() where request_id = nexus_test.id('r1')),
  'LT-14/R20: the requester sees the number as soon as it is taken (no file yet)');
select ok((select (d ->> 'number_text') = 'PMK/NEX/SK/' || nexus_test.y() || '/004' and jsonb_array_length(d -> 'letter_files') = 0
                  and not (d -> 'actions' ->> 'can_cancel')::boolean
           from nexus.letter_request_detail(nexus_test.id('r1')) d),
  'LT-14: ... also in the detail, with no letter file and no cancel');
select is(nexus_test.hint_of(format('select nexus.letter_detail(%L)', nexus_test.id('r1_letter'))), 'permission_required',
  'L9: the requester never opens the register row');
select is((select count(*)::int from nexus.letters) + (select count(*)::int from nexus.letter_history), 0, 'L9: ... nor reads it through the tables');

-- Terbitkan (LT-13): files required, may correct Perihal / addressee / date, never the number.
reset role; select nexus_test.login_as(4);
select is(nexus_test.hint_of(format('select * from nexus.letter_request_issue(%L, %s, %s, %L, %L, nexus_test.d(0), %L)', nexus_test.id('r1'), nexus_test.rv('r1'), nexus_test.rlv('r1'), 'P', 'T', '[]')),
  'file_required', 'LT-13: Terbitkan needs at least one final file');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_issue(%L, %s, %s, %L, %L, nexus_test.d(0), %L)', nexus_test.id('r1'), nexus_test.rv('r1'), nexus_test.rlv('r1'), 'P', 'T', nexus_test.files(4, 4))),
  'file_count', 'LT-13: ... at most 3');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_issue(%L, %s, %s, %L, %L, nexus_test.d(1), %L)', nexus_test.id('r1'), nexus_test.rv('r1'), nexus_test.rlv('r1'), 'P', 'T', nexus_test.files(4, 1))),
  'date_in_future', 'LT-21: the letter date cannot be in the future');
select is(nexus_test.rs('r1') || ':' || nexus_test.counter('outgoing'), 'processing:4',
  'LT-13: a failed Terbitkan leaves the request Diproses with its number and uses no further number');
select is((select status from nexus.letter_request_issue(nexus_test.id('r1'), nexus_test.rv('r1'), nexus_test.rlv('r1'), 'Surat rekomendasi lomba debat',
                                                          'Kemahasiswaan Uji', nexus_test.d(0), nexus_test.files(4, 1), 'Silakan diunduh')), 'issued',
  'LT-13: Terbitkan with the signed file sets Diterbitkan');
select ok((select l.subject = 'Surat rekomendasi lomba debat' and l.number_text = 'PMK/NEX/SK/' || nexus_test.y() || '/004' and l.status = 'active'
                  and (select count(*) from nexus.letter_files f where f.letter_id = l.id) = 1
           from nexus.letters l where l.id = nexus_test.id('r1_letter')),
  'LT-13: the file is on the EXISTING register row; Perihal corrected; the number unchanged');
select ok((select before_data = '{"subject": "Surat rekomendasi lomba"}'::jsonb and request_id = nexus_test.id('r1')
           from nexus.letter_history where letter_id = nexus_test.id('r1_letter') and kind = 'edited'),
  'the correction is in the letter history');
select ok((select decided_by = nexus_test.mid(4) and decided_at is not null from nexus.letter_requests where id = nexus_test.id('r1')),
  'who issued is recorded');
select is(nexus_test.counter('outgoing'), 4, 'Terbitkan used no new number');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_issue(%L, %s, %s, %L, %L, nexus_test.d(0), %L)', nexus_test.id('r1'), nexus_test.rv('r1'), nexus_test.rlv('r1'), 'P', 'T', nexus_test.files(4, 1))),
  'state_changed', 'LT-15: a second Terbitkan is refused');
select is((select count(*)::int from nexus.letter_request_queue('closed') where request_id = nexus_test.id('r1')), 1, 'the request is in "Selesai"');

reset role; select nexus_test.login_as(11);
select ok((select has_issued_file and not number_voided and note = 'Silakan diunduh' from nexus.letter_my_requests() where request_id = nexus_test.id('r1')),
  'LT-14: the requester sees the issued file is ready and the note');
select (nexus.letter_request_detail(nexus_test.id('r1')) -> 'letter_files' -> 0 ->> 'storage_path') as r1_file \gset
select ok(:'r1_file' <> '' and nexus.letter_file_can_read(:'r1_file'), 'LT-14/L9: the requester may download the issued file');
reset role; select nexus_test.login_as(20);
select ok(not nexus.letter_file_can_read(:'r1_file'), 'LT-27: another member may not');
reset role; select nexus_test.login_as(6);
select ok(not nexus.letter_file_can_read(:'r1_file'), 'LT-27: P-SEKDEP may not');
reset role; select nexus_test.login_as(3);
select ok(nexus.letter_file_can_read(:'r1_file'), 'spec 4.4: letters.view holders may');

-- A-LT11, G5, LT-24: voiding the letter behind an issued request.
reset role; select nexus_test.login_as(19);
select is((select status from nexus.letter_void(nexus_test.id('r1_letter'), nexus_test.lv('r1_letter'), 'Isi surat salah')), 'voided',
  'A-LT11: the letter behind a Diterbitkan request can be voided');
select is(nexus_test.rs('r1'), 'issued', 'LT-24: the request stays Diterbitkan');
reset role; select nexus_test.login_as(11);
select ok((select number_voided and not has_issued_file from nexus.letter_my_requests() where request_id = nexus_test.id('r1')),
  'LT-24: the requester sees "Nomor dibatalkan" and no downloadable file');
select ok((select (d ->> 'number_voided')::boolean and jsonb_array_length(d -> 'letter_files') = 0 and not (d ? 'void_reason')
                  and d::text !~ 'Isi surat salah'
           from nexus.letter_request_detail(nexus_test.id('r1')) d),
  'G5: the requester gets no file and never the void reason');
select ok(not nexus.letter_file_can_read(:'r1_file'), 'G5: the requester can no longer download it');
reset role; select nexus_test.login_as(3);
select ok(nexus.letter_file_can_read(:'r1_file'), 'G5: register viewers still can');

-- G4: the last visible file of an issued letter cannot be withdrawn until a replacement exists.
reset role; select nexus_test.login_as(4);
select nexus_test.req('r2', 'Surat tugas sekjen');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_process(%L, %s)', nexus_test.id('r2'), nexus_test.rv('r2'))), 'self_processing_blocked',
  'LT-11/L6: P-SEKJEN cannot process their own request');
reset role; select nexus_test.login_as(1);
select nexus.add_access_rule('role', 'letter_requests.process', p_role_key => 'bph',
                             p_note => 'test LT-11 extra rule') as extra_rule \gset
reset role; select nexus_test.login_as(4);
select is(nexus_test.hint_of(format('select * from nexus.letter_request_process(%L, %s)', nexus_test.id('r2'), nexus_test.rv('r2'))), 'self_processing_blocked',
  'LT-11/AC-57: ... even with an extra custom rule granting process (role bph)');
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule(:'extra_rule'::uuid, 'test done'), 'extra rule disabled again');
reset role; select nexus_test.login_as(4);
select ok((select not (d -> 'actions' ->> 'can_process')::boolean and not (d -> 'actions' ->> 'can_reject')::boolean and (d ->> 'is_own')::boolean
                  and (d ->> 'other_processor_count')::int = 2
           from nexus.letter_request_detail(nexus_test.id('r2')) d),
  'LT-11/A-n9: no buttons on the own request; 2 other processors exist');
select ok((select is_own from nexus.letter_request_queue() where request_id = nexus_test.id('r2')), 'design 11.2: the queue marks it "Pengajuanmu"');
reset role; select nexus_test.login_as(19);
select is((select status from nexus.letter_request_process(nexus_test.id('r2'), nexus_test.rv('r2'))), 'processing', 'LT-11: another secretary processes it');
select is((select number_text from nexus.letter_request_take_number(nexus_test.id('r2'), nexus_test.rv('r2'))), 'PMK/NEX/SK/' || nexus_test.y() || '/005',
  'LT-11: ... takes the number');
reset role; select nexus_test.login_as(4);
select is(nexus_test.hint_of(format('select * from nexus.letter_request_issue(%L, %s, %s, %L, %L, nexus_test.d(0), %L)', nexus_test.id('r2'), nexus_test.rv('r2'), nexus_test.rlv('r2'), 'P', 'T', nexus_test.files(4, 1))),
  'self_processing_blocked', 'LT-11: the requester cannot issue their own request either');
reset role; select nexus_test.login_as(19);
select is((select status from nexus.letter_request_issue(nexus_test.id('r2'), nexus_test.rv('r2'), nexus_test.rlv('r2'), 'Surat tugas sekjen', 'Rektorat Uji', nexus_test.d(0), nexus_test.files(19, 1))),
  'issued', 'LT-11: ... and issues it');
select nexus_test.put('r2_letter', nexus_test.req_letter('r2'));
select (select id from nexus.letter_files where letter_id = nexus_test.id('r2_letter'))::text as f_r2 \gset
select is(nexus_test.hint_of(format('select * from nexus.letter_withdraw_file(%s, %s, %L)', :f_r2, nexus_test.lv('r2_letter'), 'salah')), 'last_issued_file',
  'LT-50/G4: the only file the requester sees cannot be withdrawn');
select is((select file_count from nexus.letter_add_files(nexus_test.id('r2_letter'), nexus_test.lv('r2_letter'), nexus_test.files(19, 1))), 2,
  'G4: a replacement is added first (allowed once the request is issued)');
select is((select file_count from nexus.letter_withdraw_file(:f_r2, nexus_test.lv('r2_letter'), 'Diganti')), 1, 'G4: then the wrong one is withdrawn');

-- R10/LT-33: Sekretaris Umum 2 + Staff Logistik is still blocked on their own request.
reset role; select nexus_test.login_as(13);
select nexus_test.req('r5', 'Surat sekum dua');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_reject(%L, %s, %L)', nexus_test.id('r5'), nexus_test.rv('r5'), 'x')), 'self_processing_blocked',
  'LT-33/R10: a person with two assignments still cannot reject their own request');
reset role; select nexus_test.login_as(4);
select is((select status from nexus.letter_request_process(nexus_test.id('r5'), nexus_test.rv('r5'))), 'processing', 'another secretary processes it');

-- =============================================================================================
-- 12. Reject (F6.6, LT-12, LT-15a, R19)
-- =============================================================================================
reset role; select nexus_test.login_as(20);
select nexus_test.req('r3', 'Surat izin kegiatan');
select nexus_test.req('r4', 'Surat lain');
reset role; select nexus_test.login_as(13);
select is((select status from nexus.letter_request_process(nexus_test.id('r3'), nexus_test.rv('r3'))), 'processing', 'r3 processed');
select is((select number_text from nexus.letter_request_take_number(nexus_test.id('r3'), nexus_test.rv('r3'))), 'PMK/NEX/SK/' || nexus_test.y() || '/006',
  'r3 number taken');
select nexus_test.put('r3_letter', nexus_test.req_letter('r3'));
select is(nexus_test.hint_of(format('select * from nexus.letter_request_reject(%L, %s, %L)', nexus_test.id('r3'), nexus_test.rv('r3'), '  ')), 'note_required',
  'LT-12: rejection without a note is refused');
select is((select status from nexus.letter_request_reject(nexus_test.id('r3'), nexus_test.rv('r3'), 'Kegiatan dibatalkan panitia')), 'rejected',
  'LT-15a: rejecting after "Ambil nomor" sets Ditolak');
select ok((select status = 'voided' and void_reason = 'Kegiatan dibatalkan panitia' and voided_by = nexus_test.mid(13)
           from nexus.letters where id = nexus_test.id('r3_letter')),
  'LT-15a/R19: in the same transaction the register row is voided with the rejection note as reason');
select is((select count(*)::int from nexus.letter_history where letter_id = nexus_test.id('r3_letter') and kind = 'voided' and request_id = nexus_test.id('r3')), 1,
  'the void is in the letter history, linked to the request');
select is((select status from nexus.letter_request_reject(nexus_test.id('r4'), nexus_test.rv('r4'), 'Tidak sesuai')), 'rejected',
  'F6.6: a Diajukan request can be rejected (no number involved)');
select is(nexus_test.req_letter('r4'), null::uuid, '... and no letter exists for it');
select nexus_test.put('out4', letter_id) from nexus.letter_register('outgoing', 'Sesudah tolak', 'Tujuan Uji', p_letter_date => nexus_test.d(0));
select is(nexus_test.num('out4'), 'PMK/NEX/SK/' || nexus_test.y() || '/007', 'R19/LT-19: the number of the abandoned letter (006) is never reissued');
select ok((select status = 'voided' from nexus.letter_list('outgoing', p_status => 'voided') where letter_id = nexus_test.id('r3_letter')),
  'LT-15a: the voided row stays in the register');
reset role; select nexus_test.login_as(20);
select ok((select (d ->> 'status') = 'rejected' and (d -> 'number_text') = 'null'::jsonb and (d ->> 'note') = 'Kegiatan dibatalkan panitia'
                  and (d ->> 'note_by_name') = 'Test Persona 13'
                  and exists (select 1 from jsonb_array_elements(d -> 'timeline') e
                              where e ->> 'event' = 'number_taken' and e ->> 'number_text' = 'PMK/NEX/SK/' || nexus_test.y() || '/006')
           from nexus.letter_request_detail(nexus_test.id('r3')) d),
  'LT-15a/design 10.3: the requester sees the rejection note, no number plate, and the "Nomor diambil" timeline entry');
select is((select count(*)::int from nexus.letter_my_requests('closed')), 2, 'the closed filter lists both rejected requests');

-- =============================================================================================
-- 13. Caps (L10 b, LT-45): 5 open, 10 new per Jakarta day, per member
-- =============================================================================================
reset role; select nexus_test.login_as(16);
select is(nexus_test.create_n('cap', 5), 5, 'LT-45: a member can have 5 open requests (P-LECT may request, A-LT7)');
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('Perihal', 'Tujuan', 'Keperluan')$$), 'too_many_open_requests',
  'LT-45/L10: the 6th open request is refused');
select is((select count(*)::int from nexus.letter_my_requests('open')), 5, 'the refusal created nothing');
select is((select array[open_count, open_limit, today_count, daily_limit] from nexus.letter_my_request_caps()), array[5, 5, 5, 10],
  'design 3.4: the form''s pre-check shows 5 of 5 open and 5 of 10 today');
select ok((select has_active_period and not can_submit from nexus.letter_my_request_caps()), '... and that submitting is not possible now');
reset role; select nexus_test.login_as(4);
select is((select status from nexus.letter_request_process(nexus_test.id('cap1'), nexus_test.rv('cap1'))), 'processing', 'cap1 processed');
reset role; select nexus_test.login_as(16);
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('Perihal', 'Tujuan', 'Keperluan')$$), 'too_many_open_requests',
  'L10: Diproses counts as open too');
select is((select status from nexus.letter_request_cancel(nexus_test.id('cap2'), nexus_test.rv('cap2'))), 'cancelled', 'cancel one open request');
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('Perihal', 'Tujuan', 'Keperluan')$$), 'no_error',
  'LT-45: with 4 open a new request is allowed again');
select is(nexus_test.create_cancel(10 - 5), 5, 'create (and cancel) up to 10 requests today');
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('Perihal', 'Tujuan', 'Keperluan')$$), 'daily_request_limit',
  'LT-45/L10: the 11th request of the Jakarta day is refused');
select ok((select today_count = 10 and open_count = 4 and not can_submit from nexus.letter_my_request_caps()),
  'design 3.4: the pre-check shows the daily cap reached (10 of 10) with 4 open');
reset role; select nexus_test.logout();
select is((select count(*)::int from nexus.letter_requests where requester_member_id = nexus_test.mid(16)
           and nexus._jakarta_date(created_at) = nexus._lt_today()), 10, 'exactly 10 requests exist for that member today');
select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('Perihal', 'Tujuan', 'Keperluan')$$), 'no_error',
  'the caps are per member: another member is not affected');
select ok((select can_submit and open_limit = 5 and daily_limit = 10 from nexus.letter_my_request_caps()), '... and their pre-check allows submitting');

-- =============================================================================================
-- 14. Dashboard counts, queue views and counts (L11, LT-16, LT-40, LT-49, LT-52, design 11, G9, P15)
-- =============================================================================================
reset role; select nexus_test.logout();
-- A request whose needed-by date already passed (only possible by hand: the form refuses past dates).
insert into nexus.letter_requests (requester_member_id, subject, addressee, purpose, needed_by, period_id, created_at)
values (nexus_test.mid(20), 'Surat terlambat', 'Tujuan', 'Keperluan', nexus_test.d(-3), nexus_test.period(2), now() - interval '2 days')
returning nexus_test.put('rlate', id) as rlate \gset
select count(*) filter (where letter_type = 'incoming' and status = 'active') as in_act,
       count(*) filter (where letter_type = 'outgoing' and status = 'active') as out_act,
       count(*) filter (where letter_type = 'incoming' and status = 'voided') as in_void,
       count(*) filter (where letter_type = 'outgoing' and status = 'voided') as out_void
from nexus.letters where period_id = nexus_test.period(2) \gset
select count(*) filter (where status = 'submitted') as q_sub,
       count(*) filter (where status = 'processing' and letter_id is null) as q_proc,
       count(*) filter (where status = 'processing' and letter_id is not null) as q_file,
       count(*) filter (where status = 'submitted' and requester_member_id <> nexus_test.mid(4)) as q_not4
from nexus.letter_requests \gset
select nexus_test.login_as(4);
select is((select array[incoming_count, outgoing_count, incoming_voided_count, outgoing_voided_count, waiting_request_count]
           from nexus.letter_dashboard_counts()),
          array[:in_act, :out_act, :in_void, :out_void, :q_sub]::int[],
  'LT-40/LT-52/G9: Aktif letters of the active period per type, voided counts, Diajukan requests of all periods');
select is((select period_label from nexus.letter_dashboard_counts()), '2091/2092', 'the card names the active period');
select is((select array[submitted, processing, awaiting_file, open_all_periods, action_needed, process_holder_count]
           from nexus.letter_request_queue_counts()),
          array[:q_sub, :q_proc, :q_file, :q_sub + :q_proc + :q_file, :q_not4, 3]::int[],
  'design 11.1/4.4: counts per view; "Antrean (n)" = Diajukan not my own; 3 process holders');
reset role; select nexus_test.login_as(3);
select is((select action_needed from nexus.letter_request_queue_counts()), 0, 'design 4.4: view_all without process needs no action (no badge)');
select is((select waiting_request_count from nexus.letter_dashboard_counts()), :q_sub, 'P12: BPH (view_all) see the waiting requests line');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of('select * from nexus.letter_dashboard_counts()'), 'permission_required', 'LT-40/A-n1: no card for members without letters.view');
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where default_code = 'D19'), 'test LT-16')
          and nexus.disable_access_rule((select id from nexus.access_rules where default_code = 'D22'), 'test LT-16'), 'D19 and D22 disabled');
select is((select holder_count || ':' || warning from nexus.access_rule_warnings() where permission_key = 'letter_requests.process'), '1:single_holder',
  'LT-16: with one process holder the admin sees the single-holder warning');
reset role; select nexus_test.login_as(4);
select is((select process_holder_count from nexus.letter_request_queue_counts()), 1, 'LT-16/A-n9: the queue knows there is one processor (lone-processor hint)');
reset role; select nexus_test.login_as(1);
select ok(nexus.enable_access_rule((select id from nexus.access_rules where default_code = 'D19'), 'test LT-16 restore')
          and nexus.enable_access_rule((select id from nexus.access_rules where default_code = 'D22'), 'test LT-16 restore'), 'D19 and D22 enabled again');

reset role; select nexus_test.login_as(4);
select ok((select bool_and(status = 'submitted') and count(*) = :q_sub
                  and array_agg(created_at order by row_no) = (select array_agg(c order by c) from unnest(array_agg(created_at)) c)
           from nexus.letter_request_queue()),
  'F6.1: the default view "Menunggu" = Diajukan of all periods, oldest first');
select ok((select is_past_due and days_past_due = 3 from nexus.letter_request_queue() where request_id = nexus_test.id('rlate')),
  'P15: "Lewat tanggal" with the number of days, for secretaries');
select is((select count(*)::int from nexus.letter_request_queue('open_all_periods')), :q_sub + :q_proc + :q_file,
  'A-LT21: "Belum selesai (semua periode)" = Diajukan + Diproses');
select ok((select bool_and(requester_name = 'Test Persona 16') and count(*) = 4 from nexus.letter_request_queue('open_all_periods', p_search => 'persona 16')),
  'design 11.1: search by requester name (case-insensitive)');
select is((select count(*)::int from nexus.letter_request_queue('closed', p_search => 'izin kegiatan')), 1, '... or by Perihal');
select is((select count(*)::int from nexus.letter_request_queue('all', p_from => nexus_test.d(0), p_to => nexus_test.d(0))),
          (select count(*)::int from nexus.letter_request_queue('all', p_page_size => 50)) - 1,
  'design 11.1: the date range filters by the Jakarta submit date (the late request is older)');
select ok((select number_voided and letter_status = 'voided' and number_text = 'PMK/NEX/SK/' || nexus_test.y() || '/004'
           from nexus.letter_request_queue('closed') where request_id = nexus_test.id('r1')),
  'queue: an issued request whose letter was voided shows "Nomor dibatalkan" (letter status and number)');
select ok((select not number_voided and letter_status = 'voided' from nexus.letter_request_queue('closed') where request_id = nexus_test.id('r3')),
  'queue: a rejected request is not "Nomor dibatalkan" (its void is the rejection)');
select ok((select bool_and(letter_status is null or letter_status = 'active') from nexus.letter_request_queue('open_all_periods', p_page_size => 50)),
  'queue: an open request''s letter is always Aktif (no void while Diproses)');
select is(nexus_test.hint_of($$select * from nexus.letter_request_queue('everything')$$), 'invalid_view', 'unknown views are refused');
select is(nexus_test.hint_of($$select * from nexus.letter_request_queue('all', p_from => nexus_test.d(0))$$), 'invalid_dates', 'both dates or none');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_queue(p_search => %L)', repeat('x', 121))), 'search_too_long', 'search max 120');
select is(nexus_test.hint_of('select * from nexus.letter_request_queue(p_page_size => 51)'), 'invalid_page_size', 'page size max 50');
reset role; select nexus_test.login_as(20);
select ok((select (d -> 'is_past_due') = 'null'::jsonb from nexus.letter_request_detail(nexus_test.id('rlate')) d),
  'P15: the requester never sees the "Lewat tanggal" marker');

-- Register list (F1, LT-25, LT-49, A-LT15)
reset role; select nexus_test.login_as(3);
select is((select max(page_size) || ':' || count(*) from nexus.letter_list('incoming', p_period => 'all', p_page_size => 3)), '3:3',
  'A-LT15: server paging (page size given, default 20)');
select is((select max(page) from nexus.letter_list('incoming', p_period => 'all', p_page => 99, p_page_size => 3)),
          (select ceil(max(total_count)::numeric / 3)::int from nexus.letter_list('incoming', p_period => 'all')),
  'a page past the end returns the last page');
select ok((select array_agg(created_at order by row_no) = (select array_agg(c order by c desc) from unnest(array_agg(created_at)) c)
           from nexus.letter_list('incoming')),
  'G8: newest registered first');
select is((select count(*)::int from nexus.letter_list('incoming', p_search => 'sm/' || nexus_test.y() || '/04')), 2,
  'LT-25: search by part of the number, case-insensitive (046, 047)');
select is((select count(*)::int from nexus.letter_list('incoming', p_search => 'PENGIRIM UJI C')), 1, 'LT-25: by counterpart');
select is((select count(*)::int from nexus.letter_list('outgoing', p_search => 'ibadah')), 1, 'LT-25: by Perihal');
select is((select count(*)::int from nexus.letter_list('incoming', p_search => '12/ABC')), 0, 'LT-25: never by other fields (the sender''s own number)');
select is((select count(*)::int from nexus.letter_list('incoming', p_search => '%')), 0, 'LIKE wildcards are literal');
select ok((select bool_and(file_count = 0) and count(*) > 0 from nexus.letter_list('outgoing', p_without_files => true)), 'F1: "Tanpa berkas" filter');
select is((select count(*)::int from nexus.letter_list('incoming', p_year => nexus_test.y()::int, p_period => 'all')),
          (select count(*)::int from nexus.letter_list('incoming', p_period => 'all', p_page_size => 50) where not is_legacy_number),
  'F1: the year filter matches the year in the number (Nomor lama have none)');
select is((select array_agg(number_year) from nexus.letter_year_list('incoming')), array[nexus_test.y()::int], 'year choices for the filter');
select is(nexus_test.hint_of($$select * from nexus.letter_list('incoming', p_period => 'last')$$), 'invalid_period', 'G8: period filter active or all only');
select is(nexus_test.hint_of($$select * from nexus.letter_list('incoming', p_status => 'deleted')$$), 'invalid_status', 'status filter all, active, voided');
select is(nexus_test.hint_of($$select * from nexus.letter_list('incoming', p_year => 1999)$$), 'invalid_year', 'year 2000..2999');

-- =============================================================================================
-- 15. Export and log (F8, LT-36..LT-39, LT-35)
-- =============================================================================================
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.letter_export('csv', 'outgoing')$$), 'permission_required', 'LT-37: P-PLAIN cannot export');
reset role; select nexus_test.login_as(6);
select is(nexus_test.hint_of($$select * from nexus.letter_export('csv', 'outgoing')$$), 'permission_required', 'LT-37: P-SEKDEP cannot export');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.letter_export('docx', 'outgoing')$$), 'invalid_format', 'xlsx, csv or pdf only');
select is(nexus_test.hint_of($$select * from nexus.letter_export('csv', 'memo')$$), 'invalid_type', 'a tab must be chosen');
select is(nexus_test.log_count(), 0, 'LT-39: refused exports wrote no log row');
select ok((select array_agg(number_text order by row_no) from nexus.letter_export('csv', 'outgoing'))
          = (select array_agg(number_text order by row_no) from nexus.letter_list('outgoing', p_page_size => 50)),
  'LT-38: export = the screen rows of the tab, same order');
select ok((select bool_and(total_count = (select count(*) from nexus.letter_list('outgoing', p_page_size => 50))) from nexus.letter_export('xlsx', 'outgoing')),
  'total_count = rows of the full result on every row');
select ok((select status = 'voided' and void_reason = 'Kegiatan dibatalkan panitia' and from_request
           from nexus.letter_export('pdf', 'outgoing') where number_text = 'PMK/NEX/SK/' || nexus_test.y() || '/006'),
  'LT-15a/LT-23/F8.2: voided letters are exported with status and reason, so number gaps are explainable');
select is((select count(*)::int from nexus.letter_export('csv', 'incoming', p_search => 'undangan', p_period => 'all')),
          (select count(*)::int from nexus.letter_list('incoming', p_search => 'undangan', p_period => 'all')),
  'LT-38: the search and filters are applied like on the screen');
select is((select count(*)::int from nexus.letter_export('csv', 'outgoing', p_status => 'voided', p_period => 'all')), 2, 'status filter respected');
reset role; select nexus_test.logout();
select is(nexus_test.log_count(), 5, 'LT-39: one log row per successful export');
select ok((select exporter_member_id = nexus_test.mid(3) and letter_type = 'incoming' and format = 'csv' and period_id = nexus_test.period(2)
                  and (filters ->> 'search_used')::boolean and filters ->> 'period' = 'all' and filters::text !~* 'undangan' and row_count >= 1
           from nexus.letter_export_logs order by id desc offset 1 limit 1),
  'LT-39: log row = exporter from the session, tab, format, filters (no search text), period, count');
select nexus_test.login_as(3);
select throws_ok($$select * from nexus.letter_export_logs$$, '42501', null, 'LT-39: clients cannot read the log directly');
reset role; select nexus_test.logout();
select is(nexus_test.hint_of($$insert into nexus.letter_export_logs (exporter_member_id, letter_type, format, filters, row_count, period_id)
                                values (gen_random_uuid(), 'incoming', 'csv', '{}', 0, gen_random_uuid())$$), 'export_log_direct_insert',
  'LT-39: a hand-written log row is refused');
select is(nexus_test.hint_of('update nexus.letter_export_logs set format = ''pdf'''), 'append_only', 'LT-39: the log cannot be updated');
select is(nexus_test.hint_of('delete from nexus.letter_export_logs'), 'append_only', 'LT-39: ... or deleted');
-- A failing log insert returns no rows (no export without a log row).
create function nexus_test.fail_log() returns trigger language plpgsql as $$ begin raise exception 'log unavailable'; end $$;
create trigger zz_fail before insert on nexus.letter_export_logs for each row execute function nexus_test.fail_log();
select nexus_test.login_as(3);
select is(nexus_test.msg_of($$select * from nexus.letter_export('csv', 'outgoing')$$), 'log unavailable',
  'LT-39: when the log write fails the call fails and returns no data');
reset role; select nexus_test.logout();
drop trigger zz_fail on nexus.letter_export_logs;
select is(nexus_test.log_count(), 5, '... and no log row was written');

-- =============================================================================================
-- 16. RLS per persona on the tables (LT-43, LT-36)
-- =============================================================================================
select count(*) as own11_req from nexus.letter_requests where requester_member_id = nexus_test.mid(11) \gset
select count(*) as own11_hist from nexus.letter_request_history h join nexus.letter_requests r on r.id = h.request_id
  where r.requester_member_id = nexus_test.mid(11) \gset
select count(*) as own11_files from nexus.letter_files f join nexus.letter_requests r on r.id = f.request_id
  where r.requester_member_id = nexus_test.mid(11) \gset
select count(*) as all_letters from nexus.letters \gset
select count(*) as all_req from nexus.letter_requests \gset
select count(*) as visible_files from nexus.letter_files where not is_withdrawn \gset
select count(*) as all_files from nexus.letter_files \gset
select count(*) as all_counters from nexus.letter_number_counters \gset
select nexus_test.login_as(11);
select is((select count(*) from nexus.letter_requests), :own11_req::bigint, 'LT-43: P-PLAIN reads only own requests');
select is((select count(*) from nexus.letter_request_history), :own11_hist::bigint, '... only own timeline rows');
select is((select count(*) from nexus.letter_files), :own11_files::bigint, '... only own attachments (never the issued letter row''s files)');
select is((select count(*)::int from nexus.letters) + (select count(*)::int from nexus.letter_history) + (select count(*)::int from nexus.letter_number_counters)
          + (select count(*)::int from nexus.letter_numbering_settings) + (select count(*)::int from nexus.letter_numbering_changes), 0,
  'LT-43/L9: no register, history, counter or settings row for a member');
select throws_ok($$insert into nexus.letter_request_history (request_id, event, to_status, actor_member_id, period_id)
                   values (nexus_test.id('r1'), 'issued', 'issued', nexus_test.mid(11), nexus_test.period(2))$$, '42501', null,
  'LT-34: history accepts inserts only through the functions');
reset role; select nexus_test.login_as(3);
select is((select count(*) from nexus.letters), :all_letters::bigint, 'LT-43: P-KETUM (letters.view) reads the whole register');
select is((select count(*) from nexus.letter_requests), :all_req::bigint, 'LT-43: ... and every request (view_all)');
select is((select count(*) from nexus.letter_files), :visible_files::bigint, 'A-LT9: ... and every file except withdrawn ones');
select is((select count(*)::int from nexus.letter_number_counters) + (select count(*)::int from nexus.letter_numbering_settings), 0,
  'A-LT12: viewers without manage do not read the numbering tables');
reset role; select nexus_test.login_as(4);
select is((select count(*) from nexus.letter_files), :all_files::bigint, 'A-LT9: managers also read withdrawn files');
select is((select count(*) from nexus.letter_number_counters), :all_counters::bigint, 'A-LT12: managers read the counters');
select throws_ok($$update nexus.letters set subject = 'x'$$, '42501', null, 'LT-34: P-SEKJEN cannot update letters directly');
reset role; select nexus_test.login_as(1);
select is((select count(*)::int from nexus.letters) + (select count(*)::int from nexus.letter_requests) + (select count(*)::int from nexus.letter_files), 0,
  'LT-43/B18: P-ADMIN (no position, no requests) reads no letter, request or file');
select is((select count(*)::int from nexus.letter_numbering_settings), 1, 'L3: the System Admin reads the numbering settings');
select throws_ok($$delete from nexus.letters$$, '42501', null, 'LT-34: P-ADMIN cannot delete letters (no privilege)');
reset role; select nexus_test.login_as(15);
select is((select count(*)::int from nexus.letters) + (select count(*)::int from nexus.letter_requests) + (select count(*)::int from nexus.letter_files)
          + (select count(*)::int from nexus.letter_history) + (select count(*)::int from nexus.letter_request_history)
          + (select count(*)::int from nexus.letter_number_counters) + (select count(*)::int from nexus.letter_numbering_settings), 0,
  'LT-43: P-INACTIVE reads zero rows everywhere');
reset role; select nexus_test.login_as(17);
select is((select count(*)::int from nexus.letters) + (select count(*)::int from nexus.letter_requests) + (select count(*)::int from nexus.letter_files), 0,
  'LT-43: P-UNLINKED reads zero rows');
select is(nexus_test.hint_of('select * from nexus.letter_my_requests()'), 'not_active_member', 'LT-04: P-UNLINKED has no own requests');
reset role; select nexus_test.logout();
set local role anon;
select throws_ok('select * from nexus.letters', '42501', null, 'anon has no access to the schema');
reset role;

-- =============================================================================================
-- 17. Never delete, append-only, guarded columns (LT-34, R17, L5)
-- =============================================================================================
select is(nexus_test.hint_of(format('delete from nexus.letters where id = %L', nexus_test.id('in3'))), 'append_only', 'LT-34/R17: the owner cannot delete a letter');
select is(nexus_test.hint_of(format('delete from nexus.letter_requests where id = %L', nexus_test.id('rc'))), 'append_only', '... nor a request');
select is(nexus_test.hint_of('delete from nexus.letter_files'), 'append_only', '... nor a file record');
select is(nexus_test.hint_of('delete from nexus.letter_number_counters'), 'append_only', '... nor a counter');
select is(nexus_test.hint_of('delete from nexus.letter_numbering_settings'), 'append_only', '... nor the settings');
select is(nexus_test.hint_of('update nexus.letter_history set note = ''x'''), 'append_only', 'the letter history is append-only');
select is(nexus_test.hint_of('delete from nexus.letter_request_history'), 'append_only', 'the request timeline is append-only');
select is(nexus_test.hint_of('delete from nexus.letter_numbering_changes'), 'append_only', 'the numbering history is append-only');
select is(nexus_test.hint_of('truncate nexus.letters cascade'), 'append_only', 'no truncate');
select is(nexus_test.hint_of(format('update nexus.letter_requests set subject = %L where id = %L', 'x', nexus_test.id('cap3'))), 'immutable_column',
  'A-LT10: a submitted request is never edited, not even by hand');
select is(nexus_test.hint_of(format('update nexus.letter_requests set status = %L where id = %L', 'submitted', nexus_test.id('r1'))), 'immutable_column',
  'spec 4.2: a closed request never changes');
select is(nexus_test.hint_of(format('update nexus.letter_requests set status = %L where id = %L', 'issued', nexus_test.id('cap3'))), 'invalid_transition',
  'spec 4.2: Diajukan -> Diterbitkan is not a valid move, whatever writes it');
select is(nexus_test.hint_of(format('update nexus.letter_files set storage_path = storage_path where id = %s', :f_out1)), 'immutable_column',
  'LT-28: a withdrawn file stays withdrawn');
select is(nexus_test.hint_of(format('update nexus.letter_files set original_name = %L where request_id = %L', 'x.pdf', nexus_test.id('r1'))), 'immutable_column',
  'LT-28: a stored file is never replaced or renamed');

-- =============================================================================================
-- 18. Storage policies (private bucket, LT-26..LT-29, spec 4.4, G5). Policy rows only when a storage
--     schema exists; the check functions are tested either way.
-- =============================================================================================
select (select storage_path from nexus.letter_files where id = :f_out1) as withdrawn_path \gset
select (select storage_path from nexus.letter_files where request_id = nexus_test.id('r1') order by id limit 1) as att_r1 \gset
select nexus_test.login_as(11);
select ok(nexus.letter_file_can_upload(nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.pdf'),
  'upload check: any active member may upload into their OWN folder (request attachments)');
select ok(not nexus.letter_file_can_upload(nexus_test.mid(4)::text || '/' || gen_random_uuid()::text || '.pdf'),
  'upload check: never into another member''s folder');
select ok(not nexus.letter_file_can_upload(nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.docx')
          and not nexus.letter_file_can_upload(nexus_test.mid(11)::text || '/../x.pdf')
          and not nexus.letter_file_can_upload(nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.PDF'),
  'LT-26: bad names and types are refused');
select ok(nexus.letter_file_can_read(:'att_r1'), 'read check: the requester reads their own attachment');
reset role; select nexus_test.login_as(15);
select ok(not nexus.letter_file_can_upload(nexus_test.mid(15)::text || '/' || gen_random_uuid()::text || '.pdf')
          and not nexus.letter_file_can_read(:'att_r1'), 'L1: P-INACTIVE can neither upload nor read');
reset role; select nexus_test.login_as(20);
select ok(not nexus.letter_file_can_read(:'att_r1'), 'LT-27: another member cannot read the attachment');
reset role; select nexus_test.login_as(3);
select ok(nexus.letter_file_can_read(:'att_r1'), 'spec 4.4: view_all holders read request attachments');
select ok(not nexus.letter_file_can_read(:'withdrawn_path'), 'A-LT9: a viewer cannot read a withdrawn file');
reset role; select nexus_test.login_as(4);
select ok(nexus.letter_file_can_read(:'withdrawn_path'), 'A-LT9: a manager can');

-- Through the real policies on storage.objects (stub in the throwaway container; Supabase on hosted).
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.sto_val($$select public::text || ':' || coalesce(file_size_limit::text, '-') || ':' || coalesce(array_to_string(allowed_mime_types, ','), '-')
                               from storage.buckets where id = 'nexus-letter-files'$$),
          'false:5242880:application/pdf,image/jpeg,image/png', 'LT-27/L8: the letter bucket is private, 5 MB, PDF/JPG/PNG only')
  else skip('Storage not installed (load tests/support/storage_stub.sql)', 1) end;
select case when nexus_test.has_storage()
  then is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'nexus\_letter%'
           and cmd in ('INSERT', 'SELECT') and coalesce(qual, '') || coalesce(with_check, '') ~ 'nexus-letter-files'), 2,
          'two policies (insert, select), both scoped to the letter bucket; none for update or delete')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto($$insert into storage.buckets (id, name) values ('other-bucket-lt', 'other-bucket-lt')$$), 'ok', 'a second bucket for the isolation test')
  else skip('Storage not installed', 1) end;
select nexus_test.sto_count($$bucket_id = 'nexus-letter-files'$$) as lt_objects_before \gset
select nexus_test.login_as(11);
select gen_random_uuid()::text as up_uuid \gset
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name, metadata) values ('nexus-letter-files', %L, '{"size": 1000, "mimetype": "application/pdf"}')$$,
                                nexus_test.mid(11)::text || '/' || :'up_uuid' || '.pdf')), 'ok',
          'Storage: a member uploads into their own folder')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-letter-files', %L)$$,
                                nexus_test.mid(4)::text || '/' || gen_random_uuid()::text || '.pdf')), '42501',
          'Storage: no upload into another member''s folder')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('other-bucket-lt', %L)$$, 'x.pdf')), '42501',
          'Storage: our policies grant nothing in other buckets')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count(format('name = %L', nexus_test.mid(11)::text || '/' || :'up_uuid' || '.pdf')), 0,
          'LT-29: an unattached upload is not readable as a file, not even by the uploader')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'att_r1')) = 1 and nexus_test.sto_count(format('name = %L', :'r1_file')) = 0,
          'Storage: the requester sees the own attachment, not the issued file of a voided letter (G5)')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto($$delete from storage.objects where bucket_id = 'nexus-letter-files'$$)
          || ':' || nexus_test.sto($$update storage.objects set name = name || '.x' where bucket_id = 'nexus-letter-files'$$),
          'ok:ok', 'LT-28: a client delete or overwrite runs but matches nothing (no delete/update policy)')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count($$bucket_id = 'nexus-letter-files' and name !~ '\.x$'$$), :lt_objects_before + 1,
          'LT-28: ... nothing was deleted or renamed; the one upload is the only addition')
  else skip('Storage not installed', 1) end;
select nexus_test.login_as(20);
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count($$bucket_id = 'nexus-letter-files'$$), 0, 'LT-27: a member without requests or keys sees no file at all')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.login_as(4);
select (select storage_path from nexus.letter_files where letter_id = nexus_test.id('r2_letter') and not is_withdrawn limit 1) as r2_file \gset
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'r2_file')) = 1 and nexus_test.sto_count(format('name = %L', :'withdrawn_path')) = 1,
          'Storage: the requester of r2 (also a manager) sees the issued file; managers see withdrawn files')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.login_as(3);
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'withdrawn_path')) = 0 and nexus_test.sto_count(format('name = %L', :'r1_file')) = 1,
          'Storage: a viewer sees the voided letter''s file but not a withdrawn one')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
set local role anon;
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count($$bucket_id = 'nexus-letter-files'$$), 0, 'Storage: anon sees nothing')
  else skip('Storage not installed', 1) end;
reset role;

-- A-LT13/LT-29: at most 10 unattached uploads per member in 24 hours (P-LECT's folder is empty).
select count(nexus_test.fpath(16)) as flood from generate_series(1, 10) \gset
select nexus_test.login_as(16);
select case when nexus_test.has_storage()
  then ok(not nexus.letter_file_can_upload(nexus_test.mid(16)::text || '/' || gen_random_uuid()::text || '.pdf'),
          'LT-29: no 11th unattached upload within 24 hours')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-letter-files', %L)$$,
                                nexus_test.mid(16)::text || '/' || gen_random_uuid()::text || '.pdf')), '42501',
          'LT-29: ... enforced by the Storage policy')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
select nexus_test.sto(format($$update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'nexus-letter-files' and name like %L$$,
                             nexus_test.mid(16)::text || '/%')) as sto_result \gset
select nexus_test.login_as(16);
select case when nexus_test.has_storage()
  then ok(nexus.letter_file_can_upload(nexus_test.mid(16)::text || '/' || gen_random_uuid()::text || '.pdf'),
          'A-LT13: uploads older than 24 hours no longer count')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
select nexus_test.sto(format($$update storage.objects set created_at = now() - interval '23 hours' where bucket_id = 'nexus-letter-files' and name like %L$$,
                             nexus_test.mid(16)::text || '/%')) as sto_result \gset
select nexus_test.login_as(16);
select case when nexus_test.has_storage()
  then ok(not nexus.letter_file_can_upload(nexus_test.mid(16)::text || '/' || gen_random_uuid()::text || '.pdf'),
          'A-LT13: uploads 23 hours old still count (window 24 hours)')
  else skip('Storage not installed', 1) end;
select ok(nexus.letter_file_can_upload(nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.pdf') = false,
  '(the check only answers for the caller''s own folder)');

-- Migration guard: never changes an existing bucket.
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._lt_ensure_letter_bucket()'), 'no_error', 'M2 pattern: re-running with an identical bucket is a no-op')
  else is(nexus._lt_ensure_letter_bucket(), 'skipped', 'without Storage the guard skips') end;
select nexus_test.sto($$update storage.buckets set public = true where id = 'nexus-letter-files'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._lt_ensure_letter_bucket()'), 'bucket_conflict', 'an existing PUBLIC bucket stops the migration')
  else skip('Storage not installed', 1) end;
select nexus_test.sto($$update storage.buckets set public = false, file_size_limit = 10485760 where id = 'nexus-letter-files'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._lt_ensure_letter_bucket()'), 'bucket_conflict', 'a different size limit stops it')
  else skip('Storage not installed', 1) end;
select nexus_test.sto($$update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/png', 'application/pdf', 'image/jpeg'] where id = 'nexus-letter-files'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._lt_ensure_letter_bucket()'), 'no_error', 'the same types in another order are accepted')
  else skip('Storage not installed', 1) end;
select nexus_test.sto($$update storage.buckets set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'text/html'] where id = 'nexus-letter-files'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._lt_ensure_letter_bucket()'), 'bucket_conflict', 'different file types stop it')
  else skip('Storage not installed', 1) end;
savepoint unscoped_policy;
select nexus_test.sto($$create policy zz_test_unscoped on storage.objects for select to authenticated using (true)$$) as sto_result \gset
select nexus_test.hint_of('select nexus._lt_ensure_letter_bucket()') as unscoped_hint \gset
rollback to savepoint unscoped_policy;
release savepoint unscoped_policy;
select case when nexus_test.has_storage()
  then is(:'unscoped_hint'::text, 'storage_policy_unscoped', 'a Storage policy without a bucket_id condition stops the migration')
  else skip('Storage not installed', 1) end;

-- =============================================================================================
-- 19. Period switch (F9, L7, LT-30, A-LT20, R6), no active period (R7, LT-31), deactivation (R8, LT-32)
-- =============================================================================================
select nexus_test.login_as(11);
select nexus_test.req('rp_a', 'Surat periode lama A');
select nexus_test.req('rp_b', 'Surat periode lama B');
reset role; select nexus_test.login_as(20);
select nexus_test.req('rp_c', 'Surat periode lama C');
reset role; select nexus_test.login_as(4);
select is((select status from nexus.letter_request_process(nexus_test.id('rp_a'), nexus_test.rv('rp_a'))), 'processing', 'rp_a processed (no number)');
select is((select status from nexus.letter_request_process(nexus_test.id('rp_b'), nexus_test.rv('rp_b'))), 'processing', 'rp_b processed');
select is((select number_text from nexus.letter_request_take_number(nexus_test.id('rp_b'), nexus_test.rv('rp_b'))), 'PMK/NEX/SK/' || nexus_test.y() || '/008',
  'rp_b number taken BEFORE the switch');
select nexus_test.put('rp_b_letter', nexus_test.req_letter('rp_b'));
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(3);
insert into public.assignments (member_id, org_unit_id, position_id, period_id) values
  (nexus_test.mid(6), nexus_test.unit('BPH PMK ITERA'), nexus_test.pos('bph', 'Sekretaris Jenderal'), nexus_test.period(3));

select nexus_test.login_as(4);
select is(nexus_test.hint_of(format('select * from nexus.letter_request_take_number(%L, %s)', nexus_test.id('rp_a'), nexus_test.rv('rp_a'))), 'permission_required',
  'LT-30/AC-38: the previous secretary has no right after the switch, without logging out');
select is(nexus_test.hint_of($$select * from nexus.letter_list('outgoing')$$), 'permission_required', 'LT-04/AC-40: ... and cannot read the register');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.letter_list('outgoing')$$), 'permission_required', 'LT-04: last period''s BPH no longer reads it');
reset role; select nexus_test.login_as(6);
select is(nexus_test.keys(), array['letter_requests.process', 'letter_requests.view_all', 'letters.export', 'letters.manage', 'letters.view'],
  'F9.1: the new Sekretaris Jenderal holds the keys at once');
select is((select number_text from nexus.letter_request_take_number(nexus_test.id('rp_a'), nexus_test.rv('rp_a'))), 'PMK/NEX/SK/' || nexus_test.y() || '/009',
  'LT-30/R6: an open old-period request gets a number; the yearly sequence does not reset at a period switch');
select ok((select l.period_id = nexus_test.period(3) and r.period_id = nexus_test.period(2)
           from nexus.letter_requests r join nexus.letters l on l.id = r.letter_id where r.id = nexus_test.id('rp_a')),
  'A-LT20: a number taken after the switch creates its letter in the ACTIVE period, linked to the old request');
select is((select status from nexus.letter_request_issue(nexus_test.id('rp_b'), nexus_test.rv('rp_b'), nexus_test.rlv('rp_b'), 'Surat periode lama B', 'Rektorat Uji',
                                                          nexus_test.d(0), nexus_test.files(6, 1))), 'issued',
  'LT-30/A-LT20: a letter whose number was taken before the switch still receives its final file at Terbitkan');
select ok((select period_id = nexus_test.period(2) and (select count(*) from nexus.letter_files f where f.letter_id = l.id) = 1
           from nexus.letters l where l.id = nexus_test.id('rp_b_letter')),
  'A-LT20: ... and keeps its old period');
select is((select status from nexus.letter_request_process(nexus_test.id('rp_c'), nexus_test.rv('rp_c'))), 'processing', 'LT-30: an old Diajukan request can be processed');
select is(nexus_test.hint_of(format('select * from nexus.letter_update(%L, %s, %L, %L, p_letter_date => nexus_test.d(0))', nexus_test.id('out2'), nexus_test.lv('out2'), 'x', 'y')),
  'closed_period', 'LT-30/L7: a letter of the previous period is read-only (edit)');
select is(nexus_test.hint_of(format('select * from nexus.letter_void(%L, %s, %L)', nexus_test.id('out2'), nexus_test.lv('out2'), 'x')),
  'closed_period', 'L7: ... (void)');
select is(nexus_test.hint_of(format('select * from nexus.letter_add_files(%L, %s, %L)', nexus_test.id('out2'), nexus_test.lv('out2'), nexus_test.files(6, 1))),
  'closed_period', 'L7: ... (files)');
select is(nexus_test.hint_of(format('select * from nexus.letter_withdraw_file(%s, %s, %L)',
                                    (select id from nexus.letter_files where letter_id = nexus_test.id('rp_b_letter')), nexus_test.lv('rp_b_letter'), 'x')),
  'closed_period', 'L7: a closed old-period item stays read-only after its request was issued');
select ok((select not (d ->> 'is_active_period')::boolean and not (d -> 'actions' ->> 'can_edit')::boolean and not (d -> 'actions' ->> 'can_void')::boolean
           from nexus.letter_detail(nexus_test.id('out2')) d),
  'design 6.2: the detail says "Hanya bisa dibaca" (no buttons)');
select is((select count(*)::int from nexus.letter_list('outgoing')), 1, 'F1: the default period filter shows only the active period''s letters');
select ok((select count(*) > 1 from nexus.letter_list('outgoing', p_period => 'all')), 'F1/L8: "Semua periode" shows the old letters, readable');
select ok((select period_label = '2091/2092' and row_no = 1 from nexus.letter_request_queue('open_all_periods') where request_id = (
             select r.id from nexus.letter_requests r where r.status in ('submitted', 'processing') order by r.created_at limit 1)),
  'A-LT21: the handover list shows open requests of every period, oldest period first');
select ok((select count(*) = 1 and bool_and(q.period_total_count > 1 and q.period_total_count =
                    (select count(*) from nexus.letter_requests r where r.period_id = q.period_id and r.status in ('submitted', 'processing')))
           from nexus.letter_request_queue('open_all_periods', p_page_size => 1) q),
  'design 11.3: the period group count covers the whole result, not only the page');
select ok((select bool_and(q.total_count = q.period_total_count) from nexus.letter_request_queue('closed', p_search => 'izin kegiatan') q),
  '... and follows the filters (one period, one row)');
select is((select count(*)::int from nexus.letter_request_queue('all')), 0, 'design 11.1: "Semua" = the active period only (nothing yet)');
select ok((select outgoing_count = 1 and period_label = '2092/2093' from nexus.letter_dashboard_counts()), 'L11: the card counts the new period');
reset role; select nexus_test.login_as(11);
select ok((select count(*) >= 3 from nexus.letter_my_requests()), 'LT-04/L9: the requester still reads their old requests');
select nexus_test.req('rp_new', 'Surat periode baru');
select is((select period_id from nexus.letter_requests where id = nexus_test.id('rp_new')), nexus_test.period(3), 'F9: a new request belongs to the new period');
reset role; select nexus_test.login_as(14);
select is(nexus_test.hint_of($$select * from nexus.letter_list('incoming')$$), 'permission_required', 'LT-04: P-OLD cannot read the register');
select nexus_test.req('rp_old', 'Surat dari mantan sekjen');
select is((select count(*)::int from nexus.letter_my_requests()), 1, 'LT-04: P-OLD reads their own request');

-- No active period (R7, R11, LT-31)
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.letter_request_create('Perihal', 'Tujuan', 'Keperluan')$$), 'no_active_period',
  'LT-31/R7: no request without an active period');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_cancel(%L, %s)', nexus_test.id('rp_new'), nexus_test.rv('rp_new'))), 'no_active_period',
  'no transition without an active period');
select ok((select count(*) > 0 from nexus.letter_my_requests()), 'LT-31/L9: own requests stay readable');
select ok(not nexus.letter_file_can_upload(nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.pdf'), 'no upload without an active period');
select ok((select not has_active_period and not can_submit from nexus.letter_my_request_caps()), 'design 3.4: the pre-check says no active period');
reset role; select nexus_test.login_as(6);
select is(nexus_test.hint_of(format('select * from nexus.letter_request_process(%L, %s)', nexus_test.id('rp_new'), nexus_test.rv('rp_new'))), 'permission_required',
  'R7/E4: officers'' rights match nothing without an active period');
select is(nexus_test.hint_of($$select * from nexus.letter_register('incoming', 'x', 'y', p_received_date => nexus_test.d(0))$$), 'permission_required',
  'LT-31: no registration either');
reset role; select nexus_test.login_as(1);
select ok((nexus.letter_numbering_settings() ->> 'can_edit')::boolean, 'AC-43: the System Admin still opens the numbering settings');
select nexus_test.counter('outgoing') as out_last \gset
select is((select next_seq from nexus.letter_numbering_set_next('outgoing', nexus_test.y()::int, :out_last + 2, 'Uji tanpa periode')),
          :out_last + 2, 'AC-43: ... and can set the next number (one number skipped on purpose)');
select is((select period_id from nexus.letter_numbering_changes order by id desc limit 1), null::uuid, '... logged without a period');
reset role; select nexus_test.logout();
update public.periods set is_active = true where id = nexus_test.period(3);

-- Deactivated requester (R8, LT-32, G12)
update public.members set is_active = false where id = nexus_test.mid(20);
select nexus_test.login_as(20);
select is(nexus_test.hint_of('select * from nexus.letter_my_requests()'), 'not_active_member', 'LT-32/L1: a deactivated member gets nothing');
select is(nexus_test.hint_of(format('select nexus.letter_request_detail(%L)', nexus_test.id('rp_c'))), 'not_active_member', '... not even their own detail');
select is(nexus_test.hint_of('select * from nexus.letter_my_request_caps()'), 'not_active_member', '... nor the caps pre-check');
reset role; select nexus_test.login_as(6);
select ok((select requester_name = 'Test Persona 20' and not requester_is_active from nexus.letter_request_queue('processing') where request_id = nexus_test.id('rp_c')),
  'LT-32/G12: the request keeps the requester''s name; the secretary sees "no longer active"');
select is((select status from nexus.letter_request_reject(nexus_test.id('rp_c'), nexus_test.rv('rp_c'), 'Pemohon sudah tidak aktif')), 'rejected',
  'R8: the request of a deactivated requester can still be rejected');
select ok((select status = 'issued' from nexus.letter_requests where id = nexus_test.id('r1')), 'LT-32: issued requests stay as they are');
reset role; select nexus_test.logout();
update public.members set is_active = true where id = nexus_test.mid(20);

-- =============================================================================================
-- 20. Terbitkan never silently overwrites a register edit made while the request is Diproses (D4)
--     (period 3 is active; P-SEKDEP (6) is the Sekretaris Jenderal there)
-- =============================================================================================
select nexus_test.login_as(11);
select nexus_test.req('r6', 'Surat uji versi');
reset role; select nexus_test.login_as(6);
select is((select status from nexus.letter_request_process(nexus_test.id('r6'), nexus_test.rv('r6'))), 'processing', 'r6 processed');
select ok((select number_text is not null from nexus.letter_request_take_number(nexus_test.id('r6'), nexus_test.rv('r6'))), 'r6 number taken');
select nexus_test.put('r6_letter', nexus_test.req_letter('r6'));
select ok((select (d -> 'letter' ->> 'subject') = 'Surat uji versi' and (d -> 'letter' ->> 'counterpart') = 'Rektorat Uji'
                  and (d -> 'letter' ->> 'status') = 'active' and (d -> 'letter' ->> 'file_count')::int = 0
                  and (d -> 'letter' ->> 'letter_date')::date = nexus_test.d(0)
                  and (d -> 'letter' ->> 'version')::int = nexus_test.lv('r6_letter')
                  and (d -> 'letter' ->> 'number_text') = nexus_test.num('r6_letter')
           from nexus.letter_request_detail(nexus_test.id('r6')) d),
  'the request detail returns the register row''s CURRENT values and version (Terbitkan prefills from them)');
select nexus_test.rlv('r6') as r6_lv \gset
select ok((select changed from nexus.letter_update(nexus_test.id('r6_letter'), nexus_test.lv('r6_letter'), 'Surat uji versi (diperbaiki)',
                                                   'Rektorat Uji', nexus_test.d(0))),
  'D4: the letter is corrected through the register while the request is Diproses');
select is((nexus.letter_request_detail(nexus_test.id('r6')) -> 'letter' ->> 'subject'), 'Surat uji versi (diperbaiki)', '... and the detail shows the correction');
select is(nexus_test.hint_of(format('select * from nexus.letter_request_issue(%L, %s, %s, %L, %L, nexus_test.d(0), %L)',
                                    nexus_test.id('r6'), nexus_test.rv('r6'), :r6_lv, 'Surat uji versi', 'Rektorat Uji', nexus_test.files(6, 1))),
  'state_changed', 'Terbitkan with the version loaded before the register edit is refused (no silent overwrite)');
select is(nexus_test.detail_of(format('select * from nexus.letter_request_issue(%L, %s, %s, %L, %L, nexus_test.d(0), %L)',
                                      nexus_test.id('r6'), nexus_test.rv('r6'), :r6_lv, 'Surat uji versi', 'Rektorat Uji', nexus_test.files(6, 1))),
  'letter', '... (detail = letter, so the screen can say the register row changed)');
select is(nexus_test.rs('r6') || ':' || nexus_test.ls('r6_letter'), 'processing:active', '... and nothing changed');
select is((select status from nexus.letter_request_issue(nexus_test.id('r6'), nexus_test.rv('r6'), nexus_test.rlv('r6'),
                                                          nexus.letter_request_detail(nexus_test.id('r6')) -> 'letter' ->> 'subject', 'Rektorat Uji',
                                                          nexus_test.d(0), nexus_test.files(6, 1))), 'issued',
  'Terbitkan with the current version (prefilled from the register row) succeeds');
select is((select subject from nexus.letters where id = nexus_test.id('r6_letter')), 'Surat uji versi (diperbaiki)', '... and the register edit is kept');
reset role; select nexus_test.login_as(11);
select ok((select (d -> 'letter') = 'null'::jsonb and (d ->> 'number_text') is not null from nexus.letter_request_detail(nexus_test.id('r6')) d),
  'the requester gets the number but not the register row''s internal values');

select * from finish();
rollback;
