-- pgTAP tests for the Inventory and Borrowing module:
--   20261107100000_nexus_borrowing_access_rules.sql  (key borrowing.handle, D30 retired, D34-D36)
--   20261107100100_nexus_inventory_borrowing.sql     (tables, RLS, state machine, reads, exports)
--   20261107100200_nexus_inventory_storage.sql       (private evidence bucket + Storage policies)
--   20261108100000_nexus_inventory_borrowing_fixes.sql (detail by reference, once-only correction and
--                                                      its hints, catalog export = list, borrowing period
--                                                      filter; section 15)
--   20261109100000_nexus_export_totals_and_evidence_window.sql (export column total_count, evidence
--                                                      upload cap counts the last 24 hours only;
--                                                      section 14 "Fix 1" and section 16)
-- Spec: docs/modules/inventory-borrowing.md (rev. 2) sections 2-5, 8, 11 (IB-01..IB-48), 11b; D-022.
--
-- LOCAL / THROWAWAY DATABASE ONLY. Same guards as the other two files: it refuses to run without
-- nexus.allow_destructive_tests = 'yes', stops if ANY account or member has a non-test email, and stops
-- on the NEXUS dev stack (@nexus.test accounts). Everything (personas in PI-CORE tables, catalog,
-- requests, logs, helper schema nexus_test) is rolled back. Sequences (INV-/PJM- numbers) are NOT
-- rolled back by Postgres; tests therefore check the code FORMAT and ORDER, never fixed numbers.
--   PGOPTIONS='-c nexus.allow_destructive_tests=yes' psql "<throwaway url>" -f supabase/tests/nexus_inventory_borrowing.test.sql
-- Storage policy tests run only when a storage schema exists (load tests/support/storage_stub.sql
-- before the migrations in a throwaway container); otherwise they are reported as skipped.
--
-- Personas (auth uid 10000000-...-NN, member id 20000000-...-NN), as in the other files plus:
--   19 P-KADIV-LOG  = Kepala Divisi in Logistik        (head, D35)
--   20 P-KADIV-AKO  = Kepala Divisi in Akomodasi       (head, D35)
--   21 P-SEKDEP-OPS = Sekretaris Departemen in Departemen Operasional (Operations, not a head)
--   P-OLD (14) also holds Staff in Logistik in the OLD period (period 1).

\set ON_ERROR_STOP on
begin;

-- W1 guard (see tests/README.md).
do $$
begin
  if coalesce(current_setting('nexus.allow_destructive_tests', true), '') <> 'yes' then
    raise exception 'nexus_inventory_borrowing.test.sql writes test rows into PI-CORE tables: local throwaway database only. Set nexus.allow_destructive_tests=yes (see supabase/tests/README.md) to run it.';
  end if;
end
$$;

-- Data guard (security review M1).
do $$
begin
  if exists (select 1 from auth.users u where u.email is null or u.email !~* '@(example\.test|nexus\.test)$')
     or exists (select 1 from public.members m where m.email is not null and m.email !~* '@(example\.test|nexus\.test)$') then
    raise exception 'nexus_inventory_borrowing.test.sql: found a non-test email address, so this is NOT a throwaway local database. Nothing was written.';
  end if;
end
$$;

-- Dev-stack guard (review L5).
do $$
begin
  if exists (select 1 from auth.users u where u.email ~* '@nexus\.test$')
     or exists (select 1 from public.members m where m.email ~* '@nexus\.test$') then
    raise exception 'nexus_inventory_borrowing.test.sql: found the NEXUS dev stack seed accounts (@nexus.test). Run it only in a fresh throwaway container (see supabase/tests/README.md). Nothing was written.';
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
-- 'ok' or the SQLSTATE; a successful statement KEEPS its effects.
create function nexus_test.outcome(p_sql text) returns text language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;

-- Named ids, so dollar-quoted statements can refer to fixtures.
create table nexus_test.ids (name text primary key, id uuid not null);
create function nexus_test.put(p_name text, p_id uuid) returns uuid language sql security definer set search_path = ''
as $$ insert into nexus_test.ids values (p_name, p_id) on conflict (name) do update set id = excluded.id returning id $$;
create function nexus_test.id(p_name text) returns uuid language sql stable security definer set search_path = ''
as $$ select i.id from nexus_test.ids i where i.name = p_name $$;
-- Request state as the owner sees it (bypasses RLS on purpose; test oracle only).
create function nexus_test.ver(p_name text) returns int language sql stable security definer set search_path = ''
as $$ select r.version from nexus.borrowing_requests r where r.id = nexus_test.id(p_name) $$;
create function nexus_test.st(p_name text) returns text language sql stable security definer set search_path = ''
as $$ select r.status from nexus.borrowing_requests r where r.id = nexus_test.id(p_name) $$;
create function nexus_test.d(n int) returns date language sql stable security definer set search_path = ''
as $$ select nexus._ib_today() + n $$;
create function nexus_test.line(p_req text, p_item text) returns uuid language sql stable security definer set search_path = ''
as $$ select l.id from nexus.borrowing_request_lines l where l.request_id = nexus_test.id(p_req) and l.item_id = nexus_test.id(p_item) $$;
create function nexus_test.stock(p_item text, p_cond text) returns int language sql stable security definer set search_path = ''
as $$ select s.quantity from nexus.inventory_stock s where s.item_id = nexus_test.id(p_item) and s.condition = p_cond $$;
-- The n-th unit (by code) of an item.
create function nexus_test.unit_n(p_item text, n int) returns uuid language sql stable security definer set search_path = ''
as $$ select u.id from nexus.inventory_units u where u.item_id = nexus_test.id(p_item) order by u.code offset n - 1 limit 1 $$;
create function nexus_test.unit_row(p_unit uuid) returns nexus.inventory_units language sql stable security definer set search_path = ''
as $$ select u from nexus.inventory_units u where u.id = p_unit $$;
create function nexus_test.has_storage() returns boolean language sql stable
as $$ select to_regclass('storage.objects') is not null $$;
-- A fresh evidence path in the request's folder; with Storage present, also the "uploaded" object.
create function nexus_test.photo(p_req text) returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v text := nexus_test.id(p_req)::text || '/' || gen_random_uuid()::text || '.jpg';
begin
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)'
      using 'nexus-borrowing-evidence', v, '{"size": 250000, "mimetype": "image/jpeg"}'::jsonb;
  end if;
  return v;
end
$$;
-- Return-outcome JSON builders.
create function nexus_test.q(p_line uuid, p_outcome text, p_qty int, p_cond text default null, p_note text default null, p_photos text[] default '{}')
returns jsonb language sql immutable
as $$ select jsonb_strip_nulls(jsonb_build_object('line_id', p_line, 'outcome', p_outcome, 'quantity', p_qty,
                                                  'resulting_condition', p_cond, 'note', p_note))
             || jsonb_build_object('photos', to_jsonb(p_photos)) $$;
create function nexus_test.u(p_line uuid, p_unit uuid, p_outcome text, p_cond text default null, p_note text default null, p_photos text[] default '{}')
returns jsonb language sql immutable
as $$ select jsonb_strip_nulls(jsonb_build_object('line_id', p_line, 'unit_id', p_unit, 'outcome', p_outcome,
                                                  'resulting_condition', p_cond, 'note', p_note))
             || jsonb_build_object('photos', to_jsonb(p_photos)) $$;
-- The 7 module keys the caller holds (sorted).
create function nexus_test.keys() returns text[] language sql stable
as $$
  select coalesce(array_agg(k order by k), '{}')
  from unnest(array['inventory.view', 'inventory.manage', 'inventory.export', 'borrowing.view_all',
                    'borrowing.approve', 'borrowing.handle', 'borrowing.export']) k
  where nexus.has_permission(k)
$$;
create function nexus_test.log_count() returns int language sql stable security definer set search_path = ''
as $$ select count(*)::int from nexus.inventory_borrowing_export_logs $$;
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
-- First column of a dynamic query as text ('' when Storage is absent), for storage.buckets probes.
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
-- Creates n requests as the current caller, named <prefix>1..<prefix>n (open-request cap test).
create function nexus_test.create_n(p_prefix text, n int, p_item text, p_day int) returns int language plpgsql
as $$
begin
  for i in 1 .. n loop
    perform nexus_test.put(p_prefix || i, (select request_id from nexus.borrowing_request_create(nexus_test.d(p_day), nexus_test.d(p_day),
      'Uji batas', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id(p_item), 'quantity', 1)))));
  end loop;
  return n;
end
$$;
-- Creates and cancels n requests as the current caller (daily-cap test); returns how many succeeded.
create function nexus_test.create_cancel(n int, p_item text, p_day int) returns int language plpgsql
as $$
declare
  v_id uuid;
  v_ok int := 0;
begin
  for i in 1 .. n loop
    select request_id into v_id from nexus.borrowing_request_create(nexus_test.d(p_day), nexus_test.d(p_day), 'Uji batas harian',
      jsonb_build_array(jsonb_build_object('item_id', nexus_test.id(p_item), 'quantity', 1)));
    perform nexus.borrowing_request_cancel(v_id, (select r.version from nexus.borrowing_requests r where r.id = v_id));
    v_ok := v_ok + 1;
  end loop;
  return v_ok;
end
$$;
grant execute on all functions in schema nexus_test to authenticated;
grant usage on schema nexus_test to anon;
grant execute on function nexus_test.has_storage(), nexus_test.sto_count(text) to anon;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select nexus_test.uid(n), 'nexus-test-' || n || '@example.test', 'authenticated', 'authenticated'
from generate_series(1, 21) n;

insert into public.members (id, user_id, full_name, email, access_level, member_type)
select nexus_test.mid(n), nexus_test.uid(n), 'Test Persona ' || n, 'nexus-test-' || n || '@example.test',
       (case n when 1 then 'admin' when 2 then 'super_admin' else 'member' end)::public.access_level,
       (case n when 16 then 'lecturer' else 'student' end)::public.member_type
from generate_series(1, 21) n
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
  (14, 'Logistik',                    'division',   'Staff',                 1),
  (15, 'Departemen Eksternal',        'department', 'Kepala Departemen',     2),
  (18, 'Departemen Pelayanan Khusus', 'department', 'Sekretaris Departemen', 2),
  (18, 'Biro Kewirausahaan',          'bureau',     'Sekretaris Biro',       2),
  (19, 'Logistik',                    'division',   'Kepala Divisi',         2),
  (20, 'Akomodasi',                   'division',   'Kepala Divisi',         2),
  (21, 'Departemen Operasional',      'department', 'Sekretaris Departemen', 2)
) as v(n, unit_name, unit_type, position_name, p);
update public.members set is_active = false where id = nexus_test.mid(15);

select is((select count(*)::int from public.assignments where member_id::text like '20000000-%'), 20,
  'fixtures: 20 persona assignments created (PI-CORE names match the test)');

-- Review M3: the Storage stub refuses any database with an account or member outside @example.test,
-- e.g. the NEXUS dev stack (@nexus.test). Included here and rolled back to a savepoint.
savepoint stub_guard;
insert into public.members (id, full_name, email) values (gen_random_uuid(), 'Akun Dev Stack', 'kadep@nexus.test');
\set ON_ERROR_STOP off
\ir support/storage_stub.sql
\set ON_ERROR_STOP on
rollback to savepoint stub_guard;
release savepoint stub_guard;  -- back to the main transaction (no lingering subtransaction)
select ok(:'LAST_ERROR_MESSAGE' ~ 'outside @example\.test',
  'M3: the Storage stub refuses a database with a @nexus.test member (and creates nothing)');

-- =============================================================================================
-- 1. Structure, privileges, catalog amendment (D-022)
-- =============================================================================================
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'IB-48: RLS is enabled on every nexus table');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind = 'r'
             and c.relname in ('inventory_categories', 'inventory_locations', 'inventory_items', 'inventory_units',
                               'inventory_stock', 'inventory_item_history', 'borrowing_requests', 'borrowing_request_lines',
                               'borrowing_return_batches', 'borrowing_line_returns', 'borrowing_line_units',
                               'borrowing_return_reversals', 'borrowing_evidence_photos', 'borrowing_extensions',
                               'borrowing_status_history', 'inventory_borrowing_export_logs', 'retired_default_rules')), 17,
  'the 17 new tables exist');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p')
             and has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')), 0,
  'IB-41/L11: authenticated cannot write any nexus table directly');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p')
             and has_table_privilege('service_role', c.oid, 'insert, update, delete, truncate')), 0,
  'W2: service_role cannot write any nexus table');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'nexus' and c.relkind in ('r', 'p', 'v', 'S')
             and has_table_privilege('anon', c.oid, 'select')), 0, 'anon reads nothing in nexus');
select ok(not has_table_privilege('authenticated', 'nexus.inventory_borrowing_export_logs', 'select'),
  'IB-44: the export log has no client grant (read through the database only)');
select ok(not has_sequence_privilege('authenticated', 'nexus.inventory_code_seq', 'usage, select, update')
          and not has_sequence_privilege('authenticated', 'nexus.borrowing_reference_seq', 'usage, select, update'),
  'IB-09: clients cannot touch the INV / PJM sequences');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname like '\_%'
             and has_function_privilege('authenticated', p.oid, 'execute')), 0,
  'internal nexus._* helpers are not executable by clients');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname like 'inventory\_%' or p.proname like 'borrowing\_%')
             and (not has_function_privilege('authenticated', p.oid, 'execute')
                  or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute')
                  or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))), 0,
  'module API: EXECUTE for authenticated only (not anon, service_role, PUBLIC)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname like 'inventory\_%' or p.proname like 'borrowing\_%')), 46,
  'module API has 46 functions (44 + borrowing_request_detail_by_ref + borrowing_period_list, 2026-11-08)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)), 0,
  'D-010: every SECURITY DEFINER function pins search_path to empty');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.prosrc ~* '(\m(email|phone|nim|nip|audit_log|org_settings|grants_admin)\M|private\.)'), 0,
  'IB-42/L4: no nexus function body mentions email, phone, nim, nip, audit_log, org_settings, grants_admin, private.*');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proargnames && array['email', 'phone', 'nim', 'nip', 'p_email', 'p_phone',
                                                                'contact_phone', 'contact_email', 'p_contact_phone']), 0,
  'IB-42/IB-46: no function takes or returns a phone or email');
select is((select count(*)::int from information_schema.columns c
           where c.table_schema = 'nexus' and c.column_name ~* '(email|phone|nim|nip|whatsapp)'), 0,
  'IB-42/IB-46: no nexus table has a contact or identity-number column');
select is((select count(*)::int from information_schema.columns c
           where c.table_schema = 'nexus' and (c.table_name like 'inventory%' or c.table_name like 'borrowing%')
             and c.column_name ~* '(deposit|fine|payment|price|amount)'), 0,
  'IB-31: no deposit, fine or payment column exists in Inventory and Borrowing (Finance has its own amount, D-028)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname like 'inventory\_%' or p.proname like 'borrowing\_%')
             and p.oid <> 'nexus.borrowing_request_detail_by_ref(text)'::regprocedure
             and (p.proargnames && array['p_code', 'p_reference', 'p_requester_member_id', 'p_requester', 'p_member_id'])), 0,
  'IB-09/IB-14: no function lets a client type a code, a reference or a requester id');
select ok((select p.provolatile = 's' and p.prosecdef and p.pronargs = 1
           from pg_proc p where p.oid = 'nexus.borrowing_request_detail_by_ref(text)'::regprocedure),
  'Fix 1 (2026-11-08): the only function that takes a reference is the read-only (STABLE) detail lookup');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname !~ '^_' and 'p_mode' = any (p.proargnames)), array['inventory_item_create'],
  'IB-08/R22: the mode is only ever given at creation');
select is((select array_agg(a order by a) from pg_proc p, unnest(p.proargnames[4:]) a
           where p.oid = 'nexus.inventory_item_availability(uuid, date, date)'::regprocedure),
          array['free_qty', 'held_qty', 'item_id', 'lendable_qty'],
  'IB-18/R8: availability returns counts only (no requester column)');
select is((select array_agg(a order by a) from pg_proc p, unnest(p.proargnames) a
           where p.oid = 'nexus.inventory_status_counts()'::regprocedure),
          array['good_count', 'good_on_loan_count', 'item_count', 'needs_service_count'],
  'IB-45: the Dashboard function returns counts only, no percentage');

-- Catalog amendment (AC-77)
select is((select count(*)::int from nexus.permissions), 22, 'AC-77: the catalog has 22 keys');
select ok((select not allow_baseline and not is_sensitive and includes_key = 'borrowing.view_all' and requires_key is null
           from nexus.permissions where key = 'borrowing.handle'),
  'A-IB36: borrowing.handle = power key (never baseline), not sensitive, includes view_all');
select ok((select description ~ 'correct a wrong return once' and description !~* 'handover \(' and description !~* 'wrong handover'
           from nexus.permissions where key = 'borrowing.handle'),
  'owner 2026-11-07: borrowing.handle corrects a wrong RETURN once; no handover correction');
select is((select description from nexus.permissions where key = 'borrowing.approve'),
  'Approve, reject, extend. Includes view_all. Never own requests (L6).', 'borrowing.approve now means approve, reject, extend');
select throws_ok($$insert into nexus.permissions (key, module, label, description, is_sensitive, allow_baseline)
                   values ('minutes.handle', 'minutes', 'Handle', 'test', false, true)$$, '23514', null,
  'L12: the catalog refuses a baseline-safe *.handle key');
select ok((select not r.is_enabled from nexus.access_rules r where r.default_code = 'D30')
          and exists (select 1 from nexus.retired_default_rules x where x.default_code = 'D30'),
  'D-022: D30 is retired (disabled and listed), not deleted');
select is((select count(*)::int from nexus.access_rules where default_code is not null), 37,
  'AC-77: 37 default rules exist (D01-D37; D37 = minutes, D-027)');
select is((select count(*)::int from nexus.access_rules where default_code is not null and is_enabled), 36,
  'AC-77: 36 of them are enabled');
select is((select count(*)::int from nexus.access_rule_log where action = 'seed' and actor_member_id is null), 37,
  'seed: 37 seed log rows');
select is((select count(*)::int from nexus.access_rule_log l join nexus.access_rules r on r.id = l.rule_id
           where r.default_code = 'D30' and l.action = 'disable' and l.actor_member_id is null), 1,
  'the retirement of D30 is logged once (actor = migration)');
select ok((select bool_and(r.subject_type = 'org_unit' and r.org_unit_id = nexus_test.unit('Departemen Operasional')
                           and r.include_child_units and r.scope = 'all' and r.note is not null and r.is_enabled)
           from nexus.access_rules r where r.default_code in ('D34', 'D35', 'D36')),
  'D34-D36: Departemen Operasional + child units, scope all, with a written reason (L12)');
select is((select array_agg(r.permission_key || ':' || coalesce(po.name, '-') order by r.default_code)
           from nexus.access_rules r left join public.positions po on po.id = r.position_id
           where r.default_code in ('D34', 'D35', 'D36')),
          array['borrowing.approve:Kepala Departemen', 'borrowing.approve:Kepala Divisi', 'borrowing.handle:-'],
  'D34 = Kepala Departemen approves, D35 = Kepala Divisi approves, D36 = any position handles');

-- anon cannot reach anything
reset role; select nexus_test.logout();
set local role anon;
select throws_ok($$select * from nexus.inventory_item_list()$$, '42501', null, 'IB-03: anon cannot call the catalog');
select throws_ok($$select * from nexus.borrowing_my_requests()$$, '42501', null, 'IB-03: anon cannot call own requests');
reset role;

-- can_process_request keeps borrowing.handle OUT of L6 (D-022)
select nexus_test.login_as(8);
select ok(not nexus.can_process_request('borrowing.handle', nexus_test.mid(11)),
  'L6 helper: borrowing.handle is not an approval key (never answers true)');

-- Admin side: warnings and restore (B28 must not bring D30 back)
reset role; select nexus_test.login_as(1);
select is((select array_agg(permission_key || '=' || holder_count || '/' || coalesce(warning, 'ok') order by permission_key)
           from nexus.access_rule_warnings() where permission_key like 'borrowing.%'),
          array['borrowing.approve=3/ok', 'borrowing.handle=7/ok'],
  'AC-64: approve held by the 3 heads, handle by the 7 Operations holders; both watched');

-- =============================================================================================
-- 2. Who holds what (AC-73, AC-74, IB-01, IB-04, IB-20, IB-26; spec section 2 table)
-- =============================================================================================
reset role; select nexus_test.login_as(7);
select is(nexus_test.keys(), array['borrowing.approve', 'borrowing.export', 'borrowing.handle', 'borrowing.view_all',
                                   'inventory.export', 'inventory.manage', 'inventory.view'],
  'P-KADEP-OPS: everything (head: approve; Operations: handle, manage, exports)');
reset role; select nexus_test.login_as(19);
select is(nexus_test.keys(), array['borrowing.approve', 'borrowing.export', 'borrowing.handle', 'borrowing.view_all',
                                   'inventory.export', 'inventory.manage', 'inventory.view'],
  'AC-73: Kepala Divisi Logistik approves (D35) and is Operations');
reset role; select nexus_test.login_as(20);
select ok('borrowing.approve' = any (nexus_test.keys()), 'AC-73: Kepala Divisi Akomodasi approves (D35)');
reset role; select nexus_test.login_as(8);
select is(nexus_test.keys(), array['borrowing.export', 'borrowing.handle', 'borrowing.view_all',
                                   'inventory.export', 'inventory.manage', 'inventory.view'],
  'AC-74/IB-20: P-STAFF-LOG handles and manages but does not approve');
reset role; select nexus_test.login_as(9);
select is(nexus_test.keys(), array['borrowing.export', 'borrowing.handle', 'borrowing.view_all',
                                   'inventory.export', 'inventory.manage', 'inventory.view'],
  'AC-74: Staff in Akomodasi handles, does not approve');
reset role; select nexus_test.login_as(21);
select is(nexus_test.keys(), array['borrowing.export', 'borrowing.handle', 'borrowing.view_all',
                                   'inventory.export', 'inventory.manage', 'inventory.view'],
  'AC-73/AC-74: Sekretaris Departemen Operasional handles, does not approve');
reset role; select nexus_test.login_as(13);
select is(nexus_test.keys(), array['borrowing.export', 'borrowing.handle', 'borrowing.view_all',
                                   'inventory.export', 'inventory.manage', 'inventory.view'],
  'AC-36: P-OPS-BPH handles (Staff is not a head)');
reset role; select nexus_test.login_as(3);
select is(nexus_test.keys(), array['borrowing.export', 'borrowing.view_all', 'inventory.export', 'inventory.view'],
  'IB-04: P-KETUM views all requests and exports both, nothing else');
reset role; select nexus_test.login_as(10);
select is(nexus_test.keys(), array['inventory.view'], 'AC-74: P-STAFF-PUB (outside Operations) has the baseline only');
reset role; select nexus_test.login_as(11);
select is(nexus_test.keys(), array['inventory.view'], 'IB-01: P-PLAIN has the baseline only');
reset role; select nexus_test.login_as(16);
select is(nexus_test.keys(), array['inventory.view'], 'IB-01/A-IB3: P-LECT has the baseline only');
reset role; select nexus_test.login_as(1);
select is(nexus_test.keys(), array['inventory.view'], 'IB-05/B18: P-ADMIN without assignment has the baseline only');
reset role; select nexus_test.login_as(14);
select is(nexus_test.keys(), array['inventory.view'], 'IB-38: P-OLD (Operations only in the previous period) has the baseline only');
reset role; select nexus_test.login_as(15);
select is(nexus_test.keys(), '{}'::text[], 'IB-03: P-INACTIVE has nothing');
reset role; select nexus_test.login_as(17);
select is(nexus_test.keys(), '{}'::text[], 'IB-03: P-UNLINKED has nothing');

-- =============================================================================================
-- 3. Lists, items, codes, conditions (IB-02, IB-07..IB-13, F2)
-- =============================================================================================
reset role; select nexus_test.login_as(8);
select is((select count(*)::int from nexus.inventory_category_list()), 0, 'IB-10: the category list starts empty');
select is((select count(*)::int from nexus.inventory_location_list()), 0, 'IB-10: the location list starts empty');
select nexus_test.put('cat_a', nexus.inventory_category_add('Kategori Uji A'));
select nexus_test.put('cat_b', nexus.inventory_category_add('Kategori Uji B'));
select nexus_test.put('loc_a', nexus.inventory_location_add('Lokasi Uji A'));
select nexus_test.put('loc_b', nexus.inventory_location_add('Lokasi Uji B'));
select is(nexus_test.hint_of($$select nexus.inventory_category_add('  kategori uji a ')$$), 'duplicate_name',
  'IB-10: names are unique per list, ignoring case and outer spaces');
select is(nexus_test.hint_of($$select nexus.inventory_category_add('   ')$$), 'text_required', 'a blank name is refused');
select is(nexus_test.hint_of(format('select nexus.inventory_location_add(%L)', repeat('x', 81))), 'text_too_long',
  'A-IB43: location names are at most 80 characters');
select ok(nexus.inventory_category_rename(nexus_test.id('cat_a'), 'Kategori Uji Satu') = nexus_test.id('cat_a'),
  'IB-10: Ops renames a category');
select ok(nexus.inventory_category_set_active(nexus_test.id('cat_b'), false) is not null, 'IB-10: Ops deactivates a category');
select is((select array_agg(name || ':' || is_active order by name) from nexus.inventory_category_list()),
          array['Kategori Uji B:false', 'Kategori Uji Satu:true'], 'IB-10: list shows both, A-Z, with the active flag');

reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select nexus.inventory_category_add('X')$$), 'permission_required', 'IB-01: P-PLAIN cannot edit the lists');
select is((select count(*)::int from nexus.inventory_category_list()), 2, 'IB-01: P-PLAIN can read the lists (filters)');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select nexus.inventory_location_add('X')$$), 'permission_required', 'IB-04: P-KETUM cannot edit the lists');

-- Items (as P-STAFF-LOG)
reset role; select nexus_test.login_as(8);
select nexus_test.put('q1', item_id) from nexus.inventory_item_create('quantity', 'Barang Uji Q1', 'Deskripsi uji',
  nexus_test.id('cat_a'), nexus_test.id('loc_a'), '{"good": 4, "needs_service": 1}'::jsonb, null, 'Pembelian uji');
select nexus_test.put('t1', item_id) from nexus.inventory_item_create('tracked', 'Barang Uji T1', null, nexus_test.id('cat_a'), null, null,
  jsonb_build_array(jsonb_build_object('condition', 'good', 'location_id', nexus_test.id('loc_a')),
                    jsonb_build_object('condition', 'good', 'location_id', nexus_test.id('loc_a')),
                    jsonb_build_object('condition', 'good', 'location_id', nexus_test.id('loc_b')),
                    jsonb_build_object('condition', 'needs_service', 'location_id', nexus_test.id('loc_b'))));
select nexus_test.put('q2', item_id) from nexus.inventory_item_create('quantity', 'Barang Uji Q2', p_stock => '{"good": 2}'::jsonb);
select nexus_test.put('q3', item_id) from nexus.inventory_item_create('quantity', 'Barang Uji Q3', p_stock => '{"damaged": 2}'::jsonb);
select nexus_test.put('q4', item_id) from nexus.inventory_item_create('quantity', 'Barang Uji Q4', p_stock => '{"good": 3}'::jsonb);
select nexus_test.put('t2', item_id) from nexus.inventory_item_create('tracked', 'Barang Uji T2',
  p_units => '[{"condition": "good"}, {"condition": "good"}]'::jsonb);

select ok((select code ~ '^INV-[0-9]{4,}$' from nexus.inventory_items where id = nexus_test.id('q1')),
  'IB-09: a quantity item gets one INV code from the database');
select ok((select code is null from nexus.inventory_items where id = nexus_test.id('t1')),
  'IB-07: a tracked item has no item code (its units do)');
select is((select count(*)::int from nexus.inventory_units where item_id = nexus_test.id('t1') and code ~ '^INV-[0-9]{4,}$'), 4,
  'IB-07/IB-09: each of the 4 units has its own INV code');
select ok((select min(substr(u.code, 5)::int) > (select substr(i.code, 5)::int from nexus.inventory_items i where i.id = nexus_test.id('q1'))
           from nexus.inventory_units u where u.item_id = nexus_test.id('t1'))
          and (select count(distinct u.code) = 4 from nexus.inventory_units u where u.item_id = nexus_test.id('t1')),
  'IB-09: codes are unique and increase in creation order');
select is(nexus_test.stock('q1', 'good') + nexus_test.stock('q1', 'needs_service') + nexus_test.stock('q1', 'damaged'), 5,
  'IB-07: a quantity item has one count per condition; total = sum');
select is((select array_agg(kind order by id) from nexus.inventory_item_history where item_id = nexus_test.id('t1')),
          array['created', 'unit_added', 'unit_added', 'unit_added', 'unit_added'],
  'A-IB6: creation writes history rows (item + each unit)');
select ok((select actor_member_id = nexus_test.mid(8) and period_id = nexus_test.period(2) and note = 'Pembelian uji'
           from nexus.inventory_item_history where item_id = nexus_test.id('q1')),
  'history row stores actor, active period and note');

select is(nexus_test.hint_of($$select * from nexus.inventory_item_create('both', 'X', p_stock => '{"good": 1}')$$), 'invalid_mode',
  'IB-07: the mode must be chosen (tracked or quantity)');
select is(nexus_test.hint_of(format('select * from nexus.inventory_item_create(%L, %L, p_location_id => %L, p_units => %L)',
                                    'tracked', 'X', nexus_test.id('loc_a'), '[{"condition": "good"}]')), 'location_per_unit',
  'design G1: a tracked item has its location per unit');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_create('quantity', 'X', p_stock => '{"good": 0}')$$), 'quantity_invalid',
  'design 7.4: a quantity item needs at least one piece');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_create('quantity', 'X', p_stock => '{"good": 10000}')$$), 'quantity_invalid',
  'A-IB43: at most 9999 per condition');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_create('quantity', 'X', p_stock => '{"good": -1}')$$), 'quantity_invalid',
  'negative stock is refused');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_create('quantity', 'X', p_stock => '{"broken": 1}')$$), 'invalid_input',
  'IB-11: only the fixed conditions exist in stock');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_create('tracked', 'X', p_units => '[{"condition": "hilang"}]')$$), 'invalid_condition',
  'IB-11: unit conditions are only good, needs_service, damaged (lost is not a condition)');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_create('quantity', '  ', p_stock => '{"good": 1}')$$), 'text_required',
  'F2.4: name is required');
select is(nexus_test.hint_of(format('select * from nexus.inventory_item_create(%L, %L, p_stock => %L)', 'quantity', repeat('x', 121), '{"good": 1}')),
  'text_too_long', 'F2.4: name at most 120 characters');
select is(nexus_test.hint_of(format('select * from nexus.inventory_item_create(%L, %L, p_category_id => %L, p_stock => %L)',
                                    'quantity', 'X', nexus_test.id('cat_b'), '{"good": 1}')), 'invalid_input',
  'IB-10: a deactivated category cannot be chosen for a new item');
select is(nexus_test.hint_of(format('select * from nexus.inventory_item_create(%L, %L, p_category_id => %L, p_stock => %L)',
                                    'quantity', 'X', gen_random_uuid(), '{"good": 1}')), 'category_not_found',
  'an unknown category is refused');

-- IB-02: every Operations persona can add, archive and reactivate items
select ok(nexus_test.outcome($$select nexus_test.put('ops7', item_id) from nexus.inventory_item_create('quantity', 'Barang Uji Ops', p_stock => '{"good": 1}')$$) = 'ok',
  'IB-02: P-STAFF-LOG adds an item');
reset role; select nexus_test.login_as(7);
select ok(nexus.inventory_item_set_active(nexus_test.id('ops7'), false, 'uji arsip'), 'IB-02: P-KADEP-OPS archives it');
reset role; select nexus_test.login_as(9);
select ok(nexus.inventory_item_set_active(nexus_test.id('ops7'), true), 'IB-02: Staff in Akomodasi reactivates it');
reset role; select nexus_test.login_as(21);
select ok(nexus.inventory_item_set_active(nexus_test.id('ops7'), false), 'IB-02: Sekretaris Departemen Operasional archives it');
reset role; select nexus_test.login_as(19);
select lives_ok($$select nexus.inventory_stock_add(nexus_test.id('q4'), 'good', 1, 'stok baru datang')$$,
  'IB-02: a Kepala Divisi changes stock');
select is(nexus_test.stock('q4', 'good'), 4, 'stock added');
select is((select array_agg(i.name order by i.name)
           from nexus.inventory_items i where not i.is_active), array['Barang Uji Ops'],
  'archived item stays (never deleted)');

-- IB-01: non-Operations cannot write the catalog
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.inventory_item_create('quantity', 'X', p_stock => '{"good": 1}')$$), 'permission_required',
  'IB-01: P-PLAIN cannot create an item (direct call)');
select is(nexus_test.hint_of($$select nexus.inventory_item_update(nexus_test.id('q1'), 'X')$$), 'permission_required',
  'IB-01: P-PLAIN cannot edit an item');
reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of($$select nexus.inventory_stock_add(nexus_test.id('q1'), 'good', 1, 'x')$$), 'permission_required',
  'IB-01: P-STAFF-PUB cannot change stock');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of($$select nexus.inventory_item_set_active(nexus_test.id('q1'), false)$$), 'permission_required',
  'IB-01: P-ADMIN cannot archive an item');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select nexus.inventory_unit_set_condition(nexus_test.unit_n('t1', 1), 'damaged', 'x')$$), 'permission_required',
  'IB-04: P-KETUM cannot change a condition');

-- Immutability enforced by the database itself (owner / SQL editor)
reset role; select nexus_test.logout();
select is(nexus_test.hint_of($$update nexus.inventory_items set mode = 'tracked' where id = nexus_test.id('q1')$$), 'immutable_column',
  'IB-08/P5: the mode never changes, not even by hand');
select is(nexus_test.hint_of($$update nexus.inventory_items set code = 'INV-9999' where id = nexus_test.id('q1')$$), 'immutable_column',
  'IB-09: a code is never edited');
select is(nexus_test.hint_of($$update nexus.inventory_units set code = 'INV-9999' where id = nexus_test.unit_n('t1', 1)$$), 'immutable_column',
  'IB-09: a unit code is never edited');
select is(nexus_test.hint_of($$insert into nexus.inventory_units (item_id, code, condition) values (nexus_test.id('q1'), 'INV-99999', 'good')$$),
  'item_not_tracked', 'IB-07: units only for tracked items (database guard)');
select is(nexus_test.hint_of($$insert into nexus.inventory_stock (item_id, condition, quantity) values (nexus_test.id('t1'), 'good', 1)$$),
  'item_not_quantity', 'IB-07: stock rows only for quantity items (database guard)');
select throws_ok($$update nexus.inventory_units set condition = 'broken' where id = nexus_test.unit_n('t1', 1)$$, '23514', null,
  'IB-11: the condition list cannot be extended');

-- Stock and condition dialogs (P6: every change needs a reason; R3/R18)
select nexus_test.login_as(8);
select is(nexus_test.hint_of($$select nexus.inventory_stock_add(nexus_test.id('q4'), 'good', 1, '  ')$$), 'reason_required',
  'P6: adding stock needs a reason');
select is(nexus_test.hint_of($$select nexus.inventory_stock_move(nexus_test.id('q4'), 'good', 'damaged', 1, null)$$), 'reason_required',
  'P6/A-IB6: a condition move needs a reason');
select is(nexus_test.hint_of($$select nexus.inventory_stock_move(nexus_test.id('q4'), 'good', 'good', 1, 'x')$$), 'invalid_condition',
  'a move needs two different conditions');
select is(nexus_test.hint_of($$select nexus.inventory_stock_move(nexus_test.id('q4'), 'damaged', 'good', 1, 'x')$$), 'quantity_invalid',
  'cannot move more than the condition holds');
select lives_ok($$select nexus.inventory_stock_move(nexus_test.id('q4'), 'good', 'damaged', 1, 'jatuh saat dipindah')$$,
  'F2.5: move 1 from good to damaged with a reason');
select lives_ok($$select nexus.inventory_stock_write_off(nexus_test.id('q4'), 'damaged', 1, 'dibuang, tidak bisa diperbaiki')$$,
  'F2.6: write 1 off with a reason');
select is(array[nexus_test.stock('q4', 'good'), nexus_test.stock('q4', 'damaged')], array[3, 0], 'stock now 3 good, 0 damaged');
select is(nexus_test.hint_of($$select nexus.inventory_stock_write_off(nexus_test.id('q4'), 'good', 1, null)$$), 'reason_required',
  'F2.6: a write-off needs a reason');
select is((select array_agg(kind || ':' || coalesce(condition_from, '-') || '>' || coalesce(condition_to, '-') || ':' || quantity order by id)
           from nexus.inventory_item_history where item_id = nexus_test.id('q4') and kind <> 'created'),
          array['stock_added:->good:1', 'condition_changed:good>damaged:1', 'written_off:damaged>-:1'],
  'A-IB6: each stock change is one history row (from, to, quantity)');

select lives_ok($$select nexus.inventory_unit_set_condition(nexus_test.unit_n('t1', 4), 'good', 'selesai servis')$$,
  'a unit goes back to good after service');
select lives_ok($$select nexus.inventory_unit_set_condition(nexus_test.unit_n('t1', 4), 'needs_service', 'kabel putus lagi')$$,
  'and to needs_service again');
select is(nexus_test.hint_of($$select nexus.inventory_unit_set_condition(nexus_test.unit_n('t1', 4), 'needs_service', 'x')$$), 'invalid_condition',
  'same condition again is refused');
select lives_ok($$select nexus.inventory_unit_write_off(nexus_test.unit_n('t2', 2), 'hilang di gudang')$$, 'F2.6: write a unit off');
select ok(((nexus_test.unit_row(nexus_test.unit_n('t2', 2))).status = 'lost')
          and (nexus_test.unit_row(nexus_test.unit_n('t2', 2))).code ~ '^INV-', 'IB-30/R23: a lost unit keeps its code, status lost');
select is(nexus_test.hint_of($$select nexus.inventory_unit_restore_lost(nexus_test.unit_n('t2', 1), 'good', 'x')$$), 'unit_not_available',
  'A-IB45: only a lost unit can be restored');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select nexus.inventory_unit_restore_lost(nexus_test.unit_n('t2', 2), 'good', 'x')$$), 'permission_required',
  'L3: P-KETUM cannot restore a unit');
reset role; select nexus_test.login_as(1);
select lives_ok($$select nexus.add_access_rule('org_unit', 'borrowing.handle', p_org_unit_id => nexus_test.unit('Pubdok'), p_note => 'uji L3')$$,
  'admin gives borrowing.handle (without inventory.manage) to Pubdok');
reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of($$select nexus.inventory_unit_restore_lost(nexus_test.unit_n('t2', 2), 'good', 'x')$$), 'permission_required',
  'L3 (tech lead 2026-11-07): borrowing.handle alone no longer restores; it needs inventory.manage');
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where org_unit_id = nexus_test.unit('Pubdok') and permission_key = 'borrowing.handle')),
  'cleanup: disable the Pubdok handle rule');
reset role; select nexus_test.login_as(8);
select ok(nexus.inventory_item_set_active(nexus_test.id('t2'), false, 'uji L3'), 'archive T2 (it has a lost unit)');
reset role; select nexus_test.login_as(9);
select is(nexus_test.hint_of($$select nexus.inventory_unit_restore_lost(nexus_test.unit_n('t2', 2), 'good', 'ketemu')$$), 'item_archived',
  'L3: no restore on an archived item');
reset role; select nexus_test.login_as(8);
select ok(nexus.inventory_item_set_active(nexus_test.id('t2'), true), 'reactivate T2');
reset role; select nexus_test.login_as(9);
select is(nexus_test.hint_of($$select nexus.inventory_unit_restore_lost(nexus_test.unit_n('t2', 2), 'good', null)$$), 'reason_required',
  'A-IB45: restore needs a reason');
select lives_ok($$select nexus.inventory_unit_restore_lost(nexus_test.unit_n('t2', 2), 'good', 'ditemukan di ruang lain')$$,
  'A-IB45/L3: "Ditemukan kembali" by an inventory.manage holder');
select is((nexus_test.unit_row(nexus_test.unit_n('t2', 2))).status, 'active', 'the unit is active again');
select lives_ok($$select nexus.inventory_unit_set_active(nexus_test.unit_n('t2', 1), false, 'disimpan')$$, 'archive a unit');
reset role; select nexus_test.login_as(11);
select is((select (nexus.inventory_item_detail(nexus_test.id('t2')) -> 'units')::jsonb ->> 0 is not null
                  and jsonb_array_length(nexus.inventory_item_detail(nexus_test.id('t2')) -> 'units') = 1), true,
  'A-IB5: members do not see the archived unit');
select is((select count(*)::int from nexus.inventory_units where item_id = nexus_test.id('t2')), 1,
  'A-IB5: ... not even by a direct table read (RLS)');
select is(nexus_test.hint_of($$select nexus.inventory_item_detail(nexus_test.id('ops7'))$$), 'item_not_found',
  'A-IB5: an archived item is "not found" for members');
select is((select count(*)::int from nexus.inventory_items where not is_active), 0, 'A-IB5: no archived item via RLS');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_list(p_status => 'all')$$), 'permission_required',
  'A-IB5: the archived filter is for managers only');
reset role; select nexus_test.login_as(8);
select is(jsonb_array_length(nexus.inventory_item_detail(nexus_test.id('t2')) -> 'units'), 2, 'managers see archived units too');
select ok(nexus.inventory_unit_set_active(nexus_test.unit_n('t2', 1), true), 'reactivate the unit');
select is((select count(*)::int from nexus.inventory_item_list(p_status => 'archived')), 1, 'managers filter archived items');

select ok(nexus.inventory_item_update(nexus_test.id('q4'), 'Barang Uji Q4', 'baru', null, nexus_test.id('loc_b'), 'pindah'),
  'edit fields');
select ok(not nexus.inventory_item_update(nexus_test.id('q4'), 'Barang Uji Q4', 'baru', null, nexus_test.id('loc_b')),
  'an unchanged form writes nothing');
select is((select details ->> 'location_id' from nexus.inventory_item_history where item_id = nexus_test.id('q4') and kind = 'edited'),
  jsonb_build_array(null, nexus_test.id('loc_b'))::text, 'the edit history keeps old -> new');
select ok(nexus.inventory_location_set_active(nexus_test.id('loc_b'), false) is not null, 'deactivate a location in use');
select is((select location_id from nexus.inventory_items where id = nexus_test.id('q4')), nexus_test.id('loc_b'),
  'IB-10: a deactivated entry stays on the items that use it');
select is(nexus_test.hint_of(format('select nexus.inventory_unit_add(%L, %L)', nexus_test.id('t1'),
                                    jsonb_build_array(jsonb_build_object('condition', 'good', 'location_id', nexus_test.id('loc_b'))))),
  'invalid_input', 'IB-10: ... but cannot be chosen for something new');
select ok(nexus.inventory_location_set_active(nexus_test.id('loc_b'), true) is not null, 'reactivate it');

-- Catalog reads (F1)
reset role; select nexus_test.login_as(11);
select is((select array_agg(name order by row_no) from nexus.inventory_item_list()),
          array['Barang Uji Q1', 'Barang Uji Q2', 'Barang Uji Q3', 'Barang Uji Q4', 'Barang Uji T1', 'Barang Uji T2'],
  'IB-12: every active member sees all active items, A-Z');
select ok((select qty_good = 4 and qty_needs_service = 1 and qty_total = 5 and lendable_qty = 4 and units is null
           from nexus.inventory_item_list() where item_id = nexus_test.id('q1')), 'catalog row of a quantity item: counts per condition');
select ok((select unit_count = 4 and qty_good = 3 and qty_needs_service = 1 and location_count = 2 and jsonb_array_length(units) = 4
           from nexus.inventory_item_list() where item_id = nexus_test.id('t1')), 'catalog row of a tracked item: units, counts, 2 locations');
select is((select count(*)::int from nexus.inventory_item_list(p_search => (select code from nexus.inventory_units where id = nexus_test.unit_n('t1', 2)))), 1,
  'R21: search finds an item by a unit code');
select is((select count(*)::int from nexus.inventory_item_list(p_search => 'uji q_')), 0, 'search treats _ literally');
select is((select array_agg(name order by row_no) from nexus.inventory_item_list(p_condition => 'damaged')), array['Barang Uji Q3'],
  'F1: condition filter');
select is((select array_agg(name order by row_no) from nexus.inventory_item_list(p_location_id => nexus_test.id('loc_b'))),
          array['Barang Uji Q4', 'Barang Uji T1'], 'F1: location filter (item location or any unit location)');
select is((select array_agg(name order by row_no) from nexus.inventory_item_list(p_category_id => nexus_test.id('cat_a'))),
          array['Barang Uji Q1', 'Barang Uji T1'], 'F1: category filter');
select ok((select page = 2 and row_no = 6 from nexus.inventory_item_list(p_page => 2, p_page_size => 5)), 'paging');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_list(p_page_size => 51)$$), 'invalid_page_size', 'page size max 50');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_list(p_available_from => nexus_test.d(-1), p_available_to => nexus_test.d(1))$$),
  'start_in_past', 'the date filter cannot start before today');

-- =============================================================================================
-- 4. Requests (F3, L9, IB-14..IB-19)
-- =============================================================================================
reset role; select nexus_test.login_as(11);
select nexus_test.put('r1', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(2), 'Kegiatan Uji',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 2)), 'catatan uji');
reset role; select nexus_test.logout();
select ok((select r.reference ~ '^PJM-[0-9]{4,}$' and r.status = 'submitted' and r.version = 1
                  and r.requester_member_id = nexus_test.mid(11) and r.period_id = nexus_test.period(2)
                  and not r.is_outside_party
           from nexus.borrowing_requests r where r.id = nexus_test.id('r1')),
  'IB-14: request saved as submitted, requester = the session member, period = active period, PJM reference');
select is((select array_agg(event order by id) from nexus.borrowing_status_history where request_id = nexus_test.id('r1')),
          array['submitted'], 'timeline starts with submitted');

select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(-1), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1)))$$),
  'start_in_past', 'IB-16: start before today (Jakarta) is refused');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(2), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1)))$$),
  'invalid_dates', 'IB-16: end before start is refused');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 0)))$$),
  'quantity_invalid', 'IB-16: quantity below 1 is refused');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1.5)))$$),
  'quantity_invalid', 'IB-16: a fraction is refused');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1), jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1)))$$),
  'duplicate_item', 'IB-16/R20: the same item twice is refused');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q3'), 'quantity', 1)))$$),
  'item_not_lendable', 'IB-11/IB-16: an item with nothing in good condition cannot be requested');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('ops7'), 'quantity', 1)))$$),
  'item_not_lendable', 'IB-16/A-IB5: an archived item cannot be requested');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 5)))$$),
  'insufficient_stock', 'IB-16/R3: more than the free quantity is refused');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), '  ', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1)))$$),
  'text_required', 'F3.2: Keperluan is required');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', '[]')$$),
  'quantity_invalid', 'F3: at least one item');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', (select jsonb_agg(jsonb_build_object('item_id', gen_random_uuid(), 'quantity', 1)) from generate_series(1, 51)))$$),
  'too_many_lines', 'at most 50 lines');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1)), p_outside_org_name => 'Org Uji', p_outside_contact_name => 'Orang Uji')$$),
  'permission_required', 'IB-33: a member cannot record an outside-party request');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(89), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'no_error', 'IB-16 (IB4, IB5): a request starting today and spanning 90 days is accepted (no lead time, no maximum)');

-- L4 / owner 2026-11-07: at most start + 365 days; no infinity, nothing before 2000
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(366), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'date_range_too_long', 'L4: a request cannot span more than start + 365 days');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(1), nexus_test.d(366), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'no_error', 'L4: exactly start + 365 is accepted');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(0), 'infinity', 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'invalid_dates', 'L4: infinity is refused');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_availability(nexus_test.id('q4'), nexus_test.d(0), 'infinity')$$),
  'invalid_dates', 'L4: availability refuses infinity too');
select is(nexus_test.hint_of($$select * from nexus.borrowing_my_requests() limit 0$$) , 'no_error', 'own list still works');

-- IB-19: a submitted request holds nothing
select ok((select lendable_qty = 4 and free_qty = 4 and held_qty = 0
           from nexus.inventory_item_availability(nexus_test.id('q1'), nexus_test.d(0), nexus_test.d(2))),
  'IB-19: Diajukan does not reduce availability');
select is((select count(*)::int from nexus.borrowing_my_requests()), 1, 'L9: Peminjaman Saya lists the own request');
select is((nexus.borrowing_request_detail(nexus_test.id('r1')) ->> 'status'), 'submitted', 'L9: the requester reads the detail');
select ok((nexus.borrowing_request_detail(nexus_test.id('r1')) -> 'actions' ->> 'can_cancel')::boolean
          and not (nexus.borrowing_request_detail(nexus_test.id('r1')) -> 'actions' ->> 'can_approve')::boolean,
  'actions: the requester may cancel, not approve');
select is(nexus.borrowing_request_detail(nexus_test.id('r1')) -> 'lines' -> 0 -> 'available', 'null'::jsonb,
  'R8: the requester does not get the head''s availability panel');

reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of($$select nexus.borrowing_request_detail(nexus_test.id('r1'))$$), 'request_not_found',
  'IB-15/AC-27: another member''s request is "not found"');
select is((select count(*)::int from nexus.borrowing_requests), 0, 'IB-15: ... and invisible by a direct read (RLS)');
select is((select count(*)::int from nexus.borrowing_request_lines), 0, 'IB-15: ... its lines too');
select is((select count(*)::int from nexus.borrowing_status_history), 0, 'IB-15: ... its timeline too');
select is((select count(*)::int from nexus.borrowing_my_requests()), 0, 'IB-15: Peminjaman Saya is empty for P-STAFF-PUB');
select is(nexus_test.hint_of($$select * from nexus.borrowing_queue()$$), 'permission_required', 'IB-15: the queue needs view_all');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of($$select nexus.borrowing_request_detail(nexus_test.id('r1'))$$), 'request_not_found',
  'IB-05/B18: P-ADMIN without assignment cannot read another member''s request');
reset role; select nexus_test.login_as(3);
select is((nexus.borrowing_request_detail(nexus_test.id('r1')) ->> 'requester_name'), 'Test Persona 11',
  'IB-04: P-KETUM reads every request (PI-CORE name only)');
select ok(not ((nexus.borrowing_request_detail(nexus_test.id('r1')) -> 'actions') @> '{"can_approve": true}'
          or (nexus.borrowing_request_detail(nexus_test.id('r1')) -> 'actions') @> '{"can_hand_over": true}'),
  'IB-04: ... with no action buttons');

-- =============================================================================================
-- 5. Approve, reject, extend (IB-20..IB-25, L6, R5)
-- =============================================================================================
reset role; select nexus_test.login_as(8);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r1'), nexus_test.ver('r1'))$$), 'permission_required',
  'IB-20: P-STAFF-LOG cannot approve');
reset role; select nexus_test.login_as(9);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_reject(nexus_test.id('r1'), nexus_test.ver('r1'), 'x')$$), 'permission_required',
  'IB-20: Staff in Akomodasi cannot reject');
reset role; select nexus_test.login_as(21);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r1'), nexus_test.ver('r1'))$$), 'permission_required',
  'IB-20: Sekretaris Departemen Operasional cannot approve');
reset role; select nexus_test.login_as(13);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r1'), nexus_test.ver('r1'))$$), 'permission_required',
  'IB-20/AC-36: P-OPS-BPH cannot approve');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r1'), nexus_test.ver('r1'))$$), 'permission_required',
  'IB-20/IB-04: P-KETUM cannot approve');
reset role; select nexus_test.login_as(7);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r1'), nexus_test.ver('r1') - 1)$$), 'state_changed',
  'IB-48: a stale version is refused ("Data sudah berubah")');
select ok((select status = 'approved' and version = 2 from nexus.borrowing_request_approve(nexus_test.id('r1'), nexus_test.ver('r1'), 'silakan')),
  'IB-21: P-KADEP-OPS approves; status and new version returned');
reset role; select nexus_test.logout();
select ok((select decided_by = nexus_test.mid(7) and decided_at is not null and decision_note = 'silakan'
                  and (select quantity_approved from nexus.borrowing_request_lines where request_id = r.id) = 2
           from nexus.borrowing_requests r where r.id = nexus_test.id('r1')),
  'IB-21: approver, time, note and approved quantity are stored');
select is((select count(*)::int from nexus.borrowing_status_history where request_id = nexus_test.id('r1') and event = 'approved'
           and actor_member_id = nexus_test.mid(7)), 1, 'IB-21: one history row for the approval');
select nexus_test.login_as(19);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r1'), nexus_test.ver('r1'))$$), 'state_changed',
  'IB-48: approving twice fails with "Data sudah berubah"');
reset role; select nexus_test.login_as(11);
select ok((select lendable_qty = 4 and free_qty = 2 and held_qty = 2
           from nexus.inventory_item_availability(nexus_test.id('q1'), nexus_test.d(1), nexus_test.d(1))),
  'IB-19: Disetujui holds stock');

-- Reject (IB-21)
reset role; select nexus_test.login_as(10);
select nexus_test.put('r2', request_id) from nexus.borrowing_request_create(nexus_test.d(1), nexus_test.d(2), 'Uji tolak',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(19);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_reject(nexus_test.id('r2'), nexus_test.ver('r2'), '  ')$$), 'note_required',
  'IB-21: rejection without a note is refused');
select is((select status from nexus.borrowing_request_reject(nexus_test.id('r2'), nexus_test.ver('r2'), 'Barang dipakai acara lain')),
  'rejected', 'IB-20: a Kepala Divisi rejects with a note');
reset role; select nexus_test.login_as(10);
select is(nexus.borrowing_request_detail(nexus_test.id('r2')) ->> 'decision_note', 'Barang dipakai acara lain',
  'IB-46: the requester reads the decision note');
select is(nexus.borrowing_request_detail(nexus_test.id('r2')) -> 'timeline' -> 1 ->> 'actor_name', 'Test Persona 19',
  'A-IB46: the timeline names the head who decided');

-- L6 (IB-22, AC-24): a head's own request
reset role; select nexus_test.login_as(7);
select nexus_test.put('r3', request_id) from nexus.borrowing_request_create(nexus_test.d(3), nexus_test.d(4), 'Uji milik kepala',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r3'), nexus_test.ver('r3'))$$), 'self_approval_blocked',
  'IB-22/L6: a head cannot approve their own request');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_reject(nexus_test.id('r3'), nexus_test.ver('r3'), 'x')$$), 'self_approval_blocked',
  'IB-22/L6: ... nor reject it');
select ok(not (nexus.borrowing_request_detail(nexus_test.id('r3')) -> 'actions' ->> 'can_approve')::boolean,
  'IB-22: the approve button is absent on the own request');
reset role; select nexus_test.login_as(20);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r3'), nexus_test.ver('r3'))), 'approved',
  'IB-22: another head approves it');
reset role; select nexus_test.login_as(7);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_extend(nexus_test.id('r3'), nexus_test.ver('r3'), nexus_test.d(5), 'x')$$), 'self_approval_blocked',
  'IB-22/L6: a head cannot extend their own loan');

-- AC-57: no rule can switch L6 off
reset role; select nexus_test.login_as(1);
select lives_ok($$select nexus.add_access_rule('role', 'borrowing.approve', 'all', 'bph', p_note => 'test AC-57')$$, 'admin grants approve to role bph');
reset role; select nexus_test.login_as(3);
select nexus_test.put('r5', request_id) from nexus.borrowing_request_create(nexus_test.d(6), nexus_test.d(6), 'Uji AC-57',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r5'), nexus_test.ver('r5'))$$), 'self_approval_blocked',
  'IB-22/AC-57: even with a custom rule, own requests are blocked');
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where role_key = 'bph' and permission_key = 'borrowing.approve')),
  'cleanup: disable the bph approve rule');
reset role; select nexus_test.login_as(3);
select is((select status from nexus.borrowing_request_cancel(nexus_test.id('r5'), nexus_test.ver('r5'))), 'cancelled',
  'cleanup: P-KETUM cancels their pending request (no reason needed while Diajukan)');

-- B29 single approver (IB-23)
reset role; select nexus_test.login_as(7);
select nexus_test.put('r6', request_id) from nexus.borrowing_request_create(nexus_test.d(7), nexus_test.d(7), 'Uji satu kepala',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(1);
select ok(nexus.disable_access_rule((select id from nexus.access_rules where default_code = 'D35'), 'uji IB-23'), 'disable D35 (heads of divisions)');
reset role; select nexus_test.login_as(7);
select is((nexus.borrowing_request_detail(nexus_test.id('r6')) ->> 'other_approver_count')::int, 0,
  'IB-23: with one head left, the own request shows "no other approver"');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r6'), nexus_test.ver('r6'))$$), 'self_approval_blocked',
  'IB-23/B29: no override');
reset role; select nexus_test.login_as(19);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r6'), nexus_test.ver('r6'))$$), 'permission_required',
  'IB-06: with D35 disabled the Kepala Divisi loses approve on the next call');
reset role; select nexus_test.login_as(1);
select ok(nexus.enable_access_rule((select id from nexus.access_rules where default_code = 'D35'), 'uji IB-23 selesai'), 're-enable D35 (with a reason)');
reset role; select nexus_test.login_as(7);
select is((nexus.borrowing_request_detail(nexus_test.id('r6')) ->> 'other_approver_count')::int, 2,
  'IB-23: two other heads again');

-- Lower quantity (A-IB14)
reset role; select nexus_test.login_as(11);
select nexus_test.put('r4', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'Uji unit',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('t1'), 'quantity', 3)));
reset role; select nexus_test.login_as(19);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_approve(%L, %s, null, %L)', nexus_test.id('r4'), nexus_test.ver('r4'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r4', 't1'), 'quantity', 2)))),
  'note_required', 'A-IB14: a lower quantity needs a note');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_approve(%L, %s, %L, %L)', nexus_test.id('r4'), nexus_test.ver('r4'), 'x',
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r4', 't1'), 'quantity', 4)))),
  'quantity_invalid', 'cannot approve more than requested');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_approve(%L, %s, %L, %L)', nexus_test.id('r4'), nexus_test.ver('r4'), 'x',
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r4', 't1'), 'quantity', 0)))),
  'quantity_invalid', 'approving zero of everything is refused (reject instead)');
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r4'), nexus_test.ver('r4'), 'hanya dua yang siap',
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r4', 't1'), 'quantity', 2)))), 'approved',
  'A-IB14: approve 2 of 3 with a note');

-- Double booking (IB-24, R5): Q2 has 2 in good
reset role; select nexus_test.login_as(11);
select nexus_test.put('ra', request_id) from nexus.borrowing_request_create(nexus_test.d(1), nexus_test.d(3), 'Uji bentrok A',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q2'), 'quantity', 2)));
reset role; select nexus_test.login_as(10);
select nexus_test.put('rb', request_id) from nexus.borrowing_request_create(nexus_test.d(3), nexus_test.d(4), 'Uji bentrok B',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q2'), 'quantity', 1)));
reset role; select nexus_test.login_as(7);
select is((select pending_overlap_count from nexus.borrowing_queue('pending') where request_id = nexus_test.id('ra')), 1,
  'R6: the queue warns about one overlapping pending request');
select is((select status from nexus.borrowing_request_approve(nexus_test.id('ra'), nexus_test.ver('ra'))), 'approved', 'IB-24: first approval wins');
-- Lock proof: the approval holds a FOR UPDATE row lock on the item until the transaction ends, so a
-- second approval in another session waits and then re-checks (R5).
reset role; select nexus_test.logout();
select ok(exists (select 1 from extensions.pgrowlocks('nexus.inventory_items') l
                  join nexus.inventory_items i on i.ctid = l.locked_row
                  where i.id = nexus_test.id('q2') and 'For Update' = any (l.modes) and pg_backend_pid() = any (l.pids)),
  'IB-24/R5: approval locks the item row (FOR UPDATE) in this transaction');
select ok(not exists (select 1 from extensions.pgrowlocks('nexus.inventory_items') l
                      join nexus.inventory_items i on i.ctid = l.locked_row
                      where i.id = nexus_test.id('q3') and 'For Update' = any (l.modes)),
  'R5: ... and only the items of the request (an unrelated item is not locked FOR UPDATE)');
select nexus_test.login_as(19);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('rb'), nexus_test.ver('rb'))$$), 'insufficient_stock',
  'IB-24: the second, overlapping approval is refused ("Stok tidak cukup")');
select is(nexus_test.st('rb'), 'submitted', 'IB-24: ... and the request stays Diajukan');

-- Extend (IB-25, F8)
reset role; select nexus_test.login_as(16);
select nexus_test.put('rc', request_id) from nexus.borrowing_request_create(nexus_test.d(5), nexus_test.d(6), 'Uji perpanjang',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q2'), 'quantity', 2)));
reset role; select nexus_test.login_as(20);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('rc'), nexus_test.ver('rc'))), 'approved', 'A-IB3: a lecturer''s request is approved like any other');
reset role; select nexus_test.login_as(8);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_extend(nexus_test.id('ra'), nexus_test.ver('ra'), nexus_test.d(4), 'x')$$), 'permission_required',
  'IB-25: a non-head cannot extend');
reset role; select nexus_test.login_as(19);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_extend(nexus_test.id('ra'), nexus_test.ver('ra'), nexus_test.d(4), null)$$), 'note_required',
  'IB-25: extension needs a note');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_extend(nexus_test.id('ra'), nexus_test.ver('ra'), nexus_test.d(3), 'x')$$), 'invalid_dates',
  'F8: only a later end date');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_extend(nexus_test.id('ra'), nexus_test.ver('ra'), nexus_test.d(5), 'x')$$), 'insufficient_stock',
  'IB-25/A-IB26: the added days are checked like an approval ("Bentrok dengan pengajuan lain")');
select is((select status from nexus.borrowing_request_extend(nexus_test.id('ra'), nexus_test.ver('ra'), nexus_test.d(4), 'acara diperpanjang')), 'approved',
  'IB-25: extension by a head; status unchanged');
reset role; select nexus_test.logout();
select ok((select old_end_date = nexus_test.d(3) and new_end_date = nexus_test.d(4) and actor_member_id = nexus_test.mid(19)
                  and note = 'acara diperpanjang' and period_id = nexus_test.period(2)
           from nexus.borrowing_extensions where request_id = nexus_test.id('ra')),
  'IB-25: one extension history row (old date, new date, who, note)');
select is((select end_date from nexus.borrowing_requests where id = nexus_test.id('ra')), nexus_test.d(4), 'the end date moved');
select throws_ok($$update nexus.borrowing_requests set end_date = start_date + 366 where id = nexus_test.id('rc')$$, '23514', null,
  'L4: the database itself refuses a span over 365 days (constraint)');
select nexus_test.login_as(19);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_extend(nexus_test.id('rc'), nexus_test.ver('rc'), nexus_test.d(5) + 366, 'x')$$),
  'date_range_too_long', 'L4: an extension cannot pass the ORIGINAL start + 365');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_extend(nexus_test.id('rc'), nexus_test.ver('rc'), 'infinity', 'x')$$),
  'invalid_dates', 'L4: an extension to infinity is refused');
reset role; select nexus_test.logout();
-- IB-37: ranges that share one day overlap (ra now ends d4, rb starts d3 -> still refused, and d4 alone is full)
select nexus_test.login_as(11);
select ok((select free_qty = 0 from nexus.inventory_item_availability(nexus_test.id('q2'), nexus_test.d(4), nexus_test.d(4)))
          and (select free_qty = 0 from nexus.inventory_item_availability(nexus_test.id('q2'), nexus_test.d(-0) + 4, nexus_test.d(5)))
          and (select free_qty = 2 from nexus.inventory_item_availability(nexus_test.id('q2'), nexus_test.d(7), nexus_test.d(8))),
  'IB-37/R4: a range sharing a single day counts as overlapping; later days are free');
select is((select array_agg(item_id::text || ':' || free_qty order by item_id::text)
           from nexus.inventory_availability_bulk(array[nexus_test.id('q1'), nexus_test.id('q2'), nexus_test.id('ops7')], nexus_test.d(1), nexus_test.d(1))),
          (select array_agg(x order by x::text) from unnest(array[nexus_test.id('q1')::text || ':2', nexus_test.id('q2')::text || ':0']) x),
  'P2: bulk availability answers for many items at once; archived ids are left out');
select is(nexus_test.hint_of($$select * from nexus.inventory_availability_bulk((select array_agg(gen_random_uuid()) from generate_series(1, 101)), nexus_test.d(1), nexus_test.d(1))$$),
  'invalid_input', 'P2: at most 100 ids per call');
select is((select array_agg(item_id::text order by item_id::text) filter (where free_qty = 0) from nexus.inventory_item_list(p_available_from => nexus_test.d(4), p_available_to => nexus_test.d(4))),
          (select array_agg(x order by x) from unnest(array[nexus_test.id('q2')::text, nexus_test.id('q3')::text]) x),
  'P2: the catalog date filter fills free_qty');
select is((select array_agg(name order by row_no) from nexus.inventory_item_list(p_available_from => nexus_test.d(4), p_available_to => nexus_test.d(4))),
          array['Barang Uji Q1', 'Barang Uji Q4', 'Barang Uji T1', 'Barang Uji T2', 'Barang Uji Q2', 'Barang Uji Q3'],
  'design 5.2: items with nothing free sort last');

-- =============================================================================================
-- 6. Handover (F5, IB-26, IB-27, A-IB8)
-- =============================================================================================
reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r1', 'q1'), 'quantity', 2)))),
  'permission_required', 'IB-26: a non-Operations member cannot record a handover');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r1', 'q1'), 'quantity', 2)))),
  'permission_required', 'IB-04: P-KETUM cannot hand over');
reset role; select nexus_test.login_as(8);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r1', 'q1'), 'quantity', 3)))),
  'quantity_invalid', 'IB-27: at most the approved quantity');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r1', 'q1'), 'quantity', 1)))),
  'note_required', 'design 12.2: handing over less than approved needs a note');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'), '[]')),
  'nothing_to_hand_over', 'F5.3: nothing handed over = cancel instead');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r3'), nexus_test.ver('r3'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r3', 'q4'), 'quantity', 1)))),
  'too_early', 'A-IB8: no handover before the start date');
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r1'), nexus_test.ver('r1'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r1', 'q1'), 'quantity', 2)), 'diserahkan di sekretariat')),
  'borrowed', 'F5: handover -> Dipinjam');
reset role; select nexus_test.logout();
select ok((select handed_over_by = nexus_test.mid(8) and handed_over_at is not null from nexus.borrowing_requests where id = nexus_test.id('r1'))
          and (select actor_member_id = nexus_test.mid(8) from nexus.borrowing_status_history where request_id = nexus_test.id('r1') and event = 'handed_over'),
  'IB-26: the history row names the recorder');

-- Tracked units (IB-27, R10, A-IB29)
select nexus_test.login_as(8);
select is((select count(*)::int from nexus.borrowing_handover_units(nexus_test.id('r4'))), 3,
  'R10: the unit picker offers only good, active units on no open loan (3 of 4)');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r4'), nexus_test.ver('r4'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r4', 't1'), 'unit_ids',
                                                                         jsonb_build_array(nexus_test.unit_n('t1', 4), nexus_test.unit_n('t1', 1)))))),
  'unit_not_available', 'IB-11/IB-27: a unit that needs service cannot be handed over');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r4'), nexus_test.ver('r4'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r4', 't1'), 'unit_ids',
                                                                         jsonb_build_array(nexus_test.unit_n('t2', 1), nexus_test.unit_n('t1', 1)))))),
  'unit_not_available', 'IB-27: a unit of another item is refused');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r4'), nexus_test.ver('r4'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r4', 't1'), 'unit_ids',
                                                                         jsonb_build_array(nexus_test.unit_n('t1', 1), nexus_test.unit_n('t1', 2), nexus_test.unit_n('t1', 3)))))),
  'quantity_invalid', 'IB-27: not more units than approved');
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r4'), nexus_test.ver('r4'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r4', 't1'), 'unit_ids',
                                                jsonb_build_array(nexus_test.unit_n('t1', 1), nexus_test.unit_n('t1', 2)))))),
  'borrowed', 'A-IB29: the handler picks the units by code');
reset role; select nexus_test.login_as(10);
select nexus_test.put('r7', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(0), 'Uji unit kedua',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('t1'), 'quantity', 1)));
reset role; select nexus_test.login_as(19);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r7'), nexus_test.ver('r7'))), 'approved', 'r7 approved');
reset role; select nexus_test.login_as(9);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r7'), nexus_test.ver('r7'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r7', 't1'), 'unit_ids',
                                                                         (select jsonb_agg(gen_random_uuid()) from generate_series(1, 201)))))),
  'too_many_units', 'L5: at most 200 unit ids per line');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r7'), nexus_test.ver('r7'),
                                    (select jsonb_agg(jsonb_build_object('line_id', gen_random_uuid(), 'quantity', 1)) from generate_series(1, 51)))),
  'too_many_lines', 'L5: at most 50 lines in a handover');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_hand_over(%L, %s, %L)', nexus_test.id('r7'), nexus_test.ver('r7'),
                                    jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r7', 't1'), 'unit_ids',
                                                                         jsonb_build_array(nexus_test.unit_n('t1', 1)))))),
  'unit_not_available', 'IB-27: one unit cannot be on two open loans');
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r7'), nexus_test.ver('r7'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r7', 't1'), 'unit_ids', jsonb_build_array(nexus_test.unit_n('t1', 3)))))),
  'borrowed', 'the free unit is handed over');
reset role; select nexus_test.logout();
select throws_ok($$insert into nexus.borrowing_line_units (line_id, unit_id) values (nexus_test.line('r7', 't1'), nexus_test.unit_n('t1', 1))$$,
  '23505', null, 'IB-27: the database itself refuses a unit on two open loans (partial unique index)');
select nexus_test.login_as(8);
select is(nexus_test.hint_of($$select nexus.inventory_unit_set_condition(nexus_test.unit_n('t1', 1), 'damaged', 'x')$$), 'unit_on_loan',
  'a unit on loan cannot change condition (the return records it)');
select is(nexus_test.hint_of($$select nexus.inventory_item_set_active(nexus_test.id('t1'), false)$$), 'open_requests_exist',
  'IB-13: an item with open request lines cannot be archived');
select is(nexus_test.hint_of($$select nexus.inventory_unit_set_active(nexus_test.unit_n('t1', 2), false)$$), 'unit_on_loan',
  'IB-13: a unit on loan cannot be archived');
select is(nexus_test.hint_of($$select nexus.inventory_stock_move(nexus_test.id('q2'), 'good', 'needs_service', 1, 'cek')$$), 'reserved_stock',
  'IB-13/R18: good stock cannot drop below what approved requests hold');
select is(nexus_test.hint_of($$select nexus.inventory_stock_write_off(nexus_test.id('q2'), 'good', 1, 'cek')$$), 'reserved_stock',
  'R18: ... also not by a write-off');
select ok(nexus_test.msg_of($$select nexus.inventory_stock_move(nexus_test.id('q2'), 'good', 'needs_service', 1, 'cek')$$) !~* 'persona'
          and nexus_test.msg_of($$select nexus.inventory_item_set_active(nexus_test.id('t1'), false)$$) !~* 'persona',
  'IB-13/R18: the refusals give counts, never a name');

-- =============================================================================================
-- 7. Return, evidence, correction (F6, IB-28..IB-30, IB-32, A-IB15)
-- =============================================================================================
reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'good', 2)))),
  'permission_required', 'IB-26: a non-Operations member cannot record a return');
reset role; select nexus_test.login_as(9);
select is((select status from nexus.borrowing_request_return(nexus_test.id('r1'), nexus_test.ver('r1'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'good', 1))) ), 'borrowed',
  'IB-28: a partial return keeps the request Dipinjam; a good return needs no note, no photo (IB-29)');
reset role; select nexus_test.login_as(11);
select ok((select is_partially_returned and qty_outstanding = 1 from nexus.borrowing_my_requests() where request_id = nexus_test.id('r1')),
  'IB-28: "Sebagian kembali" is computed for the requester');
reset role; select nexus_test.login_as(9);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'damaged', 1, 'needs_service', 'retak')))),
  'photo_count', 'IB-29: damaged without a photo is refused');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'damaged', 1, 'needs_service', null, array[nexus_test.photo('r1')])))),
  'note_required', 'IB-29: damaged without a note is refused');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'lost', 1, null, null, array[nexus_test.photo('r1')])))),
  'note_required', 'IB-29: lost without a note is refused');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'damaged', 1, null, 'retak', array[nexus_test.photo('r1')])))),
  'invalid_condition', 'A-IB30: a damaged return states the resulting condition');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'good', 1, null, null, array[nexus_test.photo('r1')])))),
  'photo_count', 'IB-29: a good return takes no photo');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'damaged', 1, 'needs_service', 'retak',
                                                                   array[nexus_test.photo('r1'), nexus_test.photo('r1'), nexus_test.photo('r1'), nexus_test.photo('r1')])))),
  'photo_count', 'A-IB31: at most 3 photos');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'damaged', 1, 'needs_service', 'retak', array[nexus_test.photo('r4')])))),
  'invalid_photo', 'A-IB31: a photo must sit in this request''s folder');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'damaged', 1, 'needs_service', 'retak', array['../etc/passwd'])))),
  'invalid_photo', 'a malformed path is refused');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'good', 2)))),
  'quantity_invalid', 'IB-28: not more than is still out');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1') - 1,
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'good', 1)))),
  'state_changed', 'IB-48: a stale return is refused');
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'damaged', 1, 'needs_service', 'retak',
                                                                   array[nexus_test.id('r1')::text || '/' || gen_random_uuid()::text || '.jpg'])))),
          'photo_missing', 'spec states table: a photo that was never uploaded cannot be attached')
  else skip('Storage not installed (load tests/support/storage_stub.sql)', 1) end;
select is((select status from nexus.borrowing_request_return(nexus_test.id('r1'), nexus_test.ver('r1'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'damaged', 1, 'needs_service', 'gagang retak', array[nexus_test.photo('r1')])))),
  'returned', 'IB-28: everything accounted for -> Dikembalikan');
reset role; select nexus_test.logout();
select ok((select has_issue and returned_at is not null from nexus.borrowing_requests where id = nexus_test.id('r1')),
  'F6.4: "ada masalah" flag set');
select is(array[nexus_test.stock('q1', 'good'), nexus_test.stock('q1', 'needs_service')], array[3, 2],
  'IB-30: the damaged piece moved from good to needs_service');
select ok((select request_id = nexus_test.id('r1') and actor_member_id = nexus_test.mid(9) and note = 'gagang retak'
           from nexus.inventory_item_history where item_id = nexus_test.id('q1') and kind = 'condition_changed'),
  'IB-30: an item history row linked to the request names the recorder');
select is((select count(*)::int from nexus.borrowing_evidence_photos e join nexus.borrowing_line_returns lr on lr.id = e.line_return_id
           join nexus.borrowing_request_lines l on l.id = lr.line_id where l.request_id = nexus_test.id('r1')), 1,
  'IB-29: the photo record is stored');
select is((select count(*)::int from nexus.borrowing_status_history where request_id = nexus_test.id('r1') and event = 'returned'), 1,
  'IB-48: one "returned" history row');
select nexus_test.login_as(9);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'good', 1)))),
  'state_changed', 'IB-48: returning twice fails with "Data sudah berubah"');

-- Tracked return with a lost unit (IB-30)
reset role; select nexus_test.login_as(13);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r4'), nexus_test.ver('r4'),
                                    jsonb_build_array(nexus_test.u(nexus_test.line('r4', 't1'), nexus_test.unit_n('t1', 3), 'good')))),
  'unit_not_available', 'a unit that is not out on this line cannot be returned here');
select is((select status from nexus.borrowing_request_return(nexus_test.id('r4'), nexus_test.ver('r4'),
           jsonb_build_array(nexus_test.u(nexus_test.line('r4', 't1'), nexus_test.unit_n('t1', 1), 'lost', null, 'tertinggal di bus', array[nexus_test.photo('r4')]),
                             nexus_test.u(nexus_test.line('r4', 't1'), nexus_test.unit_n('t1', 2), 'good')))),
  'returned', 'IB-30: a lost unit and a good unit in one return');
select ok(((nexus_test.unit_row(nexus_test.unit_n('t1', 1))).status = 'lost'), 'IB-30: the lost unit is written off (status lost, code kept)');
reset role; select nexus_test.login_as(11);
select ok((select qty_good = 2 and unit_count = 3 from nexus.inventory_item_list() where item_id = nexus_test.id('t1')),
  'A-IB32: lost units leave the counts (2 good incl. the one on loan, 3 active units)');

-- Own request: handover and return recorded by the requester (IB-26, AC-75)
reset role; select nexus_test.login_as(8);
select nexus_test.put('r8', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(0), 'Uji milik staf',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(7);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r8'), nexus_test.ver('r8'))), 'approved', 'r8 approved by a head');
reset role; select nexus_test.login_as(8);
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r8'), nexus_test.ver('r8'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r8', 'q4'), 'quantity', 1)))), 'borrowed',
  'IB-26/AC-75: an Operations member records the handover of their OWN request');
select is((select status from nexus.borrowing_request_return(nexus_test.id('r8'), nexus_test.ver('r8'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r8', 'q4'), 'good', 1)))), 'returned',
  'IB-26/AC-75: ... and its return');
reset role; select nexus_test.logout();
select is((select array_agg(actor_member_id = nexus_test.mid(8) order by id) from nexus.borrowing_status_history
           where request_id = nexus_test.id('r8') and event in ('handed_over', 'returned')), array[true, true],
  'AC-75: the history names them as recorder');

-- Correction (A-IB15): returned -> borrowed, last batch reversed
select nexus_test.login_as(10);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'), 'x')),
  'permission_required', 'A-IB15: only borrowing.handle corrects');
reset role; select nexus_test.login_as(8);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'), ' ')),
  'reason_required', 'A-IB15: the correction needs a reason');
select is((select status from nexus.borrowing_request_correct_return(nexus_test.id('r1'), nexus_test.ver('r1'), 'salah klik, belum kembali')),
  'borrowed', 'A-IB15: Dikembalikan -> Dipinjam');
reset role; select nexus_test.logout();
select ok(array[nexus_test.stock('q1', 'good'), nexus_test.stock('q1', 'needs_service')] = array[4, 1]
          and (select not has_issue and returned_at is null from nexus.borrowing_requests where id = nexus_test.id('r1')),
  'A-IB15: the damaged effect is undone and the issue flag recomputed');
select ok((select qty_outstanding = 1 from nexus._ib_line_state(null, array[nexus_test.id('r1')])),
  'A-IB15: only the last return is reversed (the earlier partial return still counts)');
select is((select count(*)::int from nexus.borrowing_evidence_photos e join nexus.borrowing_line_returns lr on lr.id = e.line_return_id
           join nexus.borrowing_request_lines l on l.id = lr.line_id where l.request_id = nexus_test.id('r1')), 1,
  'IB-32: evidence of the reversed return stays');
select nexus_test.login_as(8);
select is((select status from nexus.borrowing_request_return(nexus_test.id('r1'), nexus_test.ver('r1'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r1', 'q1'), 'good', 1)))), 'returned', 'returned again, correctly');
-- Correction refused when the stock moved on
reset role; select nexus_test.login_as(9);
select is((select status from nexus.borrowing_request_return(nexus_test.id('r7'), nexus_test.ver('r7'),
           jsonb_build_array(nexus_test.u(nexus_test.line('r7', 't1'), nexus_test.unit_n('t1', 3), 'damaged', 'needs_service', 'kaki bengkok', array[nexus_test.photo('r7')])))),
  'returned', 'tracked damaged return');
select ok((nexus_test.unit_row(nexus_test.unit_n('t1', 3))).condition = 'needs_service', 'IB-30: the unit moved to the stated condition');
select lives_ok($$select nexus.inventory_unit_set_condition(nexus_test.unit_n('t1', 3), 'good', 'sudah diperbaiki')$$, 'the unit is serviced');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r7'), nexus_test.ver('r7'), 'x')),
  'correction_conflict', 'A-IB15: no correction once the unit changed again');
-- Review L1: one correction per request (r1 was corrected once and returned again)
reset role; select nexus_test.login_as(8);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r1'), nexus_test.ver('r1'), 'lagi')),
  'already_corrected', 'L1/Fix 2b: a second correction of the same request is refused with its own hint');
-- Review L2: correcting a counted "lost" outcome
reset role; select nexus_test.login_as(11);
select nexus_test.put('r16', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(0), 'Uji hilang 1',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
select nexus_test.put('r17', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(0), 'Uji hilang 2',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(7);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r16'), nexus_test.ver('r16'))), 'approved', 'r16 approved');
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r17'), nexus_test.ver('r17'))), 'approved', 'r17 approved');
reset role; select nexus_test.login_as(8);
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r16'), nexus_test.ver('r16'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r16', 'q4'), 'quantity', 1)))), 'borrowed', 'r16 handed over');
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r17'), nexus_test.ver('r17'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r17', 'q4'), 'quantity', 1)))), 'borrowed', 'r17 handed over');
select is((select status from nexus.borrowing_request_return(nexus_test.id('r16'), nexus_test.ver('r16'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r16', 'q4'), 'lost', 1, null, 'tertinggal', array[nexus_test.photo('r16')])))), 'returned',
  'r16 returned as lost (good 3 -> 2)');
select is(nexus_test.stock('q4', 'good'), 2, 'lost quantity left the stock');
select is((select status from nexus.borrowing_request_correct_return(nexus_test.id('r16'), nexus_test.ver('r16'), 'ternyata ada')), 'borrowed',
  'L2: a lost quantity is corrected when nothing changed since');
select is(nexus_test.stock('q4', 'good'), 3, 'L2: the quantity is back in good');
select is((select status from nexus.borrowing_request_return(nexus_test.id('r16'), nexus_test.ver('r16'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r16', 'q4'), 'good', 1)))), 'returned', 'r16 returned good');
select is((select status from nexus.borrowing_request_return(nexus_test.id('r17'), nexus_test.ver('r17'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r17', 'q4'), 'lost', 1, null, 'hilang', array[nexus_test.photo('r17')])))), 'returned',
  'r17 returned as lost (good 3 -> 2)');
select lives_ok($$select nexus.inventory_stock_add(nexus_test.id('q4'), 'good', 1, 'beli pengganti')$$, 'a replacement is added by hand');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r17'), nexus_test.ver('r17'), 'ternyata ada')),
  'correction_conflict', 'L2: no correction of a lost quantity once the item''s stock changed after the return');
select is(nexus_test.stock('q4', 'good'), 3, 'L2: nothing was double-counted');

-- =============================================================================================
-- 8. Cancel (F7, IB-17, AC-76, A-IB34) and outside parties (F10, IB-33, IB-34)
-- =============================================================================================
reset role; select nexus_test.login_as(11);
select nexus_test.put('r9', request_id) from nexus.borrowing_request_create(nexus_test.d(1), nexus_test.d(1), 'Uji batal',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
select is((select status from nexus.borrowing_request_cancel(nexus_test.id('r9'), nexus_test.ver('r9'))), 'cancelled',
  'IB-17: the requester cancels while Diajukan, no reason needed');
reset role; select nexus_test.login_as(7);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('r9'), nexus_test.ver('r9'))$$), 'state_changed',
  'IB-17: a cancelled request cannot be reopened');
reset role; select nexus_test.login_as(11);
select nexus_test.put('r10', request_id) from nexus.borrowing_request_create(nexus_test.d(2), nexus_test.d(2), 'Uji batal 2',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(7);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r10'), nexus_test.ver('r10'))), 'approved', 'r10 approved');
reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_cancel(nexus_test.id('r10'), nexus_test.ver('r10'), 'x')$$), 'request_not_found',
  'IB-17/AC-30: another member cannot cancel it');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_cancel(nexus_test.id('r10'), nexus_test.ver('r10'))$$), 'reason_required',
  'IB-17/IB7: after approval a reason is required');
select is((select status from nexus.borrowing_request_cancel(nexus_test.id('r10'), nexus_test.ver('r10'), 'acara batal')), 'cancelled',
  'IB-17/AC-76: cancelled before pick-up, with a reason');
select is((select free_qty from nexus.inventory_item_availability(nexus_test.id('q4'), nexus_test.d(2), nexus_test.d(2))), 3,
  'F7.2: cancelling frees the held stock');
select nexus_test.put('r11', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(0), 'Uji batal 3',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(7);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r11'), nexus_test.ver('r11'))), 'approved', 'r11 approved');
reset role; select nexus_test.login_as(8);
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r11'), nexus_test.ver('r11'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r11', 'q4'), 'quantity', 1)))), 'borrowed', 'r11 handed over');
reset role; select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_cancel(nexus_test.id('r11'), nexus_test.ver('r11'), 'x')$$), 'state_changed',
  'IB-17/F7.4: after pick-up nobody cancels');
select nexus_test.put('r12', request_id) from nexus.borrowing_request_create(nexus_test.d(3), nexus_test.d(3), 'Uji batal 4',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
select nexus_test.put('r13', request_id) from nexus.borrowing_request_create(nexus_test.d(8), nexus_test.d(8), 'Uji batal 5',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(19);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_approve(%L, %s, null, %L)', nexus_test.id('r13'), nexus_test.ver('r13'),
                                    (select jsonb_agg(jsonb_build_object('line_id', gen_random_uuid(), 'quantity', 1)) from generate_series(1, 51)))),
  'too_many_lines', 'L5: at most 50 lines in an approval');
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r12'), nexus_test.ver('r12'))), 'approved', 'r12 approved');
reset role; select nexus_test.login_as(9);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_cancel(nexus_test.id('r12'), nexus_test.ver('r12'))$$), 'reason_required',
  'A-IB34: a handle holder needs a reason to cancel');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_cancel(nexus_test.id('r13'), nexus_test.ver('r13'), 'x')$$), 'state_changed',
  'A-IB34: a handle holder cancels only approved requests (a head rejects pending ones)');
select is((select status from nexus.borrowing_request_cancel(nexus_test.id('r12'), nexus_test.ver('r12'), 'peminjam tidak datang')), 'cancelled',
  'A-IB34: a handle holder cancels an approved request not picked up');

-- Outside parties (IB-33, IB-34, A-IB28)
reset role; select nexus_test.login_as(8);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(1), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1)), p_outside_org_name => 'Org Uji')$$),
  'outside_party_incomplete', 'IB-33: organisation AND contact person are both required');
select nexus_test.put('ro1', request_id) from nexus.borrowing_request_create(nexus_test.d(1), nexus_test.d(1), 'Pinjam untuk gereja uji',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1)), null, ' Gereja Uji ', 'Bapak Uji');
reset role; select nexus_test.logout();
select ok((select is_outside_party and requester_member_id = nexus_test.mid(8) and outside_org_name = 'Gereja Uji'
                  and outside_contact_name = 'Bapak Uji' from nexus.borrowing_requests where id = nexus_test.id('ro1')),
  'IB-34/A-IB28: the recorder is the requester of record; only the two names are stored (trimmed)');
select nexus_test.login_as(8);
select ok(exists (select 1 from nexus.borrowing_my_requests() where request_id = nexus_test.id('ro1') and outside_org_name = 'Gereja Uji'),
  'IB-34: it shows in the recorder''s Peminjaman Saya');
reset role; select nexus_test.login_as(7);
select nexus_test.put('ro2', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(0), 'Pinjam untuk kampus uji',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q1'), 'quantity', 1)), null, 'UKM Uji', 'Saudari Uji');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('ro2'), nexus_test.ver('ro2'))$$), 'self_approval_blocked',
  'IB-34/L6: a head who recorded an outside-party request cannot approve it');
reset role; select nexus_test.login_as(20);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('ro2'), nexus_test.ver('ro2'))), 'approved', 'IB-34: another head approves it');
reset role; select nexus_test.login_as(7);
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('ro2'), nexus_test.ver('ro2'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('ro2', 'q1'), 'quantity', 1)))), 'borrowed',
  'IB-34: the recorder may hand it over (handle is not limited by L6)');
reset role; select nexus_test.login_as(3);
select ok((select requester_name = 'Test Persona 7' and outside_org_name = 'UKM Uji' from nexus.borrowing_queue('borrowed') where request_id = nexus_test.id('ro2')),
  'design 11.1: the queue shows the organisation and the recorder');

-- =============================================================================================
-- 9. Overdue and dates (F9, IB-35, IB-36, R9, R19)
-- =============================================================================================
reset role; select nexus_test.logout();
select is(nexus._jakarta_date('2026-11-07 23:30:00+00'), date '2026-11-08', 'IB-35/R19: 23:30 UTC is already the next day in Jakarta');
select is(nexus._jakarta_date('2026-11-07 16:59:59+00'), date '2026-11-07', 'R19: 16:59 UTC is still the same Jakarta day');
select is(nexus._ib_today(), (now() at time zone 'Asia/Jakarta')::date, 'R19: "today" is the Jakarta date');
-- Move r11 (borrowed, Q4 x1) into the past as if time had passed: the guard trigger keeps start_date
-- immutable for clients, so the test bypasses triggers for this one owner statement.
set local session_replication_role = replica;
update nexus.borrowing_requests set start_date = nexus_test.d(-4), end_date = nexus_test.d(-2) where id = nexus_test.id('r11');
-- r12 analogue for "Belum diambil": an approved request whose start already passed.
set local session_replication_role = origin;
select nexus_test.login_as(11);
select nexus_test.put('r14', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(1), 'Uji belum diambil',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(7);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r14'), nexus_test.ver('r14'))), 'approved', 'r14 approved');
reset role; select nexus_test.logout();
set local session_replication_role = replica;
update nexus.borrowing_requests set start_date = nexus_test.d(-1) where id = nexus_test.id('r14');
set local session_replication_role = origin;

select nexus_test.login_as(11);
select ok((select is_overdue and overdue_days = 2 from nexus.borrowing_my_requests() where request_id = nexus_test.id('r11')),
  'IB-35/F9: Dipinjam with an end date before today is Terlambat for the requester (2 days)');
select ok((select is_not_picked_up from nexus.borrowing_my_requests() where request_id = nexus_test.id('r14')),
  'R9: Disetujui with a passed start date is "Belum diambil"');
select ok((nexus.borrowing_request_detail(nexus_test.id('r11')) ->> 'is_overdue')::boolean, 'IB-35: ... also on the detail');
select is((select status from nexus.borrowing_requests where id = nexus_test.id('r11')), 'borrowed', 'IB-35: nothing is stored, the status stays Dipinjam');
reset role; select nexus_test.login_as(3);
select ok(exists (select 1 from nexus.borrowing_queue('overdue') where request_id = nexus_test.id('r11')),
  'IB-35: BPH sees it in the Terlambat view');
reset role; select nexus_test.login_as(8);
select is((select row_no from nexus.borrowing_queue('borrowed') where request_id = nexus_test.id('r11')), 1::bigint,
  'F9.2: Terlambat comes first in the loans view');
select ok((select overdue >= 1 and action_needed >= 1 from nexus.borrowing_queue_counts()), 'design 4.4: counts include the overdue loan');
-- IB-36: the overdue unit keeps blocking every later day until it is returned (Q4: 3 good, 1 overdue out)
select is((select free_qty from nexus.inventory_item_availability(nexus_test.id('q4'), nexus_test.d(20), nexus_test.d(21))), 2,
  'IB-36/R4: an overdue loan holds its quantity open-ended');

-- =============================================================================================
-- 10. Period change, no period, deactivation (IB-38..IB-40, IB-03, L7, R11)
-- =============================================================================================
reset role; select nexus_test.login_as(14);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r11'), nexus_test.ver('r11'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r11', 'q4'), 'good', 1)))),
  'permission_required', 'IB-38: P-OLD (Operations only in the previous period) cannot record a return');
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
update public.periods set is_active = true where id = nexus_test.period(3);
insert into public.assignments (member_id, org_unit_id, position_id, period_id) values
  (nexus_test.mid(6),  nexus_test.unit('Departemen Operasional'), nexus_test.pos('department', 'Kepala Departemen'), nexus_test.period(3)),
  (nexus_test.mid(10), nexus_test.unit('Logistik'),               nexus_test.pos('division', 'Staff'),               nexus_test.period(3));
select nexus_test.login_as(7);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_approve(nexus_test.id('ro1'), nexus_test.ver('ro1'))$$), 'permission_required',
  'IB-38/AC-42: the previous head has no right after the switch, without logging out');
reset role; select nexus_test.login_as(6);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('ro1'), nexus_test.ver('ro1'))), 'approved',
  'IB-38/L7: the new head approves an open request of the previous period');
reset role; select nexus_test.logout();
select is((select period_id from nexus.borrowing_requests where id = nexus_test.id('ro1')), nexus_test.period(2),
  'F11.2: the request keeps its creation period');
select is((select period_id from nexus.borrowing_status_history where request_id = nexus_test.id('ro1') and event = 'approved'), nexus_test.period(3),
  'the event itself is tied to the active period');
select nexus_test.login_as(10);
select is((select status from nexus.borrowing_request_return(nexus_test.id('r11'), nexus_test.ver('r11'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r11', 'q4'), 'good', 1)))), 'returned',
  'IB-38/AC-42: the new Operations member records the return of an old-period loan');
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r11'), nexus_test.ver('r11'), 'x')),
  'closed_period', 'L7/L11: a closed request of a previous period is read-only (no correction)');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select nexus.borrowing_request_detail(nexus_test.id('r1'))$$), 'request_not_found',
  'IB-38/L8: last period''s BPH no longer reads other requests');
reset role; select nexus_test.login_as(11);
select is(nexus.borrowing_request_detail(nexus_test.id('r1')) ->> 'status', 'returned', 'IB-38/L9: the requester still reads their own old request');
reset role; select nexus_test.login_as(6);
select is(nexus.borrowing_request_detail(nexus_test.id('r1')) ->> 'status', 'returned', 'IB-38: a current view_all holder reads old closed requests');
reset role; select nexus_test.login_as(11);
select nexus_test.put('r_p3', request_id) from nexus.borrowing_request_create(nexus_test.d(30), nexus_test.d(30), 'Uji periode baru',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
select is((select period_id from nexus.borrowing_requests r where r.id = nexus_test.id('r_p3')), nexus_test.period(3),
  'R4: a new request belongs to the new active period');

-- No active period (IB-40, R11, R12)
reset role; select nexus_test.logout();
update public.periods set is_active = false where is_active;
select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(1), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'no_active_period', 'IB-40/AC-43: no request without an active period');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_cancel(nexus_test.id('r13'), nexus_test.ver('r13'))$$), 'no_active_period',
  'spec section 4: no transition works without an active period');
select ok((select count(*) from nexus.inventory_item_list()) = 6, 'IB-40: the catalog stays readable');
select ok((select count(*) from nexus.borrowing_my_requests('all')) > 0, 'L9: own requests stay readable');
reset role; select nexus_test.login_as(8);
select is(nexus_test.hint_of($$select nexus.inventory_stock_add(nexus_test.id('q4'), 'good', 1, 'x')$$), 'permission_required',
  'R11/E4: Operations rights match nothing without an active period');
reset role; select nexus_test.logout();
update public.periods set is_active = true where id = nexus_test.period(2);

-- Deactivated requester (IB-39, IB-03, L1)
select nexus_test.login_as(7);
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r14'), nexus_test.ver('r14'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r14', 'q4'), 'quantity', 1)))), 'borrowed', 'r14 handed over');
reset role; select nexus_test.logout();
update public.members set is_active = false where id = nexus_test.mid(11);
select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.borrowing_my_requests()$$), 'not_active_member', 'IB-03/IB-39: a deactivated member gets nothing (L1)');
select is(nexus_test.hint_of($$select nexus.borrowing_request_detail(nexus_test.id('r14'))$$), 'not_active_member', 'IB-03: not even their own detail');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_list()$$), 'permission_required', 'IB-03: nor the catalog');
select is((select count(*)::int from nexus.borrowing_requests) + (select count(*)::int from nexus.inventory_items), 0,
  'IB-03: direct reads return nothing');
reset role; select nexus_test.login_as(9);
select ok((select requester_name = 'Test Persona 11' from nexus.borrowing_queue('borrowed') where request_id = nexus_test.id('r14')),
  'IB-39: the request stays with the requester''s name');
select is((select status from nexus.borrowing_request_return(nexus_test.id('r14'), nexus_test.ver('r14'),
           jsonb_build_array(nexus_test.q(nexus_test.line('r14', 'q4'), 'good', 1)))), 'returned',
  'IB-39: Operations still records the return');
reset role; select nexus_test.logout();
update public.members set is_active = true where id = nexus_test.mid(11);

select nexus_test.login_as(15);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(1), nexus_test.d(1), 'x', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'not_active_member', 'IB-03: P-INACTIVE cannot submit');
select is(nexus_test.hint_of($$select * from nexus.inventory_status_counts()$$), 'permission_required', 'IB-03: P-INACTIVE gets no Dashboard counts');
reset role; select nexus_test.login_as(17);
select is(nexus_test.hint_of($$select * from nexus.borrowing_my_requests()$$), 'not_active_member', 'IB-03: P-UNLINKED gets nothing');
select is(nexus_test.hint_of($$select * from nexus.inventory_item_availability(nexus_test.id('q1'), nexus_test.d(1), nexus_test.d(1))$$), 'permission_required',
  'IB-03: P-UNLINKED gets no availability');
reset role; select nexus_test.logout();
set local role authenticated;
select is(nexus_test.hint_of($$select * from nexus.inventory_item_list()$$), 'permission_required', 'IB-03: a token without a subject gets nothing');
select is(nexus_test.hint_of($$select * from nexus.borrowing_my_requests()$$), 'not_active_member', 'IB-03: ... no own requests either');
reset role;

-- =============================================================================================
-- 11. Never delete, append-only (IB-41, L5)
-- =============================================================================================
select nexus_test.login_as(1);
select throws_ok($$delete from nexus.borrowing_requests$$, '42501', null, 'IB-41: P-ADMIN cannot delete requests (no privilege)');
select throws_ok($$delete from nexus.inventory_items$$, '42501', null, 'IB-41: P-ADMIN cannot delete items');
select throws_ok($$update nexus.borrowing_requests set status = 'returned'$$, '42501', null, 'IB-41: P-ADMIN cannot update requests directly');
reset role; select nexus_test.login_as(8);
select throws_ok($$insert into nexus.borrowing_status_history (request_id, event, to_status, actor_member_id, period_id)
                   values (nexus_test.id('r1'), 'approved', 'approved', nexus_test.mid(8), nexus_test.period(2))$$, '42501', null,
  'IB-41: history accepts inserts only through the functions');
reset role; select nexus_test.logout();
select is(nexus_test.hint_of($$delete from nexus.inventory_items where id = nexus_test.id('q3')$$), 'append_only', 'IB-41/L5: owner cannot delete an item');
select is(nexus_test.hint_of($$delete from nexus.inventory_units where id = nexus_test.unit_n('t1', 1)$$), 'append_only', 'IB-41: ... nor a unit');
select is(nexus_test.hint_of($$delete from nexus.borrowing_requests where id = nexus_test.id('r9')$$), 'append_only', 'IB-41: ... nor a request');
select is(nexus_test.hint_of($$delete from nexus.borrowing_request_lines$$), 'append_only', 'IB-41: ... nor a line');
select is(nexus_test.hint_of($$delete from nexus.inventory_categories$$), 'append_only', 'IB-10: list entries are never deleted');
select is(nexus_test.hint_of($$update nexus.borrowing_status_history set note = 'x'$$), 'append_only', 'IB-41: the timeline is append-only');
select is(nexus_test.hint_of($$update nexus.inventory_item_history set note = 'x'$$), 'append_only', 'A-IB6: item history is append-only');
select is(nexus_test.hint_of($$delete from nexus.borrowing_line_returns$$), 'append_only', 'IB-41: return outcomes are append-only');
select is(nexus_test.hint_of($$delete from nexus.borrowing_evidence_photos$$), 'append_only', 'IB-32: evidence records are never deleted');
select is(nexus_test.hint_of($$update nexus.borrowing_evidence_photos set storage_path = storage_path$$), 'append_only', 'IB-32: ... nor replaced');
select is(nexus_test.hint_of($$update nexus.borrowing_extensions set note = 'x'$$), 'append_only', 'IB-25: extension history is append-only');
select is(nexus_test.hint_of($$delete from nexus.borrowing_return_reversals$$), 'append_only', 'A-IB15: corrections are append-only');
select is(nexus_test.hint_of($$truncate nexus.borrowing_requests cascade$$), 'append_only', 'IB-41: no truncate');
select is(nexus_test.hint_of($$update nexus.borrowing_requests set purpose = 'x' where id = nexus_test.id('r9')$$), 'immutable_column',
  'A-IB7: a submitted request is never edited (not even by hand)');

-- =============================================================================================
-- 12. Exports and log (IB-43, IB-44), Dashboard (IB-45)
-- =============================================================================================
select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.inventory_export('csv')$$), 'permission_required', 'IB-43: P-PLAIN cannot export the catalog');
reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of($$select * from nexus.borrowing_export('csv')$$), 'permission_required', 'IB-43: P-STAFF-PUB cannot export borrowing');
reset role; select nexus_test.login_as(3);
select is(nexus_test.hint_of($$select * from nexus.inventory_export('docx')$$), 'invalid_format', 'invalid format refused');
select is(nexus_test.hint_of($$select * from nexus.inventory_export('csv', p_status => 'archived')$$), 'permission_required',
  'A-IB5: archived entries are exported only by managers');
select is(nexus_test.log_count(), 0, 'IB-44: refused exports wrote no log row');
select is((select count(*)::int from nexus.inventory_export('csv')),
          (select (count(*) filter (where mode = 'quantity') + coalesce(sum(unit_count) filter (where mode = 'tracked'), 0))::int
           from nexus.inventory_item_list(p_page_size => 50)),
  'IB-43: catalog export = one row per quantity item + one per active unit');
select is(nexus_test.log_count(), 1, 'IB-44: one log row per export');
select ok((select array_agg(code order by row_no) = (select array_agg(c order by c) from unnest(array_agg(code)) c) or true
           from nexus.inventory_export('xlsx')), 'second export runs');
select is((select count(*)::int from nexus.inventory_export('pdf', p_search => 'Uji Q')), 4, 'IB-43: search filter respected (4 quantity items)');
reset role; select nexus_test.logout();
select ok((select module = 'inventory' and exporter_member_id = nexus_test.mid(3) and format = 'pdf' and period_id = nexus_test.period(2)
                  and (filters ->> 'search_used')::boolean and filters::text !~* 'uji' and row_count = 4
           from nexus.inventory_borrowing_export_logs order by id desc limit 1),
  'IB-44: log row = module, exporter from the session, format, filters (no search text), period, count');
select nexus_test.login_as(8);
select is((select count(*)::int from nexus.borrowing_export('xlsx', 'all')), (select count(*)::int from nexus.borrowing_queue('all', p_page_size => 50)),
  'IB-43: borrowing export = the screen rows');
select is((select count(*)::int from nexus.borrowing_export('csv', 'open_all_periods')), (select count(*)::int from nexus.borrowing_open_loans()),
  'A-IB11: the open-loans export matches the open-loans list');
select ok((select bool_and(units_handed_over is not null) from nexus.borrowing_export('csv', 'closed')), 'export carries handed-over unit codes');
select throws_ok($$select * from nexus.inventory_borrowing_export_logs$$, '42501', null, 'IB-44: clients cannot read the log directly');
reset role; select nexus_test.logout();
select is((select count(*)::int from nexus.inventory_borrowing_export_logs where module = 'borrowing'), 3, 'IB-44: three borrowing exports logged');
select is(nexus_test.hint_of($$insert into nexus.inventory_borrowing_export_logs (module, exporter_member_id, format, filters, row_count, period_id)
                                values ('inventory', gen_random_uuid(), 'csv', '{}', 0, gen_random_uuid())$$), 'export_log_direct_insert',
  'IB-44: a hand-written log row is refused');
select is(nexus_test.hint_of($$update nexus.inventory_borrowing_export_logs set format = 'pdf'$$), 'append_only', 'IB-44: the log cannot be updated');
select is(nexus_test.hint_of($$delete from nexus.inventory_borrowing_export_logs$$), 'append_only', 'IB-44: ... or deleted');

-- Dashboard (IB-45, A-IB32): Q1 4 good + 1 needs service; Q2 2; Q3 0 (2 damaged, not shown); Q4 3;
-- T1: 2 good (unit 2 and the serviced unit 3) + 1 needs service, unit 1 lost; T2 2 good. ro2 has 1 Q1 out.
select nexus_test.login_as(16);
select is((select array[good_count, good_on_loan_count, needs_service_count, item_count] from nexus.inventory_status_counts()),
          array[4 + 2 + 3 + 2 + 2, 1, 1 + 1, 6],
  'IB-45/A-IB32: counts for every active member: good incl. on loan, on loan, needs service; archived and lost excluded');

-- =============================================================================================
-- 13. RLS per persona on the tables (IB-48)
-- =============================================================================================
reset role; select nexus_test.logout();
select count(*) as own11 from nexus.borrowing_requests where requester_member_id = nexus_test.mid(11) \gset
select count(*) as all_req from nexus.borrowing_requests \gset
select count(*) as own11_ext from nexus.borrowing_extensions e join nexus.borrowing_requests r on r.id = e.request_id
  where r.requester_member_id = nexus_test.mid(11) \gset
select count(*) as own11_lines from nexus.borrowing_request_lines l join nexus.borrowing_requests r on r.id = l.request_id
  where r.requester_member_id = nexus_test.mid(11) \gset
select nexus_test.login_as(11);
select is((select count(*) from nexus.borrowing_requests), :own11::bigint, 'IB-48: P-PLAIN reads only own requests');
select is((select count(*) from nexus.borrowing_request_lines), :own11_lines::bigint, 'IB-48: ... only own lines');
select ok((select count(*) from nexus.borrowing_evidence_photos) >= 1
          and not exists (select 1 from nexus.borrowing_evidence_photos e where split_part(e.storage_path, '/', 1)::uuid not in
                          (select id from nexus.borrowing_requests)), 'IB-48: ... only own evidence records');
select is((select count(*)::int from nexus.inventory_item_history), 0, 'IB-48: no item history for members');
select is((select count(*) from nexus.borrowing_extensions), :own11_ext::bigint, 'IB-48: only extensions of own requests');
reset role; select nexus_test.login_as(1);
select is((select count(*)::int from nexus.borrowing_requests) + (select count(*)::int from nexus.borrowing_line_returns)
          + (select count(*)::int from nexus.borrowing_evidence_photos) + (select count(*)::int from nexus.borrowing_status_history), 0,
  'IB-48/B18: P-ADMIN (no own requests, no assignment) reads zero rows');
reset role; select nexus_test.login_as(3);
select is((select count(*) from nexus.borrowing_requests), :all_req::bigint, 'IB-48: P-KETUM (view_all) reads all requests');
select ok((select count(*) from nexus.inventory_item_history) > 0, 'IB-48: view_all holders read item history');
reset role; select nexus_test.login_as(15);
select is((select count(*)::int from nexus.borrowing_requests) + (select count(*)::int from nexus.borrowing_request_lines)
          + (select count(*)::int from nexus.borrowing_line_returns) + (select count(*)::int from nexus.borrowing_evidence_photos)
          + (select count(*)::int from nexus.borrowing_status_history) + (select count(*)::int from nexus.inventory_item_history)
          + (select count(*)::int from nexus.inventory_items), 0,
  'IB-48: P-INACTIVE reads zero rows everywhere');
reset role; select nexus_test.login_as(8);
select ok((select count(*) from nexus.inventory_items where not is_active) = 1, 'managers read archived items through RLS');

-- =============================================================================================
-- 13b. Owner caps 2026-11-07: at most 5 waiting (submitted) requests per member, at most 20 new
--      requests per member per Jakarta day.
-- =============================================================================================
reset role; select nexus_test.logout();
select count(*)::int as lect_today from nexus.borrowing_requests
  where requester_member_id = nexus_test.mid(16) and nexus._jakarta_date(created_at) = nexus._ib_today() \gset
select nexus_test.login_as(16);
select is(nexus_test.create_n('cap', 5, 'q4', 40), 5, 'a member can have 5 requests waiting');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(40), nexus_test.d(40), 'Uji batas', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'too_many_open_requests', 'owner cap: the 6th waiting request is refused');
select is((select count(*)::int from nexus.borrowing_my_requests() where status = 'submitted'), 5, 'the refusal created nothing');
select is((select status from nexus.borrowing_request_cancel(nexus_test.id('cap1'), nexus_test.ver('cap1'))), 'cancelled', 'cancel one waiting request');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(40), nexus_test.d(40), 'Uji batas', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'no_error', 'owner cap: with 4 waiting a new request is allowed again');
reset role; select nexus_test.login_as(16);
select is(nexus_test.create_cancel(20 - (:lect_today + 5), 'q4', 41), 20 - (:lect_today + 5),
  'create (and cancel) up to 20 requests today');
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(41), nexus_test.d(41), 'Uji batas', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'daily_request_limit', 'owner cap: the 21st request of the Jakarta day is refused');
reset role; select nexus_test.logout();
select is((select count(*)::int from nexus.borrowing_requests
           where requester_member_id = nexus_test.mid(16) and nexus._jakarta_date(created_at) = nexus._ib_today()), 20,
  'exactly 20 requests exist for that member today');
select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.borrowing_request_create(nexus_test.d(41), nexus_test.d(41), 'Uji', jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)))$$),
  'no_error', 'the caps are per member: another member is not affected');

-- =============================================================================================
-- 14. Storage policies (private bucket, IB-29, IB-32, L11). Run only when a storage schema exists.
-- =============================================================================================
reset role; select nexus_test.logout();
select nexus_test.login_as(11);
select nexus_test.put('r15', request_id) from nexus.borrowing_request_create(nexus_test.d(0), nexus_test.d(0), 'Uji foto',
  jsonb_build_array(jsonb_build_object('item_id', nexus_test.id('q4'), 'quantity', 1)));
reset role; select nexus_test.login_as(7);
select is((select status from nexus.borrowing_request_approve(nexus_test.id('r15'), nexus_test.ver('r15'))), 'approved', 'r15 approved');
reset role; select nexus_test.login_as(8);
select is((select status from nexus.borrowing_request_hand_over(nexus_test.id('r15'), nexus_test.ver('r15'),
           jsonb_build_array(jsonb_build_object('line_id', nexus_test.line('r15', 'q4'), 'quantity', 1)))), 'borrowed', 'r15 handed over');
select ok(nexus.borrowing_evidence_can_upload(nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg'),
  'upload check: a handle holder may upload into a request being returned');
select ok(not nexus.borrowing_evidence_can_upload(nexus_test.id('r1')::text || '/' || gen_random_uuid()::text || '.jpg'),
  'upload check: not into a request that is not Dipinjam');
select ok(not nexus.borrowing_evidence_can_upload(nexus_test.id('r15')::text || '/../x.jpg')
          and not nexus.borrowing_evidence_can_upload(nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.exe'),
  'upload check: bad names and types are refused');
reset role; select nexus_test.login_as(11);
select ok(not nexus.borrowing_evidence_can_upload(nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg'),
  'upload check: the requester cannot upload evidence');
select ok(nexus.borrowing_evidence_can_read((select storage_path from nexus.borrowing_evidence_photos limit 1)),
  'read check: the requester reads evidence attached to their own request');
reset role; select nexus_test.logout();
select storage_path as path_r1 from nexus.borrowing_evidence_photos e join nexus.borrowing_line_returns lr on lr.id = e.line_return_id
  join nexus.borrowing_request_lines l on l.id = lr.line_id where l.request_id = nexus_test.id('r1') limit 1 \gset
select nexus_test.login_as(10);
select ok(not nexus.borrowing_evidence_can_read(:'path_r1'), 'read check: another member cannot read the evidence');
reset role; select nexus_test.login_as(3);
select ok(nexus.borrowing_evidence_can_read(:'path_r1'), 'read check: view_all holders (BPH) can read it');

-- Through the real policies on storage.objects (stub in the throwaway container; Supabase on hosted).
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.sto_val($$select public::text || ':' || coalesce(file_size_limit::text, '-') || ':' || coalesce(array_to_string(allowed_mime_types, ','), '-')
                               from storage.buckets where id = 'nexus-borrowing-evidence'$$),
          'false:1572864:image/jpeg,image/png,image/webp', 'the evidence bucket is private, 1.5 MiB, JPG/PNG/WebP only')
  else skip('Storage not installed (load tests/support/storage_stub.sql)', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto($$insert into storage.buckets (id, name) values ('other-bucket', 'other-bucket')$$), 'ok', 'a second bucket for the isolation test')
  else skip('Storage not installed', 1) end;
select nexus_test.sto_count($$bucket_id = 'nexus-borrowing-evidence'$$) as objects_before \gset
select nexus_test.login_as(8);
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-borrowing-evidence', %L)$$,
                                nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg')), 'ok',
          'Storage: a handle holder uploads into a borrowed request''s folder')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-borrowing-evidence', %L)$$,
                                nexus_test.id('r1')::text || '/' || gen_random_uuid()::text || '.jpg')), '42501',
          'Storage: no upload into a request that is not being returned')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('other-bucket', %L)$$, 'x.jpg')), '42501',
          'Storage: our policies grant nothing in other buckets')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto($$delete from storage.objects where bucket_id = 'nexus-borrowing-evidence'$$)
          || ':' || nexus_test.sto($$update storage.objects set name = name || '.x' where bucket_id = 'nexus-borrowing-evidence'$$)
          || ':' || nexus_test.sto_count($$bucket_id = 'nexus-borrowing-evidence' and name !~ '\.x$'$$)::text,
          'ok:ok:' || (:objects_before + 1)::text,
          'IB-32: a client delete or overwrite changes nothing (no delete/update policy); the new upload is the only addition')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'path_r1')) = 1, 'Storage: Operations (view_all) sees the evidence file')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.login_as(11);
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-borrowing-evidence', %L)$$,
                                nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg')), '42501',
          'Storage: the requester cannot upload')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'path_r1')) = 1
          and nexus_test.sto_count(format('name like %L', nexus_test.id('r15')::text || '/%')) = 0,
          'Storage: the requester sees attached evidence of their own request, not unattached uploads')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.login_as(10);
select case when nexus_test.has_storage()
  then ok(nexus_test.sto_count(format('name = %L', :'path_r1')) = 0
          and nexus_test.sto_count($$bucket_id = 'nexus-borrowing-evidence'$$)
              = nexus_test.sto_count(format('name like %L', nexus_test.id('r7')::text || '/%')),
          'Storage: another member sees no foreign evidence (only the photo of their own request r7)')
  else skip('Storage not installed', 1) end;
reset role; select nexus_test.logout();
set local role anon;
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count($$bucket_id = 'nexus-borrowing-evidence'$$), 0, 'Storage: anon sees nothing')
  else skip('Storage not installed', 1) end;
reset role;

-- Review L6: at most 10 unattached uploads per request folder
select count(nexus_test.photo('r15')) as flood_files from generate_series(1, 10) \gset
select nexus_test.login_as(8);
select case when nexus_test.has_storage()
  then ok(not nexus.borrowing_evidence_can_upload(nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg'),
          'L6: no upload once 10 unattached files wait in the request folder')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-borrowing-evidence', %L)$$,
                                nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg')), '42501',
          'L6: ... enforced by the Storage policy')
  else skip('Storage not installed', 1) end;

-- 20261109100000 Fix 1: only unattached files created in the last 24 hours count. Age every waiting
-- file of r15 (the 10 above + the earlier policy upload) to 25 hours: abandoned uploads stop blocking.
reset role; select nexus_test.logout();
select nexus_test.sto(format($$update storage.objects set created_at = now() - interval '25 hours'
                               where bucket_id = 'nexus-borrowing-evidence' and name like %L$$,
                             nexus_test.id('r15')::text || '/%')) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.sto_count(format($$bucket_id = 'nexus-borrowing-evidence' and name like %L and created_at < now() - interval '24 hours'$$,
                                      nexus_test.id('r15')::text || '/%')), 11,
          'Fix 1 setup: 11 unattached files in r15, all older than 24 hours')
  else skip('Storage not installed', 1) end;
select nexus_test.login_as(8);
select case when nexus_test.has_storage()
  then ok(nexus.borrowing_evidence_can_upload(nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg'),
          'Fix 1: unattached files older than 24 hours no longer block the upload')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-borrowing-evidence', %L)$$,
                                nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg')), 'ok',
          'Fix 1: ... and the Storage policy lets it through (1 recent file now)')
  else skip('Storage not installed', 1) end;
-- 9 more recent files = 10 recent unattached: blocked again.
reset role; select nexus_test.logout();
select count(nexus_test.photo('r15')) as flood_files_recent from generate_series(1, 9) \gset
select nexus_test.login_as(8);
select case when nexus_test.has_storage()
  then ok(not nexus.borrowing_evidence_can_upload(nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg'),
          'Fix 1: 10 unattached files from the last 24 hours still block (cap 10 unchanged)')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto(format($$insert into storage.objects (bucket_id, name) values ('nexus-borrowing-evidence', %L)$$,
                                nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg')), '42501',
          'Fix 1: ... enforced by the Storage policy')
  else skip('Storage not installed', 1) end;
-- Boundary: a file 23 hours old still counts (inside the window).
reset role; select nexus_test.logout();
select nexus_test.sto(format($$update storage.objects set created_at = now() - interval '23 hours'
                               where bucket_id = 'nexus-borrowing-evidence' and name like %L
                                 and created_at >= now() - interval '1 hour'$$,
                             nexus_test.id('r15')::text || '/%')) as sto_result \gset
select nexus_test.login_as(8);
select case when nexus_test.has_storage()
  then ok(not nexus.borrowing_evidence_can_upload(nexus_test.id('r15')::text || '/' || gen_random_uuid()::text || '.jpg'),
          'Fix 1: files 23 hours old still count (window is 24 hours)')
  else skip('Storage not installed', 1) end;

-- Review M2: the bucket guard never changes an existing bucket; it stops on any difference
reset role; select nexus_test.logout();
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._ib_ensure_evidence_bucket()'), 'no_error', 'M2: re-running with an identical bucket is a no-op')
  else is(nexus._ib_ensure_evidence_bucket(), 'skipped', 'M2: without Storage the guard skips') end;
select nexus_test.sto($$update storage.buckets set public = true where id = 'nexus-borrowing-evidence'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._ib_ensure_evidence_bucket()'), 'bucket_conflict', 'M2: an existing PUBLIC bucket stops the migration')
  else skip('Storage not installed', 1) end;
select nexus_test.sto($$update storage.buckets set public = false, file_size_limit = 5242880 where id = 'nexus-borrowing-evidence'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._ib_ensure_evidence_bucket()'), 'bucket_conflict', 'M2: a different size limit stops it')
  else skip('Storage not installed', 1) end;
select nexus_test.sto($$update storage.buckets set file_size_limit = 1572864, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'] where id = 'nexus-borrowing-evidence'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._ib_ensure_evidence_bucket()'), 'bucket_conflict', 'M2: different file types stop it')
  else skip('Storage not installed', 1) end;
select case when nexus_test.has_storage()
  then is(nexus_test.sto_val($$select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'nexus-borrowing-evidence'$$),
          'false:1572864:image/jpeg,image/png,image/webp,image/gif', 'M2: the guard changed nothing in the existing bucket')
  else skip('Storage not installed', 1) end;
select nexus_test.sto($$update storage.buckets set allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'] where id = 'nexus-borrowing-evidence'$$) as sto_result \gset
select case when nexus_test.has_storage()
  then is(nexus_test.hint_of('select nexus._ib_ensure_evidence_bucket()'), 'no_error', 'M2: the same types in another order are accepted')
  else skip('Storage not installed', 1) end;
savepoint unscoped_policy;
select nexus_test.sto($$create policy zz_test_unscoped on storage.objects for select to authenticated using (true)$$) as sto_result \gset
select nexus_test.hint_of('select nexus._ib_ensure_evidence_bucket()') as unscoped_hint \gset
rollback to savepoint unscoped_policy;
release savepoint unscoped_policy;  -- back to the main transaction (no lingering subtransaction)
select case when nexus_test.has_storage()
  then is(:'unscoped_hint'::text, 'storage_policy_unscoped', 'M2: a Storage policy without a bucket_id condition stops the migration')
  else skip('Storage not installed', 1) end;

-- =============================================================================================
-- 15. Fixes approved by the owner 2026-11-08 (migration 20261108100000_nexus_inventory_borrowing_fixes)
--     Active period here: period 2. r1 and r16 were corrected once and returned again; r7 and r17 were
--     never corrected (their stock changed since); r8 is a plain returned request; r15 is Dipinjam
--     (Q4 x1); r_p3 is a waiting request of period 3.
-- =============================================================================================
reset role; select nexus_test.logout();
-- SQLSTATE | hint | message | detail of a statement ('no_error' if it succeeds; rolled back either way).
create function nexus_test.err_of(p_sql text) returns text language plpgsql
as $$
declare
  v_state text; v_msg text; v_hint text; v_detail text;
begin
  execute p_sql;
  return 'no_error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_state || '|' || coalesce(v_hint, '') || '|' || v_msg || '|' || coalesce(v_detail, '');
end
$$;
grant execute on function nexus_test.err_of(text) to authenticated;
create function nexus_test.out_cols_bpl() returns text[] language sql stable
as $$
  select array_agg(a.n order by a.i)
  from pg_proc f, unnest(f.proargnames, f.proargmodes::text[]) with ordinality as a(n, m, i)
  where f.oid = 'nexus.borrowing_period_list()'::regprocedure and a.m = 't'
$$;
grant execute on function nexus_test.out_cols_bpl() to authenticated;
select reference as ref_r1 from nexus.borrowing_requests where id = nexus_test.id('r1') \gset
select reference as ref_r17 from nexus.borrowing_requests where id = nexus_test.id('r17') \gset
select reference as ref_r8 from nexus.borrowing_requests where id = nexus_test.id('r8') \gset

-- Structure: one overload per changed function (the old ones were dropped), API grants as before.
select ok(to_regprocedure('nexus.borrowing_queue(text,text,date,date,uuid,integer,integer)') is null
          and to_regprocedure('nexus.borrowing_export(text,text,text,date,date,uuid)') is null
          and to_regprocedure('nexus._ib_queue_rows(text,text,date,date,uuid)') is null
          and to_regprocedure('nexus.borrowing_queue(text,text,date,date,uuid,integer,integer,uuid)') is not null
          and to_regprocedure('nexus.borrowing_export(text,text,text,date,date,uuid,uuid)') is not null
          and to_regprocedure('nexus._ib_queue_rows(text,text,date,date,uuid,uuid)') is not null,
  'Fix 4: the old queue/export overloads are gone; the new ones take p_period_id');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname in ('borrowing_queue', 'borrowing_export', '_ib_queue_rows',
                                                        'borrowing_request_detail_by_ref', '_ib_was_corrected',
                                                        'borrowing_period_list')), 6,
  'Fix 1/4: exactly one version of each new or changed function');
select ok(has_function_privilege('authenticated', 'nexus.borrowing_request_detail_by_ref(text)', 'execute')
          and not has_function_privilege('anon', 'nexus.borrowing_request_detail_by_ref(text)', 'execute')
          and not has_function_privilege('authenticated', 'nexus._ib_was_corrected(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'nexus._ib_queue_rows(text,text,date,date,uuid,uuid)', 'execute'),
  'Fix 1/4: the lookup is client API (authenticated only); the helpers are internal');

-- Fix 1: detail by reference (same JSON, same visibility, no existence probing)
select nexus_test.login_as(11);
select is(nexus.borrowing_request_detail_by_ref(:'ref_r1'), nexus.borrowing_request_detail(nexus_test.id('r1')),
  'Fix 1: the requester gets exactly the detail JSON by reference (L9)');
select is(nexus.borrowing_request_detail_by_ref('  ' || lower(:'ref_r1') || ' ') ->> 'request_id', nexus_test.id('r1')::text,
  'Fix 1: a typed reference is trimmed and upper-cased');
select is(nexus_test.hint_of(format('select nexus.borrowing_request_detail_by_ref(%L)', :'ref_r8')), 'request_not_found',
  'Fix 1: a reference of another member''s request (r8 of P-STAFF-LOG) is "not found"');
select is(nexus_test.err_of(format('select nexus.borrowing_request_detail_by_ref(%L)', :'ref_r8')),
          nexus_test.err_of($$select nexus.borrowing_request_detail_by_ref('PJM-9999999999')$$),
  'Fix 1: "not yours" and "does not exist" give the identical code, hint, message and detail');
select is(nexus_test.err_of($$select nexus.borrowing_request_detail_by_ref('PJM-9999999999')$$), 'P0002|request_not_found|Request not found|',
  'Fix 1: ... which is the plain request_not_found of borrowing_request_detail');
select is(array[nexus_test.hint_of($$select nexus.borrowing_request_detail_by_ref('PJM-1')$$),
                nexus_test.hint_of($$select nexus.borrowing_request_detail_by_ref('INV-0001')$$),
                nexus_test.hint_of($$select nexus.borrowing_request_detail_by_ref('PJM-0001''; select 1')$$),
                nexus_test.hint_of($$select nexus.borrowing_request_detail_by_ref('PJM-00000000000000001')$$),
                nexus_test.hint_of($$select nexus.borrowing_request_detail_by_ref(repeat('9', 5000))$$),
                nexus_test.hint_of($$select nexus.borrowing_request_detail_by_ref('')$$),
                nexus_test.hint_of($$select nexus.borrowing_request_detail_by_ref(null)$$)],
          array_fill('invalid_input'::text, array[7]),
  'Fix 1: a malformed, empty, null or over-long reference is invalid_input');
reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of(format('select nexus.borrowing_request_detail_by_ref(%L)', :'ref_r1')), 'request_not_found',
  'Fix 1/IB-15: P-STAFF-PUB cannot read r1 by reference');
reset role; select nexus_test.login_as(1);
select is(nexus_test.hint_of(format('select nexus.borrowing_request_detail_by_ref(%L)', :'ref_r1')), 'request_not_found',
  'Fix 1/B18: P-ADMIN without assignment cannot read it either');
reset role; select nexus_test.login_as(3);
select is(nexus.borrowing_request_detail_by_ref(:'ref_r17'), nexus.borrowing_request_detail(nexus_test.id('r17')),
  'Fix 1/IB-04: a borrowing.view_all holder (P-KETUM) reads any request by reference');
reset role; select nexus_test.login_as(15);
select is(nexus_test.hint_of(format('select nexus.borrowing_request_detail_by_ref(%L)', :'ref_r1')), 'not_active_member',
  'Fix 1/IB-03: P-INACTIVE gets nothing');
reset role; select nexus_test.login_as(17);
select is(nexus_test.hint_of($$select nexus.borrowing_request_detail_by_ref('PJM-0001')$$), 'not_active_member',
  'Fix 1/IB-03: P-UNLINKED gets nothing (checked before any lookup)');
reset role; select nexus_test.logout();
set local role anon;
select throws_ok(format('select nexus.borrowing_request_detail_by_ref(%L)', :'ref_r1'), '42501', null,
  'Fix 1: anon cannot call the lookup');
reset role;

-- Fix 2: one correction per request, visible on the detail; distinct hints
select nexus_test.login_as(8);
select is(array[(nexus.borrowing_request_detail(nexus_test.id('r1')) -> 'actions' ->> 'can_correct_return')::boolean,
                (nexus.borrowing_request_detail(nexus_test.id('r16')) -> 'actions' ->> 'can_correct_return')::boolean],
          array[false, false],
  'Fix 2a/11c: no correction button on a request that was already corrected once (r1, r16)');
select is(array[(nexus.borrowing_request_detail(nexus_test.id('r8')) -> 'actions' ->> 'can_correct_return')::boolean,
                (nexus.borrowing_request_detail(nexus_test.id('r17')) -> 'actions' ->> 'can_correct_return')::boolean],
          array[true, true],
  'Fix 2a: the button stays for returned requests never corrected (r8; r17 is refused only when pressed: stock changed)');
select is(array[nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r16'), nexus_test.ver('r16'), 'lagi')),
                nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r17'), nexus_test.ver('r17'), 'lagi')),
                nexus_test.hint_of(format('select * from nexus.borrowing_request_correct_return(%L, %s, %L)', nexus_test.id('r7'), nexus_test.ver('r7'), 'lagi'))],
          array['already_corrected', 'correction_conflict', 'correction_conflict'],
  'Fix 2b: already corrected -> already_corrected; stock or unit changed since the return -> correction_conflict');
reset role; select nexus_test.login_as(3);
select ok(not (nexus.borrowing_request_detail(nexus_test.id('r8')) -> 'actions' ->> 'can_correct_return')::boolean,
  'Fix 2a: no correction button without borrowing.handle (P-KETUM)');
-- The return's own stock guard: Q4 good stock pulled below the loan by hand (owner), then a "lost" return.
reset role; select nexus_test.logout();
select nexus_test.stock('q4', 'good') as q4_good \gset
update nexus.inventory_stock set quantity = 0 where item_id = nexus_test.id('q4') and condition = 'good';
select nexus_test.login_as(8);
select is(nexus_test.hint_of(format('select * from nexus.borrowing_request_return(%L, %s, %L)', nexus_test.id('r15'), nexus_test.ver('r15'),
                                    jsonb_build_array(nexus_test.q(nexus_test.line('r15', 'q4'), 'lost', 1, null, 'hilang', array[nexus_test.photo('r15')])))),
  'stock_mismatch', 'Fix 2b: a return whose stock no longer matches the loan answers stock_mismatch (not correction_conflict)');
reset role; select nexus_test.logout();
update nexus.inventory_stock set quantity = :q4_good where item_id = nexus_test.id('q4') and condition = 'good';
select is(nexus_test.st('r15'), 'borrowed', 'Fix 2b: the refused return changed nothing');

-- Fix 3: catalog export = catalog list, per caller (archived "Nonaktif" and lost "Hilang" units for managers)
create function nexus_test.list_keys(p_search text default null, p_status text default 'active') returns text[] language sql
as $$
  select coalesce(array_agg(l.item_id::text || ':' || coalesce(u ->> 'code', '') || ':' || coalesce(u ->> 'status', '')
                            order by l.row_no, u ->> 'code'), '{}')
  from nexus.inventory_item_list(p_search => p_search, p_status => p_status, p_page_size => 50) l
  left join lateral jsonb_array_elements(case when l.mode = 'tracked' then l.units end) u on true
$$;
create function nexus_test.export_keys(p_search text default null, p_status text default 'active') returns text[] language sql
as $$
  select coalesce(array_agg(e.item_id::text || ':' || case when e.mode = 'tracked' then coalesce(e.code, '') else '' end
                            || ':' || coalesce(e.unit_status, '') order by e.row_no), '{}')
  from nexus.inventory_export('csv', p_search => p_search, p_status => p_status) e
$$;
grant execute on function nexus_test.list_keys(text, text), nexus_test.export_keys(text, text) to authenticated;
select nexus_test.login_as(8);
select lives_ok($$select nexus.inventory_unit_set_active(nexus_test.unit_n('t2', 1), false, 'uji ekspor')$$,
  'Fix 3 setup: archive a unit of T2 (T1 already has a lost unit)');
select ok(nexus_test.export_keys() @> array[nexus_test.id('t2')::text || ':' || (nexus_test.unit_row(nexus_test.unit_n('t2', 1))).code || ':archived',
                                            nexus_test.id('t1')::text || ':' || (nexus_test.unit_row(nexus_test.unit_n('t1', 1))).code || ':lost'],
  'Fix 3: under the default filter a manager''s export holds the archived (Nonaktif) and the lost (Hilang) unit');
select is(nexus_test.export_keys(), nexus_test.list_keys(),
  'Fix 3/F12.2: manager, default filter: export rows = list rows (items and units), same order');
select is(nexus_test.export_keys('Uji T'), nexus_test.list_keys('Uji T'), 'Fix 3: ... with a search');
select is(nexus_test.export_keys(null, 'all'), nexus_test.list_keys(null, 'all'), 'Fix 3: ... with the "all" status filter');
select is(nexus_test.export_keys(null, 'archived'), nexus_test.list_keys(null, 'archived'), 'Fix 3: ... with the "archived" filter');
reset role; select nexus_test.login_as(3);
select is(nexus_test.export_keys(), nexus_test.list_keys(), 'Fix 3: non-manager with inventory.export (P-KETUM): export = list');
select ok(not exists (select 1 from nexus.inventory_export('csv') e where e.unit_status in ('archived', 'lost') or not e.item_is_active),
  'Fix 3/A-IB5: a non-manager never exports archived or lost entries');
reset role; select nexus_test.login_as(8);
select ok(nexus.inventory_unit_set_active(nexus_test.unit_n('t2', 1), true), 'Fix 3 cleanup: reactivate the unit');

-- Fix 4: borrowing period filter (queue and export hold the same rows; logged; view_all only)
select is((select array_agg(reference order by row_no) from nexus.borrowing_queue('pending', p_period_id => nexus_test.period(3))),
          (select array_agg(reference) from nexus.borrowing_requests where id = nexus_test.id('r_p3')),
  'Fix 4: queue "pending" filtered on period 3 = only the waiting request created in period 3');
select ok((select bool_and(period_id = nexus_test.period(3)) and count(*) >= 1
           from nexus.borrowing_queue('all', p_period_id => nexus_test.period(3), p_page_size => 50)),
  'Fix 4: "all" with a period = everything of THAT period');
select ok(not exists (select 1 from nexus.borrowing_queue('all', p_page_size => 50) where period_id <> nexus_test.period(2))
          and exists (select 1 from nexus.borrowing_queue('pending', p_page_size => 50) where request_id = nexus_test.id('r_p3')),
  'Fix 4: without the filter nothing changed ("all" = active period, "pending" spans all periods)');
select is((select array_agg(reference order by row_no) from nexus.borrowing_export('csv', 'all', p_period_id => nexus_test.period(3))),
          (select array_agg(reference order by row_no) from nexus.borrowing_queue('all', p_period_id => nexus_test.period(3), p_page_size => 50)),
  'Fix 4/section 8: export with the period filter = the screen rows, same order');
select is((select array_agg(reference order by row_no) from nexus.borrowing_export('csv', 'pending', p_period_id => nexus_test.period(2))),
          (select array_agg(reference order by row_no) from nexus.borrowing_queue('pending', p_period_id => nexus_test.period(2), p_page_size => 50)),
  'Fix 4: ... also for another view and period');
select is((select count(*)::int from nexus.borrowing_export('csv', 'all', p_period_id => nexus_test.period(1))), 0,
  'Fix 4: a period without requests exports zero rows (no error)');
reset role; select nexus_test.logout();
select ok((select filters ->> 'period_id' = nexus_test.period(1)::text and row_count = 0 and module = 'borrowing'
           from nexus.inventory_borrowing_export_logs order by id desc limit 1),
  'Fix 4/IB-44: the log records the chosen period like the other filters');
select ok((select (filters ? 'period_id') and filters -> 'period_id' = 'null'::jsonb
           from nexus.inventory_borrowing_export_logs where module = 'borrowing'
             and filters ->> 'view' = 'all' and filters ->> 'period_id' is null order by id desc limit 1),
  'Fix 4: an export without the filter logs period_id = null');
select nexus_test.log_count() as logs_before_bad_period \gset
select nexus_test.login_as(8);
select is(array[nexus_test.hint_of(format('select * from nexus.borrowing_queue(p_period_id => %L)', gen_random_uuid())),
                nexus_test.hint_of(format('select * from nexus.borrowing_export(%L, p_period_id => %L)', 'csv', gen_random_uuid()))],
          array['invalid_period', 'invalid_period'],
  'Fix 4: an unknown period id is refused (queue and export)');
reset role; select nexus_test.logout();
select is(nexus_test.log_count(), :logs_before_bad_period, 'Fix 4/IB-44: the refused export wrote no log row');
select nexus_test.login_as(10);
select is(array[nexus_test.hint_of(format('select * from nexus.borrowing_queue(p_period_id => %L)', nexus_test.period(2))),
                nexus_test.hint_of(format('select * from nexus.borrowing_export(%L, p_period_id => %L)', 'csv', nexus_test.period(2)))],
          array['permission_required', 'permission_required'],
  'Fix 4: without borrowing.view_all / borrowing.export the period filter is refused (P-STAFF-PUB)');
-- Period choices for the filter (borrowing_period_list): view_all holders only, newest first
reset role; select nexus_test.logout();
select array_agg(id::text order by label desc, id) as all_periods from public.periods \gset
select count(*)::int as period_count from public.periods \gset
select nexus_test.login_as(8);
select is((select array_agg(t.period_id::text order by t.ord) from nexus.borrowing_period_list() with ordinality as t(period_id, label, starts_on, ends_on, is_active, ord)),
          :'all_periods'::text[],
  'period list: a view_all holder (P-STAFF-LOG) gets every PI-CORE period, newest first');
select ok((select count(*) = :period_count and count(*) filter (where is_active) = 1
                  and bool_and(is_active = (period_id = nexus_test.period(2)))
           from nexus.borrowing_period_list()),
  'period list: exactly the active period is flagged is_active');
select is((select label from nexus.borrowing_period_list() where period_id = nexus_test.period(3)), '2092/2093',
  'period list: labels come from PI-CORE');
select is(nexus_test.out_cols_bpl(), array['period_id', 'label', 'starts_on', 'ends_on', 'is_active'],
  'period list: returns only id, label, dates and the active flag');
reset role; select nexus_test.login_as(3);
select ok((select count(*) = :period_count from nexus.borrowing_period_list()), 'period list: BPH (view_all) may read it');
reset role; select nexus_test.login_as(11);
select is(nexus_test.err_of($$select * from nexus.borrowing_period_list()$$), nexus_test.err_of($$select * from nexus.borrowing_queue()$$),
  'period list: a plain member gets exactly the queue''s forbidden error');
select is(nexus_test.hint_of($$select * from nexus.borrowing_period_list()$$), 'permission_required',
  'period list: ... which is permission_required');
reset role; select nexus_test.login_as(15);
select is(nexus_test.hint_of($$select * from nexus.borrowing_period_list()$$), 'permission_required', 'period list: P-INACTIVE refused');
reset role; select nexus_test.login_as(17);
select is(nexus_test.hint_of($$select * from nexus.borrowing_period_list()$$), 'permission_required', 'period list: P-UNLINKED refused');
reset role; select nexus_test.logout();
select ok(has_function_privilege('authenticated', 'nexus.borrowing_period_list()', 'execute')
          and not has_function_privilege('anon', 'nexus.borrowing_period_list()', 'execute')
          and not has_function_privilege('service_role', 'nexus.borrowing_period_list()', 'execute')
          and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'nexus.borrowing_period_list()'::regprocedure and a.grantee = 0),
  'period list: EXECUTE for authenticated only (not anon, service_role, PUBLIC)');
set local role anon;
select throws_ok($$select * from nexus.borrowing_period_list()$$, '42501', null, 'period list: anon refused');
reset role;
reset role; select nexus_test.login_as(3);
select is((select count(*)::int from nexus.borrowing_export('pdf', 'all', p_period_id => nexus_test.period(3))),
          (select count(*)::int from nexus.borrowing_queue('all', p_period_id => nexus_test.period(3), p_page_size => 50)),
  'Fix 4: BPH (view_all + export) may use the period filter');
reset role;

-- =============================================================================================
-- 16. Export totals (migration 20261109100000_nexus_export_totals_and_evidence_window, Fix 2):
--     inventory_export and borrowing_export end with total_count bigint = count(*) over () of the
--     full filtered result; everything else unchanged.
-- =============================================================================================
reset role; select nexus_test.logout();
create function nexus_test.out_cols_of(p regprocedure) returns text[] language sql stable
as $$
  select array_agg(a.n order by a.i)
  from pg_proc f, unnest(f.proargnames, f.proargmodes::text[]) with ordinality as a(n, m, i)
  where f.oid = p and a.m = 't'
$$;
grant execute on function nexus_test.out_cols_of(regprocedure) to authenticated;

-- Structure: same signatures, one version each, new trailing column, same security and grants.
select is(nexus_test.out_cols_of('nexus.inventory_export(text,text,uuid,uuid,text,text,date,date)'),
          array['row_no', 'item_id', 'code', 'item_name', 'mode', 'category_name', 'location_name', 'unit_condition',
                'unit_status', 'qty_good', 'qty_needs_service', 'qty_damaged', 'qty_total', 'item_is_active', 'free_qty',
                'total_count'],
  'Fix 2: inventory_export columns = the old list + total_count at the end');
select is(nexus_test.out_cols_of('nexus.borrowing_export(text,text,text,date,date,uuid,uuid)'),
          array['row_no', 'reference', 'status', 'period_label', 'requester_name', 'is_outside_party', 'outside_org_name',
                'outside_contact_name', 'purpose', 'items', 'units_handed_over', 'start_date', 'end_date', 'extension_count',
                'decided_by_name', 'decided_at', 'decision_note', 'handed_over_at', 'returned_at', 'returned_good',
                'returned_damaged', 'returned_lost', 'has_issue', 'is_overdue', 'overdue_days', 'is_not_picked_up',
                'is_partially_returned', 'total_count'],
  'Fix 2: borrowing_export columns = the old list + total_count at the end');
select ok((select bool_and(format_type(t.typ, null) = 'bigint')
           from pg_proc f, unnest(f.proallargtypes, f.proargnames, f.proargmodes::text[]) as t(typ, n, m)
           where f.oid in ('nexus.inventory_export(text,text,uuid,uuid,text,text,date,date)'::regprocedure,
                           'nexus.borrowing_export(text,text,text,date,date,uuid,uuid)'::regprocedure,
                           'nexus.member_data_export(text,text,uuid,text)'::regprocedure)
             and t.m = 't' and t.n = 'total_count'),
  'Fix 2: total_count is bigint in all three exports');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname in ('inventory_export', 'borrowing_export', 'member_data_export')), 3,
  'Fix 2: exactly one version of each export function');
select is((select count(*)::int from pg_proc p
           where p.oid in ('nexus.inventory_export(text,text,uuid,uuid,text,text,date,date)'::regprocedure,
                           'nexus.borrowing_export(text,text,text,date,date,uuid,uuid)'::regprocedure,
                           'nexus.member_data_export(text,text,uuid,text)'::regprocedure)
             and p.prosecdef and p.provolatile = 'v' and coalesce(p.proconfig @> array['search_path=""'], false)
             and has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute')
             and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)), 3,
  'Fix 2: the three exports stay SECURITY DEFINER, VOLATILE, search_path empty, EXECUTE for authenticated only');
select ok((select p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)
                  and has_function_privilege('authenticated', p.oid, 'execute')
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not has_function_privilege('service_role', p.oid, 'execute')
                  and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
           from pg_proc p where p.oid = 'nexus.borrowing_evidence_can_upload(text)'::regprocedure),
  'Fix 1: the upload check keeps SECURITY DEFINER, empty search_path, EXECUTE for authenticated only');

-- Rows: total_count = number of rows returned, on every row, whatever the filter.
select nexus_test.log_count() as logs_before_totals \gset
select nexus_test.login_as(8);
select ok((select count(*) > 0 and count(*) = min(e.total_count) and count(*) = max(e.total_count)
           from nexus.inventory_export('csv') e),
  'Fix 2: catalog export, default filter: total_count = rows returned (manager)');
select is((select array[count(*), min(e.total_count), max(e.total_count)]::int[] from nexus.inventory_export('csv', p_search => 'Uji Q') e),
          array[4, 4, 4], 'Fix 2: catalog export with a search: total_count follows the filter (4)');
select ok((select count(*) > 0 and count(*) = min(e.total_count) and count(*) = max(e.total_count)
           from nexus.borrowing_export('csv', 'all') e),
  'Fix 2: borrowing export "all": total_count = rows returned');
select ok((select count(*) > 0 and count(*) = min(e.total_count) and count(*) = max(e.total_count)
           from nexus.borrowing_export('csv', 'closed') e),
  'Fix 2: borrowing export "closed": total_count = rows returned');
select is((select count(*)::int from nexus.borrowing_export('csv', 'all', p_period_id => nexus_test.period(1))), 0,
  'Fix 2: an export without matches returns no rows (the server reads that as total 0)');
reset role; select nexus_test.logout();
select is(nexus_test.log_count(), :logs_before_totals + 5, 'Fix 2/IB-44: still exactly one log row per export');
-- The five exports above, oldest first: catalog, catalog "Uji Q", borrowing all, closed, period 1.
select is((select array[a[2], a[5]] from (select array_agg(l.module || ':' || l.row_count order by l.id) as a
           from (select id, module, row_count from nexus.inventory_borrowing_export_logs order by id desc limit 5) l) t),
          array['inventory:4', 'borrowing:0'],
  'Fix 2/IB-44: the logged row_count still counts the rows (4 for the searched catalog export, 0 for the empty one)');
reset role; select nexus_test.login_as(3);
select ok((select count(*) > 0 and count(*) = min(e.total_count) and count(*) = max(e.total_count)
           from nexus.inventory_export('csv') e),
  'Fix 2: catalog export for a non-manager (P-KETUM): total_count = rows returned');

-- No log row, no data: a failing log insert still fails the whole export (same transaction).
reset role; select nexus_test.logout();
select nexus_test.log_count() as logs_before_fail \gset
create function nexus_test.fail_ib_log_insert() returns trigger language plpgsql
as $$ begin raise exception 'simulated export log failure'; end $$;
create trigger zz_test_fail_ib_log before insert on nexus.inventory_borrowing_export_logs
  for each row execute function nexus_test.fail_ib_log_insert();
select nexus_test.login_as(8);
select throws_ok($$select * from nexus.inventory_export('csv')$$, 'P0001', 'simulated export log failure',
  'Fix 2: catalog export returns nothing when its log row cannot be written');
select throws_ok($$select * from nexus.borrowing_export('csv', 'all')$$, 'P0001', 'simulated export log failure',
  'Fix 2: borrowing export returns nothing when its log row cannot be written');
reset role; select nexus_test.logout();
drop trigger zz_test_fail_ib_log on nexus.inventory_borrowing_export_logs;
select is(nexus_test.log_count(), :logs_before_fail, 'Fix 2: and no log row exists');

-- Refusals unchanged.
select nexus_test.login_as(11);
select is(nexus_test.hint_of($$select * from nexus.inventory_export('csv')$$), 'permission_required',
  'Fix 2: P-PLAIN still cannot export the catalog');
reset role; select nexus_test.login_as(10);
select is(nexus_test.hint_of($$select * from nexus.borrowing_export('csv')$$), 'permission_required',
  'Fix 2: P-STAFF-PUB still cannot export borrowing');
reset role; select nexus_test.logout();
set local role anon;
select throws_ok($$select * from nexus.inventory_export('csv')$$, '42501', null, 'Fix 2: anon cannot call the catalog export');
select throws_ok($$select * from nexus.borrowing_export('csv')$$, '42501', null, 'Fix 2: anon cannot call the borrowing export');
reset role;

select * from finish();
rollback;
