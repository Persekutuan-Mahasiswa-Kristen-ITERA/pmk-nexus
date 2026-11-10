-- PMK-NEXUS 0013: Meeting Minutes / Notulensi Rapat module (minutes, files, history, reads, export).
--
-- Spec:      docs/modules/meeting-minutes.md (APPROVED 2026-11-09, all recommendations accepted: N1 b,
--            N2 c, N3 a, N4 a, N5 a, N6 a, N7 a): sections 2, 3 (F1-F7), 4, 5 (R1-R16), 8, 9 (A-MN1..A-MN18),
--            11 (MN-01..MN-30). docs/modules/access-control.md: keys minutes.view / minutes.manage /
--            minutes.export (catalog of 20261105100000), default rules D04, D05, D17, D20, D23, D26, D27 and
--            D37 (20261111100000); locked rules L1, L4, L5, L7, L8, L11, L12; R11, R15, E9.
-- Decisions: D-008 (owning unit, secretary scopes), D-010, D-011, D-013, D-019 (export-log pattern),
--            D-026 (fast mode), D-027 (Meeting Minutes rules).
-- PI-CORE:   verified against docs/picore/schema-report.md (pi-core-v2 migrations 20261031165546 ..
--            20261102090000, HEAD d8b6814, unchanged). Read here, only inside nexus functions:
--            members(id, full_name) for names, org_units(id, type, name, sort_order, is_active) for the unit
--            (read live, A-MN12), periods(id, label, starts_on, ends_on, is_active) through the existing
--            helpers and for labels. No contact or identity-number column (L4). No foreign key to PI-CORE.
--
-- Stored values are English identifiers; the UI maps them to Indonesian:
--   minute status   active = Aktif, voided = Dibatalkan (never restored, A-MN15)
--   history kind    recorded, edited, file_added, file_withdrawn ("Ditarik"), voided
--
-- Scope (spec 2): every read and write is limited to the caller's unit set for the key: scope "all"
-- (BPH D04/D05, BPH secretaries D17/D20/D23) or the units of the matching assignments (D26, D27, D37).
-- has_permission(key, unit) and permission_unit_ids(key) of the engine are the only source; manage
-- includes view, export works only where view also holds (R15, done by the engine).
--
-- Security model (same as Letters):
--   * Every write goes through a SECURITY DEFINER function below (search_path = ''). Clients have NO
--     insert/update/delete privilege; tables have SELECT grants with RLS (default deny) as a second,
--     read-only door. The export log has no client grant at all.
--   * Each function checks L1 (active linked member), the key with its unit scope, the active period
--     (R11) and L7 (a minute of a non-active period, or a voided minute, is read-only).
--   * Edits, files and void lock the minute row and compare its version ("Data sudah berubah").
--   * Nothing is ever deleted (L5): no DELETE or TRUNCATE on any table (trigger); history and export
--     log are append-only; unit, period and creator never change (trigger).
--
-- Files (spec 4.4, N6 a): private bucket `nexus-minute-files` (20261111100200). Upload path
-- "<uploader members.id>/<random uuid>.<pdf|jpg|jpeg|png>", uploaded when picked, BEFORE the minute
-- exists; the save function attaches files of the caller's OWN folder only. PDF, JPG, PNG, 5 MB each,
-- at most 3 visible files per minute. The magic-byte check is done by the server code before upload
-- (like Letters); the database checks the Storage metadata where Storage is installed.
--
-- Decisions where the spec was silent (minor, fast mode D-026; none changes a right or retention):
--   M1  Units a minute may be recorded for (N2 c): an ACTIVE PI-CORE unit of type organization ("Seluruh
--       organisasi"), bph, department or bureau, and inside the caller's minutes.manage scope.
--       Unit not in scope -> unit_not_allowed (42501); division, inactive or unknown -> invalid_unit.
--   M2  Title and topic are one line: inner whitespace (also line breaks) collapses to one space.
--       Content and decision keep their line breaks (CRLF becomes LF), only outer whitespace is trimmed.
--   M3  History rows of withdrawn files and the withdraw reason are visible to managers of the unit only
--       (RLS on minute_history and the detail), following A-MN7 "withdrawn files are visible to
--       managers only". File names in the history are resolved through the file's own read rule.
--   M4  Only minutes.manage holders may upload into the bucket (no other member ever attaches a file).
--   M5  Export refuses more than 1000 matching rows in the DATABASE (too_many_rows) before any log row is
--       written, so a refused export never leaves a log row (spec 8 / D-022 row guard; the server still
--       compares total_count with the rows it received).
--   M6  A single-minute export (A-MN8) ignores the list filters except the caller's export scope; a minute
--       outside the scope answers minute_not_found and writes no log row.
--   M7  The unit filter of the list is silent: a unit outside the scope returns no rows (R13), no error.
--
-- Errors carry a stable hint (errcode): permission_required, unit_not_allowed, not_active_member,
-- closed_period, immutable_column, export_log_direct_insert, append_only (42501); minute_not_found,
-- file_not_found (P0002); no_active_period, state_changed, minute_voided, file_missing, too_many_rows
-- (P0001); invalid_unit, invalid_input, text_required, text_too_long, reason_required, date_required,
-- date_in_future, invalid_dates, invalid_file, file_too_large, file_required, file_count,
-- file_already_attached, invalid_status, invalid_period, search_too_long, invalid_page,
-- invalid_page_size, invalid_format (22023). `detail` names the field, a count or a path; never a person.
--
-- Re-runnable: create ... if not exists / or replace, guarded policies. Run as ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261111100100_nexus_minutes.sql
-- Requires 20261105100000 .. 20261111100000 (uses nexus._require_permission from 20261106200000,
-- nexus._jakarta_date from 20261107100100 and the null-safe is_active_period of 20261111100000).

-- =============================================================================================
-- 1. Tables. Every minute and history row carries a period (the active period at the time).
-- =============================================================================================

-- 1.1 Minutes (spec 4.1). org_unit_id and period_id are PI-CORE ids (no FK, access control 7.2).
create table if not exists nexus.minutes (
  id           uuid primary key default gen_random_uuid(),
  org_unit_id  uuid not null,
  period_id    uuid not null,
  meeting_date date not null check (meeting_date >= date '2000-01-01' and isfinite(meeting_date)),
  title        text not null check (title = btrim(title) and char_length(title) between 1 and 150),
  topic        text not null check (topic = btrim(topic) and char_length(topic) between 1 and 200),
  content      text not null check (char_length(content) between 1 and 20000 and content !~ '^\s' and content !~ '\s$'),
  decision     text check (decision is null or (char_length(decision) between 1 and 5000 and decision !~ '^\s' and decision !~ '\s$')),
  status       text not null default 'active' check (status in ('active', 'voided')),
  void_reason  text check (void_reason is null or (void_reason = btrim(void_reason) and char_length(void_reason) between 1 and 500)),
  voided_by    uuid,
  voided_at    timestamptz,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  created_by   uuid not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  constraint minutes_void check ((status = 'voided') = (void_reason is not null and voided_by is not null and voided_at is not null))
);
create index if not exists minutes_list_idx on nexus.minutes (meeting_date desc, created_at desc, id desc);
create index if not exists minutes_unit_period_idx on nexus.minutes (org_unit_id, period_id);
create index if not exists minutes_period_idx on nexus.minutes (period_id, status);

-- 1.2 Files of a minute (spec 4.4). One row = one stored object. Never deleted; withdrawn with a reason.
create table if not exists nexus.minute_files (
  id              bigint generated always as identity primary key,
  minute_id       uuid not null references nexus.minutes (id),
  storage_path    text not null unique
                  check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'),
  original_name   text not null check (original_name = btrim(original_name) and char_length(original_name) between 1 and 200),
  size_bytes      integer check (size_bytes is null or size_bytes between 1 and 5242880),
  mime_type       text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  attached_by     uuid not null,
  attached_at     timestamptz not null default now(),
  is_withdrawn    boolean not null default false,
  withdrawn_by    uuid,
  withdrawn_at    timestamptz,
  withdraw_reason text check (withdraw_reason is null or (withdraw_reason = btrim(withdraw_reason) and char_length(withdraw_reason) between 1 and 500)),
  constraint minute_files_withdrawn check (is_withdrawn = (withdrawn_by is not null and withdrawn_at is not null and withdraw_reason is not null))
);
create index if not exists minute_files_minute_idx on nexus.minute_files (minute_id);

-- 1.3 History (spec 4.1, A-MN7): recorded, each edit (before/after of the changed fields), file added /
-- withdrawn, void. Append-only.
create table if not exists nexus.minute_history (
  id              bigint generated always as identity primary key,
  minute_id       uuid not null references nexus.minutes (id),
  kind            text not null check (kind in ('recorded', 'edited', 'file_added', 'file_withdrawn', 'voided')),
  before_data     jsonb check (before_data is null or jsonb_typeof(before_data) = 'object'),
  after_data      jsonb check (after_data is null or jsonb_typeof(after_data) = 'object'),
  note            text check (note is null or char_length(note) between 1 and 500),
  file_id         bigint references nexus.minute_files (id),
  actor_member_id uuid not null,
  occurred_at     timestamptz not null default now(),
  period_id       uuid not null
);
create index if not exists minute_history_minute_idx on nexus.minute_history (minute_id, id desc);

-- 1.4 Export log (F6, MN-27): one row per SUCCESSFUL export. Ids and settings only: no names, no search
-- text, no exported rows. minute_id is set for a single-minute export (A-MN8).
create table if not exists nexus.minute_export_logs (
  id                 bigint generated always as identity primary key,
  exporter_member_id uuid not null,
  created_at         timestamptz not null default now(),
  format             text not null check (format in ('xlsx', 'csv', 'pdf')),
  filters            jsonb not null check (jsonb_typeof(filters) = 'object'),
  minute_id          uuid references nexus.minutes (id),
  row_count          integer not null check (row_count >= 0),
  period_id          uuid not null
);
create index if not exists minute_export_logs_created_idx on nexus.minute_export_logs (created_at desc, id desc);

comment on table nexus.minutes is 'Meeting minutes (D-027). One owning unit, period at saving. Never deleted; voided with a reason. Written only by nexus.minute_* functions.';
comment on table nexus.minute_files is 'Files of minutes (bucket nexus-minute-files). Never deleted; withdrawn with a reason.';
comment on table nexus.minute_history is 'Append-only minute history (recorded, edited with before/after, files, void).';
comment on table nexus.minute_export_logs is 'Minutes export log (F6). Append-only, no PII. Written only by minute_export(); no client grant.';

-- =============================================================================================
-- 2. Guard triggers (they fire for every writer: the functions, the SQL editor, the service role).
--    The owner could disable them (tamper-evident, not tamper-proof; supabase/README.md section 6).
-- =============================================================================================

create or replace function nexus._mn_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'minutes' then
    -- R1/A-MN4/MN-11: unit, period and creator never change.
    if (new.id, new.org_unit_id, new.period_id, new.created_at, new.created_by)
       is distinct from (old.id, old.org_unit_id, old.period_id, old.created_at, old.created_by) then
      raise exception 'The unit, period and creator of a minute never change' using errcode = '42501', hint = 'immutable_column';
    end if;
    -- 4.2: a voided minute is read-only and never restored.
    if old.status = 'voided' then
      raise exception 'A voided minute is read-only' using errcode = '42501', hint = 'immutable_column';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
  elsif tg_table_name = 'minute_files' then
    -- Only the withdraw columns may change, once (no replace, no un-withdraw).
    if (new.id, new.minute_id, new.storage_path, new.original_name, new.size_bytes, new.mime_type,
        new.attached_by, new.attached_at)
       is distinct from
       (old.id, old.minute_id, old.storage_path, old.original_name, old.size_bytes, old.mime_type,
        old.attached_by, old.attached_at)
       or old.is_withdrawn then
      raise exception 'A stored file is never replaced; withdraw it instead' using errcode = '42501', hint = 'immutable_column';
    end if;
  end if;
  return new;
end
$$;

-- Only minute_export() writes the export log.
create or replace function nexus._mn_export_log_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('nexus.export_log_writer', true), '') is distinct from 'minute_export' then
    raise exception 'minute_export_logs is written only by minute_export()'
      using errcode = '42501', hint = 'export_log_direct_insert';
  end if;
  new.created_at := now();
  return new;
end
$$;

do $$
declare
  t text;
begin
  -- L5: no table of this module can lose a row.
  foreach t in array array['minutes', 'minute_files'] loop
    execute format('create or replace trigger %I before delete on nexus.%I for each row execute function nexus._append_only_guard()',
                   t || '_no_delete', t);
    execute format('create or replace trigger %I before truncate on nexus.%I for each statement execute function nexus._append_only_guard()',
                   t || '_no_truncate', t);
    execute format('create or replace trigger %I before update on nexus.%I for each row execute function nexus._mn_guard()',
                   t || '_10_guard', t);
  end loop;
  foreach t in array array['minute_history', 'minute_export_logs'] loop
    execute format('create or replace trigger %I before update or delete on nexus.%I for each row execute function nexus._append_only_guard()',
                   t || '_no_change', t);
    execute format('create or replace trigger %I before truncate on nexus.%I for each statement execute function nexus._append_only_guard()',
                   t || '_no_truncate', t);
  end loop;
end
$$;

create or replace trigger minute_export_logs_10_insert_guard
  before insert on nexus.minute_export_logs
  for each row execute function nexus._mn_export_log_guard();

-- =============================================================================================
-- 3. Privileges and Row Level Security. Default deny; SELECT-only policies; no client writes.
-- =============================================================================================

do $$
declare
  t text;
begin
  foreach t in array array['minutes', 'minute_files', 'minute_history', 'minute_export_logs'] loop
    execute format('revoke all on nexus.%I from public, anon, authenticated, service_role', t);
    execute format('alter table nexus.%I enable row level security', t);
    execute format('grant select on nexus.%I to service_role', t);
    if t <> 'minute_export_logs' then
      execute format('grant select on nexus.%I to authenticated', t);
    end if;
  end loop;
end
$$;
revoke all on sequence nexus.minute_files_id_seq, nexus.minute_history_id_seq, nexus.minute_export_logs_id_seq
  from public, anon, authenticated, service_role;

-- Policies. Each (select ...) runs once per statement. Child tables go through the parent (whose own
-- RLS applies inside EXISTS). Withdrawn files and their history rows: managers of the unit only (M3).
do $$
declare
  v_policies text[][] := array[
    array['minutes', 'minutes_select',
          '(select nexus.has_permission(''minutes.view'')) or org_unit_id = any ((select nexus.permission_unit_ids(''minutes.view''))::uuid[])'],
    array['minute_files', 'minute_files_select',
          'exists (select 1 from nexus.minutes m where m.id = minute_files.minute_id and (not minute_files.is_withdrawn or (select nexus.has_permission(''minutes.manage'')) or m.org_unit_id = any ((select nexus.permission_unit_ids(''minutes.manage''))::uuid[])))'],
    array['minute_history', 'minute_history_select',
          'exists (select 1 from nexus.minutes m where m.id = minute_history.minute_id and (minute_history.kind <> ''file_withdrawn'' or (select nexus.has_permission(''minutes.manage'')) or m.org_unit_id = any ((select nexus.permission_unit_ids(''minutes.manage''))::uuid[])))']
  ];
  i int;
begin
  for i in 1 .. array_length(v_policies, 1) loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'nexus' and p.tablename = v_policies[i][1] and p.policyname = v_policies[i][2]) then
      execute format('create policy %I on nexus.%I for select to authenticated using (%s)',
                     v_policies[i][2], v_policies[i][1], v_policies[i][3]);
    end if;
  end loop;
end
$$;
-- minute_export_logs: no policy and no client grant (database only until the log screen exists).

-- =============================================================================================
-- 4. Internal helpers (no EXECUTE for clients). Own small copies, so this module stays self-contained.
-- =============================================================================================

-- R14: "today" is the Asia/Jakarta calendar date.
create or replace function nexus._mn_today()
returns date
language sql stable set search_path = ''
as $$ select nexus._jakarta_date(now()) $$;

create or replace function nexus._mn_require_member()
returns uuid
language plpgsql stable set search_path = ''
as $$
declare
  v_member uuid := nexus.current_member_id();
begin
  if v_member is null then
    raise exception 'Only an active NEXUS member can do this' using errcode = '42501', hint = 'not_active_member';
  end if;
  return v_member;
end
$$;

-- R4/R11: no minute is recorded or changed without an active period.
create or replace function nexus._mn_require_active_period()
returns uuid
language plpgsql stable set search_path = ''
as $$
declare
  v_period uuid := nexus.active_period_id();
begin
  if v_period is null then
    raise exception 'There is no active period' using errcode = 'P0001', hint = 'no_active_period';
  end if;
  return v_period;
end
$$;

-- The caller's scope for a key: o_all = scope "all"; o_units = units of a unit scope (empty with "all").
create or replace function nexus._mn_scope(p_key text, out o_all boolean, out o_units uuid[])
language sql stable set search_path = ''
as $$ select nexus.has_permission(p_key), nexus.permission_unit_ids(p_key) $$;

-- Gate of every API function: the key in ANY scope, else permission_required (like _require_permission,
-- which only knows scope "all").
create or replace function nexus._mn_require_scope(p_key text, out o_all boolean, out o_units uuid[])
language plpgsql stable set search_path = ''
as $$
begin
  select s.o_all, s.o_units into o_all, o_units from nexus._mn_scope(p_key) s;
  if not o_all and cardinality(o_units) = 0 then
    raise exception 'Missing NEXUS permission %', p_key
      using errcode = '42501', hint = 'permission_required', detail = p_key;
  end if;
end
$$;

-- One-line text (title, topic, reasons, M2): whitespace collapsed, trimmed, blank -> null.
create or replace function nexus._mn_text(p_text text, p_max integer, p_field text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := nullif(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), '');
begin
  if char_length(v) > p_max then
    raise exception 'Text for % is too long (max % characters)', p_field, p_max
      using errcode = '22023', hint = 'text_too_long', detail = p_field;
  end if;
  return v;
end
$$;

-- Multi-line text (content, decision, M2): CRLF -> LF, outer whitespace trimmed, blank -> null.
create or replace function nexus._mn_long_text(p_text text, p_max integer, p_field text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := nullif(regexp_replace(replace(coalesce(p_text, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g'), '');
begin
  if char_length(v) > p_max then
    raise exception 'Text for % is too long (max % characters)', p_field, p_max
      using errcode = '22023', hint = 'text_too_long', detail = p_field;
  end if;
  return v;
end
$$;

create or replace function nexus._mn_required(p_value text, p_field text, p_hint text)
returns text
language plpgsql immutable set search_path = ''
as $$
begin
  if p_value is null then
    raise exception 'Text for % is required', p_field using errcode = '22023', hint = p_hint, detail = p_field;
  end if;
  return p_value;
end
$$;

-- R9/A-MN5: the meeting date is required, a real date from 2000 on, and not after today (Jakarta).
create or replace function nexus._mn_check_meeting_date(p_date date)
returns date
language plpgsql stable set search_path = ''
as $$
begin
  if p_date is null then
    raise exception 'The meeting date is required' using errcode = '22023', hint = 'date_required', detail = 'meeting_date';
  end if;
  if not isfinite(p_date) or p_date < date '2000-01-01' then
    raise exception 'The meeting date is not a valid date' using errcode = '22023', hint = 'invalid_dates', detail = 'meeting_date';
  end if;
  if p_date > nexus._mn_today() then
    raise exception 'The meeting date cannot be after today' using errcode = '22023', hint = 'date_in_future', detail = 'meeting_date';
  end if;
  return p_date;
end
$$;

-- Search text: trimmed, inner whitespace collapsed, max 120 (raw max 480). ILIKE pattern with %, _ and \
-- escaped, or null for "no search".
create or replace function nexus._mn_search_pattern(p_search text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text;
begin
  if char_length(p_search) > 480 then
    raise exception 'Search text is too long (max 120 characters)' using errcode = '22023', hint = 'search_too_long';
  end if;
  v := nullif(regexp_replace(btrim(coalesce(p_search, '')), '\s+', ' ', 'g'), '');
  if char_length(v) > 120 then
    raise exception 'Search text is too long (max 120 characters)' using errcode = '22023', hint = 'search_too_long';
  end if;
  if v is null then
    return null;
  end if;
  return '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%';
end
$$;

create or replace function nexus._mn_check_page(p_page integer, p_page_size integer)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_page is null or p_page < 1 then
    raise exception 'Page must be 1 or higher' using errcode = '22023', hint = 'invalid_page';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 50 then
    raise exception 'Page size must be between 1 and 50' using errcode = '22023', hint = 'invalid_page_size';
  end if;
end
$$;

create or replace function nexus._mn_export_format(p_format text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := lower(btrim(p_format));
begin
  if v is null or v not in ('xlsx', 'csv', 'pdf') then
    raise exception 'Export format must be xlsx, csv or pdf' using errcode = '22023', hint = 'invalid_format';
  end if;
  return v;
end
$$;

-- F1 filters: period "active" (default) or "all"; status "active" (default, A-MN6), "voided", "all".
create or replace function nexus._mn_period_filter(p_period text)
returns boolean   -- true = all periods
language plpgsql immutable set search_path = ''
as $$
declare
  v text := coalesce(nullif(lower(btrim(p_period)), ''), 'active');
begin
  if v not in ('active', 'all') then
    raise exception 'Period filter must be active or all' using errcode = '22023', hint = 'invalid_period';
  end if;
  return v = 'all';
end
$$;

create or replace function nexus._mn_status_filter(p_status text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := coalesce(nullif(lower(btrim(p_status)), ''), 'active');
begin
  if v not in ('all', 'active', 'voided') then
    raise exception 'Status filter must be active, voided or all' using errcode = '22023', hint = 'invalid_status';
  end if;
  return v;
end
$$;

-- Spec 8 / D-022 row guard (M5).
create or replace function nexus._mn_export_cap()
returns integer
language sql immutable set search_path = ''
as $$ select 1000 $$;

-- Current PI-CORE name. Name only (L4).
create or replace function nexus._mn_member_name(p_member_id uuid)
returns text
language sql stable set search_path = ''
as $$ select m.full_name from public.members m where m.id = p_member_id $$;

-- N2 c / M1: a unit a NEW minute may belong to: active, and the root, BPH, a department or the bureau.
create or replace function nexus._mn_is_recordable_unit(p_unit_id uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (select 1 from public.org_units u
                 where u.id = p_unit_id and u.is_active
                   and u.type::text in ('organization', 'bph', 'department', 'bureau'))
$$;

-- Files given to a save function: p_files = [{"path": "<members.id>/<uuid>.pdf", "name": "notulen.pdf"}].
-- Same checks as Letters: count, shape, the caller's OWN folder, not attached before, and (where Storage
-- is installed) the object exists with an allowed type matching the extension and at most 5 MB.
create or replace function nexus._mn_check_files(p_files jsonb, p_member uuid, p_min integer, p_max integer)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_out   jsonb := '[]'::jsonb;
  v_e     jsonb;
  v_path  text;
  v_name  text;
  v_ext   text;
  v_want  text;
  v_size  bigint;
  v_mime  text;
  v_n     integer;
  v_seen  text[] := '{}';
  v_count integer := 0;
begin
  if p_files is not null and jsonb_typeof(p_files) <> 'null' then
    if jsonb_typeof(p_files) <> 'array' then
      raise exception 'Files must be a list' using errcode = '22023', hint = 'invalid_file', detail = 'p_files';
    end if;
    v_count := jsonb_array_length(p_files);
  end if;
  if v_count < p_min then
    raise exception 'Add at least % file(s)', p_min using errcode = '22023', hint = 'file_required', detail = p_min::text;
  end if;
  if v_count > p_max then
    raise exception 'At most % file(s) can be added here', p_max using errcode = '22023', hint = 'file_count', detail = greatest(p_max, 0)::text;
  end if;
  if v_count = 0 then
    return v_out;
  end if;

  for v_e in select e from jsonb_array_elements(p_files) e loop
    if jsonb_typeof(v_e) <> 'object'
       or jsonb_typeof(v_e -> 'path') is distinct from 'string'
       or jsonb_typeof(v_e -> 'name') is distinct from 'string' then
      raise exception 'Each file needs a path and a name' using errcode = '22023', hint = 'invalid_file', detail = 'p_files';
    end if;
    v_path := v_e ->> 'path';
    if v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'
       or split_part(v_path, '/', 1) <> p_member::text then
      raise exception 'Invalid file path' using errcode = '22023', hint = 'invalid_file', detail = v_path;
    end if;
    if v_path = any (v_seen) then
      raise exception 'A file is listed twice' using errcode = '22023', hint = 'invalid_file', detail = v_path;
    end if;
    v_seen := v_seen || v_path;
    v_name := btrim(v_e ->> 'name');
    if v_name = '' or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
      raise exception 'Invalid file name' using errcode = '22023', hint = 'invalid_file', detail = 'name';
    end if;
    if exists (select 1 from nexus.minute_files f where f.storage_path = v_path) then
      raise exception 'This file is already attached' using errcode = '22023', hint = 'file_already_attached', detail = v_path;
    end if;
    v_ext := substring(v_path from '\.([a-z]+)$');
    v_want := case v_ext when 'pdf' then 'application/pdf' when 'png' then 'image/png' else 'image/jpeg' end;
    v_size := null;
    v_mime := null;
    -- Without the storage schema (local stack with Storage off, bare test image) there are no objects.
    if to_regclass('storage.objects') is not null then
      execute 'select (o.metadata ->> ''size'')::bigint, o.metadata ->> ''mimetype''
               from storage.objects o where o.bucket_id = $1 and o.name = $2'
        into v_size, v_mime using 'nexus-minute-files', v_path;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        raise exception 'The file was not uploaded' using errcode = 'P0001', hint = 'file_missing', detail = v_path;
      end if;
      if v_size is not null and v_size > 5242880 then
        raise exception 'The file is larger than 5 MB' using errcode = '22023', hint = 'file_too_large', detail = v_path;
      end if;
      if (v_size is not null and v_size < 1) or (v_mime is not null and v_mime <> v_want) then
        raise exception 'Unsupported or empty file' using errcode = '22023', hint = 'invalid_file', detail = v_path;
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('path', v_path, 'name', v_name, 'size', v_size, 'mime', v_want));
  end loop;
  return v_out;
end
$$;

-- History row. Actor and period from the session.
create or replace function nexus._mn_log(p_minute_id uuid, p_kind text, p_before jsonb, p_after jsonb, p_note text, p_file_id bigint)
returns void
language sql volatile set search_path = ''
as $$
  insert into nexus.minute_history (minute_id, kind, before_data, after_data, note, file_id, actor_member_id, period_id)
  values (p_minute_id, p_kind, p_before, p_after, p_note, p_file_id, nexus.current_member_id(), nexus.active_period_id())
$$;

-- Stores the checked files on a minute, one history row per file. The file name is NOT copied into the
-- history (it is resolved through the file's read rule, M3).
create or replace function nexus._mn_attach_files(p_minute_id uuid, p_files jsonb)
returns integer
language plpgsql volatile set search_path = ''
as $$
declare
  v_e  jsonb;
  v_id bigint;
  v_n  integer := 0;
begin
  for v_e in select e from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) e loop
    insert into nexus.minute_files (minute_id, storage_path, original_name, size_bytes, mime_type, attached_by)
    values (p_minute_id, v_e ->> 'path', v_e ->> 'name', (v_e ->> 'size')::integer, v_e ->> 'mime', nexus.current_member_id())
    returning id into v_id;
    perform nexus._mn_log(p_minute_id, 'file_added', null, null, null, v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

create or replace function nexus._mn_visible_file_count(p_minute_id uuid)
returns integer
language sql stable set search_path = ''
as $$ select count(*)::int from nexus.minute_files f where f.minute_id = p_minute_id and not f.is_withdrawn $$;

-- Lock one minute for an action; a minute the caller may not read answers "not found", exactly like a
-- missing id; a stale version answers state_changed.
create or replace function nexus._mn_lock_minute(p_minute_id uuid, p_version integer)
returns nexus.minutes
language plpgsql volatile set search_path = ''
as $$
declare
  v_m nexus.minutes;
begin
  select m.* into v_m from nexus.minutes m where m.id = p_minute_id for update;
  if not found or not nexus.has_permission('minutes.view', v_m.org_unit_id) then
    raise exception 'Minute not found' using errcode = 'P0002', hint = 'minute_not_found';
  end if;
  if p_version is null or p_version <> v_m.version then
    raise exception 'The minute changed in the meantime; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  return v_m;
end
$$;

-- F4/F5/L7: a change needs manage on the minute's unit, an Aktif minute, and the ACTIVE period.
create or replace function nexus._mn_require_editable(p_m nexus.minutes)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not nexus.has_permission('minutes.manage', p_m.org_unit_id) then
    raise exception 'Missing NEXUS permission minutes.manage for this unit'
      using errcode = '42501', hint = 'permission_required', detail = 'minutes.manage';
  end if;
  if p_m.status <> 'active' then
    raise exception 'A voided minute is read-only' using errcode = 'P0001', hint = 'minute_voided';
  end if;
  if not nexus.is_active_period(p_m.period_id) then
    raise exception 'A minute of a previous period is read-only' using errcode = '42501', hint = 'closed_period';
  end if;
end
$$;

-- Read rule for one stored file (spec 4.4, AC-48): whoever may read the parent minute; a withdrawn
-- file only a manager of that unit. Used by the detail and the Storage SELECT policy.
create or replace function nexus._mn_can_read_file(p_file_id bigint)
returns boolean
language plpgsql stable set search_path = ''
as $$
declare
  v_unit      uuid;
  v_withdrawn boolean;
begin
  if nexus.current_member_id() is null then
    return false;
  end if;
  select m.org_unit_id, f.is_withdrawn into v_unit, v_withdrawn
  from nexus.minute_files f join nexus.minutes m on m.id = f.minute_id
  where f.id = p_file_id;
  if not found or not nexus.has_permission('minutes.view', v_unit) then
    return false;
  end if;
  return not v_withdrawn or nexus.has_permission('minutes.manage', v_unit);
end
$$;

-- Shared row builder (list, export, Dashboard): the SAME rows, filters and order, so they never
-- disagree (R13). Scope first: p_all or the unit set. A given p_minute_id ignores the list filters (M6).
-- Order (A-MN6): meeting date newest first, then newest recorded.
create or replace function nexus._mn_rows(
  p_all boolean, p_units uuid[], p_search text, p_unit_id uuid, p_all_periods boolean, p_period_id uuid,
  p_status text, p_minute_id uuid)
returns table (
  ordinal bigint, minute_id uuid, org_unit_id uuid, unit_name text, unit_type text, meeting_date date,
  title text, topic text, content text, decision text, status text, void_reason text, voided_at timestamptz,
  period_id uuid, period_label text, file_count integer, created_at timestamptz, created_by_name text,
  version integer
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_pattern text := nexus._mn_search_pattern(p_search);
begin
  return query
  with base as (
    select m.*,
           (select count(*)::int from nexus.minute_files f where f.minute_id = m.id and not f.is_withdrawn) as fc
    from nexus.minutes m
    where (p_all or m.org_unit_id = any (p_units))
      and (p_minute_id is null or m.id = p_minute_id)
      and (p_minute_id is not null or (
            (p_unit_id is null or m.org_unit_id = p_unit_id)
            and (p_all_periods or m.period_id = p_period_id)
            and (p_status = 'all' or m.status = p_status)
            and (v_pattern is null
                 or m.title ilike v_pattern escape '\'
                 or m.topic ilike v_pattern escape '\'
                 or m.content ilike v_pattern escape '\')))
  )
  select row_number() over (order by b.meeting_date desc, b.created_at desc, b.id desc),
         b.id, b.org_unit_id, u.name, u.type::text, b.meeting_date, b.title, b.topic, b.content, b.decision,
         b.status, b.void_reason, b.voided_at, b.period_id, p.label, b.fc, b.created_at, cm.full_name, b.version
  from base b
  left join public.org_units u on u.id = b.org_unit_id
  left join public.periods p on p.id = b.period_id
  left join public.members cm on cm.id = b.created_by;
end
$$;

-- =============================================================================================
-- 5. Reads (minutes.view in any scope: BPH all D04, secretaries own unit via manage D26, heads D37)
-- =============================================================================================

-- 5.1 Units for the filter and the record form (F1, F3, screen 3). can_read = in the view scope
-- (filter offered when more than one); can_record = recordable (M1) and in the manage scope. Readers
-- with "all" also get units that already hold minutes (e.g. a unit deactivated later, A-MN17).
create or replace function nexus.minute_unit_options()
returns table (unit_id uuid, unit_name text, unit_type text, sort_order integer, is_active boolean, can_read boolean, can_record boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_view   record;
  v_manage record;
begin
  select * into v_view from nexus._mn_require_scope('minutes.view');
  select * into v_manage from nexus._mn_scope('minutes.manage');
  return query
  with cand as (
    select u.id from public.org_units u
    where v_view.o_all and u.is_active and u.type::text in ('organization', 'bph', 'department', 'bureau')
    union
    select m.org_unit_id from nexus.minutes m where v_view.o_all
    union
    select x from unnest(v_view.o_units) x
    union
    select x from unnest(v_manage.o_units) x
  )
  select u.id, u.name, u.type::text, u.sort_order, u.is_active,
         v_view.o_all or u.id = any (v_view.o_units),
         (v_manage.o_all or u.id = any (v_manage.o_units)) and nexus._mn_is_recordable_unit(u.id)
  from cand c
  join public.org_units u on u.id = c.id
  order by case u.type::text when 'organization' then 0 when 'bph' then 1 else 2 end, u.sort_order, u.name;
end
$$;

-- 5.2 List (F1, screen 1). p_period active (default) / all; p_status active (default) / voided / all;
-- p_unit_id optional (outside the scope = no rows, M7). Page size 1..50 (default 20); past the end =
-- the last page. No content column (too large for a list; the detail has it).
create or replace function nexus.minute_list(
  p_search    text    default null,
  p_unit_id   uuid    default null,
  p_period    text    default 'active',
  p_status    text    default 'active',
  p_page      integer default 1,
  p_page_size integer default 20
)
returns table (
  row_no bigint, minute_id uuid, org_unit_id uuid, unit_name text, unit_type text, meeting_date date,
  title text, topic text, status text, period_id uuid, period_label text, file_count integer,
  created_at timestamptz, version integer, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_scope  record;
  v_all    boolean;
  v_status text;
begin
  select * into v_scope from nexus._mn_require_scope('minutes.view');
  v_all := nexus._mn_period_filter(p_period);
  v_status := nexus._mn_status_filter(p_status);
  perform nexus._mn_check_page(p_page, p_page_size);
  return query
  with
  o as (select * from nexus._mn_rows(v_scope.o_all, v_scope.o_units, p_search, p_unit_id, v_all,
                                     nexus.active_period_id(), v_status, null)),
  t as (select count(*) as n from o),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select o.ordinal, o.minute_id, o.org_unit_id, o.unit_name, o.unit_type, o.meeting_date, o.title, o.topic,
         o.status, o.period_id, o.period_label, o.file_count, o.created_at, o.version, t.n, pg.pno, p_page_size
  from o cross join t cross join pg
  where o.ordinal > (pg.pno - 1)::bigint * p_page_size and o.ordinal <= pg.pno::bigint * p_page_size
  order by o.ordinal;
end
$$;

-- 5.3 Detail (F2, screen 2) as one JSON object: fields, files the caller may read (withdrawn ones only
-- for managers of the unit), history newest first (before/after for edits; withdraw rows only for
-- managers, M3), and `actions` = which buttons exist for this caller now (writes re-check everything).
create or replace function nexus.minute_detail(p_minute_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_m        nexus.minutes;
  v_manage   boolean;
  v_editable boolean;
  v_files    integer;
  v_history  jsonb;
  v_files_js jsonb;
begin
  perform nexus._mn_require_scope('minutes.view');
  select m.* into v_m from nexus.minutes m where m.id = p_minute_id;
  if not found or not nexus.has_permission('minutes.view', v_m.org_unit_id) then
    raise exception 'Minute not found' using errcode = 'P0002', hint = 'minute_not_found';
  end if;
  v_manage := nexus.has_permission('minutes.manage', v_m.org_unit_id);
  v_editable := v_manage and v_m.status = 'active' and nexus.is_active_period(v_m.period_id);
  v_files := nexus._mn_visible_file_count(v_m.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'file_id', f.id, 'storage_path', f.storage_path, 'original_name', f.original_name,
           'size_bytes', f.size_bytes, 'mime_type', f.mime_type, 'attached_at', f.attached_at,
           'attached_by_name', nexus._mn_member_name(f.attached_by),
           'is_withdrawn', f.is_withdrawn, 'withdrawn_at', f.withdrawn_at,
           'withdrawn_by_name', case when f.is_withdrawn then nexus._mn_member_name(f.withdrawn_by) end,
           'withdraw_reason', f.withdraw_reason)
           order by f.id), '[]'::jsonb)
  into v_files_js
  from nexus.minute_files f
  where f.minute_id = v_m.id and (not f.is_withdrawn or v_manage);

  select coalesce(jsonb_agg(jsonb_build_object(
           'history_id', h.id, 'at', h.occurred_at, 'kind', h.kind, 'actor_name', nexus._mn_member_name(h.actor_member_id),
           'before', h.before_data, 'after', h.after_data, 'note', h.note,
           'file_name', (select f.original_name from nexus.minute_files f
                         where f.id = h.file_id and (not f.is_withdrawn or v_manage)))
           order by h.id desc), '[]'::jsonb)
  into v_history
  from nexus.minute_history h
  where h.minute_id = v_m.id and (h.kind <> 'file_withdrawn' or v_manage);

  return jsonb_build_object(
    'minute_id', v_m.id, 'org_unit_id', v_m.org_unit_id,
    'unit_name', (select u.name from public.org_units u where u.id = v_m.org_unit_id),
    'unit_type', (select u.type::text from public.org_units u where u.id = v_m.org_unit_id),
    'meeting_date', v_m.meeting_date, 'title', v_m.title, 'topic', v_m.topic, 'content', v_m.content,
    'decision', v_m.decision, 'status', v_m.status,
    'void_reason', v_m.void_reason, 'voided_at', v_m.voided_at, 'voided_by_name', nexus._mn_member_name(v_m.voided_by),
    'period_id', v_m.period_id, 'period_label', (select p.label from public.periods p where p.id = v_m.period_id),
    'is_active_period', nexus.is_active_period(v_m.period_id),
    'created_at', v_m.created_at, 'created_by_name', nexus._mn_member_name(v_m.created_by),
    'updated_at', v_m.updated_at, 'updated_by_name', nexus._mn_member_name(v_m.updated_by),
    'version', v_m.version,
    'file_count', v_files,
    'files', v_files_js,
    'history', v_history,
    'actions', jsonb_build_object(
      'can_edit', v_editable,
      'can_void', v_editable,
      'can_add_files', v_editable and v_files < 3,
      'can_withdraw_files', v_editable and v_files > 0,
      'files_room', case when v_editable then greatest(3 - v_files, 0) else 0 end,
      'can_export', nexus.has_permission('minutes.export', v_m.org_unit_id)));
end
$$;

-- 5.4 Header tiles and Dashboard card (A-MN13, N5 a): Aktif minutes of the active period inside the
-- caller's scope and the latest meeting date. Counts only, never a title (screen 8). Period dates are
-- returned for the soft "outside the period" hint of the form (R9).
create or replace function nexus.minute_dashboard_counts()
returns table (
  period_id uuid, period_label text, period_starts_on date, period_ends_on date,
  minute_count integer, latest_meeting_date date
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_scope  record;
  v_period uuid;
begin
  select * into v_scope from nexus._mn_require_scope('minutes.view');
  v_period := nexus.active_period_id();
  return query
  select v_period, p.label, p.starts_on, p.ends_on,
         (select count(*)::int from nexus.minutes m
          where m.period_id = v_period and m.status = 'active' and (v_scope.o_all or m.org_unit_id = any (v_scope.o_units))),
         (select max(m.meeting_date) from nexus.minutes m
          where m.period_id = v_period and m.status = 'active' and (v_scope.o_all or m.org_unit_id = any (v_scope.o_units)))
  from (select 1) one
  left join public.periods p on p.id = v_period;
end
$$;

-- =============================================================================================
-- 6. Writes (minutes.manage: BPH secretaries all units, D17/D20/D23; secretaries own unit, D26).
--    Every write writes one history row (per file for files) in the same transaction.
-- =============================================================================================

-- 6.1 Record (F3). Unit required and in scope (M1); period = active period; creator = session member;
-- meeting date not in the future; decision optional (A-MN2); files 0..3. Returns the new id.
create or replace function nexus.minute_record(
  p_org_unit_id  uuid,
  p_meeting_date date,
  p_title        text,
  p_topic        text,
  p_content      text,
  p_decision     text  default null,
  p_files        jsonb default null
)
returns table (minute_id uuid, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me       uuid;
  v_period   uuid;
  v_title    text;
  v_topic    text;
  v_content  text;
  v_decision text;
  v_date     date;
  v_files    jsonb;
  v_id       uuid;
begin
  perform nexus._mn_require_scope('minutes.manage');
  v_me := nexus._mn_require_member();
  v_period := nexus._mn_require_active_period();
  if p_org_unit_id is null then
    raise exception 'Choose a unit' using errcode = '22023', hint = 'invalid_unit', detail = 'org_unit_id';
  end if;
  if not nexus.has_permission('minutes.manage', p_org_unit_id) then
    raise exception 'You cannot record minutes for this unit' using errcode = '42501', hint = 'unit_not_allowed', detail = 'org_unit_id';
  end if;
  if not nexus._mn_is_recordable_unit(p_org_unit_id) then
    raise exception 'Minutes belong to the organisation, BPH, a department or the bureau (active units only)'
      using errcode = '22023', hint = 'invalid_unit', detail = 'org_unit_id';
  end if;
  v_date := nexus._mn_check_meeting_date(p_meeting_date);
  v_title := nexus._mn_required(nexus._mn_text(p_title, 150, 'title'), 'title', 'text_required');
  v_topic := nexus._mn_required(nexus._mn_text(p_topic, 200, 'topic'), 'topic', 'text_required');
  v_content := nexus._mn_required(nexus._mn_long_text(p_content, 20000, 'content'), 'content', 'text_required');
  v_decision := nexus._mn_long_text(p_decision, 5000, 'decision');
  v_files := nexus._mn_check_files(p_files, v_me, 0, 3);

  insert into nexus.minutes (org_unit_id, period_id, meeting_date, title, topic, content, decision, created_by, updated_by)
  values (p_org_unit_id, v_period, v_date, v_title, v_topic, v_content, v_decision, v_me, v_me)
  returning id into v_id;
  perform nexus._mn_log(v_id, 'recorded', null, null, null, null);
  perform nexus._mn_attach_files(v_id, v_files);
  return query select m.id, m.version from nexus.minutes m where m.id = v_id;
end
$$;

-- 6.2 Edit (F4, N3 a): Aktif minute of the ACTIVE period in the caller's manage scope. Send every field
-- as on the form; nothing changed = no save and no history row (changed = false). Unit and period are
-- not parameters (A-MN4, MN-11).
create or replace function nexus.minute_update(
  p_minute_id    uuid,
  p_version      integer,
  p_meeting_date date,
  p_title        text,
  p_topic        text,
  p_content      text,
  p_decision     text default null
)
returns table (minute_id uuid, changed boolean, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_m        nexus.minutes;
  v_title    text;
  v_topic    text;
  v_content  text;
  v_decision text;
  v_date     date;
  v_before   jsonb := '{}'::jsonb;
  v_after    jsonb := '{}'::jsonb;
begin
  perform nexus._mn_require_scope('minutes.manage');
  perform nexus._mn_require_member();
  perform nexus._mn_require_active_period();
  v_m := nexus._mn_lock_minute(p_minute_id, p_version);
  perform nexus._mn_require_editable(v_m);
  v_date := nexus._mn_check_meeting_date(p_meeting_date);
  v_title := nexus._mn_required(nexus._mn_text(p_title, 150, 'title'), 'title', 'text_required');
  v_topic := nexus._mn_required(nexus._mn_text(p_topic, 200, 'topic'), 'topic', 'text_required');
  v_content := nexus._mn_required(nexus._mn_long_text(p_content, 20000, 'content'), 'content', 'text_required');
  v_decision := nexus._mn_long_text(p_decision, 5000, 'decision');

  if v_date is distinct from v_m.meeting_date then
    v_before := v_before || jsonb_build_object('meeting_date', v_m.meeting_date); v_after := v_after || jsonb_build_object('meeting_date', v_date);
  end if;
  if v_title is distinct from v_m.title then
    v_before := v_before || jsonb_build_object('title', v_m.title); v_after := v_after || jsonb_build_object('title', v_title);
  end if;
  if v_topic is distinct from v_m.topic then
    v_before := v_before || jsonb_build_object('topic', v_m.topic); v_after := v_after || jsonb_build_object('topic', v_topic);
  end if;
  if v_content is distinct from v_m.content then
    v_before := v_before || jsonb_build_object('content', v_m.content); v_after := v_after || jsonb_build_object('content', v_content);
  end if;
  if v_decision is distinct from v_m.decision then
    v_before := v_before || jsonb_build_object('decision', v_m.decision); v_after := v_after || jsonb_build_object('decision', v_decision);
  end if;
  if v_after = '{}'::jsonb then
    return query select v_m.id, false, v_m.version;
    return;
  end if;

  update nexus.minutes m
  set meeting_date = v_date, title = v_title, topic = v_topic, content = v_content, decision = v_decision,
      updated_by = nexus.current_member_id()
  where m.id = v_m.id;
  perform nexus._mn_log(v_m.id, 'edited', v_before, v_after, null, null);
  return query select m.id, true, m.version from nexus.minutes m where m.id = v_m.id;
end
$$;

-- 6.3 "Tambah lampiran" (F5): Aktif minute of the active period, at most 3 visible files (withdrawn
-- ones do not count). One history row per file; bumps the version.
create or replace function nexus.minute_add_files(p_minute_id uuid, p_version integer, p_files jsonb)
returns table (minute_id uuid, file_count integer, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me    uuid;
  v_m     nexus.minutes;
  v_files jsonb;
begin
  perform nexus._mn_require_scope('minutes.manage');
  v_me := nexus._mn_require_member();
  perform nexus._mn_require_active_period();
  v_m := nexus._mn_lock_minute(p_minute_id, p_version);
  perform nexus._mn_require_editable(v_m);
  v_files := nexus._mn_check_files(p_files, v_me, 1, 3 - nexus._mn_visible_file_count(v_m.id));
  perform nexus._mn_attach_files(v_m.id, v_files);
  update nexus.minutes m set updated_by = v_me where m.id = v_m.id;
  return query select m.id, nexus._mn_visible_file_count(m.id), m.version from nexus.minutes m where m.id = v_m.id;
end
$$;

-- 6.4 "Tarik berkas" (F5): reason required; the record and the stored object stay (L5).
-- p_version = the MINUTE's version.
create or replace function nexus.minute_withdraw_file(p_file_id bigint, p_version integer, p_reason text)
returns table (minute_id uuid, file_count integer, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid;
  v_file   nexus.minute_files;
  v_m      nexus.minutes;
  v_reason text;
begin
  perform nexus._mn_require_scope('minutes.manage');
  v_me := nexus._mn_require_member();
  perform nexus._mn_require_active_period();
  select f.* into v_file from nexus.minute_files f where f.id = p_file_id;
  if not found then
    raise exception 'File not found' using errcode = 'P0002', hint = 'file_not_found';
  end if;
  v_m := nexus._mn_lock_minute(v_file.minute_id, p_version);
  perform nexus._mn_require_editable(v_m);
  select f.* into v_file from nexus.minute_files f where f.id = p_file_id for update;
  if v_file.is_withdrawn then
    raise exception 'The file was already withdrawn; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  v_reason := nexus._mn_required(nexus._mn_text(p_reason, 500, 'reason'), 'reason', 'reason_required');
  update nexus.minute_files f
  set is_withdrawn = true, withdrawn_by = v_me, withdrawn_at = now(), withdraw_reason = v_reason
  where f.id = p_file_id;
  perform nexus._mn_log(v_m.id, 'file_withdrawn', null, null, v_reason, p_file_id);
  update nexus.minutes m set updated_by = v_me where m.id = v_m.id;
  return query select m.id, nexus._mn_visible_file_count(m.id), m.version from nexus.minutes m where m.id = v_m.id;
end
$$;

-- 6.5 "Batalkan notulensi" (F5, 4.2, A-MN15): reason required; the row and its files stay, read-only,
-- never restored.
create or replace function nexus.minute_void(p_minute_id uuid, p_version integer, p_reason text)
returns table (minute_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid;
  v_m      nexus.minutes;
  v_reason text;
begin
  perform nexus._mn_require_scope('minutes.manage');
  v_me := nexus._mn_require_member();
  perform nexus._mn_require_active_period();
  v_m := nexus._mn_lock_minute(p_minute_id, p_version);
  perform nexus._mn_require_editable(v_m);
  v_reason := nexus._mn_required(nexus._mn_text(p_reason, 500, 'reason'), 'reason', 'reason_required');
  update nexus.minutes m
  set status = 'voided', void_reason = v_reason, voided_by = v_me, voided_at = now(), updated_by = v_me
  where m.id = v_m.id;
  perform nexus._mn_log(v_m.id, 'voided', null, null, v_reason, null);
  return query select m.id, m.status, m.version from nexus.minutes m where m.id = v_m.id;
end
$$;

-- =============================================================================================
-- 7. Export (F6, MN-25..MN-27). Same rows and order as minute_list, all pages, inside the caller's
--    EXPORT scope (which the engine already limits to units the caller may view, R15). More than 1000
--    rows: refused before any log row (M5). One log row in the SAME transaction after the rows; if it
--    fails, no rows are returned. total_count = rows of the full result on every row. VOLATILE: call
--    with .rpc() (POST). p_minute_id = single-minute export from the detail (A-MN8, M6).
-- =============================================================================================

create or replace function nexus.minute_export(
  p_format    text,
  p_search    text default null,
  p_unit_id   uuid default null,
  p_period    text default 'active',
  p_status    text default 'active',
  p_minute_id uuid default null
)
returns table (
  row_no bigint, minute_id uuid, meeting_date date, unit_name text, unit_type text, title text, topic text,
  content text, decision text, status text, void_reason text, period_label text, created_by_name text,
  created_at timestamptz, file_count integer, total_count bigint
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_scope  record;
  v_format text;
  v_all    boolean;
  v_status text;
  v_member uuid;
  v_period uuid;
  v_total  bigint;
begin
  select * into v_scope from nexus._mn_require_scope('minutes.export');
  v_format := nexus._mn_export_format(p_format);
  v_all := nexus._mn_period_filter(p_period);
  v_status := nexus._mn_status_filter(p_status);
  v_member := nexus._mn_require_member();
  -- Read the active period ONCE: the same value drives the rows and the log row.
  v_period := nexus._mn_require_active_period();

  select count(*) into v_total
  from nexus._mn_rows(v_scope.o_all, v_scope.o_units, p_search, p_unit_id, v_all, v_period, v_status, p_minute_id);
  if p_minute_id is not null and v_total = 0 then
    raise exception 'Minute not found' using errcode = 'P0002', hint = 'minute_not_found';
  end if;
  if v_total > nexus._mn_export_cap() then
    raise exception 'Too many rows for one file (%); narrow the filter', v_total
      using errcode = 'P0001', hint = 'too_many_rows', detail = v_total::text;
  end if;

  return query
  select r.ordinal, r.minute_id, r.meeting_date, r.unit_name, r.unit_type, r.title, r.topic, r.content, r.decision,
         r.status, r.void_reason, r.period_label, r.created_by_name, r.created_at, r.file_count,
         count(*) over ()
  from nexus._mn_rows(v_scope.o_all, v_scope.o_units, p_search, p_unit_id, v_all, v_period, v_status, p_minute_id) r
  order by r.ordinal;

  perform set_config('nexus.export_log_writer', 'minute_export', true);
  insert into nexus.minute_export_logs (exporter_member_id, format, filters, minute_id, row_count, period_id)
  values (v_member, v_format,
          case when p_minute_id is not null then jsonb_build_object('single', true)
               else jsonb_build_object('period', case when v_all then 'all' else 'active' end, 'status', v_status,
                                       'unit_id', p_unit_id, 'search_used', nexus._mn_search_pattern(p_search) is not null) end,
          p_minute_id, v_total, v_period);
  perform set_config('nexus.export_log_writer', '', true);
  return;
end
$$;

-- =============================================================================================
-- 8. Storage access checks for the bucket `nexus-minute-files` (used by the Storage RLS policies in
--    20261111100200; callable as the user). They never raise: a bad name is simply "no".
--    Upload: a minutes.manage holder (any scope, M4), only into their OWN folder, only while a period
--    is active, at most 10 unattached uploads of the last 24 hours in that folder (A-MN9).
--    Read: _mn_can_read_file. Nobody deletes or overwrites (no policy for that).
-- =============================================================================================

create or replace function nexus.minute_file_can_upload(p_object_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me         uuid := nexus.current_member_id();
  v_scope      record;
  v_unattached integer;
begin
  if p_object_name is null or v_me is null
     or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'
     or split_part(p_object_name, '/', 1) <> v_me::text
     or nexus.active_period_id() is null then
    return false;
  end if;
  select * into v_scope from nexus._mn_scope('minutes.manage');
  if not v_scope.o_all and cardinality(v_scope.o_units) = 0 then
    return false;
  end if;
  -- A missing created_at counts as recent (fail towards the cap).
  if to_regclass('storage.objects') is not null then
    execute 'select count(*)::int from storage.objects o
             where o.bucket_id = $1 and o.name like $2
               and coalesce(o.created_at, now()) > now() - interval ''24 hours''
               and not exists (select 1 from nexus.minute_files f where f.storage_path = o.name)'
      into v_unattached using 'nexus-minute-files', v_me::text || '/%';
    if v_unattached >= 10 then
      return false;
    end if;
  end if;
  return true;
end
$$;

create or replace function nexus.minute_file_can_read(p_object_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_object_name is null
     or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$' then
    return false;
  end if;
  select f.id into v_id from nexus.minute_files f where f.storage_path = p_object_name;
  if not found then
    return false;   -- an unattached upload is nobody's file yet (never shown, MN-20)
  end if;
  return nexus._mn_can_read_file(v_id);
end
$$;

-- =============================================================================================
-- 9. Function privileges: revoke the global EXECUTE-to-PUBLIC, grant the client API to authenticated
--    only, internals to nobody but the owner.
-- =============================================================================================

do $$
declare
  f record;
  v_api text[] := array[
    'minute_unit_options', 'minute_list', 'minute_detail', 'minute_dashboard_counts',
    'minute_record', 'minute_update', 'minute_add_files', 'minute_withdraw_file', 'minute_void',
    'minute_export', 'minute_file_can_upload', 'minute_file_can_read'];
begin
  for f in select p.oid::regprocedure as sig, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname = any (v_api) or p.proname like '\_mn\_%') loop
    execute format('revoke all on function %s from public, anon, service_role', f.sig);
    if f.proname = any (v_api) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';
