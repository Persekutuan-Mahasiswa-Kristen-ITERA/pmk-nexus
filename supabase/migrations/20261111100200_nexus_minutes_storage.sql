-- PMK-NEXUS 0014: private Storage bucket for meeting-minute attachments (docs/modules/meeting-minutes.md
-- 4.4, N6 a and N7 a decided 2026-11-09, D-027; MN-17..MN-20).
--
-- Same pattern as 20261107100200 and 20261110100100 (approved review M2):
-- !! Besides those two, the only kind of NEXUS file that touches a schema other than `nexus`: it may add
--    one row to storage.buckets and two policies on storage.objects. Both are Supabase-managed Storage
--    objects, NOT PI-CORE objects (PI-CORE uses no Storage; docs/picore/schema-report.md). Every policy
--    is limited to bucket_id = 'nexus-minute-files'; the access logic lives in nexus functions
--    (20261111100100, section 8).
--
-- Shared project safety: this file NEVER changes an existing bucket. It creates the bucket only when it
-- is missing; if a bucket with this id already exists with other settings, or public, it STOPS (hint
-- bucket_conflict) and changes nothing. It also stops (hint storage_policy_unscoped) when any existing
-- policy on storage.objects lacks a bucket_id condition, because such a permissive policy would also
-- open these files.
--
-- Bucket: nexus-minute-files, public = false, 5 MiB per file (5242880 bytes),
--         application/pdf, image/jpeg, image/png (images are resized in the browser first, A-MN9).
-- Path:   "<uploader members.id>/<random uuid>.<pdf|jpg|jpeg|png>" (lowercase). Uploaded when picked,
--         before the minute exists; recorded in nexus.minute_files once a save attaches them.
-- Policies on storage.objects (authenticated only; anon gets nothing):
--   INSERT  nexus_minute_files_insert  -> nexus.minute_file_can_upload(name)  (minutes.manage holder,
--           own folder, active period, cap 10 unattached / 24 h)
--   SELECT  nexus_minute_files_select  -> nexus.minute_file_can_read(name)    (reader of the parent minute;
--           withdrawn files only managers of that unit)
--   No UPDATE and no DELETE policy: clients can neither overwrite nor delete (L5).
-- Signed links: the server creates them with the USER's session (createSignedUrl, 300 s); the SELECT
-- policy decides.
--
-- Where Storage is not installed (local dev stack with [storage] enabled = false; the bare postgres
-- image) the function is created but the bucket and policies are skipped, with a notice. Re-run:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261111100200_nexus_minutes_storage.sql
-- Re-runnable: an identical bucket and existing policies are left as they are. Requires 20261111100100.

-- Internal (owner only). Kept as a function so the conflict guards can be tested (pgTAP, Storage stub).
create or replace function nexus._mn_ensure_minute_bucket()
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  v_has_limits boolean;
  v_public     boolean;
  v_limit      bigint;
  v_types      text[];
  v_unscoped   text;
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'NEXUS minutes storage: Supabase Storage is not installed here; bucket and policies skipped. Re-run this file after enabling Storage.';
    return 'skipped';
  end if;

  -- Any permissive policy without a bucket_id condition would also grant rows of THIS bucket.
  select string_agg(p.policyname, ', ' order by p.policyname) into v_unscoped
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~ 'bucket_id';
  if v_unscoped is not null then
    raise exception 'storage.objects has policies without a bucket_id condition: %; they would expose these files. Nothing changed.', v_unscoped
      using errcode = 'P0001', hint = 'storage_policy_unscoped', detail = v_unscoped;
  end if;

  select count(*) = 2 into v_has_limits
  from information_schema.columns c
  where c.table_schema = 'storage' and c.table_name = 'buckets'
    and c.column_name in ('file_size_limit', 'allowed_mime_types');

  if v_has_limits then
    execute 'select b.public, b.file_size_limit, b.allowed_mime_types from storage.buckets b where b.id = $1'
      into v_public, v_limit, v_types using 'nexus-minute-files';
  else
    execute 'select b.public from storage.buckets b where b.id = $1' into v_public using 'nexus-minute-files';
  end if;

  if v_public is null then
    -- Missing: create it (never updates an existing row).
    if v_has_limits then
      execute $q$
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('nexus-minute-files', 'nexus-minute-files', false, 5242880,
                array['application/pdf', 'image/jpeg', 'image/png'])
      $q$;
    else
      raise notice 'NEXUS minutes storage: storage.buckets has no size/type columns; bucket created without them.';
      execute $q$
        insert into storage.buckets (id, name, public)
        values ('nexus-minute-files', 'nexus-minute-files', false)
      $q$;
    end if;
  elsif v_public
        or (v_has_limits and (v_limit is distinct from 5242880
                              or v_types is null
                              or (select array_agg(t order by t) from unnest(v_types) t)
                                 is distinct from array['application/pdf', 'image/jpeg', 'image/png'])) then
    raise exception 'A bucket "nexus-minute-files" already exists with other settings (public=%, size=%, types=%). Nothing changed.',
      v_public, v_limit, v_types
      using errcode = 'P0001', hint = 'bucket_conflict';
  end if;

  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects'
                   and p.policyname = 'nexus_minute_files_insert') then
    execute $q$
      create policy nexus_minute_files_insert on storage.objects for insert to authenticated
        with check (bucket_id = 'nexus-minute-files' and nexus.minute_file_can_upload(name))
    $q$;
  end if;
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects'
                   and p.policyname = 'nexus_minute_files_select') then
    execute $q$
      create policy nexus_minute_files_select on storage.objects for select to authenticated
        using (bucket_id = 'nexus-minute-files' and nexus.minute_file_can_read(name))
    $q$;
  end if;

  raise notice 'NEXUS minutes storage: bucket nexus-minute-files (private) and its two policies are in place.';
  return 'ok';
end
$$;

revoke all on function nexus._mn_ensure_minute_bucket() from public, anon, authenticated, service_role;

select nexus._mn_ensure_minute_bucket();
