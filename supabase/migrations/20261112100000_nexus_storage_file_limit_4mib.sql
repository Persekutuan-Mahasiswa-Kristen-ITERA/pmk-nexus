-- Lower Letters, Minutes and Finance uploads to 4 MiB (4,194,304 bytes).
-- Keep Inventory evidence at its separately approved 1.5 MiB cap.
-- Keep existing policies, ownership checks, MIME rules and bucket privacy unchanged.
do $migration$
declare
  v record;
  v_def text;
begin
  -- The four metadata tables enforce the same cap independently of Storage.
  for v in select * from (values
    ('nexus', 'letter_files', 'letter_files_size_bytes_check'),
    ('nexus', 'minute_files', 'minute_files_size_bytes_check'),
    ('nexus', 'finance_entry_files', 'finance_entry_files_size_bytes_check')
  ) as x(s, t, c)
  loop
    if to_regclass(format('%I.%I', v.s, v.t)) is not null then
      execute format('alter table %I.%I drop constraint if exists %I', v.s, v.t, v.c);
      execute format('alter table %I.%I add constraint %I check (size_bytes is null or size_bytes between 1 and 4194304)', v.s, v.t, v.c);
    end if;
  end loop;

  -- The module guards enforce the same cap on objects that are already in Storage.
  for v in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'nexus' and p.proname in ('_lt_check_files', '_mn_check_files', '_fn_check_files')
  loop
    v_def := pg_get_functiondef(v.signature::oid);
    v_def := replace(v_def, '5242880', '4194304');
    v_def := replace(v_def, '5 MB', '4 MiB');
    execute v_def;
  end loop;

  -- Supabase Storage service enforces the cap on these buckets; Inventory has a distinct limit.
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 4194304
    where id in ('nexus-letter-files', 'nexus-minute-files', 'nexus-finance-proofs')
      and file_size_limit is distinct from 4194304;
  end if;
end
$migration$;
