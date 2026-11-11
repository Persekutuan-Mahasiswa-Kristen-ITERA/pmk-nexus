-- pgTAP regression tests for the 4 MiB cap on Letters, Minutes and Finance.
-- Run only on a local throwaway database after all migrations and the Storage stub.
\set ON_ERROR_STOP on
begin;
select plan(17);

select is((select file_size_limit::bigint from storage.buckets where id = 'nexus-borrowing-evidence'), 1572864::bigint, 'inventory bucket retains its separate 1.5 MiB cap');
select ok((select pg_get_functiondef('nexus._ib_check_photo(uuid,text)'::regprocedure) not like '%4194304%'), 'inventory Storage metadata guard is not modified to 4 MiB');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'nexus.letter_files'::regclass and conname = 'letter_files_size_bytes_check'), 'CHECK (((size_bytes IS NULL) OR ((size_bytes >= 1) AND (size_bytes <= 4194304))))', 'letters metadata constraint enforces 4 MiB');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'nexus.minute_files'::regclass and conname = 'minute_files_size_bytes_check'), 'CHECK (((size_bytes IS NULL) OR ((size_bytes >= 1) AND (size_bytes <= 4194304))))', 'minutes metadata constraint enforces 4 MiB');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'nexus.finance_entry_files'::regclass and conname = 'finance_entry_files_size_bytes_check'), 'CHECK (((size_bytes IS NULL) OR ((size_bytes >= 1) AND (size_bytes <= 4194304))))', 'finance metadata constraint enforces 4 MiB');
select is((select file_size_limit::bigint from storage.buckets where id = 'nexus-letter-files'), 4194304::bigint, 'letters bucket is capped at 4 MiB');
select is((select file_size_limit::bigint from storage.buckets where id = 'nexus-minute-files'), 4194304::bigint, 'minutes bucket is capped at 4 MiB');
select is((select file_size_limit::bigint from storage.buckets where id = 'nexus-finance-proofs'), 4194304::bigint, 'finance bucket is capped at 4 MiB');
select ok((select pg_get_functiondef('nexus._lt_check_files(jsonb,uuid,integer,integer)'::regprocedure) like '%4194304%'), 'letters metadata guard enforces 4 MiB');
select ok((select pg_get_functiondef('nexus._mn_check_files(jsonb,uuid,integer,integer)'::regprocedure) like '%4194304%'), 'minutes metadata guard enforces 4 MiB');
select ok((select pg_get_functiondef('nexus._fn_check_files(jsonb,uuid,integer,integer)'::regprocedure) like '%4194304%'), 'finance metadata guard enforces 4 MiB');
select ok((select pg_get_functiondef('nexus._ib_check_photo(uuid,text)'::regprocedure) not like '%4194304%'), 'inventory Storage metadata guard is not modified to 4 MiB');
select ok((select pg_get_functiondef('nexus._lt_check_files(jsonb,uuid,integer,integer)'::regprocedure) like '%file_too_large%'), 'letters over-limit has named rejection');
select ok((select pg_get_functiondef('nexus._mn_check_files(jsonb,uuid,integer,integer)'::regprocedure) like '%file_too_large%'), 'minutes over-limit has named rejection');
select ok((select pg_get_functiondef('nexus._fn_check_files(jsonb,uuid,integer,integer)'::regprocedure) like '%file_too_large%'), 'finance over-limit has named rejection');
select is((select count(*)::integer from pg_policies where schemaname = 'storage' and policyname in ('nexus_borrowing_evidence_insert','nexus_borrowing_evidence_select','nexus_letter_files_insert','nexus_letter_files_select','nexus_minute_files_insert','nexus_minute_files_select','nexus_finance_proofs_insert','nexus_finance_proofs_select')), 8, 'all existing Storage owner/security policies remain present');
select ok((select bool_and(not public) from storage.buckets where id in ('nexus-borrowing-evidence','nexus-letter-files','nexus-minute-files','nexus-finance-proofs')), 'all upload buckets remain private');

select * from finish();
rollback;
