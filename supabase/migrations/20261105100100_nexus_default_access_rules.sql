-- PMK-NEXUS 0002: default access rules D01-D31 (docs/modules/access-control.md section 3).
--
-- Positions and the Operations unit are looked up BY NAME exactly once, here, and stored as ids
-- (D-009, D-011). Role subjects store roles.key (stable), not the role id. After this migration
-- nothing in NEXUS matches by name.
--
-- If any lookup fails (names differ on this database, open question A3) the migration RAISES and
-- inserts nothing. The engine from 20261105100000 then runs with zero rules = safe baseline-only world
-- (locked rules still hold). Fix the names below with the owner, then run this file again.
--
-- Reads PI-CORE (public.roles, public.positions, public.org_units); writes ONLY nexus.access_rules
-- (and, through its trigger, nexus.access_rule_log with action 'seed').
-- L12 (D-013): the trigger on nexus.access_rules rejects any rule for a sensitive or power key without
-- a note, and any such key on 'all_members'. Every row below therefore carries a non-empty note, and
-- the only baseline rule (D01, inventory.view) uses a baseline-safe key.
--
-- Before running this on the hosted project, run the read-only name check in supabase/README.md
-- (section 2, step 4). Run as ONE transaction (see supabase/README.md).

do $$
declare
  v_missing  text[];
  v_count    integer;
  v_sekjen   uuid;
  v_sekum1   uuid;
  v_sekum2   uuid;
  v_ops_unit uuid;
begin
  if exists (select 1 from nexus.access_rules r where r.default_code is not null) then
    raise notice 'NEXUS default access rules already seeded; nothing to do.';
    return;
  end if;

  -- Role keys are stored as text, but fail fast if PI-CORE does not have them.
  select array_agg(k.key) into v_missing
  from unnest(array['bph', 'bendahara', 'sekretaris']) as k(key)
  where not exists (select 1 from public.roles ro where ro.key = k.key);
  if v_missing is not null then
    raise exception 'NEXUS seed: PI-CORE role key(s) not found: %', array_to_string(v_missing, ', ')
      using hint = 'Check public.roles.key on this database (expected seed from PI-CORE migration 20261101100100).';
  end if;

  -- BPH secretary positions (D-008). Positions are unique per (unit_type, lower(btrim(name))).
  select count(*), (array_agg(po.id))[1] into v_count, v_sekjen
  from public.positions po
  where po.unit_type = 'bph' and lower(btrim(po.name)) = lower('Sekretaris Jenderal');
  if v_count <> 1 then
    raise exception 'NEXUS seed: expected exactly 1 BPH position "Sekretaris Jenderal", found %', v_count;
  end if;

  select count(*), (array_agg(po.id))[1] into v_count, v_sekum1
  from public.positions po
  where po.unit_type = 'bph' and lower(btrim(po.name)) = lower('Sekretaris Umum 1');
  if v_count <> 1 then
    raise exception 'NEXUS seed: expected exactly 1 BPH position "Sekretaris Umum 1", found %', v_count;
  end if;

  select count(*), (array_agg(po.id))[1] into v_count, v_sekum2
  from public.positions po
  where po.unit_type = 'bph' and lower(btrim(po.name)) = lower('Sekretaris Umum 2');
  if v_count <> 1 then
    raise exception 'NEXUS seed: expected exactly 1 BPH position "Sekretaris Umum 2", found %', v_count;
  end if;

  -- Operations department (D-009, B4). Include-child-units covers Logistik and Akomodasi (B26).
  select count(*), (array_agg(u.id))[1] into v_count, v_ops_unit
  from public.org_units u
  where u.type = 'department' and lower(btrim(u.name)) = lower('Departemen Operasional') and u.is_active;
  if v_count <> 1 then
    raise exception 'NEXUS seed: expected exactly 1 active department "Departemen Operasional", found %', v_count;
  end if;

  -- Tell the log trigger this is the seed (actor null, action 'seed').
  perform set_config('nexus.rule_action', 'seed', true);
  perform set_config('nexus.change_note', 'Default rule set, docs/modules/access-control.md section 3 (D-012)', true);

  insert into nexus.access_rules
    (default_code, subject_type, role_key, position_id, org_unit_id, include_child_units, permission_key, scope, note)
  values
    -- Baseline (B8)
    ('D01', 'all_members', null,         null,     null,       false, 'inventory.view',           'all',      'G7: read-only catalog to pick items (B8)'),
    -- BPH views and exports (B6, B9, B24)
    ('D02', 'role',        'bph',        null,     null,       false, 'finance.view',             'all',      'BPH views Finance (B6)'),
    ('D03', 'role',        'bph',        null,     null,       false, 'finance.export',           'all',      'BPH export'),
    ('D04', 'role',        'bph',        null,     null,       false, 'minutes.view',             'all',      'BPH views all minutes'),
    ('D05', 'role',        'bph',        null,     null,       false, 'minutes.export',           'all',      'BPH export'),
    ('D06', 'role',        'bph',        null,     null,       false, 'letters.view',             'all',      'BPH views the letter register'),
    ('D07', 'role',        'bph',        null,     null,       false, 'letters.export',           'all',      'BPH export'),
    ('D08', 'role',        'bph',        null,     null,       false, 'letter_requests.view_all', 'all',      'BPH views all letter requests'),
    ('D09', 'role',        'bph',        null,     null,       false, 'inventory.export',         'all',      'BPH export'),
    ('D10', 'role',        'bph',        null,     null,       false, 'borrowing.view_all',       'all',      'BPH views all borrowing'),
    ('D11', 'role',        'bph',        null,     null,       false, 'borrowing.export',         'all',      'BPH export'),
    ('D12', 'role',        'bph',        null,     null,       false, 'member_data.view',         'all',      'Member Data: BPH only (B9 a)'),
    ('D13', 'role',        'bph',        null,     null,       false, 'member_data.export',       'all',      'Member Data export (B9 a)'),
    ('D14', 'role',        'bph',        null,     null,       false, 'access_rules.view_log',    'all',      'BPH reads the rule change log (B24)'),
    -- BPH secretaries (D-008)
    ('D15', 'position',    null,         v_sekjen, null,       false, 'letters.manage',           'all',      'Sekretaris Jenderal (D-008)'),
    ('D16', 'position',    null,         v_sekjen, null,       false, 'letter_requests.process',  'all',      'Sekretaris Jenderal (D-008)'),
    ('D17', 'position',    null,         v_sekjen, null,       false, 'minutes.manage',           'all',      'Sekretaris Jenderal (D-008)'),
    ('D18', 'position',    null,         v_sekum1, null,       false, 'letters.manage',           'all',      'Sekretaris Umum 1 (D-008)'),
    ('D19', 'position',    null,         v_sekum1, null,       false, 'letter_requests.process',  'all',      'Sekretaris Umum 1 (D-008)'),
    ('D20', 'position',    null,         v_sekum1, null,       false, 'minutes.manage',           'all',      'Sekretaris Umum 1 (D-008)'),
    ('D21', 'position',    null,         v_sekum2, null,       false, 'letters.manage',           'all',      'Sekretaris Umum 2 (D-008)'),
    ('D22', 'position',    null,         v_sekum2, null,       false, 'letter_requests.process',  'all',      'Sekretaris Umum 2 (D-008)'),
    ('D23', 'position',    null,         v_sekum2, null,       false, 'minutes.manage',           'all',      'Sekretaris Umum 2 (D-008)'),
    -- Treasurer (B3)
    ('D24', 'role',        'bendahara',  null,     null,       false, 'finance.manage',           'all',      'Treasurer (B3)'),
    ('D25', 'role',        'bendahara',  null,     null,       false, 'finance.export',           'all',      'Treasurer export, independent of D03'),
    -- Department/bureau secretaries, own unit only (D-008, B17, B22)
    ('D26', 'role',        'sekretaris', null,     null,       false, 'minutes.manage',           'own_unit', 'Department/bureau secretary, own unit (D-008)'),
    ('D27', 'role',        'sekretaris', null,     null,       false, 'minutes.export',           'own_unit', 'Department/bureau secretary export, own unit (A-n2)'),
    -- Operations: Departemen Operasional + child divisions, any position (D-009, B4, B26)
    ('D28', 'org_unit',    null,         null,     v_ops_unit, true,  'inventory.manage',         'all',      'Operations (B4)'),
    ('D29', 'org_unit',    null,         null,     v_ops_unit, true,  'inventory.export',         'all',      'Operations export'),
    ('D30', 'org_unit',    null,         null,     v_ops_unit, true,  'borrowing.approve',        'all',      'Operations approve, mark borrowed/returned'),
    ('D31', 'org_unit',    null,         null,     v_ops_unit, true,  'borrowing.export',         'all',      'Operations export');

  get diagnostics v_count = row_count;
  -- (Notes above are deliberately all non-empty: 23 of the 31 rules use keys that require one, L12.)
  if v_count <> 31 then
    raise exception 'NEXUS seed: expected 31 default rules, inserted %', v_count;
  end if;

  perform set_config('nexus.rule_action', '', true);
  perform set_config('nexus.change_note', '', true);

  raise notice 'NEXUS seed: 31 default access rules inserted (Sekjen %, Sekum1 %, Sekum2 %, Operasional %).',
    v_sekjen, v_sekum1, v_sekum2, v_ops_unit;
end
$$;
