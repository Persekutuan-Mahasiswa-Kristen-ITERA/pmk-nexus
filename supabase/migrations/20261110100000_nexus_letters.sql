-- PMK-NEXUS 0010: Letters / Surat Menyurat module (register, numbering, request flow, reads, export).
--
-- Spec:      docs/modules/letters.md (APPROVED 2026-11-09, incl. the "Ambil nomor" amendment G1):
--            sections 2, 3 (F1-F9), 4.1-4.4, 5 (R1-R20), 8, 9 (A-LT1..A-LT24), 10 (L1-L11), 10b, 11
--            (LT-01..LT-52). Design: docs/design/letters.md (screens 1-13, G2-G18, P1-P15).
--            docs/modules/access-control.md: keys letters.view / letters.manage / letters.export /
--            letter_requests.view_all / letter_requests.process (catalog of 20261105100000, unchanged),
--            default rules D06-D08 and D15-D23 (unchanged), locked rules L1, L4, L5, L6 (no processing of
--            your own request), L7 (old-period records read-only except open requests), L9 (own requests),
--            L11, L12; R11 (no active period), R15 (process includes view_all, export needs view).
-- Decisions: D-010, D-011, D-013, D-019 (export-log pattern), D-024 (numbering = settings, not code),
--            D-025 (+ amendment G1 "Ambil nomor").
-- PI-CORE:   verified against docs/picore/schema-report.md (pi-core-v2 migrations 20261031165546 ..
--            20261102090000, unchanged since 2026-11-04). Read here, only inside nexus functions:
--            members(id, full_name, is_active) for names and the "requester no longer active" marker
--            (design G12), periods(id, label, is_active) through the existing helpers. Never any contact
--            or identity-number column (L4). No foreign keys to PI-CORE; ids are plain uuid values.
--
-- Stored values are English identifiers; the UI maps them to Indonesian:
--   letter type     incoming = Surat Masuk, outgoing = Surat Keluar
--   letter status   active = Aktif, voided = Dibatalkan ("Batalkan nomor"; never restored, A-LT8)
--   request status  submitted = Diajukan, processing = Diproses, issued = Diterbitkan,
--                   rejected = Ditolak, cancelled = Dibatalkan
--   request event   submitted, processing, number_taken ("Ambil nomor"), issued, rejected, cancelled
--   letter history  registered, edited, file_added, file_withdrawn ("Ditarik"), voided
-- Derived states ("Menunggu file final", "Lewat tanggal", "Nomor dibatalkan") are computed on read with
-- the Asia/Jakarta date, never stored.
--
-- Numbering (D-024, spec 4.3, R2-R5, L7):
--   * Format = ONE settings row (prefix, type codes, digits, separator; the year is always included), not code. The
--     number text is built once and STORED, so a later format change never renumbers a letter.
--   * One counter row per (type, Jakarta calendar year). A number is assigned inside the same
--     transaction as the letter insert, under a row lock on that counter (SELECT ... FOR UPDATE), so two
--     secretaries never get the same number and a failed save uses none (everything rolls back).
--   * The counter only goes up (trigger), the number text is unique per type (index), and (type, year,
--     sequence) is unique for system numbers (index): a number is never reused, also after a void.
--   * The year is ALWAYS part of the number (owner decision 2026-11-09): CHECK on the settings row and
--     refusal `year_required` in letter_numbering_update_format(). Without it the yearly restart at 001
--     would repeat last year's texts.
--   * If a generated text already exists (a "Nomor lama" typed earlier that matches a future system
--     number), that sequence is skipped: the text belongs to the letter that already holds it.
--   * The System Admin may set the next sequence of the CURRENT year only upwards, with a reason
--     (L7, P11, G6); format and sequence changes are logged in an append-only history.
--   * "Nomor lama" (L7 b): a typed original number, unique per type, never moves the counter.
--
-- Security model (same as Inventory and Borrowing):
--   * Every write goes through a SECURITY DEFINER function below (search_path = ''). Clients have NO
--     insert/update/delete privilege on any table; tables have SELECT grants with RLS (default deny) as
--     a second, read-only door. The export log has no client grant at all.
--   * Each function checks L1 (active linked member), the permission key, the active period (R11), L6
--     (process, take number, reject, issue never on your own request), L9 (requester rights), L7
--     (letters of a non-active period are read-only; open requests stay actionable).
--   * Request and letter actions lock the row and compare a version number ("Data sudah berubah").
--   * Nothing is ever deleted (L5): every table refuses DELETE and TRUNCATE; history tables are
--     append-only; status and number columns are guarded by triggers.
--
-- Files (spec 4.4, L8): private bucket `nexus-letter-files` (created by 20261110100100). Upload path
-- "<uploader members.id>/<random uuid>.<pdf|jpg|jpeg|png>" (lowercase), uploaded when picked, BEFORE the
-- letter or request exists; the save function attaches the files of the caller's OWN folder only.
-- PDF, JPG, PNG, 5 MB each, at most 3 visible files per letter or request. The magic-byte check of the
-- real file type is done by the server code before upload (like Inventory); the database checks the
-- Storage metadata (type and size) where Storage is installed.
--
-- Decisions on points the spec left open (owner approved the migration 2026-11-09 with "year
-- mandatory"; the tech lead accepted the rest as built, 2026-11-09):
--   D1  A system number whose text already exists for the type (a "Nomor lama" typed ahead of the
--       counter) is skipped, not refused; the counter moves past it.
--   D2  Year mandatory in the number (see Numbering above).
--   D3  Files are uploaded before the letter or request exists, into the uploader's own folder
--       "<members.id>/<uuid>.<ext>"; a save attaches only the caller's own uploads.
--   D4  A letter whose request is still Diproses can be edited through the register; only void and
--       adding files are blocked there (A-LT24).
--   D5  letter_requests.view_all holders still read the file of a request-made letter after a void;
--       G5 hides it only from the requester.
--   D6  The export carries from_request (yes/no) instead of a request reference: requests have no
--       reference code (G2).
--   D7  The letter made by "Ambil nomor" gets today (Jakarta) as letter date; Terbitkan may correct it.
--   D8  The Dashboard "waiting requests" count goes to view_all holders (design G9 wins over L11, spec 10b).
--   D9  Setting the next number to exactly "last used + 1" is allowed: nothing moves, it only records
--       that the start was checked (clears the "never set" hint).
--   D10 A requester may cancel their own Diajukan request of a previous period (L9); like every write
--       it needs an active period.
--
-- Errors carry a stable hint (errcode): permission_required, not_system_admin, not_active_member,
-- self_processing_blocked, not_requester, closed_period, immutable_column, invalid_transition,
-- export_log_direct_insert, append_only (42501); letter_not_found, request_not_found, file_not_found
-- (P0002); no_active_period, state_changed, letter_voided, request_open, number_not_taken,
-- last_issued_file, too_many_open_requests, daily_request_limit, file_missing, numbering_exhausted
-- (P0001); duplicate_number (23505); invalid_type, invalid_input, text_required, text_too_long,
-- reason_required, note_required, date_required, date_in_future, date_in_past, invalid_dates,
-- invalid_file, file_too_large, file_required, file_count, file_already_attached, invalid_view,
-- invalid_status, invalid_period, invalid_year, year_not_current, sequence_not_higher,
-- invalid_number_format, year_required, format_collision, search_too_long, invalid_page, invalid_page_size,
-- invalid_format (22023). `detail` names the field, a count or a number text; never a person.
--
-- Re-runnable: create ... if not exists / or replace, guarded constraints and policies, the settings
-- row is inserted only when missing. Run as ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261110100000_nexus_letters.sql
-- Requires 20261105100000 .. 20261109100000 (uses nexus._require_permission from 20261106200000 and
-- nexus._jakarta_date from 20261107100100). No access-rule change: the keys and D06-D08, D15-D23 exist.

-- =============================================================================================
-- 1. Tables. Period-scoped: letters and requests (period at creation) and every history row (active
--    period at the time of the event). Numbering settings and counters are not period-scoped (the
--    number follows the calendar year, R6).
-- =============================================================================================

-- 1.1 Numbering format (D-024): exactly one row. Changed only by the System Admin through
-- letter_numbering_update_format(); every change is logged in letter_numbering_changes.
create table if not exists nexus.letter_numbering_settings (
  id               boolean primary key default true check (id),
  prefix           text not null check (prefix ~ '^[A-Za-z0-9/.-]{1,30}$'),
  incoming_code    text not null check (incoming_code ~ '^[A-Za-z0-9/.-]{1,10}$'),
  outgoing_code    text not null check (outgoing_code ~ '^[A-Za-z0-9/.-]{1,10}$'),
  seq_digits       integer not null check (seq_digits between 1 and 6),
  number_separator text not null check (number_separator in ('/', '-', '.')),
  include_year     boolean not null,
  version          integer not null default 1,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint letter_numbering_codes_differ check (lower(incoming_code) <> lower(outgoing_code))
);

-- Owner 2026-11-09: the year is mandatory (decision D2 in the header). Added by name in a guarded
-- block, so a database that ran an earlier draft of this file gets exactly the same constraint.
do $$
begin
  if not exists (select 1 from pg_constraint c
                 where c.conrelid = 'nexus.letter_numbering_settings'::regclass and c.conname = 'letter_numbering_year_required') then
    alter table nexus.letter_numbering_settings
      add constraint letter_numbering_year_required check (include_year);
  end if;
end
$$;

-- D-024 provisional format: PMK/NEX/SM/{year}/{seq} and PMK/NEX/SK/{year}/{seq}, three digits. Inserted
-- only when the row is missing, so a re-run never overwrites what the System Admin changed.
insert into nexus.letter_numbering_settings (id, prefix, incoming_code, outgoing_code, seq_digits, number_separator, include_year)
values (true, 'PMK/NEX', 'SM', 'SK', 3, '/', true)
on conflict (id) do nothing;

-- 1.2 Last used sequence per type and Jakarta calendar year (R4). A row exists once a number of that
-- year was issued or the System Admin set the start (that is the "never set" flag of design G6).
create table if not exists nexus.letter_number_counters (
  letter_type text not null check (letter_type in ('incoming', 'outgoing')),
  number_year integer not null check (number_year between 2000 and 2999),
  last_value  integer not null check (last_value between 0 and 9999999),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (letter_type, number_year)
);

-- 1.3 Numbering change history (P11): format changes and "Atur nomor berikutnya". Append-only.
create table if not exists nexus.letter_numbering_changes (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('format', 'next_sequence')),
  letter_type     text check (letter_type in ('incoming', 'outgoing')),
  number_year     integer check (number_year between 2000 and 2999),
  before_data     jsonb not null check (jsonb_typeof(before_data) = 'object'),
  after_data      jsonb not null check (jsonb_typeof(after_data) = 'object'),
  reason          text check (reason is null or (reason = btrim(reason) and char_length(reason) between 1 and 500)),
  actor_member_id uuid,
  occurred_at     timestamptz not null default now(),
  period_id       uuid,   -- settings work without an active period (access control AC-43)
  check ((kind = 'next_sequence') = (letter_type is not null and number_year is not null)),
  check (kind <> 'next_sequence' or reason is not null)
);
create index if not exists letter_numbering_changes_occurred_idx on nexus.letter_numbering_changes (occurred_at desc, id desc);

-- 1.4 Letter requests (F5-F7). Requester = members.id from the session. Never edited after submit
-- (A-LT10): only status, processor columns and the linked letter change. `version` changes on every
-- update (optimistic "Data sudah berubah" check).
create table if not exists nexus.letter_requests (
  id                  uuid primary key default gen_random_uuid(),
  requester_member_id uuid not null,
  subject             text not null check (subject = btrim(subject) and char_length(subject) between 1 and 200),
  addressee           text not null check (addressee = btrim(addressee) and char_length(addressee) between 1 and 150),
  purpose             text not null check (purpose = btrim(purpose) and char_length(purpose) between 1 and 1000),
  on_behalf_of        text check (on_behalf_of is null or (on_behalf_of = btrim(on_behalf_of) and char_length(on_behalf_of) between 1 and 120)),
  needed_by           date check (needed_by is null or (needed_by >= date '2000-01-01' and isfinite(needed_by))),
  status              text not null default 'submitted'
                      check (status in ('submitted', 'processing', 'issued', 'rejected', 'cancelled')),
  period_id           uuid not null,
  processed_by        uuid,          -- "Proses" (Diajukan -> Diproses)
  processed_at        timestamptz,
  letter_id           uuid,          -- set once by "Ambil nomor"; FK added below (circular reference)
  number_taken_by     uuid,
  number_taken_at     timestamptz,
  decided_by          uuid,          -- Terbitkan or Tolak
  decided_at          timestamptz,
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint letter_requests_number_taken check ((letter_id is null) = (number_taken_at is null and number_taken_by is null)),
  constraint letter_requests_processed check (status not in ('processing', 'issued') or processed_by is not null),
  constraint letter_requests_issued check (status <> 'issued' or letter_id is not null),
  constraint letter_requests_decided check (status not in ('issued', 'rejected') or (decided_by is not null and decided_at is not null))
);
create index if not exists letter_requests_requester_idx on nexus.letter_requests (requester_member_id, created_at desc);
create index if not exists letter_requests_status_idx on nexus.letter_requests (status, created_at);

-- 1.5 Register entries (F1-F4). number_text is stored, never recomputed (spec 4.1).
create table if not exists nexus.letters (
  id                 uuid primary key default gen_random_uuid(),
  letter_type        text not null check (letter_type in ('incoming', 'outgoing')),
  number_text        text not null check (number_text = btrim(number_text) and char_length(number_text) between 1 and 80),
  number_code        text,          -- type code used when the number was made (null for "Nomor lama")
  number_year        integer check (number_year between 2000 and 2999),
  number_seq         integer check (number_seq between 1 and 9999999),
  is_legacy_number   boolean not null default false,   -- "Nomor lama" (L7 b)
  letter_date        date check (letter_date is null or (letter_date >= date '2000-01-01' and isfinite(letter_date))),
  received_date      date check (received_date is null or (received_date >= date '2000-01-01' and isfinite(received_date))),
  counterpart        text not null check (counterpart = btrim(counterpart) and char_length(counterpart) between 1 and 150),
  counterpart_number text check (counterpart_number is null or (counterpart_number = btrim(counterpart_number) and char_length(counterpart_number) between 1 and 60)),
  subject            text not null check (subject = btrim(subject) and char_length(subject) between 1 and 200),
  notes              text check (notes is null or (notes = btrim(notes) and char_length(notes) between 1 and 500)),
  status             text not null default 'active' check (status in ('active', 'voided')),
  void_reason        text check (void_reason is null or (void_reason = btrim(void_reason) and char_length(void_reason) between 1 and 500)),
  voided_by          uuid,
  voided_at          timestamptz,
  source_request_id  uuid references nexus.letter_requests (id),
  period_id          uuid not null,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  created_by         uuid not null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  -- incoming: received date required; outgoing: letter date required, no received date / sender number
  constraint letters_by_type check (
       (letter_type = 'incoming' and received_date is not null and source_request_id is null)
    or (letter_type = 'outgoing' and letter_date is not null and received_date is null and counterpart_number is null)),
  constraint letters_number_parts check (
       (is_legacy_number and number_code is null and number_year is null and number_seq is null)
    or (not is_legacy_number and number_code is not null and number_year is not null and number_seq is not null)),
  constraint letters_legacy_not_from_request check (not is_legacy_number or source_request_id is null),
  constraint letters_void check ((status = 'voided') = (void_reason is not null and voided_by is not null and voided_at is not null))
);
-- R2/R5: a number text exists once per type (case-insensitive); a system sequence once per type and year.
create unique index if not exists letters_number_text_key on nexus.letters (letter_type, lower(number_text));
create unique index if not exists letters_number_seq_key on nexus.letters (letter_type, number_year, number_seq) where not is_legacy_number;
create unique index if not exists letters_source_request_key on nexus.letters (source_request_id) where source_request_id is not null;
create index if not exists letters_list_idx on nexus.letters (letter_type, created_at desc, id desc);

do $$
begin
  if not exists (select 1 from pg_constraint c
                 where c.conrelid = 'nexus.letter_requests'::regclass and c.conname = 'letter_requests_letter_fk') then
    alter table nexus.letter_requests
      add constraint letter_requests_letter_fk foreign key (letter_id) references nexus.letters (id);
  end if;
end
$$;

-- 1.6 Files of a letter or of a request (spec 4.4). One row = one stored object in the bucket. Never
-- deleted; a wrong letter file is withdrawn ("Ditarik") with a reason (A-LT9, L5).
create table if not exists nexus.letter_files (
  id              bigint generated always as identity primary key,
  letter_id       uuid references nexus.letters (id),
  request_id      uuid references nexus.letter_requests (id),
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
  constraint letter_files_one_parent check ((letter_id is null) <> (request_id is null)),
  constraint letter_files_withdrawn check (is_withdrawn = (withdrawn_by is not null and withdrawn_at is not null and withdraw_reason is not null)),
  constraint letter_files_withdraw_letters_only check (not is_withdrawn or letter_id is not null)
);
create index if not exists letter_files_letter_idx on nexus.letter_files (letter_id) where letter_id is not null;
create index if not exists letter_files_request_idx on nexus.letter_files (request_id) where request_id is not null;

-- 1.7 Letter history (spec 4.1, L6): registration, each edit (before/after of the changed fields),
-- file added / withdrawn, void. Append-only.
create table if not exists nexus.letter_history (
  id              bigint generated always as identity primary key,
  letter_id       uuid not null references nexus.letters (id),
  kind            text not null check (kind in ('registered', 'edited', 'file_added', 'file_withdrawn', 'voided')),
  before_data     jsonb check (before_data is null or jsonb_typeof(before_data) = 'object'),
  after_data      jsonb check (after_data is null or jsonb_typeof(after_data) = 'object'),
  note            text check (note is null or char_length(note) between 1 and 500),
  file_id         bigint references nexus.letter_files (id),
  request_id      uuid references nexus.letter_requests (id),
  actor_member_id uuid not null,
  occurred_at     timestamptz not null default now(),
  period_id       uuid not null
);
create index if not exists letter_history_letter_idx on nexus.letter_history (letter_id, id desc);

-- 1.8 Request status history = the request timeline (spec 4.1). "Ambil nomor" is an event without a
-- status change. Append-only.
create table if not exists nexus.letter_request_history (
  id              bigint generated always as identity primary key,
  request_id      uuid not null references nexus.letter_requests (id),
  event           text not null check (event in ('submitted', 'processing', 'number_taken', 'issued', 'rejected', 'cancelled')),
  from_status     text,
  to_status       text not null,
  actor_member_id uuid not null,
  occurred_at     timestamptz not null default now(),
  note            text check (note is null or char_length(note) between 1 and 500),
  letter_id       uuid references nexus.letters (id),
  period_id       uuid not null
);
create index if not exists letter_request_history_request_idx on nexus.letter_request_history (request_id, id);

-- 1.9 Export log (F8, LT-39): one row per SUCCESSFUL export. Ids and settings only: no names, no search
-- text, no exported rows. Separate from the other logs (each module keeps its own fixed columns).
create table if not exists nexus.letter_export_logs (
  id                 bigint generated always as identity primary key,
  exporter_member_id uuid not null,
  created_at         timestamptz not null default now(),
  letter_type        text not null check (letter_type in ('incoming', 'outgoing')),
  format             text not null check (format in ('xlsx', 'csv', 'pdf')),
  filters            jsonb not null check (jsonb_typeof(filters) = 'object'),
  row_count          integer not null check (row_count >= 0),
  period_id          uuid not null
);
create index if not exists letter_export_logs_created_idx on nexus.letter_export_logs (created_at desc, id desc);

comment on table nexus.letter_numbering_settings is 'Letter number format (D-024): one row, a setting not code. Changed only by the System Admin through letter_numbering_update_format().';
comment on table nexus.letter_number_counters is 'Last used sequence per letter type and Jakarta calendar year. Only goes up (trigger); locked FOR UPDATE while a number is assigned.';
comment on table nexus.letter_numbering_changes is 'Append-only history of numbering format changes and next-sequence settings (P11).';
comment on table nexus.letters is 'Letter register (D-025). Never deleted; voided with a reason. Number text stored, never recomputed. Written only by nexus.letter_* functions.';
comment on table nexus.letter_requests is 'Letter requests (D-025). requester_member_id = PI-CORE members.id (no FK). Never edited after submit. Written only by nexus.letter_request_* functions.';
comment on table nexus.letter_files is 'Files of letters and requests (bucket nexus-letter-files). Never deleted; letter files can be withdrawn with a reason.';
comment on table nexus.letter_export_logs is 'Letter register export log (F8). Append-only, no PII. Written only by letter_export(); no client grant.';

-- =============================================================================================
-- 2. Guard triggers (they fire for every writer: the functions, the SQL editor, the service role).
--    The owner could disable them (tamper-evident, not tamper-proof; supabase/README.md section 6).
-- =============================================================================================

create or replace function nexus._lt_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'letters' then
    -- R2/LT-17/LT-22: number, type, year, origin and period never change.
    if (new.id, new.letter_type, new.number_text, new.number_code, new.number_year, new.number_seq,
        new.is_legacy_number, new.source_request_id, new.period_id, new.created_at, new.created_by)
       is distinct from
       (old.id, old.letter_type, old.number_text, old.number_code, old.number_year, old.number_seq,
        old.is_legacy_number, old.source_request_id, old.period_id, old.created_at, old.created_by) then
      raise exception 'A letter number, type, period and origin never change' using errcode = '42501', hint = 'immutable_column';
    end if;
    -- A-LT8: a voided letter is read-only and is never restored.
    if old.status = 'voided' then
      raise exception 'A voided letter is read-only' using errcode = '42501', hint = 'immutable_column';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
  elsif tg_table_name = 'letter_requests' then
    -- A-LT10: a submitted request is never edited.
    if (new.id, new.requester_member_id, new.subject, new.addressee, new.purpose, new.on_behalf_of,
        new.needed_by, new.period_id, new.created_at)
       is distinct from
       (old.id, old.requester_member_id, old.subject, old.addressee, old.purpose, old.on_behalf_of,
        old.needed_by, old.period_id, old.created_at) then
      raise exception 'A submitted request is not edited (A-LT10); cancel and submit again' using errcode = '42501', hint = 'immutable_column';
    end if;
    if old.letter_id is not null and new.letter_id is distinct from old.letter_id then
      raise exception 'The number taken for a request never changes' using errcode = '42501', hint = 'immutable_column';
    end if;
    if old.status in ('issued', 'rejected', 'cancelled') then
      raise exception 'A closed request never changes' using errcode = '42501', hint = 'immutable_column';
    end if;
    -- Spec 4.2: the only status moves, whatever wrote the row.
    if new.status is distinct from old.status
       and (old.status, new.status) not in (('submitted', 'processing'), ('submitted', 'rejected'), ('submitted', 'cancelled'),
                                            ('processing', 'issued'), ('processing', 'rejected')) then
      raise exception 'Status change % -> % is not allowed', old.status, new.status using errcode = '42501', hint = 'invalid_transition';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
  elsif tg_table_name = 'letter_files' then
    -- Only the withdraw columns may change, once (LT-28: no replace, no un-withdraw).
    if (new.id, new.letter_id, new.request_id, new.storage_path, new.original_name, new.size_bytes,
        new.mime_type, new.attached_by, new.attached_at)
       is distinct from
       (old.id, old.letter_id, old.request_id, old.storage_path, old.original_name, old.size_bytes,
        old.mime_type, old.attached_by, old.attached_at)
       or old.is_withdrawn then
      raise exception 'A stored file is never replaced; withdraw it instead' using errcode = '42501', hint = 'immutable_column';
    end if;
  elsif tg_table_name = 'letter_numbering_settings' then
    if new.id is distinct from old.id then
      raise exception 'There is exactly one numbering settings row' using errcode = '42501', hint = 'immutable_column';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
  elsif tg_table_name = 'letter_number_counters' then
    -- R2: a sequence never goes back, so a number can never be issued twice.
    if (new.letter_type, new.number_year) is distinct from (old.letter_type, old.number_year)
       or new.last_value < old.last_value then
      raise exception 'A letter sequence never goes back' using errcode = '42501', hint = 'immutable_column';
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- Only letter_export() writes the export log (same idea as the other modules).
create or replace function nexus._lt_export_log_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('nexus.export_log_writer', true), '') is distinct from 'letter_export' then
    raise exception 'letter_export_logs is written only by letter_export()'
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
  foreach t in array array['letter_numbering_settings', 'letter_number_counters', 'letters', 'letter_requests',
                           'letter_files'] loop
    execute format('create or replace trigger %I before delete on nexus.%I for each row execute function nexus._append_only_guard()',
                   t || '_no_delete', t);
    execute format('create or replace trigger %I before truncate on nexus.%I for each statement execute function nexus._append_only_guard()',
                   t || '_no_truncate', t);
    execute format('create or replace trigger %I before update on nexus.%I for each row execute function nexus._lt_guard()',
                   t || '_10_guard', t);
  end loop;
  -- History and log tables: append-only (no update either).
  foreach t in array array['letter_numbering_changes', 'letter_history', 'letter_request_history', 'letter_export_logs'] loop
    execute format('create or replace trigger %I before update or delete on nexus.%I for each row execute function nexus._append_only_guard()',
                   t || '_no_change', t);
    execute format('create or replace trigger %I before truncate on nexus.%I for each statement execute function nexus._append_only_guard()',
                   t || '_no_truncate', t);
  end loop;
end
$$;

create or replace trigger letter_export_logs_10_insert_guard
  before insert on nexus.letter_export_logs
  for each row execute function nexus._lt_export_log_guard();

-- =============================================================================================
-- 3. Privileges and Row Level Security. Default deny everywhere; SELECT-only policies. No client
--    INSERT/UPDATE/DELETE grant on any table: writes happen inside the SECURITY DEFINER functions.
-- =============================================================================================

do $$
declare
  t text;
begin
  foreach t in array array['letter_numbering_settings', 'letter_number_counters', 'letter_numbering_changes',
                           'letter_requests', 'letters', 'letter_files', 'letter_history', 'letter_request_history',
                           'letter_export_logs'] loop
    execute format('revoke all on nexus.%I from public, anon, authenticated, service_role', t);
    execute format('alter table nexus.%I enable row level security', t);
    -- service_role: SELECT only (ops/backups), like every nexus table.
    execute format('grant select on nexus.%I to service_role', t);
    if t <> 'letter_export_logs' then
      execute format('grant select on nexus.%I to authenticated', t);
    end if;
  end loop;
end
$$;
revoke all on sequence nexus.letter_numbering_changes_id_seq, nexus.letter_files_id_seq, nexus.letter_history_id_seq,
  nexus.letter_request_history_id_seq, nexus.letter_export_logs_id_seq
  from public, anon, authenticated, service_role;

-- Policies. Each (select ...) runs once per statement. Child tables reuse the parent's policy through
-- EXISTS (the subquery is itself filtered by the parent's RLS).
do $$
declare
  v_policies text[][] := array[
    -- numbering: System Admin (edits) and letters.manage holders (read-only view, A-LT12)
    array['letter_numbering_settings', 'letter_numbering_settings_select',
          '(select nexus.is_system_admin()) or (select nexus.has_permission(''letters.manage''))'],
    array['letter_number_counters', 'letter_number_counters_select',
          '(select nexus.is_system_admin()) or (select nexus.has_permission(''letters.manage''))'],
    array['letter_numbering_changes', 'letter_numbering_changes_select',
          '(select nexus.is_system_admin()) or (select nexus.has_permission(''letters.manage''))'],
    -- register: letters.view (D06; included in letters.manage). Requesters never read the register (L9).
    array['letters', 'letters_select',
          '(select nexus.has_permission(''letters.view''))'],
    array['letter_history', 'letter_history_select',
          'exists (select 1 from nexus.letters l where l.id = letter_id)'],
    -- requests: own (L9, fixed) or letter_requests.view_all (D08; included in process)
    array['letter_requests', 'letter_requests_select',
          'requester_member_id = (select nexus.current_member_id()) or (select nexus.has_permission(''letter_requests.view_all''))'],
    array['letter_request_history', 'letter_request_history_select',
          'exists (select 1 from nexus.letter_requests r where r.id = request_id)'],
    -- files follow their parent; withdrawn letter files only for letters.manage (A-LT9)
    array['letter_files', 'letter_files_select',
          '(letter_id is not null and exists (select 1 from nexus.letters l where l.id = letter_id) and (not is_withdrawn or (select nexus.has_permission(''letters.manage'')))) or (request_id is not null and exists (select 1 from nexus.letter_requests r where r.id = request_id))']
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
-- letter_export_logs: no policy and no client grant (read through the database only until the log
-- screen exists, spec section 8 / A-MD14).

-- =============================================================================================
-- 4. Internal helpers (no EXECUTE for clients; called from the SECURITY DEFINER functions below).
--    Own small copies instead of the _ib_ helpers, so this module stays self-contained.
-- =============================================================================================

-- R16: "today" is the Asia/Jakarta calendar date (WIB, UTC+7, no DST), never the UTC date.
create or replace function nexus._lt_today()
returns date
language sql stable set search_path = ''
as $$ select nexus._jakarta_date(now()) $$;

-- A-LT1/R4: the numbering year is the Jakarta calendar year at the moment the number is assigned.
create or replace function nexus._lt_year_at(p_at timestamptz)
returns integer
language sql stable set search_path = ''
as $$ select extract(year from (p_at at time zone 'Asia/Jakarta'))::integer $$;

-- L1 for the fixed (key-less) rights of L9: an active, linked member.
create or replace function nexus._lt_require_member()
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

-- R7/R11: no letter or request is created or changed without an active period.
create or replace function nexus._lt_require_active_period()
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

-- Trimmed text, blank -> null; over the limit -> text_too_long (detail = field). A-LT18 limits.
-- btrim() with one argument strips SPACES only, so a value of only newline or tab characters passed as "not blank"
-- when the Server Action was bypassed (QA BUG-LT-01). Strip the same ASCII whitespace as JavaScript trim().
create or replace function nexus._lt_text(p_text text, p_max integer, p_field text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := nullif(btrim(p_text, E' \t\r\n\f\v'), '');
begin
  if char_length(v) > p_max then
    raise exception 'Text for % is too long (max % characters)', p_field, p_max
      using errcode = '22023', hint = 'text_too_long', detail = p_field;
  end if;
  return v;
end
$$;

create or replace function nexus._lt_required_text(p_text text, p_max integer, p_field text, p_hint text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := nexus._lt_text(p_text, p_max, p_field);
begin
  if v is null then
    raise exception 'Text for % is required', p_field using errcode = '22023', hint = p_hint, detail = p_field;
  end if;
  return v;
end
$$;

create or replace function nexus._lt_type(p_type text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := lower(btrim(p_type));
begin
  if v is null or v not in ('incoming', 'outgoing') then
    raise exception 'Letter type must be incoming or outgoing' using errcode = '22023', hint = 'invalid_type';
  end if;
  return v;
end
$$;

-- A-LT19 / design 7.4: a letter or received date is a real date from 2000 on and not after today
-- (Jakarta). p_required = false lets null pass.
create or replace function nexus._lt_check_past_date(p_date date, p_field text, p_required boolean)
returns date
language plpgsql stable set search_path = ''
as $$
begin
  if p_date is null then
    if p_required then
      raise exception 'Date % is required', p_field using errcode = '22023', hint = 'date_required', detail = p_field;
    end if;
    return null;
  end if;
  if not isfinite(p_date) or p_date < date '2000-01-01' then
    raise exception 'Date % is not a valid date', p_field using errcode = '22023', hint = 'invalid_dates', detail = p_field;
  end if;
  if p_date > nexus._lt_today() then
    raise exception 'Date % cannot be after today', p_field using errcode = '22023', hint = 'date_in_future', detail = p_field;
  end if;
  return p_date;
end
$$;

-- Search text: trimmed, inner whitespace collapsed, max 120 (raw max 480). Returns an ILIKE pattern
-- with %, _ and \ escaped, or null for "no search".
create or replace function nexus._lt_search_pattern(p_search text)
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

create or replace function nexus._lt_check_page(p_page integer, p_page_size integer)
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

create or replace function nexus._lt_export_format(p_format text)
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

-- Register filters (F1, design 5.1/G8): period "active" (default) or "all"; status all/active/voided.
create or replace function nexus._lt_period_filter(p_period text)
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

create or replace function nexus._lt_status_filter(p_status text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := coalesce(nullif(lower(btrim(p_status)), ''), 'all');
begin
  if v not in ('all', 'active', 'voided') then
    raise exception 'Status filter must be all, active or voided' using errcode = '22023', hint = 'invalid_status';
  end if;
  return v;
end
$$;

create or replace function nexus._lt_check_year(p_year integer)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_year is not null and (p_year < 2000 or p_year > 2999) then
    raise exception 'Year must be between 2000 and 2999' using errcode = '22023', hint = 'invalid_year';
  end if;
end
$$;

-- Current PI-CORE name. Name only; no other member column is read here (L4).
create or replace function nexus._lt_member_name(p_member_id uuid)
returns text
language sql stable set search_path = ''
as $$ select m.full_name from public.members m where m.id = p_member_id $$;

-- D-024: the number text from its parts. Past the digit count the sequence simply grows (spec 4.3):
-- lpad alone would cut "1000" to "100".
create or replace function nexus._lt_format_number(
  p_prefix text, p_code text, p_separator text, p_include_year boolean, p_digits integer, p_year integer, p_seq integer)
returns text
language sql immutable set search_path = ''
as $$
  select array_to_string(
           array[p_prefix, p_code]
           || case when p_include_year then array[p_year::text] else '{}'::text[] end
           || array[case when char_length(p_seq::text) >= p_digits then p_seq::text else lpad(p_seq::text, p_digits, '0') end],
           p_separator)
$$;

-- R2/R3/R4: assign the next number of a type, INSIDE the caller's transaction. The settings row is
-- held FOR SHARE (a format change waits until this letter is saved) and the counter row FOR UPDATE (a
-- second secretary waits here and then gets the next value). A text that already exists for this type
-- (a "Nomor lama" typed ahead of the counter, D1) is skipped: that number is already in the register.
-- Nothing is consumed if the caller's transaction later fails.
create or replace function nexus._lt_assign_number(
  p_type text, out o_text text, out o_code text, out o_year integer, out o_seq integer)
language plpgsql volatile set search_path = ''
as $$
declare
  v_set  nexus.letter_numbering_settings;
  v_last integer;
  v_next record;
begin
  select s.* into v_set from nexus.letter_numbering_settings s where s.id for share;
  if not found then
    raise exception 'The letter numbering settings are missing' using errcode = 'P0001', hint = 'numbering_exhausted';
  end if;
  o_year := nexus._lt_year_at(now());
  insert into nexus.letter_number_counters (letter_type, number_year, last_value, updated_by)
  values (p_type, o_year, 0, nexus.current_member_id())
  on conflict do nothing;
  select c.last_value into v_last
  from nexus.letter_number_counters c
  where c.letter_type = p_type and c.number_year = o_year
  for update;
  select * into v_next from nexus._lt_next_free(p_type, v_set, o_year, v_last);
  o_seq := v_next.o_seq;
  o_text := v_next.o_text;
  o_code := v_next.o_code;
  update nexus.letter_number_counters c
  set last_value = o_seq, updated_by = nexus.current_member_id()
  where c.letter_type = p_type and c.number_year = o_year;
end
$$;

-- Files given to a save function: p_files = [{"path": "<members.id>/<uuid>.pdf", "name": "surat.pdf"}].
-- Checks count (p_min..p_max), shape, the caller's OWN folder (nobody attaches another member's
-- upload), not attached before, and, where Storage is installed, that the object exists with an allowed
-- type matching the extension and at most 5 MB (L8 b). Returns the cleaned list for _lt_attach_files.
create or replace function nexus._lt_check_files(p_files jsonb, p_member uuid, p_min integer, p_max integer)
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
    raise exception 'At most % file(s) can be added here', p_max using errcode = '22023', hint = 'file_count', detail = p_max::text;
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
    if exists (select 1 from nexus.letter_files f where f.storage_path = v_path) then
      raise exception 'This file is already attached' using errcode = '22023', hint = 'file_already_attached', detail = v_path;
    end if;
    v_ext := substring(v_path from '\.([a-z]+)$');
    v_want := case v_ext when 'pdf' then 'application/pdf' when 'png' then 'image/png' else 'image/jpeg' end;
    v_size := null;
    v_mime := null;
    -- Without the storage schema (local dev stack with Storage off, bare test image) there are no
    -- objects at all, so the object check is skipped.
    if to_regclass('storage.objects') is not null then
      execute 'select (o.metadata ->> ''size'')::bigint, o.metadata ->> ''mimetype''
               from storage.objects o where o.bucket_id = $1 and o.name = $2'
        into v_size, v_mime using 'nexus-letter-files', v_path;
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

-- Letter history row. Actor and period from the session.
create or replace function nexus._lt_letter_log(
  p_letter_id uuid, p_kind text, p_before jsonb, p_after jsonb, p_note text, p_file_id bigint, p_request_id uuid)
returns void
language sql volatile set search_path = ''
as $$
  insert into nexus.letter_history (letter_id, kind, before_data, after_data, note, file_id, request_id, actor_member_id, period_id)
  values (p_letter_id, p_kind, p_before, p_after, p_note, p_file_id, p_request_id,
          nexus.current_member_id(), nexus.active_period_id())
$$;

-- Request timeline row.
create or replace function nexus._lt_request_log(
  p_request_id uuid, p_event text, p_from text, p_to text, p_note text, p_letter_id uuid)
returns void
language sql volatile set search_path = ''
as $$
  insert into nexus.letter_request_history (request_id, event, from_status, to_status, actor_member_id, note, letter_id, period_id)
  values (p_request_id, p_event, p_from, p_to, nexus.current_member_id(), p_note, p_letter_id, nexus.active_period_id())
$$;

-- Stores the files checked by _lt_check_files on a letter OR a request. A letter gets one history row
-- per file (design 6.3 "Berkas ditambahkan").
create or replace function nexus._lt_attach_files(p_letter_id uuid, p_request_id uuid, p_files jsonb, p_history_request uuid)
returns integer
language plpgsql volatile set search_path = ''
as $$
declare
  v_e  jsonb;
  v_id bigint;
  v_n  integer := 0;
begin
  for v_e in select e from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) e loop
    insert into nexus.letter_files (letter_id, request_id, storage_path, original_name, size_bytes, mime_type, attached_by)
    values (p_letter_id, p_request_id, v_e ->> 'path', v_e ->> 'name', (v_e ->> 'size')::integer, v_e ->> 'mime',
            nexus.current_member_id())
    returning id into v_id;
    if p_letter_id is not null then
      perform nexus._lt_letter_log(p_letter_id, 'file_added', null, jsonb_build_object('file_name', v_e ->> 'name'),
                                   null, v_id, p_history_request);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- Visible (not withdrawn) files of a letter.
create or replace function nexus._lt_visible_file_count(p_letter_id uuid)
returns integer
language sql stable set search_path = ''
as $$ select count(*)::int from nexus.letter_files f where f.letter_id = p_letter_id and not f.is_withdrawn $$;

-- Lock one letter for an action and check it is visible to the caller and still at the version the
-- caller saw. A letter the caller may not see answers "not found", exactly like a missing id.
create or replace function nexus._lt_lock_letter(p_letter_id uuid, p_version integer)
returns nexus.letters
language plpgsql volatile set search_path = ''
as $$
declare
  v_letter nexus.letters;
begin
  select l.* into v_letter from nexus.letters l where l.id = p_letter_id for update;
  if not found or not nexus.has_permission('letters.view') then
    raise exception 'Letter not found' using errcode = 'P0002', hint = 'letter_not_found';
  end if;
  if p_version is null or p_version <> v_letter.version then
    raise exception 'The letter changed in the meantime; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  return v_letter;
end
$$;

-- F4 / L7 / A-LT24: a register change (edit, file, void) needs an Aktif letter of the ACTIVE period;
-- file and void also need that no linked request is still open (Diproses).
create or replace function nexus._lt_require_editable(p_letter nexus.letters, p_check_open_request boolean)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_letter.status <> 'active' then
    raise exception 'A voided letter is read-only' using errcode = 'P0001', hint = 'letter_voided';
  end if;
  if not nexus.is_active_period(p_letter.period_id) then
    raise exception 'A letter of a previous period is read-only' using errcode = '42501', hint = 'closed_period';
  end if;
  if p_check_open_request and p_letter.source_request_id is not null
     and exists (select 1 from nexus.letter_requests r where r.id = p_letter.source_request_id and r.status = 'processing') then
    raise exception 'The request of this letter is still open; issue or reject the request instead'
      using errcode = 'P0001', hint = 'request_open';
  end if;
end
$$;

create or replace function nexus._lt_lock_request(p_request_id uuid, p_version integer)
returns nexus.letter_requests
language plpgsql volatile set search_path = ''
as $$
declare
  v_req nexus.letter_requests;
begin
  select r.* into v_req from nexus.letter_requests r where r.id = p_request_id for update;
  if not found
     or not (v_req.requester_member_id = nexus.current_member_id() or nexus.has_permission('letter_requests.view_all')) then
    raise exception 'Request not found' using errcode = 'P0002', hint = 'request_not_found';
  end if;
  if p_version is null or p_version <> v_req.version then
    raise exception 'The request changed in the meantime; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  return v_req;
end
$$;

create or replace function nexus._lt_require_status(p_actual text, p_allowed text[])
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if not (p_actual = any (p_allowed)) then
    raise exception 'The request is % and cannot do this now; reload', p_actual
      using errcode = 'P0001', hint = 'state_changed', detail = p_actual;
  end if;
end
$$;

-- L6 (locked): process, take a number, reject and issue are never allowed on the caller's own request,
-- whatever the rules say. Reuses the engine helper (matches on members.id).
create or replace function nexus._lt_require_not_own(p_requester uuid)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not nexus.can_process_request('letter_requests.process', p_requester) then
    raise exception 'You cannot process your own letter request (L6)'
      using errcode = '42501', hint = 'self_processing_blocked';
  end if;
end
$$;

-- Read rule for one stored file (spec 4.4, L11, G5). Used by the detail functions and the Storage
-- SELECT policy, so they can never disagree:
--   request attachment: the requester and letter_requests.view_all holders;
--   withdrawn letter file: letters.manage only (A-LT9);
--   letter file: letters.view holders; for a letter made from a request also view_all holders, and the
--   requester once the request is Diterbitkan and the letter is still Aktif (L9; never after a void).
create or replace function nexus._lt_can_read_file(p_file_id bigint)
returns boolean
language plpgsql stable set search_path = ''
as $$
declare
  v_me   uuid := nexus.current_member_id();
  v_file nexus.letter_files;
  v_l    nexus.letters;
  v_r    nexus.letter_requests;
begin
  if v_me is null then
    return false;
  end if;
  select f.* into v_file from nexus.letter_files f where f.id = p_file_id;
  if not found then
    return false;
  end if;
  if v_file.request_id is not null then
    select r.* into v_r from nexus.letter_requests r where r.id = v_file.request_id;
    return coalesce(v_r.requester_member_id = v_me, false) or nexus.has_permission('letter_requests.view_all');
  end if;
  if v_file.is_withdrawn then
    return nexus.has_permission('letters.manage');
  end if;
  if nexus.has_permission('letters.view') then
    return true;
  end if;
  select l.* into v_l from nexus.letters l where l.id = v_file.letter_id;
  if v_l.source_request_id is null then
    return false;
  end if;
  if nexus.has_permission('letter_requests.view_all') then
    return true;
  end if;
  select r.* into v_r from nexus.letter_requests r where r.id = v_l.source_request_id;
  return coalesce(v_r.requester_member_id = v_me and v_r.status = 'issued' and v_l.status = 'active', false);
end
$$;

-- File objects of a letter or request that the caller may read, oldest first (detail screens).
create or replace function nexus._lt_files_json(p_letter_id uuid, p_request_id uuid)
returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'file_id', f.id, 'storage_path', f.storage_path, 'original_name', f.original_name,
           'size_bytes', f.size_bytes, 'mime_type', f.mime_type, 'attached_at', f.attached_at,
           'attached_by_name', nexus._lt_member_name(f.attached_by),
           'is_withdrawn', f.is_withdrawn, 'withdrawn_at', f.withdrawn_at,
           'withdrawn_by_name', case when f.is_withdrawn then nexus._lt_member_name(f.withdrawn_by) end,
           'withdraw_reason', f.withdraw_reason)
           order by f.id), '[]'::jsonb)
  from nexus.letter_files f
  where ((p_letter_id is not null and f.letter_id = p_letter_id) or (p_request_id is not null and f.request_id = p_request_id))
    and nexus._lt_can_read_file(f.id)
$$;

-- =============================================================================================
-- 5. Shared row builders (list and export use the same rows, order and filters, so they can never
--    disagree; R15/LT-38). No permission check here: callers check first.
-- =============================================================================================

-- Register rows (F1, design screen 2). Newest registered first (G8). Search: number, counterpart,
-- Perihal only (LT-25). Without files = no visible file. awaiting_final_file = the letter's request is
-- still Diproses ("Menunggu file final").
create or replace function nexus._lt_letter_rows(
  p_type text, p_search text, p_period_id uuid, p_all_periods boolean, p_year integer, p_status text, p_without_files boolean)
returns table (
  ordinal bigint, letter_id uuid, letter_type text, number_text text, is_legacy_number boolean, number_year integer,
  letter_date date, received_date date, counterpart text, counterpart_number text, subject text, notes text,
  status text, void_reason text, voided_at timestamptz, period_id uuid, period_label text, source_request_id uuid,
  awaiting_final_file boolean, file_count integer, created_at timestamptz, created_by_name text, version integer
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_pattern text := nexus._lt_search_pattern(p_search);
begin
  return query
  with base as (
    select l.*,
           (select count(*)::int from nexus.letter_files f where f.letter_id = l.id and not f.is_withdrawn) as fc,
           exists (select 1 from nexus.letter_requests r where r.id = l.source_request_id and r.status = 'processing') as awaiting
    from nexus.letters l
    where l.letter_type = p_type
      and (p_all_periods or l.period_id = p_period_id)
      and (p_year is null or l.number_year = p_year)
      and (p_status = 'all' or l.status = p_status)
      and (v_pattern is null
           or l.number_text ilike v_pattern escape '\'
           or l.counterpart ilike v_pattern escape '\'
           or l.subject ilike v_pattern escape '\')
  )
  select row_number() over (order by b.created_at desc, b.id desc),
         b.id, b.letter_type, b.number_text, b.is_legacy_number, b.number_year, b.letter_date, b.received_date,
         b.counterpart, b.counterpart_number, b.subject, b.notes, b.status, b.void_reason, b.voided_at,
         b.period_id, p.label, b.source_request_id, b.awaiting, b.fc, b.created_at, m.full_name, b.version
  from base b
  left join public.periods p on p.id = b.period_id
  left join public.members m on m.id = b.created_by
  where not p_without_files or b.fc = 0;
end
$$;

-- Request rows (F6, F7, design screens 7, 8). Names from PI-CORE at read time (D-010). note = the
-- latest processor note (Proses, Terbitkan or Tolak). is_past_due = "Lewat tanggal" (P15, Jakarta).
create or replace function nexus._lt_request_rows(p_requester uuid, p_statuses text[], p_period_id uuid, p_request_id uuid)
returns table (
  request_id uuid, status text, version integer, period_id uuid, period_label text,
  requester_member_id uuid, requester_name text, requester_is_active boolean,
  subject text, addressee text, purpose text, on_behalf_of text, needed_by date,
  created_at timestamptz, updated_at timestamptz, processed_at timestamptz, processed_by_name text,
  letter_id uuid, number_text text, letter_status text, number_taken_at timestamptz, number_taken_by_name text,
  decided_at timestamptz, decided_by_name text, attachment_count integer, has_issued_file boolean,
  note text, note_by_name text, note_at timestamptz, is_past_due boolean, days_past_due integer
)
language sql stable set search_path = ''
as $$
  with
  today as (select nexus._lt_today() as d),
  req as (
    select r.*
    from nexus.letter_requests r
    where (p_requester is null or r.requester_member_id = p_requester)
      and (p_statuses is null or r.status = any (p_statuses))
      and (p_period_id is null or r.period_id = p_period_id)
      and (p_request_id is null or r.id = p_request_id)
  )
  select r.id, r.status, r.version, r.period_id, p.label,
         r.requester_member_id, m.full_name, coalesce(m.is_active, false),
         r.subject, r.addressee, r.purpose, r.on_behalf_of, r.needed_by,
         r.created_at, r.updated_at, r.processed_at, pm.full_name,
         r.letter_id, l.number_text, l.status, r.number_taken_at, tm.full_name,
         r.decided_at, dm.full_name,
         (select count(*)::int from nexus.letter_files f where f.request_id = r.id),
         -- coalesce: a comparison with a null (no letter, no needed-by date) must give false, never
         -- null (fixed 2026-11-10: an open request without "Dibutuhkan paling lambat" returned null).
         coalesce(r.status = 'issued' and l.status = 'active'
                  and exists (select 1 from nexus.letter_files f where f.letter_id = l.id and not f.is_withdrawn), false),
         n.note, nm.full_name, n.occurred_at,
         coalesce(r.status in ('submitted', 'processing') and r.needed_by < (select d from today), false),
         case when coalesce(r.status in ('submitted', 'processing') and r.needed_by < (select d from today), false)
              then (select d from today) - r.needed_by else 0 end
  from req r
  left join public.periods p on p.id = r.period_id
  left join public.members m on m.id = r.requester_member_id
  left join public.members pm on pm.id = r.processed_by
  left join public.members tm on tm.id = r.number_taken_by
  left join public.members dm on dm.id = r.decided_by
  left join nexus.letters l on l.id = r.letter_id
  left join lateral (
    select h.note, h.actor_member_id, h.occurred_at
    from nexus.letter_request_history h
    where h.request_id = r.id and h.note is not null and h.event in ('processing', 'issued', 'rejected')
    order by h.id desc
    limit 1
  ) n on true
  left join public.members nm on nm.id = n.actor_member_id
$$;

-- Queue views (F6, design 11.1). One definition for the list and the counts.
--   submitted        Menunggu: Diajukan, all periods, oldest first (default)
--   processing       Sedang diproses: Diproses WITHOUT a number, oldest first
--   awaiting_file    Menunggu file final: Diproses WITH a number, oldest number first
--   closed           Selesai: Diterbitkan, Ditolak, Dibatalkan, all periods, newest change first
--   all              Semua: everything of the ACTIVE period, newest first
--   open_all_periods Belum selesai (semua periode): Diajukan + Diproses, oldest period first (A-LT21)
-- Open requests stay visible across periods on purpose (L7: they stay actionable after a switch).
-- Search: requester name or Perihal. Dates: submitted (Jakarta date) within [p_from, p_to].
create or replace function nexus._lt_queue_rows(p_view text, p_search text, p_from date, p_to date)
returns table (
  ordinal bigint, request_id uuid, status text, version integer, period_id uuid, period_label text,
  requester_member_id uuid, requester_name text, requester_is_active boolean,
  subject text, addressee text, purpose text, on_behalf_of text, needed_by date,
  created_at timestamptz, updated_at timestamptz, processed_at timestamptz, processed_by_name text,
  letter_id uuid, number_text text, letter_status text, number_taken_at timestamptz, number_taken_by_name text,
  decided_at timestamptz, decided_by_name text, attachment_count integer, has_issued_file boolean,
  note text, note_by_name text, note_at timestamptz, is_past_due boolean, days_past_due integer
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_view    text := coalesce(nullif(lower(btrim(p_view)), ''), 'submitted');
  v_pattern text := nexus._lt_search_pattern(p_search);
  v_period  uuid := nexus.active_period_id();
begin
  if v_view not in ('submitted', 'processing', 'awaiting_file', 'closed', 'all', 'open_all_periods') then
    raise exception 'Unknown view' using errcode = '22023', hint = 'invalid_view';
  end if;
  if (p_from is null) <> (p_to is null) or p_to < p_from
     or (p_from is not null and (not isfinite(p_from) or not isfinite(p_to) or p_from < date '2000-01-01')) then
    raise exception 'Choose both dates, the end not before the start' using errcode = '22023', hint = 'invalid_dates';
  end if;
  if v_view = 'all' and v_period is null then
    return;
  end if;

  return query
  select row_number() over (order by
           case when v_view = 'open_all_periods' then x.period_label end asc nulls last,
           case when v_view in ('submitted', 'processing', 'open_all_periods') then x.created_at end asc,
           case when v_view = 'awaiting_file' then x.number_taken_at end asc,
           case when v_view = 'closed' then x.updated_at end desc,
           case when v_view = 'all' then x.created_at end desc,
           x.created_at, x.request_id),
         x.*
  from nexus._lt_request_rows(null,
         case v_view when 'submitted' then array['submitted']
                     when 'processing' then array['processing'] when 'awaiting_file' then array['processing']
                     when 'closed' then array['issued', 'rejected', 'cancelled']
                     when 'open_all_periods' then array['submitted', 'processing']
                     else null end,
         case when v_view = 'all' then v_period end, null) x
  where case v_view
          when 'processing' then x.letter_id is null
          when 'awaiting_file' then x.letter_id is not null
          else true
        end
    and (v_pattern is null
         or x.requester_name ilike v_pattern escape '\'
         or x.subject ilike v_pattern escape '\')
    and (p_from is null or nexus._jakarta_date(x.created_at) between p_from and p_to);
end
$$;

-- Request caps (L10 b): ONE definition for the create function and the form's pre-check read, so they
-- can never disagree.
create or replace function nexus._lt_caps(out o_open_limit integer, out o_daily_limit integer)
language sql immutable set search_path = ''
as $$ select 5, 10 $$;

-- The member's open (Diajukan or Diproses) requests and requests created on the current Jakarta day.
create or replace function nexus._lt_request_counts(p_member uuid, out o_open integer, out o_today integer)
language sql stable set search_path = ''
as $$
  select (count(*) filter (where r.status in ('submitted', 'processing')))::int,
         (count(*) filter (where nexus._jakarta_date(r.created_at) = nexus._lt_today()))::int
  from nexus.letter_requests r
  where r.requester_member_id = p_member
$$;

-- =============================================================================================
-- 6. Register reads (letters.view: BPH D06, included in letters.manage)
-- =============================================================================================

-- 6.1 Register list (F1, design screen 2). Page size 1..50 (default 20, A-LT15); a page past the end
-- returns the last page. p_period: active (default) / all; p_status: all (default) / active / voided;
-- p_year: year in the number (legacy numbers have none); p_without_files: "Tanpa berkas".
-- from_request = "Dari permohonan"; the request itself is shown only to view_all holders (detail).
create or replace function nexus.letter_list(
  p_type          text,
  p_search        text    default null,
  p_period        text    default 'active',
  p_year          integer default null,
  p_status        text    default 'all',
  p_without_files boolean default false,
  p_page          integer default 1,
  p_page_size     integer default 20
)
returns table (
  row_no bigint, letter_id uuid, letter_type text, number_text text, is_legacy_number boolean, number_year integer,
  letter_date date, received_date date, counterpart text, counterpart_number text, subject text, status text,
  period_id uuid, period_label text, from_request boolean, awaiting_final_file boolean, file_count integer,
  created_at timestamptz, version integer, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_type   text;
  v_all    boolean;
  v_status text;
begin
  perform nexus._require_permission('letters.view');
  v_type := nexus._lt_type(p_type);
  v_all := nexus._lt_period_filter(p_period);
  v_status := nexus._lt_status_filter(p_status);
  perform nexus._lt_check_year(p_year);
  perform nexus._lt_check_page(p_page, p_page_size);
  return query
  with
  o as (select * from nexus._lt_letter_rows(v_type, p_search, nexus.active_period_id(), v_all, p_year, v_status,
                                            coalesce(p_without_files, false))),
  t as (select count(*) as n from o),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select o.ordinal, o.letter_id, o.letter_type, o.number_text, o.is_legacy_number, o.number_year, o.letter_date,
         o.received_date, o.counterpart, o.counterpart_number, o.subject, o.status, o.period_id, o.period_label,
         o.source_request_id is not null, o.awaiting_final_file, o.file_count, o.created_at, o.version,
         t.n, pg.pno, p_page_size
  from o cross join t cross join pg
  where o.ordinal > (pg.pno - 1)::bigint * p_page_size and o.ordinal <= pg.pno::bigint * p_page_size
  order by o.ordinal;
end
$$;

-- 6.2 Years that exist in the register for a type ("Tahun nomor" filter), newest first.
create or replace function nexus.letter_year_list(p_type text)
returns table (number_year integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_type text;
begin
  perform nexus._require_permission('letters.view');
  v_type := nexus._lt_type(p_type);
  return query
  select distinct l.number_year from nexus.letters l
  where l.letter_type = v_type and l.number_year is not null
  order by l.number_year desc;
end
$$;

-- 6.3 Letter detail (design screen 3) as one JSON object: fields, files the caller may read (withdrawn
-- ones only for managers), history newest first (actor = PI-CORE name only), the linked request only
-- for view_all holders, and `actions` = which buttons exist for this caller now (the write functions
-- re-check everything anyway).
create or replace function nexus.letter_detail(p_letter_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_manage   boolean;
  v_view_all boolean;
  v_l        nexus.letters;
  v_req      nexus.letter_requests;
  v_open     boolean := false;
  v_files    integer;
  v_editable boolean;
  v_history  jsonb;
begin
  perform nexus._require_permission('letters.view');
  v_manage := nexus.has_permission('letters.manage');
  v_view_all := nexus.has_permission('letter_requests.view_all');
  select l.* into v_l from nexus.letters l where l.id = p_letter_id;
  if not found then
    raise exception 'Letter not found' using errcode = 'P0002', hint = 'letter_not_found';
  end if;
  if v_l.source_request_id is not null then
    select r.* into v_req from nexus.letter_requests r where r.id = v_l.source_request_id;
    v_open := v_req.status = 'processing';
  end if;
  v_files := nexus._lt_visible_file_count(v_l.id);
  v_editable := v_manage and v_l.status = 'active' and nexus.is_active_period(v_l.period_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'history_id', h.id, 'at', h.occurred_at, 'kind', h.kind, 'actor_name', nexus._lt_member_name(h.actor_member_id),
           'before', h.before_data, 'after', h.after_data, 'note', h.note,
           'file_name', (select f.original_name from nexus.letter_files f where f.id = h.file_id))
           order by h.id desc), '[]'::jsonb)
  into v_history
  from nexus.letter_history h
  where h.letter_id = v_l.id;

  return jsonb_build_object(
    'letter_id', v_l.id, 'letter_type', v_l.letter_type, 'number_text', v_l.number_text,
    'is_legacy_number', v_l.is_legacy_number, 'number_year', v_l.number_year,
    'letter_date', v_l.letter_date, 'received_date', v_l.received_date,
    'counterpart', v_l.counterpart, 'counterpart_number', v_l.counterpart_number,
    'subject', v_l.subject, 'notes', v_l.notes, 'status', v_l.status,
    'void_reason', v_l.void_reason, 'voided_at', v_l.voided_at, 'voided_by_name', nexus._lt_member_name(v_l.voided_by),
    'period_id', v_l.period_id, 'period_label', (select p.label from public.periods p where p.id = v_l.period_id),
    'is_active_period', nexus.is_active_period(v_l.period_id),
    'created_at', v_l.created_at, 'created_by_name', nexus._lt_member_name(v_l.created_by),
    'updated_at', v_l.updated_at, 'updated_by_name', nexus._lt_member_name(v_l.updated_by),
    'version', v_l.version,
    'from_request', v_l.source_request_id is not null,
    'awaiting_final_file', v_open,
    'request', case when v_view_all and v_l.source_request_id is not null then jsonb_build_object(
                 'request_id', v_req.id, 'subject', v_req.subject, 'status', v_req.status,
                 'requester_name', nexus._lt_member_name(v_req.requester_member_id)) end,
    'file_count', v_files,
    'files', nexus._lt_files_json(v_l.id, null),
    'history', v_history,
    'actions', jsonb_build_object(
      'can_edit', v_editable,
      'can_add_files', v_editable and not v_open and v_files < 3,
      'can_withdraw_files', v_editable and not v_open and v_files > 0,
      'can_void', v_editable and not v_open,
      'files_room', greatest(3 - v_files, 0)));
end
$$;

-- 6.4 Dashboard card and header tiles (L11, design 3.1 and 15, G9): Aktif letters of the active
-- period per type, voided counts for the "{n} dibatalkan" note, and for view_all holders the Diajukan
-- requests of ALL periods. Counts only, never a title, counterpart or number.
create or replace function nexus.letter_dashboard_counts()
returns table (
  period_id uuid, period_label text, incoming_count integer, outgoing_count integer,
  incoming_voided_count integer, outgoing_voided_count integer, waiting_request_count integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_period uuid;
begin
  perform nexus._require_permission('letters.view');
  v_period := nexus.active_period_id();
  return query
  select v_period,
         (select p.label from public.periods p where p.id = v_period),
         (count(*) filter (where l.letter_type = 'incoming' and l.status = 'active'))::int,
         (count(*) filter (where l.letter_type = 'outgoing' and l.status = 'active'))::int,
         (count(*) filter (where l.letter_type = 'incoming' and l.status = 'voided'))::int,
         (count(*) filter (where l.letter_type = 'outgoing' and l.status = 'voided'))::int,
         case when nexus.has_permission('letter_requests.view_all')
              then (select count(*)::int from nexus.letter_requests r where r.status = 'submitted') end
  from nexus.letters l
  where l.period_id = v_period;
end
$$;

-- =============================================================================================
-- 7. Register writes (letters.manage: BPH secretaries D15, D18, D21). Every one writes a letter
--    history row in the same transaction.
-- =============================================================================================

-- 7.1 Register an incoming (F2) or outgoing (F3, L4) letter directly. The number is assigned by the
-- system at save (never typed), except for "Nomor lama" (p_legacy_number, L7 b): typed as on the old
-- letter, unique per type (case-insensitive), does not move the counter. Files optional (0..3).
--   incoming: p_received_date required, p_letter_date optional, p_counterpart = sender,
--             p_counterpart_number = the sender's own number (optional)
--   outgoing: p_letter_date required, p_counterpart = addressee, p_received_date and
--             p_counterpart_number must be empty
-- Dates: not after today (Jakarta), from 2000 on. Returns the stored number (success message).
create or replace function nexus.letter_register(
  p_type               text,
  p_subject            text,
  p_counterpart        text,
  p_letter_date        date  default null,
  p_received_date      date  default null,
  p_counterpart_number text  default null,
  p_notes              text  default null,
  p_files              jsonb default null,
  p_legacy_number      text  default null
)
returns table (letter_id uuid, number_text text, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me       uuid;
  v_period   uuid;
  v_type     text;
  v_subject  text;
  v_cp       text;
  v_cp_no    text;
  v_notes    text;
  v_ldate    date;
  v_rdate    date;
  v_legacy   text;
  v_files    jsonb;
  v_num      record;
  v_text     text;
  v_id       uuid;
begin
  perform nexus._require_permission('letters.manage');
  v_me := nexus._lt_require_member();
  v_period := nexus._lt_require_active_period();
  v_type := nexus._lt_type(p_type);
  v_subject := nexus._lt_required_text(p_subject, 200, 'subject', 'text_required');
  v_cp := nexus._lt_required_text(p_counterpart, 150, 'counterpart', 'text_required');
  v_notes := nexus._lt_text(p_notes, 500, 'notes');
  if v_type = 'incoming' then
    v_rdate := nexus._lt_check_past_date(p_received_date, 'received_date', true);
    v_ldate := nexus._lt_check_past_date(p_letter_date, 'letter_date', false);
    v_cp_no := nexus._lt_text(p_counterpart_number, 60, 'counterpart_number');
  else
    v_ldate := nexus._lt_check_past_date(p_letter_date, 'letter_date', true);
    if p_received_date is not null then
      raise exception 'An outgoing letter has no received date' using errcode = '22023', hint = 'invalid_input', detail = 'p_received_date';
    end if;
    if nexus._lt_text(p_counterpart_number, 60, 'counterpart_number') is not null then
      raise exception 'An outgoing letter has no sender number' using errcode = '22023', hint = 'invalid_input', detail = 'p_counterpart_number';
    end if;
  end if;
  -- "Nomor lama": inner whitespace collapsed so "045 /PMK" and "045  /PMK" are the same number.
  v_legacy := nexus._lt_text(regexp_replace(coalesce(p_legacy_number, ''), '\s+', ' ', 'g'), 60, 'legacy_number');
  v_files := nexus._lt_check_files(p_files, v_me, 0, 3);

  if v_legacy is not null then
    if exists (select 1 from nexus.letters l where l.letter_type = v_type and lower(l.number_text) = lower(v_legacy)) then
      raise exception 'This number is already in the register' using errcode = '23505', hint = 'duplicate_number', detail = v_legacy;
    end if;
    begin
      insert into nexus.letters (letter_type, number_text, is_legacy_number, letter_date, received_date, counterpart,
                                 counterpart_number, subject, notes, period_id, created_by, updated_by)
      values (v_type, v_legacy, true, v_ldate, v_rdate, v_cp, v_cp_no, v_subject, v_notes, v_period, v_me, v_me)
      returning id into v_id;
    exception when unique_violation then
      -- Two managers typing the same old number at the same moment: the index decides.
      raise exception 'This number is already in the register' using errcode = '23505', hint = 'duplicate_number', detail = v_legacy;
    end;
    v_text := v_legacy;
  else
    select * into v_num from nexus._lt_assign_number(v_type);
    insert into nexus.letters (letter_type, number_text, number_code, number_year, number_seq, letter_date, received_date,
                               counterpart, counterpart_number, subject, notes, period_id, created_by, updated_by)
    values (v_type, v_num.o_text, v_num.o_code, v_num.o_year, v_num.o_seq, v_ldate, v_rdate,
            v_cp, v_cp_no, v_subject, v_notes, v_period, v_me, v_me)
    returning id into v_id;
    v_text := v_num.o_text;
  end if;

  perform nexus._lt_letter_log(v_id, 'registered', null,
                               jsonb_build_object('number_text', v_text, 'is_legacy_number', v_legacy is not null),
                               null, null, null);
  perform nexus._lt_attach_files(v_id, null, v_files, null);
  return query select l.id, l.number_text, l.status, l.version from nexus.letters l where l.id = v_id;
end
$$;

-- 7.2 Edit details (F4.1, L6, G3): only an Aktif letter of the ACTIVE period. Send every field as on the
-- form; nothing changed = no save and no history row (changed = false). Number, type and year are
-- never editable (not even parameters).
create or replace function nexus.letter_update(
  p_letter_id          uuid,
  p_version            integer,
  p_subject            text,
  p_counterpart        text,
  p_letter_date        date default null,
  p_received_date      date default null,
  p_counterpart_number text default null,
  p_notes              text default null
)
returns table (letter_id uuid, changed boolean, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_l       nexus.letters;
  v_subject text;
  v_cp      text;
  v_cp_no   text;
  v_notes   text;
  v_ldate   date;
  v_rdate   date;
  v_before  jsonb := '{}'::jsonb;
  v_after   jsonb := '{}'::jsonb;
begin
  perform nexus._require_permission('letters.manage');
  perform nexus._lt_require_active_period();
  v_l := nexus._lt_lock_letter(p_letter_id, p_version);
  perform nexus._lt_require_editable(v_l, false);
  v_subject := nexus._lt_required_text(p_subject, 200, 'subject', 'text_required');
  v_cp := nexus._lt_required_text(p_counterpart, 150, 'counterpart', 'text_required');
  v_notes := nexus._lt_text(p_notes, 500, 'notes');
  if v_l.letter_type = 'incoming' then
    v_rdate := nexus._lt_check_past_date(p_received_date, 'received_date', true);
    v_ldate := nexus._lt_check_past_date(p_letter_date, 'letter_date', false);
    v_cp_no := nexus._lt_text(p_counterpart_number, 60, 'counterpart_number');
  else
    v_ldate := nexus._lt_check_past_date(p_letter_date, 'letter_date', true);
    if p_received_date is not null then
      raise exception 'An outgoing letter has no received date' using errcode = '22023', hint = 'invalid_input', detail = 'p_received_date';
    end if;
    if nexus._lt_text(p_counterpart_number, 60, 'counterpart_number') is not null then
      raise exception 'An outgoing letter has no sender number' using errcode = '22023', hint = 'invalid_input', detail = 'p_counterpart_number';
    end if;
  end if;

  if v_subject is distinct from v_l.subject then
    v_before := v_before || jsonb_build_object('subject', v_l.subject); v_after := v_after || jsonb_build_object('subject', v_subject);
  end if;
  if v_cp is distinct from v_l.counterpart then
    v_before := v_before || jsonb_build_object('counterpart', v_l.counterpart); v_after := v_after || jsonb_build_object('counterpart', v_cp);
  end if;
  if v_cp_no is distinct from v_l.counterpart_number then
    v_before := v_before || jsonb_build_object('counterpart_number', v_l.counterpart_number); v_after := v_after || jsonb_build_object('counterpart_number', v_cp_no);
  end if;
  if v_notes is distinct from v_l.notes then
    v_before := v_before || jsonb_build_object('notes', v_l.notes); v_after := v_after || jsonb_build_object('notes', v_notes);
  end if;
  if v_ldate is distinct from v_l.letter_date then
    v_before := v_before || jsonb_build_object('letter_date', v_l.letter_date); v_after := v_after || jsonb_build_object('letter_date', v_ldate);
  end if;
  if v_rdate is distinct from v_l.received_date then
    v_before := v_before || jsonb_build_object('received_date', v_l.received_date); v_after := v_after || jsonb_build_object('received_date', v_rdate);
  end if;
  if v_after = '{}'::jsonb then
    return query select v_l.id, false, v_l.version;
    return;
  end if;

  update nexus.letters l
  set subject = v_subject, counterpart = v_cp, counterpart_number = v_cp_no, notes = v_notes,
      letter_date = v_ldate, received_date = v_rdate, updated_by = nexus.current_member_id()
  where l.id = v_l.id;
  perform nexus._lt_letter_log(v_l.id, 'edited', v_before, v_after, null, null, null);
  return query select l.id, true, l.version from nexus.letters l where l.id = v_l.id;
end
$$;

-- 7.3 "Tambah berkas" (F4.2): Aktif letter of the active period, no open request (A-LT24), at most 3
-- visible files (withdrawn ones do not count, G4). One history row per file.
create or replace function nexus.letter_add_files(p_letter_id uuid, p_version integer, p_files jsonb)
returns table (letter_id uuid, file_count integer, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me    uuid;
  v_l     nexus.letters;
  v_files jsonb;
begin
  perform nexus._require_permission('letters.manage');
  v_me := nexus._lt_require_member();
  perform nexus._lt_require_active_period();
  v_l := nexus._lt_lock_letter(p_letter_id, p_version);
  perform nexus._lt_require_editable(v_l, true);
  v_files := nexus._lt_check_files(p_files, v_me, 1, 3 - nexus._lt_visible_file_count(v_l.id));
  perform nexus._lt_attach_files(v_l.id, null, v_files, null);
  update nexus.letters l set updated_by = v_me where l.id = v_l.id;   -- bumps the version
  return query select l.id, nexus._lt_visible_file_count(l.id), l.version from nexus.letters l where l.id = v_l.id;
end
$$;

-- 7.4 "Tarik berkas" (F4.2, A-LT9, G4): reason required; the record and the stored object stay. The
-- last visible file of a letter made from a request cannot be withdrawn until a replacement is added.
-- p_version = the letter's version.
create or replace function nexus.letter_withdraw_file(p_file_id bigint, p_version integer, p_reason text)
returns table (letter_id uuid, file_count integer, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid;
  v_file   nexus.letter_files;
  v_l      nexus.letters;
  v_reason text;
begin
  perform nexus._require_permission('letters.manage');
  v_me := nexus._lt_require_member();
  perform nexus._lt_require_active_period();
  select f.* into v_file from nexus.letter_files f where f.id = p_file_id;
  if not found or v_file.letter_id is null then
    raise exception 'File not found' using errcode = 'P0002', hint = 'file_not_found';
  end if;
  v_l := nexus._lt_lock_letter(v_file.letter_id, p_version);
  perform nexus._lt_require_editable(v_l, true);
  select f.* into v_file from nexus.letter_files f where f.id = p_file_id for update;
  if v_file.is_withdrawn then
    raise exception 'The file was already withdrawn; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  v_reason := nexus._lt_required_text(p_reason, 500, 'reason', 'reason_required');
  if v_l.source_request_id is not null and nexus._lt_visible_file_count(v_l.id) <= 1 then
    raise exception 'This is the only file the requester sees; add a replacement first'
      using errcode = 'P0001', hint = 'last_issued_file';
  end if;
  update nexus.letter_files f
  set is_withdrawn = true, withdrawn_by = v_me, withdrawn_at = now(), withdraw_reason = v_reason
  where f.id = p_file_id;
  perform nexus._lt_letter_log(v_l.id, 'file_withdrawn', null, jsonb_build_object('file_name', v_file.original_name),
                               v_reason, p_file_id, null);
  update nexus.letters l set updated_by = v_me where l.id = v_l.id;
  return query select l.id, nexus._lt_visible_file_count(l.id), l.version from nexus.letters l where l.id = v_l.id;
end
$$;

-- 7.5 "Batalkan nomor" (F4.3, A-LT8, A-LT11, A-LT24): reason required; the row stays as Dibatalkan, the
-- number stays used, files stay. Refused while the linked request is Diproses (reject it instead). The
-- letter behind a Diterbitkan request may be voided: the request stays Diterbitkan ("Nomor dibatalkan").
create or replace function nexus.letter_void(p_letter_id uuid, p_version integer, p_reason text)
returns table (letter_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid;
  v_l      nexus.letters;
  v_reason text;
begin
  perform nexus._require_permission('letters.manage');
  v_me := nexus._lt_require_member();
  perform nexus._lt_require_active_period();
  v_l := nexus._lt_lock_letter(p_letter_id, p_version);
  perform nexus._lt_require_editable(v_l, true);
  v_reason := nexus._lt_required_text(p_reason, 500, 'reason', 'reason_required');
  update nexus.letters l
  set status = 'voided', void_reason = v_reason, voided_by = v_me, voided_at = now(), updated_by = v_me
  where l.id = v_l.id;
  perform nexus._lt_letter_log(v_l.id, 'voided', null, null, v_reason, null, null);
  return query select l.id, l.status, l.version from nexus.letters l where l.id = v_l.id;
end
$$;

-- =============================================================================================
-- 8. Request reads
-- =============================================================================================

-- 8.1 "Permohonan Saya" (F7, L9, design screen 7). Every active member, OWN requests only. Filter
-- open (Diajukan, Diproses) / closed / all (default). Order: open first, then closed, newest first.
-- number_text appears as soon as the number is taken (Diproses) and stays for Diterbitkan; it is not
-- returned after a rejection (the number is void, G5). number_voided = "Nomor dibatalkan" (A-LT11).
create or replace function nexus.letter_my_requests(
  p_filter    text    default 'all',
  p_page      integer default 1,
  p_page_size integer default 20
)
returns table (
  row_no bigint, request_id uuid, status text, version integer, period_label text, subject text, addressee text,
  on_behalf_of text, needed_by date, created_at timestamptz, processed_by_name text, number_text text,
  number_voided boolean, has_issued_file boolean, attachment_count integer, note text, note_by_name text,
  note_at timestamptz, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid := nexus._lt_require_member();
  v_filter text := coalesce(nullif(lower(btrim(p_filter)), ''), 'all');
begin
  if v_filter not in ('open', 'closed', 'all') then
    raise exception 'Filter must be open, closed or all' using errcode = '22023', hint = 'invalid_view';
  end if;
  perform nexus._lt_check_page(p_page, p_page_size);
  return query
  with
  r as (
    select x.*, x.status in ('submitted', 'processing') as is_open
    from nexus._lt_request_rows(v_me,
           case v_filter when 'open' then array['submitted', 'processing']
                         when 'closed' then array['issued', 'rejected', 'cancelled'] end,
           null, null) x
  ),
  o as (
    select r.*, row_number() over (order by (not r.is_open)::int, r.created_at desc, r.request_id) as rn
    from r
  ),
  t as (select count(*) as n from o),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select o.rn, o.request_id, o.status, o.version, o.period_label, o.subject, o.addressee, o.on_behalf_of,
         o.needed_by, o.created_at, o.processed_by_name,
         case when o.status in ('processing', 'issued') then o.number_text end,
         coalesce(o.status = 'issued' and o.letter_status = 'voided', false),
         o.has_issued_file, o.attachment_count, o.note, o.note_by_name, o.note_at,
         t.n, pg.pno, p_page_size
  from o cross join t cross join pg
  where o.rn > (pg.pno - 1)::bigint * p_page_size and o.rn <= pg.pno::bigint * p_page_size
  order by o.rn;
end
$$;

-- 8.1b Caps pre-check for the request form (design 3.4: the cap alert above the form). Every active
-- member, about themselves only. can_submit = an active period exists and both counts are under their
-- limit; letter_request_create re-checks everything under its lock anyway.
create or replace function nexus.letter_my_request_caps()
returns table (
  open_count integer, open_limit integer, today_count integer, daily_limit integer,
  has_active_period boolean, can_submit boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid := nexus._lt_require_member();
  v_caps   record;
  v_counts record;
  v_period boolean := nexus.active_period_id() is not null;
begin
  select * into v_caps from nexus._lt_caps();
  select * into v_counts from nexus._lt_request_counts(v_me);
  return query
  select v_counts.o_open, v_caps.o_open_limit, v_counts.o_today, v_caps.o_daily_limit, v_period,
         v_period and v_counts.o_open < v_caps.o_open_limit and v_counts.o_today < v_caps.o_daily_limit;
end
$$;

-- 8.2 Queue (F6, design screen 8). letter_requests.view_all (BPH D08, included in process). Views: see
-- _lt_queue_rows (default submitted = "Menunggu"). is_own marks the caller's own ("Pengajuanmu"); the
-- buttons for them are absent (L6). requester_is_active feeds the G12 marker.
-- period_total_count = rows of the WHOLE filtered result in that row's period (the handover group
-- headers, design 11.3), not only the page. letter_status / number_voided: the linked register row
-- (an OPEN request's letter is always Aktif: the register refuses a void while Diproses and Tolak closes
-- the request in the same transaction, so "Nomor dibatalkan" can only show in "Selesai").
-- The result columns changed after the first local apply (2026-11-10): drop the old shape so a re-run
-- can recreate it (create or replace cannot change result columns). Nothing depends on it.
drop function if exists nexus.letter_request_queue(text, text, date, date, integer, integer);
create or replace function nexus.letter_request_queue(
  p_view      text    default 'submitted',
  p_search    text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_page      integer default 1,
  p_page_size integer default 20
)
returns table (
  row_no bigint, request_id uuid, status text, version integer, period_id uuid, period_label text,
  requester_member_id uuid, requester_name text, requester_is_active boolean, is_own boolean,
  subject text, addressee text, on_behalf_of text, needed_by date, is_past_due boolean, days_past_due integer,
  attachment_count integer, number_text text, number_taken_at timestamptz, number_taken_by_name text,
  letter_status text, number_voided boolean,
  processed_by_name text, created_at timestamptz, updated_at timestamptz,
  period_total_count bigint, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid;
begin
  perform nexus._require_permission('letter_requests.view_all');
  v_me := nexus.current_member_id();
  perform nexus._lt_check_page(p_page, p_page_size);
  return query
  with
  q as (select x.*, count(*) over (partition by x.period_id) as per_period
        from nexus._lt_queue_rows(p_view, p_search, p_from, p_to) x),
  t as (select count(*) as n from q),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select q.ordinal, q.request_id, q.status, q.version, q.period_id, q.period_label,
         q.requester_member_id, q.requester_name, q.requester_is_active, q.requester_member_id = v_me,
         q.subject, q.addressee, q.on_behalf_of, q.needed_by, q.is_past_due, q.days_past_due,
         q.attachment_count, q.number_text, q.number_taken_at, q.number_taken_by_name,
         q.letter_status, coalesce(q.status = 'issued' and q.letter_status = 'voided', false),
         q.processed_by_name, q.created_at, q.updated_at, q.per_period, t.n, pg.pno, p_page_size
  from q cross join t cross join pg
  where q.ordinal > (pg.pno - 1)::bigint * p_page_size and q.ordinal <= pg.pno::bigint * p_page_size
  order by q.ordinal;
end
$$;

-- 8.3 Counts for the "Tampilkan" options, the "Antrean (n)" badge and the lone-processor hint (design
-- 4.4, 3.4, 11.1). action_needed = Diajukan of all periods that are NOT the caller's own, only for
-- process holders (0 for view_all only). process_holder_count = members holding
-- letter_requests.process now (count only, never names; A-n9).
create or replace function nexus.letter_request_queue_counts()
returns table (
  submitted integer, processing integer, awaiting_file integer, open_all_periods integer,
  action_needed integer, process_holder_count integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me      uuid;
  v_process boolean;
begin
  perform nexus._require_permission('letter_requests.view_all');
  v_me := nexus.current_member_id();
  v_process := nexus.has_permission('letter_requests.process');
  return query
  select (count(*) filter (where r.status = 'submitted'))::int,
         (count(*) filter (where r.status = 'processing' and r.letter_id is null))::int,
         (count(*) filter (where r.status = 'processing' and r.letter_id is not null))::int,
         (count(*) filter (where r.status in ('submitted', 'processing')))::int,
         (count(*) filter (where v_process and r.status = 'submitted' and r.requester_member_id <> v_me))::int,
         (select count(distinct x.member_id)::int from nexus._rule_matches(null, true, false) x
          where x.permission_key = 'letter_requests.process')
  from nexus.letter_requests r
  where r.status in ('submitted', 'processing');
end
$$;

-- 8.4 Request detail (design screens 7 and 9) as one JSON object. Visible to the requester (L9) and to
-- letter_requests.view_all holders; anybody else gets "not found" (same as a missing id).
-- The requester sees: fields, status, timeline (names of the secretaries, G11), the latest processor
-- note, the number from "Ambil nomor" on (not after a rejection), and the issued files only while the
-- request is Diterbitkan and the letter is Aktif (G5). The void reason of the letter is never shown here.
-- view_all holders additionally get letter_id, requester_is_active (G12) and the past-due flag (P15).
create or replace function nexus.letter_request_detail(p_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me         uuid := nexus._lt_require_member();
  v_view_all   boolean := nexus.has_permission('letter_requests.view_all');
  v_process    boolean := nexus.has_permission('letter_requests.process');
  v_period     uuid := nexus.active_period_id();
  v_req        nexus.letter_requests;
  v_row        record;
  v_own        boolean;
  v_can        boolean;
  v_timeline   jsonb;
  v_processors integer;
begin
  select r.* into v_req from nexus.letter_requests r where r.id = p_request_id;
  if not found or not (v_req.requester_member_id = v_me or v_view_all) then
    raise exception 'Request not found' using errcode = 'P0002', hint = 'request_not_found';
  end if;
  select * into v_row from nexus._lt_request_rows(null, null, null, p_request_id) x;
  v_own := v_req.requester_member_id = v_me;
  v_can := v_period is not null and v_process and not v_own;

  -- Timeline, oldest first. number_taken carries the number text (design 10.2 keeps the entry).
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', h.occurred_at, 'event', h.event, 'from_status', h.from_status, 'to_status', h.to_status,
           'actor_name', nexus._lt_member_name(h.actor_member_id), 'note', h.note,
           'number_text', case when h.event = 'number_taken' then (select l.number_text from nexus.letters l where l.id = h.letter_id) end)
           order by h.id), '[]'::jsonb)
  into v_timeline
  from nexus.letter_request_history h
  where h.request_id = p_request_id;

  -- A-n9 hint: how many OTHER members hold letter_requests.process right now (count only).
  if v_req.status in ('submitted', 'processing') and (v_process or v_own) then
    select count(distinct x.member_id)::int into v_processors
    from nexus._rule_matches(null, true, false) x
    where x.permission_key = 'letter_requests.process' and x.member_id <> v_req.requester_member_id;
  end if;

  return jsonb_build_object(
    'request_id', v_req.id, 'status', v_req.status, 'version', v_req.version,
    'period_id', v_req.period_id, 'period_label', v_row.period_label,
    'is_active_period', nexus.is_active_period(v_req.period_id),
    'requester_member_id', v_req.requester_member_id, 'requester_name', v_row.requester_name,
    'requester_is_active', case when v_view_all then v_row.requester_is_active end,
    'is_own', v_own,
    'subject', v_req.subject, 'addressee', v_req.addressee, 'purpose', v_req.purpose,
    'on_behalf_of', v_req.on_behalf_of, 'needed_by', v_req.needed_by, 'created_at', v_req.created_at,
    'is_past_due', case when v_view_all then v_row.is_past_due end,
    'days_past_due', case when v_view_all then v_row.days_past_due end,
    'processed_at', v_req.processed_at, 'processed_by_name', v_row.processed_by_name,
    'number_text', case when v_req.status in ('processing', 'issued') then v_row.number_text end,
    'number_taken_at', v_req.number_taken_at, 'number_taken_by_name', v_row.number_taken_by_name,
    'number_voided', coalesce(v_req.status = 'issued' and v_row.letter_status = 'voided', false),
    'letter_id', case when v_view_all then v_req.letter_id end,
    'decided_at', v_req.decided_at, 'decided_by_name', v_row.decided_by_name,
    'note', v_row.note, 'note_by_name', v_row.note_by_name, 'note_at', v_row.note_at,
    'attachments', nexus._lt_files_json(null, v_req.id),
    'letter_files', case when v_req.letter_id is not null then nexus._lt_files_json(v_req.letter_id, null) else '[]'::jsonb end,
    -- The register row's CURRENT values (it may have been edited through the register while Diproses,
    -- D4): the Terbitkan form prefills from here and sends letter.version back as p_letter_version.
    'letter', case when v_view_all and v_req.letter_id is not null then (
                select jsonb_build_object(
                         'letter_id', l.id, 'number_text', l.number_text, 'status', l.status, 'subject', l.subject,
                         'counterpart', l.counterpart, 'letter_date', l.letter_date,
                         'file_count', nexus._lt_visible_file_count(l.id), 'version', l.version, 'period_id', l.period_id)
                from nexus.letters l where l.id = v_req.letter_id) end,
    'timeline', v_timeline,
    'other_processor_count', v_processors,
    'actions', jsonb_build_object(
      'can_cancel', v_period is not null and v_own and v_req.status = 'submitted',
      'can_process', v_can and v_req.status = 'submitted',
      'can_take_number', v_can and v_req.status = 'processing' and v_req.letter_id is null,
      'can_issue', v_can and v_req.status = 'processing' and v_req.letter_id is not null,
      'can_reject', v_can and v_req.status in ('submitted', 'processing')));
end
$$;

-- =============================================================================================
-- 9. Request state machine (spec 4.2). Every function: L1, key (or L9 fixed right), active period
--    (R11), row lock + version on the request, allowed starting status, L6 for the processor actions.
--    Each returns the new status and version so the screen can continue without a reload.
-- =============================================================================================

-- 9.1 New request -> Diajukan (F5, L3 b, L9). Any active member, for themselves only (requester and
-- period from the session, never from the client). Caps (L10 b): at most 5 open (Diajukan or Diproses)
-- and 10 new per Jakarta day; an advisory lock serialises one member's parallel submits. Attachments
-- 0..3 from the caller's own upload folder. "Dibutuhkan paling lambat" not before today (design 9.2).
create or replace function nexus.letter_request_create(
  p_subject      text,
  p_addressee    text,
  p_purpose      text,
  p_on_behalf_of text  default null,
  p_needed_by    date  default null,
  p_files        jsonb default null
)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me      uuid := nexus._lt_require_member();
  v_period  uuid;
  v_subject text;
  v_to      text;
  v_purpose text;
  v_behalf  text;
  v_files   jsonb;
  v_id      uuid;
  v_caps    record;
  v_counts  record;
begin
  v_period := nexus._lt_require_active_period();
  v_subject := nexus._lt_required_text(p_subject, 200, 'subject', 'text_required');
  v_to := nexus._lt_required_text(p_addressee, 150, 'addressee', 'text_required');
  v_purpose := nexus._lt_required_text(p_purpose, 1000, 'purpose', 'text_required');
  v_behalf := nexus._lt_text(p_on_behalf_of, 120, 'on_behalf_of');
  if p_needed_by is not null then
    if not isfinite(p_needed_by) then
      raise exception 'Not a valid date' using errcode = '22023', hint = 'invalid_dates', detail = 'needed_by';
    end if;
    if p_needed_by < nexus._lt_today() then
      raise exception 'The date cannot be before today' using errcode = '22023', hint = 'date_in_past', detail = 'needed_by';
    end if;
  end if;
  v_files := nexus._lt_check_files(p_files, v_me, 0, 3);

  perform pg_advisory_xact_lock(hashtextextended('nexus.letter_request_create:' || v_me::text, 0));
  select * into v_caps from nexus._lt_caps();
  select * into v_counts from nexus._lt_request_counts(v_me);
  if v_counts.o_open >= v_caps.o_open_limit then
    raise exception 'You already have % letter requests in progress', v_caps.o_open_limit using errcode = 'P0001',
      hint = 'too_many_open_requests', detail = v_caps.o_open_limit::text;
  end if;
  if v_counts.o_today >= v_caps.o_daily_limit then
    raise exception 'At most % letter requests per day', v_caps.o_daily_limit using errcode = 'P0001',
      hint = 'daily_request_limit', detail = v_caps.o_daily_limit::text;
  end if;

  insert into nexus.letter_requests (requester_member_id, subject, addressee, purpose, on_behalf_of, needed_by, period_id)
  values (v_me, v_subject, v_to, v_purpose, v_behalf, p_needed_by, v_period)
  returning id into v_id;
  perform nexus._lt_attach_files(null, v_id, v_files, null);
  perform nexus._lt_request_log(v_id, 'submitted', null, 'submitted', null, null);
  return query select v_id, 'submitted'::text, 1;
end
$$;

-- 9.2 Diajukan -> Dibatalkan (F7.3, L9, A-LT6). The requester only, only while Diajukan; reason optional.
create or replace function nexus.letter_request_cancel(p_request_id uuid, p_version integer, p_reason text default null)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid := nexus._lt_require_member();
  v_req    nexus.letter_requests;
  v_reason text := nexus._lt_text(p_reason, 500, 'reason');
begin
  perform nexus._lt_require_active_period();
  v_req := nexus._lt_lock_request(p_request_id, p_version);
  if v_req.requester_member_id is distinct from v_me then
    raise exception 'Only the requester can cancel a request' using errcode = '42501', hint = 'not_requester';
  end if;
  perform nexus._lt_require_status(v_req.status, array['submitted']);
  update nexus.letter_requests r set status = 'cancelled' where r.id = p_request_id;
  perform nexus._lt_request_log(p_request_id, 'cancelled', 'submitted', 'cancelled', v_reason, null);
  return query select r.id, r.status, r.version from nexus.letter_requests r where r.id = p_request_id;
end
$$;

-- 9.3 "Proses": Diajukan -> Diproses (F6.3). letter_requests.process, never own (L6); optional note.
-- From here the requester can no longer cancel.
create or replace function nexus.letter_request_process(p_request_id uuid, p_version integer, p_note text default null)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req  nexus.letter_requests;
  v_note text;
begin
  perform nexus._require_permission('letter_requests.process');
  perform nexus._lt_require_active_period();
  v_note := nexus._lt_text(p_note, 500, 'note');
  v_req := nexus._lt_lock_request(p_request_id, p_version);
  perform nexus._lt_require_status(v_req.status, array['submitted']);
  perform nexus._lt_require_not_own(v_req.requester_member_id);
  update nexus.letter_requests r
  set status = 'processing', processed_by = nexus.current_member_id(), processed_at = now()
  where r.id = p_request_id;
  perform nexus._lt_request_log(p_request_id, 'processing', 'submitted', 'processing', v_note, null);
  return query select r.id, r.status, r.version from nexus.letter_requests r where r.id = p_request_id;
end
$$;

-- 9.4 "Ambil nomor" (F6.4, D-025 G1, LT-13): only on a Diproses request, only once, never own (L6). In
-- ONE transaction: the next outgoing number (counter locked, R3) and the linked outgoing register row
-- (Aktif, no file, period = ACTIVE period even for an old-period request, A-LT20; letter date = today,
-- Perihal and addressee from the request, all correctable at Terbitkan). The status stays Diproses.
-- Two processors at once: the request row lock + version make the second fail with state_changed, so
-- exactly one number is used (LT-15).
create or replace function nexus.letter_request_take_number(p_request_id uuid, p_version integer)
returns table (request_id uuid, status text, version integer, letter_id uuid, number_text text)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid;
  v_period uuid;
  v_req    nexus.letter_requests;
  v_num    record;
  v_id     uuid;
begin
  perform nexus._require_permission('letter_requests.process');
  v_me := nexus._lt_require_member();
  v_period := nexus._lt_require_active_period();
  v_req := nexus._lt_lock_request(p_request_id, p_version);
  perform nexus._lt_require_status(v_req.status, array['processing']);
  perform nexus._lt_require_not_own(v_req.requester_member_id);
  if v_req.letter_id is not null then
    raise exception 'A number was already taken for this request; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;

  select * into v_num from nexus._lt_assign_number('outgoing');
  insert into nexus.letters (letter_type, number_text, number_code, number_year, number_seq, letter_date,
                             counterpart, subject, source_request_id, period_id, created_by, updated_by)
  values ('outgoing', v_num.o_text, v_num.o_code, v_num.o_year, v_num.o_seq, nexus._lt_today(),
          v_req.addressee, v_req.subject, v_req.id, v_period, v_me, v_me)
  returning id into v_id;
  perform nexus._lt_letter_log(v_id, 'registered', null,
                               jsonb_build_object('number_text', v_num.o_text, 'is_legacy_number', false),
                               null, null, v_req.id);
  update nexus.letter_requests r
  set letter_id = v_id, number_taken_by = v_me, number_taken_at = now()
  where r.id = p_request_id;
  perform nexus._lt_request_log(p_request_id, 'number_taken', 'processing', 'processing', null, v_id);
  return query select r.id, r.status, r.version, v_id, v_num.o_text from nexus.letter_requests r where r.id = p_request_id;
end
$$;

-- 9.5 "Terbitkan": Diproses -> Diterbitkan (F6.5, A-LT23, LT-13). Only after the number was taken,
-- never own (L6). 1..3 final files (required: the requester downloads them) from the caller's own upload
-- folder are attached to the EXISTING register row; Perihal, addressee and letter date may be corrected
-- (history row with before/after), never the number. Also for a letter of an old period whose number
-- was taken before a period switch (open item, A-LT20). Any failure leaves everything as it was: the
-- request stays Diproses with its number.
-- p_letter_version (required) = letter.version from letter_request_detail: if the register row was
-- edited (D4) or got files since the page loaded, Terbitkan is refused with state_changed instead of
-- silently overwriting that edit with older values. (Chosen over "change only fields that differ from
-- the request": that would still overwrite a register edit whenever the processor also edits the same
-- field, and it cannot tell an intended reset from a stale form.)
-- The arguments changed after the first local apply (2026-11-10): drop the old signature so no
-- ambiguous overload remains. Nothing depends on it.
drop function if exists nexus.letter_request_issue(uuid, integer, text, text, date, jsonb, text);
create or replace function nexus.letter_request_issue(
  p_request_id     uuid,
  p_version        integer,
  p_letter_version integer,
  p_subject        text,
  p_addressee   text,
  p_letter_date date,
  p_files       jsonb,
  p_note        text default null
)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me      uuid;
  v_req     nexus.letter_requests;
  v_l       nexus.letters;
  v_subject text;
  v_to      text;
  v_date    date;
  v_note    text;
  v_files   jsonb;
  v_before  jsonb := '{}'::jsonb;
  v_after   jsonb := '{}'::jsonb;
begin
  perform nexus._require_permission('letter_requests.process');
  v_me := nexus._lt_require_member();
  perform nexus._lt_require_active_period();
  v_req := nexus._lt_lock_request(p_request_id, p_version);
  perform nexus._lt_require_status(v_req.status, array['processing']);
  perform nexus._lt_require_not_own(v_req.requester_member_id);
  if v_req.letter_id is null then
    raise exception 'Take the number first' using errcode = 'P0001', hint = 'number_not_taken';
  end if;
  v_subject := nexus._lt_required_text(p_subject, 200, 'subject', 'text_required');
  v_to := nexus._lt_required_text(p_addressee, 150, 'addressee', 'text_required');
  v_date := nexus._lt_check_past_date(p_letter_date, 'letter_date', true);
  v_note := nexus._lt_text(p_note, 500, 'note');

  select l.* into v_l from nexus.letters l where l.id = v_req.letter_id for update;
  if v_l.status <> 'active' then
    raise exception 'The letter of this request is no longer active; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  if p_letter_version is null or p_letter_version <> v_l.version then
    raise exception 'The register letter changed in the meantime; reload' using errcode = 'P0001',
      hint = 'state_changed', detail = 'letter';
  end if;
  v_files := nexus._lt_check_files(p_files, v_me, 1, 3 - nexus._lt_visible_file_count(v_l.id));

  if v_subject is distinct from v_l.subject then
    v_before := v_before || jsonb_build_object('subject', v_l.subject); v_after := v_after || jsonb_build_object('subject', v_subject);
  end if;
  if v_to is distinct from v_l.counterpart then
    v_before := v_before || jsonb_build_object('counterpart', v_l.counterpart); v_after := v_after || jsonb_build_object('counterpart', v_to);
  end if;
  if v_date is distinct from v_l.letter_date then
    v_before := v_before || jsonb_build_object('letter_date', v_l.letter_date); v_after := v_after || jsonb_build_object('letter_date', v_date);
  end if;
  update nexus.letters l
  set subject = v_subject, counterpart = v_to, letter_date = v_date, updated_by = v_me
  where l.id = v_l.id;
  if v_after <> '{}'::jsonb then
    perform nexus._lt_letter_log(v_l.id, 'edited', v_before, v_after, null, null, v_req.id);
  end if;
  perform nexus._lt_attach_files(v_l.id, null, v_files, v_req.id);

  update nexus.letter_requests r
  set status = 'issued', decided_by = v_me, decided_at = now()
  where r.id = p_request_id;
  perform nexus._lt_request_log(p_request_id, 'issued', 'processing', 'issued', v_note, v_l.id);
  return query select r.id, r.status, r.version from nexus.letter_requests r where r.id = p_request_id;
end
$$;

-- 9.6 "Tolak": Diajukan or Diproses -> Ditolak (F6.6, LT-12, LT-15a). Note required, never own (L6). If a
-- number was taken, the SAME transaction voids the linked register row with the rejection note as the
-- void reason; the number stays used and is never reissued (R19).
create or replace function nexus.letter_request_reject(p_request_id uuid, p_version integer, p_note text)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me   uuid;
  v_req  nexus.letter_requests;
  v_l    nexus.letters;
  v_note text;
begin
  perform nexus._require_permission('letter_requests.process');
  v_me := nexus._lt_require_member();
  perform nexus._lt_require_active_period();
  v_req := nexus._lt_lock_request(p_request_id, p_version);
  perform nexus._lt_require_status(v_req.status, array['submitted', 'processing']);
  perform nexus._lt_require_not_own(v_req.requester_member_id);
  v_note := nexus._lt_required_text(p_note, 500, 'note', 'note_required');
  if v_req.letter_id is not null then
    select l.* into v_l from nexus.letters l where l.id = v_req.letter_id for update;
    if v_l.status = 'active' then
      update nexus.letters l
      set status = 'voided', void_reason = v_note, voided_by = v_me, voided_at = now(), updated_by = v_me
      where l.id = v_l.id;
      perform nexus._lt_letter_log(v_l.id, 'voided', null, null, v_note, null, v_req.id);
    end if;
  end if;
  update nexus.letter_requests r
  set status = 'rejected', decided_by = v_me, decided_at = now()
  where r.id = p_request_id;
  perform nexus._lt_request_log(p_request_id, 'rejected', v_req.status, 'rejected', v_note, v_req.letter_id);
  return query select r.id, r.status, r.version from nexus.letter_requests r where r.id = p_request_id;
end
$$;

-- =============================================================================================
-- 10. Numbering settings (D-024, L7, P11, G6, A-LT12). Read: System Admin and letters.manage holders.
--     Change: System Admin only (access control L3), every change logged with before and after.
-- =============================================================================================

create or replace function nexus._lt_require_numbering_reader()
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not (nexus.is_system_admin() or nexus.has_permission('letters.manage')) then
    raise exception 'Missing NEXUS permission letters.manage'
      using errcode = '42501', hint = 'permission_required', detail = 'letters.manage';
  end if;
end
$$;

-- First free sequence after p_after for a type and year under the given settings, and its text. A
-- text that already exists for this type (a "Nomor lama" typed ahead of the counter, D1) is skipped:
-- that number is already in the register. Shared by the assignment and the settings preview.
create or replace function nexus._lt_next_free(
  p_type text, p_set nexus.letter_numbering_settings, p_year integer, p_after integer,
  out o_seq integer, out o_text text, out o_code text)
language plpgsql stable set search_path = ''
as $$
declare
  v_tries integer := 0;
begin
  o_code := case p_type when 'incoming' then p_set.incoming_code else p_set.outgoing_code end;
  o_seq := p_after;
  loop
    o_seq := o_seq + 1;
    v_tries := v_tries + 1;
    o_text := nexus._lt_format_number(p_set.prefix, o_code, p_set.number_separator, p_set.include_year,
                                      p_set.seq_digits, p_year, o_seq);
    exit when not exists (select 1 from nexus.letters l
                          where l.letter_type = p_type and lower(l.number_text) = lower(o_text));
    if v_tries >= 10000 then
      raise exception 'No free letter number found' using errcode = 'P0001', hint = 'numbering_exhausted';
    end if;
  end loop;
end
$$;

-- Settings as one JSON object: the format, and per type for the CURRENT Jakarta year the last used
-- sequence (null = none), the next sequence and its full text, and start_set (false = "never set",
-- the first-use hint of design 7.6 / 13.5). can_edit = the caller is the System Admin.
create or replace function nexus.letter_numbering_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_set   nexus.letter_numbering_settings;
  v_year  integer := nexus._lt_year_at(now());
  v_types jsonb;
begin
  perform nexus._lt_require_numbering_reader();
  select s.* into v_set from nexus.letter_numbering_settings s where s.id;
  select jsonb_agg(jsonb_build_object(
           'letter_type', t.typ, 'code', n.o_code,
           'last_used', nullif(c.last_value, 0),
           'next_seq', n.o_seq, 'next_number', n.o_text,
           'start_set', c.letter_type is not null)
           order by t.ord)
  into v_types
  from (values ('incoming', 1), ('outgoing', 2)) t(typ, ord)
  left join nexus.letter_number_counters c on c.letter_type = t.typ and c.number_year = v_year
  cross join lateral nexus._lt_next_free(t.typ, v_set, v_year, coalesce(c.last_value, 0)) n;

  return jsonb_build_object(
    'prefix', v_set.prefix, 'incoming_code', v_set.incoming_code, 'outgoing_code', v_set.outgoing_code,
    'seq_digits', v_set.seq_digits, 'separator', v_set.number_separator, 'include_year', v_set.include_year,
    'version', v_set.version, 'updated_at', v_set.updated_at, 'updated_by_name', nexus._lt_member_name(v_set.updated_by),
    'year', v_year, 'types', coalesce(v_types, '[]'::jsonb),
    'can_edit', nexus.is_system_admin());
end
$$;

-- Change history, newest first (design 13.1 "Riwayat perubahan"). Actor = current PI-CORE name.
create or replace function nexus.letter_numbering_history(p_page integer default 1, p_page_size integer default 20)
returns table (
  change_id bigint, occurred_at timestamptz, kind text, letter_type text, number_year integer,
  before_data jsonb, after_data jsonb, reason text, actor_name text, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_total bigint;
  v_page  integer;
begin
  perform nexus._lt_require_numbering_reader();
  perform nexus._lt_check_page(p_page, p_page_size);
  select count(*) into v_total from nexus.letter_numbering_changes;
  v_page := least(p_page, greatest(1, ceil(v_total::numeric / p_page_size)::integer));
  return query
  select h.id, h.occurred_at, h.kind, h.letter_type, h.number_year, h.before_data, h.after_data, h.reason,
         nexus._lt_member_name(h.actor_member_id), v_total, v_page, p_page_size
  from nexus.letter_numbering_changes h
  order by h.id desc
  offset (v_page - 1)::bigint * p_page_size
  limit p_page_size;
end
$$;

-- "Simpan format" (P11, D-024): System Admin only. p_include_year must be true (year_required, D2). Changes only letters numbered afterwards (stored
-- texts never change, LT-20). Refused when the NEXT number of a type (current year) under the new
-- format already exists in the register (R5, format_collision, detail = that text). Same values =
-- nothing saved (changed = false). p_version from letter_numbering_settings() ("Data sudah berubah").
create or replace function nexus.letter_numbering_update_format(
  p_version       integer,
  p_prefix        text,
  p_incoming_code text,
  p_outgoing_code text,
  p_seq_digits    integer,
  p_separator     text,
  p_include_year  boolean,
  p_reason        text default null
)
returns table (changed boolean, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old    nexus.letter_numbering_settings;
  v_new    nexus.letter_numbering_settings;
  v_reason text;
  v_year   integer := nexus._lt_year_at(now());
  v_text   text;
  t        text;
begin
  perform nexus._require_system_admin();
  v_reason := nexus._lt_text(p_reason, 500, 'reason');
  select s.* into v_old from nexus.letter_numbering_settings s where s.id for update;
  if p_version is null or p_version <> v_old.version then
    raise exception 'The settings changed in the meantime; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  v_new := v_old;
  v_new.prefix := btrim(p_prefix);
  v_new.incoming_code := btrim(p_incoming_code);
  v_new.outgoing_code := btrim(p_outgoing_code);
  v_new.seq_digits := p_seq_digits;
  v_new.number_separator := btrim(p_separator);
  v_new.include_year := p_include_year;
  -- Design 13.2: letters, digits, slash, dot, hyphen; codes 1..10, prefix 1..30, 1..6 digits.
  if v_new.prefix is null or v_new.prefix !~ '^[A-Za-z0-9/.-]{1,30}$' then
    raise exception 'Prefix: 1 to 30 letters, digits, slash, dot or hyphen' using errcode = '22023', hint = 'invalid_number_format', detail = 'prefix';
  end if;
  if v_new.incoming_code is null or v_new.incoming_code !~ '^[A-Za-z0-9/.-]{1,10}$' then
    raise exception 'Incoming code: 1 to 10 letters, digits, slash, dot or hyphen' using errcode = '22023', hint = 'invalid_number_format', detail = 'incoming_code';
  end if;
  if v_new.outgoing_code is null or v_new.outgoing_code !~ '^[A-Za-z0-9/.-]{1,10}$' then
    raise exception 'Outgoing code: 1 to 10 letters, digits, slash, dot or hyphen' using errcode = '22023', hint = 'invalid_number_format', detail = 'outgoing_code';
  end if;
  if lower(v_new.incoming_code) = lower(v_new.outgoing_code) then
    raise exception 'The incoming and outgoing codes must differ' using errcode = '22023', hint = 'invalid_number_format', detail = 'codes_equal';
  end if;
  if v_new.seq_digits is null or v_new.seq_digits not between 1 and 6 then
    raise exception 'Digits must be a whole number from 1 to 6' using errcode = '22023', hint = 'invalid_number_format', detail = 'seq_digits';
  end if;
  if v_new.number_separator is null or v_new.number_separator not in ('/', '-', '.') then
    raise exception 'Separator must be one of / - .' using errcode = '22023', hint = 'invalid_number_format', detail = 'separator';
  end if;
  -- Owner 2026-11-09 (D2): the year is always part of the number.
  if v_new.include_year is distinct from true then
    raise exception 'The year is always part of the letter number' using errcode = '22023', hint = 'year_required', detail = 'include_year';
  end if;
  if (v_new.prefix, v_new.incoming_code, v_new.outgoing_code, v_new.seq_digits, v_new.number_separator, v_new.include_year)
     is not distinct from
     (v_old.prefix, v_old.incoming_code, v_old.outgoing_code, v_old.seq_digits, v_old.number_separator, v_old.include_year) then
    return query select false, v_old.version;
    return;
  end if;

  -- R5: the next number of each type must not repeat a number that already exists.
  foreach t in array array['incoming', 'outgoing'] loop
    v_text := nexus._lt_format_number(v_new.prefix, case t when 'incoming' then v_new.incoming_code else v_new.outgoing_code end,
                                      v_new.number_separator, v_new.include_year, v_new.seq_digits, v_year,
                                      coalesce((select c.last_value from nexus.letter_number_counters c
                                                where c.letter_type = t and c.number_year = v_year), 0) + 1);
    if exists (select 1 from nexus.letters l where l.letter_type = t and lower(l.number_text) = lower(v_text)) then
      raise exception 'This format produces a number that already exists (%)', v_text
        using errcode = '22023', hint = 'format_collision', detail = v_text;
    end if;
  end loop;

  update nexus.letter_numbering_settings s
  set prefix = v_new.prefix, incoming_code = v_new.incoming_code, outgoing_code = v_new.outgoing_code,
      seq_digits = v_new.seq_digits, number_separator = v_new.number_separator, include_year = v_new.include_year,
      updated_by = nexus.current_member_id()
  where s.id;
  insert into nexus.letter_numbering_changes (kind, before_data, after_data, reason, actor_member_id, period_id)
  values ('format',
          jsonb_build_object('prefix', v_old.prefix, 'incoming_code', v_old.incoming_code, 'outgoing_code', v_old.outgoing_code,
                             'seq_digits', v_old.seq_digits, 'separator', v_old.number_separator, 'include_year', v_old.include_year),
          jsonb_build_object('prefix', v_new.prefix, 'incoming_code', v_new.incoming_code, 'outgoing_code', v_new.outgoing_code,
                             'seq_digits', v_new.seq_digits, 'separator', v_new.number_separator, 'include_year', v_new.include_year),
          v_reason, nexus.current_member_id(), nexus.active_period_id());
  return query select true, s.version from nexus.letter_numbering_settings s where s.id;
end
$$;

-- "Atur nomor berikutnya" (L7 a, P11, G6, LT-51): System Admin only, CURRENT Jakarta year only (p_year
-- must equal it, so a screen opened before New Year cannot set the wrong year), reason required, and
-- the next sequence must be HIGHER than the last one used (never down, never a repeat). Setting it to
-- exactly "last + 1" is allowed and records that the start was checked (clears the first-use hint).
create or replace function nexus.letter_numbering_set_next(p_type text, p_year integer, p_next_seq integer, p_reason text)
returns table (letter_type text, number_year integer, next_seq integer, next_number text)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_type    text;
  v_year    integer := nexus._lt_year_at(now());
  v_reason  text;
  v_existed boolean;
  v_last    integer;
  v_set     nexus.letter_numbering_settings;
  v_next    record;
begin
  perform nexus._require_system_admin();
  v_type := nexus._lt_type(p_type);
  if p_year is distinct from v_year then
    raise exception 'Only the current year (%) can be set', v_year using errcode = '22023', hint = 'year_not_current', detail = v_year::text;
  end if;
  v_reason := nexus._lt_required_text(p_reason, 500, 'reason', 'reason_required');
  if p_next_seq is null or p_next_seq < 1 or p_next_seq > 9999999 then
    raise exception 'The next number must be a whole number from 1' using errcode = '22023', hint = 'invalid_input', detail = 'p_next_seq';
  end if;
  -- Same lock order as an assignment (settings share, then counter), so a running assignment and this
  -- change serialise without a deadlock.
  select s.* into v_set from nexus.letter_numbering_settings s where s.id for share;
  v_existed := exists (select 1 from nexus.letter_number_counters c where c.letter_type = v_type and c.number_year = v_year);
  insert into nexus.letter_number_counters (letter_type, number_year, last_value, updated_by)
  values (v_type, v_year, 0, nexus.current_member_id())
  on conflict do nothing;
  select c.last_value into v_last from nexus.letter_number_counters c
  where c.letter_type = v_type and c.number_year = v_year
  for update;
  if p_next_seq <= v_last then
    raise exception 'The next number must be higher than the last one used (%)', v_last
      using errcode = '22023', hint = 'sequence_not_higher', detail = v_last::text;
  end if;
  update nexus.letter_number_counters c
  set last_value = p_next_seq - 1, updated_by = nexus.current_member_id()
  where c.letter_type = v_type and c.number_year = v_year;
  insert into nexus.letter_numbering_changes (kind, letter_type, number_year, before_data, after_data, reason, actor_member_id, period_id)
  values ('next_sequence', v_type, v_year,
          jsonb_build_object('last_used', case when v_existed then nullif(v_last, 0) end, 'next_seq', v_last + 1),
          jsonb_build_object('last_used', nullif(p_next_seq - 1, 0), 'next_seq', p_next_seq),
          v_reason, nexus.current_member_id(), nexus.active_period_id());
  select * into v_next from nexus._lt_next_free(v_type, v_set, v_year, p_next_seq - 1);
  return query select v_type, v_year, v_next.o_seq, v_next.o_text;
end
$$;

-- =============================================================================================
-- 11. Export (F8, LT-37..LT-39). Same rows and order as the register list, all pages, never more than
--     the caller may view (R15: letters.export works only together with letters.view). One log row in
--     the SAME transaction after the rows are built; if it fails, no rows are returned. total_count =
--     rows of the full result on every row (detects a PostgREST max_rows cut, as M9). VOLATILE: call
--     with .rpc() (POST); a read-only GET fails closed. No file contents, no links, no search text.
-- =============================================================================================

create or replace function nexus.letter_export(
  p_format        text,
  p_type          text,
  p_search        text    default null,
  p_period        text    default 'active',
  p_year          integer default null,
  p_status        text    default 'all',
  p_without_files boolean default false
)
returns table (
  row_no bigint, number_text text, letter_type text, is_legacy_number boolean, letter_date date, received_date date,
  counterpart text, counterpart_number text, subject text, notes text, status text, void_reason text,
  from_request boolean, period_label text, created_by_name text, created_at timestamptz, file_count integer,
  total_count bigint
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_format text;
  v_type   text;
  v_all    boolean;
  v_status text;
  v_member uuid;
  v_period uuid;
  v_count  integer;
begin
  perform nexus._require_permission('letters.export');
  v_format := nexus._lt_export_format(p_format);
  v_type := nexus._lt_type(p_type);
  v_all := nexus._lt_period_filter(p_period);
  v_status := nexus._lt_status_filter(p_status);
  perform nexus._lt_check_year(p_year);
  v_member := nexus.current_member_id();
  -- Read the active period ONCE: the same value drives the rows and the log row.
  v_period := nexus.active_period_id();
  if v_member is null or v_period is null then
    raise exception 'Missing NEXUS permission letters.export' using errcode = '42501', hint = 'permission_required', detail = 'letters.export';
  end if;

  return query
  select r.ordinal, r.number_text, r.letter_type, r.is_legacy_number, r.letter_date, r.received_date,
         r.counterpart, r.counterpart_number, r.subject, r.notes, r.status, r.void_reason,
         r.source_request_id is not null, r.period_label, r.created_by_name, r.created_at, r.file_count,
         count(*) over ()
  from nexus._lt_letter_rows(v_type, p_search, v_period, v_all, p_year, v_status, coalesce(p_without_files, false)) r
  order by r.ordinal;
  get diagnostics v_count = row_count;

  perform set_config('nexus.export_log_writer', 'letter_export', true);
  insert into nexus.letter_export_logs (exporter_member_id, letter_type, format, filters, row_count, period_id)
  values (v_member, v_type, v_format,
          jsonb_build_object('period', case when v_all then 'all' else 'active' end, 'year', p_year, 'status', v_status,
                             'without_files', coalesce(p_without_files, false),
                             'search_used', nexus._lt_search_pattern(p_search) is not null),
          v_count, v_period);
  perform set_config('nexus.export_log_writer', '', true);
  return;
end
$$;

-- =============================================================================================
-- 12. Storage access checks for the bucket `nexus-letter-files` (used by the Storage RLS policies in
--     20261110100100; callable as the user). They never raise: a bad name is simply "no".
--     Upload: any active member, only into their OWN folder "<members.id>/<uuid>.<pdf|jpg|jpeg|png>",
--     only while a period is active, and at most 10 unattached uploads of the last 24 hours in that
--     folder (A-LT13, same pattern as the evidence bucket). Read: _lt_can_read_file (spec 4.4, G5).
--     Nobody deletes or overwrites (no policy for that).
-- =============================================================================================

create or replace function nexus.letter_file_can_upload(p_object_name text)
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
     or nexus.active_period_id() is null then
    return false;
  end if;
  -- A missing created_at counts as recent (fail towards the cap).
  if to_regclass('storage.objects') is not null then
    execute 'select count(*)::int from storage.objects o
             where o.bucket_id = $1 and o.name like $2
               and coalesce(o.created_at, now()) > now() - interval ''24 hours''
               and not exists (select 1 from nexus.letter_files f where f.storage_path = o.name)'
      into v_unattached using 'nexus-letter-files', v_me::text || '/%';
    if v_unattached >= 10 then
      return false;
    end if;
  end if;
  return true;
end
$$;

create or replace function nexus.letter_file_can_read(p_object_name text)
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
  select f.id into v_id from nexus.letter_files f where f.storage_path = p_object_name;
  if not found then
    return false;   -- an unattached upload is nobody's file yet (never shown, LT-29)
  end if;
  return nexus._lt_can_read_file(v_id);
end
$$;

-- =============================================================================================
-- 13. Function privileges (README section 7, item 3): revoke the global EXECUTE-to-PUBLIC, grant the
--     client API to authenticated only, internals to nobody but the owner.
-- =============================================================================================

do $$
declare
  f record;
  v_api text[] := array[
    'letter_list', 'letter_year_list', 'letter_detail', 'letter_dashboard_counts', 'letter_export',
    'letter_register', 'letter_update', 'letter_add_files', 'letter_withdraw_file', 'letter_void',
    'letter_my_requests', 'letter_my_request_caps', 'letter_request_queue', 'letter_request_queue_counts', 'letter_request_detail',
    'letter_request_create', 'letter_request_cancel', 'letter_request_process', 'letter_request_take_number',
    'letter_request_issue', 'letter_request_reject',
    'letter_numbering_settings', 'letter_numbering_history', 'letter_numbering_update_format', 'letter_numbering_set_next',
    'letter_file_can_upload', 'letter_file_can_read'];
begin
  for f in select p.oid::regprocedure as sig, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and (p.proname = any (v_api) or p.proname like '\_lt\_%') loop
    execute format('revoke all on function %s from public, anon, service_role', f.sig);
    if f.proname = any (v_api) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end
$$;

-- Ask PostgREST to pick up the new objects.
notify pgrst, 'reload schema';
