-- PMK-NEXUS 0012: access-control amendment for Meeting Minutes (D-027, owner 2026-11-09, N1 (b)).
--
-- Spec:      docs/modules/meeting-minutes.md (approved 2026-11-09, all recommendations accepted) section 2
--            and N1 (b); docs/modules/access-control.md section 3 (default rules, notation of D32-D36).
-- Decisions: D-011 (configurable rules), D-013 (L12), D-027 (Meeting Minutes rules).
-- PI-CORE:   verified against docs/picore/schema-report.md (pi-core-v2 migrations 20261031165546 ..
--            20261102090000, HEAD d8b6814, unchanged). Read here: roles(key) only. Role key
--            `kepala_departemen` is carried by the positions Kepala Departemen (department) and Kepala
--            Biro (bureau), seeded by 20261101100100_org_structure.sql.
--
-- What this file does (only nexus objects; nothing in public/private is created, altered, granted or
-- written):
--   1. Catalog text of minutes.manage: "archive" is reworded to "void" (A-MN15). Key and flags unchanged.
--   2. Default rule D37: role kepala_departemen -> minutes.view, scope own_unit (read only, no export).
--      minutes.view is baseline-safe and not sensitive, so L12 needs no reason; the seed carries one
--      anyway (spec section 12 note 5). Logged as 'seed'. restore_default_access_rules() needs no change:
--      it re-enables every disabled default_code that is not retired, so it already covers D37.
--   3. nexus.is_active_period(uuid) now returns FALSE (never NULL) when no period is active. Before, a
--      non-null id with no active period gave `id = null` = NULL; `if not nexus.is_active_period(..)`
--      then skipped its refusal. Every write already required an active period first, so nothing was
--      exploitable, but the new modules rely on a plain boolean. Same signature, same grants.
--
-- Re-runnable: guarded seed, text update only when different, create or replace. Run as ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261111100000_nexus_minutes_access_rules.sql
-- Requires 20261105100000 .. 20261107100000 (stops if D01-D36 are not all seeded).

-- =============================================================================================
-- 1. Catalog text (A-MN15: "archive" means void; a minute is never deleted)
-- =============================================================================================
update nexus.permissions
set description = 'Record, edit (active period) and void minutes; add and withdraw attachments. Includes view.'
where key = 'minutes.manage'
  and description is distinct from 'Record, edit (active period) and void minutes; add and withdraw attachments. Includes view.';

-- =============================================================================================
-- 2. Default rule D37 (N1 b). Same seeding style as D32/D33 and D34-D36.
-- =============================================================================================
do $$
declare
  v_count integer;
begin
  -- Seeding D37 on a database where earlier seeds failed would hide that failure.
  select count(*) into v_count
  from nexus.access_rules r
  where r.default_code in (select 'D' || lpad(g::text, 2, '0') from generate_series(1, 36) g);
  if v_count <> 36 then
    raise exception 'NEXUS minutes rules: default rules D01-D36 are not all seeded (found %); apply 20261105100100, 20261106200000 and 20261107100000 first', v_count
      using hint = 'defaults_not_seeded';
  end if;

  if not exists (select 1 from public.roles ro where ro.key = 'kepala_departemen') then
    raise exception 'NEXUS minutes rules: PI-CORE role key kepala_departemen not found'
      using hint = 'Check public.roles.key on this database (expected seed from PI-CORE migration 20261101100100).';
  end if;

  -- A custom rule with the same content would make the unique index reject the default.
  if exists (select 1 from nexus.access_rules r
             where r.default_code is null and r.subject_type = 'role' and r.role_key = 'kepala_departemen'
               and r.permission_key = 'minutes.view' and r.scope = 'own_unit') then
    raise notice 'NEXUS minutes rules: a custom rule with the same content as D37 exists; D37 is not added (check it is enabled).';
  end if;

  perform set_config('nexus.rule_action', 'seed', true);
  perform set_config('nexus.change_note', 'Default rule D37, docs/modules/meeting-minutes.md N1 (b) (D-027)', true);

  insert into nexus.access_rules (default_code, subject_type, role_key, permission_key, scope, note)
  select 'D37', 'role', 'kepala_departemen', 'minutes.view', 'own_unit',
         'N1 (b), D-027: Kepala Departemen and Kepala Biro read the minutes of their own unit (read only, no export).'
  where not exists (select 1 from nexus.access_rules r where r.default_code = 'D37')
    and not exists (select 1 from nexus.access_rules r
                    where r.subject_type = 'role' and r.role_key = 'kepala_departemen'
                      and r.permission_key = 'minutes.view' and r.scope = 'own_unit'
                      and r.position_id is null and r.org_unit_id is null and not r.include_child_units);
  get diagnostics v_count = row_count;

  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);
  raise notice 'NEXUS minutes rules: % default rule(s) added (D37).', v_count;
end
$$;

-- =============================================================================================
-- 3. L7 helper: a plain boolean, never NULL (see header item 3)
-- =============================================================================================
create or replace function nexus.is_active_period(p_period_id uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select coalesce(p_period_id is not null and p_period_id = nexus.active_period_id(), false)
$$;

revoke all on function nexus.is_active_period(uuid) from public, anon, service_role;
grant execute on function nexus.is_active_period(uuid) to authenticated;

notify pgrst, 'reload schema';
