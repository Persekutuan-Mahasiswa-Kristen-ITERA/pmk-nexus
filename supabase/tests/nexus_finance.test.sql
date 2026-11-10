-- pgTAP tests for the Finance (Keuangan) module:
--   20261111200000_nexus_finance.sql          (tables, guards, RLS, functions, export)
--   20261111200100_nexus_finance_storage.sql  (private bucket nexus-finance-proofs + Storage policies)
-- Spec: docs/modules/finance.md (approved 2026-11-09, D-028; K1 a .. K6 a): sections 2-5, 8, 11 (FN-01..FN-40).
-- Finance is SENSITIVE: every persona without a finance key must see zero rows everywhere.
--
-- LOCAL / THROWAWAY DATABASE ONLY. Same guards as the other files: it refuses to run without
-- nexus.allow_destructive_tests = 'yes', stops if ANY account or member has a non-test email, and stops
-- on the NEXUS dev stack (@nexus.test accounts). Everything is rolled back.
--   PGOPTIONS='-c nexus.allow_destructive_tests=yes' psql "<throwaway url>" -X -At -f supabase/tests/nexus_finance.test.sql
-- Storage policy tests run only when a storage schema exists (tests/support/storage_stub.sql loaded
-- before the migrations); otherwise they are reported as skipped.
--
-- Personas (auth uid 10000000-...-NN, member id 20000000-...-NN), as in the other files:
--    1 P-ADMIN (admin, no position)      2 P-SUPER (super_admin, no position)
--    3 P-KETUM   4 P-SEKJEN   19 P-SEKUM1 (BPH, view + export, K1 a)
--    5 P-BEND (Bendahara Umum 1)   12 P-BEND-SEK (Bendahara Umum 2 + Sekretaris Departemen Talenta)
--    6 P-SEKDEP   7 P-KADEP-OPS   8 P-STAFF-LOG   10 P-STAFF-PUB   20 P-KADIV (Kepala Divisi Logistik)
--   11 P-PLAIN (becomes Bendahara Umum 1 of period 3 in section 14)
--   14 P-OLD = Bendahara Umum 1 of the PREVIOUS period (2090/2091) only
--   15 P-INACTIVE (Sekretaris Umum 2, deactivated)   16 P-LECT   17 P-UNLINKED (no member row)
-- Periods: 1 = 2090/2091 (active first, P-OLD records there), 2 = 2091/2092 (main), 3 = 2092/2093 (switch).

\set ON_ERROR_STOP on
begin;

-- W1 guard (see tests/README.md).
do $$
begin
  if coalesce(current_setting('nexus.allow_destructive_tests', true), '') <> 'yes' then
    raise exception 'nexus_finance.test.sql writes test rows into PI-CORE tables: local throwaway database only. Set nexus.allow_destructive_tests=yes (see supabase/tests/README.md) to run it.';
  end if;
end
$$;

-- Data guard (security review M1).
do $$
begin
  if exists (select 1 from auth.users u where u.email is null or u.email !~* '@(example\.test|nexus\.test)$')
     or exists (select 1 from public.members m where m.email is not null and m.email !~* '@(example\.test|nexus\.test)$') then
    raise exception 'nexus_finance.test.sql: found a non-test email address, so this is NOT a throwaway local database. Nothing was written.';
  end if;
end
$$;

-- Dev-stack guard (review L5).
do $$
begin
  if exists (select 1 from auth.users u where u.email ~* '@nexus\.test$')
     or exists (select 1 from public.members m where m.email ~* '@nexus\.test$') then
    raise exception 'nexus_finance.test.sql: found the NEXUS dev stack seed accounts (@nexus.test). Run it only in a fresh throwaway container (see supabase/tests/README.md). Nothing was written.';
  end if;
end
$$;

-- Fresh-install guard: KAS numbers and counts below assume an empty ledger (the counter is a table row,
-- so it is rolled back with everything else and the file can run repeatedly in the same container).
do $$
begin
  if exists (select 1 from nexus.finance_entries) or exists (select 1 from nexus.finance_export_logs)
     or exists (select 1 from nexus.finance_counter where last_value <> 0) then
    raise exception 'nexus_finance.test.sql: finance entries, export-log rows or a used counter already exist; use a fresh throwaway container. Nothing was written.';
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
create function nexus_test.es(p_name text) returns text language sql stable security definer set search_path = ''
as $$ select e.status from nexus.finance_entries e where e.id = nexus_test.id(p_name) $$;
create function nexus_test.en(p_name text) returns text language sql stable security definer set search_path = ''
as $$ select e.number_text from nexus.finance_entries e where e.id = nexus_test.id(p_name) $$;
create function nexus_test.counter() returns bigint language sql stable security definer set search_path = ''
as $$ select c.last_value from nexus.finance_counter c $$;
create function nexus_test.entry_count() returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from nexus.finance_entries $$;
create function nexus_test.log_count() returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from nexus.finance_export_logs $$;
create function nexus_test.d(n int) returns date language sql stable
as $$ select (now() at time zone 'Asia/Jakarta')::date + n $$;
create function nexus_test.has_storage() returns boolean language sql stable
as $$ select to_regclass('storage.objects') is not null $$;
-- A stored proof object in the caller's folder (Storage stub only; returns just the path otherwise).
create function nexus_test.fpath(n int, p_ext text default 'jpg', p_size bigint default 300000, p_mime text default null)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v text := nexus_test.mid(n)::text || '/' || gen_random_uuid()::text || '.' || p_ext;
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)'
      using 'nexus-finance-proofs', v,
            jsonb_build_object('size', p_size, 'mimetype',
                               coalesce(p_mime, case p_ext when 'pdf' then 'application/pdf' when 'png' then 'image/png' else 'image/jpeg' end));
  end if;
  return v;
end
$$;
create function nexus_test.files(n int, k int) returns jsonb language sql volatile
as $$ select coalesce(jsonb_agg(jsonb_build_object('path', nexus_test.fpath(n), 'name', 'nota-' || g || '.jpg')), '[]'::jsonb)
      from generate_series(1, k) g $$;
create function nexus_test.file1(p_path text, p_name text default 'nota.jpg') returns jsonb language sql immutable
as $$ select jsonb_build_array(jsonb_build_object('path', p_path, 'name', p_name)) $$;
-- Which finance keys the caller holds (finance keys have scope "all" only).
create function nexus_test.keys() returns text language sql stable
as $$ select concat_ws(' | ',
                       case when nexus.has_permission('finance.view') then 'view' else '-' end,
                       case when nexus.has_permission('finance.manage') then 'manage' else '-' end,
                       case when nexus.has_permission('finance.export') then 'export' else '-' end) $$;
-- Records an entry as the current caller (fresh submit key) and remembers its id.
create function nexus_test.rec(p_name text, p_type text, p_amount text, p_desc text default 'Transaksi uji',
                               p_files jsonb default null, p_corrects uuid default null, p_day int default -1,
                               p_notes text default null) returns uuid
language sql volatile
as $$ select nexus_test.put(p_name, (select entry_id from nexus.finance_entry_record(gen_random_uuid(), p_type, nexus_test.d(p_day),
                                                                                     p_amount, p_desc, p_notes, p_corrects, p_files))) $$;
-- Totals "opening/income/expense/balance" of a period as the caller sees them (null = active period).
create function nexus_test.tot(p_period uuid default null) returns text language sql stable
as $$ select opening_amount || '/' || income_total || '/' || expense_total || '/' || balance from nexus.finance_summary(p_period) $$;
create function nexus_test.amount_hint(p_amount text) returns text language sql volatile
as $$ select nexus_test.hint_of(format('select * from nexus.finance_entry_record(gen_random_uuid(), %L, nexus_test.d(0), %L, %L)',
                                       'income', p_amount, 'x')) $$;
-- Rows of every finance table the caller can see (RLS), summed.
create function nexus_test.rls_total() returns int language sql stable
as $$ select (select count(*)::int from nexus.finance_entries) + (select count(*)::int from nexus.finance_entry_files)
           + (select count(*)::int from nexus.finance_entry_history) + (select count(*)::int from nexus.finance_counter) $$;
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
-- Fixtures (as postgres). Period 1 is active first: P-OLD keeps the books of 2090/2091.
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
update public.periods set is_active = true where id = nexus_test.period(1);

insert into public.assignments (member_id, org_unit_id, position_id, period_id)
select nexus_test.mid(v.n), nexus_test.unit(v.unit_name), nexus_test.pos(v.unit_type, v.position_name), nexus_test.period(v.p)
from (values
  ( 3, 'BPH PMK ITERA',          'bph',        'Ketua Umum',            2),
  ( 4, 'BPH PMK ITERA',          'bph',        'Sekretaris Jenderal',   2),
  ( 5, 'BPH PMK ITERA',          'bph',        'Bendahara Umum 1',      2),
  ( 6, 'Departemen Internal',    'department', 'Sekretaris Departemen', 2),
  ( 7, 'Departemen Operasional', 'department', 'Kepala Departemen',     2),
  ( 8, 'Logistik',               'division',   'Staff',                 2),
  (10, 'Pubdok',                 'division',   'Staff',                 2),
  (12, 'BPH PMK ITERA',          'bph',        'Bendahara Umum 2',      2),
  (12, 'Departemen Talenta',     'department', 'Sekretaris Departemen', 2),
  (14, 'BPH PMK ITERA',          'bph',        'Bendahara Umum 1',      1),
  (15, 'BPH PMK ITERA',          'bph',        'Sekretaris Umum 2',     2),
  (19, 'BPH PMK ITERA',          'bph',        'Sekretaris Umum 1',     2),
  (20, 'Logistik',               'division',   'Kepala Divisi',         2)
) as v(n, unit_name, unit_type, position_name, p);
update public.members set is_active = false where id = nexus_test.mid(15);

select is((select count(*)::int from public.assignments where member_id::text like '20000000-%'), 13,
  'fixtures: 13 persona assignments created (PI-CORE names match the test)');

-- =============================================================================================
-- 1. Structure, privileges, catalog (FN-05, FN-09, FN-13, FN-14, FN-34, FN-35, K2, K4, K6)
-- =============================================================================================
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'FN-35: RLS is enabled on every nexus table');
select is((select count(*)::int from pg_tables where schemaname = 'nexus'
           and tablename in ('finance_counter', 'finance_entries', 'finance_entry_files', 'finance_entry_history', 'finance_export_logs')), 5,
  'the 5 finance tables exist');
select is((select count(*)::int from pg_policies where schemaname = 'nexus' and tablename like 'finance%' and cmd <> 'SELECT'), 0,
  'FN-35: SELECT policies only (no insert, update or delete policy)');
select is((select count(*)::int from pg_policies where schemaname = 'nexus' and tablename like 'finance%' and roles <> '{authenticated}'), 0,
  'every finance policy is for authenticated only (anon gets none)');
select is((select count(*)::int from pg_policies where schemaname = 'nexus' and tablename like 'finance%'), 4,
  'four SELECT policies (entries, files, history, counter)');
select is((select count(*)::int from pg_policies where schemaname = 'nexus' and tablename = 'finance_export_logs'), 0,
  'FN-31/A-FN15: the export log has no policy at all');
select ok(not has_table_privilege('authenticated', 'nexus.finance_export_logs', 'select'), 'FN-31: ... and no client grant');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p')
             and (has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')
                  or has_table_privilege('service_role', c.oid, 'insert, update, delete, truncate')
                  or has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate'))), 0,
  'FN-35/W2: no client role writes any nexus table directly; anon cannot even read one');
select ok((select bool_and(has_table_privilege('service_role', format('nexus.%I', t), 'select'))
           from unnest(array['finance_counter', 'finance_entries', 'finance_entry_files', 'finance_entry_history', 'finance_export_logs']) t),
  'service_role may only SELECT the finance tables (same as the other modules)');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind = 'S' and c.relname like 'finance%'
             and (has_sequence_privilege('authenticated', c.oid, 'usage, select, update')
                  or has_sequence_privilege('anon', c.oid, 'usage, select, update')
                  or has_sequence_privilege('service_role', c.oid, 'usage, select, update'))), 0,
  'no client role can use a finance sequence');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'finance\_%'), 11, 'module API has 11 finance_* functions');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like 'finance\_%'
             and (not has_function_privilege('authenticated', p.oid, 'execute')
                  or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute')
                  or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                  or not p.prosecdef
                  or not coalesce(p.proconfig @> array['search_path=""'], false))), 0,
  'module API: SECURITY DEFINER, empty search_path, EXECUTE for authenticated only (not anon, service_role, PUBLIC)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like '\_fn\_%'
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'internal _fn_* helpers are not executable by any client role');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'nexus' and p.proname ~ '^finance_.*(update|edit|delete|remove|purge|restore|unvoid|approve|verify)'),
  'K2 a/K6 a/FN-13/FN-14: no edit, delete, restore or approval function exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus'
             and p.proname in ('finance_entry_record', 'finance_entry_void', 'finance_entry_add_proof', 'finance_entry_withdraw_proof')
             and p.proargnames && array['p_period_id', 'p_member_id', 'p_created_by', 'p_creator', 'p_entry_no', 'p_number_text', 'p_status']), 0,
  'FN-22/A-FN2: no write function lets a client give a period, member, number or status');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'nexus' and table_name like 'finance%'
             and data_type in ('real', 'double precision', 'numeric', 'money')), 0,
  'FN-09: no floating-point, numeric or money column in any finance table');
select is((select data_type from information_schema.columns
           where table_schema = 'nexus' and table_name = 'finance_entries' and column_name = 'amount'), 'bigint',
  'FN-09: the amount is a whole-number column');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname like 'finance\_%' or p.proname like '\_fn\_%')
             and exists (select 1 from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]) || p.prorettype) t
                         where t in ('float4'::regtype, 'float8'::regtype, 'numeric'::regtype, 'money'::regtype))), 0,
  'FN-09: no finance function takes or returns float, numeric or money');
select is((select count(*)::int from information_schema.columns c
           where c.table_schema = 'nexus' and c.table_name like 'finance%' and c.column_name ~* '(email|phone|nim|nip|whatsapp|user_id)'), 0,
  'FN-34/L4: no finance table has a contact, identity-number or auth column');
select ok(not exists (select 1 from information_schema.columns
                      where table_schema = 'nexus' and table_name like 'finance%' and column_name ~* '(account|rekening|bank)'),
  'K4 a: one cash pool (no account column)');
select ok(not exists (select 1 from information_schema.columns
                      where table_schema = 'nexus' and table_name like 'finance%' and column_name ~* '(approv|verif|balance)'),
  'K6 a / spec 4.1: no approval or verification column, and no stored balance');
select ok(not exists (select 1 from information_schema.columns
                      where table_schema = 'nexus' and table_name = 'finance_export_logs' and column_name ~* '(amount|total|saldo)'),
  'FN-31: the export log has no amount column');
select is(nexus_test.out_cols('nexus.finance_summary(uuid)'),
          array['period_id', 'period_label', 'is_active_period', 'starts_on', 'ends_on', 'opening_amount', 'has_opening',
                'opening_entry_id', 'income_total', 'expense_total', 'balance', 'entry_count', 'voided_count',
                'without_proof_count', 'previous_period_id', 'previous_period_label', 'previous_closing_balance'],
  'finance_summary: period totals plus the K3 opening hint (previous closing balance)');
select is(nexus_test.out_cols('nexus.finance_export(text,uuid,text,text,date,date,boolean,boolean)'),
          array['row_no', 'number_text', 'entry_date', 'entry_type', 'description', 'notes', 'amount', 'status', 'void_reason',
                'corrects_number_text', 'has_proof', 'created_by_name', 'created_at', 'period_label', 'summary_opening',
                'summary_income', 'summary_expense', 'summary_balance', 'total_count'],
  'spec 8: export columns (summary per row, proof yes/no, no file path or link) ending with total_count');
select ok((select bool_and(p.provolatile = 'v') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname in ('finance_entry_record', 'finance_entry_void', 'finance_entry_add_proof',
                                                       'finance_entry_withdraw_proof', 'finance_export')),
  'exports and writes are VOLATILE');
select ok((select bool_and(p.provolatile = 's') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname in ('finance_period_list', 'finance_summary', 'finance_entry_list', 'finance_entry_detail')),
  'reads are STABLE');
select is((select count(*)::int from nexus.permissions), 22, 'no new permission key (22 keys)');
select ok((select count(*) = 3 and bool_and(is_sensitive and not allow_baseline) from nexus.permissions where key like 'finance.%'),
  'L12: the three finance keys are sensitive and can never be baseline');
select ok((select description ~ 'never edited' and description ~ 'void' from nexus.permissions where key = 'finance.manage'),
  'K2 a: the finance.manage text says record, void, correct, never edit');
select is((select string_agg(default_code || ':' || role_key || ':' || permission_key || ':' || scope, ',' order by default_code)
           from nexus.access_rules where permission_key like 'finance.%' and is_enabled),
          'D02:bph:finance.view:all,D03:bph:finance.export:all,D24:bendahara:finance.manage:all,D25:bendahara:finance.export:all',
  'K1 a: the finance rules are exactly D02, D03, D24, D25 (unchanged)');
select ok((select count(*) = 1 and bool_and(last_value = 0) from nexus.finance_counter), 'A-FN2: one counter row, starting at 0');

-- =============================================================================================
-- 2. Period 1 (2090/2091): P-OLD keeps the books. FN-10 example totals.
-- =============================================================================================
select nexus_test.login_as(14);
select is(nexus_test.keys(), 'view | manage | export', 'period 1: its Treasurer (P-OLD) holds view, manage and export');
select nexus_test.rec('o_open', 'opening', '1000000', 'Saldo awal periode 2090/2091');
select nexus_test.rec('o_inc', 'income', '500000', 'Persembahan', nexus_test.files(14, 1));
select nexus_test.rec('o_exp', 'expense', '200000', 'Konsumsi rapat');
select nexus_test.rec('o_exp2', 'expense', '100000', 'Salah ketik');
select is((select array_agg(number_text order by entry_no) from nexus.finance_entries),
          array['KAS-0001', 'KAS-0002', 'KAS-0003', 'KAS-0004'], 'A-FN2: numbers KAS-0001.. assigned by the database in order');
select is((select status from nexus.finance_entry_void(nexus_test.id('o_exp2'), 'Salah ketik jumlah')), 'voided', 'P-OLD voids a wrong entry of his period');
select is(nexus_test.tot(), '1000000/500000/200000/1300000',
  'FN-10: Saldo awal 1.000.000 + Pemasukan 500.000 - Pengeluaran 200.000 = 1.300.000; the voided 100.000 counts in nothing');
reset role; select nexus_test.login_as(5);
select is(nexus_test.keys(), '- | - | -', 'AC-39 (before): the next Treasurer has nothing while period 1 is active');
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(2);

-- =============================================================================================
-- 3. Who holds what in period 2 (spec 2; FN-01..FN-07, K1 a)
-- =============================================================================================
select nexus_test.login_as(5);
select is(nexus_test.keys(), 'view | manage | export', 'FN-01: P-BEND (Bendahara Umum 1) views, manages and exports');
reset role; select nexus_test.login_as(12);
select is(nexus_test.keys(), 'view | manage | export', 'B3: P-BEND-SEK (Bendahara Umum 2) the same');
reset role; select nexus_test.login_as(3);
select is(nexus_test.keys(), 'view | - | export', 'FN-02/K1 a: P-KETUM views and exports, no manage');
reset role; select nexus_test.login_as(4);
select is(nexus_test.keys(), 'view | - | export', 'FN-02: P-SEKJEN the same');
reset role; select nexus_test.login_as(19);
select is(nexus_test.keys(), 'view | - | export', 'K1 a: P-SEKUM1 the same');
reset role; select nexus_test.login_as(1);
select is(nexus_test.keys(), '- | - | -', 'FN-03/B18/AC-03: P-ADMIN (no position) gets nothing');
reset role; select nexus_test.login_as(2);
select is(nexus_test.keys(), '- | - | -', 'FN-03: P-SUPER gets nothing');
reset role; select nexus_test.login_as(6);
select is(nexus_test.keys(), '- | - | -', 'FN-03: P-SEKDEP gets nothing');
reset role; select nexus_test.login_as(7);
select is(nexus_test.keys(), '- | - | -', 'FN-03: P-KADEP-OPS gets nothing');
reset role; select nexus_test.login_as(8);
select is(nexus_test.keys(), '- | - | -', 'FN-03: P-STAFF-LOG gets nothing');
reset role; select nexus_test.login_as(10);
select is(nexus_test.keys(), '- | - | -', 'P-STAFF-PUB gets nothing');
reset role; select nexus_test.login_as(20);
select is(nexus_test.keys(), '- | - | -', 'a Kepala Divisi gets nothing');
reset role; select nexus_test.login_as(11);
select is(nexus_test.keys(), '- | - | -', 'FN-03: P-PLAIN gets nothing');
reset role; select nexus_test.login_as(16);
select is(nexus_test.keys(), '- | - | -', 'FN-03: P-LECT gets nothing');
reset role; select nexus_test.login_as(14);
select is(nexus_test.keys(), '- | - | -', 'FN-04/AC-40: P-OLD (Treasurer of the previous period) gets nothing now');
reset role; select nexus_test.login_as(15);
select is(nexus_test.keys(), '- | - | -', 'FN-04/L1: P-INACTIVE (BPH, deactivated) gets nothing');
reset role; select nexus_test.login_as(17);
select is(nexus_test.keys(), '- | - | -', 'FN-04/L1: P-UNLINKED gets nothing');
-- AC-68: an admin who is also Treasurer gets Finance through the position, not through admin.
reset role; select nexus_test.logout();
update public.members set access_level = 'admin' where id = nexus_test.mid(5);
select nexus_test.login_as(5);
select is(nexus_test.keys(), 'view | manage | export', 'FN-06/AC-68: P-ADMIN-BEND keeps Finance through the position');
reset role; select nexus_test.logout();
update public.members set access_level = 'member' where id = nexus_test.mid(5);
-- FN-05 (L12): finance keys never to every active member, never without a written reason.
select nexus_test.login_as(1);
select is(nexus_test.hint_of($$select nexus.add_access_rule('all_members', 'finance.view', p_note => 'x', p_confirm_sensitive => true)$$),
  'baseline_not_allowed', 'FN-05/L12: finance.view to every active member is refused');
select is(nexus_test.hint_of($$select nexus.add_access_rule('role', 'finance.export', 'all', 'staff', p_confirm_sensitive => true)$$),
  'note_required', 'FN-05/L12: a finance rule without a written reason is refused');
-- FN-06: disabling a default takes the power away on the next request.
select ok(nexus.disable_access_rule((select id from nexus.access_rules where default_code = 'D24'), 'test D24'), 'admin disables D24');
reset role; select nexus_test.login_as(5);
select is(nexus_test.keys(), 'view | - | export', 'FN-06: without D24 the Treasurer keeps view (bph, D02) but cannot manage');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', 'x')$$),
  'permission_required', 'FN-06: ... and recording is refused at once');
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where default_code = 'D02'), 'test D02'), 'admin disables D02');
reset role; select nexus_test.login_as(3);
select is(nexus_test.keys(), '- | - | -', 'R15: without D02 P-KETUM loses view AND export (export never exceeds view)');
select is(nexus_test.hint_of($$select * from nexus.finance_export('csv')$$), 'permission_required', 'R15/FN-28: ... the export call is refused');
reset role; select nexus_test.login_as(1);
select is(nexus.restore_default_access_rules('test restore D02 D24', true), 2, 'restore_default_access_rules() re-enables D02 and D24');
reset role; select nexus_test.login_as(5);
select is(nexus_test.keys(), 'view | manage | export', '... and the Treasurer manages again');

-- =============================================================================================
-- 4. Summary, opening hint, period list (F1, F3, K3 a, FN-21, FN-33, L8)
-- =============================================================================================
select ok((select period_label = '2091/2092' and is_active_period and not has_opening and opening_amount = 0
                  and income_total = 0 and expense_total = 0 and balance = 0 and entry_count = 0
                  and previous_period_label = '2090/2091' and previous_closing_balance = 1300000
           from nexus.finance_summary()),
  'K3 a/FN-21: a new period starts empty; the previous closing balance 1.300.000 is a HINT, never prefilled');
reset role; select nexus_test.login_as(3);
select ok((select not has_opening and previous_closing_balance = 1300000 from nexus.finance_summary()),
  'F8.2: viewers see "Saldo awal belum dicatat" too (same summary)');
select ok((select not is_active_period and period_label = '2090/2091' from nexus.finance_summary(nexus_test.period(1))),
  'L8: an old period is readable (read-only flag)');
select is(nexus_test.tot(nexus_test.period(1)), '1000000/500000/200000/1300000', 'L8: ... with its own totals');
select is(nexus_test.hint_of(format('select * from nexus.finance_summary(%L)', gen_random_uuid())), 'invalid_period', 'an unknown period is refused');
select is((select array_agg(period_label || ':' || is_active || ':' || entry_count order by is_active desc, period_label desc) from nexus.finance_period_list()),
          array['2091/2092:true:0', '2090/2091:false:4'], 'screen 1: the period selector lists the active period first, then periods with data');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of('select * from nexus.finance_summary()'), 'permission_required', 'FN-33: no Finance card or tiles for P-PLAIN');
select is(nexus_test.hint_of('select * from nexus.finance_period_list()'), 'permission_required', 'FN-03: ... nor the period list');

-- =============================================================================================
-- 5. Record (F2, F3; FN-01, FN-08, FN-12, FN-17, FN-18, FN-20, FN-22, FN-37)
-- =============================================================================================
reset role; select nexus_test.login_as(5);
select is((select array_agg(distinct nexus_test.amount_hint(a))
           from unnest(array['12.5', '1e3', '-5', '+5', '0', '007', '', '   ', 'abc', '1.000', '1 000', '5,0', '0x10',
                             E'١٢', '1_000', 'Rp 1000']) a),
          array['invalid_amount'], 'FN-08: "12.5", "1e3", "-5", "+5", "0", "007", blanks, letters, separators and non-ASCII digits are refused');
select is(nexus_test.amount_hint(null), 'invalid_amount', 'FN-08: an empty amount is refused');
select is(nexus_test.amount_hint('10000000000'), 'amount_too_large', 'FN-08/A-FN1: 10.000.000.000 is too large');
select is(nexus_test.amount_hint('99999999999999999999999999'), 'amount_too_large', '... a huge number is refused cleanly (no overflow error)');
select is(nexus_test.counter(), 4::bigint, 'refused saves use no number');
-- The bounds 1 and 9.999.999.999 are accepted (checked in a savepoint, then undone).
savepoint bounds;
select nexus_test.rec('b_min', 'income', '1');
select nexus_test.rec('b_max', 'income', '9999999999');
select (select amount from nexus.finance_entries where id = nexus_test.id('b_min')) as b_min,
       (select amount from nexus.finance_entries where id = nexus_test.id('b_max')) as b_max \gset
rollback to savepoint bounds;
release savepoint bounds;
select is(:b_min::bigint, 1::bigint, 'FN-08: Rp 1 is accepted');
select is(:b_max::bigint, 9999999999::bigint, 'FN-08: Rp 9.999.999.999 is accepted exactly');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'transfer', nexus_test.d(0), '1', 'x')$$), 'invalid_type', 'unknown type refused');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'all', nexus_test.d(0), '1', 'x')$$), 'invalid_type', '"all" is a filter, not a type');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), null, nexus_test.d(0), '1', 'x')$$), 'invalid_type', 'a type is required');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(1), '1', 'x')$$), 'date_in_future',
  'FN-12: the date cannot be after today (Jakarta)');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', null, '1', 'x')$$), 'date_required', 'a date is required');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', date '1999-12-31', '1', 'x')$$), 'invalid_dates', 'dates before 2000 are refused');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', 'infinity'::date, '1', 'x')$$), 'invalid_dates', 'infinity is refused');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', '   ')$$), 'text_required', 'Keterangan is required');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_record(gen_random_uuid(), %L, nexus_test.d(0), %L, %L)', 'income', '1', repeat('k', 201))),
  'text_too_long', 'A-FN5: Keterangan max 200');
select is(nexus_test.detail_of(format('select * from nexus.finance_entry_record(gen_random_uuid(), %L, nexus_test.d(0), %L, %L, %L)', 'income', '1', 'x', repeat('n', 501))),
  'notes', 'A-FN5: Catatan max 500');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(null, 'income', nexus_test.d(0), '1', 'x')$$), 'invalid_input', 'A-FN10: a submit key is required');
-- First real entry of period 2
select nexus_test.put('e_inc1', entry_id) from nexus.finance_entry_record('aaaaaaaa-0000-4000-8000-000000000001', 'income', nexus_test.d(0),
  ' 2500000 ', '  Persembahan   ibadah  ', E'Catatan baris 1\r\nbaris 2  ');
select ok((select number_text = 'KAS-0005' and entry_no = 5 and period_id = nexus_test.period(2) and created_by = nexus_test.mid(5)
                  and status = 'active' and entry_type = 'income' and amount = 2500000 and entry_date = nexus_test.d(0)
           from nexus.finance_entries where id = nexus_test.id('e_inc1')),
  'FN-01/FN-22/A-FN2: saved Aktif, period = active period, recorder from the session, number continues (KAS-0005, never reset per period)');
select ok((select description = 'Persembahan ibadah' and notes = E'Catatan baris 1\nbaris 2' from nexus.finance_entries where id = nexus_test.id('e_inc1')),
  'F7: Keterangan on one line, Catatan keeps line breaks (CRLF -> LF, trimmed)');
select ok((select count(*) = 1 and bool_and(kind = 'recorded' and actor_member_id = nexus_test.mid(5) and period_id = nexus_test.period(2))
           from nexus.finance_entry_history where entry_id = nexus_test.id('e_inc1')),
  'FN-19: one history row "Dicatat" with who and period');
-- FN-17: double submit / retry with the same key = one entry
select ok((select entry_id = nexus_test.id('e_inc1') and number_text = 'KAS-0005' and replayed
           from nexus.finance_entry_record('aaaaaaaa-0000-4000-8000-000000000001', 'income', nexus_test.d(0), '2500000', 'Persembahan ibadah',
                                           E'Catatan baris 1\nbaris 2')),
  'FN-17: the same submit again returns the FIRST entry (replayed)');
select ok(nexus_test.entry_count() = 5 and nexus_test.counter() = 5, 'FN-17: ... no second entry, no number used');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record('aaaaaaaa-0000-4000-8000-000000000001', 'income', nexus_test.d(0), '2500001', 'Persembahan ibadah')$$),
  'idempotency_conflict', 'A-FN10: the same key with other values is refused');
-- K6: the second Treasurer, same key value (keys are per recorder)
reset role; select nexus_test.login_as(12);
select nexus_test.put('e_exp_b', entry_id) from nexus.finance_entry_record('aaaaaaaa-0000-4000-8000-000000000001', 'expense', nexus_test.d(-2), '75000', 'Fotokopi');
select ok((select number_text = 'KAS-0006' and created_by = nexus_test.mid(12) from nexus.finance_entries where id = nexus_test.id('e_exp_b')),
  'K6 a: Bendahara Umum 2 records too (a submit key belongs to its recorder)');
reset role; select nexus_test.login_as(5);
select nexus_test.rec('e_exp1', 'expense', '1250000', 'Sewa sound system', nexus_test.files(5, 2), null, -3);
select ok((select count(*) = 2 from nexus.finance_entry_files where entry_id = nexus_test.id('e_exp1'))
          and (select count(*) = 2 from nexus.finance_entry_history where entry_id = nexus_test.id('e_exp1') and kind = 'file_added'),
  'K5: proofs saved with the entry, one history row each');
-- Opening balance (K3 a, FN-20)
select nexus_test.rec('e_open1', 'opening', '750000', 'Saldo awal periode 2091/2092');
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'opening', nexus_test.d(0), '1300000', 'Saldo awal lagi')$$),
  'opening_exists', 'FN-20/A-FN21: a second Aktif Saldo awal is refused');
select is(nexus_test.counter(), 8::bigint, '... and used no number');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_record(gen_random_uuid(), %L, nexus_test.d(0), %L, %L, null, %L)',
                                    'opening', '5', 'x', nexus_test.id('o_inc'))),
  'invalid_correction', 'an opening balance is never a correction');
-- FN-37: markup and formula text are stored verbatim (escaping is the screen's and export's job)
select nexus_test.rec('e_xss', 'income', '1', '<script>alert(1)</script>', null, null, -1, '=HYPERLINK("http://x")');
select ok((select description = '<script>alert(1)</script>' and notes = '=HYPERLINK("http://x")' from nexus.finance_entries where id = nexus_test.id('e_xss')),
  'FN-37/R16: markup and formula text are stored as plain text');
select is(nexus_test.tot(), '750000/2500001/1325000/1925001',
  'FN-10: Saldo awal 750.000 + Pemasukan 2.500.001 - Pengeluaran 1.325.000 = 1.925.001 (opening is not income)');
-- Who may not record
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', 'x')$$), 'permission_required',
  'FN-02: P-KETUM cannot record (direct call)');
reset role; select nexus_test.login_as(4);
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', 'x')$$), 'permission_required',
  'FN-02: P-SEKJEN cannot record');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', 'x')$$), 'permission_required',
  'FN-03: P-ADMIN cannot record');
reset role; select nexus_test.login_as(14);
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', 'x')$$), 'permission_required',
  'FN-04: P-OLD cannot record any more');
reset role; select nexus_test.login_as(17);
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', 'x')$$), 'permission_required',
  'FN-04: P-UNLINKED cannot record');
reset role; select nexus_test.logout();
set local role authenticated;
select is(nexus_test.hint_of($$select * from nexus.finance_entry_list()$$), 'permission_required', 'FN-04: a token without a subject reads nothing');
reset role;
-- FN-07: a Treasurer deactivated mid-session fails on the next request
update public.members set is_active = false where id = nexus_test.mid(5);
select nexus_test.login_as(5);
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', 'x')$$), 'permission_required',
  'FN-07/AC-44: a deactivated Treasurer is refused on the next request');
select is(nexus_test.hint_of($$select * from nexus.finance_summary()$$), 'permission_required', 'FN-07: ... and reads nothing');
reset role; select nexus_test.logout();
update public.members set is_active = true where id = nexus_test.mid(5);
select is(nexus_test.counter(), 9::bigint, 'nine numbers used so far (KAS-0001..KAS-0009)');

-- =============================================================================================
-- 6. Void (F4, K2 a, K6 a; FN-10, FN-15, FN-18, FN-19, FN-20)
-- =============================================================================================
select nexus_test.login_as(5);
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('e_exp_b'), '  ')), 'reason_required', 'FN-15: voiding needs a reason');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('e_exp_b'), repeat('r', 501))), 'text_too_long', 'A-FN5: reason max 500');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', gen_random_uuid(), 'x')), 'entry_not_found', 'unknown entry');
select is((select status from nexus.finance_entry_void(nexus_test.id('e_exp_b'), 'Nota ganda')), 'voided',
  'K6 a/A-FN17: Bendahara Umum 1 voids an entry recorded by Bendahara Umum 2');
select ok((select status = 'voided' and void_reason = 'Nota ganda' and voided_by = nexus_test.mid(5) and voided_at is not null
                  and amount = 75000 and number_text = 'KAS-0006'
           from nexus.finance_entries where id = nexus_test.id('e_exp_b')),
  'FN-15: the entry stays with who, when, why; amount and number untouched');
select ok((select note = 'Nota ganda' and actor_member_id = nexus_test.mid(5) from nexus.finance_entry_history
           where entry_id = nexus_test.id('e_exp_b') and kind = 'voided'), 'FN-19: one history row for the void, with the reason');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('e_exp_b'), 'lagi')), 'state_changed',
  'FN-15/R9: a second void is refused ("Data sudah berubah")');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_exp_b'), nexus_test.files(5, 1))), 'entry_voided',
  '4.3: a voided entry gets no proof');
select is(nexus_test.tot(), '750000/2500001/1250000/2000001', 'FN-10: voiding the 75.000 expense lowers Pengeluaran and raises the balance');
-- FN-20: void the opening, record the right one
select is((select status from nexus.finance_entry_void(nexus_test.id('e_open1'), 'Kas dihitung ulang')), 'voided', 'FN-20: the wrong Saldo awal is voided');
select ok((select not has_opening and opening_amount = 0 from nexus.finance_summary()), '... then the period has no opening balance');
select nexus_test.rec('e_open2', 'opening', '1300000', 'Saldo awal periode 2091/2092 (Pakai angka ini)');
select is(nexus_test.en('e_open2'), 'KAS-0010', 'FN-18: the next number is new; voided numbers are never reused');
select is(nexus_test.tot(), '1300000/2500001/1250000/2550001', 'FN-20: the new Saldo awal counts; the voided one counts in nothing');
select ok((select (d -> 'actions' ->> 'can_rerecord')::boolean and not (d -> 'actions' ->> 'can_void')::boolean
                  and not (d -> 'actions' ->> 'can_add_proof')::boolean and d ->> 'void_reason' = 'Kas dihitung ulang'
           from nexus.finance_entry_detail(nexus_test.id('e_open1')) d),
  'F4: a voided entry offers "Catat ulang" and nothing else');
-- Viewers cannot void
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('e_inc1'), 'x')), 'permission_required', 'FN-02: P-KETUM cannot void');
reset role; select nexus_test.login_as(19);
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('e_inc1'), 'x')), 'permission_required', 'FN-02: P-SEKUM1 cannot void');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('e_inc1'), 'x')), 'permission_required', 'P-PLAIN cannot void');

-- =============================================================================================
-- 7. Old-period entries and corrections (F5, L7, K2 a; FN-16, A-FN8)
-- =============================================================================================
reset role; select nexus_test.login_as(5);
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('o_exp'), 'x')), 'closed_period',
  'FN-16/AC-41: an old-period entry cannot be voided');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('o_exp'), nexus_test.files(5, 1))), 'closed_period',
  'FN-16: ... nor given proof');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_withdraw_proof((select min(id) from nexus.finance_entry_files where entry_id = %L), %L)',
                                    nexus_test.id('o_inc'), 'x')), 'closed_period', 'FN-16: ... nor lose a proof');
select ok((select not (d ->> 'is_active_period')::boolean and (d -> 'actions' ->> 'can_correct')::boolean
                  and not (d -> 'actions' ->> 'can_void')::boolean and not (d -> 'actions' ->> 'can_add_proof')::boolean
           from nexus.finance_entry_detail(nexus_test.id('o_inc')) d),
  'F5: an old-period entry offers only "Buat koreksi"');
select nexus_test.rec('e_fix', 'expense', '500000', 'Koreksi KAS-0002: pemasukan tercatat ganda', null, nexus_test.id('o_inc'), -5);
select ok((select corrects_entry_id = nexus_test.id('o_inc') and period_id = nexus_test.period(2) and number_text = 'KAS-0011'
           from nexus.finance_entries where id = nexus_test.id('e_fix')),
  'FN-16/A-FN8: the correction is a new entry in the ACTIVE period with a link');
select ok((select d -> 'corrected_by' -> 0 ->> 'number_text' = 'KAS-0011' from nexus.finance_entry_detail(nexus_test.id('o_inc')) d)
          and (select d -> 'corrects' ->> 'number_text' = 'KAS-0002' from nexus.finance_entry_detail(nexus_test.id('e_fix')) d),
  'screen 2: "Koreksi atas KAS-0002" both ways');
select is(nexus_test.tot(nexus_test.period(1)), '1000000/500000/200000/1300000', 'A-FN8: the old period''s totals are not restated');
select is(nexus_test.tot(), '1300000/2500001/1750000/2050001', 'the correction counts in the active period');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_record(gen_random_uuid(), %L, nexus_test.d(0), %L, %L, null, %L)',
                                    'income', '5', 'x', nexus_test.id('o_exp2'))),
  'invalid_correction', 'A-FN8: the corrected entry must be Aktif');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_record(gen_random_uuid(), %L, nexus_test.d(0), %L, %L, null, %L)',
                                    'income', '5', 'x', gen_random_uuid())),
  'invalid_correction', 'A-FN8: ... and must exist');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('o_exp2'), 'x')), 'state_changed',
  'an already voided old entry stays voided');

-- =============================================================================================
-- 8. Immutable ledger (K2 a, R1, R2; FN-13, FN-14) - even the database owner is refused
-- =============================================================================================
reset role; select nexus_test.logout();
select is(nexus._fn_today(), (now() at time zone 'Asia/Jakarta')::date, 'FN-12/R14: "today" is the Asia/Jakarta date (internal helper, owner only)');
select is((select array_agg(distinct nexus_test.hint_of(format('update nexus.finance_entries set %s where id = %L', s, nexus_test.id('e_inc1'))))
          from unnest(array['amount = 1', 'amount = amount', 'entry_type = ''expense''', 'entry_date = entry_date - 1',
                            'description = ''x''', 'notes = null', 'period_id = ''' || nexus_test.period(1) || '''',
                            'number_text = ''KAS-9999''', 'entry_no = 9999', 'created_by = gen_random_uuid()',
                            'created_at = now()', 'idempotency_key = gen_random_uuid()',
                            'corrects_entry_id = ''' || nexus_test.id('o_exp') || '''']) s),
          array['immutable_column'], 'FN-13: amount, type, date, Keterangan, Catatan, period, number, recorder, link: never changed, not even by the owner');
select is(nexus_test.hint_of(format('update nexus.finance_entries set status = %L, void_reason = null, voided_by = null, voided_at = null where id = %L',
                                    'active', nexus_test.id('e_open1'))), 'immutable_column', 'FN-15: a voided entry is never restored');
select is(nexus_test.hint_of(format('update nexus.finance_entries set void_reason = %L where id = %L', 'lain', nexus_test.id('e_open1'))), 'immutable_column',
  '... and its void reason never changes');
select is(nexus_test.hint_of(format('delete from nexus.finance_entries where id = %L', nexus_test.id('e_xss'))), 'append_only', 'FN-14: no entry is deleted');
select is(nexus_test.hint_of('truncate nexus.finance_entries cascade'), 'append_only', 'FN-14: no truncate');
select is(nexus_test.hint_of('delete from nexus.finance_entry_files'), 'append_only', 'FN-14: no proof record is deleted');
select is(nexus_test.hint_of('update nexus.finance_entry_history set note = ''x'''), 'append_only', 'FN-19: history rows cannot be edited');
select is(nexus_test.hint_of('delete from nexus.finance_entry_history'), 'append_only', 'FN-19: ... or deleted');
select is(nexus_test.hint_of('update nexus.finance_counter set last_value = 1'), 'immutable_column', 'A-FN2: the counter never goes back');
select is(nexus_test.hint_of('delete from nexus.finance_counter'), 'append_only', 'A-FN2: ... and is never deleted');
select is(nexus_test.hint_of(format('update nexus.finance_entry_files set original_name = %L where entry_id = %L', 'x.jpg', nexus_test.id('e_exp1'))),
  'immutable_column', 'a stored proof is never renamed or replaced');
select throws_ok(format($$insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
                         values (90001, 'KAS-90001', 'income', 0, current_date, 'x', %L, gen_random_uuid(), gen_random_uuid())$$, nexus_test.period(2)),
  '23514', null, 'FN-08: the database refuses an amount of 0');
select throws_ok(format($$insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
                         values (90002, 'KAS-90002', 'expense', -5, current_date, 'x', %L, gen_random_uuid(), gen_random_uuid())$$, nexus_test.period(2)),
  '23514', null, 'FN-08: ... a negative amount');
select throws_ok(format($$insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
                         values (90003, 'KAS-90003', 'income', 10000000000, current_date, 'x', %L, gen_random_uuid(), gen_random_uuid())$$, nexus_test.period(2)),
  '23514', null, 'FN-08: ... and more than 9.999.999.999');
select throws_ok(format($$insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
                         values (90004, 'KAS-90004', 'opening', 5, current_date, 'x', %L, gen_random_uuid(), gen_random_uuid())$$, nexus_test.period(2)),
  '23505', null, 'A-FN21: a unique index refuses a second Aktif Saldo awal even by hand');
-- The Treasurer has no direct write privilege at all
select nexus_test.login_as(5);
select throws_ok(format('update nexus.finance_entries set amount = 1 where id = %L', nexus_test.id('e_inc1')), '42501', null, 'FN-13: the Treasurer cannot update directly');
select throws_ok(format('delete from nexus.finance_entries where id = %L', nexus_test.id('e_inc1')), '42501', null, 'FN-14: ... or delete');
select throws_ok($$insert into nexus.finance_entry_history (entry_id, kind, actor_member_id, period_id)
                   values (gen_random_uuid(), 'recorded', gen_random_uuid(), gen_random_uuid())$$, '42501', null, '... or insert history');
select throws_ok('update nexus.finance_counter set last_value = last_value + 1', '42501', null, '... or move the counter');

-- =============================================================================================
-- 9. Proof files (F6, K5 a; FN-25, FN-27, F4)
-- =============================================================================================
select is((select proof_count from nexus.finance_entry_add_proof(nexus_test.id('e_exp1'), nexus_test.files(5, 1))), 3, 'F6: a third proof added later');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_exp1'), nexus_test.files(5, 1))),
  'file_count', 'FN-25: a fourth visible proof is refused');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'), '[]')), 'file_required', 'adding nothing is refused');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_record(gen_random_uuid(), %L, nexus_test.d(0), %L, %L, null, null, %L)',
                                    'expense', '5', 'x', nexus_test.files(5, 4))), 'file_count', 'FN-25: four proofs at recording are refused');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'), nexus_test.file1(nexus_test.fpath(12)))),
  'invalid_file', 'proofs must come from the caller''s OWN upload folder');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'),
                                    nexus_test.file1(nexus_test.mid(5)::text || '/' || gen_random_uuid()::text || '.docx'))),
  'invalid_file', 'FN-25/K5: no DOCX');
select (select storage_path from nexus.finance_entry_files where entry_id = nexus_test.id('e_exp1') order by id limit 1) as att_exp1 \gset
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'), nexus_test.file1(:'att_exp1'))),
  'file_already_attached', 'a stored proof cannot be attached twice');
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'),
                                    nexus_test.file1(nexus_test.mid(5)::text || '/' || gen_random_uuid()::text || '.jpg'))),
          'file_missing', 'a proof that was never uploaded is refused')
  else skip('Storage not installed (load tests/support/storage_stub.sql)', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'),
                                    nexus_test.file1(nexus_test.fpath(5, 'jpg', 5242881)))),
          'file_too_large', 'FN-25: a proof over 5 MB is refused')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'),
                                    nexus_test.file1(nexus_test.fpath(5, 'pdf', 1000, 'text/html')))),
          'invalid_file', 'FN-25: the stored type must match the extension')
  else skip('Storage not installed', 1) end;
select (select id from nexus.finance_entry_files where entry_id = nexus_test.id('e_exp1') order by id limit 1)::text as f_exp1 \gset
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_withdraw_proof(%s, %L)', :f_exp1, ' ')), 'reason_required', 'withdrawing needs a reason');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_withdraw_proof(%s, %L)', 999999999, 'x')), 'file_not_found', 'unknown proof');
select is((select proof_count from nexus.finance_entry_withdraw_proof(:f_exp1, 'Nota salah')), 2, 'F6: the proof is withdrawn; two visible remain');
select ok((select is_withdrawn and withdraw_reason = 'Nota salah' and withdrawn_by = nexus_test.mid(5) from nexus.finance_entry_files where id = :f_exp1),
  'FN-27/L5: the record stays with who and why');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_withdraw_proof(%s, %L)', :f_exp1, 'lagi')), 'state_changed', 'withdrawn once');
select is((select proof_count from nexus.finance_entry_add_proof(nexus_test.id('e_exp1'), nexus_test.files(5, 1))), 3,
  'FN-27: withdrawn proofs do not count toward the limit of 3');
select ok((select jsonb_array_length(d -> 'files') = 4 and (d ->> 'proof_count')::int = 3
                  and exists (select 1 from jsonb_array_elements(d -> 'history') h where h ->> 'kind' = 'file_withdrawn' and h ->> 'note' = 'Nota salah')
           from nexus.finance_entry_detail(nexus_test.id('e_exp1')) d),
  'F4: the Treasurer sees the withdrawn proof and its history row with the reason');
reset role; select nexus_test.login_as(3);
select ok((select jsonb_array_length(d -> 'files') = 3
                  and not exists (select 1 from jsonb_array_elements(d -> 'files') f where (f ->> 'is_withdrawn')::boolean)
                  and not exists (select 1 from jsonb_array_elements(d -> 'history') h where h ->> 'kind' = 'file_withdrawn')
                  and (select h ->> 'file_name' from jsonb_array_elements(d -> 'history') h
                       where (h ->> 'history_id')::bigint = (select min(id) from nexus.finance_entry_history where entry_id = nexus_test.id('e_exp1') and kind = 'file_added')) is null
           from nexus.finance_entry_detail(nexus_test.id('e_exp1')) d),
  'F4/A-FN6: a viewer (P-KETUM) sees neither the withdrawn proof, its name, nor the withdraw row');
select is((select count(*)::int from nexus.finance_entry_files where entry_id = nexus_test.id('e_exp1')), 3, 'F4: ... not even through the table (RLS)');
select is((select count(*)::int from nexus.finance_entry_history where kind = 'file_withdrawn'), 0, 'F4: ... nor the history row');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'), nexus_test.files(3, 1))), 'permission_required',
  'FN-02: P-KETUM cannot add proof');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_withdraw_proof(%s, %L)', :f_exp1, 'x')), 'permission_required', 'FN-02: ... nor withdraw one');
-- "Tanpa bukti" (K5 a)
select is((select array_agg(number_text order by number_text) from nexus.finance_entry_list(p_without_proof => true)),
          array['KAS-0005', 'KAS-0009', 'KAS-0010', 'KAS-0011'], 'K5 a/FN-27: the "Tanpa bukti" filter lists Aktif entries without a visible proof');
select is((select without_proof_count from nexus.finance_summary()), 4, 'K5 a: the summary counts them');
select is((select proof_count from nexus.finance_entry_list() where entry_id = nexus_test.id('e_exp1')), 3, 'the list shows the visible proof count (paperclip)');

-- =============================================================================================
-- 10. List, search, filters, detail (F1; A-FN13, FN-34)
-- =============================================================================================
select is((select array_agg(number_text order by row_no) from nexus.finance_entry_list()),
          array['KAS-0005', 'KAS-0010', 'KAS-0009', 'KAS-0007', 'KAS-0011'],
  'A-FN13: Aktif entries only by default; date newest first, then number newest');
select is((select count(*)::int from nexus.finance_entry_list(p_include_voided => true)), 7, '"Tampilkan yang dibatalkan" adds the 2 voided entries');
select ok((select bool_and(total_count = 5 and page = 2 and page_size = 2) and count(*) = 2 from nexus.finance_entry_list(p_page => 2, p_page_size => 2)),
  'server pagination (page 2 of size 2, total 5)');
select ok((select page = 3 from nexus.finance_entry_list(p_page => 99, p_page_size => 2) limit 1), 'a page past the end returns the last page');
select is(nexus_test.hint_of('select * from nexus.finance_entry_list(p_page_size => 51)'), 'invalid_page_size', 'page size max 50');
select is(nexus_test.hint_of('select * from nexus.finance_entry_list(p_page => 0)'), 'invalid_page', 'page from 1');
select is((select count(*)::int from nexus.finance_entry_list(p_search => 'PERSEMBAHAN')), 1, 'search Keterangan, case-insensitive (active period only)');
select is((select count(*)::int from nexus.finance_entry_list(p_search => 'baris 2')), 1, 'search Catatan');
select is((select number_text from nexus.finance_entry_list(p_search => 'kas-0007')), 'KAS-0007', 'search the number');
select is((select count(*)::int from nexus.finance_entry_list(p_search => '%')), 0, 'search: % is a literal character');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_list(p_search => %L)', repeat('s', 121))), 'search_too_long', 'search max 120');
select is((select count(*)::int from nexus.finance_entry_list(p_type => 'expense')), 2, 'Jenis filter: Pengeluaran');
select is((select number_text from nexus.finance_entry_list(p_type => 'opening')), 'KAS-0010', 'Jenis filter: Saldo awal (Aktif)');
select is(nexus_test.hint_of('select * from nexus.finance_entry_list(p_type => ''transfer'')'), 'invalid_type', 'unknown Jenis refused');
select is((select count(*)::int from nexus.finance_entry_list(p_from => nexus_test.d(-3), p_to => nexus_test.d(-1))), 3, 'date range filter');
select is(nexus_test.hint_of('select * from nexus.finance_entry_list(p_from => nexus_test.d(0), p_to => nexus_test.d(-1))'), 'invalid_dates', 'end before start refused');
select is((select corrects_number_text from nexus.finance_entry_list() where entry_id = nexus_test.id('e_fix')), 'KAS-0002', 'the list shows "Koreksi atas"');
select is((select count(*)::int from nexus.finance_entry_list(p_period_id => nexus_test.period(1))), 3, 'L8: the old period''s Aktif entries');
select ok((select (d ->> 'amount') = '1250000' and d ->> 'number_text' = 'KAS-0007' and d ->> 'entry_type' = 'expense'
                  and d ->> 'created_by_name' = 'Test Persona 5' and d ->> 'period_label' = '2091/2092'
                  and not (d -> 'actions' ->> 'can_void')::boolean and not (d -> 'actions' ->> 'can_add_proof')::boolean
                  and not (d -> 'actions' ->> 'can_correct')::boolean and (d -> 'actions' ->> 'can_export')::boolean
           from nexus.finance_entry_detail(nexus_test.id('e_exp1')) d),
  'screen 2: exact amount, number, recorder name from PI-CORE; a viewer gets no write button');
select is(nexus_test.hint_of(format('select nexus.finance_entry_detail(%L)', gen_random_uuid())), 'entry_not_found', 'unknown entry');
select ok((select bool_and(nexus.finance_entry_detail(entry_id)::text !~* '(example\.test|"(email|phone|nim|nip)")')
           from nexus.finance_entry_list(p_include_voided => true, p_page_size => 50)),
  'FN-34: no detail contains an email, NIM or phone');
reset role; select nexus_test.login_as(5);
select ok((select (d -> 'actions' ->> 'can_void')::boolean and (d -> 'actions' ->> 'can_add_proof')::boolean
                  and not (d -> 'actions' ->> 'can_correct')::boolean
           from nexus.finance_entry_detail(nexus_test.id('e_inc1')) d), 'FN-01: the Treasurer gets void and proof buttons on an active-period entry');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of(format('select nexus.finance_entry_detail(%L)', nexus_test.id('e_inc1'))), 'permission_required', 'FN-03: P-PLAIN reads no detail');
select is(nexus_test.hint_of('select * from nexus.finance_entry_list()'), 'permission_required', 'FN-03: ... and no list');

-- =============================================================================================
-- 11. Export and log (F7; FN-28..FN-32, R15, F5/F8 of the migration)
-- =============================================================================================
select is(nexus_test.hint_of($$select * from nexus.finance_export('csv')$$), 'permission_required', 'FN-28: P-PLAIN cannot export');
reset role; select nexus_test.login_as(6);
select is(nexus_test.hint_of($$select * from nexus.finance_export('csv')$$), 'permission_required', 'FN-28: P-SEKDEP cannot export');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of($$select * from nexus.finance_export('csv')$$), 'permission_required', 'FN-28: P-ADMIN cannot export');
reset role; select nexus_test.login_as(14);
select is(nexus_test.hint_of($$select * from nexus.finance_export('csv')$$), 'permission_required', 'FN-28: P-OLD cannot export');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.finance_export('docx')$$), 'invalid_format', 'xlsx, csv or pdf only');
select is(nexus_test.hint_of($$select * from nexus.finance_export('csv', p_type => 'transfer')$$), 'invalid_type', 'filters are validated like the list');
select is(nexus_test.log_count(), 0, 'FN-31: refused exports wrote no log row');
select ok((select array_agg(number_text order by row_no) from nexus.finance_export('csv'))
          = (select array_agg(number_text order by row_no) from nexus.finance_entry_list(p_page_size => 50)),
  'FN-29: export = the screen rows, same order');
select ok((select bool_and(total_count = 7) and count(*) = 7 from nexus.finance_export('xlsx', p_include_voided => true)), 'total_count on every row');
select ok((select bool_and(summary_opening = 1300000 and summary_income = 2500001 and summary_expense = 1750000 and summary_balance = 2050001)
           from nexus.finance_export('pdf', p_type => 'expense')),
  'FN-29: every row carries the WHOLE-period summary, also when the rows are filtered');
select ok((select status = 'voided' and void_reason = 'Nota ganda' from nexus.finance_export('csv', p_include_voided => true) where number_text = 'KAS-0006'),
  'FN-29: voided entries are exported with status and reason');
select ok((select amount = 1 and description = '<script>alert(1)</script>' and notes = '=HYPERLINK("http://x")'
           from nexus.finance_export('csv') where number_text = 'KAS-0009'),
  'FN-29/FN-30: integer amount and the raw text (the CSV/Excel writer neutralises formulas, A-FN14)');
select ok((select has_proof from nexus.finance_export('csv') where number_text = 'KAS-0007')
          and not (select has_proof from nexus.finance_export('csv') where number_text = 'KAS-0005'), 'spec 8: proof yes or no, never a link');
select is((select corrects_number_text from nexus.finance_export('csv') where number_text = 'KAS-0011'), 'KAS-0002', 'spec 8: "koreksi atas"');
select ok((select count(*) = 3 and bool_and(summary_balance = 1300000 and period_label = '2090/2091') from nexus.finance_export('csv', p_period_id => nexus_test.period(1))),
  'L8: an old period can be exported');
select is((select count(*)::int from nexus.finance_export('csv', p_search => 'Persembahan')), 1, 'export with a search');
reset role; select nexus_test.login_as(4);
select is((select count(*)::int from nexus.finance_export('csv')), 5, 'K1 a: P-SEKJEN exports');
reset role; select nexus_test.login_as(5);
select is((select count(*)::int from nexus.finance_export('pdf', p_without_proof => true)), 4, 'D25: the Treasurer exports ("Tanpa bukti")');
reset role; select nexus_test.logout();
select is(nexus_test.log_count(), 12, 'FN-31: exactly one log row per successful export (12)');
select ok((select exporter_member_id = nexus_test.mid(5) and format = 'pdf' and row_count = 4 and period_id = nexus_test.period(2)
                  and exported_period_id = nexus_test.period(2) and (filters ->> 'without_proof')::boolean
           from nexus.finance_export_logs order by id desc limit 1),
  'FN-31: the log row stores who, format, filters, period and row count');
select ok((select exported_period_id = nexus_test.period(1) and period_id = nexus_test.period(2)
           from nexus.finance_export_logs where row_count = 3 and exported_period_id = nexus_test.period(1)),
  'F8: the log stores the exported period AND the active period');
select ok((select (filters ->> 'search_used')::boolean from nexus.finance_export_logs where exporter_member_id = nexus_test.mid(3) and row_count = 1 and exported_period_id = nexus_test.period(2)),
  'FN-31: a search is logged as "used", never as text');
select is((select count(*)::int from nexus.finance_export_logs
           where filters::text ~* '(persembahan|persona|script|1250000|2500001|2050001)'), 0,
  'FN-31: no names, search text or amounts in the log');
select is(nexus_test.hint_of($$insert into nexus.finance_export_logs (exporter_member_id, format, filters, exported_period_id, row_count, period_id)
                                values (gen_random_uuid(), 'csv', '{}', gen_random_uuid(), 0, gen_random_uuid())$$), 'export_log_direct_insert',
  'FN-31: a hand-written log row is refused');
select is(nexus_test.hint_of('update nexus.finance_export_logs set format = ''pdf'''), 'append_only', 'FN-31: the log cannot be updated');
select is(nexus_test.hint_of('delete from nexus.finance_export_logs'), 'append_only', 'FN-14: ... or deleted');
select nexus_test.login_as(5);
select throws_ok($$select * from nexus.finance_export_logs$$, '42501', null, 'A-FN15: not even the Treasurer reads the log directly');
reset role; select nexus_test.logout();
create function nexus_test.fail_log() returns trigger language plpgsql as $$ begin raise exception 'log unavailable'; end $$;
create trigger zz_fail before insert on nexus.finance_export_logs for each row execute function nexus_test.fail_log();
select nexus_test.login_as(3);
select is(nexus_test.msg_of($$select * from nexus.finance_export('csv')$$), 'log unavailable', 'FN-31: when the log write fails, no data is returned');
reset role; select nexus_test.logout();
drop trigger zz_fail on nexus.finance_export_logs;
select is(nexus_test.log_count(), 12, '... and no log row was written');
-- FN-32: more than 1000 rows refused in the database before any log row; exactly 1000 works.
select count(*)::int as active_rows from nexus.finance_entries where period_id = nexus_test.period(2) and status = 'active' \gset
savepoint cap;
insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
select 500000 + g, 'KAS-' || (500000 + g), 'income', 1, nexus_test.d(-10), 'Massal ' || g, nexus_test.period(2), gen_random_uuid(), nexus_test.mid(5)
from generate_series(1, 1000 - :active_rows) g;
select nexus_test.login_as(3);
select (select count(*) from nexus.finance_export('csv'))::int as cap_rows,
       (select max(total_count) from nexus.finance_export('csv'))::int as cap_total \gset
reset role; select nexus_test.logout();
insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
values (600001, 'KAS-600001', 'income', 1, nexus_test.d(-10), 'Massal extra', nexus_test.period(2), gen_random_uuid(), nexus_test.mid(5));
select nexus_test.log_count() as cap_logs_before \gset
select nexus_test.login_as(3);
select nexus_test.hint_of($$select * from nexus.finance_export('csv')$$) as cap_hint \gset
select (select count(*) from nexus.finance_export('csv', p_type => 'expense'))::int as cap_narrow \gset
reset role; select nexus_test.logout();
select nexus_test.log_count() as cap_logs_after \gset
rollback to savepoint cap;
release savepoint cap;
select is(:cap_rows, 1000, 'FN-32: an export of exactly 1000 complete rows works');
select is(:cap_total, 1000, 'FN-32: ... and its total_count says 1000');
select is(:'cap_hint'::text, 'too_many_rows', 'FN-32: 1001 rows are refused in the database');
select is(:cap_logs_after - :cap_logs_before, 1, 'FN-32: the refused export left no log row (only the narrowed one did)');
select is(:cap_narrow, 2, '... a narrower filter works again');

-- =============================================================================================
-- 12. Money is exact (FN-09): 10,000 entries of Rp 1 total exactly Rp 10.000; huge sums stay exact.
-- =============================================================================================
savepoint money;
insert into public.periods (id, label) values (nexus_test.period(4), '2093/2094');
insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
select 700000 + g, 'KAS-' || (700000 + g), 'income', 1, nexus_test.d(-10), 'Rp satu', nexus_test.period(4), gen_random_uuid(), nexus_test.mid(5)
from generate_series(1, 10000) g;
select nexus_test.login_as(3);
select nexus_test.tot(nexus_test.period(4)) as money_small \gset
reset role; select nexus_test.logout();
insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
select 800000 + g, 'KAS-' || (800000 + g), 'expense', 9999999999, nexus_test.d(-10), 'Besar', nexus_test.period(4), gen_random_uuid(), nexus_test.mid(5)
from generate_series(1, 1000) g;
select nexus_test.login_as(3);
select nexus_test.tot(nexus_test.period(4)) as money_big \gset
reset role; select nexus_test.logout();
rollback to savepoint money;
release savepoint money;
select is(:'money_small'::text, '0/10000/0/10000', 'FN-09: 10.000 entries of Rp 1 total exactly Rp 10.000');
select is(:'money_big'::text, '0/10000/9999999999000/-9999999989000', 'FN-09/A-FN9: 1000 x Rp 9.999.999.999 stays exact; a negative balance is allowed');

-- =============================================================================================
-- 13. RLS per persona on the tables (FN-03, FN-04, FN-35): zero rows for everybody without a key
-- =============================================================================================
select count(*) as all_entries from nexus.finance_entries \gset
select count(*) as all_files from nexus.finance_entry_files \gset
select count(*) as visible_files from nexus.finance_entry_files where not is_withdrawn \gset
select count(*) as all_history from nexus.finance_entry_history \gset
select count(*) as visible_history from nexus.finance_entry_history where kind <> 'file_withdrawn' \gset
select nexus_test.login_as(11);
select is(nexus_test.rls_total(), 0, 'FN-35: P-PLAIN reads zero rows of entries, proofs, history and counter');
select throws_ok($$insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, period_id, idempotency_key, created_by)
                   values (1, 'KAS-0001', 'income', 1, current_date, 'x', gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$$, '42501', null,
  'FN-35: no direct insert');
reset role; select nexus_test.login_as(1);
select is(nexus_test.rls_total(), 0, 'FN-03/B18: P-ADMIN reads zero rows');
reset role; select nexus_test.login_as(2);
select is(nexus_test.rls_total(), 0, 'FN-03: P-SUPER reads zero rows');
reset role; select nexus_test.login_as(6);
select is(nexus_test.rls_total(), 0, 'FN-03: P-SEKDEP reads zero rows');
reset role; select nexus_test.login_as(7);
select is(nexus_test.rls_total(), 0, 'FN-03: P-KADEP-OPS reads zero rows');
reset role; select nexus_test.login_as(8);
select is(nexus_test.rls_total(), 0, 'FN-03: P-STAFF-LOG reads zero rows');
reset role; select nexus_test.login_as(20);
select is(nexus_test.rls_total(), 0, 'a Kepala Divisi reads zero rows');
reset role; select nexus_test.login_as(16);
select is(nexus_test.rls_total(), 0, 'FN-03: P-LECT reads zero rows');
reset role; select nexus_test.login_as(14);
select is(nexus_test.rls_total(), 0, 'FN-04: P-OLD (previous Treasurer) reads zero rows, also of HIS old period');
reset role; select nexus_test.login_as(15);
select is(nexus_test.rls_total(), 0, 'FN-04: P-INACTIVE reads zero rows');
reset role; select nexus_test.login_as(17);
select is(nexus_test.rls_total(), 0, 'FN-04: P-UNLINKED reads zero rows');
reset role; select nexus_test.logout();
set local role authenticated;
select is(nexus_test.rls_total(), 0, 'FN-04: a token without a subject reads zero rows');
reset role;
set local role anon;
select throws_ok('select * from nexus.finance_entries', '42501', null, 'FN-04: anon has no access');
reset role;
select nexus_test.login_as(3);
select is((select count(*) from nexus.finance_entries), :all_entries::bigint, 'K1 a: P-KETUM reads every entry of every period');
select is((select count(*) from nexus.finance_entry_files), :visible_files::bigint, 'F4: ... every proof except withdrawn ones');
select is((select count(*) from nexus.finance_entry_history), :visible_history::bigint, 'F4: ... and the history without withdraw rows');
select is((select count(*)::int from nexus.finance_counter), 0, 'FN-35: viewers do not read the counter');
reset role; select nexus_test.login_as(5);
select is((select count(*) from nexus.finance_entries), :all_entries::bigint, 'the Treasurer reads every entry');
select is((select count(*) from nexus.finance_entry_files), :all_files::bigint, 'F4: ... including withdrawn proofs');
select is((select count(*) from nexus.finance_entry_history), :all_history::bigint, '... and every history row');
select is((select count(*)::int from nexus.finance_counter), 1, '... and the counter');
reset role; select nexus_test.logout();

-- =============================================================================================
-- 14. Storage (private bucket; FN-25, FN-26, A-FN6)
-- =============================================================================================
select (select storage_path from nexus.finance_entry_files where id = :f_exp1) as withdrawn_path \gset
select (select storage_path from nexus.finance_entry_files where entry_id = nexus_test.id('e_exp1') and not is_withdrawn order by id limit 1) as proof_path \gset
-- The refusal tests above left 9 unattached objects in P-BEND's folder; one more (below) would hit the A-FN6 cap.
-- Age them past 24 hours so the upload checks below start from a clean window.
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count(format($$bucket_id = 'nexus-finance-proofs' and name like %L and name not in (select storage_path from nexus.finance_entry_files)$$,
                                      nexus_test.mid(5)::text || '/%')), 9, 'A-FN6: refused saves leave their uploads unattached (9 in P-BEND''s folder)')
  else skip('Storage not installed', 1) end;
select nexus_test.sto(format($$update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'nexus-finance-proofs' and name like %L$$,
                             nexus_test.mid(5)::text || '/%')) as sto_result \gset
select nexus_test.fpath(5) as unattached_path \gset
select nexus_test.login_as(5);
select ok(nexus.finance_proof_can_upload(nexus_test.mid(5)::text || '/' || gen_random_uuid()::text || '.jpg'), 'the Treasurer uploads into her own folder');
select ok(not nexus.finance_proof_can_upload(nexus_test.mid(12)::text || '/' || gen_random_uuid()::text || '.jpg'), '... never into another member''s folder');
select ok(not nexus.finance_proof_can_upload(nexus_test.mid(5)::text || '/' || gen_random_uuid()::text || '.docx')
          and not nexus.finance_proof_can_upload(nexus_test.mid(5)::text || '/../x.jpg')
          and not nexus.finance_proof_can_upload(null), 'FN-25: bad names and types refused');
select ok(nexus.finance_proof_can_read(:'proof_path') and nexus.finance_proof_can_read(:'withdrawn_path'), 'the Treasurer reads proofs, also withdrawn ones');
select ok(not nexus.finance_proof_can_read(:'unattached_path'), 'an unattached upload is nobody''s proof yet (not even the uploader''s)');
reset role; select nexus_test.login_as(3);
select ok(nexus.finance_proof_can_read(:'proof_path') and not nexus.finance_proof_can_read(:'withdrawn_path'),
  'FN-26/F4: a viewer reads visible proofs, not the withdrawn one');
select ok(not nexus.finance_proof_can_upload(nexus_test.mid(3)::text || '/' || gen_random_uuid()::text || '.jpg'), 'viewers cannot upload');
reset role; select nexus_test.login_as(11);
select ok(not nexus.finance_proof_can_upload(nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.jpg')
          and not nexus.finance_proof_can_read(:'proof_path'), 'FN-26: P-PLAIN can neither upload nor read');
reset role; select nexus_test.login_as(6);
select ok(not nexus.finance_proof_can_read(:'proof_path'), 'FN-26: P-SEKDEP cannot read');
reset role; select nexus_test.login_as(14);
select ok(not nexus.finance_proof_can_read(:'proof_path'), 'FN-26: P-OLD cannot read');
reset role; select nexus_test.login_as(15);
select ok(not nexus.finance_proof_can_read(:'proof_path'), 'L1: P-INACTIVE cannot read');
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.sto_val($$select public::text || ':' || coalesce(file_size_limit::text, '-') || ':' || coalesce(array_to_string(allowed_mime_types, ','), '-')
                               from storage.buckets where id = 'nexus-finance-proofs'$$),
          'false:5242880:application/pdf,image/jpeg,image/png', 'FN-26/K5: the bucket is private, 5 MB, PDF/JPG/PNG')
  else skip('Storage not installed (load tests/support/storage_stub.sql)', 1) end;
select case when nexus_test.has_storage()
  then is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'nexus\_finance%'
           and cmd in ('INSERT', 'SELECT') and roles = '{authenticated}' and coalesce(qual, '') || coalesce(with_check, '') ~ 'nexus-finance-proofs'), 2,
          'two policies (insert, select) for authenticated, scoped to the bucket; none for update or delete')
  else skip('Storage not installed', 1) end;
select nexus_test.login_as(5);
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name, metadata) values ('nexus-finance-proofs', %L, '{"size": 1000, "mimetype": "image/jpeg"}')$$,
                                nexus_test.mid(5)::text || '/' || gen_random_uuid()::text || '.jpg')), 'ok', 'Storage: the Treasurer uploads into her folder')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name, metadata) values ('nexus-finance-proofs', %L, '{"size": 1000, "mimetype": "image/jpeg"}')$$,
                                nexus_test.mid(12)::text || '/' || gen_random_uuid()::text || '.jpg')), '42501', 'Storage: ... not into another folder')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto($$delete from storage.objects where bucket_id = 'nexus-finance-proofs'$$), 'ok', 'Storage: a client delete matches nothing (no policy)')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.login_as(3);
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'proof_path')) = 1 and nexus_test.sto_count(format('name = %L', :'withdrawn_path')) = 0
          and nexus_test.sto_count(format('name = %L', :'unattached_path')) = 0,
          'Storage: a viewer sees visible proofs only (not withdrawn, not unattached)')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-finance-proofs', %L)$$,
                                nexus_test.mid(3)::text || '/' || gen_random_uuid()::text || '.jpg')), '42501', 'Storage: a viewer cannot upload')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.login_as(11);
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count($$bucket_id = 'nexus-finance-proofs'$$), 0, 'Storage: P-PLAIN sees no object')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-finance-proofs', %L)$$,
                                nexus_test.mid(11)::text || '/' || gen_random_uuid()::text || '.jpg')), '42501', 'Storage: P-PLAIN cannot upload')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
set local role anon;
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count($$bucket_id = 'nexus-finance-proofs'$$), 0, 'Storage: anon sees nothing')
  else skip('Storage not installed', 1) end;
reset role;
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'proof_path')) = 1, 'Storage: nothing was deleted')
  else skip('Storage not installed', 1) end;
-- A-FN6: 10 unattached uploads per member per 24 h (P-BEND-SEK's folder holds one unattached object from section 9)
select count(nexus_test.fpath(12)) as flood from generate_series(1, 10) \gset
select nexus_test.login_as(12);
select case when nexus_test.has_storage()
  then ok(not nexus.finance_proof_can_upload(nexus_test.mid(12)::text || '/' || gen_random_uuid()::text || '.jpg'), 'A-FN6: no 11th unattached upload in 24 hours')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
select nexus_test.sto(format($$update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'nexus-finance-proofs' and name like %L$$,
                             nexus_test.mid(12)::text || '/%')) as sto_result \gset
select nexus_test.login_as(12);
select case when nexus_test.has_storage()
  then ok(nexus.finance_proof_can_upload(nexus_test.mid(12)::text || '/' || gen_random_uuid()::text || '.jpg'), 'A-FN6: uploads older than 24 hours no longer count')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._fn_ensure_proof_bucket()'), 'no_error', 'migration guard: re-running with an identical bucket is a no-op')
  else is(nexus._fn_ensure_proof_bucket(), 'skipped', 'without Storage the guard skips') end;
select nexus_test.sto($$update storage.buckets set public = true where id = 'nexus-finance-proofs'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._fn_ensure_proof_bucket()'), 'bucket_conflict', 'an existing PUBLIC bucket stops the migration')
  else skip('Storage not installed', 1) end;
select nexus_test.sto($$update storage.buckets set public = false where id = 'nexus-finance-proofs'$$) as sto_result \gset

-- =============================================================================================
-- 15. Period switch and handover (F8; FN-23, FN-11, FN-38, AC-39..AC-41), no active period (FN-22)
-- =============================================================================================
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(3);
insert into public.assignments (member_id, org_unit_id, position_id, period_id) values
  (nexus_test.mid(11), nexus_test.unit('BPH PMK ITERA'), nexus_test.pos('bph', 'Bendahara Umum 1'), nexus_test.period(3)),
  (nexus_test.mid(3),  nexus_test.unit('BPH PMK ITERA'), nexus_test.pos('bph', 'Ketua Umum'),       nexus_test.period(3));
select nexus_test.login_as(11);
select is(nexus_test.keys(), 'view | manage | export', 'FN-23/AC-39: the new Treasurer holds Finance on the first request');
select ok((select not has_opening and previous_period_label = '2091/2092' and previous_closing_balance = 2050001 and entry_count = 0
           from nexus.finance_summary()),
  'F8.2/K3 a: the new period starts without Saldo awal; the hint is the closing balance of 2091/2092 (2.050.001)');
select nexus_test.rec('n_exp', 'expense', '50000', 'Transport');
select ok((select number_text = 'KAS-0012' and period_id = nexus_test.period(3) from nexus.finance_entries where id = nexus_test.id('n_exp')),
  'FN-23: recorded in the new period; the number continues');
select is(nexus_test.tot(), '0/0/50000/-50000', 'FN-11/A-FN9: a negative Total Saldo is allowed (Saldo awal not yet recorded)');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_void(%L, %L)', nexus_test.id('e_inc1'), 'x')), 'closed_period',
  'FN-23/AC-41: last period''s entries are read-only now');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_add_proof(%L, %L)', nexus_test.id('e_inc1'), nexus_test.files(11, 1))), 'closed_period',
  '... no proof can be added');
select is(nexus_test.hint_of(format('select * from nexus.finance_entry_withdraw_proof(%s, %L)',
                                    (select min(id) from nexus.finance_entry_files where entry_id = nexus_test.id('e_exp1') and not is_withdrawn), 'x')),
  'closed_period', '... or withdrawn');
select ok((select (d -> 'actions' ->> 'can_correct')::boolean and not (d -> 'actions' ->> 'can_void')::boolean
           from nexus.finance_entry_detail(nexus_test.id('e_inc1')) d), 'F5: the new Treasurer can only correct it in the new period');
select is(nexus_test.tot(nexus_test.period(2)), '1300000/2500001/1750000/2050001', 'L8: the new Treasurer reads the old period''s totals');
reset role; select nexus_test.login_as(5);
select is(nexus_test.keys(), '- | - | -', 'FN-23/AC-40: the old Treasurer has no access after the switch');
select is(nexus_test.rls_total(), 0, '... and reads zero rows');
reset role; select nexus_test.login_as(4);
select is(nexus_test.keys(), '- | - | -', 'last period''s Sekjen without a new assignment has nothing');
reset role; select nexus_test.login_as(3);
select ok((select period_label = '2092/2093' and expense_total = 50000 from nexus.finance_summary()), 'FN-23: the Dashboard card shows the active period');
-- FN-38: the recorder is deactivated; the entries and the name stay
reset role; select nexus_test.logout();
update public.members set is_active = false where id = nexus_test.mid(5);
select nexus_test.login_as(11);
select ok((select d ->> 'created_by_name' = 'Test Persona 5' and d ->> 'status' = 'active' from nexus.finance_entry_detail(nexus_test.id('e_inc1')) d),
  'FN-38/AC-45: entries of a deactivated recorder remain and show the name');
reset role; select nexus_test.logout();
update public.members set is_active = true where id = nexus_test.mid(5);
-- F8.3: an admin re-activates the older period in PI-CORE: it becomes writable again, the newer one read-only
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(2);
select nexus_test.login_as(5);
select ok((select (d -> 'actions' ->> 'can_void')::boolean from nexus.finance_entry_detail(nexus_test.id('e_inc1')) d)
          and (select not (d ->> 'is_active_period')::boolean and not (d -> 'actions' ->> 'can_void')::boolean
               from nexus.finance_entry_detail(nexus_test.id('n_exp')) d),
  'F8.3: period 2 is writable again, period 3 read-only; totals need no repair');
reset role; select nexus_test.login_as(11);
select is(nexus_test.keys(), '- | - | -', 'F8.3: ... and the period-3 Treasurer has nothing');
-- FN-22/R4: no active period
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
select nexus_test.login_as(5);
select is(nexus_test.hint_of($$select * from nexus.finance_entry_record(gen_random_uuid(), 'income', nexus_test.d(0), '1', 'x')$$), 'permission_required',
  'FN-22/R11: without an active period nobody records (officers'' rules match nothing)');
select is(nexus_test.hint_of('select * from nexus.finance_summary()'), 'permission_required', 'R4/E4: ... and Treasurer and BPH read nothing');
select ok(not nexus.finance_proof_can_upload(nexus_test.mid(5)::text || '/' || gen_random_uuid()::text || '.jpg'), 'no upload without an active period');
select is(nexus_test.rls_total(), 0, '... and RLS returns zero rows');
reset role; select nexus_test.logout();
update public.periods set is_active = true where id = nexus_test.period(3);

select * from finish();
rollback;
