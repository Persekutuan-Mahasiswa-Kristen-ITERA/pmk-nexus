-- PMK-NEXUS 0007: Inventory and Borrowing fixes, approved by the owner on 2026-11-08.
--
-- Spec:      docs/modules/inventory-borrowing.md F12 step 2 (export = same rows, same order as the
--            screen), section 8 (borrowing export respects status, dates, item, PERIOD), section 11c
--            (a return is corrected at most once); docs/design/inventory-borrowing.md (detail address
--            /inventaris/pengajuan/{ref}; managers see archived units "Nonaktif" and lost units "Hilang").
-- Base:      20261107100100_nexus_inventory_borrowing.sql. That file is NOT edited; this file only
--            replaces or adds functions. No table, column, constraint, policy or table grant changes.
-- PI-CORE:   reads public.periods(id) to validate the new period filter (verified against pi-core-v2
--            20261031165546_core_schema.sql: periods.id uuid primary key). Nothing in PI-CORE changes.
--
-- What changes:
--   Fix 1  NEW nexus.borrowing_request_detail_by_ref(p_reference text) -> jsonb. Exactly the JSON of
--          borrowing_request_detail, found by the reference "PJM-0001". Same visibility (own request or
--          borrowing.view_all). "No such reference" and "not yours" go through the SAME raise inside
--          borrowing_request_detail, so a caller cannot probe which references exist. A malformed
--          reference is refused with invalid_input (says nothing about existence).
--   Fix 2  borrowing_request_detail: actions.can_correct_return is false once the request was corrected
--          (section 11c). borrowing_request_correct_return: the "already corrected once" refusal now has
--          its own hint already_corrected; correction_conflict now means only "the stock or condition
--          changed since the return" (raise sites kept: unit changed, counted lost after later stock
--          history, damaged stock moved, good stock would exceed 9999). borrowing_request_return: its
--          "stock does not match the loan" guard raised correction_conflict although it is no
--          correction; it now raises stock_mismatch. One shared helper _ib_was_corrected() decides the
--          once-only rule for both the button and the action, so they cannot disagree.
--   Fix 3  inventory_export: a holder of inventory.manage now gets the same units as inventory_item_list
--          (archived and lost units of the listed items, also under the default filter). Members without
--          inventory.manage still never get archived or lost entries. Signature unchanged; the status is
--          in unit_status (active / archived / lost = Hilang) and item_is_active (false = Nonaktif).
--   Fix 4  Optional period filter p_period_id uuid (null = exactly the old behaviour) on borrowing_queue,
--          borrowing_export and their shared internal _ib_queue_rows. Only borrowing.view_all holders may
--          use it; an unknown period id is refused (invalid_period). The export log records it as
--          filters.period_id. NEW borrowing_period_list() gives the period choices (view_all only,
--          newest first). borrowing_queue_counts is NOT changed: it never applied the list filters
--          (search, dates, item); its numbers label the "Tampilkan" options, while the filtered list
--          carries its own total_count.
--          SIGNATURE CHANGE: the old overloads borrowing_queue(text,text,date,date,uuid,integer,integer),
--          borrowing_export(text,text,text,date,date,uuid) and _ib_queue_rows(text,text,date,date,uuid)
--          are DROPPED below. Reason: an old overload next to a new one with an extra defaulted argument
--          makes every existing call ambiguous ("function is not unique"). Calls with named arguments
--          (PostgREST .rpc) or the old positional arguments keep working against the new versions.
--
-- New hints: already_corrected, stock_mismatch (P0001); invalid_period (22023). Existing hints reused:
-- request_not_found (P0002), invalid_input (22023, detail p_reference), permission_required (42501).
--
-- Re-runnable: drop function if exists (old signatures only) + create or replace; no data changes.
-- Run as ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261108100000_nexus_inventory_borrowing_fixes.sql
-- Requires 20261105100000 .. 20261107100200.

-- =============================================================================================
-- 1. Shared helper: was this request's return already corrected once? (Fix 2)
-- =============================================================================================

-- One definition for the detail button and the action, so the button never offers what the action
-- refuses (section 11c: one correction per request).
create or replace function nexus._ib_was_corrected(p_request_id uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (select 1 from nexus.borrowing_return_reversals rv
                 join nexus.borrowing_return_batches b on b.id = rv.batch_id
                 where b.request_id = p_request_id)
$$;

-- =============================================================================================
-- 2. Request detail (Fix 2a) and detail by reference (Fix 1)
-- =============================================================================================

-- Copied from 20261107100100 section 9.5; only change: can_correct_return also needs "not corrected
-- yet" (section 11c).
create or replace function nexus.borrowing_request_detail(p_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me        uuid := nexus._ib_require_member();
  v_view_all  boolean := nexus.has_permission('borrowing.view_all');
  v_approve   boolean := nexus.has_permission('borrowing.approve');
  v_handle    boolean := nexus.has_permission('borrowing.handle');
  v_period    uuid := nexus.active_period_id();
  v_today     date := nexus._ib_today();
  v_row       record;
  v_req       nexus.borrowing_requests;
  v_is_open   boolean;
  v_own       boolean;
  v_free      jsonb;
  v_lines     jsonb;
  v_timeline  jsonb;
  v_approvers integer;
begin
  select * into v_req from nexus.borrowing_requests r where r.id = p_request_id;
  if not found or not (v_req.requester_member_id = v_me or v_view_all) then
    raise exception 'Request not found' using errcode = 'P0002', hint = 'request_not_found';
  end if;
  select * into v_row from nexus._ib_request_rows(null, null, null, p_request_id) x;
  v_is_open := v_req.status in ('submitted', 'approved', 'borrowed');
  v_own := v_req.requester_member_id = v_me;

  -- "Tersedia sekarang" per line for the head's review: free over the request's remaining range,
  -- not counting this request (pending requests hold nothing anyway). Counts only.
  if v_view_all and v_is_open and v_req.end_date >= v_today then
    select coalesce(jsonb_object_agg(f.item_id::text, jsonb_build_object('lendable', f.lendable, 'free', greatest(f.free, 0))), '{}'::jsonb)
    into v_free
    from nexus._ib_items_free(array(select l.item_id from nexus.borrowing_request_lines l where l.request_id = p_request_id),
                              greatest(v_req.start_date, v_today), v_req.end_date, p_request_id) f;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', ls.line_id, 'item_id', i.id, 'item_name', i.name, 'item_code', i.code, 'mode', i.mode,
           'item_is_active', i.is_active,
           'quantity_requested', ls.qty_requested, 'quantity_approved', ls.qty_approved,
           'quantity_handed_over', ls.qty_handed, 'returned_good', ls.qty_returned_good,
           'returned_damaged', ls.qty_returned_damaged, 'returned_lost', ls.qty_returned_lost,
           'outstanding', ls.qty_outstanding, 'handover_note', l.handover_note,
           'available', v_free -> (i.id::text),
           'units', coalesce((select jsonb_agg(jsonb_build_object('unit_id', u.id, 'code', u.code,
                                                                  'is_out', lu.return_id is null) order by u.code)
                              from nexus.borrowing_line_units lu
                              join nexus.inventory_units u on u.id = lu.unit_id
                              where lu.line_id = l.id), '[]'::jsonb),
           'returns', coalesce((select jsonb_agg(jsonb_build_object(
                                  'return_id', lr.id, 'batch_id', lr.batch_id, 'outcome', lr.outcome,
                                  'quantity', lr.quantity, 'unit_id', lr.unit_id, 'unit_code', ru.code,
                                  'resulting_condition', lr.resulting_condition, 'note', lr.note,
                                  'recorded_at', b.recorded_at, 'recorded_by_name', nexus._ib_member_name(b.recorded_by),
                                  'is_reversed', exists (select 1 from nexus.borrowing_return_reversals rv where rv.batch_id = b.id),
                                  'photos', coalesce((select jsonb_agg(jsonb_build_object(
                                                         'photo_id', e.id, 'storage_path', e.storage_path,
                                                         'mime_type', e.mime_type, 'size_bytes', e.size_bytes) order by e.id)
                                                      from nexus.borrowing_evidence_photos e
                                                      where e.line_return_id = lr.id), '[]'::jsonb))
                                  order by lr.id)
                                from nexus.borrowing_line_returns lr
                                join nexus.borrowing_return_batches b on b.id = lr.batch_id
                                left join nexus.inventory_units ru on ru.id = lr.unit_id
                                where lr.line_id = l.id), '[]'::jsonb))
           order by lower(i.name) collate "C", i.id), '[]'::jsonb)
  into v_lines
  from nexus._ib_line_state(null, array[p_request_id]) ls
  join nexus.borrowing_request_lines l on l.id = ls.line_id
  join nexus.inventory_items i on i.id = ls.item_id;

  -- Timeline, oldest first: status events + extensions (old and new end date).
  select coalesce(jsonb_agg(t.ev order by t.at, t.k, t.id), '[]'::jsonb)
  into v_timeline
  from (
    select h.occurred_at as at, 0 as k, h.id,
           jsonb_build_object('at', h.occurred_at, 'event', h.event, 'from_status', h.from_status,
                              'to_status', h.to_status, 'actor_name', nexus._ib_member_name(h.actor_member_id),
                              'note', h.note) as ev
    from nexus.borrowing_status_history h where h.request_id = p_request_id
    union all
    select e.occurred_at, 1, e.id,
           jsonb_build_object('at', e.occurred_at, 'event', 'extended', 'old_end_date', e.old_end_date,
                              'new_end_date', e.new_end_date, 'actor_name', nexus._ib_member_name(e.actor_member_id),
                              'note', e.note)
    from nexus.borrowing_extensions e where e.request_id = p_request_id
  ) t;

  -- B29 hint: how many OTHER members hold borrowing.approve right now (count only, never names).
  if v_req.status = 'submitted' and (v_approve or v_own) then
    select count(distinct x.member_id)::int into v_approvers
    from nexus._rule_matches(null, true, false) x
    where x.permission_key = 'borrowing.approve' and x.member_id <> v_req.requester_member_id;
  end if;

  return jsonb_build_object(
    'request_id', v_req.id, 'reference', v_req.reference, 'status', v_req.status, 'version', v_req.version,
    'period_id', v_req.period_id, 'period_label', v_row.period_label,
    'requester_member_id', v_req.requester_member_id, 'requester_name', v_row.requester_name, 'is_own', v_own,
    'is_outside_party', v_req.is_outside_party, 'outside_org_name', v_req.outside_org_name,
    'outside_contact_name', v_req.outside_contact_name,
    'purpose', v_req.purpose, 'note', v_req.note, 'start_date', v_req.start_date, 'end_date', v_req.end_date,
    'created_at', v_req.created_at,
    'decided_at', v_req.decided_at, 'decided_by_name', v_row.decided_by_name, 'decision_note', v_req.decision_note,
    'handed_over_at', v_req.handed_over_at, 'handed_over_by_name', v_row.handed_over_by_name,
    'returned_at', v_req.returned_at, 'has_issue', v_req.has_issue,
    'qty_outstanding', v_row.qty_outstanding, 'is_overdue', v_row.is_overdue, 'overdue_days', v_row.overdue_days,
    'is_not_picked_up', v_row.is_not_picked_up, 'is_partially_returned', v_row.is_partially_returned,
    'extension_count', v_row.extension_count,
    'pending_overlap_count', case when v_view_all then nexus._ib_pending_overlap(p_request_id) end,
    'other_approver_count', v_approvers,
    'lines', v_lines,
    'timeline', v_timeline,
    'actions', jsonb_build_object(
      'can_approve', v_period is not null and v_approve and not v_own and v_req.status = 'submitted',
      'can_reject', v_period is not null and v_approve and not v_own and v_req.status = 'submitted',
      'can_extend', v_period is not null and v_approve and not v_own and v_req.status in ('approved', 'borrowed'),
      'can_hand_over', v_period is not null and v_handle and v_req.status = 'approved' and v_today >= v_req.start_date,
      'can_return', v_period is not null and v_handle and v_req.status = 'borrowed' and v_row.qty_outstanding > 0,
      'can_cancel', v_period is not null and ((v_own and v_req.status in ('submitted', 'approved'))
                                              or (v_handle and v_req.status = 'approved')),
      'cancel_reason_required', v_req.status = 'approved' or not v_own,
      'can_correct_return', v_period is not null and v_handle and v_req.status = 'returned'
                            and v_req.period_id = v_period
                            and not nexus._ib_was_corrected(v_req.id)));  -- Fix 2a (section 11c)
end
$$;

-- Fix 1: "Detail Pengajuan" addressed by its reference (/inventaris/pengajuan/PJM-0001). The reference
-- is trimmed and upper-cased (a typed "pjm-0001" works) and must look like PJM- plus 4 to 16 digits;
-- anything else is invalid_input, which says nothing about existence. The lookup itself never raises:
-- an unknown reference passes a null id to borrowing_request_detail, which answers request_not_found
-- with the SAME code, message and hint as for a request the caller may not see (R8). L1 first, like
-- borrowing_request_detail (inactive / unlinked callers get not_active_member before any lookup).
create or replace function nexus.borrowing_request_detail_by_ref(p_reference text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ref text;
  v_id  uuid;
begin
  perform nexus._ib_require_member();
  -- Length check first so a huge input is refused before any regex work.
  if p_reference is null or char_length(p_reference) > 40 then
    raise exception 'Reference must look like PJM-0001' using errcode = '22023', hint = 'invalid_input', detail = 'p_reference';
  end if;
  v_ref := upper(btrim(p_reference));
  if v_ref !~ '^PJM-[0-9]{4,16}$' then
    raise exception 'Reference must look like PJM-0001' using errcode = '22023', hint = 'invalid_input', detail = 'p_reference';
  end if;
  -- Read as the function owner (no RLS): visibility is decided in ONE place, borrowing_request_detail.
  select r.id into v_id from nexus.borrowing_requests r where r.reference = v_ref;
  return nexus.borrowing_request_detail(v_id);
end
$$;
comment on function nexus.borrowing_request_detail_by_ref(text) is
  'Detail Pengajuan by reference (PJM-0001). Same JSON and visibility as borrowing_request_detail; unknown and not-visible references both answer request_not_found.';

-- =============================================================================================
-- 3. Return and correction hints (Fix 2b)
-- =============================================================================================

-- Copied from 20261107100100 section 10.7; only change: the "stock does not match the loan" guard
-- raises stock_mismatch (it is not a correction, so correction_conflict was misleading there).
create or replace function nexus.borrowing_request_return(p_request_id uuid, p_version integer, p_outcomes jsonb)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req       nexus.borrowing_requests;
  v_member    uuid := nexus.current_member_id();
  v_batch     bigint;
  v_out       jsonb;
  v_used      jsonb := '{}'::jsonb;
  v_units     uuid[] := '{}';
  v_paths     text[] := '{}';
  v_e         jsonb;
  v_lid       uuid;
  v_l         record;
  v_outcome   text;
  v_unit      uuid;
  v_unit_row  nexus.inventory_units;
  v_qty       integer;
  v_cond      text;
  v_note      text;
  v_photos    jsonb;
  v_path      text;
  v_photo     record;
  v_ret_id    bigint;
  v_issue     boolean := false;
  v_left      integer;
  v_check     integer;
begin
  perform nexus._require_permission('borrowing.handle');
  perform nexus._ib_require_active_period();
  v_req := nexus._ib_lock_request(p_request_id, p_version);
  perform nexus._ib_require_status(v_req.status, array['borrowed']);
  if p_outcomes is null or jsonb_typeof(p_outcomes) <> 'array' or jsonb_array_length(p_outcomes) not between 1 and 200 then
    raise exception 'Give 1 to 200 return outcomes' using errcode = '22023', hint = 'invalid_input', detail = 'p_outcomes';
  end if;
  perform nexus._ib_lock_items(array(select l.item_id from nexus.borrowing_request_lines l where l.request_id = p_request_id));
  -- Outstanding per line BEFORE this batch.
  select coalesce(jsonb_object_agg(ls.line_id::text, ls.qty_outstanding), '{}'::jsonb) into v_out
  from nexus._ib_line_state(null, array[p_request_id]) ls;

  insert into nexus.borrowing_return_batches (request_id, recorded_by, period_id)
  values (p_request_id, v_member, nexus.active_period_id())
  returning id into v_batch;

  for v_e in select e from jsonb_array_elements(p_outcomes) e loop
    if jsonb_typeof(v_e) <> 'object' then
      raise exception 'Each outcome must be an object' using errcode = '22023', hint = 'invalid_input', detail = 'p_outcomes';
    end if;
    v_lid := nexus._ib_json_uuid(v_e, 'line_id', true);
    select l.id, l.item_id, i.mode into v_l
    from nexus.borrowing_request_lines l join nexus.inventory_items i on i.id = l.item_id
    where l.id = v_lid and l.request_id = p_request_id;
    if not found then
      raise exception 'Line not found' using errcode = 'P0002', hint = 'line_not_found', detail = v_lid::text;
    end if;
    v_outcome := v_e ->> 'outcome';
    if v_outcome is null or v_outcome not in ('good', 'damaged', 'lost') then
      raise exception 'Outcome must be good, damaged or lost' using errcode = '22023', hint = 'invalid_input', detail = 'outcome';
    end if;

    -- What came back: a counted quantity, or one specific unit that is out on THIS line.
    if v_l.mode = 'quantity' then
      if v_e ? 'unit_id' then
        raise exception 'A quantity item has no units' using errcode = '22023', hint = 'invalid_input', detail = v_lid::text;
      end if;
      v_qty := nexus._ib_json_int(v_e, 'quantity', 1, 9999);
      v_unit := null;
    else
      v_unit := nexus._ib_json_uuid(v_e, 'unit_id', true);
      if v_e ? 'quantity' and nexus._ib_json_int(v_e, 'quantity', 1, 1) <> 1 then
        raise exception 'One unit per outcome' using errcode = '22023', hint = 'quantity_invalid', detail = v_lid::text;
      end if;
      if v_unit = any (v_units)
         or not exists (select 1 from nexus.borrowing_line_units lu
                        where lu.line_id = v_lid and lu.unit_id = v_unit and lu.return_id is null) then
        raise exception 'This unit is not out on this line' using errcode = 'P0001', hint = 'unit_not_available', detail = v_unit::text;
      end if;
      v_units := v_units || v_unit;
      v_qty := 1;
    end if;
    v_used := v_used || jsonb_build_object(v_lid::text, coalesce((v_used ->> v_lid::text)::int, 0) + v_qty);
    if (v_used ->> v_lid::text)::int > coalesce((v_out ->> v_lid::text)::int, 0) then
      raise exception 'More than is still out (%)', coalesce((v_out ->> v_lid::text)::int, 0)
        using errcode = '22023', hint = 'quantity_invalid', detail = v_lid::text;
    end if;

    -- Damaged and lost need a note AND 1..3 photos (IB8); good needs neither and takes no photo.
    v_photos := coalesce(v_e -> 'photos', '[]'::jsonb);
    if jsonb_typeof(v_photos) <> 'array' then
      raise exception 'photos must be a list' using errcode = '22023', hint = 'invalid_photo', detail = v_lid::text;
    end if;
    if v_outcome = 'good' then
      v_note := nexus._ib_text(v_e ->> 'note', 500, 'note');
      if v_e ? 'resulting_condition' then
        raise exception 'A good return has no resulting condition' using errcode = '22023', hint = 'invalid_condition';
      end if;
      if jsonb_array_length(v_photos) > 0 then
        raise exception 'Photos are only for damaged or lost items' using errcode = '22023', hint = 'photo_count', detail = v_lid::text;
      end if;
      v_cond := null;
    else
      v_note := nexus._ib_required_text(v_e ->> 'note', 500, 'note', 'note_required');
      if jsonb_array_length(v_photos) not between 1 and 3 then
        raise exception 'Add 1 to 3 photos' using errcode = '22023', hint = 'photo_count', detail = v_lid::text;
      end if;
      if v_outcome = 'damaged' then
        v_cond := v_e ->> 'resulting_condition';
        if v_cond is null or v_cond not in ('needs_service', 'damaged') then
          raise exception 'Choose the condition now: needs_service or damaged' using errcode = '22023', hint = 'invalid_condition';
        end if;
      else
        if v_e ? 'resulting_condition' then
          raise exception 'A lost item has no condition' using errcode = '22023', hint = 'invalid_condition';
        end if;
        v_cond := null;
      end if;
      v_issue := true;
    end if;

    insert into nexus.borrowing_line_returns (batch_id, line_id, unit_id, outcome, quantity, resulting_condition, note)
    values (v_batch, v_lid, v_unit, v_outcome, v_qty, v_cond, v_note)
    returning id into v_ret_id;

    for v_path in select x from jsonb_array_elements_text(v_photos) x loop
      if v_path = any (v_paths) then
        raise exception 'The same photo is listed twice' using errcode = '22023', hint = 'invalid_photo', detail = v_path;
      end if;
      v_paths := v_paths || v_path;
      select * into v_photo from nexus._ib_check_photo(p_request_id, v_path);
      insert into nexus.borrowing_evidence_photos (line_return_id, storage_path, size_bytes, mime_type, attached_by)
      values (v_ret_id, v_path, v_photo.size_bytes, v_photo.mime_type, v_member);
    end loop;

    -- Stock effects.
    if v_unit is not null then
      update nexus.borrowing_line_units set return_id = v_ret_id where line_id = v_lid and unit_id = v_unit and return_id is null;
      select * into v_unit_row from nexus.inventory_units u where u.id = v_unit for update;
      if v_outcome = 'damaged' then
        update nexus.inventory_units set condition = v_cond, updated_at = now(), updated_by = v_member where id = v_unit;
        perform nexus._ib_item_log(v_l.item_id, v_unit, 'condition_changed', v_unit_row.condition, v_cond, 1, v_note,
                                   p_request_id, jsonb_build_object('return_id', v_ret_id));
      elsif v_outcome = 'lost' then
        update nexus.inventory_units set status = 'lost', updated_at = now(), updated_by = v_member where id = v_unit;
        perform nexus._ib_item_log(v_l.item_id, v_unit, 'written_off', v_unit_row.condition, null, 1, v_note,
                                   p_request_id, jsonb_build_object('return_id', v_ret_id));
      end if;
    elsif v_outcome in ('damaged', 'lost') then
      -- The quantity on loan was counted in good; it leaves good now.
      update nexus.inventory_stock set quantity = quantity - v_qty, updated_at = now(), updated_by = v_member
      where item_id = v_l.item_id and condition = 'good' and quantity >= v_qty
      returning quantity into v_check;
      if v_check is null then
        -- Fix 2b: not a correction, so its own hint.
        raise exception 'Stock does not match the loan; check the item history' using errcode = 'P0001', hint = 'stock_mismatch';
      end if;
      if v_outcome = 'damaged' then
        update nexus.inventory_stock set quantity = least(quantity + v_qty, 9999), updated_at = now(), updated_by = v_member
        where item_id = v_l.item_id and condition = v_cond;
        perform nexus._ib_item_log(v_l.item_id, null, 'condition_changed', 'good', v_cond, v_qty, v_note,
                                   p_request_id, jsonb_build_object('return_id', v_ret_id));
      else
        perform nexus._ib_item_log(v_l.item_id, null, 'written_off', 'good', null, v_qty, v_note,
                                   p_request_id, jsonb_build_object('return_id', v_ret_id));
      end if;
    end if;
  end loop;

  select coalesce(sum(ls.qty_outstanding), 0) into v_left from nexus._ib_line_state(null, array[p_request_id]) ls;
  if v_left = 0 then
    update nexus.borrowing_requests set status = 'returned', returned_at = now(), has_issue = has_issue or v_issue
    where id = p_request_id;
    perform nexus._ib_status_log(p_request_id, 'returned', 'borrowed', 'returned', null);
  else
    -- Same status; the update still bumps the version so a second identical click fails (IB-48).
    update nexus.borrowing_requests set has_issue = has_issue or v_issue where id = p_request_id;
    perform nexus._ib_status_log(p_request_id, 'returned_partial', 'borrowed', 'borrowed', null);
  end if;
  return query select r.id, r.status, r.version from nexus.borrowing_requests r where r.id = p_request_id;
end
$$;

-- Copied from 20261107100100 section 10.8; only change: a second correction answers already_corrected
-- (through _ib_was_corrected). Every other correction_conflict stays: it now means only "the stock or
-- the unit changed since the return; correct it by hand".
create or replace function nexus.borrowing_request_correct_return(p_request_id uuid, p_version integer, p_reason text)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req    nexus.borrowing_requests;
  v_member uuid := nexus.current_member_id();
  v_period uuid;
  v_reason text;
  v_batch  bigint;
  v_r      record;
  v_unit   nexus.inventory_units;
  v_check  integer;
  v_l      record;
  v_free   record;
  v_today  date := nexus._ib_today();
begin
  perform nexus._require_permission('borrowing.handle');
  v_period := nexus._ib_require_active_period();
  v_req := nexus._ib_lock_request(p_request_id, p_version);
  perform nexus._ib_require_status(v_req.status, array['returned']);
  if v_req.period_id is distinct from v_period then
    raise exception 'Closed requests of a previous period are read-only (L7)' using errcode = '42501', hint = 'closed_period';
  end if;
  v_reason := nexus._ib_required_text(p_reason, 500, 'reason', 'reason_required');
  -- Review L1: exactly ONE correction per request; anything after that is fixed by hand with notes.
  -- Fix 2b: own hint, same helper as the detail button.
  if nexus._ib_was_corrected(p_request_id) then
    raise exception 'This request was already corrected once' using errcode = 'P0001', hint = 'already_corrected';
  end if;
  select max(b.id) into v_batch
  from nexus.borrowing_return_batches b
  where b.request_id = p_request_id
    and not exists (select 1 from nexus.borrowing_return_reversals rv where rv.batch_id = b.id);
  if v_batch is null then
    raise exception 'Nothing to correct' using errcode = 'P0001', hint = 'state_changed';
  end if;
  perform nexus._ib_lock_items(array(select l.item_id from nexus.borrowing_request_lines l where l.request_id = p_request_id));

  for v_r in select lr.*, l.item_id from nexus.borrowing_line_returns lr
             join nexus.borrowing_request_lines l on l.id = lr.line_id
             where lr.batch_id = v_batch order by lr.id loop
    if v_r.unit_id is not null then
      select * into v_unit from nexus.inventory_units u where u.id = v_r.unit_id for update;
      -- The unit must still be exactly as this return left it, and not out on another loan.
      if nexus._ib_unit_on_loan(v_r.unit_id)
         or (v_r.outcome = 'good' and not (v_unit.status = 'active' and v_unit.condition = 'good'))
         or (v_r.outcome = 'damaged' and not (v_unit.status = 'active' and v_unit.condition = v_r.resulting_condition))
         or (v_r.outcome = 'lost' and v_unit.status <> 'lost') then
        raise exception 'Unit % changed after the return; correct it by hand', v_unit.code
          using errcode = 'P0001', hint = 'correction_conflict', detail = v_unit.code;
      end if;
      update nexus.borrowing_line_units set return_id = null where return_id = v_r.id;
      if v_r.outcome = 'damaged' then
        update nexus.inventory_units set condition = 'good', updated_at = now(), updated_by = v_member where id = v_r.unit_id;
        perform nexus._ib_item_log(v_r.item_id, v_r.unit_id, 'condition_changed', v_r.resulting_condition, 'good', 1,
                                   v_reason, p_request_id, jsonb_build_object('reversed_return_id', v_r.id));
      elsif v_r.outcome = 'lost' then
        update nexus.inventory_units set status = 'active', condition = 'good', updated_at = now(), updated_by = v_member
        where id = v_r.unit_id;
        perform nexus._ib_item_log(v_r.item_id, v_r.unit_id, 'restored', null, 'good', 1,
                                   v_reason, p_request_id, jsonb_build_object('reversed_return_id', v_r.id));
      end if;
    elsif v_r.outcome in ('damaged', 'lost') then
      -- Review L2: a counted "lost" can only be undone while nobody touched that item's stock since this
      -- return (otherwise the +n could double-count a replacement already added by hand).
      if v_r.outcome = 'lost' and exists (
           select 1 from nexus.inventory_item_history h
           where h.item_id = v_r.item_id
             and h.kind in ('stock_added', 'written_off', 'condition_changed', 'restored')
             and h.id > (select max(h2.id) from nexus.inventory_item_history h2
                         where h2.request_id = p_request_id
                           and (h2.details ->> 'return_id')::bigint in (select lr.id from nexus.borrowing_line_returns lr
                                                                        where lr.batch_id = v_batch))) then
        raise exception 'The stock of this item changed after the return; correct it by hand' using errcode = 'P0001',
          hint = 'correction_conflict';
      end if;
      if v_r.outcome = 'damaged' then
        update nexus.inventory_stock set quantity = quantity - v_r.quantity, updated_at = now(), updated_by = v_member
        where item_id = v_r.item_id and condition = v_r.resulting_condition and quantity >= v_r.quantity
        returning quantity into v_check;
        if v_check is null then
          raise exception 'Stock changed after the return; correct it by hand' using errcode = 'P0001', hint = 'correction_conflict';
        end if;
      end if;
      update nexus.inventory_stock set quantity = quantity + v_r.quantity, updated_at = now(), updated_by = v_member
      where item_id = v_r.item_id and condition = 'good' and quantity + v_r.quantity <= 9999
      returning quantity into v_check;
      if v_check is null then
        raise exception 'Stock would exceed 9999' using errcode = 'P0001', hint = 'correction_conflict';
      end if;
      perform nexus._ib_item_log(v_r.item_id, null,
                                 case when v_r.outcome = 'damaged' then 'condition_changed' else 'restored' end,
                                 v_r.resulting_condition, 'good', v_r.quantity, v_reason, p_request_id,
                                 jsonb_build_object('reversed_return_id', v_r.id));
    end if;
  end loop;

  insert into nexus.borrowing_return_reversals (batch_id, reversed_by, reason, period_id)
  values (v_batch, v_member, v_reason, v_period);
  update nexus.borrowing_requests r
  set status = 'borrowed', returned_at = null,
      has_issue = exists (select 1 from nexus.borrowing_line_returns lr
                          join nexus.borrowing_request_lines l on l.id = lr.line_id
                          where l.request_id = r.id and lr.outcome <> 'good'
                            and not exists (select 1 from nexus.borrowing_return_reversals rv where rv.batch_id = lr.batch_id))
  where r.id = p_request_id;

  -- R5: what is out again must still fit next to the other approved and borrowed requests.
  for v_l in select ls.* from nexus._ib_line_state(null, array[p_request_id]) ls where ls.held_qty > 0 order by ls.item_id loop
    select * into v_free from nexus._ib_items_free(array[v_l.item_id], greatest(v_l.start_date, v_today), v_l.hold_until, p_request_id);
    if v_free.free < v_l.held_qty then
      raise exception 'Reopening this loan would over-book the item' using errcode = 'P0001', hint = 'insufficient_stock',
        detail = v_l.item_id::text;
    end if;
  end loop;

  perform nexus._ib_status_log(p_request_id, 'return_corrected', 'returned', 'borrowed', v_reason);
  return query select r.id, r.status, r.version from nexus.borrowing_requests r where r.id = p_request_id;
end
$$;

-- =============================================================================================
-- 4. Catalog export = catalog list (Fix 3)
-- =============================================================================================

-- Copied from 20261107100100 section 11.1; only change: the unit list follows inventory.manage exactly
-- like inventory_item_list (it used to follow the status filter, so managers lost archived and lost
-- units under the default filter). Non-managers: _ib_item_status refuses archived/all, and
-- has_permission('inventory.manage') is false, so they still get active units of active items only.
create or replace function nexus.inventory_export(
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
  qty_total integer, item_is_active boolean, free_qty integer
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
  -- Fix 3: units follow inventory.manage, exactly as in inventory_item_list.
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
         x.uc, x.us, x.qty_good, x.qty_needs_service, x.qty_damaged, x.qty_total, x.is_active, x.fr
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
-- 5. Borrowing period filter (Fix 4)
-- =============================================================================================

-- Old overloads go first (see the header: they would make every call ambiguous). No view, policy or
-- other object depends on them; borrowing_open_loans calls _ib_queue_rows with 5 arguments, which the
-- new version accepts through the default.
drop function if exists nexus._ib_queue_rows(text, text, date, date, uuid);
drop function if exists nexus.borrowing_queue(text, text, date, date, uuid, integer, integer);
drop function if exists nexus.borrowing_export(text, text, text, date, date, uuid);

-- Queue / export filter, as in 20261107100100 section 6, plus p_period_id:
--   null      = as before ("all" = the active period, every other view spans all periods);
--   a period  = only requests CREATED in that period (requests keep their creation period, F11.2);
--               "all" then means everything of the chosen period.
-- The period must exist in PI-CORE: a made-up id is refused (invalid_period), never "empty".
create or replace function nexus._ib_queue_rows(
  p_view text, p_search text, p_from date, p_to date, p_item_id uuid, p_period_id uuid default null)
returns table (
  ordinal bigint, request_id uuid, reference text, status text, version integer, period_id uuid, period_label text,
  requester_member_id uuid, requester_name text, is_outside_party boolean, outside_org_name text,
  outside_contact_name text, purpose text, start_date date, end_date date, created_at timestamptz,
  updated_at timestamptz, decided_at timestamptz, decided_by_name text, decision_note text,
  handed_over_at timestamptz, handed_over_by_name text, returned_at timestamptz, has_issue boolean,
  items jsonb, item_names text, qty_outstanding integer, is_overdue boolean, overdue_days integer,
  is_not_picked_up boolean, is_partially_returned boolean, extension_count integer, pending_overlap_count integer
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_view    text := coalesce(nullif(lower(btrim(p_view)), ''), 'pending');
  v_pattern text := nexus._ib_search_pattern(p_search);
  v_period  uuid := nexus.active_period_id();
  v_scope   uuid;  -- the one period the rows are limited to; null = no period limit
begin
  if v_view not in ('pending', 'ready', 'borrowed', 'overdue', 'closed', 'all', 'open_all_periods') then
    raise exception 'Unknown view' using errcode = '22023', hint = 'invalid_view';
  end if;
  if (p_from is null) <> (p_to is null) or p_to < p_from
     or (p_from is not null and (not isfinite(p_from) or not isfinite(p_to) or p_from < date '2000-01-01')) then
    raise exception 'Choose both dates, the end not before the start' using errcode = '22023', hint = 'invalid_dates';
  end if;
  if p_period_id is not null and not exists (select 1 from public.periods p where p.id = p_period_id) then
    raise exception 'Unknown period' using errcode = '22023', hint = 'invalid_period', detail = 'p_period_id';
  end if;
  v_scope := coalesce(p_period_id, case when v_view = 'all' then v_period end);
  -- "all" without a chosen period and without an active period: nothing to show (as before).
  if v_view = 'all' and v_scope is null then
    return;
  end if;

  return query
  select row_number() over (order by
           case when v_view = 'open_all_periods' then x.period_label end asc nulls last,
           case when v_view in ('borrowed', 'open_all_periods') then (not x.is_overdue)::int end asc,
           case when v_view = 'pending' then x.created_at end asc,
           case when v_view = 'ready' then x.start_date end asc,
           case when v_view in ('borrowed', 'overdue') then x.end_date end asc,
           case when v_view = 'open_all_periods' then x.start_date end asc,
           case when v_view = 'closed' then x.updated_at end desc,
           case when v_view = 'all' then x.created_at end desc,
           x.created_at, x.request_id),
         x.*,
         null::integer  -- pending_overlap_count: filled per page row by borrowing_queue (review M1)
  from nexus._ib_request_rows(null,
         case v_view when 'pending' then array['submitted'] when 'ready' then array['approved']
                     when 'borrowed' then array['borrowed'] when 'overdue' then array['borrowed']
                     when 'closed' then array['returned', 'rejected', 'cancelled']
                     when 'open_all_periods' then array['submitted', 'approved', 'borrowed']
                     else null end,
         v_scope, null) x
  where case v_view
          when 'pending' then x.status = 'submitted'
          when 'ready' then x.status = 'approved'
          when 'borrowed' then x.status = 'borrowed'
          when 'overdue' then x.status = 'borrowed' and x.is_overdue
          when 'closed' then x.status in ('returned', 'rejected', 'cancelled')
          when 'all' then true
          else x.status in ('submitted', 'approved', 'borrowed')
        end
    and (v_scope is null or x.period_id = v_scope)
    and (v_pattern is null
         or x.reference ilike v_pattern escape '\'
         or x.requester_name ilike v_pattern escape '\'
         or x.outside_org_name ilike v_pattern escape '\'
         or x.outside_contact_name ilike v_pattern escape '\'
         or x.item_names ilike v_pattern escape '\')
    and (p_from is null or (x.start_date <= p_to and x.end_date >= p_from))
    and (p_item_id is null or exists (select 1 from nexus.borrowing_request_lines l
                                      where l.request_id = x.request_id and l.item_id = p_item_id));
end
$$;

-- Queue / work list, as in 20261107100100 section 9.2, plus p_period_id (last, so old positional calls
-- still work). borrowing.view_all is required for every call, so also for the period filter.
create or replace function nexus.borrowing_queue(
  p_view      text    default 'pending',
  p_search    text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_item_id   uuid    default null,
  p_page      integer default 1,
  p_page_size integer default 20,
  p_period_id uuid    default null
)
returns table (
  row_no bigint, request_id uuid, reference text, status text, version integer, period_id uuid, period_label text,
  requester_member_id uuid, requester_name text, is_own boolean, is_outside_party boolean, outside_org_name text,
  outside_contact_name text, purpose text, start_date date, end_date date, items jsonb, qty_outstanding integer,
  is_overdue boolean, overdue_days integer, is_not_picked_up boolean, is_partially_returned boolean, has_issue boolean,
  extension_count integer, pending_overlap_count integer, created_at timestamptz,
  total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid;
begin
  perform nexus._require_permission('borrowing.view_all');
  v_me := nexus.current_member_id();
  perform nexus._ib_check_page(p_page, p_page_size);
  return query
  with
  q as (select * from nexus._ib_queue_rows(p_view, p_search, p_from, p_to, p_item_id, p_period_id)),
  t as (select count(*) as n from q),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select q.ordinal, q.request_id, q.reference, q.status, q.version, q.period_id, q.period_label,
         q.requester_member_id, q.requester_name, q.requester_member_id = v_me, q.is_outside_party, q.outside_org_name,
         q.outside_contact_name, q.purpose, q.start_date, q.end_date, q.items, q.qty_outstanding, q.is_overdue,
         q.overdue_days, q.is_not_picked_up, q.is_partially_returned, q.has_issue, q.extension_count,
         case when q.status = 'submitted' then nexus._ib_pending_overlap(q.request_id) else 0 end,
         q.created_at, t.n, pg.pno, p_page_size
  from q cross join t cross join pg
  where q.ordinal > (pg.pno - 1)::bigint * p_page_size and q.ordinal <= pg.pno::bigint * p_page_size
  order by q.ordinal;
end
$$;

-- Borrowing export, as in 20261107100100 section 11.2, plus p_period_id: the same rows and order as
-- borrowing_queue with the same filters (spec section 8). The period filter needs borrowing.view_all
-- explicitly (the engine already pairs export with view_all, R15; checked again so the rule cannot
-- loosen silently). The log row records the chosen period like every other filter (null = not used).
create or replace function nexus.borrowing_export(
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
  is_not_picked_up boolean, is_partially_returned boolean
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
         q.has_issue, q.is_overdue, q.overdue_days, q.is_not_picked_up, q.is_partially_returned
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

-- Period choices for the filter above (Fix 4, coordinator follow-up 2026-11-08). Named borrowing_* and
-- gated by borrowing.view_all on purpose: it serves only the borrowing period filter, whose users are
-- exactly the view_all holders; a general period list for other modules would be a separate decision.
-- Reads PI-CORE public.periods (id, label, starts_on, ends_on, is_active; verified in pi-core-v2
-- 20261031165546_core_schema.sql) as the function owner, read-only. Newest first: labels are
-- "YYYY/YYYY+1" and unique, so the label order is the time order (starts_on may be null in PI-CORE).
-- The permission check comes FIRST so every caller without the right (also inactive or unlinked) gets
-- the same permission_required as borrowing_queue; _ib_require_member() then repeats L1 explicitly.
create or replace function nexus.borrowing_period_list()
returns table (period_id uuid, label text, starts_on date, ends_on date, is_active boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('borrowing.view_all');
  perform nexus._ib_require_member();
  return query
  select p.id, p.label, p.starts_on, p.ends_on, p.is_active
  from public.periods p
  order by p.label desc, p.id;
end
$$;
comment on function nexus.borrowing_period_list() is
  'Periods for the borrowing period filter (borrowing.view_all only), newest first. Read-only view of PI-CORE public.periods.';

-- =============================================================================================
-- 6. Function privileges (as 20261107100100 section 13): new functions start with EXECUTE for PUBLIC,
--    so revoke it; client API to authenticated only, internals to nobody but the owner. Re-applied to
--    every module function so the result does not depend on what ran before.
-- =============================================================================================

do $$
declare
  f record;
  v_api text[] := array[
    'inventory_item_list', 'inventory_item_detail', 'inventory_item_availability', 'inventory_availability_bulk',
    'inventory_category_list', 'inventory_location_list', 'inventory_item_history_list', 'inventory_status_counts',
    'inventory_category_add', 'inventory_category_rename', 'inventory_category_set_active',
    'inventory_location_add', 'inventory_location_rename', 'inventory_location_set_active',
    'inventory_item_create', 'inventory_item_update', 'inventory_unit_add', 'inventory_unit_update',
    'inventory_stock_add', 'inventory_stock_move', 'inventory_stock_write_off', 'inventory_unit_set_condition',
    'inventory_unit_write_off', 'inventory_item_set_active', 'inventory_unit_set_active', 'inventory_unit_restore_lost',
    'inventory_export',
    'borrowing_my_requests', 'borrowing_queue', 'borrowing_queue_counts', 'borrowing_open_loans',
    'borrowing_request_detail', 'borrowing_request_detail_by_ref', 'borrowing_handover_units',
    'borrowing_request_create', 'borrowing_request_approve', 'borrowing_request_reject', 'borrowing_request_cancel',
    'borrowing_request_extend', 'borrowing_request_hand_over', 'borrowing_request_return',
    'borrowing_request_correct_return', 'borrowing_export', 'borrowing_period_list',
    'borrowing_evidence_can_upload', 'borrowing_evidence_can_read'];
begin
  for f in select p.oid::regprocedure as sig, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname = any (v_api) or p.proname like '\_ib\_%' or p.proname = '_jakarta_date') loop
    execute format('revoke all on function %s from public, anon, service_role', f.sig);
    if f.proname = any (v_api) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end
$$;

-- Ask PostgREST to pick up the changed signatures.
notify pgrst, 'reload schema';
