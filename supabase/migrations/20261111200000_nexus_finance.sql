-- PMK-NEXUS 0015: Finance / Keuangan module (cash book entries, opening balance, proofs, totals, export).
--
-- Spec:      docs/modules/finance.md (APPROVED 2026-11-09, all recommendations accepted: K1 a, K2 a, K3 a,
--            K4 a, K5 a, K6 a): sections 2, 3 (F1-F8), 4 (4.1-4.4), 5 (R1-R18), 8, 9 (A-FN1..A-FN21),
--            11 (FN-01..FN-40). docs/modules/access-control.md: keys finance.view / finance.manage /
--            finance.export (catalog of 20261105100000, sensitive, never baseline: L12), default rules
--            D02, D03, D24, D25 (unchanged); locked rules L1, L4, L5, L7 ("Finance corrections go into the
--            active period"), L8, L11, L12; R11, R15, E15.
-- Decisions: D-007, D-010, D-011, D-013, D-019 (export-log pattern), D-026, D-028 (Finance rules).
-- PI-CORE:   verified against docs/picore/schema-report.md (pi-core-v2 migrations 20261031165546 ..
--            20261102090000, HEAD d8b6814, unchanged). Read here, only inside nexus functions:
--            members(id, full_name) for names, periods(id, label, starts_on, ends_on, is_active) for the
--            period selector, labels and the soft date hint. No contact or identity-number column (L4).
--            No foreign key to PI-CORE.
--
-- Stored values are English identifiers; the UI maps them to Indonesian:
--   entry type    income = Pemasukan, expense = Pengeluaran, opening = Saldo awal
--   entry status  active = Aktif, voided = Dibatalkan (never restored)
--   history kind  recorded, file_added, file_withdrawn ("Tarik berkas"), voided
--
-- Money rules (spec 4.2, A-FN1, A-FN3; FN-08..FN-11):
--   * Amounts are whole rupiah in a BIGINT column, never negative: named CHECK finance_entries_amount_range
--     = 1 .. 9 999 999 999 for income and expense, 0 .. 9 999 999 999 for the opening balance only
--     (owner decision 2026-11-10: a period may honestly start with Rp 0 in the cash box; without this
--     the "Saldo awal belum dicatat" hint could never be cleared). No floating-point or numeric column
--     anywhere in this module. The API takes the amount as TEXT of digits only ("1250000") and parses it
--     strictly: "12.5", "1e3", "-5", "+5", "007", "00", blanks and letters are refused (invalid_amount);
--     "0" is refused with the same hint unless the type is opening; more than 10 digits =
--     amount_too_large. So no client-side float can ever round into the ledger.
--   * The type gives the sign. NO stored balance: totals are computed from the entries on every read:
--     Saldo awal = the Aktif opening entry of the period (0 if none); Total Pemasukan / Pengeluaran =
--     sums of Aktif income / expense entries; Total Saldo = Saldo awal + Pemasukan - Pengeluaran.
--     Voided entries count in nothing. Sums are cast back to bigint (exact; an overflow would raise,
--     never round).
--   * At most one Aktif opening entry per period (partial unique index, K3 a / A-FN21).
--
-- Immutable ledger (K2 a, R1, FN-13): after saving, only the void columns change, once (trigger). A
-- mistake in the active period = void with a reason + record again ("Catat ulang"); a mistake in an old
-- period = a new entry in the ACTIVE period linked by corrects_entry_id ("Koreksi atas KAS-0007", F5,
-- A-FN8); the old period's totals are never restated.
--
-- Numbering (A-FN2, R9, FN-18): "KAS-0001", one sequence for all periods, stored with the entry. One
-- counter row, locked FOR UPDATE inside the same transaction as the insert: two Treasurers saving at
-- once get different numbers; a failed save uses none (it all rolls back); a number is never reused,
-- also after a void (the counter only goes up, trigger). At least four digits, then simply longer.
--
-- Double submit (A-FN10, R8, FN-17): every record call carries a client-made idempotency key (uuid per
-- form submit). The pair (recorder, key) is unique. A repeat with the same key and the same values
-- returns the FIRST entry (replayed = true) and creates nothing; the same key with different values is
-- refused (idempotency_conflict). The repeat is detected UNDER the counter lock, so two simultaneous
-- submits of one form also give one entry.
--
-- Security model (same as Letters and Minutes): writes only through SECURITY DEFINER functions with
-- search_path = ''; no client INSERT/UPDATE/DELETE grant; SELECT-only RLS (default deny) as a second
-- door; the export log has no client grant. Every function checks L1, the key (scope "all"; finance
-- keys allow no unit scope), the active period for writes (R11) and L7 (writes only on entries of the
-- active period). Nothing is ever deleted (L5).
--
-- Files (spec 4.4, K5 a): private bucket `nexus-finance-proofs` (20261111200100). Path
-- "<uploader members.id>/<uuid>.<pdf|jpg|jpeg|png>", uploaded before the entry exists; a save attaches
-- only the caller's OWN uploads. PDF/JPG/PNG, 5 MB, at most 3 visible proofs per entry. Proof is
-- optional; entries without a visible proof are filterable ("Tanpa bukti").
--
-- Decisions where the spec was silent (minor ones; owner-relevant ones are also listed in the report):
--   F1  The amount is passed as text of digits (see Money rules). Leading zeros are refused.
--   F2  A correction link (corrects_entry_id) may point to any Aktif entry the caller can read, of any
--       period (A-FN8 only requires "exists and Aktif"); an opening entry cannot carry a link.
--       OWNER QUESTION in the report: limit the link to entries of a previous period?
--   F3  Withdrawing a proof follows the same rule as adding one: Aktif entry of the active period.
--   F4  Withdrawn proofs, their history rows and the withdraw reason are visible to finance.manage only
--       (A-FN6 "hidden from non-managers").
--   F5  Export refuses more than 1000 matching rows in the DATABASE (too_many_rows) before any log row is
--       written (spec 8 / D-022 row guard). Each exported row repeats the period summary (opening,
--       income, expense, balance) computed in the SAME call, so the summary block and the rows can never
--       come from two different moments; an empty export returns no rows (the server then reads
--       finance_summary for the block).
--   F6  "Previous period" for the opening hint = the period whose label ("YYYY/YYYY") comes right
--       before the selected one; its closing balance is computed live (null when it has no Aktif entry).
--   F7  Keterangan is one line (whitespace collapsed); Catatan keeps line breaks (CRLF -> LF), trimmed.
--   F8  The export log stores the exported period AND the active period at export time; no amounts,
--       no search text.
--
-- Errors carry a stable hint (errcode): permission_required, not_active_member, closed_period,
-- immutable_column, export_log_direct_insert, append_only (42501); entry_not_found, file_not_found
-- (P0002); no_active_period, state_changed, entry_voided, opening_exists, file_missing, too_many_rows
-- (P0001); invalid_type, invalid_amount, amount_too_large, invalid_input, invalid_correction,
-- idempotency_conflict, text_required, text_too_long, reason_required, date_required, date_in_future,
-- invalid_dates, invalid_file, file_too_large, file_required, file_count, file_already_attached,
-- invalid_period, search_too_long, invalid_page, invalid_page_size, invalid_format (22023).
-- `detail` names the field, a count, a path or a number text; never a person and never an amount.
--
-- Re-runnable: create ... if not exists / or replace, guarded policies, counter row only when missing.
-- Run as ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261111200000_nexus_finance.sql
-- Requires 20261105100000 .. 20261111100000 (uses nexus._require_permission from 20261106200000,
-- nexus._jakarta_date from 20261107100100 and the null-safe is_active_period of 20261111100000).
-- No access-rule change: the keys and D02, D03, D24, D25 exist since M1/M2.

-- =============================================================================================
-- 0. Catalog text (K2 a): finance.manage never edits a saved entry. Key and flags unchanged.
-- =============================================================================================
update nexus.permissions
set description = 'Record, void and correct transactions (active period); add and withdraw proof. A saved transaction is never edited. Includes view.'
where key = 'finance.manage'
  and description is distinct from 'Record, void and correct transactions (active period); add and withdraw proof. A saved transaction is never edited. Includes view.';

-- =============================================================================================
-- 1. Tables
-- =============================================================================================

-- 1.1 Number counter (A-FN2): exactly one row, last used number. Locked FOR UPDATE per save.
create table if not exists nexus.finance_counter (
  id         boolean primary key default true check (id),
  last_value bigint not null check (last_value >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into nexus.finance_counter (id, last_value) values (true, 0) on conflict (id) do nothing;

-- 1.2 Entries (spec 4.1). period_id = the active period at saving (R3), a PI-CORE id (no FK).
create table if not exists nexus.finance_entries (
  id                uuid primary key default gen_random_uuid(),
  entry_no          bigint not null unique check (entry_no >= 1),
  number_text       text not null unique check (number_text ~ '^KAS-[0-9]{4,}$'),
  entry_type        text not null check (entry_type in ('income', 'expense', 'opening')),
  amount            bigint not null,
  entry_date        date not null check (entry_date >= date '2000-01-01' and isfinite(entry_date)),
  description       text not null check (description = btrim(description) and char_length(description) between 1 and 200),
  notes             text check (notes is null or (char_length(notes) between 1 and 500 and notes !~ '^\s' and notes !~ '\s$')),
  status            text not null default 'active' check (status in ('active', 'voided')),
  void_reason       text check (void_reason is null or (void_reason = btrim(void_reason) and char_length(void_reason) between 1 and 500)),
  voided_by         uuid,
  voided_at         timestamptz,
  corrects_entry_id uuid references nexus.finance_entries (id),
  period_id         uuid not null,
  idempotency_key   uuid not null,
  created_at        timestamptz not null default now(),
  created_by        uuid not null,
  constraint finance_entries_void check ((status = 'voided') = (void_reason is not null and voided_by is not null and voided_at is not null)),
  constraint finance_entries_not_self check (corrects_entry_id is distinct from id),
  constraint finance_entries_opening_no_link check (entry_type <> 'opening' or corrects_entry_id is null),
  constraint finance_entries_idempotency unique (created_by, idempotency_key),
  -- A-FN1 + owner 2026-11-10: never negative; Rp 0 only for the opening balance.
  constraint finance_entries_amount_range check (amount between 0 and 9999999999 and (amount >= 1 or entry_type = 'opening'))
);
-- Upgrade path (the local dev stack got the first version of this file): the first version had an
-- unnamed column CHECK "amount between 1 and 9999999999" (finance_entries_amount_check). Replace it by the
-- named rule above, so a fresh install and an upgraded install end identical. Re-running changes nothing.
alter table nexus.finance_entries drop constraint if exists finance_entries_amount_check;
do $$
begin
  if not exists (select 1 from pg_constraint c
                 where c.conrelid = 'nexus.finance_entries'::regclass and c.conname = 'finance_entries_amount_range') then
    alter table nexus.finance_entries
      add constraint finance_entries_amount_range check (amount between 0 and 9999999999 and (amount >= 1 or entry_type = 'opening'));
  end if;
end
$$;
-- K3 a / A-FN21: at most one Aktif opening entry per period.
create unique index if not exists finance_entries_one_opening on nexus.finance_entries (period_id)
  where entry_type = 'opening' and status = 'active';
create index if not exists finance_entries_list_idx on nexus.finance_entries (period_id, entry_date desc, entry_no desc);
create index if not exists finance_entries_corrects_idx on nexus.finance_entries (corrects_entry_id) where corrects_entry_id is not null;

-- 1.3 Proof files (spec 4.4). Never deleted; withdrawn with a reason.
create table if not exists nexus.finance_entry_files (
  id              bigint generated always as identity primary key,
  entry_id        uuid not null references nexus.finance_entries (id),
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
  constraint finance_entry_files_withdrawn check (is_withdrawn = (withdrawn_by is not null and withdrawn_at is not null and withdraw_reason is not null))
);
create index if not exists finance_entry_files_entry_idx on nexus.finance_entry_files (entry_id);

-- 1.4 History (FN-19): one row per record, proof and void action. Append-only.
create table if not exists nexus.finance_entry_history (
  id              bigint generated always as identity primary key,
  entry_id        uuid not null references nexus.finance_entries (id),
  kind            text not null check (kind in ('recorded', 'file_added', 'file_withdrawn', 'voided')),
  note            text check (note is null or char_length(note) between 1 and 500),
  file_id         bigint references nexus.finance_entry_files (id),
  actor_member_id uuid not null,
  occurred_at     timestamptz not null default now(),
  period_id       uuid not null
);
create index if not exists finance_entry_history_entry_idx on nexus.finance_entry_history (entry_id, id desc);

-- 1.5 Export log (F7, FN-31): one row per SUCCESSFUL export; no PII, no amounts, no search text.
create table if not exists nexus.finance_export_logs (
  id                 bigint generated always as identity primary key,
  exporter_member_id uuid not null,
  created_at         timestamptz not null default now(),
  format             text not null check (format in ('xlsx', 'csv', 'pdf')),
  filters            jsonb not null check (jsonb_typeof(filters) = 'object'),
  exported_period_id uuid not null,
  row_count          integer not null check (row_count >= 0),
  period_id          uuid not null
);
create index if not exists finance_export_logs_created_idx on nexus.finance_export_logs (created_at desc, id desc);

comment on table nexus.finance_counter is 'Last used KAS number (one row). Only goes up (trigger); locked FOR UPDATE while a number is assigned.';
comment on table nexus.finance_entries is 'Cash book (D-028). Immutable after saving except the void columns; never deleted. No stored balance. Written only by nexus.finance_* functions.';
comment on table nexus.finance_entry_files is 'Proof files (bucket nexus-finance-proofs). Never deleted; withdrawn with a reason.';
comment on table nexus.finance_entry_history is 'Append-only entry history (recorded, proof added/withdrawn, voided).';
comment on table nexus.finance_export_logs is 'Finance export log (F7). Append-only, no PII, no amounts. Written only by finance_export(); no client grant.';

-- =============================================================================================
-- 2. Guard triggers (every writer, including the SQL editor and the service role; the owner could
--    disable them: tamper-evident, not tamper-proof, supabase/README.md section 6).
-- =============================================================================================

create or replace function nexus._fn_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'finance_entries' then
    -- R1/FN-13: nothing but the void columns ever changes, and only Aktif -> Dibatalkan, once.
    if (new.id, new.entry_no, new.number_text, new.entry_type, new.amount, new.entry_date, new.description,
        new.notes, new.corrects_entry_id, new.period_id, new.idempotency_key, new.created_at, new.created_by)
       is distinct from
       (old.id, old.entry_no, old.number_text, old.entry_type, old.amount, old.entry_date, old.description,
        old.notes, old.corrects_entry_id, old.period_id, old.idempotency_key, old.created_at, old.created_by) then
      raise exception 'A saved transaction is never changed; void it and record it again' using errcode = '42501', hint = 'immutable_column';
    end if;
    if old.status = 'voided' or new.status <> 'voided' then
      raise exception 'Only an Aktif transaction can be voided, once' using errcode = '42501', hint = 'immutable_column';
    end if;
  elsif tg_table_name = 'finance_counter' then
    -- A-FN2: the number never goes back, so it is never issued twice.
    if new.id is distinct from old.id or new.last_value < old.last_value then
      raise exception 'The KAS number never goes back' using errcode = '42501', hint = 'immutable_column';
    end if;
    new.updated_at := now();
  elsif tg_table_name = 'finance_entry_files' then
    if (new.id, new.entry_id, new.storage_path, new.original_name, new.size_bytes, new.mime_type,
        new.attached_by, new.attached_at)
       is distinct from
       (old.id, old.entry_id, old.storage_path, old.original_name, old.size_bytes, old.mime_type,
        old.attached_by, old.attached_at)
       or old.is_withdrawn then
      raise exception 'A stored proof is never replaced; withdraw it instead' using errcode = '42501', hint = 'immutable_column';
    end if;
  end if;
  return new;
end
$$;

create or replace function nexus._fn_export_log_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('nexus.export_log_writer', true), '') is distinct from 'finance_export' then
    raise exception 'finance_export_logs is written only by finance_export()'
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
  foreach t in array array['finance_counter', 'finance_entries', 'finance_entry_files'] loop
    execute format('create or replace trigger %I before delete on nexus.%I for each row execute function nexus._append_only_guard()',
                   t || '_no_delete', t);
    execute format('create or replace trigger %I before truncate on nexus.%I for each statement execute function nexus._append_only_guard()',
                   t || '_no_truncate', t);
    execute format('create or replace trigger %I before update on nexus.%I for each row execute function nexus._fn_guard()',
                   t || '_10_guard', t);
  end loop;
  foreach t in array array['finance_entry_history', 'finance_export_logs'] loop
    execute format('create or replace trigger %I before update or delete on nexus.%I for each row execute function nexus._append_only_guard()',
                   t || '_no_change', t);
    execute format('create or replace trigger %I before truncate on nexus.%I for each statement execute function nexus._append_only_guard()',
                   t || '_no_truncate', t);
  end loop;
end
$$;

create or replace trigger finance_export_logs_10_insert_guard
  before insert on nexus.finance_export_logs
  for each row execute function nexus._fn_export_log_guard();

-- =============================================================================================
-- 3. Privileges and Row Level Security (default deny; SELECT-only policies; no client writes)
-- =============================================================================================

do $$
declare
  t text;
begin
  foreach t in array array['finance_counter', 'finance_entries', 'finance_entry_files', 'finance_entry_history',
                           'finance_export_logs'] loop
    execute format('revoke all on nexus.%I from public, anon, authenticated, service_role', t);
    execute format('alter table nexus.%I enable row level security', t);
    execute format('grant select on nexus.%I to service_role', t);
    if t <> 'finance_export_logs' then
      execute format('grant select on nexus.%I to authenticated', t);
    end if;
  end loop;
end
$$;
revoke all on sequence nexus.finance_entry_files_id_seq, nexus.finance_entry_history_id_seq, nexus.finance_export_logs_id_seq
  from public, anon, authenticated, service_role;

do $$
declare
  v_policies text[][] := array[
    -- entries: finance.view (BPH D02; included in finance.manage D24). Finance keys have scope "all" only.
    array['finance_entries', 'finance_entries_select', '(select nexus.has_permission(''finance.view''))'],
    -- proofs: view; withdrawn ones only for finance.manage (F4)
    array['finance_entry_files', 'finance_entry_files_select',
          '(select nexus.has_permission(''finance.view'')) and (not is_withdrawn or (select nexus.has_permission(''finance.manage'')))'],
    array['finance_entry_history', 'finance_entry_history_select',
          '(select nexus.has_permission(''finance.view'')) and (kind <> ''file_withdrawn'' or (select nexus.has_permission(''finance.manage'')))'],
    -- counter: the Treasurers only (FN-35)
    array['finance_counter', 'finance_counter_select', '(select nexus.has_permission(''finance.manage''))']
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
-- finance_export_logs: no policy and no client grant (database only until the log screen exists, A-FN15).

-- =============================================================================================
-- 4. Internal helpers (no EXECUTE for clients). Own small copies; this module stays self-contained.
-- =============================================================================================

create or replace function nexus._fn_today()
returns date
language sql stable set search_path = ''
as $$ select nexus._jakarta_date(now()) $$;

create or replace function nexus._fn_require_member()
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

create or replace function nexus._fn_require_active_period()
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

-- One-line text (Keterangan, reasons; F7): whitespace collapsed, trimmed, blank -> null.
create or replace function nexus._fn_text(p_text text, p_max integer, p_field text)
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

-- Multi-line text (Catatan; F7): CRLF -> LF, outer whitespace trimmed, blank -> null.
create or replace function nexus._fn_long_text(p_text text, p_max integer, p_field text)
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

create or replace function nexus._fn_required(p_value text, p_field text, p_hint text)
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

-- A-FN1 / FN-08: whole rupiah from a digits-only text. 0 .. 9 999 999 999 (10 digits). Never a float.
-- "0" is accepted HERE only so the caller can allow it for an opening balance; finance_entry_record
-- refuses 0 for income and expense with the same hint (owner 2026-11-10). No leading zeros ("007", "00").
create or replace function nexus._fn_parse_amount(p_amount text)
returns bigint
language plpgsql immutable set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_amount, ''));
begin
  if v !~ '^(0|[1-9][0-9]*)$' then
    raise exception 'The amount must be a whole number of rupiah' using errcode = '22023', hint = 'invalid_amount', detail = 'amount';
  end if;
  if char_length(v) > 10 then
    raise exception 'The amount is too large (max 9999999999)' using errcode = '22023', hint = 'amount_too_large', detail = 'amount';
  end if;
  return v::bigint;
end
$$;

create or replace function nexus._fn_type(p_type text, p_allow_all boolean)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := coalesce(nullif(lower(btrim(p_type)), ''), case when p_allow_all then 'all' end);
begin
  if v is null or v not in ('income', 'expense', 'opening', 'all') or (v = 'all' and not p_allow_all) then
    raise exception 'Type must be income, expense or opening' using errcode = '22023', hint = 'invalid_type';
  end if;
  return v;
end
$$;

-- R5/A-FN4/FN-12: required, from 2000 on, not after today (Jakarta).
create or replace function nexus._fn_check_entry_date(p_date date)
returns date
language plpgsql stable set search_path = ''
as $$
begin
  if p_date is null then
    raise exception 'The date is required' using errcode = '22023', hint = 'date_required', detail = 'entry_date';
  end if;
  if not isfinite(p_date) or p_date < date '2000-01-01' then
    raise exception 'The date is not a valid date' using errcode = '22023', hint = 'invalid_dates', detail = 'entry_date';
  end if;
  if p_date > nexus._fn_today() then
    raise exception 'The date cannot be after today' using errcode = '22023', hint = 'date_in_future', detail = 'entry_date';
  end if;
  return p_date;
end
$$;

-- Date-range filter: either end may be empty; both real dates; start not after end.
create or replace function nexus._fn_check_range(p_from date, p_to date)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if (p_from is not null and (not isfinite(p_from) or p_from < date '2000-01-01'))
     or (p_to is not null and (not isfinite(p_to) or p_to < date '2000-01-01'))
     or (p_from is not null and p_to is not null and p_to < p_from) then
    raise exception 'Choose valid dates, the end not before the start' using errcode = '22023', hint = 'invalid_dates';
  end if;
end
$$;

create or replace function nexus._fn_search_pattern(p_search text)
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

create or replace function nexus._fn_check_page(p_page integer, p_page_size integer)
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

create or replace function nexus._fn_export_format(p_format text)
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

create or replace function nexus._fn_export_cap()
returns integer
language sql immutable set search_path = ''
as $$ select 1000 $$;

-- The period to read: null = the active period; an id must exist in PI-CORE (invalid_period).
create or replace function nexus._fn_period(p_period_id uuid)
returns uuid
language plpgsql stable set search_path = ''
as $$
declare
  v uuid := coalesce(p_period_id, nexus.active_period_id());
begin
  if v is null then
    raise exception 'There is no active period' using errcode = 'P0001', hint = 'no_active_period';
  end if;
  if not exists (select 1 from public.periods p where p.id = v) then
    raise exception 'Unknown period' using errcode = '22023', hint = 'invalid_period';
  end if;
  return v;
end
$$;

-- "KAS-0001": at least four digits, then simply longer (lpad alone would cut).
create or replace function nexus._fn_number_text(p_no bigint)
returns text
language sql immutable set search_path = ''
as $$ select 'KAS-' || case when p_no < 10000 then lpad(p_no::text, 4, '0') else p_no::text end $$;

create or replace function nexus._fn_member_name(p_member_id uuid)
returns text
language sql stable set search_path = ''
as $$ select m.full_name from public.members m where m.id = p_member_id $$;

-- Totals of ONE period (spec 4.2, A-FN3): computed from the Aktif entries every time; bigint only.
create or replace function nexus._fn_totals(
  p_period_id uuid,
  out o_opening bigint, out o_has_opening boolean, out o_opening_entry_id uuid,
  out o_income bigint, out o_expense bigint, out o_balance bigint,
  out o_entry_count integer, out o_voided_count integer, out o_without_proof_count integer)
language sql stable set search_path = ''
as $$
  with e as (select * from nexus.finance_entries x where x.period_id = p_period_id)
  select coalesce((select sum(e.amount) from e where e.entry_type = 'opening' and e.status = 'active'), 0)::bigint,
         exists (select 1 from e where e.entry_type = 'opening' and e.status = 'active'),
         (select e.id from e where e.entry_type = 'opening' and e.status = 'active'),
         coalesce((select sum(e.amount) from e where e.entry_type = 'income' and e.status = 'active'), 0)::bigint,
         coalesce((select sum(e.amount) from e where e.entry_type = 'expense' and e.status = 'active'), 0)::bigint,
         (coalesce((select sum(e.amount) from e where e.entry_type = 'opening' and e.status = 'active'), 0)
          + coalesce((select sum(e.amount) from e where e.entry_type = 'income' and e.status = 'active'), 0)
          - coalesce((select sum(e.amount) from e where e.entry_type = 'expense' and e.status = 'active'), 0))::bigint,
         (select count(*)::int from e where e.status = 'active'),
         (select count(*)::int from e where e.status = 'voided'),
         (select count(*)::int from e where e.status = 'active'
            and not exists (select 1 from nexus.finance_entry_files f where f.entry_id = e.id and not f.is_withdrawn))
$$;

-- Files given to a save function. Same checks as Letters and Minutes, bucket nexus-finance-proofs.
create or replace function nexus._fn_check_files(p_files jsonb, p_member uuid, p_min integer, p_max integer)
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
    if exists (select 1 from nexus.finance_entry_files f where f.storage_path = v_path) then
      raise exception 'This file is already attached' using errcode = '22023', hint = 'file_already_attached', detail = v_path;
    end if;
    v_ext := substring(v_path from '\.([a-z]+)$');
    v_want := case v_ext when 'pdf' then 'application/pdf' when 'png' then 'image/png' else 'image/jpeg' end;
    v_size := null;
    v_mime := null;
    if to_regclass('storage.objects') is not null then
      execute 'select (o.metadata ->> ''size'')::bigint, o.metadata ->> ''mimetype''
               from storage.objects o where o.bucket_id = $1 and o.name = $2'
        into v_size, v_mime using 'nexus-finance-proofs', v_path;
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

create or replace function nexus._fn_log(p_entry_id uuid, p_kind text, p_note text, p_file_id bigint)
returns void
language sql volatile set search_path = ''
as $$
  insert into nexus.finance_entry_history (entry_id, kind, note, file_id, actor_member_id, period_id)
  values (p_entry_id, p_kind, p_note, p_file_id, nexus.current_member_id(), nexus.active_period_id())
$$;

create or replace function nexus._fn_attach_files(p_entry_id uuid, p_files jsonb)
returns integer
language plpgsql volatile set search_path = ''
as $$
declare
  v_e  jsonb;
  v_id bigint;
  v_n  integer := 0;
begin
  for v_e in select e from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) e loop
    insert into nexus.finance_entry_files (entry_id, storage_path, original_name, size_bytes, mime_type, attached_by)
    values (p_entry_id, v_e ->> 'path', v_e ->> 'name', (v_e ->> 'size')::integer, v_e ->> 'mime', nexus.current_member_id())
    returning id into v_id;
    perform nexus._fn_log(p_entry_id, 'file_added', null, v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

create or replace function nexus._fn_visible_file_count(p_entry_id uuid)
returns integer
language sql stable set search_path = ''
as $$ select count(*)::int from nexus.finance_entry_files f where f.entry_id = p_entry_id and not f.is_withdrawn $$;

-- Lock one entry for a proof or void action (the caller already passed the key check).
create or replace function nexus._fn_lock_entry(p_entry_id uuid)
returns nexus.finance_entries
language plpgsql volatile set search_path = ''
as $$
declare
  v_e nexus.finance_entries;
begin
  select e.* into v_e from nexus.finance_entries e where e.id = p_entry_id for update;
  if not found then
    raise exception 'Transaction not found' using errcode = 'P0002', hint = 'entry_not_found';
  end if;
  return v_e;
end
$$;

-- L7/F6: proof changes need an Aktif entry of the ACTIVE period.
create or replace function nexus._fn_require_writable(p_e nexus.finance_entries)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_e.status <> 'active' then
    raise exception 'A voided transaction is read-only' using errcode = 'P0001', hint = 'entry_voided';
  end if;
  if not nexus.is_active_period(p_e.period_id) then
    raise exception 'A transaction of a previous period is read-only; record a correction in the active period'
      using errcode = '42501', hint = 'closed_period';
  end if;
end
$$;

-- Read rule for one proof (spec 4.4, FN-26): finance.view; a withdrawn proof only finance.manage.
create or replace function nexus._fn_can_read_file(p_file_id bigint)
returns boolean
language plpgsql stable set search_path = ''
as $$
declare
  v_withdrawn boolean;
begin
  if nexus.current_member_id() is null or not nexus.has_permission('finance.view') then
    return false;
  end if;
  select f.is_withdrawn into v_withdrawn from nexus.finance_entry_files f where f.id = p_file_id;
  if not found then
    return false;
  end if;
  return not v_withdrawn or nexus.has_permission('finance.manage');
end
$$;

-- Shared row builder (list and export): the SAME rows, filters and order (A-FN13): date newest first,
-- then number newest. Search = Keterangan, Catatan, number. p_include_voided false = Aktif only.
create or replace function nexus._fn_rows(
  p_period_id uuid, p_search text, p_type text, p_from date, p_to date, p_include_voided boolean, p_without_proof boolean)
returns table (
  ordinal bigint, entry_id uuid, entry_no bigint, number_text text, entry_type text, entry_date date, amount bigint,
  description text, notes text, status text, void_reason text, corrects_entry_id uuid, corrects_number_text text,
  proof_count integer, period_id uuid, period_label text, created_at timestamptz, created_by_name text
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_pattern text := nexus._fn_search_pattern(p_search);
begin
  return query
  with base as (
    select e.*,
           (select count(*)::int from nexus.finance_entry_files f where f.entry_id = e.id and not f.is_withdrawn) as pc
    from nexus.finance_entries e
    where e.period_id = p_period_id
      and (p_type = 'all' or e.entry_type = p_type)
      and (p_from is null or e.entry_date >= p_from)
      and (p_to is null or e.entry_date <= p_to)
      and (p_include_voided or e.status = 'active')
      and (v_pattern is null
           or e.description ilike v_pattern escape '\'
           or e.notes ilike v_pattern escape '\'
           or e.number_text ilike v_pattern escape '\')
  )
  select row_number() over (order by b.entry_date desc, b.entry_no desc),
         b.id, b.entry_no, b.number_text, b.entry_type, b.entry_date, b.amount, b.description, b.notes, b.status,
         b.void_reason, b.corrects_entry_id, c.number_text, b.pc, b.period_id, p.label, b.created_at, m.full_name
  from base b
  left join nexus.finance_entries c on c.id = b.corrects_entry_id
  left join public.periods p on p.id = b.period_id
  left join public.members m on m.id = b.created_by
  where not coalesce(p_without_proof, false) or b.pc = 0;
end
$$;

-- =============================================================================================
-- 5. Reads (finance.view: BPH D02, included in finance.manage D24)
-- =============================================================================================

-- 5.1 Period selector (screen 1): every period that has entries, plus the active one; active first,
-- then newest label first.
create or replace function nexus.finance_period_list()
returns table (period_id uuid, period_label text, is_active boolean, starts_on date, ends_on date, entry_count integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('finance.view');
  return query
  select p.id, p.label, p.is_active, p.starts_on, p.ends_on,
         (select count(*)::int from nexus.finance_entries e where e.period_id = p.id)
  from public.periods p
  where p.is_active or exists (select 1 from nexus.finance_entries e where e.period_id = p.id)
  order by p.is_active desc, p.label desc;
end
$$;

-- 5.2 Header tiles and Dashboard card (F1, F3, screen 1, screen 9, A-FN20). p_period_id null = the
-- active period. Totals of the WHOLE period, never the filter (A-FN3). previous_* = the opening hint
-- (K3 a, F6): the period right before by label and its live closing balance (null without entries).
create or replace function nexus.finance_summary(p_period_id uuid default null)
returns table (
  period_id uuid, period_label text, is_active_period boolean, starts_on date, ends_on date,
  opening_amount bigint, has_opening boolean, opening_entry_id uuid, income_total bigint, expense_total bigint,
  balance bigint, entry_count integer, voided_count integer, without_proof_count integer,
  previous_period_id uuid, previous_period_label text, previous_closing_balance bigint
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_period uuid;
  v_p      record;
  v_t      record;
  v_pt     record;
  v_prev_id    uuid;
  v_prev_label text;
  v_prev_close bigint;
begin
  perform nexus._require_permission('finance.view');
  v_period := nexus._fn_period(p_period_id);
  select p.* into v_p from public.periods p where p.id = v_period;
  select p.id, p.label into v_prev_id, v_prev_label from public.periods p where p.label < v_p.label order by p.label desc limit 1;
  select * into v_t from nexus._fn_totals(v_period);
  if v_prev_id is not null then
    select * into v_pt from nexus._fn_totals(v_prev_id);
    if v_pt.o_entry_count > 0 then
      v_prev_close := v_pt.o_balance;
    end if;
  end if;
  return query
  select v_period, v_p.label, nexus.is_active_period(v_period), v_p.starts_on, v_p.ends_on,
         v_t.o_opening, v_t.o_has_opening, v_t.o_opening_entry_id, v_t.o_income, v_t.o_expense, v_t.o_balance,
         v_t.o_entry_count, v_t.o_voided_count, v_t.o_without_proof_count,
         v_prev_id, v_prev_label, v_prev_close;
end
$$;

-- 5.3 List (F1, screen 1). p_type all (default) / income / expense / opening; p_from, p_to = date
-- range; p_include_voided ("Tampilkan yang dibatalkan", off); p_without_proof ("Tanpa bukti"). Page size
-- 1..50 (default 20), past the end = the last page.
create or replace function nexus.finance_entry_list(
  p_period_id      uuid    default null,
  p_search         text    default null,
  p_type           text    default 'all',
  p_from           date    default null,
  p_to             date    default null,
  p_include_voided boolean default false,
  p_without_proof  boolean default false,
  p_page           integer default 1,
  p_page_size      integer default 20
)
returns table (
  row_no bigint, entry_id uuid, number_text text, entry_type text, entry_date date, amount bigint, description text,
  status text, proof_count integer, corrects_entry_id uuid, corrects_number_text text, period_id uuid,
  period_label text, created_at timestamptz, created_by_name text, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_period uuid;
  v_type   text;
begin
  perform nexus._require_permission('finance.view');
  v_period := nexus._fn_period(p_period_id);
  v_type := nexus._fn_type(p_type, true);
  perform nexus._fn_check_range(p_from, p_to);
  perform nexus._fn_check_page(p_page, p_page_size);
  return query
  with
  o as (select * from nexus._fn_rows(v_period, p_search, v_type, p_from, p_to, coalesce(p_include_voided, false),
                                     coalesce(p_without_proof, false))),
  t as (select count(*) as n from o),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select o.ordinal, o.entry_id, o.number_text, o.entry_type, o.entry_date, o.amount, o.description, o.status,
         o.proof_count, o.corrects_entry_id, o.corrects_number_text, o.period_id, o.period_label, o.created_at,
         o.created_by_name, t.n, pg.pno, p_page_size
  from o cross join t cross join pg
  where o.ordinal > (pg.pno - 1)::bigint * p_page_size and o.ordinal <= pg.pno::bigint * p_page_size
  order by o.ordinal;
end
$$;

-- 5.4 Detail (screen 2) as one JSON object: fields, the entry it corrects and the entries correcting it,
-- proofs (withdrawn only for managers), history newest first (withdraw rows only for managers), and
-- `actions` for this caller now (writes re-check everything).
create or replace function nexus.finance_entry_detail(p_entry_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_e        nexus.finance_entries;
  v_manage   boolean;
  v_period   uuid;
  v_writable boolean;
  v_files    integer;
  v_corrects jsonb;
  v_by       jsonb;
  v_files_js jsonb;
  v_history  jsonb;
begin
  perform nexus._require_permission('finance.view');
  select e.* into v_e from nexus.finance_entries e where e.id = p_entry_id;
  if not found then
    raise exception 'Transaction not found' using errcode = 'P0002', hint = 'entry_not_found';
  end if;
  v_manage := nexus.has_permission('finance.manage');
  v_period := nexus.active_period_id();
  v_writable := v_manage and v_e.status = 'active' and nexus.is_active_period(v_e.period_id);
  v_files := nexus._fn_visible_file_count(v_e.id);

  select jsonb_build_object('entry_id', c.id, 'number_text', c.number_text, 'status', c.status,
                            'period_label', (select p.label from public.periods p where p.id = c.period_id))
  into v_corrects
  from nexus.finance_entries c where c.id = v_e.corrects_entry_id;

  select coalesce(jsonb_agg(jsonb_build_object('entry_id', c.id, 'number_text', c.number_text, 'status', c.status)
                            order by c.entry_no), '[]'::jsonb)
  into v_by
  from nexus.finance_entries c where c.corrects_entry_id = v_e.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'file_id', f.id, 'storage_path', f.storage_path, 'original_name', f.original_name,
           'size_bytes', f.size_bytes, 'mime_type', f.mime_type, 'attached_at', f.attached_at,
           'attached_by_name', nexus._fn_member_name(f.attached_by),
           'is_withdrawn', f.is_withdrawn, 'withdrawn_at', f.withdrawn_at,
           'withdrawn_by_name', case when f.is_withdrawn then nexus._fn_member_name(f.withdrawn_by) end,
           'withdraw_reason', f.withdraw_reason)
           order by f.id), '[]'::jsonb)
  into v_files_js
  from nexus.finance_entry_files f
  where f.entry_id = v_e.id and (not f.is_withdrawn or v_manage);

  select coalesce(jsonb_agg(jsonb_build_object(
           'history_id', h.id, 'at', h.occurred_at, 'kind', h.kind, 'actor_name', nexus._fn_member_name(h.actor_member_id),
           'note', h.note,
           'file_name', (select f.original_name from nexus.finance_entry_files f where f.id = h.file_id and (not f.is_withdrawn or v_manage)))
           order by h.id desc), '[]'::jsonb)
  into v_history
  from nexus.finance_entry_history h
  where h.entry_id = v_e.id and (h.kind <> 'file_withdrawn' or v_manage);

  return jsonb_build_object(
    'entry_id', v_e.id, 'number_text', v_e.number_text, 'entry_type', v_e.entry_type, 'amount', v_e.amount,
    'entry_date', v_e.entry_date, 'description', v_e.description, 'notes', v_e.notes, 'status', v_e.status,
    'void_reason', v_e.void_reason, 'voided_at', v_e.voided_at, 'voided_by_name', nexus._fn_member_name(v_e.voided_by),
    'corrects', v_corrects, 'corrected_by', v_by,
    'period_id', v_e.period_id, 'period_label', (select p.label from public.periods p where p.id = v_e.period_id),
    'is_active_period', nexus.is_active_period(v_e.period_id),
    'created_at', v_e.created_at, 'created_by_name', nexus._fn_member_name(v_e.created_by),
    'proof_count', v_files,
    'files', v_files_js,
    'history', v_history,
    'actions', jsonb_build_object(
      'can_void', v_writable,
      'can_add_proof', v_writable and v_files < 3,
      'can_withdraw_proof', v_writable and v_files > 0,
      'files_room', case when v_writable then greatest(3 - v_files, 0) else 0 end,
      -- F5: an Aktif entry of an OLD period gets "Buat koreksi" (only while a period is active)
      'can_correct', v_manage and v_period is not null and v_e.status = 'active' and v_e.entry_type <> 'opening'
                     and not nexus.is_active_period(v_e.period_id),
      -- F4: a voided entry gets "Catat ulang" (a copy in the record form)
      'can_rerecord', v_manage and v_period is not null and v_e.status = 'voided',
      'can_export', nexus.has_permission('finance.export')));
end
$$;

-- =============================================================================================
-- 6. Writes (finance.manage: role bendahara, D24). Each writes its history row(s) in the same
--    transaction. There is NO edit function (K2 a).
-- =============================================================================================

-- 6.1 Record (F2, F3, F5). p_entry_type income / expense / opening; p_amount = digits only (F1),
-- "1".."9999999999", or "0" for an opening balance only;
-- p_idempotency_key = one uuid per form submit (A-FN10); p_corrects_entry_id = "Koreksi atas" (F2 in the
-- header); files 0..3. Returns the entry, its number, and replayed = true when the key was seen before.
create or replace function nexus.finance_entry_record(
  p_idempotency_key   uuid,
  p_entry_type        text,
  p_entry_date        date,
  p_amount            text,
  p_description       text,
  p_notes             text  default null,
  p_corrects_entry_id uuid  default null,
  p_files             jsonb default null
)
returns table (entry_id uuid, number_text text, replayed boolean)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid;
  v_period uuid;
  v_type   text;
  v_amount bigint;
  v_date   date;
  v_desc   text;
  v_notes  text;
  v_target nexus.finance_entries;
  v_prior  nexus.finance_entries;
  v_files  jsonb;
  v_last   bigint;
  v_no     bigint;
  v_text   text;
  v_id     uuid;
begin
  perform nexus._require_permission('finance.manage');
  v_me := nexus._fn_require_member();
  v_period := nexus._fn_require_active_period();
  if p_idempotency_key is null then
    raise exception 'A submit key is required' using errcode = '22023', hint = 'invalid_input', detail = 'idempotency_key';
  end if;
  v_type := nexus._fn_type(p_entry_type, false);
  v_date := nexus._fn_check_entry_date(p_entry_date);
  v_amount := nexus._fn_parse_amount(p_amount);
  -- Owner 2026-11-10: Rp 0 only for the opening balance; income and expense start at Rp 1.
  if v_amount = 0 and v_type <> 'opening' then
    raise exception 'The amount must be at least 1 rupiah' using errcode = '22023', hint = 'invalid_amount', detail = 'amount';
  end if;
  v_desc := nexus._fn_required(nexus._fn_text(p_description, 200, 'description'), 'description', 'text_required');
  v_notes := nexus._fn_long_text(p_notes, 500, 'notes');
  if p_corrects_entry_id is not null then
    if v_type = 'opening' then
      raise exception 'An opening balance is not a correction' using errcode = '22023', hint = 'invalid_correction', detail = 'corrects_entry_id';
    end if;
    select e.* into v_target from nexus.finance_entries e where e.id = p_corrects_entry_id;
    if not found or v_target.status <> 'active' then
      raise exception 'The transaction to correct must exist and be Aktif' using errcode = '22023', hint = 'invalid_correction', detail = 'corrects_entry_id';
    end if;
  end if;

  -- R9: one save at a time takes a number. The double-submit check runs UNDER this lock, so a repeat
  -- that waited here sees the first save once it is committed.
  select c.last_value into v_last from nexus.finance_counter c where c.id for update;

  select e.* into v_prior from nexus.finance_entries e where e.created_by = v_me and e.idempotency_key = p_idempotency_key;
  if found then
    if (v_prior.entry_type, v_prior.amount, v_prior.entry_date, v_prior.description, v_prior.notes, v_prior.corrects_entry_id)
       is distinct from (v_type, v_amount, v_date, v_desc, v_notes, p_corrects_entry_id) then
      raise exception 'This submit key was already used for another transaction' using errcode = '22023', hint = 'idempotency_conflict';
    end if;
    return query select v_prior.id, v_prior.number_text, true;
    return;
  end if;

  if v_type = 'opening' and exists (select 1 from nexus.finance_entries e
                                    where e.period_id = v_period and e.entry_type = 'opening' and e.status = 'active') then
    raise exception 'The opening balance of this period is already recorded; void it first' using errcode = 'P0001', hint = 'opening_exists';
  end if;
  v_files := nexus._fn_check_files(p_files, v_me, 0, 3);

  v_no := v_last + 1;
  v_text := nexus._fn_number_text(v_no);
  insert into nexus.finance_entries (entry_no, number_text, entry_type, amount, entry_date, description, notes,
                                     corrects_entry_id, period_id, idempotency_key, created_by)
  values (v_no, v_text, v_type, v_amount, v_date, v_desc, v_notes, p_corrects_entry_id, v_period, p_idempotency_key, v_me)
  returning id into v_id;
  update nexus.finance_counter c set last_value = v_no, updated_by = v_me where c.id;
  perform nexus._fn_log(v_id, 'recorded', null, null);
  perform nexus._fn_attach_files(v_id, v_files);
  return query select v_id, v_text, false;
end
$$;

-- 6.2 Void (F4, A-FN7): Aktif entry of the ACTIVE period, reason required, never restored. Either
-- Treasurer may void the other's entry (K6 a). A second void answers state_changed.
create or replace function nexus.finance_entry_void(p_entry_id uuid, p_reason text)
returns table (entry_id uuid, status text)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid;
  v_e      nexus.finance_entries;
  v_reason text;
begin
  perform nexus._require_permission('finance.manage');
  v_me := nexus._fn_require_member();
  perform nexus._fn_require_active_period();
  v_e := nexus._fn_lock_entry(p_entry_id);
  if v_e.status <> 'active' then
    raise exception 'The transaction was already voided; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  perform nexus._fn_require_writable(v_e);
  v_reason := nexus._fn_required(nexus._fn_text(p_reason, 500, 'reason'), 'reason', 'reason_required');
  update nexus.finance_entries e
  set status = 'voided', void_reason = v_reason, voided_by = v_me, voided_at = now()
  where e.id = v_e.id;
  perform nexus._fn_log(v_e.id, 'voided', v_reason, null);
  return query select v_e.id, 'voided'::text;
end
$$;

-- 6.3 "Tambah bukti" (F6): Aktif entry of the active period, at most 3 visible proofs.
create or replace function nexus.finance_entry_add_proof(p_entry_id uuid, p_files jsonb)
returns table (entry_id uuid, proof_count integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me    uuid;
  v_e     nexus.finance_entries;
  v_files jsonb;
begin
  perform nexus._require_permission('finance.manage');
  v_me := nexus._fn_require_member();
  perform nexus._fn_require_active_period();
  v_e := nexus._fn_lock_entry(p_entry_id);
  perform nexus._fn_require_writable(v_e);
  v_files := nexus._fn_check_files(p_files, v_me, 1, 3 - nexus._fn_visible_file_count(v_e.id));
  perform nexus._fn_attach_files(v_e.id, v_files);
  return query select v_e.id, nexus._fn_visible_file_count(v_e.id);
end
$$;

-- 6.4 "Tarik berkas" (F6, F3 in the header): reason required; record and stored object stay (L5).
create or replace function nexus.finance_entry_withdraw_proof(p_file_id bigint, p_reason text)
returns table (entry_id uuid, proof_count integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid;
  v_file   nexus.finance_entry_files;
  v_e      nexus.finance_entries;
  v_reason text;
begin
  perform nexus._require_permission('finance.manage');
  v_me := nexus._fn_require_member();
  perform nexus._fn_require_active_period();
  select f.* into v_file from nexus.finance_entry_files f where f.id = p_file_id;
  if not found then
    raise exception 'File not found' using errcode = 'P0002', hint = 'file_not_found';
  end if;
  v_e := nexus._fn_lock_entry(v_file.entry_id);
  perform nexus._fn_require_writable(v_e);
  select f.* into v_file from nexus.finance_entry_files f where f.id = p_file_id for update;
  if v_file.is_withdrawn then
    raise exception 'The proof was already withdrawn; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  v_reason := nexus._fn_required(nexus._fn_text(p_reason, 500, 'reason'), 'reason', 'reason_required');
  update nexus.finance_entry_files f
  set is_withdrawn = true, withdrawn_by = v_me, withdrawn_at = now(), withdraw_reason = v_reason
  where f.id = p_file_id;
  perform nexus._fn_log(v_e.id, 'file_withdrawn', v_reason, p_file_id);
  return query select v_e.id, nexus._fn_visible_file_count(v_e.id);
end
$$;

-- =============================================================================================
-- 7. Export (F7, FN-28..FN-32). finance.export (BPH D03, Treasurers D25); the engine makes it work only
--    together with finance.view (R15). Same rows and order as the list of the selected period, all
--    pages. Every row repeats the whole-period summary computed in this call (F5). More than 1000 rows:
--    refused before any log row. One log row in the SAME transaction after the rows; if it fails, no
--    rows are returned. VOLATILE: call with .rpc() (POST).
-- =============================================================================================

create or replace function nexus.finance_export(
  p_format         text,
  p_period_id      uuid    default null,
  p_search         text    default null,
  p_type           text    default 'all',
  p_from           date    default null,
  p_to             date    default null,
  p_include_voided boolean default false,
  p_without_proof  boolean default false
)
returns table (
  row_no bigint, number_text text, entry_date date, entry_type text, description text, notes text, amount bigint,
  status text, void_reason text, corrects_number_text text, has_proof boolean, created_by_name text,
  created_at timestamptz, period_label text, summary_opening bigint, summary_income bigint, summary_expense bigint,
  summary_balance bigint, total_count bigint
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_format text;
  v_period uuid;
  v_type   text;
  v_member uuid;
  v_active uuid;
  v_total  bigint;
  v_t      record;
begin
  perform nexus._require_permission('finance.export');
  v_format := nexus._fn_export_format(p_format);
  v_member := nexus._fn_require_member();
  v_active := nexus._fn_require_active_period();
  v_period := nexus._fn_period(p_period_id);
  v_type := nexus._fn_type(p_type, true);
  perform nexus._fn_check_range(p_from, p_to);

  select count(*) into v_total
  from nexus._fn_rows(v_period, p_search, v_type, p_from, p_to, coalesce(p_include_voided, false), coalesce(p_without_proof, false));
  if v_total > nexus._fn_export_cap() then
    raise exception 'Too many rows for one file (%); narrow the date range', v_total
      using errcode = 'P0001', hint = 'too_many_rows', detail = v_total::text;
  end if;
  select * into v_t from nexus._fn_totals(v_period);

  return query
  select r.ordinal, r.number_text, r.entry_date, r.entry_type, r.description, r.notes, r.amount, r.status,
         r.void_reason, r.corrects_number_text, r.proof_count > 0, r.created_by_name, r.created_at, r.period_label,
         v_t.o_opening, v_t.o_income, v_t.o_expense, v_t.o_balance, count(*) over ()
  from nexus._fn_rows(v_period, p_search, v_type, p_from, p_to, coalesce(p_include_voided, false), coalesce(p_without_proof, false)) r
  order by r.ordinal;

  perform set_config('nexus.export_log_writer', 'finance_export', true);
  insert into nexus.finance_export_logs (exporter_member_id, format, filters, exported_period_id, row_count, period_id)
  values (v_member, v_format,
          jsonb_build_object('type', v_type, 'from', p_from, 'to', p_to,
                             'include_voided', coalesce(p_include_voided, false),
                             'without_proof', coalesce(p_without_proof, false),
                             'search_used', nexus._fn_search_pattern(p_search) is not null),
          v_period, v_total, v_active);
  perform set_config('nexus.export_log_writer', '', true);
  return;
end
$$;

-- =============================================================================================
-- 8. (reserved: no Dashboard function of its own; the card reads finance_summary() for the active
--    period, A-FN20.)
-- 9. Storage access checks for the bucket `nexus-finance-proofs` (used by the Storage RLS policies in
--    20261111200100). They never raise. Upload: a finance.manage holder, own folder only, while a
--    period is active, at most 10 unattached uploads of the last 24 hours in that folder (A-FN6).
--    Read: _fn_can_read_file. No update or delete policy.
-- =============================================================================================

create or replace function nexus.finance_proof_can_upload(p_object_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me         uuid := nexus.current_member_id();
  v_unattached integer;
begin
  if p_object_name is null or v_me is null
     or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'
     or split_part(p_object_name, '/', 1) <> v_me::text
     or nexus.active_period_id() is null
     or not nexus.has_permission('finance.manage') then
    return false;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select count(*)::int from storage.objects o
             where o.bucket_id = $1 and o.name like $2
               and coalesce(o.created_at, now()) > now() - interval ''24 hours''
               and not exists (select 1 from nexus.finance_entry_files f where f.storage_path = o.name)'
      into v_unattached using 'nexus-finance-proofs', v_me::text || '/%';
    if v_unattached >= 10 then
      return false;
    end if;
  end if;
  return true;
end
$$;

create or replace function nexus.finance_proof_can_read(p_object_name text)
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
  select f.id into v_id from nexus.finance_entry_files f where f.storage_path = p_object_name;
  if not found then
    return false;   -- an unattached upload is nobody's proof yet
  end if;
  return nexus._fn_can_read_file(v_id);
end
$$;

-- =============================================================================================
-- 10. Function privileges
-- =============================================================================================

do $$
declare
  f record;
  v_api text[] := array[
    'finance_period_list', 'finance_summary', 'finance_entry_list', 'finance_entry_detail',
    'finance_entry_record', 'finance_entry_void', 'finance_entry_add_proof', 'finance_entry_withdraw_proof',
    'finance_export', 'finance_proof_can_upload', 'finance_proof_can_read'];
begin
  for f in select p.oid::regprocedure as sig, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname = any (v_api) or p.proname like '\_fn\_%') loop
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
