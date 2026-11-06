-- PMK-NEXUS 0003: caller-only "password change pending" check (temporary-password gate).
--
-- Spec:      docs/modules/auth-login.md (approved): 3.1 option B, flow F6, section 8, AUTH-19..AUTH-23.
-- Decisions: D-015 (block in NEXUS and send to PI-CORE), D-010 (read PI-CORE only through nexus
--            functions), D-016. Locked rule L4 (docs/modules/access-control.md) and supabase/README.md
--            checklist item 6 allow exactly ONE function to read the caller's own must_change_password.
--            This file creates that function and nothing else.
-- PI-CORE:   verified against pi-core-v2 migrations 20261031165546 .. 20261102090000
--            (docs/picore/schema-report.md). Column used: members(user_id, is_active, must_change_password).
--
-- Why SECURITY INVOKER (not DEFINER):
--   * PI-CORE already lets the caller read this flag about themselves, so NEXUS needs no bypass:
--       - 20261031165546_core_schema.sql:351-354  revoke all ... from anon, authenticated; then
--         `grant select on public.members to authenticated` (table-level = every column, including
--         must_change_password). Later PI-CORE migrations add only column-level INSERT/UPDATE grants
--         (20261102090000_member_type.sql:18); none revokes SELECT.
--       - 20261031171704_members_select_requires_active.sql:4-5  policy members_select:
--         `private.is_admin() or (user_id = auth.uid() and is_active)` = an active member sees their
--         own row; an inactive member sees nothing, not even their own row.
--   * Running as the caller means this function can never reveal more than PI-CORE's own API already
--     gives the same token. A DEFINER function would bypass PI-CORE RLS and widen L4 for no gain.
--   * It reads the same row, under the same RLS, as nexus.my_context() (also INVOKER), so the two
--     answers cannot drift apart when PI-CORE changes its policies.
--   * The body filters on auth.uid() itself, NOT only on RLS: a PI-CORE admin can SELECT every member
--     row, but this function still answers only about the caller. It takes no parameter at all.
--
-- Result (one boolean, never null, never a row set):
--   active linked member, flag true   -> true   (app shows the "Ganti kata sandi dulu" state, F6)
--   active linked member, flag false  -> false  (normal entry)
--   inactive member (any flag)        -> false  (own row is hidden by PI-CORE RLS; my_context() = 0 rows)
--   Auth user without a member row    -> false  (no row; my_context() = 0 rows)
--   authenticated without auth.uid()  -> false  (no row)
--   anon, service_role, PUBLIC        -> permission denied (42501): no EXECUTE, anon has no schema USAGE
-- "false" means "no pending password change for a NEXUS member"; it NEVER means "access granted".
-- Access is decided by nexus.my_context() first (zero rows = No access, L1) and enforced by RLS.
-- Returning true for inactive/unlinked users would show them the PI-CORE password screen instead of the
-- one combined No-access message (D-016 E4), so false is the safe and consistent answer there.
--
-- Fail closed (app rule, docs/modules/auth-login.md AR10): the session check calls my_context() first,
-- then this function, both with the USER's session. If this call errors (network, schema not exposed,
-- permission denied because PI-CORE later revokes the column) or returns anything other than exactly
-- true/false, the app shows the "gangguan" error state with no data; it never treats an error as false
-- and never signs the person out. Precedence: anonymous > error > no-access > password-pending > member.
--
-- Known limit (D-015): this is an app-level gate, same as PI-CORE. RLS does not block a direct API call
-- made with the temporary password (AUTH-23). NEXUS never changes the password or the flag.
--
-- Run as ONE transaction: `psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -f <file>`. See supabase/README.md.
-- Only nexus objects are created; nothing in public/private is created, altered, granted, or written.

-- No comments inside the body on purpose: the structural pgTAP test greps function bodies (prosrc)
-- for forbidden column names, and this body must contain only the one whitelisted name.
create function nexus.my_password_change_pending()
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    (select m.must_change_password
     from public.members m
     where m.user_id = (select auth.uid()) and m.is_active),
    false)
$$;

comment on function nexus.my_password_change_pending() is
  'D-015: true only when the CALLER is an active linked member whose PI-CORE password is still temporary. '
  'Caller-only, no parameters, one non-null boolean. The only nexus function allowed to read '
  'must_change_password (L4 exception). App-level gate: on error the app fails closed ("gangguan").';

-- README section 7, item 3: the global default still grants EXECUTE to PUBLIC, so revoke explicitly.
revoke all on function nexus.my_password_change_pending() from public, anon, service_role;
grant execute on function nexus.my_password_change_pending() to authenticated;
