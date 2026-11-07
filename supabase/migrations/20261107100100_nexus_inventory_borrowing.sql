-- PMK-NEXUS 0006: Inventory and Borrowing module (tables, state machine, read/export functions).
--
-- Spec:      docs/modules/inventory-borrowing.md (APPROVED revision 2) sections 2-5, 8, 11 (IB-01..IB-48)
--            and 11b; docs/design/inventory-borrowing.md sections 21 and 23 (P2 bulk availability, P6
--            reasoned stock dialogs, PJM-0001, Dashboard counts); docs/OPEN_QUESTIONS.md section H.
--            docs/modules/access-control.md: keys inventory.*, borrowing.* (borrowing.handle from
--            20261107100000), locked rules L1, L4, L5, L6 (approve/reject/extend only), L7 (old-period
--            records read-only except open items), L9 (own requests, cancel until pick-up), L11, L12.
-- Decisions: D-010, D-011, D-013, D-019 (export-log pattern), D-022.
-- PI-CORE:   verified against pi-core-v2 migrations 20261031165546 .. 20261102090000 (HEAD d8b6814).
--            Read here: members(id, full_name) for names at read time; periods(id, label, is_active)
--            through the existing helpers. Never email, phone, nim, nip (L4). No foreign keys to PI-CORE.
--
-- Stored values are English identifiers; the UI maps them to Indonesian:
--   mode       tracked = "Dilacak per unit", quantity = "Dihitung per jumlah"
--   condition  good = Baik, needs_service = Perlu servis, damaged = Rusak (fixed list, IB10)
--   unit       active, archived = Nonaktif, lost = Hilang (write-off; never a condition)
--   request    submitted = Diajukan, approved = Disetujui, rejected = Ditolak, cancelled = Dibatalkan,
--              borrowed = Dipinjam, returned = Dikembalikan
--   outcome    good = kembali baik, damaged = kembali rusak, lost = hilang
-- Derived states (Terlambat, Belum diambil, Sebagian kembali) are computed on read with the Asia/Jakarta
-- date, never stored (R9).
--
-- Security model:
--   * Every write goes through a SECURITY DEFINER function below. Clients have NO insert/update/delete
--     privilege on any table. Tables have SELECT grants with RLS policies (default deny) as a second,
--     read-only door; the functions are the main API.
--   * Each function checks L1 (active linked member), the permission key (nexus.has_permission), the
--     active period (R11), L6 (approve/reject/extend never on your own request, also when you recorded
--     it for an outside party), L9 (requester rights), L7 (closed old-period requests are read-only).
--   * Double booking (R5): approval, extension, return correction and every stock reduction lock the
--     item rows (SELECT ... FOR UPDATE, in id order) and re-check free quantity inside the lock.
--     Request actions lock the request row and compare a version number ("Data sudah berubah").
--   * Nothing is ever deleted (L5): every table refuses DELETE and TRUNCATE; history tables are
--     append-only.
--
-- Errors carry a stable hint (errcode): permission_required, not_active_member, self_approval_blocked,
-- closed_period, immutable_column, export_log_direct_insert, append_only (42501); request_not_found,
-- item_not_found, unit_not_found, category_not_found, location_not_found, line_not_found (P0002);
-- no_active_period, state_changed, insufficient_stock, reserved_stock, item_not_lendable,
-- open_requests_exist, unit_on_loan, item_archived, unit_not_available, too_early, nothing_to_hand_over,
-- correction_conflict, photo_missing, too_many_open_requests, daily_request_limit (P0001);
-- duplicate_name (23505); date_range_too_long, too_many_units, invalid_input, invalid_mode,
-- invalid_condition, invalid_status, invalid_view, invalid_dates, start_in_past, quantity_invalid,
-- text_required, text_too_long, reason_required, note_required, duplicate_item, too_many_lines,
-- outside_party_incomplete, location_per_unit, item_not_tracked, item_not_quantity, invalid_photo,
-- photo_count, search_too_long, invalid_page, invalid_page_size, invalid_format (22023). `detail` names
-- the field or the count (never a person).
--
-- Re-runnable: create ... if not exists / or replace, guarded policy creation, no data changes. Run as
-- ONE transaction:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261107100100_nexus_inventory_borrowing.sql
-- Requires 20261105100000 .. 20261107100000.

-- =============================================================================================
-- 1. Code sequences (IB11, A-IB27, design G3). Sequences never hand out a number twice, even after a
--    rollback (gaps are possible and harmless), so a code or reference is never reused.
-- =============================================================================================

create sequence if not exists nexus.inventory_code_seq;       -- INV-0001
create sequence if not exists nexus.borrowing_reference_seq;  -- PJM-0001
revoke all on sequence nexus.inventory_code_seq, nexus.borrowing_reference_seq
  from public, anon, authenticated, service_role;

-- =============================================================================================
-- 2. Tables. Not period-scoped: catalog tables (A-n5). Period-scoped: requests (period at creation)
--    and every history row (active period at the time of the event).
-- =============================================================================================

-- 2.1 Lists Ops maintains (IB10). Start EMPTY: no seed values (PMK has not supplied any).
create table if not exists nexus.inventory_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index if not exists inventory_categories_name_key on nexus.inventory_categories (lower(name));

create table if not exists nexus.inventory_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index if not exists inventory_locations_name_key on nexus.inventory_locations (lower(name));

-- 2.2 Items (IB1 hybrid). The mode never changes (design P5 a); quantity items carry the INV code,
-- tracked items carry one code per unit. One location per quantity item (design G1); tracked units
-- have their own location.
create table if not exists nexus.inventory_items (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null check (mode in ('tracked', 'quantity')),
  code        text unique check (code ~ '^INV-[0-9]{4,}$'),
  name        text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) between 1 and 1000),
  category_id uuid references nexus.inventory_categories (id),
  location_id uuid references nexus.inventory_locations (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint inventory_items_code_by_mode check ((mode = 'quantity') = (code is not null)),
  constraint inventory_items_location_by_mode check (mode = 'quantity' or location_id is null)
);
create index if not exists inventory_items_name_idx on nexus.inventory_items (lower(name));

-- 2.3 Tracked units: own code, condition and location. Lost = status, not a condition (IB10, A-IB30).
create table if not exists nexus.inventory_units (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references nexus.inventory_items (id),
  code        text not null unique check (code ~ '^INV-[0-9]{4,}$'),
  condition   text not null check (condition in ('good', 'needs_service', 'damaged')),
  location_id uuid references nexus.inventory_locations (id),
  status      text not null default 'active' check (status in ('active', 'archived', 'lost')),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create index if not exists inventory_units_item_idx on nexus.inventory_units (item_id);

-- 2.4 Quantity stock: one row per condition (total = sum). Only 'good' is lendable. Quantities on loan
-- stay counted in 'good' until they come back (Dashboard A-IB32: baik includes on loan).
create table if not exists nexus.inventory_stock (
  item_id    uuid not null references nexus.inventory_items (id),
  condition  text not null check (condition in ('good', 'needs_service', 'damaged')),
  quantity   integer not null default 0 check (quantity between 0 and 9999),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (item_id, condition)
);

-- 2.5 Borrowing requests (header). Requester = members.id from the session; outside parties store
-- organisation and contact person names ONLY (IB14, IB15, A-IB28). Dates are Jakarta calendar dates,
-- end inclusive (R4, R19). `version` changes on every update (optimistic "Data sudah berubah" check).
create table if not exists nexus.borrowing_requests (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique check (reference ~ '^PJM-[0-9]{4,}$'),
  requester_member_id  uuid not null,
  is_outside_party     boolean not null default false,
  outside_org_name     text check (outside_org_name is null or (outside_org_name = btrim(outside_org_name) and char_length(outside_org_name) between 1 and 120)),
  outside_contact_name text check (outside_contact_name is null or (outside_contact_name = btrim(outside_contact_name) and char_length(outside_contact_name) between 1 and 120)),
  period_id            uuid not null,
  purpose              text not null check (char_length(btrim(purpose)) between 1 and 500),
  note                 text check (note is null or char_length(note) between 1 and 500),
  start_date           date not null,
  end_date             date not null,
  status               text not null default 'submitted'
                       check (status in ('submitted', 'approved', 'rejected', 'cancelled', 'borrowed', 'returned')),
  decided_by           uuid,
  decided_at           timestamptz,
  decision_note        text check (decision_note is null or char_length(decision_note) between 1 and 500),
  handed_over_by       uuid,
  handed_over_at       timestamptz,
  returned_at          timestamptz,
  has_issue            boolean not null default false,
  version              integer not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint borrowing_requests_dates check (end_date >= start_date),
  constraint borrowing_requests_outside_party check (
    (is_outside_party and outside_org_name is not null and outside_contact_name is not null)
    or (not is_outside_party and outside_org_name is null and outside_contact_name is null))
);
create index if not exists borrowing_requests_requester_idx on nexus.borrowing_requests (requester_member_id);
create index if not exists borrowing_requests_status_idx on nexus.borrowing_requests (status);

-- 2.6 Request lines. Tracked items are requested by quantity; units are chosen at handover (A-IB29).
-- Outstanding = handed over minus non-reversed return outcomes (computed, never stored).
create table if not exists nexus.borrowing_request_lines (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid not null references nexus.borrowing_requests (id),
  item_id              uuid not null references nexus.inventory_items (id),
  quantity_requested   integer not null check (quantity_requested between 1 and 9999),
  quantity_approved    integer check (quantity_approved between 0 and 9999),
  quantity_handed_over integer check (quantity_handed_over between 0 and 9999),
  handover_note        text check (handover_note is null or char_length(handover_note) between 1 and 500),
  unique (request_id, item_id),   -- R20: the same item twice in one request is rejected
  check (quantity_approved is null or quantity_approved <= quantity_requested),
  check (quantity_handed_over is null or quantity_handed_over <= coalesce(quantity_approved, 0))
);
create index if not exists borrowing_request_lines_item_idx on nexus.borrowing_request_lines (item_id);

-- 2.7 One return action ("Catat pengembalian") = one batch. The single reasoned correction (A-IB15)
-- reverses the LAST batch through borrowing_return_reversals (append-only), never by editing rows.
create table if not exists nexus.borrowing_return_batches (
  id              bigint generated always as identity primary key,
  request_id      uuid not null references nexus.borrowing_requests (id),
  recorded_by     uuid not null,
  recorded_at     timestamptz not null default now(),
  period_id       uuid not null
);
create index if not exists borrowing_return_batches_request_idx on nexus.borrowing_return_batches (request_id);

-- 2.8 Return outcomes. Quantity items: one row per outcome. Tracked items: one row per unit.
-- A damaged outcome stores ONE resulting condition (A-IB30, A-IB41). Note required for damaged/lost.
create table if not exists nexus.borrowing_line_returns (
  id                  bigint generated always as identity primary key,
  batch_id            bigint not null references nexus.borrowing_return_batches (id),
  line_id             uuid not null references nexus.borrowing_request_lines (id),
  unit_id             uuid references nexus.inventory_units (id),
  outcome             text not null check (outcome in ('good', 'damaged', 'lost')),
  quantity            integer not null check (quantity between 1 and 9999),
  resulting_condition text check (resulting_condition in ('needs_service', 'damaged')),
  note                text check (note is null or char_length(note) between 1 and 500),
  check ((outcome = 'damaged') = (resulting_condition is not null)),
  check (outcome = 'good' or note is not null),
  check (unit_id is null or quantity = 1)
);
create index if not exists borrowing_line_returns_line_idx on nexus.borrowing_line_returns (line_id);
create index if not exists borrowing_line_returns_batch_idx on nexus.borrowing_line_returns (batch_id);

-- 2.9 Units handed over on a line. return_id null = still out. The partial unique index is THE
-- database guarantee that one unit never sits on two open loans (IB-27).
create table if not exists nexus.borrowing_line_units (
  id         bigint generated always as identity primary key,
  line_id    uuid not null references nexus.borrowing_request_lines (id),
  unit_id    uuid not null references nexus.inventory_units (id),
  return_id  bigint references nexus.borrowing_line_returns (id),
  created_at timestamptz not null default now(),
  unique (line_id, unit_id)
);
create unique index if not exists borrowing_line_units_one_open_loan
  on nexus.borrowing_line_units (unit_id) where return_id is null;

-- 2.10 Correction of a wrong return (A-IB15): one row per reversed batch, with the reason.
create table if not exists nexus.borrowing_return_reversals (
  batch_id    bigint primary key references nexus.borrowing_return_batches (id),
  reversed_by uuid not null,
  reversed_at timestamptz not null default now(),
  reason      text not null check (char_length(reason) between 1 and 500),
  period_id   uuid not null
);

-- 2.11 Evidence photos (IB8, IB9, A-IB31): 1..3 per damaged or lost outcome, private bucket
-- `nexus-borrowing-evidence`, path "<request id>/<random uuid>.<jpg|jpeg|png|webp>". Never deleted.
create table if not exists nexus.borrowing_evidence_photos (
  id             bigint generated always as identity primary key,
  line_return_id bigint not null references nexus.borrowing_line_returns (id),
  storage_path   text not null unique
                 check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'),
  size_bytes     integer check (size_bytes is null or size_bytes > 0),
  mime_type      text check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  attached_by    uuid not null,
  attached_at    timestamptz not null default now()
);
create index if not exists borrowing_evidence_photos_return_idx on nexus.borrowing_evidence_photos (line_return_id);

-- 2.12 Extension history (IB5, A-IB26).
create table if not exists nexus.borrowing_extensions (
  id              bigint generated always as identity primary key,
  request_id      uuid not null references nexus.borrowing_requests (id),
  old_end_date    date not null,
  new_end_date    date not null,
  actor_member_id uuid not null,
  occurred_at     timestamptz not null default now(),
  note            text not null check (char_length(note) between 1 and 500),
  period_id       uuid not null,
  check (new_end_date > old_end_date)
);
create index if not exists borrowing_extensions_request_idx on nexus.borrowing_extensions (request_id);

-- 2.13 Status history = the request timeline. A partial return is an event without a status change.
create table if not exists nexus.borrowing_status_history (
  id              bigint generated always as identity primary key,
  request_id      uuid not null references nexus.borrowing_requests (id),
  event           text not null check (event in ('submitted', 'approved', 'rejected', 'cancelled',
                                                 'handed_over', 'returned_partial', 'returned', 'return_corrected')),
  from_status     text,
  to_status       text not null,
  actor_member_id uuid not null,
  occurred_at     timestamptz not null default now(),
  note            text check (note is null or char_length(note) between 1 and 500),
  period_id       uuid not null
);
create index if not exists borrowing_status_history_request_idx on nexus.borrowing_status_history (request_id, id);

-- 2.14 Item history (A-IB6, P6): every creation, edit, stock or condition change, write-off, archive,
-- reactivation and restore. request_id links changes caused by a return or its correction.
create table if not exists nexus.inventory_item_history (
  id              bigint generated always as identity primary key,
  item_id         uuid not null references nexus.inventory_items (id),
  unit_id         uuid references nexus.inventory_units (id),
  kind            text not null check (kind in ('created', 'edited', 'unit_added', 'stock_added', 'condition_changed',
                                                'written_off', 'archived', 'reactivated', 'restored')),
  condition_from  text check (condition_from in ('good', 'needs_service', 'damaged')),
  condition_to    text check (condition_to in ('good', 'needs_service', 'damaged')),
  quantity        integer check (quantity is null or quantity between 1 and 9999),
  note            text check (note is null or char_length(note) between 1 and 500),
  request_id      uuid references nexus.borrowing_requests (id),
  details         jsonb check (details is null or jsonb_typeof(details) = 'object'),
  actor_member_id uuid,
  occurred_at     timestamptz not null default now(),
  period_id       uuid
);
create index if not exists inventory_item_history_item_idx on nexus.inventory_item_history (item_id, id desc);

-- 2.15 Export log (IB13, A-IB33): one row per SUCCESSFUL export of the catalog or of borrowing.
-- Ids and settings only: no names, no search text, no exported rows. Separate from the Member Data
-- log on purpose: that log has its own reader key (member_data.view_export_log) and fixed columns.
create table if not exists nexus.inventory_borrowing_export_logs (
  id                 bigint generated always as identity primary key,
  module             text not null check (module in ('inventory', 'borrowing')),
  exporter_member_id uuid not null,
  created_at         timestamptz not null default now(),
  format             text not null check (format in ('xlsx', 'csv', 'pdf')),
  filters            jsonb not null check (jsonb_typeof(filters) = 'object'),
  row_count          integer not null check (row_count >= 0),
  period_id          uuid not null
);
create index if not exists inventory_borrowing_export_logs_created_idx
  on nexus.inventory_borrowing_export_logs (created_at desc, id desc);

-- Owner 2026-11-07 / review L4: a request spans at most 366 calendar days (end <= start + 365), also
-- after extensions (start never changes), and only real dates from 2000 on. Added separately so a
-- database created by an earlier draft of this file gets it too (re-runnable, nothing dropped).
do $$
begin
  if not exists (select 1 from pg_constraint c
                 where c.conrelid = 'nexus.borrowing_requests'::regclass and c.conname = 'borrowing_requests_date_cap') then
    alter table nexus.borrowing_requests
      add constraint borrowing_requests_date_cap
      check (start_date >= date '2000-01-01' and isfinite(end_date) and end_date <= start_date + 365);
  end if;
end
$$;

comment on table nexus.inventory_items is 'Inventory catalog (D-022). Never deleted; archived via is_active. Written only by nexus.inventory_* functions.';
comment on table nexus.inventory_units is 'Units of tracked items. Code never reused; lost units keep status lost.';
comment on table nexus.inventory_stock is 'Quantity items: count per condition. Only good is lendable.';
comment on table nexus.borrowing_requests is 'Borrowing requests (D-022). requester_member_id = PI-CORE members.id (no FK). Written only by nexus.borrowing_* functions.';
comment on table nexus.inventory_borrowing_export_logs is 'Inventory/borrowing export log (IB13). Append-only, no PII. Written only by the export functions; no client grant.';

-- =============================================================================================
-- 3. Guard triggers (they fire for every writer: the functions, the SQL editor, the service role).
--    The owner could disable them (tamper-evident, not tamper-proof; supabase/README.md section 6).
-- =============================================================================================

-- Immutable columns. Codes, modes, references, requesters and periods never change (IB11, R22, R23).
create or replace function nexus._ib_immutable_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'inventory_items' then
    if (new.id, new.mode, new.code, new.created_at, new.created_by)
       is distinct from (old.id, old.mode, old.code, old.created_at, old.created_by) then
      raise exception 'Item id, mode and code never change' using errcode = '42501', hint = 'immutable_column';
    end if;
  elsif tg_table_name = 'inventory_units' then
    if (new.id, new.item_id, new.code, new.created_at, new.created_by)
       is distinct from (old.id, old.item_id, old.code, old.created_at, old.created_by) then
      raise exception 'Unit id, item and code never change' using errcode = '42501', hint = 'immutable_column';
    end if;
  elsif tg_table_name = 'inventory_stock' then
    if (new.item_id, new.condition) is distinct from (old.item_id, old.condition) then
      raise exception 'Stock rows never move' using errcode = '42501', hint = 'immutable_column';
    end if;
  elsif tg_table_name = 'borrowing_requests' then
    if (new.id, new.reference, new.requester_member_id, new.is_outside_party, new.outside_org_name,
        new.outside_contact_name, new.period_id, new.purpose, new.note, new.start_date, new.created_at)
       is distinct from
       (old.id, old.reference, old.requester_member_id, old.is_outside_party, old.outside_org_name,
        old.outside_contact_name, old.period_id, old.purpose, old.note, old.start_date, old.created_at) then
      raise exception 'A submitted request is not edited (A-IB7); cancel and submit again'
        using errcode = '42501', hint = 'immutable_column';
    end if;
    -- Every change bumps the version, so a stale screen cannot act twice (IB-48).
    new.version := old.version + 1;
    new.updated_at := now();
  elsif tg_table_name = 'borrowing_request_lines' then
    if (new.id, new.request_id, new.item_id, new.quantity_requested)
       is distinct from (old.id, old.request_id, old.item_id, old.quantity_requested) then
      raise exception 'Request lines are not edited' using errcode = '42501', hint = 'immutable_column';
    end if;
  elsif tg_table_name = 'borrowing_line_units' then
    if (new.id, new.line_id, new.unit_id, new.created_at)
       is distinct from (old.id, old.line_id, old.unit_id, old.created_at) then
      raise exception 'Handed-over units are not edited' using errcode = '42501', hint = 'immutable_column';
    end if;
  end if;
  return new;
end
$$;

-- Units belong to tracked items, stock rows to quantity items, whatever wrote the row.
create or replace function nexus._ib_mode_guard()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_mode text;
begin
  select i.mode into v_mode from nexus.inventory_items i where i.id = new.item_id;
  if tg_table_name = 'inventory_units' and v_mode is distinct from 'tracked' then
    raise exception 'Units exist only for tracked items' using errcode = '22023', hint = 'item_not_tracked';
  end if;
  if tg_table_name = 'inventory_stock' and v_mode is distinct from 'quantity' then
    raise exception 'Stock rows exist only for quantity items' using errcode = '22023', hint = 'item_not_quantity';
  end if;
  return new;
end
$$;

-- Only the export functions write the export log (same idea as Member Data).
create or replace function nexus._ib_export_log_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('nexus.export_log_writer', true), '') is distinct from (new.module || '_export') then
    raise exception 'inventory_borrowing_export_logs is written only by the export functions'
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
  foreach t in array array['inventory_categories', 'inventory_locations', 'inventory_items', 'inventory_units',
                           'inventory_stock', 'borrowing_requests', 'borrowing_request_lines',
                           'borrowing_line_units'] loop
    execute format('create or replace trigger %I before delete on nexus.%I for each row execute function nexus._append_only_guard()',
                   t || '_no_delete', t);
    execute format('create or replace trigger %I before truncate on nexus.%I for each statement execute function nexus._append_only_guard()',
                   t || '_no_truncate', t);
  end loop;
  -- History and log tables: append-only (no update either).
  foreach t in array array['borrowing_return_batches', 'borrowing_line_returns', 'borrowing_return_reversals',
                           'borrowing_evidence_photos', 'borrowing_extensions', 'borrowing_status_history',
                           'inventory_item_history', 'inventory_borrowing_export_logs'] loop
    execute format('create or replace trigger %I before update or delete on nexus.%I for each row execute function nexus._append_only_guard()',
                   t || '_no_change', t);
    execute format('create or replace trigger %I before truncate on nexus.%I for each statement execute function nexus._append_only_guard()',
                   t || '_no_truncate', t);
  end loop;
  foreach t in array array['inventory_items', 'inventory_units', 'inventory_stock', 'borrowing_requests',
                           'borrowing_request_lines', 'borrowing_line_units'] loop
    execute format('create or replace trigger %I before update on nexus.%I for each row execute function nexus._ib_immutable_guard()',
                   t || '_10_immutable', t);
  end loop;
end
$$;

create or replace trigger inventory_units_05_mode
  before insert or update on nexus.inventory_units
  for each row execute function nexus._ib_mode_guard();
create or replace trigger inventory_stock_05_mode
  before insert or update on nexus.inventory_stock
  for each row execute function nexus._ib_mode_guard();
create or replace trigger inventory_borrowing_export_logs_10_insert_guard
  before insert on nexus.inventory_borrowing_export_logs
  for each row execute function nexus._ib_export_log_guard();

-- =============================================================================================
-- 4. Privileges and Row Level Security. Default deny everywhere; SELECT-only policies. No client
--    INSERT/UPDATE/DELETE grant on any table: writes happen inside the SECURITY DEFINER functions.
-- =============================================================================================

do $$
declare
  t text;
begin
  foreach t in array array['inventory_categories', 'inventory_locations', 'inventory_items', 'inventory_units',
                           'inventory_stock', 'inventory_item_history', 'borrowing_requests',
                           'borrowing_request_lines', 'borrowing_return_batches', 'borrowing_line_returns',
                           'borrowing_line_units', 'borrowing_return_reversals', 'borrowing_evidence_photos',
                           'borrowing_extensions', 'borrowing_status_history', 'inventory_borrowing_export_logs'] loop
    execute format('revoke all on nexus.%I from public, anon, authenticated, service_role', t);
    execute format('alter table nexus.%I enable row level security', t);
    -- service_role: SELECT only (ops/backups), like every nexus table.
    execute format('grant select on nexus.%I to service_role', t);
    if t <> 'inventory_borrowing_export_logs' then
      execute format('grant select on nexus.%I to authenticated', t);
    end if;
  end loop;
end
$$;
revoke all on sequence nexus.borrowing_return_batches_id_seq, nexus.borrowing_line_returns_id_seq,
  nexus.borrowing_line_units_id_seq, nexus.borrowing_evidence_photos_id_seq, nexus.borrowing_extensions_id_seq,
  nexus.borrowing_status_history_id_seq, nexus.inventory_item_history_id_seq,
  nexus.inventory_borrowing_export_logs_id_seq
  from public, anon, authenticated, service_role;

-- Policies. Each (select ...) runs once per statement. Child tables reuse the parent's policy through
-- EXISTS (the subquery is itself filtered by the parent's RLS).
do $$
declare
  v_policies text[][] := array[
    -- catalog lists: everyone who may open the module (D01 baseline)
    array['inventory_categories', 'inventory_categories_select',
          '(select nexus.has_permission(''inventory.view''))'],
    array['inventory_locations', 'inventory_locations_select',
          '(select nexus.has_permission(''inventory.view''))'],
    -- items: archived ones only for managers (A-IB5)
    array['inventory_items', 'inventory_items_select',
          '(select nexus.has_permission(''inventory.view'')) and (is_active or (select nexus.has_permission(''inventory.manage'')))'],
    -- units: members see active units of active items; managers see all (archived, lost)
    array['inventory_units', 'inventory_units_select',
          '(select nexus.has_permission(''inventory.view'')) and ((status = ''active'' and exists (select 1 from nexus.inventory_items i where i.id = item_id and i.is_active)) or (select nexus.has_permission(''inventory.manage'')))'],
    array['inventory_stock', 'inventory_stock_select',
          'exists (select 1 from nexus.inventory_items i where i.id = item_id)'],
    -- item history: managers and request viewers (it can link to requests; never to members only)
    array['inventory_item_history', 'inventory_item_history_select',
          '(select nexus.has_permission(''inventory.manage'')) or (select nexus.has_permission(''borrowing.view_all''))'],
    -- requests: own (L9, fixed) or borrowing.view_all (D10; included in approve and handle)
    array['borrowing_requests', 'borrowing_requests_select',
          'requester_member_id = (select nexus.current_member_id()) or (select nexus.has_permission(''borrowing.view_all''))'],
    array['borrowing_request_lines', 'borrowing_request_lines_select',
          'exists (select 1 from nexus.borrowing_requests r where r.id = request_id)'],
    array['borrowing_return_batches', 'borrowing_return_batches_select',
          'exists (select 1 from nexus.borrowing_requests r where r.id = request_id)'],
    array['borrowing_extensions', 'borrowing_extensions_select',
          'exists (select 1 from nexus.borrowing_requests r where r.id = request_id)'],
    array['borrowing_status_history', 'borrowing_status_history_select',
          'exists (select 1 from nexus.borrowing_requests r where r.id = request_id)'],
    array['borrowing_line_returns', 'borrowing_line_returns_select',
          'exists (select 1 from nexus.borrowing_request_lines l where l.id = line_id)'],
    array['borrowing_line_units', 'borrowing_line_units_select',
          'exists (select 1 from nexus.borrowing_request_lines l where l.id = line_id)'],
    array['borrowing_return_reversals', 'borrowing_return_reversals_select',
          'exists (select 1 from nexus.borrowing_return_batches b where b.id = batch_id)'],
    array['borrowing_evidence_photos', 'borrowing_evidence_photos_select',
          'exists (select 1 from nexus.borrowing_line_returns lr where lr.id = line_return_id)']
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
-- inventory_borrowing_export_logs: no policy and no client grant (read through the database only until
-- the log screen exists, IB13 / A-MD14).

-- =============================================================================================
-- 5. Internal helpers (no EXECUTE for clients; called from the SECURITY DEFINER functions below).
-- =============================================================================================

-- R19: "today" is the Asia/Jakarta calendar date (WIB, UTC+7, no DST), never the UTC date.
create or replace function nexus._jakarta_date(p_at timestamptz)
returns date
language sql stable set search_path = ''
as $$ select (p_at at time zone 'Asia/Jakarta')::date $$;

create or replace function nexus._ib_today()
returns date
language sql stable set search_path = ''
as $$ select nexus._jakarta_date(now()) $$;

-- INV-0001 / PJM-0001: at least four digits, then simply longer (INV-10000). lpad alone would cut.
create or replace function nexus._ib_code(p_prefix text, p_n bigint)
returns text
language sql immutable set search_path = ''
as $$ select p_prefix || '-' || case when p_n < 10000 then lpad(p_n::text, 4, '0') else p_n::text end $$;

-- L1 for the fixed (key-less) rights of L9: an active, linked member.
create or replace function nexus._ib_require_member()
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

-- R11: no transition works without an active period (spec section 4).
create or replace function nexus._ib_require_active_period()
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

-- Trimmed text, blank -> null; over the limit -> text_too_long (detail = field).
create or replace function nexus._ib_text(p_text text, p_max integer, p_field text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := nullif(btrim(p_text), '');
begin
  if char_length(v) > p_max then
    raise exception 'Text for % is too long (max % characters)', p_field, p_max
      using errcode = '22023', hint = 'text_too_long', detail = p_field;
  end if;
  return v;
end
$$;

-- Same, but the text is required; p_hint names the error (text_required, reason_required, note_required).
create or replace function nexus._ib_required_text(p_text text, p_max integer, p_field text, p_hint text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := nexus._ib_text(p_text, p_max, p_field);
begin
  if v is null then
    raise exception 'Text for % is required', p_field using errcode = '22023', hint = p_hint, detail = p_field;
  end if;
  return v;
end
$$;

create or replace function nexus._ib_condition(p_condition text)
returns text
language plpgsql immutable set search_path = ''
as $$
begin
  if p_condition is null or p_condition not in ('good', 'needs_service', 'damaged') then
    raise exception 'Condition must be good, needs_service or damaged' using errcode = '22023', hint = 'invalid_condition';
  end if;
  return p_condition;
end
$$;

-- Whole number from a JSON object, within bounds, else quantity_invalid (detail = key).
create or replace function nexus._ib_json_int(p_obj jsonb, p_key text, p_min integer, p_max integer)
returns integer
language plpgsql immutable set search_path = ''
as $$
declare
  v jsonb := p_obj -> p_key;
  n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then
    raise exception '% must be a whole number', p_key using errcode = '22023', hint = 'quantity_invalid', detail = p_key;
  end if;
  n := (v #>> '{}')::numeric;
  if n <> trunc(n) or n < p_min or n > p_max then
    raise exception '% must be a whole number from % to %', p_key, p_min, p_max
      using errcode = '22023', hint = 'quantity_invalid', detail = p_key;
  end if;
  return n::integer;
end
$$;

-- uuid from a JSON object (null when absent and not required), else invalid_input.
create or replace function nexus._ib_json_uuid(p_obj jsonb, p_key text, p_required boolean)
returns uuid
language plpgsql immutable set search_path = ''
as $$
declare
  v text := p_obj ->> p_key;
begin
  if v is null then
    if p_required then
      raise exception '% is required', p_key using errcode = '22023', hint = 'invalid_input', detail = p_key;
    end if;
    return null;
  end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '% is not a valid id', p_key using errcode = '22023', hint = 'invalid_input', detail = p_key;
  end if;
  return v::uuid;
end
$$;

-- Search text: trimmed, inner whitespace collapsed, max 120 (raw max 480, as Member Data). Returns an
-- ILIKE pattern with %, _ and \ escaped, or null for "no search".
create or replace function nexus._ib_search_pattern(p_search text)
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

create or replace function nexus._ib_check_page(p_page integer, p_page_size integer)
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

-- A date range for availability: both dates, end >= start, start not before today (Jakarta).
create or replace function nexus._ib_check_range(p_from date, p_to date)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from
     or not isfinite(p_from) or not isfinite(p_to) or p_from < date '2000-01-01' then
    raise exception 'Choose a start date and an end date that is not before it' using errcode = '22023', hint = 'invalid_dates';
  end if;
  if p_from < nexus._ib_today() then
    raise exception 'The start date cannot be before today' using errcode = '22023', hint = 'start_in_past';
  end if;
end
$$;

-- Current PI-CORE name (A-IB46). Name only; no other member column is ever read here (L4).
create or replace function nexus._ib_member_name(p_member_id uuid)
returns text
language sql stable set search_path = ''
as $$ select m.full_name from public.members m where m.id = p_member_id $$;

-- Lock item rows in id order (deadlock-free) so availability checks and stock writes serialise (R5).
create or replace function nexus._ib_lock_items(p_item_ids uuid[])
returns void
language plpgsql volatile set search_path = ''
as $$
begin
  perform 1 from nexus.inventory_items i where i.id = any (p_item_ids) order by i.id for update;
end
$$;

-- Per line: quantities, outstanding, and what the line HOLDS (R3, R4, R6, IB6):
--   submitted/rejected/cancelled/returned hold nothing;
--   approved holds the approved quantity on [start, end];
--   borrowed holds the outstanding quantity on [start, end], and OPEN-ENDED once overdue (end before
--   today, Jakarta): an overdue loan blocks every later day until it actually comes back (R4, IB-36).
-- Reversed return batches (A-IB15 correction) do not count.
create or replace function nexus._ib_line_state(p_item_ids uuid[] default null, p_request_ids uuid[] default null)
returns table (
  line_id            uuid,
  request_id         uuid,
  item_id            uuid,
  status             text,
  start_date         date,
  end_date           date,
  qty_requested      integer,
  qty_approved       integer,
  qty_handed         integer,
  qty_returned_good  integer,
  qty_returned_damaged integer,
  qty_returned_lost  integer,
  qty_outstanding    integer,
  held_qty           integer,
  hold_until         date
)
language sql stable set search_path = ''
as $$
  -- IN (select unnest(...)) instead of = any(...): a hashed lookup, not a scan of the whole array per
  -- row (review M1: thousands of request ids from the queue).
  with
  today as (select nexus._ib_today() as d),
  base as (
    select l.id, l.request_id, l.item_id, r.status, r.start_date, r.end_date,
           l.quantity_requested, l.quantity_approved, l.quantity_handed_over
    from nexus.borrowing_request_lines l
    join nexus.borrowing_requests r on r.id = l.request_id
    where (p_item_ids is null or l.item_id in (select unnest(p_item_ids)))
      and (p_request_ids is null or l.request_id in (select unnest(p_request_ids)))
  ),
  ret as (
    select lr.line_id,
           coalesce(sum(lr.quantity) filter (where lr.outcome = 'good'), 0)::int as g,
           coalesce(sum(lr.quantity) filter (where lr.outcome = 'damaged'), 0)::int as d,
           coalesce(sum(lr.quantity) filter (where lr.outcome = 'lost'), 0)::int as x
    from nexus.borrowing_line_returns lr
    where lr.line_id in (select b.id from base b)
      and not exists (select 1 from nexus.borrowing_return_reversals rv where rv.batch_id = lr.batch_id)
    group by lr.line_id
  ),
  calc as (
    select b.*, coalesce(ret.g, 0) as g, coalesce(ret.d, 0) as d, coalesce(ret.x, 0) as x,
           greatest(coalesce(b.quantity_handed_over, 0) - coalesce(ret.g, 0) - coalesce(ret.d, 0) - coalesce(ret.x, 0), 0) as outstanding
    from base b
    left join ret on ret.line_id = b.id
  )
  select c.id, c.request_id, c.item_id, c.status, c.start_date, c.end_date,
         c.quantity_requested, c.quantity_approved, c.quantity_handed_over,
         c.g, c.d, c.x, c.outstanding,
         case c.status when 'approved' then coalesce(c.quantity_approved, 0)
                       when 'borrowed' then c.outstanding
                       else 0 end,
         case when c.status = 'borrowed' and c.end_date < (select d from today) then null else c.end_date end
  from calc c
$$;

-- Free quantity per item over [p_from, p_to] (p_to null = no end): lendable stock (good, active) minus
-- the PEAK held quantity on any day of the range. The load only rises where a holding starts, so the
-- peak is found at p_from or at a holding start inside the range: no day-by-day loop (fast for long
-- ranges). `free` may be negative when an overdue loan already over-commits the stock.
create or replace function nexus._ib_items_free(p_item_ids uuid[], p_from date, p_to date, p_exclude_request uuid)
returns table (item_id uuid, lendable integer, peak_held integer, free integer)
language sql stable set search_path = ''
as $$
  with
  it as (
    select i.id, i.mode, i.is_active from nexus.inventory_items i where i.id = any (p_item_ids)
  ),
  lend as (
    select it.id,
           case when not it.is_active then 0
                when it.mode = 'quantity' then coalesce((select s.quantity from nexus.inventory_stock s
                                                         where s.item_id = it.id and s.condition = 'good'), 0)
                else (select count(*)::int from nexus.inventory_units u
                      where u.item_id = it.id and u.status = 'active' and u.condition = 'good')
           end as lendable
    from it
  ),
  h as (
    select ls.item_id, ls.held_qty, ls.start_date as s, ls.hold_until as e
    from nexus._ib_line_state(p_item_ids, null) ls
    where ls.held_qty > 0
      and ls.request_id is distinct from p_exclude_request
      and ls.start_date <= coalesce(p_to, 'infinity'::date)
      and (ls.hold_until is null or ls.hold_until >= p_from)
  ),
  days as (
    select distinct h.item_id, greatest(p_from, h.s) as d from h
  ),
  load as (
    select dd.item_id,
           (select sum(h2.held_qty) from h h2
            where h2.item_id = dd.item_id and h2.s <= dd.d and (h2.e is null or h2.e >= dd.d)) as n
    from days dd
  ),
  peak as (
    select l.item_id, max(l.n)::int as m from load l group by l.item_id
  )
  select lend.id, lend.lendable::int, coalesce(peak.m, 0), lend.lendable::int - coalesce(peak.m, 0)
  from lend
  left join peak on peak.item_id = lend.id
$$;

-- R3/R18: a change that removes p_qty from the lendable stock of an item is refused when the stock left
-- would be below what approved and borrowed requests hold on any day from today on. The message gives
-- the count only, never a requester (IB-13). Caller must hold the item lock.
create or replace function nexus._ib_check_reduction(p_item_id uuid, p_qty integer)
returns void
language plpgsql stable set search_path = ''
as $$
declare
  v_free integer;
  v_peak integer;
begin
  -- An archived item lends nothing and holds nothing (archiving needs zero open lines), so there is no
  -- reservation to protect.
  if not exists (select 1 from nexus.inventory_items i where i.id = p_item_id and i.is_active) then
    return;
  end if;
  select f.free, f.peak_held into v_free, v_peak
  from nexus._ib_items_free(array[p_item_id], nexus._ib_today(), null, null) f;
  if coalesce(v_free, 0) < p_qty then
    raise exception 'Not possible: % in good condition are reserved for open requests', v_peak
      using errcode = 'P0001', hint = 'reserved_stock', detail = v_peak::text;
  end if;
end
$$;

-- Units of this item currently out on an open loan.
create or replace function nexus._ib_unit_on_loan(p_unit_id uuid)
returns boolean
language sql stable set search_path = ''
as $$ select exists (select 1 from nexus.borrowing_line_units lu where lu.unit_id = p_unit_id and lu.return_id is null) $$;

-- Open request lines of an item (blocks archiving, F2 step 7): submitted lines, approved lines that hold
-- something, borrowed lines with outstanding quantity.
create or replace function nexus._ib_open_line_count(p_item_id uuid)
returns integer
language sql stable set search_path = ''
as $$
  select count(*)::int
  from nexus._ib_line_state(array[p_item_id], null) ls
  where ls.status = 'submitted'
     or (ls.status = 'approved' and ls.held_qty > 0)
     or (ls.status = 'borrowed' and ls.qty_outstanding > 0)
$$;

-- Item history row (A-IB6). Actor and period from the session.
create or replace function nexus._ib_item_log(
  p_item_id uuid, p_unit_id uuid, p_kind text, p_from text, p_to text, p_qty integer, p_note text,
  p_request_id uuid, p_details jsonb)
returns void
language sql volatile set search_path = ''
as $$
  insert into nexus.inventory_item_history
    (item_id, unit_id, kind, condition_from, condition_to, quantity, note, request_id, details, actor_member_id, period_id)
  values
    (p_item_id, p_unit_id, p_kind, p_from, p_to, p_qty, p_note, p_request_id, p_details,
     nexus.current_member_id(), nexus.active_period_id())
$$;

-- Request timeline row.
create or replace function nexus._ib_status_log(p_request_id uuid, p_event text, p_from text, p_to text, p_note text)
returns void
language sql volatile set search_path = ''
as $$
  insert into nexus.borrowing_status_history (request_id, event, from_status, to_status, actor_member_id, note, period_id)
  values (p_request_id, p_event, p_from, p_to, nexus.current_member_id(), p_note, nexus.active_period_id())
$$;

-- Lock one request for an action and check it is visible to the caller and still at the version the
-- caller saw. A request the caller may not see answers "not found", exactly like a missing id (R8).
create or replace function nexus._ib_lock_request(p_request_id uuid, p_version integer)
returns nexus.borrowing_requests
language plpgsql volatile set search_path = ''
as $$
declare
  v_req nexus.borrowing_requests;
begin
  select r.* into v_req from nexus.borrowing_requests r where r.id = p_request_id for update;
  if not found
     or not (v_req.requester_member_id = nexus.current_member_id() or nexus.has_permission('borrowing.view_all')) then
    raise exception 'Request not found' using errcode = 'P0002', hint = 'request_not_found';
  end if;
  if p_version is null or p_version <> v_req.version then
    raise exception 'The request changed in the meantime; reload' using errcode = 'P0001', hint = 'state_changed';
  end if;
  return v_req;
end
$$;

create or replace function nexus._ib_require_status(p_actual text, p_allowed text[])
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

-- L6 (amended, D-022): approve, reject and extend are never allowed on the caller's own request, also
-- for an outside-party request the caller recorded (they are its requester of record). Reuses the
-- engine helper, whose list deliberately does NOT contain borrowing.handle.
create or replace function nexus._ib_require_not_own(p_requester uuid)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not nexus.can_process_request('borrowing.approve', p_requester) then
    raise exception 'You cannot approve, reject or extend your own request (L6)'
      using errcode = '42501', hint = 'self_approval_blocked';
  end if;
end
$$;

-- =============================================================================================
-- 6. Request summary rows (shared by "Peminjaman Saya", the queue, open loans and the export, so they
--    can never disagree). Names come from PI-CORE at read time (A-IB46). Derived flags use Jakarta
--    today (R9, R19). No permission check here: callers filter.
-- =============================================================================================

-- Review M1: the rows are filtered BEFORE the expensive part (line state, names, flags), so "Peminjaman
-- Saya" reads only the caller's requests and each queue view only its statuses. The pending-overlap
-- warning is NOT computed here; see nexus._ib_pending_overlap() (page rows and the detail only).
-- (An earlier draft had a zero-argument version; on a database that ran it, that overload stays unused
-- and without client EXECUTE.)
create or replace function nexus._ib_request_rows(
  p_requester_member_id uuid, p_statuses text[], p_period_id uuid, p_request_id uuid)
returns table (
  request_id            uuid,
  reference             text,
  status                text,
  version               integer,
  period_id             uuid,
  period_label          text,
  requester_member_id   uuid,
  requester_name        text,
  is_outside_party      boolean,
  outside_org_name      text,
  outside_contact_name  text,
  purpose               text,
  start_date            date,
  end_date              date,
  created_at            timestamptz,
  updated_at            timestamptz,
  decided_at            timestamptz,
  decided_by_name       text,
  decision_note         text,
  handed_over_at        timestamptz,
  handed_over_by_name   text,
  returned_at           timestamptz,
  has_issue             boolean,
  items                 jsonb,
  item_names            text,
  qty_outstanding       integer,
  is_overdue            boolean,
  overdue_days          integer,
  is_not_picked_up      boolean,
  is_partially_returned boolean,
  extension_count       integer
)
language sql stable set search_path = ''
as $$
  with
  today as (select nexus._ib_today() as d),
  req as (
    select r.*
    from nexus.borrowing_requests r
    where (p_requester_member_id is null or r.requester_member_id = p_requester_member_id)
      and (p_statuses is null or r.status = any (p_statuses))
      and (p_period_id is null or r.period_id = p_period_id)
      and (p_request_id is null or r.id = p_request_id)
  ),
  ls as (select * from nexus._ib_line_state(null, array(select q.id from req q))),
  agg as (
    select l.request_id,
           jsonb_agg(jsonb_build_object(
             'item_id', l.item_id, 'name', i.name, 'code', i.code, 'mode', i.mode,
             'quantity_requested', l.qty_requested, 'quantity_approved', l.qty_approved,
             'quantity_handed_over', l.qty_handed, 'quantity_outstanding', l.qty_outstanding)
             order by lower(i.name) collate "C", i.id) as items,
           string_agg(i.name, ' ' order by i.name) as names,
           sum(l.qty_outstanding)::int as outstanding,
           sum(l.qty_returned_good + l.qty_returned_damaged + l.qty_returned_lost)::int as returned_any
    from ls l
    join nexus.inventory_items i on i.id = l.item_id
    group by l.request_id
  ),
  ext as (
    select e.request_id, count(*)::int as n
    from nexus.borrowing_extensions e
    where e.request_id in (select q.id from req q)
    group by e.request_id
  )
  select r.id, r.reference, r.status, r.version, r.period_id, p.label,
         r.requester_member_id, m.full_name,
         r.is_outside_party, r.outside_org_name, r.outside_contact_name,
         r.purpose, r.start_date, r.end_date, r.created_at, r.updated_at,
         r.decided_at, dm.full_name, r.decision_note,
         r.handed_over_at, hm.full_name, r.returned_at, r.has_issue,
         coalesce(a.items, '[]'::jsonb), coalesce(a.names, ''),
         coalesce(a.outstanding, 0),
         r.status = 'borrowed' and coalesce(a.outstanding, 0) > 0 and r.end_date < (select d from today),
         case when r.status = 'borrowed' and coalesce(a.outstanding, 0) > 0 and r.end_date < (select d from today)
              then (select d from today) - r.end_date else 0 end,
         r.status = 'approved' and r.start_date < (select d from today),
         r.status = 'borrowed' and coalesce(a.outstanding, 0) > 0 and coalesce(a.returned_any, 0) > 0,
         coalesce(x.n, 0)
  from req r
  left join public.periods p on p.id = r.period_id
  left join public.members m on m.id = r.requester_member_id
  left join public.members dm on dm.id = r.decided_by
  left join public.members hm on hm.id = r.handed_over_by
  left join agg a on a.request_id = r.id
  left join ext x on x.request_id = r.id
$$;

-- R6 warning for ONE submitted request: how many OTHER submitted requests share an item and a day.
-- Called only for the rows a screen actually shows (queue page, detail).
create or replace function nexus._ib_pending_overlap(p_request_id uuid)
returns integer
language sql stable set search_path = ''
as $$
  select count(distinct o.id)::int
  from nexus.borrowing_requests r
  join nexus.borrowing_requests o
    on o.status = 'submitted' and o.id <> r.id and o.start_date <= r.end_date and o.end_date >= r.start_date
  join nexus.borrowing_request_lines ol on ol.request_id = o.id
  where r.id = p_request_id and r.status = 'submitted'
    and ol.item_id in (select l2.item_id from nexus.borrowing_request_lines l2 where l2.request_id = r.id)
$$;

-- Queue / export filter (F4, F11, design 11.1). One definition for the list, open loans and the export.
--   pending          Diajukan, all periods, oldest first
--   ready            Disetujui (waiting for pick-up, incl. Belum diambil), all periods, soonest start first
--   borrowed         Dipinjam, all periods, Terlambat first, then end date
--   overdue          Dipinjam and Terlambat, oldest end date first
--   closed           Dikembalikan, Ditolak, Dibatalkan, all periods, newest first
--   all              everything of the ACTIVE period, newest first
--   open_all_periods Belum selesai (semua periode): oldest period first, Terlambat first (A-IB11)
-- Open items stay visible across periods on purpose (L7: they stay actionable after a period switch).
-- Search: reference, requester name, organisation, contact person, item name. Dates: overlap. Item: any line.
create or replace function nexus._ib_queue_rows(p_view text, p_search text, p_from date, p_to date, p_item_id uuid)
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
begin
  if v_view not in ('pending', 'ready', 'borrowed', 'overdue', 'closed', 'all', 'open_all_periods') then
    raise exception 'Unknown view' using errcode = '22023', hint = 'invalid_view';
  end if;
  if (p_from is null) <> (p_to is null) or p_to < p_from
     or (p_from is not null and (not isfinite(p_from) or not isfinite(p_to) or p_from < date '2000-01-01')) then
    raise exception 'Choose both dates, the end not before the start' using errcode = '22023', hint = 'invalid_dates';
  end if;
  -- "all" = the active period; with no active period there is nothing to show.
  if v_view = 'all' and v_period is null then
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
         case when v_view = 'all' then v_period end, null) x
  where case v_view
          when 'pending' then x.status = 'submitted'
          when 'ready' then x.status = 'approved'
          when 'borrowed' then x.status = 'borrowed'
          when 'overdue' then x.status = 'borrowed' and x.is_overdue
          when 'closed' then x.status in ('returned', 'rejected', 'cancelled')
          when 'all' then x.period_id = v_period
          else x.status in ('submitted', 'approved', 'borrowed')
        end
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

-- Catalog rows (F1, design screen 2), shared by the list and the export. Counts exclude archived and
-- lost units (A-IB32). p_all_units: managers also get archived/lost units in the unit list.
--   status    active (default) / archived / all (the caller checks inventory.manage for the last two)
--   condition items with at least one unit or quantity in that condition
--   location  quantity item: its location; tracked item: any active unit there
create or replace function nexus._ib_item_rows(
  p_search text, p_category_id uuid, p_location_id uuid, p_condition text, p_status text, p_all_units boolean)
returns table (
  ordinal bigint, item_id uuid, code text, name text, mode text, description text,
  category_id uuid, category_name text, location_id uuid, location_name text, location_count integer,
  is_active boolean, unit_count integer, qty_good integer, qty_needs_service integer, qty_damaged integer,
  qty_total integer, units jsonb
)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_pattern text := nexus._ib_search_pattern(p_search);
begin
  if p_condition is not null then
    perform nexus._ib_condition(p_condition);
  end if;
  return query
  with
  counts as (
    select i.id,
           case when i.mode = 'quantity' then coalesce((select s.quantity from nexus.inventory_stock s where s.item_id = i.id and s.condition = 'good'), 0)
                else (select count(*)::int from nexus.inventory_units u where u.item_id = i.id and u.status = 'active' and u.condition = 'good') end as g,
           case when i.mode = 'quantity' then coalesce((select s.quantity from nexus.inventory_stock s where s.item_id = i.id and s.condition = 'needs_service'), 0)
                else (select count(*)::int from nexus.inventory_units u where u.item_id = i.id and u.status = 'active' and u.condition = 'needs_service') end as ns,
           case when i.mode = 'quantity' then coalesce((select s.quantity from nexus.inventory_stock s where s.item_id = i.id and s.condition = 'damaged'), 0)
                else (select count(*)::int from nexus.inventory_units u where u.item_id = i.id and u.status = 'active' and u.condition = 'damaged') end as dm
    from nexus.inventory_items i
  ),
  picked as (
    select i.*, c.g, c.ns, c.dm
    from nexus.inventory_items i
    join counts c on c.id = i.id
    where (p_status = 'all' or i.is_active = (p_status = 'active'))
      and (p_category_id is null or i.category_id = p_category_id)
      and (p_location_id is null
           or (i.mode = 'quantity' and i.location_id = p_location_id)
           or (i.mode = 'tracked' and exists (select 1 from nexus.inventory_units u
                                              where u.item_id = i.id and u.status = 'active' and u.location_id = p_location_id)))
      and (p_condition is null
           or (p_condition = 'good' and c.g > 0)
           or (p_condition = 'needs_service' and c.ns > 0)
           or (p_condition = 'damaged' and c.dm > 0))
      and (v_pattern is null
           or i.name ilike v_pattern escape '\'
           or i.code ilike v_pattern escape '\'
           or exists (select 1 from nexus.inventory_units u where u.item_id = i.id and u.code ilike v_pattern escape '\'
                                                       and (p_all_units or u.status = 'active')))
  )
  select row_number() over (order by lower(p.name) collate "C", p.id),
         p.id, p.code, p.name, p.mode, p.description,
         p.category_id, cat.name, p.location_id, loc.name,
         case when p.mode = 'tracked'
              then (select count(distinct u.location_id)::int from nexus.inventory_units u
                    where u.item_id = p.id and u.status = 'active' and u.location_id is not null)
              else (case when p.location_id is null then 0 else 1 end) end,
         p.is_active,
         case when p.mode = 'tracked'
              then (select count(*)::int from nexus.inventory_units u where u.item_id = p.id and u.status = 'active')
              else 0 end,
         p.g, p.ns, p.dm, p.g + p.ns + p.dm,
         case when p.mode = 'tracked' then coalesce((
           select jsonb_agg(jsonb_build_object(
                    'unit_id', u.id, 'code', u.code, 'condition', u.condition, 'status', u.status,
                    'location_id', u.location_id, 'location_name', ul.name)
                    order by u.code)
           from nexus.inventory_units u
           left join nexus.inventory_locations ul on ul.id = u.location_id
           where u.item_id = p.id and (p_all_units or u.status = 'active')), '[]'::jsonb)
         end
  from picked p
  left join nexus.inventory_categories cat on cat.id = p.category_id
  left join nexus.inventory_locations loc on loc.id = p.location_id;
end
$$;

-- Catalog status filter: active is for everyone; archived/all only for inventory.manage (A-IB5).
create or replace function nexus._ib_item_status(p_status text)
returns text
language plpgsql stable set search_path = ''
as $$
declare
  v text := coalesce(nullif(lower(btrim(p_status)), ''), 'active');
begin
  if v not in ('active', 'archived', 'all') then
    raise exception 'Status filter must be active, archived or all' using errcode = '22023', hint = 'invalid_status';
  end if;
  if v <> 'active' then
    perform nexus._require_permission('inventory.manage');
  end if;
  return v;
end
$$;

-- =============================================================================================
-- 7. Inventory read functions (inventory.view = every active member, D01; never who holds an item, R8)
-- =============================================================================================

-- 7.1 Catalog list (F1, design screen 2). Page size 1..50 (default 20, A-IB20); a page past the end
-- returns the last page. Optional "Tersedia pada tanggal" (design P2): with both dates, free_qty is
-- filled and items with nothing free sort last. Counts only.
create or replace function nexus.inventory_item_list(
  p_search         text    default null,
  p_category_id    uuid    default null,
  p_location_id    uuid    default null,
  p_condition      text    default null,
  p_status         text    default 'active',
  p_available_from date    default null,
  p_available_to   date    default null,
  p_page           integer default 1,
  p_page_size      integer default 20
)
returns table (
  row_no bigint, item_id uuid, code text, name text, mode text, category_id uuid, category_name text,
  location_id uuid, location_name text, location_count integer, is_active boolean, unit_count integer,
  qty_good integer, qty_needs_service integer, qty_damaged integer, qty_total integer, lendable_qty integer,
  free_qty integer, units jsonb, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text;
  v_dates  boolean := p_available_from is not null or p_available_to is not null;
begin
  perform nexus._require_permission('inventory.view');
  v_status := nexus._ib_item_status(p_status);
  perform nexus._ib_check_page(p_page, p_page_size);
  if v_dates then
    perform nexus._ib_check_range(p_available_from, p_available_to);
  end if;

  return query
  with
  r as (select * from nexus._ib_item_rows(p_search, p_category_id, p_location_id, p_condition, v_status,
                                          nexus.has_permission('inventory.manage'))),
  f as (select * from nexus._ib_items_free(array(select r.item_id from r), p_available_from, p_available_to, null)
        where v_dates),
  o as (
    select r.*, case when r.is_active then r.qty_good else 0 end as lend,
           case when v_dates then greatest(coalesce(f.free, 0), 0) end as fr,
           row_number() over (order by case when v_dates and coalesce(f.free, 0) <= 0 then 1 else 0 end, r.ordinal) as rn
    from r left join f on f.item_id = r.item_id
  ),
  t as (select count(*) as n from o),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select o.rn, o.item_id, o.code, o.name, o.mode, o.category_id, o.category_name, o.location_id, o.location_name,
         o.location_count, o.is_active, o.unit_count, o.qty_good, o.qty_needs_service, o.qty_damaged, o.qty_total,
         o.lend, o.fr, o.units, t.n, pg.pno, p_page_size
  from o cross join t cross join pg
  where o.rn > (pg.pno - 1)::bigint * p_page_size and o.rn <= pg.pno::bigint * p_page_size
  order by o.rn;
end
$$;

-- 7.2 Item detail (design screen 3) as one JSON object: fields, stock per condition, units. Archived
-- items (and archived/lost units) only for inventory.manage; for others an archived item is "not found".
create or replace function nexus.inventory_item_detail(p_item_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_manage boolean;
  v_row    record;
begin
  perform nexus._require_permission('inventory.view');
  v_manage := nexus.has_permission('inventory.manage');
  select * into v_row
  from nexus._ib_item_rows(null, null, null, null, 'all', v_manage) r
  where r.item_id = p_item_id;
  if not found or (not v_row.is_active and not v_manage) then
    raise exception 'Item not found' using errcode = 'P0002', hint = 'item_not_found';
  end if;
  return jsonb_build_object(
    'item_id', v_row.item_id, 'code', v_row.code, 'name', v_row.name, 'mode', v_row.mode,
    'description', v_row.description, 'category_id', v_row.category_id, 'category_name', v_row.category_name,
    'location_id', v_row.location_id, 'location_name', v_row.location_name, 'location_count', v_row.location_count,
    'is_active', v_row.is_active, 'unit_count', v_row.unit_count,
    'stock', jsonb_build_object('good', v_row.qty_good, 'needs_service', v_row.qty_needs_service,
                                'damaged', v_row.qty_damaged, 'total', v_row.qty_total),
    'lendable_qty', case when v_row.is_active then v_row.qty_good else 0 end,
    'units', coalesce(v_row.units, '[]'::jsonb));
end
$$;

-- 7.3 Availability for one item and date range (F1.3, R8, IB-18): counts only, never who holds it.
-- held_qty = lendable - free ("k lainnya sudah dipesan atau sedang dipinjam").
create or replace function nexus.inventory_item_availability(p_item_id uuid, p_from date, p_to date)
returns table (item_id uuid, lendable_qty integer, free_qty integer, held_qty integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('inventory.view');
  perform nexus._ib_check_range(p_from, p_to);
  if not exists (select 1 from nexus.inventory_items i
                 where i.id = p_item_id and (i.is_active or nexus.has_permission('inventory.manage'))) then
    raise exception 'Item not found' using errcode = 'P0002', hint = 'item_not_found';
  end if;
  return query
  select f.item_id, f.lendable, greatest(f.free, 0), f.lendable - greatest(f.free, 0)
  from nexus._ib_items_free(array[p_item_id], p_from, p_to, null) f;
end
$$;

-- 7.4 Bulk availability (design P2, G9): up to 100 items in one call for the catalog date filter and
-- the request form. Unknown or archived ids are left out (no error, no hint about them).
create or replace function nexus.inventory_availability_bulk(p_item_ids uuid[], p_from date, p_to date)
returns table (item_id uuid, lendable_qty integer, free_qty integer, held_qty integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('inventory.view');
  perform nexus._ib_check_range(p_from, p_to);
  if p_item_ids is null or cardinality(p_item_ids) > 100 then
    raise exception 'Give 0 to 100 item ids' using errcode = '22023', hint = 'invalid_input', detail = 'p_item_ids';
  end if;
  return query
  select f.item_id, f.lendable, greatest(f.free, 0), f.lendable - greatest(f.free, 0)
  from nexus._ib_items_free(array(select i.id from nexus.inventory_items i
                                  where i.id = any (p_item_ids) and i.is_active), p_from, p_to, null) f
  order by f.item_id;
end
$$;

-- 7.5 Category and location lists (IB10, design screen 5), A-Z (A-IB44). item_count = active items using it.
create or replace function nexus.inventory_category_list(p_include_inactive boolean default true)
returns table (id uuid, name text, is_active boolean, item_count integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('inventory.view');
  return query
  select c.id, c.name, c.is_active,
         (select count(*)::int from nexus.inventory_items i where i.category_id = c.id and i.is_active)
  from nexus.inventory_categories c
  where coalesce(p_include_inactive, true) or c.is_active
  order by lower(c.name) collate "C", c.id;
end
$$;

create or replace function nexus.inventory_location_list(p_include_inactive boolean default true)
returns table (id uuid, name text, is_active boolean, item_count integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('inventory.view');
  return query
  select l.id, l.name, l.is_active,
         (select count(distinct i.id)::int from nexus.inventory_items i
          where i.is_active and (i.location_id = l.id
                                 or exists (select 1 from nexus.inventory_units u
                                            where u.item_id = i.id and u.status = 'active' and u.location_id = l.id)))
  from nexus.inventory_locations l
  where coalesce(p_include_inactive, true) or l.is_active
  order by lower(l.name) collate "C", l.id;
end
$$;

-- 7.6 Item history (A-IB6): managers and borrowing viewers. Actor = current PI-CORE name, nothing else.
create or replace function nexus.inventory_item_history_list(p_item_id uuid, p_page integer default 1, p_page_size integer default 20)
returns table (
  history_id bigint, occurred_at timestamptz, kind text, unit_id uuid, unit_code text, condition_from text,
  condition_to text, quantity integer, note text, request_id uuid, request_reference text, details jsonb,
  actor_member_id uuid, actor_name text, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_total bigint;
  v_page  integer;
begin
  if not (nexus.has_permission('inventory.manage') or nexus.has_permission('borrowing.view_all')) then
    raise exception 'Missing NEXUS permission inventory.manage'
      using errcode = '42501', hint = 'permission_required', detail = 'inventory.manage';
  end if;
  perform nexus._ib_check_page(p_page, p_page_size);
  select count(*) into v_total from nexus.inventory_item_history h where h.item_id = p_item_id;
  v_page := least(p_page, greatest(1, ceil(v_total::numeric / p_page_size)::integer));
  return query
  select h.id, h.occurred_at, h.kind, h.unit_id, u.code, h.condition_from, h.condition_to, h.quantity, h.note,
         h.request_id, r.reference, h.details, h.actor_member_id, nexus._ib_member_name(h.actor_member_id),
         v_total, v_page, p_page_size
  from nexus.inventory_item_history h
  left join nexus.inventory_units u on u.id = h.unit_id
  left join nexus.borrowing_requests r on r.id = h.request_id
  where h.item_id = p_item_id
  order by h.id desc
  offset (v_page - 1)::bigint * p_page_size
  limit p_page_size;
end
$$;

-- 7.7 Dashboard "Inventaris Status" (IB12, A-IB32, design P7): units/quantity in good (including on
-- loan), how many of those are on loan now, units/quantity needing service. Archived items, archived
-- units and lost units are not counted; Rusak is not on the card. item_count for the empty state.
create or replace function nexus.inventory_status_counts()
returns table (good_count integer, good_on_loan_count integer, needs_service_count integer, item_count integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('inventory.view');
  return query
  with
  act as (select i.id, i.mode from nexus.inventory_items i where i.is_active),
  q as (
    select coalesce(sum(s.quantity) filter (where s.condition = 'good'), 0)::int as g,
           coalesce(sum(s.quantity) filter (where s.condition = 'needs_service'), 0)::int as ns
    from nexus.inventory_stock s join act on act.id = s.item_id
  ),
  t as (
    select count(*) filter (where u.condition = 'good')::int as g,
           count(*) filter (where u.condition = 'needs_service')::int as ns
    from nexus.inventory_units u join act on act.id = u.item_id
    where u.status = 'active'
  ),
  loan as (
    select coalesce(sum(ls.qty_outstanding), 0)::int as n
    from nexus._ib_line_state(null, null) ls
    join act on act.id = ls.item_id
    where ls.status = 'borrowed'
  )
  select q.g + t.g, loan.n, q.ns + t.ns, (select count(*)::int from act)
  from q, t, loan;
end
$$;

-- =============================================================================================
-- 8. Inventory write functions (inventory.manage; Operations by default, D28). Every one writes an
--    item history row. Stock and condition changes need a reason (design P6, A-IB6).
-- =============================================================================================

-- 8.1 Categories and locations (IB10, A-IB2). Add, rename, deactivate/reactivate; never delete.
create or replace function nexus._ib_list_write(p_table text, p_id uuid, p_name text, p_active boolean)
returns uuid
language plpgsql volatile set search_path = ''
as $$
declare
  v_name   text;
  v_max    integer := case when p_table = 'inventory_categories' then 60 else 80 end;
  v_member uuid := nexus.current_member_id();
  v_id     uuid;
begin
  perform nexus._require_permission('inventory.manage');
  if p_name is not null or p_id is null then
    v_name := nexus._ib_required_text(p_name, v_max, 'name', 'text_required');
    execute format('select x.id from nexus.%I x where lower(x.name) = lower($1) and x.id is distinct from $2', p_table)
      into v_id using v_name, p_id;
    if v_id is not null then
      raise exception 'This name already exists' using errcode = '23505', hint = 'duplicate_name';
    end if;
  end if;
  if p_id is null then
    execute format('insert into nexus.%I (name, created_by, updated_by) values ($1, $2, $2) returning id', p_table)
      into v_id using v_name, v_member;
    return v_id;
  end if;
  execute format('update nexus.%I set name = coalesce($2, name), is_active = coalesce($3, is_active),
                    updated_at = now(), updated_by = $4 where id = $1 returning id', p_table)
    into v_id using p_id, v_name, p_active, v_member;
  if v_id is null then
    raise exception 'Entry not found' using errcode = 'P0002',
      hint = case when p_table = 'inventory_categories' then 'category_not_found' else 'location_not_found' end;
  end if;
  return v_id;
end
$$;

create or replace function nexus.inventory_category_add(p_name text)
returns uuid language sql volatile security definer set search_path = ''
as $$ select nexus._ib_list_write('inventory_categories', null, p_name, null) $$;
create or replace function nexus.inventory_category_rename(p_category_id uuid, p_name text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$ begin
  if p_category_id is null then raise exception 'Entry not found' using errcode = 'P0002', hint = 'category_not_found'; end if;
  return nexus._ib_list_write('inventory_categories', p_category_id, coalesce(p_name, ''), null);
end $$;
create or replace function nexus.inventory_category_set_active(p_category_id uuid, p_is_active boolean)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$ begin
  if p_category_id is null or p_is_active is null then
    raise exception 'Entry and state are required' using errcode = '22023', hint = 'invalid_input';
  end if;
  return nexus._ib_list_write('inventory_categories', p_category_id, null, p_is_active);
end $$;
create or replace function nexus.inventory_location_add(p_name text)
returns uuid language sql volatile security definer set search_path = ''
as $$ select nexus._ib_list_write('inventory_locations', null, p_name, null) $$;
create or replace function nexus.inventory_location_rename(p_location_id uuid, p_name text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$ begin
  if p_location_id is null then raise exception 'Entry not found' using errcode = 'P0002', hint = 'location_not_found'; end if;
  return nexus._ib_list_write('inventory_locations', p_location_id, coalesce(p_name, ''), null);
end $$;
create or replace function nexus.inventory_location_set_active(p_location_id uuid, p_is_active boolean)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$ begin
  if p_location_id is null or p_is_active is null then
    raise exception 'Entry and state are required' using errcode = '22023', hint = 'invalid_input';
  end if;
  return nexus._ib_list_write('inventory_locations', p_location_id, null, p_is_active);
end $$;

-- A category or location picked for something NEW must exist and be active; keeping the current
-- (possibly deactivated) value is allowed (IB-10: a deactivated entry stays on existing items).
create or replace function nexus._ib_check_list_pick(p_table text, p_id uuid, p_current uuid)
returns void
language plpgsql stable set search_path = ''
as $$
declare
  v_active boolean;
begin
  if p_id is null or p_id is not distinct from p_current then
    return;
  end if;
  execute format('select x.is_active from nexus.%I x where x.id = $1', p_table) into v_active using p_id;
  if v_active is null then
    raise exception 'Entry not found' using errcode = 'P0002',
      hint = case when p_table = 'inventory_categories' then 'category_not_found' else 'location_not_found' end;
  end if;
  if not v_active then
    raise exception 'This entry is inactive and cannot be chosen' using errcode = '22023', hint = 'invalid_input',
      detail = case when p_table = 'inventory_categories' then 'category_id' else 'location_id' end;
  end if;
end
$$;

-- Units from JSON: [{"condition": "good", "location_id": "<uuid or null>"}, ...], 1..200.
create or replace function nexus._ib_insert_units(p_item_id uuid, p_units jsonb, p_note text)
returns text[]
language plpgsql volatile set search_path = ''
as $$
declare
  v_unit   jsonb;
  v_cond   text;
  v_loc    uuid;
  v_code   text;
  v_codes  text[] := '{}';
  v_id     uuid;
  v_member uuid := nexus.current_member_id();
begin
  if p_units is null or jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) not between 1 and 200 then
    raise exception 'Give 1 to 200 units' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_units';
  end if;
  for v_unit in select e from jsonb_array_elements(p_units) e loop
    if jsonb_typeof(v_unit) <> 'object' then
      raise exception 'Each unit must be an object' using errcode = '22023', hint = 'invalid_input', detail = 'p_units';
    end if;
    v_cond := nexus._ib_condition(v_unit ->> 'condition');
    v_loc := nexus._ib_json_uuid(v_unit, 'location_id', false);
    perform nexus._ib_check_list_pick('inventory_locations', v_loc, null);
    v_code := nexus._ib_code('INV', nextval('nexus.inventory_code_seq'));
    insert into nexus.inventory_units (item_id, code, condition, location_id, created_by, updated_by)
    values (p_item_id, v_code, v_cond, v_loc, v_member, v_member)
    returning id into v_id;
    perform nexus._ib_item_log(p_item_id, v_id, 'unit_added', null, v_cond, 1, p_note, null,
                               jsonb_build_object('code', v_code));
    v_codes := v_codes || v_code;
  end loop;
  return v_codes;
end
$$;

-- 8.2 Create an item (F2, design 7.1/7.2). Mode first and forever (P5 a). The database assigns every
-- code (IB11). Quantity: p_stock = {"good": n, "needs_service": n, "damaged": n}, total >= 1, one
-- location (G1). Tracked: p_units as above, item-level location must be null (per unit).
create or replace function nexus.inventory_item_create(
  p_mode        text,
  p_name        text,
  p_description text  default null,
  p_category_id uuid  default null,
  p_location_id uuid  default null,
  p_stock       jsonb default null,
  p_units       jsonb default null,
  p_note        text  default null
)
returns table (item_id uuid, item_code text, unit_codes text[])
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_name   text;
  v_desc   text;
  v_note   text;
  v_member uuid;
  v_id     uuid;
  v_code   text;
  v_codes  text[];
  v_g      integer;
  v_ns     integer;
  v_dm     integer;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  v_member := nexus.current_member_id();
  if p_mode is null or p_mode not in ('tracked', 'quantity') then
    raise exception 'Choose how the item is recorded: tracked or quantity' using errcode = '22023', hint = 'invalid_mode';
  end if;
  v_name := nexus._ib_required_text(p_name, 120, 'name', 'text_required');
  v_desc := nexus._ib_text(p_description, 1000, 'description');
  v_note := nexus._ib_text(p_note, 500, 'note');
  perform nexus._ib_check_list_pick('inventory_categories', p_category_id, null);

  if p_mode = 'quantity' then
    if p_units is not null then
      raise exception 'A quantity item has no units' using errcode = '22023', hint = 'invalid_input', detail = 'p_units';
    end if;
    perform nexus._ib_check_list_pick('inventory_locations', p_location_id, null);
    if p_stock is null or jsonb_typeof(p_stock) <> 'object'
       or exists (select 1 from jsonb_object_keys(p_stock) k where k not in ('good', 'needs_service', 'damaged')) then
      raise exception 'Give the stock as good, needs_service and damaged counts' using errcode = '22023', hint = 'invalid_input', detail = 'p_stock';
    end if;
    v_g  := coalesce(nexus._ib_json_int(p_stock || jsonb_build_object('good', coalesce(p_stock -> 'good', '0'::jsonb)), 'good', 0, 9999), 0);
    v_ns := nexus._ib_json_int(p_stock || jsonb_build_object('needs_service', coalesce(p_stock -> 'needs_service', '0'::jsonb)), 'needs_service', 0, 9999);
    v_dm := nexus._ib_json_int(p_stock || jsonb_build_object('damaged', coalesce(p_stock -> 'damaged', '0'::jsonb)), 'damaged', 0, 9999);
    if v_g + v_ns + v_dm < 1 then
      raise exception 'Enter at least one item' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_stock';
    end if;
    v_code := nexus._ib_code('INV', nextval('nexus.inventory_code_seq'));
    insert into nexus.inventory_items (mode, code, name, description, category_id, location_id, created_by, updated_by)
    values ('quantity', v_code, v_name, v_desc, p_category_id, p_location_id, v_member, v_member)
    returning id into v_id;
    insert into nexus.inventory_stock (item_id, condition, quantity, updated_by)
    values (v_id, 'good', v_g, v_member), (v_id, 'needs_service', v_ns, v_member), (v_id, 'damaged', v_dm, v_member);
    perform nexus._ib_item_log(v_id, null, 'created', null, null, null, v_note, null,
      jsonb_build_object('mode', 'quantity', 'code', v_code, 'good', v_g, 'needs_service', v_ns, 'damaged', v_dm));
    v_codes := '{}';
  else
    if p_stock is not null then
      raise exception 'A tracked item has units, not stock counts' using errcode = '22023', hint = 'invalid_input', detail = 'p_stock';
    end if;
    if p_location_id is not null then
      raise exception 'A tracked item has a location per unit' using errcode = '22023', hint = 'location_per_unit';
    end if;
    insert into nexus.inventory_items (mode, name, description, category_id, created_by, updated_by)
    values ('tracked', v_name, v_desc, p_category_id, v_member, v_member)
    returning id into v_id;
    perform nexus._ib_item_log(v_id, null, 'created', null, null, null, v_note, null, jsonb_build_object('mode', 'tracked'));
    v_codes := nexus._ib_insert_units(v_id, p_units, v_note);
  end if;
  return query select v_id, v_code, v_codes;
end
$$;

-- 8.3 Edit fields (not stock, not mode, not code). All fields are sent as on the form; an unchanged form
-- writes nothing. The history row lists what changed (old -> new).
create or replace function nexus.inventory_item_update(
  p_item_id     uuid,
  p_name        text,
  p_description text default null,
  p_category_id uuid default null,
  p_location_id uuid default null,
  p_note        text default null
)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_item    nexus.inventory_items;
  v_name    text;
  v_desc    text;
  v_changes jsonb := '{}'::jsonb;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  select * into v_item from nexus.inventory_items i where i.id = p_item_id for update;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002', hint = 'item_not_found';
  end if;
  v_name := nexus._ib_required_text(p_name, 120, 'name', 'text_required');
  v_desc := nexus._ib_text(p_description, 1000, 'description');
  perform nexus._ib_check_list_pick('inventory_categories', p_category_id, v_item.category_id);
  if v_item.mode = 'tracked' and p_location_id is not null then
    raise exception 'A tracked item has a location per unit' using errcode = '22023', hint = 'location_per_unit';
  end if;
  perform nexus._ib_check_list_pick('inventory_locations', p_location_id, v_item.location_id);

  if v_name is distinct from v_item.name then
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_array(v_item.name, v_name));
  end if;
  if v_desc is distinct from v_item.description then
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_array(v_item.description, v_desc));
  end if;
  if p_category_id is distinct from v_item.category_id then
    v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_array(v_item.category_id, p_category_id));
  end if;
  if p_location_id is distinct from v_item.location_id then
    v_changes := v_changes || jsonb_build_object('location_id', jsonb_build_array(v_item.location_id, p_location_id));
  end if;
  if v_changes = '{}'::jsonb then
    return false;
  end if;
  update nexus.inventory_items
  set name = v_name, description = v_desc, category_id = p_category_id, location_id = p_location_id,
      updated_at = now(), updated_by = nexus.current_member_id()
  where id = p_item_id;
  perform nexus._ib_item_log(p_item_id, null, 'edited', null, null, null, nexus._ib_text(p_note, 500, 'note'), null, v_changes);
  return true;
end
$$;

-- Lock + load a quantity or tracked item for a stock change; archived items take no stock changes.
create or replace function nexus._ib_item_for_change(p_item_id uuid, p_mode text)
returns nexus.inventory_items
language plpgsql volatile set search_path = ''
as $$
declare
  v_item nexus.inventory_items;
begin
  perform nexus._ib_lock_items(array[p_item_id]);
  select * into v_item from nexus.inventory_items i where i.id = p_item_id;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002', hint = 'item_not_found';
  end if;
  if v_item.mode <> p_mode then
    raise exception 'This action needs a % item', p_mode using errcode = '22023',
      hint = case when p_mode = 'tracked' then 'item_not_tracked' else 'item_not_quantity' end;
  end if;
  if not v_item.is_active then
    raise exception 'The item is archived; reactivate it first' using errcode = 'P0001', hint = 'item_archived';
  end if;
  return v_item;
end
$$;

-- 8.4 Add units to a tracked item ("+ Tambah unit").
create or replace function nexus.inventory_unit_add(p_item_id uuid, p_units jsonb, p_note text default null)
returns text[]
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  perform nexus._ib_item_for_change(p_item_id, 'tracked');
  return nexus._ib_insert_units(p_item_id, p_units, nexus._ib_text(p_note, 500, 'note'));
end
$$;

-- Lock + load a unit (through its item lock).
create or replace function nexus._ib_unit_for_change(p_unit_id uuid)
returns nexus.inventory_units
language plpgsql volatile set search_path = ''
as $$
declare
  v_unit nexus.inventory_units;
begin
  select * into v_unit from nexus.inventory_units u where u.id = p_unit_id;
  if not found then
    raise exception 'Unit not found' using errcode = 'P0002', hint = 'unit_not_found';
  end if;
  perform nexus._ib_lock_items(array[v_unit.item_id]);
  select * into v_unit from nexus.inventory_units u where u.id = p_unit_id for update;
  return v_unit;
end
$$;

-- 8.5 Move a unit to another location (the only unit field besides condition and status).
create or replace function nexus.inventory_unit_update(p_unit_id uuid, p_location_id uuid, p_note text default null)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_unit nexus.inventory_units;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  v_unit := nexus._ib_unit_for_change(p_unit_id);
  perform nexus._ib_check_list_pick('inventory_locations', p_location_id, v_unit.location_id);
  if p_location_id is not distinct from v_unit.location_id then
    return false;
  end if;
  update nexus.inventory_units set location_id = p_location_id, updated_at = now(), updated_by = nexus.current_member_id()
  where id = p_unit_id;
  perform nexus._ib_item_log(v_unit.item_id, p_unit_id, 'edited', null, null, null, nexus._ib_text(p_note, 500, 'note'), null,
    jsonb_build_object('location_id', jsonb_build_array(v_unit.location_id, p_location_id)));
  return true;
end
$$;

-- 8.6 "Tambah jumlah" (design 7.6a, G2): new stock arrived. Reason required (P6).
create or replace function nexus.inventory_stock_add(p_item_id uuid, p_condition text, p_quantity integer, p_note text)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_note text;
  v_new  integer;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  perform nexus._ib_condition(p_condition);
  if p_quantity is null or p_quantity not between 1 and 9999 then
    raise exception 'Quantity must be a whole number from 1' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_quantity';
  end if;
  v_note := nexus._ib_required_text(p_note, 500, 'note', 'reason_required');
  perform nexus._ib_item_for_change(p_item_id, 'quantity');
  update nexus.inventory_stock set quantity = quantity + p_quantity, updated_at = now(), updated_by = nexus.current_member_id()
  where item_id = p_item_id and condition = p_condition and quantity + p_quantity <= 9999
  returning quantity into v_new;
  if v_new is null then
    raise exception 'Stock would exceed 9999' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_quantity';
  end if;
  perform nexus._ib_item_log(p_item_id, null, 'stock_added', null, p_condition, p_quantity, v_note, null, null);
  return v_new;
end
$$;

-- 8.7 "Ubah kondisi" for a quantity item (design 7.6b): move n from one condition to another. Moving
-- out of good may not cut into reserved stock (R3, R18). Reason required (P6).
create or replace function nexus.inventory_stock_move(p_item_id uuid, p_from text, p_to text, p_quantity integer, p_note text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_note text;
  v_left integer;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  perform nexus._ib_condition(p_from);
  perform nexus._ib_condition(p_to);
  if p_from = p_to then
    raise exception 'Choose two different conditions' using errcode = '22023', hint = 'invalid_condition';
  end if;
  if p_quantity is null or p_quantity not between 1 and 9999 then
    raise exception 'Quantity must be a whole number from 1' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_quantity';
  end if;
  v_note := nexus._ib_required_text(p_note, 500, 'note', 'reason_required');
  perform nexus._ib_item_for_change(p_item_id, 'quantity');
  if p_from = 'good' then
    perform nexus._ib_check_reduction(p_item_id, p_quantity);
  end if;
  update nexus.inventory_stock set quantity = quantity - p_quantity, updated_at = now(), updated_by = nexus.current_member_id()
  where item_id = p_item_id and condition = p_from and quantity >= p_quantity
  returning quantity into v_left;
  if v_left is null then
    raise exception 'Not enough stock in that condition' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_quantity';
  end if;
  update nexus.inventory_stock set quantity = quantity + p_quantity, updated_at = now(), updated_by = nexus.current_member_id()
  where item_id = p_item_id and condition = p_to and quantity + p_quantity <= 9999
  returning quantity into v_left;
  if v_left is null then
    raise exception 'Stock would exceed 9999' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_quantity';
  end if;
  perform nexus._ib_item_log(p_item_id, null, 'condition_changed', p_from, p_to, p_quantity, v_note, null, null);
end
$$;

-- 8.8 "Keluarkan dari stok" for a quantity item (F2.6, design 7.6c): lost or thrown away. The total
-- drops; history keeps it. Never a delete (L5).
create or replace function nexus.inventory_stock_write_off(p_item_id uuid, p_condition text, p_quantity integer, p_note text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_note text;
  v_left integer;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  perform nexus._ib_condition(p_condition);
  if p_quantity is null or p_quantity not between 1 and 9999 then
    raise exception 'Quantity must be a whole number from 1' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_quantity';
  end if;
  v_note := nexus._ib_required_text(p_note, 500, 'note', 'reason_required');
  perform nexus._ib_item_for_change(p_item_id, 'quantity');
  if p_condition = 'good' then
    perform nexus._ib_check_reduction(p_item_id, p_quantity);
  end if;
  update nexus.inventory_stock set quantity = quantity - p_quantity, updated_at = now(), updated_by = nexus.current_member_id()
  where item_id = p_item_id and condition = p_condition and quantity >= p_quantity
  returning quantity into v_left;
  if v_left is null then
    raise exception 'Not enough stock in that condition' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_quantity';
  end if;
  perform nexus._ib_item_log(p_item_id, null, 'written_off', p_condition, null, p_quantity, v_note, null, null);
end
$$;

-- 8.9 "Ubah kondisi" for a unit. Not while the unit is out on a loan (the return records its condition).
create or replace function nexus.inventory_unit_set_condition(p_unit_id uuid, p_condition text, p_note text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_unit nexus.inventory_units;
  v_note text;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  perform nexus._ib_condition(p_condition);
  v_note := nexus._ib_required_text(p_note, 500, 'note', 'reason_required');
  v_unit := nexus._ib_unit_for_change(p_unit_id);
  if v_unit.status <> 'active' then
    raise exception 'Only an active unit changes condition' using errcode = 'P0001', hint = 'unit_not_available', detail = v_unit.status;
  end if;
  if p_condition = v_unit.condition then
    raise exception 'The unit already has this condition' using errcode = '22023', hint = 'invalid_condition';
  end if;
  if nexus._ib_unit_on_loan(p_unit_id) then
    raise exception 'The unit is out on a loan' using errcode = 'P0001', hint = 'unit_on_loan';
  end if;
  if v_unit.condition = 'good' and exists (select 1 from nexus.inventory_items i where i.id = v_unit.item_id and i.is_active) then
    perform nexus._ib_check_reduction(v_unit.item_id, 1);
  end if;
  update nexus.inventory_units set condition = p_condition, updated_at = now(), updated_by = nexus.current_member_id()
  where id = p_unit_id;
  perform nexus._ib_item_log(v_unit.item_id, p_unit_id, 'condition_changed', v_unit.condition, p_condition, 1, v_note, null, null);
end
$$;

-- 8.10 Write a unit off (status lost, code kept, F2.6). Not while out on loan.
create or replace function nexus.inventory_unit_write_off(p_unit_id uuid, p_note text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_unit nexus.inventory_units;
  v_note text;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  v_note := nexus._ib_required_text(p_note, 500, 'note', 'reason_required');
  v_unit := nexus._ib_unit_for_change(p_unit_id);
  if v_unit.status = 'lost' then
    raise exception 'The unit is already written off' using errcode = 'P0001', hint = 'unit_not_available', detail = 'lost';
  end if;
  if nexus._ib_unit_on_loan(p_unit_id) then
    raise exception 'The unit is out on a loan' using errcode = 'P0001', hint = 'unit_on_loan';
  end if;
  if v_unit.status = 'active' and v_unit.condition = 'good' then
    perform nexus._ib_check_reduction(v_unit.item_id, 1);
  end if;
  update nexus.inventory_units set status = 'lost', updated_at = now(), updated_by = nexus.current_member_id()
  where id = p_unit_id;
  perform nexus._ib_item_log(v_unit.item_id, p_unit_id, 'written_off', v_unit.condition, null, 1, v_note, null,
                             jsonb_build_object('status_from', v_unit.status));
end
$$;

-- 8.11 Archive / reactivate an item (F2.7). Blocked while any request line is open; the message gives
-- the count only (IB-13).
create or replace function nexus.inventory_item_set_active(p_item_id uuid, p_is_active boolean, p_note text default null)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_item nexus.inventory_items;
  v_open integer;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  if p_is_active is null then
    raise exception 'State is required' using errcode = '22023', hint = 'invalid_input', detail = 'p_is_active';
  end if;
  perform nexus._ib_lock_items(array[p_item_id]);
  select * into v_item from nexus.inventory_items i where i.id = p_item_id;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002', hint = 'item_not_found';
  end if;
  if v_item.is_active = p_is_active then
    return false;
  end if;
  if not p_is_active then
    v_open := nexus._ib_open_line_count(p_item_id);
    if v_open > 0 then
      raise exception 'The item still has % open borrowing request line(s)', v_open
        using errcode = 'P0001', hint = 'open_requests_exist', detail = v_open::text;
    end if;
  end if;
  update nexus.inventory_items set is_active = p_is_active, updated_at = now(), updated_by = nexus.current_member_id()
  where id = p_item_id;
  perform nexus._ib_item_log(p_item_id, null, case when p_is_active then 'reactivated' else 'archived' end,
                             null, null, null, nexus._ib_text(p_note, 500, 'note'), null, null);
  return true;
end
$$;

-- 8.12 Archive / reactivate a unit. Archiving: not while on loan, and not under reserved stock.
create or replace function nexus.inventory_unit_set_active(p_unit_id uuid, p_is_active boolean, p_note text default null)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_unit nexus.inventory_units;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  if p_is_active is null then
    raise exception 'State is required' using errcode = '22023', hint = 'invalid_input', detail = 'p_is_active';
  end if;
  v_unit := nexus._ib_unit_for_change(p_unit_id);
  if v_unit.status = 'lost' then
    raise exception 'A written-off unit is restored with "Ditemukan kembali"' using errcode = 'P0001', hint = 'unit_not_available', detail = 'lost';
  end if;
  if (v_unit.status = 'active') = p_is_active then
    return false;
  end if;
  if not p_is_active then
    if nexus._ib_unit_on_loan(p_unit_id) then
      raise exception 'The unit is out on a loan' using errcode = 'P0001', hint = 'unit_on_loan';
    end if;
    if v_unit.condition = 'good' then
      perform nexus._ib_check_reduction(v_unit.item_id, 1);
    end if;
  end if;
  update nexus.inventory_units set status = case when p_is_active then 'active' else 'archived' end,
         updated_at = now(), updated_by = nexus.current_member_id()
  where id = p_unit_id;
  perform nexus._ib_item_log(v_unit.item_id, p_unit_id, case when p_is_active then 'reactivated' else 'archived' end,
                             null, null, null, nexus._ib_text(p_note, 500, 'note'), null, null);
  return true;
end
$$;

-- 8.13 "Ditemukan kembali" (A-IB45, design G7): a written-off unit comes back, with a reason and its
-- condition now. Tech lead 2026-11-07 (review L3): an inventory.manage holder (it is a stock change), and
-- only for an active item.
create or replace function nexus.inventory_unit_restore_lost(p_unit_id uuid, p_condition text, p_note text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_unit nexus.inventory_units;
  v_note text;
begin
  perform nexus._require_permission('inventory.manage');
  perform nexus._ib_require_active_period();
  perform nexus._ib_condition(p_condition);
  v_note := nexus._ib_required_text(p_note, 500, 'note', 'reason_required');
  v_unit := nexus._ib_unit_for_change(p_unit_id);
  if not exists (select 1 from nexus.inventory_items i where i.id = v_unit.item_id and i.is_active) then
    raise exception 'The item is archived; reactivate it first' using errcode = 'P0001', hint = 'item_archived';
  end if;
  if v_unit.status <> 'lost' then
    raise exception 'Only a written-off unit can be restored' using errcode = 'P0001', hint = 'unit_not_available', detail = v_unit.status;
  end if;
  update nexus.inventory_units set status = 'active', condition = p_condition, updated_at = now(), updated_by = nexus.current_member_id()
  where id = p_unit_id;
  perform nexus._ib_item_log(v_unit.item_id, p_unit_id, 'restored', v_unit.condition, p_condition, 1, v_note, null, null);
end
$$;

-- =============================================================================================
-- 9. Borrowing read functions
-- =============================================================================================

-- 9.1 "Peminjaman Saya" (F7 list, L9, design screen 7). Every active member, OWN requests only (also
-- outside-party requests they recorded). open = Diajukan/Disetujui/Dipinjam by start date (soonest
-- first); closed = newest first; all = open first, then closed.
create or replace function nexus.borrowing_my_requests(
  p_filter    text    default 'open',
  p_page      integer default 1,
  p_page_size integer default 20
)
returns table (
  row_no bigint, request_id uuid, reference text, status text, version integer, period_label text,
  is_outside_party boolean, outside_org_name text, outside_contact_name text, purpose text,
  start_date date, end_date date, items jsonb, qty_outstanding integer, is_overdue boolean, overdue_days integer,
  is_not_picked_up boolean, is_partially_returned boolean, has_issue boolean, extension_count integer,
  decided_by_name text, decision_note text, created_at timestamptz, total_count bigint, page integer, page_size integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid := nexus._ib_require_member();
  v_filter text := coalesce(nullif(lower(btrim(p_filter)), ''), 'open');
begin
  if v_filter not in ('open', 'closed', 'all') then
    raise exception 'Filter must be open, closed or all' using errcode = '22023', hint = 'invalid_view';
  end if;
  perform nexus._ib_check_page(p_page, p_page_size);
  return query
  with
  r as (
    select x.*, x.status in ('submitted', 'approved', 'borrowed') as is_open
    from nexus._ib_request_rows(v_me,
           case v_filter when 'open' then array['submitted', 'approved', 'borrowed']
                         when 'closed' then array['returned', 'rejected', 'cancelled'] end,
           null, null) x
  ),
  o as (
    select r.*, row_number() over (order by (not r.is_open)::int,
                                            case when r.is_open then r.start_date end asc,
                                            case when not r.is_open then r.updated_at end desc,
                                            r.created_at, r.request_id) as rn
    from r
  ),
  t as (select count(*) as n from o),
  pg as (select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::integer)) as pno from t)
  select o.rn, o.request_id, o.reference, o.status, o.version, o.period_label, o.is_outside_party, o.outside_org_name,
         o.outside_contact_name, o.purpose, o.start_date, o.end_date, o.items, o.qty_outstanding, o.is_overdue,
         o.overdue_days, o.is_not_picked_up, o.is_partially_returned, o.has_issue, o.extension_count,
         o.decided_by_name, o.decision_note, o.created_at, t.n, pg.pno, p_page_size
  from o cross join t cross join pg
  where o.rn > (pg.pno - 1)::bigint * p_page_size and o.rn <= pg.pno::bigint * p_page_size
  order by o.rn;
end
$$;

-- 9.2 Queue / work list (F4, F5, F9, F11, design screens 8 and 11). borrowing.view_all (BPH D10, and
-- included in approve and handle). Views: see _ib_queue_rows. is_own marks the caller's own requests
-- ("Pengajuanmu"); the buttons for them are absent (L6).
create or replace function nexus.borrowing_queue(
  p_view      text    default 'pending',
  p_search    text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_item_id   uuid    default null,
  p_page      integer default 1,
  p_page_size integer default 20
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
  q as (select * from nexus._ib_queue_rows(p_view, p_search, p_from, p_to, p_item_id)),
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

-- 9.3 Counts for the "Tampilkan" options and "Antrean (n)" (design 4.4, P12). action_needed = what
-- waits for THIS caller: a head counts Diajukan requests that are not their own; a handle holder
-- counts Disetujui (waiting for pick-up) plus Terlambat loans; view_all alone (BPH) counts 0.
create or replace function nexus.borrowing_queue_counts()
returns table (pending integer, ready integer, borrowed integer, overdue integer, open_all_periods integer, action_needed integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me      uuid;
  v_approve boolean;
  v_handle  boolean;
begin
  perform nexus._require_permission('borrowing.view_all');
  v_me := nexus.current_member_id();
  v_approve := nexus.has_permission('borrowing.approve');
  v_handle := nexus.has_permission('borrowing.handle');
  return query
  with x as (select * from nexus._ib_request_rows(null, array['submitted', 'approved', 'borrowed'], null, null))
  select (count(*) filter (where x.status = 'submitted'))::int,
         (count(*) filter (where x.status = 'approved'))::int,
         (count(*) filter (where x.status = 'borrowed'))::int,
         (count(*) filter (where x.is_overdue))::int,
         (count(*) filter (where x.status in ('submitted', 'approved', 'borrowed')))::int,
         (count(*) filter (where (v_approve and x.status = 'submitted' and x.requester_member_id <> v_me)
                              or (v_handle and (x.status = 'approved' or x.is_overdue))))::int
  from x;
end
$$;

-- 9.4 Open loans for the period handover (F11.5, A-IB11, design screen 11): every unfinished request
-- of every period, oldest period first, Terlambat first. No paging (open requests are few).
create or replace function nexus.borrowing_open_loans()
returns table (
  row_no bigint, request_id uuid, reference text, status text, period_id uuid, period_label text,
  requester_name text, is_own boolean, is_outside_party boolean, outside_org_name text, outside_contact_name text,
  start_date date, end_date date, items jsonb, qty_outstanding integer, is_overdue boolean, overdue_days integer,
  is_not_picked_up boolean, is_partially_returned boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid;
begin
  perform nexus._require_permission('borrowing.view_all');
  v_me := nexus.current_member_id();
  return query
  select q.ordinal, q.request_id, q.reference, q.status, q.period_id, q.period_label, q.requester_name,
         q.requester_member_id = v_me, q.is_outside_party, q.outside_org_name, q.outside_contact_name,
         q.start_date, q.end_date, q.items, q.qty_outstanding, q.is_overdue, q.overdue_days,
         q.is_not_picked_up, q.is_partially_returned
  from nexus._ib_queue_rows('open_all_periods', null, null, null, null) q
  order by q.ordinal;
end
$$;

-- 9.5 Request detail ("Detail Pengajuan", design 10.2 and 11.2) as one JSON object. Visible to the
-- requester of record (L9) and to borrowing.view_all holders; anybody else gets "not found" (same as a
-- missing id). The timeline shows the names of the approver and of the Operations members who recorded
-- handover and return (A-IB46): PI-CORE full_name only. `actions` tells the UI which buttons exist for
-- this caller right now (the write functions re-check everything anyway).
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
                            and v_req.period_id = v_period));
end
$$;

-- 9.6 Units that may be handed over for an approved request (F5.2, R10, A-IB29): units of the line's
-- item that are active, in good condition and on no open loan. borrowing.handle only.
create or replace function nexus.borrowing_handover_units(p_request_id uuid)
returns table (line_id uuid, item_id uuid, unit_id uuid, code text, location_id uuid, location_name text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform nexus._require_permission('borrowing.handle');
  if not exists (select 1 from nexus.borrowing_requests r where r.id = p_request_id) then
    raise exception 'Request not found' using errcode = 'P0002', hint = 'request_not_found';
  end if;
  return query
  select l.id, l.item_id, u.id, u.code, u.location_id, loc.name
  from nexus.borrowing_request_lines l
  join nexus.inventory_items i on i.id = l.item_id and i.mode = 'tracked'
  join nexus.inventory_units u on u.item_id = i.id
  left join nexus.inventory_locations loc on loc.id = u.location_id
  where l.request_id = p_request_id
    and u.status = 'active' and u.condition = 'good'
    and not nexus._ib_unit_on_loan(u.id)
  order by l.id, u.code;
end
$$;

-- =============================================================================================
-- 10. Borrowing state machine (spec section 4). Every function: L1, key (or L9 fixed right), active
--     period (R11), row lock + version on the request, allowed starting status, L6 where it applies.
--     Each returns the new status and version so the screen can continue without a reload.
-- =============================================================================================

-- 10.1 New request -> submitted (F3, F10). Any active member for themselves (L9); a borrowing.handle
-- holder may record one for an outside party (organisation + contact person name only, A-IB28) and is
-- then its requester of record. p_lines = [{"item_id": "<uuid>", "quantity": n}, ...], 1..50 lines.
-- Pending requests hold nothing (IB6), so availability is checked without a lock; approval re-checks.
create or replace function nexus.borrowing_request_create(
  p_start_date           date,
  p_end_date             date,
  p_purpose              text,
  p_lines                jsonb,
  p_note                 text default null,
  p_outside_org_name     text default null,
  p_outside_contact_name text default null
)
returns table (request_id uuid, reference text, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me      uuid := nexus._ib_require_member();
  v_period  uuid;
  v_purpose text;
  v_note    text;
  v_org     text := nexus._ib_text(p_outside_org_name, 120, 'outside_org_name');
  v_contact text := nexus._ib_text(p_outside_contact_name, 120, 'outside_contact_name');
  v_line    jsonb;
  v_item    uuid;
  v_qty     integer;
  v_items   uuid[] := '{}';
  v_qtys    integer[] := '{}';
  v_free    record;
  v_id      uuid;
  v_ref     text;
  i         integer;
begin
  v_period := nexus._ib_require_active_period();
  if v_org is not null or v_contact is not null then
    perform nexus._require_permission('borrowing.handle');
    if v_org is null or v_contact is null then
      raise exception 'An outside-party request needs the organisation and the contact person name'
        using errcode = '22023', hint = 'outside_party_incomplete';
    end if;
  end if;
  perform nexus._ib_check_range(p_start_date, p_end_date);
  if p_end_date > p_start_date + 365 then
    raise exception 'A loan can span at most 366 days (end at most start + 365)' using errcode = '22023',
      hint = 'date_range_too_long', detail = '365';
  end if;
  v_purpose := nexus._ib_required_text(p_purpose, 500, 'purpose', 'text_required');
  v_note := nexus._ib_text(p_note, 500, 'note');

  -- Owner caps 2026-11-07 (anti-flooding): at most 5 requests waiting (submitted) and at most 20 new
  -- requests per Jakarta day, per requester of record (outside-party requests count for the recorder).
  -- The advisory lock serialises one member's own concurrent submits, so two parallel clicks cannot
  -- both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('nexus.borrowing_request_create:' || v_me::text, 0));
  if (select count(*) from nexus.borrowing_requests r
      where r.requester_member_id = v_me and r.status = 'submitted') >= 5 then
    raise exception 'You already have 5 requests waiting for a decision' using errcode = 'P0001',
      hint = 'too_many_open_requests', detail = '5';
  end if;
  if (select count(*) from nexus.borrowing_requests r
      where r.requester_member_id = v_me and nexus._jakarta_date(r.created_at) = nexus._ib_today()) >= 20 then
    raise exception 'At most 20 requests per day' using errcode = 'P0001', hint = 'daily_request_limit', detail = '20';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_lines';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'At most 50 items per request' using errcode = '22023', hint = 'too_many_lines';
  end if;
  for v_line in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Each line must be an object' using errcode = '22023', hint = 'invalid_input', detail = 'p_lines';
    end if;
    v_item := nexus._ib_json_uuid(v_line, 'item_id', true);
    v_qty := nexus._ib_json_int(v_line, 'quantity', 1, 9999);
    if v_item = any (v_items) then
      raise exception 'The same item is in the request twice' using errcode = '22023', hint = 'duplicate_item', detail = v_item::text;
    end if;
    v_items := v_items || v_item;
    v_qtys := v_qtys || v_qty;
  end loop;

  for i in 1 .. cardinality(v_items) loop
    select * into v_free from nexus._ib_items_free(array[v_items[i]], p_start_date, p_end_date, null);
    if not found then
      raise exception 'Item not found' using errcode = 'P0002', hint = 'item_not_found', detail = v_items[i]::text;
    end if;
    -- Archived items and items with nothing in good condition are not lendable (IB10, A-IB5).
    if v_free.lendable < 1 then
      raise exception 'This item cannot be borrowed now' using errcode = 'P0001', hint = 'item_not_lendable', detail = v_items[i]::text;
    end if;
    if v_free.free < v_qtys[i] then
      raise exception 'Only % available on those dates', greatest(v_free.free, 0)
        using errcode = 'P0001', hint = 'insufficient_stock', detail = v_items[i]::text;
    end if;
  end loop;

  v_ref := nexus._ib_code('PJM', nextval('nexus.borrowing_reference_seq'));
  insert into nexus.borrowing_requests
    (reference, requester_member_id, is_outside_party, outside_org_name, outside_contact_name, period_id,
     purpose, note, start_date, end_date)
  values
    (v_ref, v_me, v_org is not null, v_org, v_contact, v_period, v_purpose, v_note, p_start_date, p_end_date)
  returning id into v_id;
  insert into nexus.borrowing_request_lines (request_id, item_id, quantity_requested)
  select v_id, u.item, u.qty from unnest(v_items, v_qtys) as u(item, qty);
  perform nexus._ib_status_log(v_id, 'submitted', null, 'submitted', null);
  return query select v_id, v_ref, 'submitted'::text, 1;
end
$$;

-- 10.2 submitted -> approved (F4). Heads only (borrowing.approve, D34/D35), never own (L6). Optional
-- lower quantity per line with a note (A-IB14): p_lines = [{"line_id": "<uuid>", "quantity": n}];
-- lines not listed are approved in full. Availability is re-checked under the item locks (R5, IB-24).
create or replace function nexus.borrowing_request_approve(
  p_request_id uuid,
  p_version    integer,
  p_note       text  default null,
  p_lines      jsonb default null
)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req     nexus.borrowing_requests;
  v_note    text;
  v_line    jsonb;
  v_line_id uuid;
  v_map     jsonb := '{}'::jsonb;
  v_lower   boolean := false;
  v_total   integer := 0;
  v_l       record;
  v_qty     integer;
  v_free    record;
begin
  perform nexus._require_permission('borrowing.approve');
  perform nexus._ib_require_active_period();
  v_note := nexus._ib_text(p_note, 500, 'note');
  v_req := nexus._ib_lock_request(p_request_id, p_version);
  perform nexus._ib_require_status(v_req.status, array['submitted']);
  perform nexus._ib_require_not_own(v_req.requester_member_id);

  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then
      raise exception 'Lines must be a list' using errcode = '22023', hint = 'invalid_input', detail = 'p_lines';
    end if;
    if jsonb_array_length(p_lines) > 50 then
      raise exception 'At most 50 lines' using errcode = '22023', hint = 'too_many_lines';
    end if;
    for v_line in select e from jsonb_array_elements(p_lines) e loop
      v_line_id := nexus._ib_json_uuid(v_line, 'line_id', true);
      if not exists (select 1 from nexus.borrowing_request_lines l where l.id = v_line_id and l.request_id = p_request_id) then
        raise exception 'Line not found' using errcode = 'P0002', hint = 'line_not_found', detail = v_line_id::text;
      end if;
      v_map := v_map || jsonb_build_object(v_line_id::text, nexus._ib_json_int(v_line, 'quantity', 0, 9999));
    end loop;
  end if;

  perform nexus._ib_lock_items(array(select l.item_id from nexus.borrowing_request_lines l where l.request_id = p_request_id));
  for v_l in select l.* from nexus.borrowing_request_lines l where l.request_id = p_request_id order by l.item_id loop
    v_qty := coalesce((v_map ->> v_l.id::text)::int, v_l.quantity_requested);
    if v_qty > v_l.quantity_requested then
      raise exception 'Approved quantity cannot exceed the requested quantity'
        using errcode = '22023', hint = 'quantity_invalid', detail = v_l.id::text;
    end if;
    v_lower := v_lower or v_qty < v_l.quantity_requested;
    v_total := v_total + v_qty;
    if v_qty > 0 then
      select * into v_free from nexus._ib_items_free(array[v_l.item_id], v_req.start_date, v_req.end_date, p_request_id);
      if v_free.free < v_qty then
        raise exception 'Not enough stock on those dates (% free)', greatest(v_free.free, 0)
          using errcode = 'P0001', hint = 'insufficient_stock', detail = v_l.item_id::text;
      end if;
    end if;
    update nexus.borrowing_request_lines set quantity_approved = v_qty where id = v_l.id;
  end loop;
  if v_total = 0 then
    raise exception 'Approve at least one item, or reject the request' using errcode = '22023', hint = 'quantity_invalid', detail = 'p_lines';
  end if;
  if v_lower and v_note is null then
    raise exception 'Write why the quantity is lower' using errcode = '22023', hint = 'note_required', detail = 'p_note';
  end if;

  update nexus.borrowing_requests
  set status = 'approved', decided_by = nexus.current_member_id(), decided_at = now(), decision_note = v_note
  where id = p_request_id;
  perform nexus._ib_status_log(p_request_id, 'approved', 'submitted', 'approved', v_note);
  return query select r.id, r.status, r.version from nexus.borrowing_requests r where r.id = p_request_id;
end
$$;

-- 10.3 submitted -> rejected (F4.3). Heads only, never own (L6), note required (IB-21).
create or replace function nexus.borrowing_request_reject(p_request_id uuid, p_version integer, p_note text)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req  nexus.borrowing_requests;
  v_note text;
begin
  perform nexus._require_permission('borrowing.approve');
  perform nexus._ib_require_active_period();
  v_req := nexus._ib_lock_request(p_request_id, p_version);
  perform nexus._ib_require_status(v_req.status, array['submitted']);
  perform nexus._ib_require_not_own(v_req.requester_member_id);
  v_note := nexus._ib_required_text(p_note, 500, 'note', 'note_required');
  update nexus.borrowing_requests
  set status = 'rejected', decided_by = nexus.current_member_id(), decided_at = now(), decision_note = v_note
  where id = p_request_id;
  perform nexus._ib_status_log(p_request_id, 'rejected', 'submitted', 'rejected', v_note);
  return query select r.id, r.status, r.version from nexus.borrowing_requests r where r.id = p_request_id;
end
$$;

-- 10.4 -> cancelled (F7). The requester of record: while submitted (reason optional) or approved and
-- not picked up (reason required, IB7, L9 widened). A borrowing.handle holder: approved only, reason
-- required (A-IB34). After pick-up nobody cancels.
create or replace function nexus.borrowing_request_cancel(p_request_id uuid, p_version integer, p_reason text default null)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid := nexus._ib_require_member();
  v_req    nexus.borrowing_requests;
  v_reason text := nexus._ib_text(p_reason, 500, 'reason');
begin
  perform nexus._ib_require_active_period();
  v_req := nexus._ib_lock_request(p_request_id, p_version);
  if v_req.requester_member_id = v_me then
    perform nexus._ib_require_status(v_req.status, array['submitted', 'approved']);
  else
    perform nexus._require_permission('borrowing.handle');
    perform nexus._ib_require_status(v_req.status, array['approved']);
  end if;
  if v_reason is null and (v_req.status = 'approved' or v_req.requester_member_id <> v_me) then
    raise exception 'Write the reason for cancelling' using errcode = '22023', hint = 'reason_required', detail = 'p_reason';
  end if;
  update nexus.borrowing_requests set status = 'cancelled' where id = p_request_id;
  perform nexus._ib_status_log(p_request_id, 'cancelled', v_req.status, 'cancelled', v_reason);
  return query select r.id, r.status, r.version from nexus.borrowing_requests r where r.id = p_request_id;
end
$$;

-- 10.5 Extend the end date (F8, IB5, A-IB26): approved or borrowed, heads only, never own (L6), note
-- required, later date only. The ADDED days are checked like a new approval, under the item locks.
-- The status does not change; one extension history row.
create or replace function nexus.borrowing_request_extend(p_request_id uuid, p_version integer, p_new_end_date date, p_note text)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req  nexus.borrowing_requests;
  v_note text;
  v_from date;
  v_l    record;
  v_free record;
begin
  perform nexus._require_permission('borrowing.approve');
  perform nexus._ib_require_active_period();
  v_req := nexus._ib_lock_request(p_request_id, p_version);
  perform nexus._ib_require_status(v_req.status, array['approved', 'borrowed']);
  perform nexus._ib_require_not_own(v_req.requester_member_id);
  v_note := nexus._ib_required_text(p_note, 500, 'note', 'note_required');
  if p_new_end_date is null or not isfinite(p_new_end_date) or p_new_end_date <= v_req.end_date then
    raise exception 'Choose a date after the current end date' using errcode = '22023', hint = 'invalid_dates', detail = v_req.end_date::text;
  end if;
  -- L4: the cap counts from the ORIGINAL start date, so extensions cannot stretch a loan past it.
  if p_new_end_date > v_req.start_date + 365 then
    raise exception 'A loan can span at most 366 days (end at most start + 365)' using errcode = '22023',
      hint = 'date_range_too_long', detail = (v_req.start_date + 365)::text;
  end if;

  perform nexus._ib_lock_items(array(select l.item_id from nexus.borrowing_request_lines l where l.request_id = p_request_id));
  -- Days already in the past cannot be booked by anyone any more, so they are not checked.
  v_from := greatest(v_req.end_date + 1, nexus._ib_today());
  if v_from <= p_new_end_date then
    for v_l in select ls.* from nexus._ib_line_state(null, array[p_request_id]) ls where ls.held_qty > 0 order by ls.item_id loop
      select * into v_free from nexus._ib_items_free(array[v_l.item_id], v_from, p_new_end_date, p_request_id);
      if v_free.free < v_l.held_qty then
        raise exception 'Conflicts with another request on those dates' using errcode = 'P0001', hint = 'insufficient_stock',
          detail = v_l.item_id::text;
      end if;
    end loop;
  end if;

  insert into nexus.borrowing_extensions (request_id, old_end_date, new_end_date, actor_member_id, note, period_id)
  values (p_request_id, v_req.end_date, p_new_end_date, nexus.current_member_id(), v_note, nexus.active_period_id());
  update nexus.borrowing_requests set end_date = p_new_end_date where id = p_request_id;
  return query select r.id, r.status, r.version from nexus.borrowing_requests r where r.id = p_request_id;
end
$$;

-- 10.6 approved -> borrowed (F5). Any borrowing.handle holder, also for their own request (IB2, not L6).
-- Not before the start date (A-IB8). p_lines = [{"line_id": .., "quantity": n} for quantity items,
-- {"line_id": .., "unit_ids": [..]} for tracked items, optional "note"]; lines not listed hand over 0.
-- Less than approved needs a note (design 12.2). At least one item must be handed over (else cancel).
-- Units: active, good, of that item, on no other open loan (the partial unique index is the final guard).
create or replace function nexus.borrowing_request_hand_over(p_request_id uuid, p_version integer, p_lines jsonb, p_note text default null)
returns table (request_id uuid, status text, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req    nexus.borrowing_requests;
  v_note   text := nexus._ib_text(p_note, 500, 'note');
  v_input  jsonb := '{}'::jsonb;
  v_line   jsonb;
  v_lid    uuid;
  v_l      record;
  v_in     jsonb;
  v_qty    integer;
  v_units  uuid[];
  v_unit   uuid;
  v_lnote  text;
  v_total  integer := 0;
begin
  perform nexus._require_permission('borrowing.handle');
  perform nexus._ib_require_active_period();
  v_req := nexus._ib_lock_request(p_request_id, p_version);
  perform nexus._ib_require_status(v_req.status, array['approved']);
  if nexus._ib_today() < v_req.start_date then
    raise exception 'Not before the start date %', v_req.start_date using errcode = 'P0001', hint = 'too_early',
      detail = v_req.start_date::text;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Lines must be a list' using errcode = '22023', hint = 'invalid_input', detail = 'p_lines';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'At most 50 lines' using errcode = '22023', hint = 'too_many_lines';
  end if;
  for v_line in select e from jsonb_array_elements(p_lines) e loop
    v_lid := nexus._ib_json_uuid(v_line, 'line_id', true);
    if v_input ? v_lid::text then
      raise exception 'A line is listed twice' using errcode = '22023', hint = 'invalid_input', detail = v_lid::text;
    end if;
    v_input := v_input || jsonb_build_object(v_lid::text, v_line);
  end loop;
  if exists (select 1 from jsonb_object_keys(v_input) k
             where not exists (select 1 from nexus.borrowing_request_lines l
                               where l.id::text = k and l.request_id = p_request_id)) then
    raise exception 'Line not found' using errcode = 'P0002', hint = 'line_not_found';
  end if;
  -- All zero is a different situation from "less than approved": the screen offers cancel instead.
  if not exists (select 1 from jsonb_each(v_input) e
                 where (jsonb_typeof(e.value -> 'quantity') = 'number' and (e.value ->> 'quantity')::numeric > 0)
                    or (jsonb_typeof(e.value -> 'unit_ids') = 'array' and jsonb_array_length(e.value -> 'unit_ids') > 0)) then
    raise exception 'Hand over at least one item, or cancel the request' using errcode = 'P0001', hint = 'nothing_to_hand_over';
  end if;

  perform nexus._ib_lock_items(array(select l.item_id from nexus.borrowing_request_lines l where l.request_id = p_request_id));
  for v_l in select l.*, i.mode from nexus.borrowing_request_lines l
             join nexus.inventory_items i on i.id = l.item_id
             where l.request_id = p_request_id order by l.item_id loop
    v_in := coalesce(v_input -> (v_l.id::text), '{}'::jsonb);
    v_lnote := nexus._ib_text(v_in ->> 'note', 500, 'note');
    if v_l.mode = 'quantity' then
      if v_in ? 'unit_ids' then
        raise exception 'A quantity item has no units' using errcode = '22023', hint = 'invalid_input', detail = v_l.id::text;
      end if;
      v_qty := case when v_in ? 'quantity' then nexus._ib_json_int(v_in, 'quantity', 0, 9999) else 0 end;
      if v_qty > coalesce(v_l.quantity_approved, 0) then
        raise exception 'At most % can be handed over', v_l.quantity_approved
          using errcode = '22023', hint = 'quantity_invalid', detail = v_l.id::text;
      end if;
    else
      if v_in ? 'quantity' then
        raise exception 'Choose units for a tracked item' using errcode = '22023', hint = 'invalid_input', detail = v_l.id::text;
      end if;
      if v_in ? 'unit_ids' and jsonb_typeof(v_in -> 'unit_ids') <> 'array' then
        raise exception 'unit_ids must be a list' using errcode = '22023', hint = 'invalid_input', detail = v_l.id::text;
      end if;
      if jsonb_array_length(coalesce(v_in -> 'unit_ids', '[]'::jsonb)) > 200 then
        raise exception 'At most 200 units per line' using errcode = '22023', hint = 'too_many_units', detail = v_l.id::text;
      end if;
      v_units := '{}';
      for v_unit in select nexus._ib_json_uuid(jsonb_build_object('unit_id', e), 'unit_id', true)
                    from jsonb_array_elements_text(coalesce(v_in -> 'unit_ids', '[]'::jsonb)) e loop
        if v_unit = any (v_units) then
          raise exception 'A unit is listed twice' using errcode = '22023', hint = 'invalid_input', detail = v_unit::text;
        end if;
        if not exists (select 1 from nexus.inventory_units u
                       where u.id = v_unit and u.item_id = v_l.item_id and u.status = 'active' and u.condition = 'good')
           or nexus._ib_unit_on_loan(v_unit) then
          raise exception 'This unit cannot be handed over' using errcode = 'P0001', hint = 'unit_not_available', detail = v_unit::text;
        end if;
        v_units := v_units || v_unit;
      end loop;
      v_qty := cardinality(v_units);
      if v_qty > coalesce(v_l.quantity_approved, 0) then
        raise exception 'Choose at most % units', v_l.quantity_approved
          using errcode = '22023', hint = 'quantity_invalid', detail = v_l.id::text;
      end if;
      insert into nexus.borrowing_line_units (line_id, unit_id) select v_l.id, x from unnest(v_units) x;
    end if;
    if v_qty < coalesce(v_l.quantity_approved, 0) and v_lnote is null then
      raise exception 'Write why less than approved is handed over' using errcode = '22023', hint = 'note_required', detail = v_l.id::text;
    end if;
    update nexus.borrowing_request_lines set quantity_handed_over = v_qty, handover_note = v_lnote where id = v_l.id;
    v_total := v_total + v_qty;
  end loop;
  if v_total = 0 then
    raise exception 'Hand over at least one item, or cancel the request' using errcode = 'P0001', hint = 'nothing_to_hand_over';
  end if;

  update nexus.borrowing_requests
  set status = 'borrowed', handed_over_by = nexus.current_member_id(), handed_over_at = now()
  where id = p_request_id;
  perform nexus._ib_status_log(p_request_id, 'handed_over', 'approved', 'borrowed', v_note);
  return query select r.id, r.status, r.version from nexus.borrowing_requests r where r.id = p_request_id;
end
$$;

-- Evidence path rules (A-IB31, A-IB39): "<request id>/<uuid>.<jpg|jpeg|png|webp>" in the request's own
-- folder, not attached before, and (when Supabase Storage is installed) an uploaded object in the
-- private bucket. Without the storage schema (local dev stack with storage off) the object check is
-- skipped: there are no files there at all.
create or replace function nexus._ib_check_photo(p_request_id uuid, p_path text)
returns table (size_bytes integer, mime_type text)
language plpgsql stable set search_path = ''
as $$
#variable_conflict use_column
declare
  v_size integer;
  v_mime text;
  v_n    integer;
begin
  if p_path is null
     or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
     or split_part(p_path, '/', 1) <> p_request_id::text then
    raise exception 'Invalid photo path' using errcode = '22023', hint = 'invalid_photo', detail = coalesce(p_path, '');
  end if;
  if exists (select 1 from nexus.borrowing_evidence_photos e where e.storage_path = p_path) then
    raise exception 'This photo is already attached' using errcode = '22023', hint = 'invalid_photo', detail = p_path;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select (o.metadata ->> ''size'')::int, o.metadata ->> ''mimetype''
             from storage.objects o where o.bucket_id = $1 and o.name = $2'
      into v_size, v_mime using 'nexus-borrowing-evidence', p_path;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'The photo was not uploaded' using errcode = 'P0001', hint = 'photo_missing', detail = p_path;
    end if;
    if v_mime is not null and v_mime not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Unsupported photo type' using errcode = '22023', hint = 'invalid_photo', detail = p_path;
    end if;
  end if;
  return query select v_size, v_mime;
end
$$;

-- 10.7 Return (F6): borrowed -> borrowed (partial, "Sebagian kembali") or -> returned. Any
-- borrowing.handle holder, also for their own request (IB2). One call = one return batch.
-- p_outcomes = [{"line_id": .., "outcome": "good"|"damaged"|"lost",
--                "quantity": n (quantity items) | "unit_id": .. (tracked items),
--                "resulting_condition": "needs_service"|"damaged" (damaged only),
--                "note": "..." (required for damaged and lost),
--                "photos": ["<request id>/<uuid>.jpg", ...] (1..3, damaged and lost only)}]
-- Effects: good frees the stock; damaged moves the unit/quantity to the stated condition; lost writes
-- the unit off (status lost) or lowers the counted total. Each effect writes an item history row with
-- the request id (IB-30). Nothing is deleted.
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
        raise exception 'Stock does not match the loan; check the item history' using errcode = 'P0001', hint = 'correction_conflict';
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

-- 10.8 The ONE reasoned correction (A-IB15, at most once per request: review L1): returned -> borrowed, by a borrowing.handle holder, only for
-- a request of the ACTIVE period (L7: closed old-period records are read-only). It reverses the LAST
-- return batch: its outcomes stop counting, units go back out, damaged/lost stock effects are undone
-- with history rows. Refused when the stock has moved on since (the unit was serviced, lent again,
-- ...) or when reopening would over-book (R5). Evidence photos stay (L5).
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
  if exists (select 1 from nexus.borrowing_return_reversals rv
             join nexus.borrowing_return_batches b on b.id = rv.batch_id
             where b.request_id = p_request_id) then
    raise exception 'This request was already corrected once' using errcode = 'P0001', hint = 'correction_conflict';
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
-- 11. Exports (F12, IB13, IB-43, IB-44). Same rows and order as the screen, all pages, never more than
--     the caller may view (R15: the engine only grants *.export together with the view key). One log
--     row in the SAME transaction after the rows are built; if it fails, no rows are returned
--     (A-IB33). VOLATILE: call with .rpc() (POST); a read-only GET fails closed.
-- =============================================================================================

create or replace function nexus._ib_format(p_format text)
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

-- 11.1 Catalog export (inventory.export: BPH D09, Operations D29). One row per quantity item, one row
-- per unit of a tracked item (spec section 8). Archived entries only with the archived/all filter,
-- which needs inventory.manage (A-IB5).
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
  r as (select * from nexus._ib_item_rows(p_search, p_category_id, p_location_id, p_condition, v_status, v_status <> 'active')),
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

-- 11.2 Borrowing export (borrowing.export: BPH D11, Operations D31; needs view_all, R15). Same filter
-- and order as the queue (open_all_periods = the period handover list, A-IB11). A member never exports
-- their own list (A-IB22): there is no own-requests export.
create or replace function nexus.borrowing_export(
  p_format  text,
  p_view    text default 'all',
  p_search  text default null,
  p_from    date default null,
  p_to      date default null,
  p_item_id uuid default null
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
  v_member := nexus.current_member_id();
  v_period := nexus.active_period_id();
  if v_member is null or v_period is null then
    raise exception 'Missing NEXUS permission borrowing.export' using errcode = '42501', hint = 'permission_required', detail = 'borrowing.export';
  end if;

  return query
  with
  q as (select * from nexus._ib_queue_rows(p_view, p_search, p_from, p_to, p_item_id)),
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
                             'from', p_from, 'to', p_to, 'item_id', p_item_id),
          v_count, v_period);
  perform set_config('nexus.export_log_writer', '', true);
  return;
end
$$;

-- =============================================================================================
-- 12. Storage access checks for the private evidence bucket (used by the Storage RLS policies in
--     20261107100200; callable as the user). They never raise: a bad name is simply "no".
--     Upload: a borrowing.handle holder, into the folder of a request that is borrowed right now (a
--     return is being recorded). Read: whoever may see the request (L11: files follow the parent
--     record's view right): borrowing.view_all holders, and the requester for files attached to a
--     saved return (A-IB31). Nobody deletes or overwrites (no policy for that).
-- =============================================================================================

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
  if to_regclass('storage.objects') is not null then
    execute 'select count(*)::int from storage.objects o
             where o.bucket_id = $1 and o.name like $2
               and not exists (select 1 from nexus.borrowing_evidence_photos e where e.storage_path = o.name)'
      into v_unattached using 'nexus-borrowing-evidence', split_part(p_object_name, '/', 1) || '/%';
    if v_unattached >= 10 then
      return false;
    end if;
  end if;
  return true;
end
$$;

create or replace function nexus.borrowing_evidence_can_read(p_object_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_requester uuid;
begin
  if p_object_name is null
     or p_object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' then
    return false;
  end if;
  select r.requester_member_id into v_requester
  from nexus.borrowing_requests r where r.id = split_part(p_object_name, '/', 1)::uuid;
  if not found then
    return false;
  end if;
  return nexus.has_permission('borrowing.view_all')
      or (v_requester = nexus.current_member_id()
          and exists (select 1 from nexus.borrowing_evidence_photos e where e.storage_path = p_object_name));
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
    'inventory_item_list', 'inventory_item_detail', 'inventory_item_availability', 'inventory_availability_bulk',
    'inventory_category_list', 'inventory_location_list', 'inventory_item_history_list', 'inventory_status_counts',
    'inventory_category_add', 'inventory_category_rename', 'inventory_category_set_active',
    'inventory_location_add', 'inventory_location_rename', 'inventory_location_set_active',
    'inventory_item_create', 'inventory_item_update', 'inventory_unit_add', 'inventory_unit_update',
    'inventory_stock_add', 'inventory_stock_move', 'inventory_stock_write_off', 'inventory_unit_set_condition',
    'inventory_unit_write_off', 'inventory_item_set_active', 'inventory_unit_set_active', 'inventory_unit_restore_lost',
    'inventory_export',
    'borrowing_my_requests', 'borrowing_queue', 'borrowing_queue_counts', 'borrowing_open_loans',
    'borrowing_request_detail', 'borrowing_handover_units',
    'borrowing_request_create', 'borrowing_request_approve', 'borrowing_request_reject', 'borrowing_request_cancel',
    'borrowing_request_extend', 'borrowing_request_hand_over', 'borrowing_request_return',
    'borrowing_request_correct_return', 'borrowing_export',
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

-- Ask PostgREST to pick up the new objects.
notify pgrst, 'reload schema';
