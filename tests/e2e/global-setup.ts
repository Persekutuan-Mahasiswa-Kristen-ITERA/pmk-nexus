// Runs once before the E2E suite. Refuses to run against anything but the local NEXUS stack, checks the
// stack and app are up, and puts the test accounts back into their documented seed state (a previous run
// may have been interrupted between a flip and its restore).
import { API_URL, PUBLISHABLE_KEY, assertLocalStack, ensureCacheDir, sql } from "../support/local-stack";

export const CANONICAL_RESET_SQL = `
  update public.members set is_active = true, must_change_password = false
    where email in ('member.regular@nexus.test','ketum@nexus.test','bendahara@nexus.test','admin@nexus.test');
  update public.members set is_active = true, must_change_password = true where email = 'member.temppw@nexus.test';
  update public.members set is_active = false where email = 'member.inactive@nexus.test';
  update auth.users set banned_until = null where email like '%@nexus.test';
  update public.periods set is_active = false where is_active;
  update public.periods set is_active = true where label = '2026/2027';
`;

export default async function globalSetup() {
  assertLocalStack();
  ensureCacheDir();

  const health = await fetch(`${API_URL}/auth/v1/health`, { headers: { apikey: PUBLISHABLE_KEY } }).catch(() => null);
  if (!health?.ok) throw new Error("The NEXUS local stack is not answering. Run `bash scripts/dev-db.sh start`.");

  const app = await fetch("http://localhost:3100/login").catch(() => null);
  if (!app?.ok) throw new Error("The app is not answering on http://localhost:3100. Run `pnpm build` first (Playwright then starts it).");

  sql(CANONICAL_RESET_SQL);
}
