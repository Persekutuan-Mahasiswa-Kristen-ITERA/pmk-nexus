-- THROWAWAY TEST CONTAINER ONLY. A minimal stand-in for the Supabase Storage tables, so the policies of
-- 20261107100200_nexus_inventory_storage.sql can be tested with real Postgres RLS in the bare
-- supabase/postgres image (it has an EMPTY `storage` schema owned by supabase_admin and no Storage
-- service). Load it as supabase_admin BEFORE the NEXUS migrations (supabase/tests/README.md):
--   docker exec -i <container> psql -U supabase_admin -d postgres -X -q -1 -v ON_ERROR_STOP=1 < supabase/tests/support/storage_stub.sql
-- Never on the hosted project, never on the NEXUS dev stack.
--
-- It mimics only what NEXUS uses: storage.buckets (id, name, public, file_size_limit,
-- allowed_mime_types) and storage.objects (bucket_id, name, owner, metadata) with RLS on and the same
-- table grants Supabase gives `authenticated` (RLS decides). Difference from Supabase: the tables are
-- owned by `postgres` here (Supabase: supabase_storage_admin) so the migration, run as postgres, can
-- attach its policies; see supabase/README.md for the hosted fallback.
--
-- Guards, checked before anything is created (review M3):
--   1. every auth account and member email must end in @example.test (the pgTAP fixtures' domain);
--      anything else, INCLUDING the NEXUS dev stack's @nexus.test accounts, stops it;
--   2. it never shadows a real Storage: it stops if storage tables already exist.
-- Everything is ONE statement on purpose (no psql meta-commands): pgTAP includes this file to check
-- guard 1 and reads the single error message.
do $stub$
begin
  if exists (select 1 from auth.users u where u.email is null or u.email !~* '@example\.test$')
     or exists (select 1 from public.members m where m.email is null or m.email !~* '@example\.test$') then
    raise exception 'storage_stub.sql: found an account or member outside @example.test (real data or the NEXUS dev stack); throwaway test container only. Nothing was created.';
  end if;
  if to_regclass('storage.objects') is not null or to_regclass('storage.buckets') is not null then
    raise exception 'storage_stub.sql: storage tables already exist here; this stub is for a bare test container only.';
  end if;

  execute 'create schema if not exists storage';
  execute 'grant usage on schema storage to authenticated, anon, service_role';
  execute $ddl$
    create table storage.buckets (
      id                 text primary key,
      name               text not null unique,
      owner              uuid,
      public             boolean not null default false,
      file_size_limit    bigint,
      allowed_mime_types text[],
      created_at         timestamptz not null default now(),
      updated_at         timestamptz not null default now()
    )
  $ddl$;
  execute $ddl$
    create table storage.objects (
      id         uuid primary key default gen_random_uuid(),
      bucket_id  text references storage.buckets (id),
      name       text not null,
      owner      uuid default auth.uid(),
      owner_id   text,
      metadata   jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (bucket_id, name)
    )
  $ddl$;
  execute 'alter table storage.buckets enable row level security';
  execute 'alter table storage.objects enable row level security';
  execute 'grant select on storage.buckets to authenticated, anon';
  execute 'grant select, insert, update, delete on storage.objects to authenticated, anon';
  execute 'grant all on storage.buckets, storage.objects to service_role';
  execute 'alter table storage.buckets owner to postgres';
  execute 'alter table storage.objects owner to postgres';
end
$stub$;
