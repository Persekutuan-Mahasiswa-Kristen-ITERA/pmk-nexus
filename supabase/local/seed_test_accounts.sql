-- =============================================================================================
-- LOCAL ONLY. FAKE test accounts for the NEXUS local Supabase stack (decision D-018).
-- NEVER run this against the hosted (shared) project: it writes into PI-CORE tables
-- (auth.users, auth.identities, public.members, public.periods, public.assignments).
--
-- It refuses to run unless the session sets nexus.allow_local_seed = 'yes'. `scripts/dev-db.sh`
-- sets it for you; by hand use:
--   PGOPTIONS='-c nexus.allow_local_seed=yes' psql "<local url>" -1 -v ON_ERROR_STOP=1 -f supabase/local/seed_test_accounts.sql
-- (Same idea as the W1 guard in supabase/tests/nexus_access_control.test.sql.)
--
-- Safe to run more than once: rows that already exist are skipped, nothing is deleted.
-- Every account has the same dev password (documented in docs/ops/local-setup.md), emails end in
-- @nexus.test so they can never be real people. PI-CORE triggers stay ON; this file works with them:
--   * assignments are refused for inactive members, so the deactivated member is deactivated AFTER
--     getting an assignment;
--   * the first period ever created becomes the active one, so 2026/2027 is inserted first.
-- =============================================================================================
\set ON_ERROR_STOP on

do $$
begin
  if coalesce(current_setting('nexus.allow_local_seed', true), '') <> 'yes' then
    raise exception 'seed_test_accounts.sql writes FAKE accounts into PI-CORE tables: local throwaway database only. Set nexus.allow_local_seed=yes (see scripts/dev-db.sh).';
  end if;
end
$$;

-- Data guard (security review M1): the flag above only proves intent. A real project (hosted, shared with
-- PI-CORE) always holds real members, so stop if ANY account or member has an email outside the fake
-- test domains. Checked before anything is written.
do $$
begin
  if exists (select 1 from auth.users u where u.email is null or u.email !~* '@(nexus\.test)$')
     or exists (select 1 from public.members m where m.email is not null and m.email !~* '@(nexus\.test)$') then
    raise exception 'seed_test_accounts.sql: found a non-test email address, so this is NOT a throwaway local database. Nothing was written.';
  end if;
end
$$;

-- Periods: 2026/2027 must become the active one. If the database already has a different active
-- period, stop instead of silently changing it.
insert into public.periods (label, starts_on, ends_on)
select '2026/2027', date '2026-08-01', date '2027-07-31'
where not exists (select 1 from public.periods where label = '2026/2027');

insert into public.periods (label, starts_on, ends_on)
select '2025/2026', date '2025-08-01', date '2026-07-31'
where not exists (select 1 from public.periods where label = '2025/2026');

do $$
begin
  if not exists (select 1 from public.periods where label = '2026/2027' and is_active) then
    raise exception 'Period 2026/2027 is not the active period in this database; refusing to seed on top of it.';
  end if;
end
$$;

-- Personas. Fixed ids so the file can be re-run. `unit` + `position` = the assignment in the
-- active period (null = none). `unit_type` picks the matching position (positions belong to a unit type).
create temp table _persona (
  n int primary key,
  email text not null,
  full_name text not null,
  nim text,
  access_level text not null,
  must_change boolean not null,
  has_member boolean not null,
  unit_name text,
  unit_type text,
  position_name text,
  deactivate boolean not null default false
) on commit drop;

insert into _persona values
  (1, 'member.regular@nexus.test',  'Test Anggota Biasa',        '123450001', 'member', false, true,  'IT',            'division', 'Staff',            false),
  (2, 'member.temppw@nexus.test',   'Test Anggota Sandi Sementara', '123450002', 'member', true,  true,  'Desain',        'division', 'Staff',            false),
  (3, 'member.inactive@nexus.test', 'Test Anggota Nonaktif',     '123450003', 'member', false, true,  'Pubdok',        'division', 'Staff',            true),
  (4, 'unlinked@nexus.test',        'Test Tanpa Data Anggota',   null,        'member', false, false, null,            null,       null,               false),
  (5, 'ketum@nexus.test',           'Test Ketua Umum',           '123450005', 'member', false, true,  'BPH PMK ITERA', 'bph',      'Ketua Umum',       false),
  (6, 'bendahara@nexus.test',       'Test Bendahara Umum 1',     '123450006', 'member', false, true,  'BPH PMK ITERA', 'bph',      'Bendahara Umum 1', false),
  (7, 'admin@nexus.test',           'Test System Admin',         '123450007', 'admin',  false, true,  null,            null,       null,               false);

-- 1. Auth users (what GoTrue checks at login): confirmed email, bcrypt password.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  ('a1000000-0000-4000-8000-' || lpad(p.n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', p.email,
  extensions.crypt('NexusLocal2026', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', ''
from _persona p
where not exists (select 1 from auth.users u where u.email = p.email);

-- 2. Email identity rows (GoTrue's password login looks the user up through these).
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
from _persona p
join auth.users u on u.email = p.email
where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- 3. PI-CORE member rows (all personas except the unlinked one). Inserted active, even the one that
--    is deactivated at the end, because an assignment needs an active member.
insert into public.members (id, user_id, full_name, email, nim, access_level, must_change_password)
select ('a2000000-0000-4000-8000-' || lpad(p.n::text, 12, '0'))::uuid,
       u.id, p.full_name, p.email, p.nim, p.access_level::public.access_level, p.must_change
from _persona p
join auth.users u on u.email = p.email
where p.has_member
  and not exists (select 1 from public.members m where m.email = p.email);

-- 4. Assignments in the ACTIVE period.
insert into public.assignments (member_id, org_unit_id, position_id, period_id)
select m.id, ou.id, po.id, pe.id
from _persona p
join public.members m on m.email = p.email
join public.org_units ou on ou.name = p.unit_name and ou.type::text = p.unit_type
join public.positions po on po.name = p.position_name and po.unit_type::text = p.unit_type
join public.periods pe on pe.label = '2026/2027'
where p.unit_name is not null
  and not exists (
    select 1 from public.assignments a
    where a.member_id = m.id and a.org_unit_id = ou.id and a.position_id = po.id and a.period_id = pe.id
  );

-- 5. Deactivate last (PI-CORE stamps deactivated_at itself).
update public.members m
set is_active = false
from _persona p
where p.deactivate and m.email = p.email and m.is_active;

-- Summary (shown by psql so you see what exists).
select p.email, p.full_name, coalesce(m.access_level::text, '(no member row)') as access_level,
       coalesce(m.is_active::text, '-') as is_active, coalesce(m.must_change_password::text, '-') as must_change_password,
       coalesce(p.position_name || ' / ' || p.unit_name, '-') as assignment
from _persona p
left join public.members m on m.email = p.email
order by p.n;
