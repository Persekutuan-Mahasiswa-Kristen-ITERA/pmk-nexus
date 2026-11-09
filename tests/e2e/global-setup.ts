// Runs once before the E2E suite. Refuses to run against anything but the local NEXUS stack, checks the
// stack and app are up, and puts the test accounts back into their documented seed state (a previous run
// may have been interrupted between a flip and its restore).
import { API_URL, PUBLISHABLE_KEY, assertLocalStack, ensureCacheDir, sql } from "../support/local-stack";

export const CANONICAL_RESET_SQL = `
  update public.members set is_active = true, must_change_password = false
    where email in ('member.regular@nexus.test','ketum@nexus.test','bendahara@nexus.test','admin@nexus.test','kadep@nexus.test','kadiv.logistik@nexus.test','staff.ops@nexus.test','pembina@nexus.test','kabiro@nexus.test');
  update public.members set is_active = true, must_change_password = true where email = 'member.temppw@nexus.test';
  update public.members set is_active = false where email = 'member.inactive@nexus.test';
  update auth.users set banned_until = null where email like '%@nexus.test';
  update public.periods set is_active = false where is_active;
  update public.periods set is_active = true where label = '2026/2027';
  -- Member Data specs: remove what a test may have left behind (temporary members and the temporary previous-period
  -- officer) and give the Member Data functions their grants back (the "gangguan" test revokes one for a moment).
  delete from public.assignments where member_id in (select id from public.members where email like 'qa-tmp-%@nexus.test');
  delete from public.assignments where member_id = (select id from public.members where email = 'member.regular@nexus.test')
    and period_id = (select id from public.periods where label = '2025/2026');
  delete from public.members where email like 'qa-tmp-%@nexus.test';
  alter table nexus.member_data_export_logs drop constraint if exists qa_block_log_write;
  -- Inventory specs: the temporary log-write blocker and the default rule D36 (a test disables it for a moment).
  alter table nexus.inventory_borrowing_export_logs drop constraint if exists qa_block_ib_log_write;
  update nexus.access_rules set is_enabled = true where default_code = 'D36';
  grant execute on function nexus.member_data_list(text, uuid, text, integer, integer),
    nexus.member_data_unit_options(), nexus.member_data_active_count(), nexus.member_data_export(text, text, uuid, text),
    nexus.member_data_export_log_list(integer, integer) to authenticated;
`;

export default async function globalSetup() {
  assertLocalStack();
  ensureCacheDir();

  const health = await fetch(`${API_URL}/auth/v1/health`, { headers: { apikey: PUBLISHABLE_KEY } }).catch(() => null);
  if (!health?.ok) throw new Error("The NEXUS local stack is not answering. Run `bash scripts/dev-db.sh start`.");

  const app = await fetch("http://localhost:3100/login").catch(() => null);
  if (!app?.ok) throw new Error("The app is not answering on http://localhost:3100. Run `pnpm build` first (Playwright then starts it).");

  sql(CANONICAL_RESET_SQL);

  // Opt-in (QA_RELIEVE_DAILY_CAP=1): the owner's cap of 20 new requests per member per Jakarta day counts every request ever
  // made today and requests cannot be deleted, so repeated full runs on one day would exhaust it. This moves the creation time
  // of today's QA test requests (items named "QA...") back by one day, in ONE transaction with triggers skipped
  // (session_replication_role), touching nothing else. Never run it against a database with real requests.
  if (process.env.QA_RELIEVE_DAILY_CAP === "1") {
    sql(`begin; set local session_replication_role = replica;
      update nexus.borrowing_requests r set created_at = created_at - interval '1 day'
      where nexus._jakarta_date(r.created_at) = nexus._ib_today()
        and exists (select 1 from nexus.borrowing_request_lines l join nexus.inventory_items i on i.id = l.item_id where l.request_id = r.id and i.name like 'QA%');
      commit;`);
  }
}
