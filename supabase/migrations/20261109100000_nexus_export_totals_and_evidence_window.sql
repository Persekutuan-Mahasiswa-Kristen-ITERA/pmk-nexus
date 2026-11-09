-- PMK-NEXUS 0009: export row totals and a rolling window for the evidence upload cap.
-- Two MEDIUM findings of the Inventory and Borrowing security review, fixes approved by the owner on
-- 2026-11-08.
--
-- Base:      20261106200000_nexus_member_data.sql (member_data_export, section 4.4),
--            20261107100100_nexus_inventory_borrowing.sql (borrowing_evidence_can_upload, section 12),
--            20261108100000_nexus_inventory_borrowing_fixes.sql (inventory_export, borrowing_export).
--            Those files are NOT edited. This file only replaces functions: no table, column,
--            constraint, policy, table grant or data change.
-- PI-CORE:   nothing new is read; nothing in public/private changes. The bodies below read PI-CORE only
--            through the existing helpers (_member_data_rows, _ib_queue_rows), exactly as before.
-- Storage:   storage.objects is only READ (as before), and only where Storage is installed.
--
-- What changes:
--   Fix 1  borrowing_evidence_can_upload(p_object_name): the "at most 10 unattached files per request
--          folder" cap now counts only unattached files created in the LAST 24 HOURS
--          (storage.objects.created_at). Before, an abandoned upload (picked, but the return was never
--          saved) counted forever, so after 10 of them nobody could upload evidence for that request
--          again. Everything else is identical: borrowing.handle holder, request status borrowed
--          (Dipinjam), path shape "<request uuid>/<uuid>.<jpg|jpeg|png|webp>", cap value 10.
--          Trade-off (accepted): a handle holder can now leave up to 10 unattached files per request
--          per 24 hours instead of 10 in total; Storage free-tier use stays bounded per day.
--   Fix 2  inventory_export, borrowing_export and member_data_export get ONE extra trailing column
--          total_count bigint = count(*) over () across the full filtered result. PostgREST max_rows
--          (1000, supabase/config.toml) cuts a "returns table" answer silently; the server can now
--          compare the rows it received with total_count instead of guessing from "exactly 1000".
--          The window count runs inside the function, before PostgREST applies its limit, so it is the
--          real total. Same parameters and defaults, same rows, columns, order, permission checks,
--          export-log row in the same transaction (no log row, no data), SECURITY DEFINER with
--          search_path = '' and the same grants. An empty export still returns zero rows (the server
--          treats "no rows" as total 0).
--          SIGNATURE CHANGE (return type only): Postgres cannot change the columns of a function with
--          CREATE OR REPLACE, so these three functions are dropped and created again. DROP uses the
--          default RESTRICT, so it stops if anything depends on them. Checked 2026-11-09 on the local
--          stack (pg_depend) and in every migration: no view, policy, trigger or other function
--          depends on or calls them; only the app calls them through PostgREST .rpc().
--          The grants and the comment of member_data_export are restored below (DROP removes them).
--
-- Re-runnable: drop function if exists + create; create or replace for Fix 1; no data changes.
-- Run as ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261109100000_nexus_export_totals_and_evidence_window.sql
-- Requires 20261105100000 .. 20261108100000 (20261107100200 not required).

-- =============================================================================================
-- 1. Evidence upload cap counts recent unattached files only (Fix 1)
-- =============================================================================================

-- Copied from 20261107100100 section 12; the only change is the created_at window in the count.
create or replace function nexus.borrowing_evidence_can_upload(p_object_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_unattached integer;
begin
  if p_object_name is null
     or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' then
    return false;
  end if;
  if not (nexus.has_permission('borrowing.handle')
          and exists (select 1 from nexus.borrowing_requests r
                      where r.id = split_part(p_object_name, '/', 1)::uuid and r.status = 'borrowed')) then
    return false;
  end if;
  -- Review L6: at most 10 uploads waiting to be attached per request folder, so a holder cannot fill
  -- the free-tier Storage through one open loan. Attached files (evidence) do not count.
  -- Fix 1 (2026-11-09): only files created in the last 24 hours count, so abandoned uploads stop
  -- blocking the folder after a day. A missing created_at counts as recent (fail towards the cap).
  if to_regclass('storage.objects') is not null then
    execute 'select count(*)::int from storage.objects o
             where o.bucket_id = $1 and o.name like $2
               and coalesce(o.created_at, now()) > now() - interval ''24 hours''
               and not exists (select 1 from nexus.borrowing_evidence_photos e where e.storage_path = o.name)'
      into v_unattached using 'nexus-borrowing-evidence', split_part(p_object_name, '/', 1) || '/%';
    if v_unattached >= 10 then
      return false;
    end if;
  end if;
  return true;
end
$$;

-- =============================================================================================
-- 2. Catalog export with total_count (Fix 2)
-- =============================================================================================

drop function if exists nexus.inventory_export(text, text, uuid, uuid, text, text, date, date);

-- Copied from 20261108100000 section 4; only change: trailing column total_count.
create function nexus.inventory_export(
  p_format         text,
  p_search         text default null,
  p_category_id    uuid default null,
  p_location_id    uuid default null,
  p_condition      text default null,
  p_status         text default 'active',
  p_available_from date default null,
  p_available_to   date default null
)
returns table (
  row_no bigint, item_id uuid, code text, item_name text, mode text, category_name text, location_name text,
  unit_condition text, unit_status text, qty_good integer, qty_needs_service integer, qty_damaged integer,
  qty_total integer, item_is_active boolean, free_qty integer,
  total_count bigint
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_format text;
  v_status text;
  v_member uuid;
  v_period uuid;
  v_dates  boolean := p_available_from is not null or p_available_to is not null;
  v_count  integer;
begin
  perform nexus._require_permission('inventory.export');
  v_format := nexus._ib_format(p_format);
  v_status := nexus._ib_item_status(p_status);
  if v_dates then
    perform nexus._ib_check_range(p_available_from, p_available_to);
  end if;
  v_member := nexus.current_member_id();
  v_period := nexus.active_period_id();
  if v_member is null or v_period is null then
    raise exception 'Missing NEXUS permission inventory.export' using errcode = '42501', hint = 'permission_required', detail = 'inventory.export';
  end if;

  return query
  with
  -- Fix 3 (20261108100000): units follow inventory.manage, exactly as in inventory_item_list.
  r as (select * from nexus._ib_item_rows(p_search, p_category_id, p_location_id, p_condition, v_status,
                                          nexus.has_permission('inventory.manage'))),
  f as (select * from nexus._ib_items_free(array(select r.item_id from r), p_available_from, p_available_to, null) where v_dates),
  o as (
    select r.*, case when v_dates then greatest(coalesce(f.free, 0), 0) end as fr,
           row_number() over (order by case when v_dates and coalesce(f.free, 0) <= 0 then 1 else 0 end, r.ordinal) as rn
    from r left join f on f.item_id = r.item_id
  ),
  x as (
    select o.rn, 0 as sub, o.item_id, o.code, o.name, o.mode, o.category_name, o.location_name,
           null::text as uc, null::text as us, o.qty_good, o.qty_needs_service, o.qty_damaged, o.qty_total, o.is_active, o.fr
    from o where o.mode = 'quantity' or jsonb_array_length(coalesce(o.units, '[]'::jsonb)) = 0
    union all
    select o.rn, row_number() over (partition by o.item_id order by u ->> 'code'), o.item_id, u ->> 'code', o.name, o.mode,
           o.category_name, u ->> 'location_name', u ->> 'condition', u ->> 'status',
           null, null, null, null, o.is_active, o.fr
    from o cross join lateral jsonb_array_elements(o.units) u
    where o.mode = 'tracked'
  )
  select row_number() over (order by x.rn, x.sub), x.item_id, x.code, x.name, x.mode, x.category_name, x.location_name,
         x.uc, x.us, x.qty_good, x.qty_needs_service, x.qty_damaged, x.qty_total, x.is_active, x.fr,
         -- Fix 2: every row carries the full total, so the server can detect a PostgREST max_rows cut.
         count(*) over ()
  from x
  order by x.rn, x.sub;
  get diagnostics v_count = row_count;

  perform set_config('nexus.export_log_writer', 'inventory_export', true);
  insert into nexus.inventory_borrowing_export_logs (module, exporter_member_id, format, filters, row_count, period_id)
  values ('inventory', v_member, v_format,
          jsonb_build_object('search_used', nexus._ib_search_pattern(p_search) is not null,
                             'category_id', p_category_id, 'location_id', p_location_id, 'condition', p_condition,
                             'status', v_status, 'available_from', p_available_from, 'available_to', p_available_to),
          v_count, v_period);
  perform set_config('nexus.export_log_writer', '', true);
  return;
end
$$;

-- =============================================================================================
-- 3. Borrowing export with total_count (Fix 2)
-- =============================================================================================

drop function if exists nexus.borrowing_export(text, text, text, date, date, uuid, uuid);

-- Copied from 20261108100000 section 5; only change: trailing column total_count.
create function nexus.borrowing_export(
  p_format    text,
  p_view      text default 'all',
  p_search    text default null,
  p_from      date default null,
  p_to        date default null,
  p_item_id   uuid default null,
  p_period_id uuid default null
)
returns table (
  row_no bigint, reference text, status text, period_label text, requester_name text, is_outside_party boolean,
  outside_org_name text, outside_contact_name text, purpose text, items jsonb, units_handed_over text[],
  start_date date, end_date date, extension_count integer, decided_by_name text, decided_at timestamptz,
  decision_note text, handed_over_at timestamptz, returned_at timestamptz, returned_good integer,
  returned_damaged integer, returned_lost integer, has_issue boolean, is_overdue boolean, overdue_days integer,
  is_not_picked_up boolean, is_partially_returned boolean,
  total_count bigint
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_format text;
  v_member uuid;
  v_period uuid;
  v_count  integer;
begin
  perform nexus._require_permission('borrowing.export');
  v_format := nexus._ib_format(p_format);
  if p_period_id is not null then
    perform nexus._require_permission('borrowing.view_all');
  end if;
  v_member := nexus.current_member_id();
  v_period := nexus.active_period_id();
  if v_member is null or v_period is null then
    raise exception 'Missing NEXUS permission borrowing.export' using errcode = '42501', hint = 'permission_required', detail = 'borrowing.export';
  end if;

  return query
  with
  q as (select * from nexus._ib_queue_rows(p_view, p_search, p_from, p_to, p_item_id, p_period_id)),
  ret as (
    select ls.request_id,
           sum(ls.qty_returned_good)::int as g, sum(ls.qty_returned_damaged)::int as d, sum(ls.qty_returned_lost)::int as x
    from nexus._ib_line_state(null, array(select q.request_id from q)) ls
    group by ls.request_id
  )
  select q.ordinal, q.reference, q.status, q.period_label, q.requester_name, q.is_outside_party, q.outside_org_name,
         q.outside_contact_name, q.purpose, q.items,
         coalesce((select array_agg(u.code order by u.code)
                   from nexus.borrowing_request_lines l
                   join nexus.borrowing_line_units lu on lu.line_id = l.id
                   join nexus.inventory_units u on u.id = lu.unit_id
                   where l.request_id = q.request_id), '{}'),
         q.start_date, q.end_date, q.extension_count, q.decided_by_name, q.decided_at, q.decision_note,
         q.handed_over_at, q.returned_at, coalesce(ret.g, 0), coalesce(ret.d, 0), coalesce(ret.x, 0),
         q.has_issue, q.is_overdue, q.overdue_days, q.is_not_picked_up, q.is_partially_returned,
         -- Fix 2: every row carries the full total, so the server can detect a PostgREST max_rows cut.
         count(*) over ()
  from q left join ret on ret.request_id = q.request_id
  order by q.ordinal;
  get diagnostics v_count = row_count;

  perform set_config('nexus.export_log_writer', 'borrowing_export', true);
  insert into nexus.inventory_borrowing_export_logs (module, exporter_member_id, format, filters, row_count, period_id)
  values ('borrowing', v_member, v_format,
          jsonb_build_object('view', coalesce(nullif(lower(btrim(p_view)), ''), 'pending'),
                             'search_used', nexus._ib_search_pattern(p_search) is not null,
                             'from', p_from, 'to', p_to, 'item_id', p_item_id, 'period_id', p_period_id),
          v_count, v_period);
  perform set_config('nexus.export_log_writer', '', true);
  return;
end
$$;

-- =============================================================================================
-- 4. Member Data export with total_count (Fix 2)
-- =============================================================================================

drop function if exists nexus.member_data_export(text, text, uuid, text);

-- Copied from 20261106200000 section 4.4; only change: trailing column total_count. Still the same
-- rows as the list, all pages, same order; needs member_data.export (which only works together with
-- member_data.view, R15); one log row in the SAME transaction after the rows are built, so a failing
-- log insert fails the whole call and returns no rows (A-MD12, MD-35). VOLATILE because it writes.
create function nexus.member_data_export(
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
  position_name    text,
  total_count      bigint
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
         r.unit_name, r.unit_type, r.parent_unit_name, r.position_name,
         -- Fix 2: every row carries the full total, so the server can detect a PostgREST max_rows cut.
         count(*) over ()
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

comment on function nexus.member_data_export(text, text, uuid, text) is
  'Member Data export rows (no paging) plus total_count. Needs member_data.export (+ view). Writes one export log row in the same transaction.';
-- inventory_export and borrowing_export had no comment before; none is added (unchanged metadata).

-- =============================================================================================
-- 5. Function privileges, exactly as before: a new function starts with EXECUTE for PUBLIC, so revoke
--    it; client API to authenticated only (not anon, not service_role).
-- =============================================================================================

revoke all on function
  nexus.inventory_export(text, text, uuid, uuid, text, text, date, date),
  nexus.borrowing_export(text, text, text, date, date, uuid, uuid),
  nexus.member_data_export(text, text, uuid, text),
  nexus.borrowing_evidence_can_upload(text)
from public, anon, service_role;

grant execute on function
  nexus.inventory_export(text, text, uuid, uuid, text, text, date, date),
  nexus.borrowing_export(text, text, text, date, date, uuid, uuid),
  nexus.member_data_export(text, text, uuid, text),
  nexus.borrowing_evidence_can_upload(text)
to authenticated;

-- Ask PostgREST to pick up the changed return types.
notify pgrst, 'reload schema';
