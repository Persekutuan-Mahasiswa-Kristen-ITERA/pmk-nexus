-- PMK-NEXUS 0004: Member Data module (read-only directory over PI-CORE + append-only export log).
--
-- Spec:      docs/modules/member-data.md (revision 2, approved), sections 2, 4, 4.2, 5, 7, 9.
--            docs/modules/access-control.md: catalog key member_data.view_export_log, default rules
--            D32 and D33, locked rules L1, L3, L4, L5, L11, L12.
-- Decisions: D-010 (read PI-CORE only through restricted nexus functions), D-011, D-013 (L12),
--            D-019 (Member Data rules: M1-M8; member_type widens the D-010 field list).
-- PI-CORE:   verified against pi-core-v2 migrations 20261031165546 .. 20261102090000 (HEAD d8b6814).
--            Columns read here: members(id, full_name, member_type, is_active), assignments(id,
--            member_id, org_unit_id, position_id, period_id), positions(id, name, rank),
--            org_units(id, parent_id, type, name, sort_order, is_active), periods(id, label, is_active),
--            and (through the existing engine) position_roles/roles for rule matching.
--            NEVER read: email, phone, nim, nip, user_id (only via the existing identity helpers),
--            access_level (only via is_system_admin()), must_change_password, deactivated_at.
--
-- What this file adds (only nexus objects; nothing in public/private is created, altered, granted or
-- written):
--   1. Catalog key member_data.view_export_log (sensitive, never baseline: L12).
--   2. Default rules D32 (role kepala_departemen -> member_data.view) and D33 (role bph ->
--      member_data.view_export_log), each with a written reason (L12). Logged as 'seed'.
--   3. Table nexus.member_data_export_logs: append-only, no PII, written only by the export function.
--   4. Restricted SECURITY DEFINER read functions (D-010): list, unit options, active count, export,
--      export-log read. Each checks the caller's permission INSIDE (L1: inactive/unlinked = denied).
--
-- Errors carry a stable hint for the backend: permission_required (42501), invalid_status,
-- invalid_page, invalid_page_size, invalid_format, invalid_unit, search_too_long (all 22023),
-- export_log_direct_insert (42501), append_only (42501).
--
-- Re-runnable: every statement is idempotent (if not exists / or replace / on conflict / guarded
-- seed), so running the file twice changes nothing. Still run it as ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261106200000_nexus_member_data.sql
-- Requires 20261105100000 and 20261105100100 (stops if D01-D31 are not seeded; see section 2).

-- =============================================================================================
-- 1. Catalog: new sensitive key (spec 4.2, D-019 M8). allow_baseline = false is also forced by the
--    permissions_l12_baseline check (module member_data), so L12 covers it in the RPC, the trigger on
--    nexus.access_rules, and the defense-in-depth filter in nexus._rule_matches.
-- =============================================================================================

insert into nexus.permissions (key, module, label, description, is_sensitive, allow_baseline, includes_key, requires_key, sort_order)
values ('member_data.view_export_log', 'member_data', 'Read Member Data export log',
        'Read who exported the member list, when, format and filters. The System Admin always reads it (L3).',
        true, false, null, null, 72)
on conflict (key) do nothing;

insert into nexus.permission_scopes (permission_key, scope)
values ('member_data.view_export_log', 'all')
on conflict do nothing;

-- Catalog text follows the amended spec (L4 now mentions the lecturer marker). Text only; the key
-- and its flags are unchanged.
update nexus.permissions
set description = 'Member list: name, unit, position, active/inactive, Pembina marker. Never email, phone, NIM, NIP.'
where key = 'member_data.view'
  and description is distinct from 'Member list: name, unit, position, active/inactive, Pembina marker. Never email, phone, NIM, NIP.';

-- =============================================================================================
-- 2. Default rules D32 and D33 (access-control section 3). Roles are stored by key (stable, B30).
--    Guarded so a re-run never duplicates. It STOPS (and the whole file rolls back) if D01-D31 are not
--    seeded yet: seeding D32 first would make 20261105100100 think "already seeded" and skip D01-D31.
-- =============================================================================================

do $$
declare
  v_missing text[];
  v_count   integer;
begin
  select count(*) into v_count
  from nexus.access_rules r
  where r.default_code in (select 'D' || lpad(g::text, 2, '0') from generate_series(1, 31) g);
  if v_count <> 31 then
    raise exception 'NEXUS member data: default rules D01-D31 are not seeded (found %); apply 20261105100100 first', v_count
      using hint = 'defaults_not_seeded';
  end if;

  select array_agg(k.key) into v_missing
  from unnest(array['bph', 'kepala_departemen']) as k(key)
  where not exists (select 1 from public.roles ro where ro.key = k.key);
  if v_missing is not null then
    raise exception 'NEXUS member data: PI-CORE role key(s) not found: %', array_to_string(v_missing, ', ')
      using hint = 'Check public.roles.key on this database (expected seed from PI-CORE migration 20261101100100).';
  end if;

  -- An admin may already have added the same rule by hand (custom, no default_code). The unique
  -- content index would then reject the insert; skip it and say so instead of failing the migration.
  if exists (select 1 from nexus.access_rules r
             where r.default_code is null and r.subject_type = 'role' and r.scope = 'all'
               and ((r.role_key = 'kepala_departemen' and r.permission_key = 'member_data.view')
                 or (r.role_key = 'bph' and r.permission_key = 'member_data.view_export_log'))) then
    raise notice 'NEXUS member data: a custom rule with the same content as D32/D33 exists; that default is not added (check it is enabled).';
  end if;

  -- Tell the log trigger this is the seed (action 'seed', actor null), like 20261105100100.
  perform set_config('nexus.rule_action', 'seed', true);
  perform set_config('nexus.change_note', 'Default rules D32-D33, docs/modules/member-data.md (D-019)', true);

  insert into nexus.access_rules (default_code, subject_type, role_key, permission_key, scope, note)
  select v.default_code, 'role', v.role_key, v.permission_key, 'all', v.note
  from (values
    ('D32', 'kepala_departemen', 'member_data.view',
     'Kepala Departemen and Kepala Biro see the member directory to coordinate their units (B9 b, D-019 M2). View only, no export.'),
    ('D33', 'bph', 'member_data.view_export_log',
     'BPH reads the Member Data export log to oversee who exported member data (D-019 M8).')
  ) as v(default_code, role_key, permission_key, note)
  where not exists (select 1 from nexus.access_rules r where r.default_code = v.default_code)
    and not exists (select 1 from nexus.access_rules r
                    where r.subject_type = 'role' and r.role_key = v.role_key
                      and r.permission_key = v.permission_key and r.scope = 'all'
                      and r.position_id is null and r.org_unit_id is null and not r.include_child_units);
  get diagnostics v_count = row_count;

  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);
  raise notice 'NEXUS member data: % default rule(s) added (D32/D33).', v_count;
end
$$;

-- =============================================================================================
-- 3. Export log (spec 4.2, M8). One row per SUCCESSFUL export. Holds ids and settings only: no
--    names, no search text (a typed NIM or phone would become personal data), no exported rows.
--    No foreign keys to PI-CORE (a NEXUS row must never block a PI-CORE change; spec 7.2).
-- =============================================================================================

create table if not exists nexus.member_data_export_logs (
  id                 bigint generated always as identity primary key,
  -- PI-CORE members.id of the exporter, taken from the session inside the export function.
  exporter_member_id uuid not null,
  created_at         timestamptz not null default now(),
  format             text not null check (format in ('xlsx', 'csv', 'pdf')),
  -- PI-CORE org_units.id of the unit filter; null = all units.
  filter_unit_id     uuid,
  filter_status      text not null check (filter_status in ('active', 'inactive', 'all')),
  -- Only whether a search term was used (A-MD11); the text itself is never stored.
  search_used        boolean not null,
  -- Active period at export time (period-based data is tied to a period).
  period_id          uuid not null
);
comment on table nexus.member_data_export_logs is
  'Member Data export log (D-019 M8). Append-only (L5/L11 spirit), no PII. Written only by nexus.member_data_export(); '
  'read only through nexus.member_data_export_log_list() (System Admin or member_data.view_export_log).';

create index if not exists member_data_export_logs_created_idx
  on nexus.member_data_export_logs (created_at desc, id desc);

-- Rows may only come from the export function, which announces itself through a transaction-local
-- setting. Clients have no INSERT privilege at all; this stops ordinary hand inserts (SQL editor,
-- service role) too, so a fake row cannot be slipped in by accident. The owner could still disable
-- the trigger (see supabase/README.md section 6: tamper-evident, not tamper-proof).
create or replace function nexus._member_data_export_log_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('nexus.export_log_writer', true), '') <> 'member_data_export' then
    raise exception 'member_data_export_logs is written only by nexus.member_data_export()'
      using errcode = '42501', hint = 'export_log_direct_insert';
  end if;
  new.created_at := now();  -- server time, never a supplied value
  return new;
end
$$;

create or replace trigger member_data_export_logs_10_insert_guard
  before insert on nexus.member_data_export_logs
  for each row execute function nexus._member_data_export_log_guard();
-- Reuse the engine's append-only guard (L5/L11): no update, delete or truncate, even for the owner
-- while triggers are on.
create or replace trigger member_data_export_logs_no_change
  before update or delete on nexus.member_data_export_logs
  for each row execute function nexus._append_only_guard();
create or replace trigger member_data_export_logs_no_truncate
  before truncate on nexus.member_data_export_logs
  for each statement execute function nexus._append_only_guard();

-- Default deny. Reading goes through a SECURITY DEFINER function (section 4.6), so clients get no
-- table privilege and the table has no policy: with RLS on and no policy, nothing is visible even if
-- a grant is added by mistake later. service_role keeps SELECT only, like every nexus table
-- (ops/backups; it holds no PII).
revoke all on nexus.member_data_export_logs from public, anon, authenticated, service_role;
revoke all on sequence nexus.member_data_export_logs_id_seq from public, anon, authenticated, service_role;
grant select on nexus.member_data_export_logs to service_role;
alter table nexus.member_data_export_logs enable row level security;

-- =============================================================================================
-- 4. Member Data functions (D-010). All SECURITY DEFINER (they read PI-CORE rows a normal member
--    cannot), fixed empty search_path, explicit column whitelist, permission check first.
--    Function bodies deliberately never mention the forbidden PI-CORE column names, so the structural
--    pgTAP test can grep for them.
-- =============================================================================================

-- 4.0 Internal helpers (no EXECUTE for clients).

-- One permission gate for every module function: has_permission() already applies L1 (inactive or
-- unlinked = no member id = nothing), active-period matching (R1) and R15 (export needs view).
create or replace function nexus._require_permission(p_key text)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not nexus.has_permission(p_key) then
    raise exception 'Missing NEXUS permission %', p_key
      using errcode = '42501', hint = 'permission_required', detail = p_key;
  end if;
end
$$;

-- Status filter (M1): active (default), inactive, all. Null or blank = default.
create or replace function nexus._member_data_clean_status(p_status text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_status text := coalesce(nullif(lower(btrim(p_status)), ''), 'active');
begin
  if v_status not in ('active', 'inactive', 'all') then
    raise exception 'Status filter must be active, inactive or all'
      using errcode = '22023', hint = 'invalid_status';
  end if;
  return v_status;
end
$$;

-- Search text (F2): trimmed, runs of whitespace collapsed to one space, blank = no search.
-- Two caps: the RAW input is checked first (480 chars) so a huge pasted blob is refused before any
-- trimming or regex work is spent on it (review L1); the cleaned text is then capped at the PI-CORE
-- name length (120), because no longer text can ever match a name.
create or replace function nexus._member_data_clean_search(p_search text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_search text;
begin
  if char_length(p_search) > 480 then
    raise exception 'Search text is too long (max 120 characters)'
      using errcode = '22023', hint = 'search_too_long';
  end if;
  v_search := nullif(regexp_replace(btrim(coalesce(p_search, '')), '\s+', ' ', 'g'), '');
  if char_length(v_search) > 120 then
    raise exception 'Search text is too long (max 120 characters)'
      using errcode = '22023', hint = 'search_too_long';
  end if;
  return v_search;
end
$$;

-- THE list definition, shared by the list and the export so they can never disagree (R15: export
-- never shows more than the screen). One row per member (R1, MD-15), every member regardless of
-- assignments, filtered by status, name search and unit. `ordinal` is the stable sort position:
-- name A-Z case-insensitive, ties by members.id (R15, MD-27).
--   Primary assignment (M3, A-MD8 decided by the owner 2026-11-06 as option b): among the member's
--   assignments in p_period_id, lowest positions.rank, then the TOP-LEVEL unit order (a division
--   uses its parent department's sort_order, any other unit its own; this is the same order as the
--   unit filter options), then the division's own sort_order (non-divisions first), then unit name
--   A-Z, then position name A-Z, then assignment id (only to stay deterministic). Reason: a
--   division's sort_order only orders it inside its department, so comparing it with another
--   department's division directly would be meaningless (Staff Musik vs Staff Logistik -> Musik,
--   because Pelayanan Khusus comes before Operasional).
--   Unit filter (R6, A-MD9): ANY assignment in p_period_id in the unit or one of its descendants, so a
--   department includes its divisions. An unknown unit id is refused (invalid_unit, review L2).
--   p_period_id = the active period, read ONCE by the caller so the export rows and its log row use
--   the same value. Null = no active period = no assignments, never an error.
-- Comparisons use lower(...) collate "C" so the order is the same on every database, whatever its
-- default collation.
create or replace function nexus._member_data_rows(p_search text, p_unit_id uuid, p_status text, p_period_id uuid)
returns table (
  ordinal          bigint,
  member_id        uuid,
  full_name        text,
  member_type      text,
  is_active        boolean,
  unit_name        text,
  unit_type        text,
  parent_unit_name text,
  position_name    text
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status  text := nexus._member_data_clean_status(p_status);
  v_search  text := nexus._member_data_clean_search(p_search);
  v_pattern text;
begin
  if p_unit_id is not null and not exists (select 1 from public.org_units u where u.id = p_unit_id) then
    raise exception 'Unknown unit filter' using errcode = '22023', hint = 'invalid_unit';
  end if;
  if v_search is not null then
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with
  period_assignments as (
    select a.id, a.member_id, a.org_unit_id,
           u.name as u_name, u.type as u_type, u.parent_id as u_parent,
           case when u.type = 'division' then pu.sort_order else u.sort_order end as top_sort,
           case when u.type = 'division' then u.sort_order end as div_sort,
           po.name as po_name, po.rank as po_rank
    from public.assignments a
    join public.org_units u on u.id = a.org_unit_id
    left join public.org_units pu on pu.id = u.parent_id
    join public.positions po on po.id = a.position_id
    where p_period_id is not null and a.period_id = p_period_id
  ),
  primary_assignment as (
    select distinct on (pa.member_id) pa.*
    from period_assignments pa
    order by pa.member_id, pa.po_rank, pa.top_sort, pa.div_sort nulls first,
             lower(pa.u_name) collate "C", lower(pa.po_name) collate "C", pa.id
  ),
  filter_units as (
    select d.unit_id from nexus._unit_and_descendants(p_unit_id) d where p_unit_id is not null
  ),
  picked as (
    select m.id, m.full_name as m_name, m.member_type as m_type, m.is_active as m_active
    from public.members m
    where (v_status = 'all' or m.is_active = (v_status = 'active'))
      and (v_pattern is null
           or regexp_replace(m.full_name, '\s+', ' ', 'g') ilike v_pattern escape '\')
      and (p_unit_id is null or exists (
             select 1 from period_assignments fa
             where fa.member_id = m.id and fa.org_unit_id in (select fu.unit_id from filter_units fu)))
  )
  select row_number() over (order by lower(pk.m_name) collate "C", pk.id),
         pk.id, pk.m_name, pk.m_type::text, pk.m_active,
         pr.u_name, pr.u_type::text,
         case when pr.u_type = 'division' then parent.name end,
         pr.po_name
  from picked pk
  left join primary_assignment pr on pr.member_id = pk.id
  left join public.org_units parent on parent.id = pr.u_parent
  order by 1;
end
$$;

-- 4.1 List (F1-F4). Needs member_data.view. Paged on the server; a page beyond the last returns the
-- last page (F4) and says which page it returned. Zero rows = no match (total 0).
-- Page size: default 20 (A-MD1), hard maximum 50 (R16: larger values are refused, not clamped).
create or replace function nexus.member_data_list(
  p_search    text    default null,
  p_unit_id   uuid    default null,
  p_status    text    default 'active',
  p_page      integer default 1,
  p_page_size integer default 20
)
returns table (
  row_no           bigint,
  member_id        uuid,
  full_name        text,
  member_type      text,
  is_active        boolean,
  unit_name        text,
  unit_type        text,
  parent_unit_name text,
  position_name    text,
  total_count      bigint,
  page             integer,
  page_size        integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('member_data.view');
  if p_page is null or p_page < 1 then
    raise exception 'Page must be 1 or higher' using errcode = '22023', hint = 'invalid_page';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 50 then
    raise exception 'Page size must be between 1 and 50' using errcode = '22023', hint = 'invalid_page_size';
  end if;

  return query
  with
  r as (select * from nexus._member_data_rows(p_search, p_unit_id, p_status, nexus.active_period_id())),
  t as (select count(*) as n from r),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select r.ordinal, r.member_id, r.full_name, r.member_type, r.is_active,
         r.unit_name, r.unit_type, r.parent_unit_name, r.position_name,
         t.n, pg.pno, p_page_size
  from r cross join t cross join pg
  where r.ordinal > (pg.pno - 1)::bigint * p_page_size
    and r.ordinal <= pg.pno::bigint * p_page_size
  order by r.ordinal;
end
$$;

-- 4.2 Unit filter options (F3, R5, A-MD2, A-MD4): live top-level units (bph, department, bureau),
-- active only, in PI-CORE order. The root and divisions are never offered. Needs member_data.view.
create or replace function nexus.member_data_unit_options()
returns table (id uuid, name text, type text, sort_order integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('member_data.view');
  return query
  select u.id, u.name, u.type::text, u.sort_order
  from public.org_units u
  where u.type in ('bph', 'department', 'bureau') and u.is_active
  order by u.sort_order, lower(u.name) collate "C", u.id;
end
$$;

-- 4.3 Dashboard "Members" count (M5b): every member with is_active = true (students and lecturers,
-- with or without an assignment). Equals the list total under the default filter. Needs view.
create or replace function nexus.member_data_active_count()
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  perform nexus._require_permission('member_data.view');
  select count(*)::integer into v_count from public.members m where m.is_active;
  return v_count;
end
$$;

-- 4.4 Export (F5): the same rows as the list, all pages, same order. Needs member_data.export, which
-- only works together with member_data.view (R15, enforced by the engine). Writes exactly one log row
-- in the SAME transaction after the rows are built; if that insert fails the whole call fails and no
-- rows are returned (A-MD12, MD-35). A refused call writes nothing (MD-02, MD-31).
-- VOLATILE because it writes: PostgREST runs it only via POST (supabase-js .rpc()), never in a
-- read-only GET transaction (where the insert would fail, i.e. fail closed).
create or replace function nexus.member_data_export(
  p_format  text,
  p_search  text default null,
  p_unit_id uuid default null,
  p_status  text default 'active'
)
returns table (
  row_no           bigint,
  member_id        uuid,
  full_name        text,
  member_type      text,
  is_active        boolean,
  unit_name        text,
  unit_type        text,
  parent_unit_name text,
  position_name    text
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_format text := lower(btrim(p_format));
  v_status text;
  v_member uuid;
  v_period uuid;
begin
  perform nexus._require_permission('member_data.export');
  if v_format is null or v_format not in ('xlsx', 'csv', 'pdf') then
    raise exception 'Export format must be xlsx, csv or pdf' using errcode = '22023', hint = 'invalid_format';
  end if;
  v_status := nexus._member_data_clean_status(p_status);
  v_member := nexus.current_member_id();
  -- Read the active period ONCE: the same value drives the rows and the log row (review "minor").
  v_period := nexus.active_period_id();
  -- Unreachable with a valid permission (rules need an active-period assignment), kept as a guard.
  if v_member is null or v_period is null then
    raise exception 'Missing NEXUS permission member_data.export'
      using errcode = '42501', hint = 'permission_required', detail = 'member_data.export';
  end if;

  return query
  select r.ordinal, r.member_id, r.full_name, r.member_type, r.is_active,
         r.unit_name, r.unit_type, r.parent_unit_name, r.position_name
  from nexus._member_data_rows(p_search, p_unit_id, v_status, v_period) r
  order by r.ordinal;

  perform set_config('nexus.export_log_writer', 'member_data_export', true);
  insert into nexus.member_data_export_logs
    (exporter_member_id, format, filter_unit_id, filter_status, search_used, period_id)
  values
    (v_member, v_format, p_unit_id, v_status, nexus._member_data_clean_search(p_search) is not null, v_period);
  perform set_config('nexus.export_log_writer', '', true);
  return;
end
$$;

-- 4.5 Export log read (spec 4.2, MD-34): System Admin as a fixed right (L3, A-MD10) or holders of
-- member_data.view_export_log (default role bph, D33). Newest first, paged (max 50 per page).
-- The exporter's CURRENT name is looked up at read time (the log stores no names); a deactivated
-- exporter keeps their rows and name (R22, MD-36).
create or replace function nexus.member_data_export_log_list(
  p_page      integer default 1,
  p_page_size integer default 50
)
returns table (
  log_id             bigint,
  created_at         timestamptz,
  exporter_member_id uuid,
  exporter_name      text,
  format             text,
  filter_unit_id     uuid,
  filter_unit_name   text,
  filter_status      text,
  search_used        boolean,
  period_id          uuid,
  period_label       text,
  total_count        bigint,
  page               integer,
  page_size          integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_total bigint;
  v_page  integer;
begin
  if not (nexus.is_system_admin() or nexus.has_permission('member_data.view_export_log')) then
    raise exception 'Missing NEXUS permission member_data.view_export_log'
      using errcode = '42501', hint = 'permission_required', detail = 'member_data.view_export_log';
  end if;
  if p_page is null or p_page < 1 then
    raise exception 'Page must be 1 or higher' using errcode = '22023', hint = 'invalid_page';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 50 then
    raise exception 'Page size must be between 1 and 50' using errcode = '22023', hint = 'invalid_page_size';
  end if;

  select count(*) into v_total from nexus.member_data_export_logs;
  v_page := least(p_page, greatest(1, ceil(v_total::numeric / p_page_size)::integer));

  return query
  select l.id, l.created_at, l.exporter_member_id, m.full_name, l.format,
         l.filter_unit_id, u.name, l.filter_status, l.search_used,
         l.period_id, p.label, v_total, v_page, p_page_size
  from nexus.member_data_export_logs l
  left join public.members m on m.id = l.exporter_member_id
  left join public.org_units u on u.id = l.filter_unit_id
  left join public.periods p on p.id = l.period_id
  order by l.created_at desc, l.id desc
  offset (v_page - 1)::bigint * p_page_size
  limit p_page_size;
end
$$;

comment on function nexus.member_data_list(text, uuid, text, integer, integer) is
  'Member Data list (D-010, D-019). Needs member_data.view. Whitelisted columns only; page size max 50.';
comment on function nexus.member_data_unit_options() is
  'Unit filter options: active bph/department/bureau units. Needs member_data.view.';
comment on function nexus.member_data_active_count() is
  'Dashboard Members count: all active members. Needs member_data.view.';
comment on function nexus.member_data_export(text, text, uuid, text) is
  'Member Data export rows (no paging). Needs member_data.export (+ view). Writes one export log row in the same transaction.';
comment on function nexus.member_data_export_log_list(integer, integer) is
  'Member Data export log, newest first. System Admin or member_data.view_export_log.';

-- =============================================================================================
-- 5. Function privileges (README section 7, item 3): the global default still grants EXECUTE to
--    PUBLIC, so revoke explicitly. Client API -> authenticated only. Internals -> owner only.
-- =============================================================================================

revoke all on function
  nexus.member_data_list(text, uuid, text, integer, integer),
  nexus.member_data_unit_options(),
  nexus.member_data_active_count(),
  nexus.member_data_export(text, text, uuid, text),
  nexus.member_data_export_log_list(integer, integer)
from public, anon, service_role;

grant execute on function
  nexus.member_data_list(text, uuid, text, integer, integer),
  nexus.member_data_unit_options(),
  nexus.member_data_active_count(),
  nexus.member_data_export(text, text, uuid, text),
  nexus.member_data_export_log_list(integer, integer)
to authenticated;

revoke all on function
  nexus._require_permission(text),
  nexus._member_data_clean_status(text),
  nexus._member_data_clean_search(text),
  nexus._member_data_rows(text, uuid, text, uuid),
  nexus._member_data_export_log_guard()
from public, anon, authenticated, service_role;

-- Ask PostgREST to pick up the new functions (harmless if `nexus` is not exposed yet).
notify pgrst, 'reload schema';
