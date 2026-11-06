-- PMK-NEXUS 0001: schema `nexus` + configurable access-control engine.
--
-- Spec:      docs/modules/access-control.md (revision 2, approved D-012)
-- Decisions: D-007 (System Admin = members.access_level), D-010 (read PI-CORE only through nexus
--            functions), D-011 (configurable rules), D-012 (B26-B30 answers), D-013 (locked rule L12:
--            sensitive/power keys never go to "every active member" and always need a written reason).
-- PI-CORE:   verified against pi-core-v2 migrations 20261031165546 .. 20261102090000
--            (docs/picore/schema-report.md). Columns used: members(id, user_id, full_name, is_active,
--            access_level, member_type), assignments(member_id, org_unit_id, position_id, period_id),
--            periods(id, label, is_active), position_roles(position_id, role_id), roles(id, key, name,
--            description), positions(id, name, unit_type, rank), org_units(id, parent_id, type, name,
--            sort_order, is_active).
--
-- Hard rules followed here:
--   * Only objects in schema `nexus` are created. Nothing in `public`/`private` is created, altered,
--     granted, or written. No foreign keys point at PI-CORE tables (a NEXUS row must never block a
--     PI-CORE change; spec 7.2). PI-CORE ids are stored as plain uuid/text values.
--   * No function reads email, phone, nim, nip, must_change_password, audit_log, org_settings,
--     roles.grants_admin, or calls private.* (L4, D-007, D-010). Function bodies below deliberately do
--     not even mention those names, so a catalog test can grep for them (AC-49).
--   * RLS is enabled on every table; nothing is granted to anon; clients get SELECT only where a policy
--     allows it. All writes go through SECURITY DEFINER functions that check the System Admin.
--   * Honest limits: the triggers below stop API roles (authenticated, service_role) and ordinary hand
--     edits, so the log is tamper-EVIDENT for them. The table owner / dashboard admins (`postgres`) can
--     still disable triggers or drop the schema; Supabase dashboard access = full control. Keep an
--     off-database copy of nexus.access_rule_log (see supabase/README.md).
--
-- Default rules (D01-D31) are seeded by the NEXT migration (20261105100100), because that step looks
-- PI-CORE positions/units up by name and may fail on a database whose names differ (A3). Keeping it
-- separate means a failed lookup leaves a safe "baseline-only, no rules" engine, never a half state.
--
-- Run this file as ONE transaction: primary route `psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f <file>`; the
-- Supabase SQL editor (one whole script = one transaction) is the fallback. See supabase/README.md first.

-- =============================================================================================
-- 1. Schema and privileges
-- =============================================================================================

create schema if not exists nexus;
comment on schema nexus is
  'PMK-NEXUS application schema. PI-CORE (public/private) is read-only for NEXUS and read only through functions here.';

-- Nobody but authenticated users (and the server-only service role, read-only) may even look inside.
revoke all on schema nexus from public;
revoke all on schema nexus from anon;
grant usage on schema nexus to authenticated, service_role;

-- Stop new objects from being exposed by accident. Note: per-schema default privileges can only
-- remove what per-schema defaults added; global defaults (e.g. EXECUTE to PUBLIC on functions) still
-- apply. That is why every table and function below ALSO revokes explicitly.
alter default privileges in schema nexus revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges in schema nexus revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema nexus revoke all on functions from public, anon, authenticated, service_role;

-- =============================================================================================
-- 2. Tables
-- =============================================================================================

-- 2.1 Permission catalog (spec 2.1). Stable keys owned by migrations: the admin picks from this list
-- and can never invent a key. Stored as data so rules are validated by foreign keys, not by app code.
create table nexus.permissions (
  key          text primary key check (key ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  module       text not null,
  label        text not null check (char_length(btrim(label)) between 2 and 80),
  description  text not null check (char_length(description) <= 280),
  is_sensitive boolean not null default false,
  -- L12 / D-013: may this key be granted to subject 'all_members'? No default on purpose: every future
  -- key must decide explicitly. false also means "a rule granting it needs a written reason (note)".
  allow_baseline boolean not null,
  -- R15: holding this key also grants `includes_key` with the same scope (manage -> view).
  includes_key text references nexus.permissions (key),
  -- R15: this key only works where the caller ALSO holds `requires_key` (export never exceeds view).
  requires_key text references nexus.permissions (key),
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now(),
  check (module = split_part(key, '.', 1)),
  check (includes_key is distinct from key),
  check (requires_key is distinct from key),
  -- L12 floor: a future migration cannot mark a sensitive or power key as baseline-safe by mistake.
  -- (It may still lock MORE keys than L12 names.)
  constraint permissions_l12_baseline check (
    not allow_baseline
    or (not is_sensitive
        and module not in ('finance', 'member_data')
        and key !~ '\.(manage|approve|process)$')
  )
);
comment on table nexus.permissions is
  'Permission catalog (spec 2.1). Migration-owned; clients read only. includes_key/requires_key implement R15; allow_baseline implements L12 (D-013).';

-- 2.2 Which scopes each key accepts. A composite FK from access_rules makes "own unit on finance.view"
-- impossible at the database level (AC-62), even for hand-written SQL (R10).
create table nexus.permission_scopes (
  permission_key text not null references nexus.permissions (key),
  scope          text not null check (scope in ('all', 'own_unit', 'own_unit_and_children')),
  primary key (permission_key, scope)
);
comment on table nexus.permission_scopes is
  'Allowed (permission, scope) pairs. own_unit / own_unit_and_children only for minutes.* (D-008, B26).';

-- 2.3 Access rules (spec 2.2, 7.2). One rule = one subject + one permission + one scope (R13).
-- There is deliberately NO column that could hold a member id or email (L10, AC-61).
create table nexus.access_rules (
  id                  uuid primary key default gen_random_uuid(),
  subject_type        text not null check (subject_type in ('role', 'position', 'org_unit', 'all_members')),
  -- S1: PI-CORE roles.key (stable), never the role id or name (B30).
  role_key            text check (role_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- S2: PI-CORE positions.id. For S3 it is the optional "position limit".
  position_id         uuid,
  -- S3: PI-CORE org_units.id.
  org_unit_id         uuid,
  -- S3 only: also match assignments in descendant units (B26).
  include_child_units boolean not null default false,
  permission_key      text not null,
  scope               text not null default 'all',
  is_enabled          boolean not null default true,
  note                text check (note is null or char_length(note) <= 500),
  -- D01..D31 for seeded default rules; used by "restore missing defaults" (B28). Null = custom rule.
  default_code        text unique check (default_code ~ '^D[0-9]{2}$'),
  created_at          timestamptz not null default now(),
  created_by          uuid,  -- PI-CORE members.id of the actor; null = migration / SQL editor
  updated_at          timestamptz not null default now(),
  updated_by          uuid,  -- members.id of the last enable/disable actor
  constraint access_rules_scope_allowed
    foreign key (permission_key, scope) references nexus.permission_scopes (permission_key, scope),
  -- Each subject type uses exactly its own columns, so a rule can never be ambiguous.
  constraint access_rules_subject_shape check (
       (subject_type = 'role'        and role_key is not null and position_id is null and org_unit_id is null and not include_child_units)
    or (subject_type = 'position'    and position_id is not null and role_key is null and org_unit_id is null and not include_child_units)
    or (subject_type = 'org_unit'    and org_unit_id is not null and role_key is null)
    or (subject_type = 'all_members' and role_key is null and position_id is null and org_unit_id is null and not include_child_units)
  ),
  -- A baseline rule has no assignment, hence no unit: only scope 'all' makes sense (spec 2.1, AC-62).
  constraint access_rules_baseline_scope check (subject_type <> 'all_members' or scope = 'all')
);
comment on table nexus.access_rules is
  'Configurable access rules (D-011). Never deleted, never edited in place (L5, A-n8): disable + add new. Written only through nexus.*_access_rule functions.';

-- Duplicates (same subject, permission, scope, flags) are rejected across enabled AND disabled rows:
-- to bring a disabled rule back, enable it instead of creating a twin (AC-65).
create unique index access_rules_content_key on nexus.access_rules
  (subject_type, role_key, position_id, org_unit_id, include_child_units, permission_key, scope)
  nulls not distinct;
create index access_rules_enabled_idx on nexus.access_rules (subject_type, permission_key) where is_enabled;

-- 2.4 Change log (spec 5, B24, B28). Append-only (L11), enforced by triggers below.
create table nexus.access_rule_log (
  id              bigint generated always as identity primary key,
  rule_id         uuid not null references nexus.access_rules (id) on delete restrict,
  action          text not null check (action in ('seed', 'add', 'disable', 'enable', 'restore_default')),
  actor_member_id uuid,          -- members.id; null = migration, SQL editor, or service role
  actor_name      text,          -- snapshot, so the log stays readable after renames/deactivation
  session_role    text not null default session_user,  -- 'authenticator' = API call; anything else = hand edit
  occurred_at     timestamptz not null default now(),
  permission_key  text not null,
  subject_label   text,          -- snapshot of the subject's display name at that time
  is_sensitive    boolean not null,
  -- B28 (2)(b): the change grants something to a subject that matches the actor right now.
  is_self_benefit boolean not null default false,
  before_data     jsonb,         -- full rule row before (null on add/seed)
  after_data      jsonb not null,-- full rule row after
  note            text check (note is null or char_length(note) <= 500)
);
comment on table nexus.access_rule_log is
  'Append-only access-rule change log (L11). Readable by System Admin and holders of access_rules.view_log.';
create index access_rule_log_occurred_idx on nexus.access_rule_log (occurred_at desc);
create index access_rule_log_rule_idx on nexus.access_rule_log (rule_id, occurred_at desc);

-- =============================================================================================
-- 3. Identity helpers
--    current_member_id() and is_system_admin() are SECURITY DEFINER so they do not depend on
--    PI-CORE's RLS policies or column grants on public.members (if PI-CORE tightens those, NEXUS keeps
--    working and still answers ONLY about the caller: both filter on auth.uid() and is_active, which
--    is L1). The other helpers stay INVOKER: PI-CORE RLS already shows the active period to active
--    members only, which is exactly L1 too.
-- =============================================================================================

-- L1: the caller's members.id, only when the Auth user is linked AND the member is active.
create function nexus.current_member_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.id
  from public.members m
  where m.user_id = (select auth.uid()) and m.is_active
$$;

-- L2: System Admin comes ONLY from access_level of an active member. Positions are ignored (D-007).
create function nexus.is_system_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.user_id = (select auth.uid())
      and m.is_active
      and m.access_level in ('admin', 'super_admin')
  )
$$;

-- R1/R11: null when no period is active.
create function nexus.active_period_id()
returns uuid
language sql stable security invoker set search_path = ''
as $$
  select p.id from public.periods p where p.is_active
$$;

-- L7 helper for module tables: may this period's records still be edited?
create function nexus.is_active_period(p_period_id uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select p_period_id is not null and p_period_id = nexus.active_period_id()
$$;

-- "Who am I" for the app shell. Zero rows = No access (L1, AC-32/33).
create function nexus.my_context()
returns table (
  member_id           uuid,
  full_name           text,
  member_type         text,
  is_system_admin     boolean,
  active_period_id    uuid,
  active_period_label text
)
language sql stable security invoker set search_path = ''
as $$
  select m.id, m.full_name, m.member_type::text, nexus.is_system_admin(), p.id, p.label
  from public.members m
  left join public.periods p on p.is_active
  where m.user_id = (select auth.uid()) and m.is_active
$$;

-- =============================================================================================
-- 4. Engine internals (no EXECUTE for clients; called only from SECURITY DEFINER functions below,
--    which run as the table owner and therefore may read nexus.access_rules).
-- =============================================================================================

-- The unit itself plus every descendant (PI-CORE tree is organization -> department -> division).
-- Depth cap guards against a cycle if the tree is ever corrupted.
create function nexus._unit_and_descendants(p_unit_id uuid)
returns table (unit_id uuid)
language sql stable set search_path = ''
as $$
  with recursive tree (id, depth) as (
    select u.id, 0 from public.org_units u where u.id = p_unit_id
    union all
    select c.id, t.depth + 1
    from public.org_units c
    join tree t on c.parent_id = t.id
    where t.depth < 10
  )
  select tree.id from tree
$$;

-- Can a position (limit) ever be held inside this unit (or its children when the flag is on)?
-- Positions belong to a unit TYPE, so "Staff (division)" never fits "Departemen X" without children.
create function nexus._position_fits_unit(p_position_id uuid, p_unit_id uuid, p_include_children boolean)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from public.positions po
    join nexus._unit_and_descendants(p_unit_id) d on true
    join public.org_units u on u.id = d.unit_id
    where po.id = p_position_id
      and u.type = po.unit_type
      and (p_include_children or u.id = p_unit_id)
  )
$$;

-- THE matching definition (spec 2.2, R1, R16). One place, used by the permission check, the
-- self-benefit flag, holder counts and warnings, so they can never disagree.
--   p_member_id        match this member only (null + p_all_members = false -> nothing, i.e. L1)
--   p_all_members      match every active member (admin screen counts)
--   p_include_disabled also evaluate disabled rules ("would match" counts on the admin screen)
-- Only ACTIVE members and ACTIVE-period assignments ever match (L1, R1). Stale ids simply find no
-- PI-CORE row and match nobody (R16). A rule whose subject unit is deactivated matches nobody
-- (spec 5); assignments sitting in a deactivated unit still count for role/position rules (A-n11).
create function nexus._rule_matches(p_member_id uuid, p_all_members boolean, p_include_disabled boolean)
returns table (
  rule_id            uuid,
  member_id          uuid,
  permission_key     text,
  scope              text,
  assignment_unit_id uuid
)
language sql stable set search_path = ''
as $$
  with
  candidates as (
    select m.id
    from public.members m
    where m.is_active and (p_all_members or m.id = p_member_id)
  ),
  active_period as (
    select p.id from public.periods p where p.is_active
  ),
  rules as (
    select r.*
    from nexus.access_rules r
    where r.is_enabled or p_include_disabled
  )
  -- S4: every active member, no assignment needed. L12 defense in depth: a baseline rule for a key
  -- that is not baseline-safe matches nobody, even if it ever got into the table (e.g. triggers
  -- disabled by the owner, or a key re-classified by a later migration).
  select r.id, c.id, r.permission_key, r.scope, null::uuid
  from rules r
  cross join candidates c
  where r.subject_type = 'all_members'
    and exists (select 1 from nexus.permissions pk where pk.key = r.permission_key and pk.allow_baseline)

  union all

  -- S1-S3: one row per matching active-period assignment (its unit drives "own unit" scope).
  select r.id, a.member_id, r.permission_key, r.scope, a.org_unit_id
  from public.assignments a
  join candidates c on c.id = a.member_id
  join active_period ap on ap.id = a.period_id
  join rules r on r.subject_type <> 'all_members'
  where
    (r.subject_type = 'position' and a.position_id = r.position_id)
    or (r.subject_type = 'role' and exists (
          select 1
          from public.position_roles pr
          join public.roles ro on ro.id = pr.role_id
          where pr.position_id = a.position_id and ro.key = r.role_key))
    or (r.subject_type = 'org_unit'
        and (r.position_id is null or a.position_id = r.position_id)
        and exists (select 1 from public.org_units su where su.id = r.org_unit_id and su.is_active)
        and (a.org_unit_id = r.org_unit_id
             or (r.include_child_units
                 and a.org_unit_id in (select d.unit_id from nexus._unit_and_descendants(r.org_unit_id) d))))
$$;

-- Effective grants of one member: (permission_key, unit_id) where unit_id null = scope "all".
-- Steps: expand scope to unit ids -> add implied keys (R15 manage includes view, recursive) ->
-- gate keys that need a prerequisite (export needs view, intersected per unit) -> "all" beats units (R2).
create function nexus._member_grants(p_member_id uuid)
returns table (permission_key text, unit_id uuid)
language sql stable set search_path = ''
as $$
  with recursive
  matched as (
    select x.permission_key, x.scope, x.assignment_unit_id
    from nexus._rule_matches(p_member_id, false, false) x
  ),
  scoped (permission_key, unit_id) as (
    select mt.permission_key, null::uuid from matched mt where mt.scope = 'all'
    union
    select mt.permission_key, mt.assignment_unit_id
    from matched mt
    where mt.scope = 'own_unit' and mt.assignment_unit_id is not null
    union
    select mt.permission_key, d.unit_id
    from matched mt
    cross join lateral nexus._unit_and_descendants(mt.assignment_unit_id) d
    where mt.scope = 'own_unit_and_children' and mt.assignment_unit_id is not null
  ),
  implied (permission_key, unit_id) as (
    select s.permission_key, s.unit_id from scoped s
    union
    select pk.includes_key, i.unit_id
    from implied i
    join nexus.permissions pk on pk.key = i.permission_key
    where pk.includes_key is not null
  ),
  gated (permission_key, unit_id) as (
    -- keys without a prerequisite pass unchanged
    select i.permission_key, i.unit_id
    from implied i
    join nexus.permissions pk on pk.key = i.permission_key
    where pk.requires_key is null
    union
    -- "all" + prerequisite "all" -> all
    select i.permission_key, null::uuid
    from implied i
    join nexus.permissions pk on pk.key = i.permission_key
    where pk.requires_key is not null and i.unit_id is null
      and exists (select 1 from implied v where v.permission_key = pk.requires_key and v.unit_id is null)
    union
    -- "all" + prerequisite on some units -> only those units
    select i.permission_key, v.unit_id
    from implied i
    join nexus.permissions pk on pk.key = i.permission_key
    join implied v on v.permission_key = pk.requires_key and v.unit_id is not null
    where pk.requires_key is not null and i.unit_id is null
    union
    -- unit + prerequisite "all" or the same unit -> that unit
    select i.permission_key, i.unit_id
    from implied i
    join nexus.permissions pk on pk.key = i.permission_key
    where pk.requires_key is not null and i.unit_id is not null
      and exists (select 1 from implied v
                  where v.permission_key = pk.requires_key and (v.unit_id is null or v.unit_id = i.unit_id))
  )
  select g.permission_key, g.unit_id
  from gated g
  where g.unit_id is null
     or not exists (select 1 from gated a where a.permission_key = g.permission_key and a.unit_id is null)
$$;

-- Human label for a rule subject (admin list, log snapshot). English; the UI may translate.
create function nexus._rule_subject_label(
  p_subject_type text, p_role_key text, p_position_id uuid, p_org_unit_id uuid, p_include_child_units boolean
)
returns text
language sql stable set search_path = ''
as $$
  select case p_subject_type
    when 'all_members' then 'Every active member'
    when 'role' then 'Role: ' || coalesce(
      (select ro.name from public.roles ro where ro.key = p_role_key), p_role_key || ' (missing)')
    when 'position' then 'Position: ' || coalesce(
      (select po.name || ' (' || po.unit_type::text || ')' from public.positions po where po.id = p_position_id),
      'unknown position ' || p_position_id::text)
    when 'org_unit' then 'Unit: ' || coalesce(
      (select u.name from public.org_units u where u.id = p_org_unit_id), 'unknown unit ' || p_org_unit_id::text)
      || case when p_include_child_units then ' + child units' else '' end
      || case when p_position_id is null then ', any position'
              else ', position ' || coalesce(
                (select po.name from public.positions po where po.id = p_position_id),
                'unknown ' || p_position_id::text)
         end
  end
$$;

-- Why a rule currently matches nobody because of its subject (R16, AC-54). Null = not stale.
create function nexus._rule_stale_reason(
  p_subject_type text, p_role_key text, p_position_id uuid, p_org_unit_id uuid, p_include_child_units boolean
)
returns text
language sql stable set search_path = ''
as $$
  select case
    when p_subject_type = 'role'
         and not exists (select 1 from public.roles ro where ro.key = p_role_key) then 'role_missing'
    when p_subject_type = 'position'
         and not exists (select 1 from public.positions po where po.id = p_position_id) then 'position_missing'
    when p_subject_type = 'org_unit'
         and not exists (select 1 from public.org_units u where u.id = p_org_unit_id) then 'unit_missing'
    when p_subject_type = 'org_unit'
         and exists (select 1 from public.org_units u where u.id = p_org_unit_id and not u.is_active) then 'unit_inactive'
    when p_subject_type = 'org_unit' and p_position_id is not null
         and not exists (select 1 from public.positions po where po.id = p_position_id) then 'position_missing'
    when p_subject_type = 'org_unit' and p_position_id is not null
         and not nexus._position_fits_unit(p_position_id, p_org_unit_id, p_include_child_units) then 'position_not_in_unit'
    else null
  end
$$;

-- =============================================================================================
-- 5. Permission API (SECURITY DEFINER because it must read nexus.access_rules, which clients may not
--    read directly (AC-01). Every function filters on the caller's own auth.uid(); nothing about other
--    members is returned.)
-- =============================================================================================

-- The single engine for RLS policies and server code. Computed per call, never cached (R3).
--   p_unit_id null  -> true only for scope "all".
--   p_unit_id given -> true for scope "all" OR when the unit is in the caller's unit set for the key.
-- In RLS, wrap it as (select nexus.has_permission('x')) so it runs once per statement.
create function nexus.has_permission(p_key text, p_unit_id uuid default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from nexus._member_grants(nexus.current_member_id()) g
    where g.permission_key = p_key
      and (g.unit_id is null or g.unit_id = p_unit_id)
  )
$$;

-- Unit ids where the caller holds p_key with a unit scope (empty when none or when the caller has
-- "all"). RLS pattern for unit-scoped tables, evaluated once per statement:
--   (select nexus.has_permission('minutes.view'))
--   or org_unit_id = any ((select nexus.permission_unit_ids('minutes.view')))
create function nexus.permission_unit_ids(p_key text)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(g.unit_id order by g.unit_id), '{}'::uuid[])
  from nexus._member_grants(nexus.current_member_id()) g
  where g.permission_key = p_key and g.unit_id is not null
$$;

-- The caller's effective permissions, for menus and Dashboard cards (A-n1). Fixed rights (own
-- requests L9, settings for admins L3) are not keys; read them from my_context().
create function nexus.my_permissions()
returns table (permission_key text, scope text, unit_ids uuid[], is_sensitive boolean)
language sql stable security definer set search_path = ''
as $$
  select g.permission_key,
         case when bool_or(g.unit_id is null) then 'all' else 'units' end,
         case when bool_or(g.unit_id is null) then '{}'::uuid[]
              else array_agg(g.unit_id order by g.unit_id) end,
         pk.is_sensitive
  from nexus._member_grants(nexus.current_member_id()) g
  join nexus.permissions pk on pk.key = g.permission_key
  group by g.permission_key, pk.is_sensitive, pk.sort_order
  order by pk.sort_order, g.permission_key
$$;

-- L6 helper for the future letter-request and borrowing tables: the approval key never applies to
-- the caller's own request, whatever the rules say (AC-12, AC-24, AC-57). Invoker is enough: it only
-- combines other helpers.
create function nexus.can_process_request(p_key text, p_requester_member_id uuid)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select p_key in ('letter_requests.process', 'borrowing.approve')
     and p_requester_member_id is not null
     and p_requester_member_id is distinct from nexus.current_member_id()
     and nexus.has_permission(p_key)
$$;

-- =============================================================================================
-- 6. Guards and change log on the rules table. Triggers fire for every normal writer: the RPCs, the
--    SQL editor, and the service role, so L5/L11/L12 and "every change is logged" hold for hand edits
--    too (R10). Limit: the table owner (`postgres`, i.e. anyone with dashboard access) can disable
--    triggers, so this is tamper-evident against API roles, not tamper-proof against the owner.
-- =============================================================================================

-- Trims a change note, turns blank into null, and rejects an over-long note with a friendly hint
-- (instead of a raw check-constraint error). Used by every RPC that accepts p_note.
create function nexus._clean_note(p_note text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
begin
  if char_length(v_note) > 500 then
    raise exception 'The note is too long (max 500 characters)'
      using errcode = '22023', hint = 'note_too_long';
  end if;
  return v_note;
end
$$;

create function nexus._access_rules_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_allow_baseline boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Access rules are never deleted; disable the rule instead'
      using errcode = '42501', hint = 'rule_no_delete';
  end if;

  -- Null when the key is unknown; the foreign key then rejects the row with its own error.
  select pk.allow_baseline into v_allow_baseline
  from nexus.permissions pk where pk.key = new.permission_key;

  if tg_op = 'INSERT' then
    new.note := nullif(btrim(new.note), '');
    -- L12 (D-013): enforced here so even a direct SQL-editor insert is rejected, not only the RPC.
    if new.subject_type = 'all_members' and v_allow_baseline is false then
      raise exception 'Permission % can never be granted to every active member (locked rule L12)', new.permission_key
        using errcode = '22023', hint = 'baseline_not_allowed';
    end if;
    if v_allow_baseline is false and new.note is null then
      raise exception 'Granting % needs a written reason (note); locked rule L12', new.permission_key
        using errcode = '22023', hint = 'note_required';
    end if;
    new.created_at := now();
    new.created_by := nexus.current_member_id();
    new.updated_at := new.created_at;
    new.updated_by := new.created_by;
    return new;
  end if;

  -- UPDATE: only the enabled switch may change (A-n8: change = disable + add new).
  if (new.id, new.subject_type, new.role_key, new.position_id, new.org_unit_id, new.include_child_units,
      new.permission_key, new.scope, new.note, new.default_code, new.created_at, new.created_by)
     is distinct from
     (old.id, old.subject_type, old.role_key, old.position_id, old.org_unit_id, old.include_child_units,
      old.permission_key, old.scope, old.note, old.default_code, old.created_at, old.created_by) then
    raise exception 'Access rules are not edited in place; disable this rule and add a new one'
      using errcode = '42501', hint = 'rule_immutable';
  end if;
  -- L12 also on re-enable, in case a later migration locks a key that an old baseline rule uses.
  if new.is_enabled and not old.is_enabled
     and new.subject_type = 'all_members' and v_allow_baseline is false then
    raise exception 'Permission % can never be granted to every active member (locked rule L12)', new.permission_key
      using errcode = '22023', hint = 'baseline_not_allowed';
  end if;
  if new.is_enabled is distinct from old.is_enabled then
    new.updated_at := now();
    new.updated_by := nexus.current_member_id();
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end
$$;

-- Writes one log row per add / enable / disable / seed / restore. The calling function announces
-- the action and note through transaction-local settings; a hand edit without them is still logged
-- (as add/enable/disable with actor null and session_role = the editing role).
create function nexus._access_rules_log_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ctx    text := nullif(current_setting('nexus.rule_action', true), '');
  v_note   text := nullif(current_setting('nexus.change_note', true), '');
  v_actor  uuid := nexus.current_member_id();
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := case when v_ctx in ('seed', 'restore_default') then v_ctx else 'add' end;
  elsif new.is_enabled is distinct from old.is_enabled then
    v_action := case
      when new.is_enabled and v_ctx = 'restore_default' then 'restore_default'
      when new.is_enabled then 'enable'
      else 'disable'
    end;
  else
    return null;  -- nothing that changes access happened
  end if;

  insert into nexus.access_rule_log (
    rule_id, action, actor_member_id, actor_name, permission_key, subject_label,
    is_sensitive, is_self_benefit, before_data, after_data, note
  ) values (
    new.id,
    v_action,
    v_actor,
    (select m.full_name from public.members m where m.id = v_actor),
    new.permission_key,
    nexus._rule_subject_label(new.subject_type, new.role_key, new.position_id, new.org_unit_id, new.include_child_units),
    coalesce((select pk.is_sensitive from nexus.permissions pk where pk.key = new.permission_key), false),
    -- B28 (2)(b): a grant (rule is now enabled) whose subject matches the actor's own active-period
    -- assignments, or a baseline rule (the actor is an active member too).
    new.is_enabled and v_actor is not null
      and exists (select 1 from nexus._rule_matches(v_actor, false, false) x where x.rule_id = new.id),
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new),
    -- RPCs pass the trimmed change note; a hand-written INSERT falls back to the rule's own note.
    coalesce(v_note, case when tg_op = 'INSERT' then new.note end)
  );
  return null;
end
$$;

-- L11 / L5: log rows cannot be edited, deleted, or truncated by any API role or ordinary hand edit.
-- (The owner could disable this trigger; see the section 6 header and supabase/README.md.)
create function nexus._append_only_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception '% is append-only / never deleted (%)', tg_table_name, tg_op
    using errcode = '42501', hint = 'append_only';
end
$$;

create trigger access_rules_10_guard
  before insert or update or delete on nexus.access_rules
  for each row execute function nexus._access_rules_guard();
create trigger access_rules_20_log
  after insert or update on nexus.access_rules
  for each row execute function nexus._access_rules_log_change();
create trigger access_rules_no_truncate
  before truncate on nexus.access_rules
  for each statement execute function nexus._append_only_guard();

create trigger access_rule_log_no_change
  before update or delete on nexus.access_rule_log
  for each row execute function nexus._append_only_guard();
create trigger access_rule_log_no_truncate
  before truncate on nexus.access_rule_log
  for each statement execute function nexus._append_only_guard();

-- =============================================================================================
-- 7. Rule management RPCs (System Admin only: L3, L11). SECURITY DEFINER so the rules table itself
--    can stay closed to every client write (RLS has no write policies, no write grants).
--    Errors carry a stable `hint` the backend maps to a message:
--      not_system_admin, invalid_subject_type, invalid_subject_fields, unknown_permission,
--      baseline_not_allowed, scope_not_allowed, role_missing, position_missing, unit_missing,
--      unit_inactive, position_not_in_unit, sensitive_confirmation_required, note_required,
--      note_too_long, duplicate_rule, rule_not_found, defaults_not_seeded
-- =============================================================================================

create function nexus._require_system_admin()
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not nexus.is_system_admin() then
    raise exception 'Only a NEXUS System Admin can do this'
      using errcode = '42501', hint = 'not_system_admin';
  end if;
end
$$;

create function nexus.add_access_rule(
  p_subject_type        text,
  p_permission_key      text,
  p_scope               text    default 'all',
  p_role_key            text    default null,
  p_position_id         uuid    default null,
  p_org_unit_id         uuid    default null,
  p_include_child_units boolean default false,
  p_note                text    default null,
  p_confirm_sensitive   boolean default false
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_sensitive      boolean;
  v_allow_baseline boolean;
  v_existing       uuid;
  v_enabled        boolean;
  v_unit_ok        boolean;
  v_id             uuid;
begin
  perform nexus._require_system_admin();
  p_include_child_units := coalesce(p_include_child_units, false);
  p_scope := coalesce(p_scope, 'all');
  p_note := nexus._clean_note(p_note);  -- trimmed, blank -> null, too long -> note_too_long

  -- L10 / AC-61: only these four subject types exist; any per-person subject is rejected.
  if p_subject_type is null or p_subject_type not in ('role', 'position', 'org_unit', 'all_members') then
    raise exception 'Rules target a role, a position, an org unit, or every active member; never an individual member'
      using errcode = '22023', hint = 'invalid_subject_type';
  end if;

  select pk.is_sensitive, pk.allow_baseline into v_sensitive, v_allow_baseline
  from nexus.permissions pk where pk.key = p_permission_key;
  if not found then
    raise exception 'Unknown permission key: %', p_permission_key
      using errcode = '22023', hint = 'unknown_permission';
  end if;

  -- L12 (D-013): checked before anything else about the rule, so the message is the real reason.
  -- The trigger on nexus.access_rules repeats this check for hand-written SQL.
  if p_subject_type = 'all_members' and not v_allow_baseline then
    raise exception 'Permission % can never be granted to every active member (locked rule L12)', p_permission_key
      using errcode = '22023', hint = 'baseline_not_allowed';
  end if;

  if not exists (select 1 from nexus.permission_scopes s
                 where s.permission_key = p_permission_key and s.scope = p_scope)
     or (p_subject_type = 'all_members' and p_scope <> 'all') then
    raise exception 'Scope % is not allowed for % on this subject', p_scope, p_permission_key
      using errcode = '22023', hint = 'scope_not_allowed';
  end if;

  -- Fields that do not belong to the chosen subject type must be empty (no silent ignoring).
  if (p_subject_type = 'role'        and (p_role_key is null or p_position_id is not null or p_org_unit_id is not null or p_include_child_units))
  or (p_subject_type = 'position'    and (p_position_id is null or p_role_key is not null or p_org_unit_id is not null or p_include_child_units))
  or (p_subject_type = 'org_unit'    and (p_org_unit_id is null or p_role_key is not null))
  or (p_subject_type = 'all_members' and (p_role_key is not null or p_position_id is not null or p_org_unit_id is not null or p_include_child_units)) then
    raise exception 'Subject fields do not match subject type %', p_subject_type
      using errcode = '22023', hint = 'invalid_subject_fields';
  end if;

  -- The subject must exist in PI-CORE now (spec 5 "validation on add").
  if p_subject_type = 'role'
     and not exists (select 1 from public.roles ro where ro.key = p_role_key) then
    raise exception 'No PI-CORE role with key %', p_role_key using errcode = '22023', hint = 'role_missing';
  end if;
  if p_position_id is not null
     and not exists (select 1 from public.positions po where po.id = p_position_id) then
    raise exception 'PI-CORE position not found' using errcode = '22023', hint = 'position_missing';
  end if;
  if p_subject_type = 'org_unit' then
    select u.is_active into v_unit_ok from public.org_units u where u.id = p_org_unit_id;
    if not found then
      raise exception 'PI-CORE org unit not found' using errcode = '22023', hint = 'unit_missing';
    elsif not v_unit_ok then
      raise exception 'PI-CORE org unit is inactive' using errcode = '22023', hint = 'unit_inactive';
    end if;
    if p_position_id is not null
       and not nexus._position_fits_unit(p_position_id, p_org_unit_id, p_include_child_units) then
      raise exception 'That position cannot be held in this unit (or its child units)'
        using errcode = '22023', hint = 'position_not_in_unit';
    end if;
  end if;

  -- AC-63: sensitive grants need an explicit confirmation, also on the API, not only in the UI.
  if v_sensitive and not coalesce(p_confirm_sensitive, false) then
    raise exception 'Permission % is sensitive; confirm to save', p_permission_key
      using errcode = 'P0001', hint = 'sensitive_confirmation_required';
  end if;

  -- L12 (D-013): sensitive and power keys need a written reason, so the log explains every grant.
  if not v_allow_baseline and p_note is null then
    raise exception 'Granting % needs a written reason (note)', p_permission_key
      using errcode = '22023', hint = 'note_required';
  end if;

  -- AC-65: friendly duplicate message (the unique index is the real guard against races).
  select r.id, r.is_enabled into v_existing, v_enabled
  from nexus.access_rules r
  where (r.subject_type, r.role_key, r.position_id, r.org_unit_id, r.include_child_units, r.permission_key, r.scope)
        is not distinct from
        (p_subject_type, p_role_key, p_position_id, p_org_unit_id, p_include_child_units, p_permission_key, p_scope);
  if found then
    raise exception 'This rule already exists%', case when v_enabled then '' else ' (disabled: enable it instead)' end
      using errcode = '23505', hint = 'duplicate_rule', detail = v_existing::text;
  end if;

  perform set_config('nexus.rule_action', 'add', true);
  perform set_config('nexus.change_note', coalesce(p_note, ''), true);

  insert into nexus.access_rules (
    subject_type, role_key, position_id, org_unit_id, include_child_units, permission_key, scope, note
  ) values (
    p_subject_type, p_role_key, p_position_id, p_org_unit_id, p_include_child_units, p_permission_key, p_scope,
    p_note
  )
  returning id into v_id;

  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);
  return v_id;
end
$$;

-- Returns false when the rule was already disabled (nothing logged).
create function nexus.disable_access_rule(p_rule_id uuid, p_note text default null)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  perform nexus._require_system_admin();
  p_note := nexus._clean_note(p_note);  -- removing access never needs a reason, but keep it tidy
  select r.is_enabled into v_enabled from nexus.access_rules r where r.id = p_rule_id for update;
  if not found then
    raise exception 'Access rule not found' using errcode = 'P0002', hint = 'rule_not_found';
  end if;
  if not v_enabled then
    return false;
  end if;
  perform set_config('nexus.rule_action', 'disable', true);
  perform set_config('nexus.change_note', coalesce(p_note, ''), true);
  update nexus.access_rules set is_enabled = false where id = p_rule_id;
  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);
  return true;
end
$$;

-- Returns false when the rule was already enabled (nothing logged).
create function nexus.enable_access_rule(p_rule_id uuid, p_note text default null, p_confirm_sensitive boolean default false)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_enabled        boolean;
  v_sensitive      boolean;
  v_allow_baseline boolean;
begin
  perform nexus._require_system_admin();
  p_note := nexus._clean_note(p_note);
  select r.is_enabled, pk.is_sensitive, pk.allow_baseline into v_enabled, v_sensitive, v_allow_baseline
  from nexus.access_rules r
  join nexus.permissions pk on pk.key = r.permission_key
  where r.id = p_rule_id
  for update of r;
  if not found then
    raise exception 'Access rule not found' using errcode = 'P0002', hint = 'rule_not_found';
  end if;
  if v_enabled then
    return false;
  end if;
  if v_sensitive and not coalesce(p_confirm_sensitive, false) then
    raise exception 'This rule grants a sensitive permission; confirm to enable it'
      using errcode = 'P0001', hint = 'sensitive_confirmation_required';
  end if;
  -- L12: re-granting a sensitive or power key is a grant like any other; it needs a reason.
  if not v_allow_baseline and p_note is null then
    raise exception 'Enabling this rule needs a written reason (note)'
      using errcode = '22023', hint = 'note_required';
  end if;
  perform set_config('nexus.rule_action', 'enable', true);
  perform set_config('nexus.change_note', coalesce(p_note, ''), true);
  update nexus.access_rules set is_enabled = true where id = p_rule_id;
  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);
  return true;
end
$$;

-- B28 (1)(a): re-enables every DISABLED default rule (D01-D31). Rules are never deleted and their
-- content never changes, so a "missing" default can only be a disabled one. Custom rules are never
-- touched. Returns the number of rules restored. Stale defaults come back stale (flagged on screen);
-- nothing is re-looked-up by name (D-009).
create function nexus.restore_default_access_rules(p_note text default null, p_confirm_sensitive boolean default false)
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
       where r.default_code is not null and not r.is_enabled and pk.is_sensitive) then
    raise exception 'Restoring defaults re-enables sensitive rules; confirm to continue'
      using errcode = 'P0001', hint = 'sensitive_confirmation_required';
  end if;
  -- L12: a reason is needed when the restore re-grants any sensitive or power key.
  if p_note is null and exists (
       select 1 from nexus.access_rules r
       join nexus.permissions pk on pk.key = r.permission_key
       where r.default_code is not null and not r.is_enabled and not pk.allow_baseline) then
    raise exception 'Restoring defaults re-enables sensitive or power rules; give a written reason (note)'
      using errcode = '22023', hint = 'note_required';
  end if;

  perform set_config('nexus.rule_action', 'restore_default', true);
  perform set_config('nexus.change_note', coalesce(p_note, ''), true);
  update nexus.access_rules set is_enabled = true
  where default_code is not null and not is_enabled;
  get diagnostics v_count = row_count;
  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);
  return v_count;
end
$$;

-- =============================================================================================
-- 8. Admin screen reads (System Admin only) and pickers
-- =============================================================================================

-- Every rule (enabled and disabled) with current PI-CORE names, stale reason, and how many active
-- members the rule matches right now (for a disabled rule: would match if enabled). Counts only,
-- never member names (spec 5).
create function nexus.list_access_rules()
returns table (
  id                  uuid,
  subject_type        text,
  role_key            text,
  role_name           text,
  position_id         uuid,
  position_name       text,
  position_unit_type  text,
  org_unit_id         uuid,
  org_unit_name       text,
  include_child_units boolean,
  subject_label       text,
  permission_key      text,
  permission_label    text,
  is_sensitive        boolean,
  scope               text,
  is_enabled          boolean,
  default_code        text,
  note                text,
  stale_reason        text,
  matching_members    integer,
  created_at          timestamptz,
  created_by          uuid,
  created_by_name     text,
  updated_at          timestamptz,
  updated_by          uuid,
  updated_by_name     text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform nexus._require_system_admin();
  return query
  with counts as (
    select x.rule_id, count(distinct x.member_id)::int as n
    from nexus._rule_matches(null, true, true) x
    group by x.rule_id
  )
  select
    r.id, r.subject_type, r.role_key, ro.name, r.position_id, po.name, po.unit_type::text,
    r.org_unit_id, u.name, r.include_child_units,
    nexus._rule_subject_label(r.subject_type, r.role_key, r.position_id, r.org_unit_id, r.include_child_units),
    r.permission_key, pk.label, pk.is_sensitive, r.scope, r.is_enabled, r.default_code, r.note,
    nexus._rule_stale_reason(r.subject_type, r.role_key, r.position_id, r.org_unit_id, r.include_child_units),
    coalesce(c.n, 0),
    r.created_at, r.created_by, cm.full_name, r.updated_at, r.updated_by, um.full_name
  from nexus.access_rules r
  join nexus.permissions pk on pk.key = r.permission_key
  left join public.roles ro on ro.key = r.role_key
  left join public.positions po on po.id = r.position_id
  left join public.org_units u on u.id = r.org_unit_id
  left join counts c on c.rule_id = r.id
  left join public.members cm on cm.id = r.created_by
  left join public.members um on um.id = r.updated_by
  order by pk.sort_order, r.permission_key, r.is_enabled desc, r.created_at;
end
$$;

-- "Nobody can use it" warnings (spec 5, AC-64, A-n9). Live: reflects the active period, so a warning
-- appears after a period switch without any rule edit. None of these four keys is implied by another
-- key, so counting direct rule matches is exact.
create function nexus.access_rule_warnings()
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
           ('borrowing.approve', true, 4)
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

-- Role picker (S1). Roles without a key are returned but marked not targetable (B30).
-- DEFINER + admin check: PI-CORE only shows all roles to its own admins.
create function nexus.list_rule_roles()
returns table (role_key text, name text, description text, is_targetable boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform nexus._require_system_admin();
  return query
  select ro.key, ro.name, ro.description, ro.key is not null
  from public.roles ro
  order by ro.sort_order, ro.name;
end
$$;

-- Position and unit pickers (rules screen now, minutes unit picker later). INVOKER: PI-CORE RLS
-- already shows the structure to every active member. The explicit current_member_id() filter
-- enforces L1 here too, so these stay empty for inactive/unlinked users even if PI-CORE ever opens
-- the structure tables wider.
create function nexus.list_positions()
returns table (id uuid, name text, unit_type text, rank integer)
language sql stable security invoker set search_path = ''
as $$
  select po.id, po.name, po.unit_type::text, po.rank
  from public.positions po
  where (select nexus.current_member_id()) is not null
  order by po.rank, po.unit_type, po.name
$$;

create function nexus.list_org_units()
returns table (id uuid, parent_id uuid, type text, name text, sort_order integer, is_active boolean)
language sql stable security invoker set search_path = ''
as $$
  select u.id, u.parent_id, u.type::text, u.name, u.sort_order, u.is_active
  from public.org_units u
  where (select nexus.current_member_id()) is not null
  order by u.sort_order, u.name
$$;

-- =============================================================================================
-- 9. Function privileges: revoke from PUBLIC/anon/service_role everywhere, then grant the client
--    API to authenticated only. service_role gets no EXECUTE: it has no auth.uid(), so every check
--    would deny anyway, and server code must call these with the USER's session (README section 3).
-- =============================================================================================

revoke all on function
  nexus.current_member_id(),
  nexus.is_system_admin(),
  nexus.active_period_id(),
  nexus.is_active_period(uuid),
  nexus.my_context(),
  nexus.has_permission(text, uuid),
  nexus.permission_unit_ids(text),
  nexus.my_permissions(),
  nexus.can_process_request(text, uuid),
  nexus.add_access_rule(text, text, text, text, uuid, uuid, boolean, text, boolean),
  nexus.disable_access_rule(uuid, text),
  nexus.enable_access_rule(uuid, text, boolean),
  nexus.restore_default_access_rules(text, boolean),
  nexus.list_access_rules(),
  nexus.access_rule_warnings(),
  nexus.list_rule_roles(),
  nexus.list_positions(),
  nexus.list_org_units()
from public, anon, service_role;

grant execute on function
  nexus.current_member_id(),
  nexus.is_system_admin(),
  nexus.active_period_id(),
  nexus.is_active_period(uuid),
  nexus.my_context(),
  nexus.has_permission(text, uuid),
  nexus.permission_unit_ids(text),
  nexus.my_permissions(),
  nexus.can_process_request(text, uuid),
  nexus.add_access_rule(text, text, text, text, uuid, uuid, boolean, text, boolean),
  nexus.disable_access_rule(uuid, text),
  nexus.enable_access_rule(uuid, text, boolean),
  nexus.restore_default_access_rules(text, boolean),
  nexus.list_access_rules(),
  nexus.access_rule_warnings(),
  nexus.list_rule_roles(),
  nexus.list_positions(),
  nexus.list_org_units()
to authenticated;

-- Internals: callable only by the owner (i.e. from the SECURITY DEFINER functions above).
revoke all on function
  nexus._unit_and_descendants(uuid),
  nexus._position_fits_unit(uuid, uuid, boolean),
  nexus._rule_matches(uuid, boolean, boolean),
  nexus._member_grants(uuid),
  nexus._rule_subject_label(text, text, uuid, uuid, boolean),
  nexus._rule_stale_reason(text, text, uuid, uuid, boolean),
  nexus._require_system_admin(),
  nexus._clean_note(text),
  nexus._access_rules_guard(),
  nexus._access_rules_log_change(),
  nexus._append_only_guard()
from public, anon, authenticated, service_role;

-- =============================================================================================
-- 10. Table privileges and Row Level Security (default deny; SELECT policies only; no client writes)
-- =============================================================================================

revoke all on nexus.permissions, nexus.permission_scopes, nexus.access_rules, nexus.access_rule_log
  from public, anon, authenticated, service_role;

grant select on nexus.permissions, nexus.permission_scopes, nexus.access_rules, nexus.access_rule_log
  to authenticated;
-- Server-only key: SELECT only (ops/backups). It bypasses RLS (Supabase default), so it reads every
-- row, but it has no INSERT/UPDATE/DELETE/TRUNCATE and no EXECUTE on nexus functions.
grant select on nexus.permissions, nexus.permission_scopes, nexus.access_rules, nexus.access_rule_log
  to service_role;

alter table nexus.permissions       enable row level security;
alter table nexus.permission_scopes enable row level security;
alter table nexus.access_rules      enable row level security;
alter table nexus.access_rule_log   enable row level security;

-- Catalog: any active member (labels for menus). Inactive/unlinked users read nothing (L1).
create policy permissions_select on nexus.permissions for select to authenticated
  using ((select nexus.current_member_id()) is not null);
create policy permission_scopes_select on nexus.permission_scopes for select to authenticated
  using ((select nexus.current_member_id()) is not null);

-- Rules: System Admin only (L3, AC-01). BPH reads the log, not the rules table (AC-60).
create policy access_rules_select on nexus.access_rules for select to authenticated
  using ((select nexus.is_system_admin()));

-- Log: System Admin always (L3), plus holders of access_rules.view_log (default role bph, D14).
create policy access_rule_log_select on nexus.access_rule_log for select to authenticated
  using ((select nexus.is_system_admin()) or (select nexus.has_permission('access_rules.view_log')));

-- No INSERT/UPDATE/DELETE policies on any table: writes happen only inside the SECURITY DEFINER
-- functions (owner bypasses RLS) and are additionally guarded by the triggers in section 6
-- (which the owner, and only the owner, could disable).

-- =============================================================================================
-- 11. Permission catalog data (spec 2.1). Code-owned keys; never renamed.
-- =============================================================================================

-- View keys first so includes_key / requires_key references resolve.
-- allow_baseline (L12, D-013): true ONLY for keys that are safe for every active member. Stricter than
-- the L12 floor on purpose: *.view_all, borrowing.export and access_rules.view_log are also locked,
-- because they show other members' requests or the admins' activity.
insert into nexus.permissions (key, module, label, description, is_sensitive, allow_baseline, includes_key, requires_key, sort_order) values
  ('finance.view',             'finance',         'View Finance',                 'See transactions, balances, Finance dashboard card.',                                   true,  false, null,                       null,                       10),
  ('finance.manage',           'finance',         'Manage Finance',               'Create, edit (active period), void transactions. Includes view.',                       true,  false, 'finance.view',             null,                       11),
  ('finance.export',           'finance',         'Export Finance',               'Export Finance to Excel/CSV/PDF. Needs view.',                                          true,  false, null,                       'finance.view',             12),
  ('minutes.view',             'minutes',         'View meeting minutes',         'Read meeting minutes and their attachments.',                                           false, true,  null,                       null,                       20),
  ('minutes.manage',           'minutes',         'Manage meeting minutes',       'Create, edit (active period), archive minutes, upload attachments. Includes view.',     false, false, 'minutes.view',             null,                       21),
  ('minutes.export',           'minutes',         'Export meeting minutes',       'Export minutes. Needs view.',                                                           false, true,  null,                       'minutes.view',             22),
  ('letters.view',             'letters',         'View letter register',         'Read the letter register (incoming and outgoing).',                                     false, true,  null,                       null,                       30),
  ('letters.manage',           'letters',         'Manage letters',               'Create/edit letters, assign numbers, archive. Includes view.',                          false, false, 'letters.view',             null,                       31),
  ('letters.export',           'letters',         'Export letter register',       'Export the letter register. Needs view.',                                               false, true,  null,                       'letters.view',             32),
  ('letter_requests.view_all', 'letter_requests', 'View all letter requests',     'See everybody''s letter requests (own requests are always visible).',                   false, false, null,                       null,                       40),
  ('letter_requests.process',  'letter_requests', 'Process letter requests',      'Approve, reject, issue a number. Includes view_all. Never own requests.',               false, false, 'letter_requests.view_all', null,                       41),
  ('inventory.view',           'inventory',       'View inventory',               'Read the inventory catalog.',                                                           false, true,  null,                       null,                       50),
  ('inventory.manage',         'inventory',       'Manage inventory',             'Create, edit, archive items. Includes view.',                                           false, false, 'inventory.view',           null,                       51),
  ('inventory.export',         'inventory',       'Export inventory',             'Export inventory. Needs view.',                                                         false, true,  null,                       'inventory.view',           52),
  ('borrowing.view_all',       'borrowing',       'View all borrowing requests',  'See everybody''s borrowing requests (own requests are always visible).',                false, false, null,                       null,                       60),
  ('borrowing.approve',        'borrowing',       'Approve borrowing',            'Approve/reject, mark borrowed/returned. Includes view_all. Never own requests.',        false, false, 'borrowing.view_all',       null,                       61),
  ('borrowing.export',         'borrowing',       'Export borrowing',             'Export borrowing. Needs view_all.',                                                     false, false, null,                       'borrowing.view_all',       62),
  ('member_data.view',         'member_data',     'View Member Data',             'Member list: name, unit, position, active/inactive. Never email, phone, NIM, NIP.',     true,  false, null,                       null,                       70),
  ('member_data.export',       'member_data',     'Export Member Data',           'Export the same list. Needs view.',                                                     true,  false, null,                       'member_data.view',         71),
  ('access_rules.view_log',    'access_rules',    'Read access-rule change log',  'Read the access-rule change log (B24).',                                                false, false, null,                       null,                       80);

-- Every key allows "all"; only minutes.* allow unit scopes (D-008, B26 option b).
insert into nexus.permission_scopes (permission_key, scope)
select pk.key, 'all' from nexus.permissions pk;
insert into nexus.permission_scopes (permission_key, scope)
select pk.key, s.scope
from nexus.permissions pk
cross join (values ('own_unit'), ('own_unit_and_children')) as s(scope)
where pk.module = 'minutes';

-- Ask PostgREST to pick up the new schema objects (harmless if `nexus` is not exposed yet).
notify pgrst, 'reload schema';
