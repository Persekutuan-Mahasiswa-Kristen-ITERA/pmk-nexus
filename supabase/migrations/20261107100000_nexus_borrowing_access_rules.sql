-- PMK-NEXUS 0005: access-control amendment for Inventory and Borrowing (D-022, 2026-11-07).
--
-- Spec:      docs/modules/access-control.md (amended 2026-11-07): key borrowing.handle, default rules
--            D34-D36, D30 retired, L6 narrowed (approve/reject/extend only), L9 widened, L12 lists
--            *.handle, A-n8 (rules are never edited in place: retire = disable).
--            docs/modules/inventory-borrowing.md (revision 2) section 2.
-- Decisions: D-011, D-013 (L12), D-022.
-- PI-CORE:   verified against pi-core-v2 migrations 20261031165546 .. 20261102090000 (HEAD d8b6814).
--            Read here (lookup by name AND type, once): positions(id, name, unit_type),
--            org_units(id, name, type, is_active). 20261101100100_org_structure.sql seeds
--            'Kepala Departemen' (department, rank 40), 'Kepala Divisi' (division, rank 60) and the
--            department 'Departemen Operasional' with divisions Logistik and Akomodasi.
--
-- What this file does (only nexus objects; nothing in public/private is created, altered, granted or
-- written):
--   1. Catalog: new key borrowing.handle (A-IB36: power key, never baseline, NOT sensitive, see below);
--      new text for borrowing.approve and inventory.manage; an extra L12 check for *.handle.
--   2. Table nexus.retired_default_rules + D30 retired (disabled, never deleted, A-n8). Restoring the
--      defaults no longer brings a retired rule back.
--   3. Default rules D34, D35 (borrowing.approve for the Operations heads) and D36 (borrowing.handle for
--      every Operations holder), each with a written reason (L12). Logged as 'seed'.
--   4. access_rule_warnings() also watches borrowing.handle.
--
-- A-IB36 decision (flags of borrowing.handle):
--   allow_baseline = false  -> L12: never to "every active member", a written reason on every grant.
--   is_sensitive   = false  -> same as borrowing.approve. "Sensitive" in this catalog means "exposes
--                             finance or member data" and forces an extra confirm click on every grant
--                             and restore (AC-63). handle shows request data that view_all already shows
--                             and no personal data (L4), so the confirm would add friction without
--                             protecting anything that L12 + the change log do not already cover.
--
-- Re-runnable: every step is idempotent (on conflict / guarded inserts / guarded constraint add). Run it
-- as ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261107100000_nexus_borrowing_access_rules.sql
-- Requires 20261105100000, 20261105100100 and 20261106200000 (stops if D01-D33 are not seeded).

-- =============================================================================================
-- 1. Catalog
-- =============================================================================================

-- L12 now also names *.handle. The original check (permissions_l12_baseline) is kept untouched; this
-- extra check adds the floor for handle keys, so no constraint is dropped.
do $$
begin
  if not exists (select 1 from pg_constraint c
                 where c.conrelid = 'nexus.permissions'::regclass and c.conname = 'permissions_l12_handle') then
    alter table nexus.permissions
      add constraint permissions_l12_handle check (not allow_baseline or key !~ '\.handle$');
  end if;
end
$$;

insert into nexus.permissions (key, module, label, description, is_sensitive, allow_baseline, includes_key, requires_key, sort_order)
values ('borrowing.handle', 'borrowing', 'Handle borrowing',
        'Record handover and return (good, damaged, lost), cancel an approved request not picked up, correct a wrong return once, record outside-party requests. Includes view_all. Not limited by L6.',
        false, false, 'borrowing.view_all', null, 63)
on conflict (key) do nothing;

insert into nexus.permission_scopes (permission_key, scope)
values ('borrowing.handle', 'all')
on conflict do nothing;

-- Owner 2026-11-07: the only correction is of a wrong RETURN, once per request (no handover
-- correction). Text only; brings databases that ran an earlier draft of this file up to date.
update nexus.permissions
set description = 'Record handover and return (good, damaged, lost), cancel an approved request not picked up, correct a wrong return once, record outside-party requests. Includes view_all. Not limited by L6.'
where key = 'borrowing.handle' and description is distinct from 'Record handover and return (good, damaged, lost), cancel an approved request not picked up, correct a wrong return once, record outside-party requests. Includes view_all. Not limited by L6.';

-- Text only (A-n7 superseded): approve no longer covers handover/return. Key and flags unchanged.
update nexus.permissions
set description = 'Approve, reject, extend. Includes view_all. Never own requests (L6).'
where key = 'borrowing.approve'
  and description is distinct from 'Approve, reject, extend. Includes view_all. Never own requests (L6).';

update nexus.permissions
set description = 'Add, edit, archive and reactivate items and units; change stock and condition; write off; maintain categories and locations. Includes view.'
where key = 'inventory.manage'
  and description is distinct from 'Add, edit, archive and reactivate items and units; change stock and condition; write off; maintain categories and locations. Includes view.';

-- =============================================================================================
-- 2. Retired default rules (A-n8: never deleted, never edited; "retired" = disabled + listed here).
--    restore_default_access_rules() skips these codes, so B28 cannot silently bring D30 back. The
--    System Admin can still enable a retired rule by hand (logged, with a reason, like any grant).
-- =============================================================================================

create table if not exists nexus.retired_default_rules (
  default_code text primary key check (default_code ~ '^D[0-9]{2}$'),
  retired_at   timestamptz not null default now(),
  reason       text not null check (char_length(btrim(reason)) between 1 and 500)
);
comment on table nexus.retired_default_rules is
  'Default rule codes retired by a migration (D-022: D30). Skipped by restore_default_access_rules(). Migration-owned; System Admin reads.';

create or replace trigger retired_default_rules_no_change
  before update or delete on nexus.retired_default_rules
  for each row execute function nexus._append_only_guard();
create or replace trigger retired_default_rules_no_truncate
  before truncate on nexus.retired_default_rules
  for each statement execute function nexus._append_only_guard();

revoke all on nexus.retired_default_rules from public, anon, authenticated, service_role;
grant select on nexus.retired_default_rules to authenticated, service_role;
alter table nexus.retired_default_rules enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'nexus' and p.tablename = 'retired_default_rules'
                   and p.policyname = 'retired_default_rules_select') then
    -- Same reader as the rules table itself (L3).
    create policy retired_default_rules_select on nexus.retired_default_rules for select to authenticated
      using ((select nexus.is_system_admin()));
  end if;
end
$$;

-- B28 restore, now skipping retired defaults. Same signature and behaviour otherwise (replaces the
-- body from 20261105100000).
create or replace function nexus.restore_default_access_rules(p_note text default null, p_confirm_sensitive boolean default false)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  perform nexus._require_system_admin();
  p_note := nexus._clean_note(p_note);
  if not exists (select 1 from nexus.access_rules r where r.default_code is not null) then
    raise exception 'Default rules were never seeded; apply migration 20261105100100 first'
      using errcode = 'P0001', hint = 'defaults_not_seeded';
  end if;
  if not coalesce(p_confirm_sensitive, false) and exists (
       select 1 from nexus.access_rules r
       join nexus.permissions pk on pk.key = r.permission_key
       where r.default_code is not null and not r.is_enabled and pk.is_sensitive
         and r.default_code not in (select x.default_code from nexus.retired_default_rules x)) then
    raise exception 'Restoring defaults re-enables sensitive rules; confirm to continue'
      using errcode = 'P0001', hint = 'sensitive_confirmation_required';
  end if;
  if p_note is null and exists (
       select 1 from nexus.access_rules r
       join nexus.permissions pk on pk.key = r.permission_key
       where r.default_code is not null and not r.is_enabled and not pk.allow_baseline
         and r.default_code not in (select x.default_code from nexus.retired_default_rules x)) then
    raise exception 'Restoring defaults re-enables sensitive or power rules; give a written reason (note)'
      using errcode = '22023', hint = 'note_required';
  end if;

  perform set_config('nexus.rule_action', 'restore_default', true);
  perform set_config('nexus.change_note', coalesce(p_note, ''), true);
  update nexus.access_rules set is_enabled = true
  where default_code is not null and not is_enabled
    and default_code not in (select x.default_code from nexus.retired_default_rules x);
  get diagnostics v_count = row_count;
  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);
  return v_count;
end
$$;

-- =============================================================================================
-- 3. Default rules: retire D30, seed D34-D36 (access-control section 3).
--    Stops (whole file rolls back) when D01-D33 are not all there: seeding D34 first on a database where
--    the earlier seeds failed would hide that failure.
-- =============================================================================================

do $$
declare
  v_count     integer;
  v_ops_unit  uuid;
  v_kadep     uuid;
  v_kadiv     uuid;
  v_d30       uuid;
  v_retired   text := 'D30 was already retired';
begin
  select count(*) into v_count
  from nexus.access_rules r
  where r.default_code in (select 'D' || lpad(g::text, 2, '0') from generate_series(1, 33) g);
  if v_count <> 33 then
    raise exception 'NEXUS borrowing rules: default rules D01-D33 are not all seeded (found %); apply 20261105100100 and 20261106200000 first', v_count
      using hint = 'defaults_not_seeded';
  end if;

  -- Lookups by name AND type (positions are unique per (unit_type, lower(btrim(name))) in PI-CORE).
  select count(*), (array_agg(u.id))[1] into v_count, v_ops_unit
  from public.org_units u
  where u.type = 'department' and lower(btrim(u.name)) = lower('Departemen Operasional') and u.is_active;
  if v_count <> 1 then
    raise exception 'NEXUS borrowing rules: expected exactly 1 active department "Departemen Operasional", found %', v_count;
  end if;

  select count(*), (array_agg(po.id))[1] into v_count, v_kadep
  from public.positions po
  where po.unit_type = 'department' and lower(btrim(po.name)) = lower('Kepala Departemen');
  if v_count <> 1 then
    raise exception 'NEXUS borrowing rules: expected exactly 1 department position "Kepala Departemen", found %', v_count;
  end if;

  select count(*), (array_agg(po.id))[1] into v_count, v_kadiv
  from public.positions po
  where po.unit_type = 'division' and lower(btrim(po.name)) = lower('Kepala Divisi');
  if v_count <> 1 then
    raise exception 'NEXUS borrowing rules: expected exactly 1 division position "Kepala Divisi", found %', v_count;
  end if;

  -- Same checks add_access_rule() would run: the position must be holdable in the unit tree.
  if not nexus._position_fits_unit(v_kadep, v_ops_unit, true)
     or not nexus._position_fits_unit(v_kadiv, v_ops_unit, true) then
    raise exception 'NEXUS borrowing rules: Kepala Departemen / Kepala Divisi cannot be held in Departemen Operasional or its divisions';
  end if;

  -- D28 must point at the same unit, otherwise D34-D36 would cover a different "Operations" than D28.
  if not exists (select 1 from nexus.access_rules r where r.default_code = 'D28' and r.org_unit_id = v_ops_unit) then
    raise exception 'NEXUS borrowing rules: D28 does not point at the active "Departemen Operasional"; ask the owner before seeding D34-D36';
  end if;

  -- 3a. Retire D30 exactly once. If the System Admin later re-enables it on purpose, a re-run of this
  --     file must not undo that decision, so the disable only happens together with the first insert
  --     into retired_default_rules.
  if not exists (select 1 from nexus.retired_default_rules x where x.default_code = 'D30') then
    select r.id into v_d30 from nexus.access_rules r where r.default_code = 'D30';
    insert into nexus.retired_default_rules (default_code, reason)
    values ('D30', 'D-022 (2026-11-07): approval moved to the Operations heads (D34, D35); handover and return moved to the new key borrowing.handle (D36).');
    if v_d30 is not null then
      perform set_config('nexus.rule_action', 'disable', true);
      perform set_config('nexus.change_note', 'Retired by D-022: replaced by D34, D35 (heads approve) and D36 (Operations handle)', true);
      update nexus.access_rules set is_enabled = false where id = v_d30 and is_enabled;
      perform set_config('nexus.rule_action', '', true);
      perform set_config('nexus.change_note', '', true);
    end if;
    v_retired := 'D30 retired now';
  end if;

  -- 3b. A custom rule with the same content would make the unique index reject the default; skip that
  --     default and say so instead of failing the migration (same approach as D32/D33).
  if exists (select 1 from nexus.access_rules r
             where r.default_code is null and r.subject_type = 'org_unit' and r.org_unit_id = v_ops_unit
               and r.include_child_units and r.scope = 'all'
               and ((r.permission_key = 'borrowing.approve' and r.position_id in (v_kadep, v_kadiv))
                 or (r.permission_key = 'borrowing.handle' and r.position_id is null))) then
    raise notice 'NEXUS borrowing rules: a custom rule with the same content as D34/D35/D36 exists; that default is not added (check it is enabled).';
  end if;

  perform set_config('nexus.rule_action', 'seed', true);
  perform set_config('nexus.change_note', 'Default rules D34-D36, docs/modules/access-control.md section 3 (D-022)', true);

  insert into nexus.access_rules
    (default_code, subject_type, position_id, org_unit_id, include_child_units, permission_key, scope, note)
  select v.default_code, 'org_unit', v.position_id, v_ops_unit, true, v.permission_key, 'all', v.note
  from (values
    ('D34', v_kadep, 'borrowing.approve',
     'IB2 (b), D-022: the Kepala Departemen of Departemen Operasional approves, rejects and extends borrowing requests (never their own, L6).'),
    ('D35', v_kadiv, 'borrowing.approve',
     'IB2 (b), D-022: the Kepala Divisi of each Operations division (Logistik, Akomodasi, and any division added later) approves, rejects and extends (never their own, L6).'),
    ('D36', null::uuid, 'borrowing.handle',
     'IB2 (b), D-022: every Operations holder records handover, return and outside-party requests; recording their own is allowed and logged.')
  ) as v(default_code, position_id, permission_key, note)
  where not exists (select 1 from nexus.access_rules r where r.default_code = v.default_code)
    and not exists (select 1 from nexus.access_rules r
                    where r.subject_type = 'org_unit' and r.org_unit_id = v_ops_unit and r.include_child_units
                      and r.position_id is not distinct from v.position_id
                      and r.permission_key = v.permission_key and r.scope = 'all');
  get diagnostics v_count = row_count;

  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);
  raise notice 'NEXUS borrowing rules: % default rule(s) added (D34-D36); %.', v_count, v_retired;
end
$$;

-- =============================================================================================
-- 4. "Nobody can use it" warnings (access-control section 5): also borrowing.handle. A lone handle
--    holder is not a risk (L6 does not apply to handle), so single_holder stays off for it.
--    Same signature as before; none of the five keys is implied by another key, so direct rule
--    matches are exact.
-- =============================================================================================

create or replace function nexus.access_rule_warnings()
returns table (permission_key text, holder_count integer, warning text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform nexus._require_system_admin();
  return query
  with watched (key, single_is_risky, ord) as (
    values ('letters.manage', false, 1),
           ('letter_requests.process', true, 2),
           ('finance.manage', false, 3),
           ('borrowing.approve', true, 4),
           ('borrowing.handle', false, 5)
  ),
  holders as (
    select x.permission_key, count(distinct x.member_id)::int as n
    from nexus._rule_matches(null, true, false) x
    group by x.permission_key
  )
  select w.key, coalesce(h.n, 0),
         case
           when coalesce(h.n, 0) = 0 then 'no_holder'
           when coalesce(h.n, 0) = 1 and w.single_is_risky then 'single_holder'
           else null
         end
  from watched w
  left join holders h on h.permission_key = w.key
  order by w.ord;
end
$$;

-- Privileges unchanged in shape (replace keeps grants), restated so a fresh database is explicit.
revoke all on function nexus.access_rule_warnings(), nexus.restore_default_access_rules(text, boolean)
  from public, anon, service_role;
grant execute on function nexus.access_rule_warnings(), nexus.restore_default_access_rules(text, boolean)
  to authenticated;

notify pgrst, 'reload schema';
