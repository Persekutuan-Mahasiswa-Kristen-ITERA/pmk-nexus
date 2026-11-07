-- PMK-NEXUS 0007: private Storage bucket for borrowing evidence photos (IB8, IB9, A-IB31, A-IB39).
--
-- Spec:      docs/modules/inventory-borrowing.md F6, section 4 (evidence photos), IB-29, IB-32;
--            docs/design/inventory-borrowing.md 13.3 (JPG/PNG/WebP, resized in the browser to about
--            1 MB); CLAUDE.md section 11 (private buckets, short-lived signed URLs); access control L11
--            (files follow the parent record's view right). Approved by the owner 2026-11-07 together
--            with the read-only pre-checks in supabase/README.md (section 2, step 10).
--
-- !! The ONLY NEXUS file that touches a schema other than `nexus`: it may add one row to
--    storage.buckets and two policies on storage.objects. Both are Supabase-managed Storage objects,
--    NOT PI-CORE objects (PI-CORE uses no Storage; verified in pi-core-v2 migrations 20261031165546 ..
--    20261102090000). Every policy is limited to bucket_id = 'nexus-borrowing-evidence'; the access
--    logic lives in nexus functions (20261107100100, section 12).
--
-- Shared project safety (review M2): this file NEVER changes an existing bucket. It creates the bucket
-- only when it is missing; if a bucket with this id already exists with other settings, or public, it
-- STOPS (hint bucket_conflict) and changes nothing. It also stops (hint storage_policy_unscoped) when
-- any existing policy on storage.objects lacks a bucket_id condition, because such a permissive policy
-- would also open this bucket's evidence photos.
--
-- Bucket: nexus-borrowing-evidence, public = false, 1.5 MiB per file (the app resizes to about 1 MB),
--         image/jpeg, image/png, image/webp.
-- Path:   "<request id>/<random uuid>.<jpg|jpeg|png|webp>" (lowercase). Record: nexus.borrowing_evidence_photos.
-- Policies on storage.objects (authenticated only; anon gets nothing):
--   INSERT  nexus_borrowing_evidence_insert  -> nexus.borrowing_evidence_can_upload(name)
--   SELECT  nexus_borrowing_evidence_select  -> nexus.borrowing_evidence_can_read(name)
--   No UPDATE and no DELETE policy: clients can neither overwrite nor delete (IB-32, L5).
--
-- Where Storage is not installed (local dev stack with [storage] enabled = false; the bare postgres
-- image) the check function is created but the bucket and policies are skipped, with a notice. Re-run:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261107100200_nexus_inventory_storage.sql
-- Re-runnable: an identical bucket and existing policies are left as they are.

-- Internal (owner only). Kept as a function so the conflict guards can be tested (pgTAP, Storage stub).
create or replace function nexus._ib_ensure_evidence_bucket()
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
    raise notice 'NEXUS storage: Supabase Storage is not installed here; bucket and policies skipped. Re-run this file after enabling Storage.';
    return 'skipped';
  end if;

  -- Any permissive policy without a bucket_id condition would also grant rows of THIS bucket.
  select string_agg(p.policyname, ', ' order by p.policyname) into v_unscoped
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~ 'bucket_id';
  if v_unscoped is not null then
    raise exception 'storage.objects has policies without a bucket_id condition: %; they would expose evidence photos. Nothing changed.', v_unscoped
      using errcode = 'P0001', hint = 'storage_policy_unscoped', detail = v_unscoped;
  end if;

  select count(*) = 2 into v_has_limits
  from information_schema.columns c
  where c.table_schema = 'storage' and c.table_name = 'buckets'
    and c.column_name in ('file_size_limit', 'allowed_mime_types');

  if v_has_limits then
    execute 'select b.public, b.file_size_limit, b.allowed_mime_types from storage.buckets b where b.id = $1'
      into v_public, v_limit, v_types using 'nexus-borrowing-evidence';
  else
    execute 'select b.public from storage.buckets b where b.id = $1' into v_public using 'nexus-borrowing-evidence';
  end if;

  if v_public is null then
    -- Missing: create it (never updates an existing row).
    if v_has_limits then
      execute $q$
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('nexus-borrowing-evidence', 'nexus-borrowing-evidence', false, 1572864,
                array['image/jpeg', 'image/png', 'image/webp'])
      $q$;
    else
      raise notice 'NEXUS storage: storage.buckets has no size/type columns; bucket created without them.';
      execute $q$
        insert into storage.buckets (id, name, public)
        values ('nexus-borrowing-evidence', 'nexus-borrowing-evidence', false)
      $q$;
    end if;
  elsif v_public
        or (v_has_limits and (v_limit is distinct from 1572864
                              or v_types is null
                              or (select array_agg(t order by t) from unnest(v_types) t)
                                 is distinct from array['image/jpeg', 'image/png', 'image/webp'])) then
    raise exception 'A bucket "nexus-borrowing-evidence" already exists with other settings (public=%, size=%, types=%). Nothing changed.',
      v_public, v_limit, v_types
      using errcode = 'P0001', hint = 'bucket_conflict';
  end if;

  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects'
                   and p.policyname = 'nexus_borrowing_evidence_insert') then
    execute $q$
      create policy nexus_borrowing_evidence_insert on storage.objects for insert to authenticated
        with check (bucket_id = 'nexus-borrowing-evidence' and nexus.borrowing_evidence_can_upload(name))
    $q$;
  end if;
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects'
                   and p.policyname = 'nexus_borrowing_evidence_select') then
    execute $q$
      create policy nexus_borrowing_evidence_select on storage.objects for select to authenticated
        using (bucket_id = 'nexus-borrowing-evidence' and nexus.borrowing_evidence_can_read(name))
    $q$;
  end if;

  raise notice 'NEXUS storage: bucket nexus-borrowing-evidence (private) and its two policies are in place.';
  return 'ok';
end
$$;

revoke all on function nexus._ib_ensure_evidence_bucket() from public, anon, authenticated, service_role;

select nexus._ib_ensure_evidence_bucket();
