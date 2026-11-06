# PI-CORE Real Schema Report

> Produced 2026-11-05 by `picore-schema-inspector` (read-only). Key claims spot-checked by the main agent against the migration files (single-active index, `private.is_admin()` body, `organization_admin` mapping, Operasional units, no Committee role, exposed schemas).
> Source repo: `/home/fycode/Documents/pi-core-v2` (git HEAD `d8b6814`). READ-ONLY for NEXUS.
> Re-run the inspector whenever PI-CORE adds or changes a migration.

Migrations read, in order (exactly 5):
1. `20261031165546_core_schema.sql` (core)
2. `20261031171704_members_select_requires_active.sql`
3. `20261101100000_access_level_super_admin.sql`
4. `20261101100100_org_structure.sql` (REPLACES roles, positions, assignments)
5. `20261102090000_member_type.sql`

Also read: `supabase/seed.sql`, `supabase/config.toml`, `docs/ARCHITECTURE.md`, `src/lib/members/provisioning.ts`. No `.env*` files were opened.

All PI-CORE objects live in schema `public`, plus a helper schema `private`.

## 1. Summary

- Org structure is a tree (`org_units`). Roles are capability bundles linked to positions through `position_roles`. Assignment = member x org_unit x position x period.
- System access is `members.access_level` (`member | admin | super_admin`). PI-CORE ALSO treats someone as admin when an active-period assignment's position carries a role with `grants_admin = true`.
- Active period = `periods.is_active = true`. At most one, enforced by a partial unique index. Changed only through RPC `public.set_active_period(uuid)`.
- Seeded roles NEXUS needs (`bph`, `bendahara`, `sekretaris`, `staff`) have stable `key`s. There is no "Operations" role, only the org unit `Departemen Operasional`. No Committee role.
- Regular members can read only their own member row and assignments. A full member list for NEXUS needs a SECURITY DEFINER view or function.

## 2. Tables (schema `public`)

Most tables have audit columns `created_at`, `created_by`, `updated_at`, `updated_by`, set by trigger `private.stamp_row()`.

### `members` (migration 1, altered in 3 and 5)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid UNIQUE NULL | FK `auth.users(id)` ON DELETE SET NULL |
| `full_name` | text NOT NULL | 2..120 chars |
| `email` | text NOT NULL | lowercase, regex check; unique index `members_email_key` |
| `nim` | text NULL | `^[0-9]{6,12}$`; unique partial index |
| `phone` | text NULL | `^\+?[0-9]{8,15}$` |
| `access_level` | `public.access_level` NOT NULL | default `'member'` |
| `is_active` | boolean NOT NULL | default true |
| `deactivated_at` | timestamptz NULL | set by trigger `private.track_deactivation` |
| `must_change_password` | boolean NOT NULL | default true |
| `member_type` | `public.member_type` NOT NULL | default `'student'` (migration 5) |
| `nip` | text NULL | `^[0-9]{8,20}$`; unique partial index (migration 5) |

Check `members_identifier_matches_type`: students have no `nip`, lecturers have no `nim`. Index on `lower(full_name)`.
There is NO department or status text column. Status = `is_active` (+ `deactivated_at`). Department comes only from assignments -> org_units.

### `org_units` (migration 4)
`id` uuid PK, `parent_id` uuid NULL FK self ON DELETE RESTRICT, `type` `org_unit_type` NOT NULL, `name` text NOT NULL (2..80), `sort_order` int default 100, `is_active` boolean default true.
Constraints: root iff type = organization; `unique (id, type)`; single root; name unique per parent (case-insensitive). Trigger `private.org_unit_check_parent()`: bph/department/bureau under organization; division under department.
**No stable `key` / slug column.**

### `positions` (replaced in migration 4)
`id` uuid PK, `name` text (2..80), `unit_type` `org_unit_type` (not organization), `rank` int 1..999 (lower = more senior), `is_unique_per_unit` boolean default false.
Unique `(unit_type, lower(btrim(name)))`. A position belongs to a unit TYPE; it has no `role_id`.

### `roles` (replaced in migration 4)
`id` uuid PK, `key` text UNIQUE NULL (`^[a-z][a-z0-9_]{1,40}$`, set for system roles), `name` text (2..60), `description` text (<=280), `sort_order` int, `is_system` boolean, `grants_admin` boolean default false.

### `position_roles` (migration 4)
PK `(position_id, role_id)`; both FKs ON DELETE CASCADE. Many-to-many.

### `periods` (migration 1)
`id` uuid PK, `label` text (`^[0-9]{4}/[0-9]{4}$`, second year = first + 1), `starts_on` date NULL, `ends_on` date NULL, `is_active` boolean default false.
Unique `label`; **unique partial index `periods_single_active on (is_active) where is_active`**. Insert trigger: the first period ever becomes active, later ones start inactive.

### `assignments` (replaced in migration 4)
`id` uuid PK, `member_id` FK members ON DELETE RESTRICT, `org_unit_id`, `position_id`, `period_id` FK periods ON DELETE RESTRICT, `unit_type` and `is_unique_per_unit` (copied from the position by trigger `private.assignment_fill()`).
Composite FKs force unit type = position unit type. `unique (member_id, org_unit_id, position_id, period_id)`. Unique partial index `assignments_one_holder (org_unit_id, position_id, period_id) where is_unique_per_unit`.
Triggers reject inactive units, inactive members, and lecturers (hints `member_inactive`, `member_lecturer`).
A member CAN hold several assignments in one period.

### `org_settings` (migration 1)
Singleton row: `org_name` = 'Persekutuan Mahasiswa Kristen ITERA'.

### `audit_log` (migration 1)
`id` bigint identity, `occurred_at`, `actor_id`, `table_name`, `record_id`, `action` (INSERT/UPDATE/DELETE), `old_data` jsonb, `new_data` jsonb. Trigger-written on PI-CORE tables only.

## 3. Enums

| Enum | Values |
|---|---|
| `public.access_level` | `super_admin`, `admin`, `member` |
| `public.org_unit_type` | `organization`, `bph`, `department`, `bureau`, `division` |
| `public.member_type` | `student`, `lecturer` |

## 4. Views and functions

| Object | Kind | Security | Purpose |
|---|---|---|---|
| `public.role_overview` | view | security_invoker | roles with active member count; non-admins see only their own roles |
| `private.current_member_id()` | fn -> uuid | DEFINER | caller's `members.id` if active |
| `private.is_admin()` | fn -> boolean | DEFINER | active AND (`access_level` in super_admin/admin OR active-period assignment whose position carries a `grants_admin` role) |
| `private.is_super_admin()` | fn -> boolean | DEFINER | active AND `access_level = 'super_admin'` |
| `public.current_access()` | fn -> text | DEFINER | caller's effective level: `super_admin`/`admin`/`member`; granted to authenticated only |
| `public.set_active_period(uuid)` | fn -> void | DEFINER | admin only; switches the active period atomically |

Trigger functions in `private`: `stamp_row`, `write_audit_log`, `track_deactivation`, `period_insert_defaults`, `assignment_member_active`, `assignment_fill`, `org_unit_check_parent`, `guard_last_super_admin`, `guard_member_access_level`.
Schema `private` is not exposed through the API, but `authenticated` has USAGE and EXECUTE on its functions.
There is NO `active_period()` function and NO member/assignment view suited for NEXUS.

## 5. RLS and grants

RLS is enabled on all 9 tables. Every table first revokes all from `anon` and `authenticated`, then grants column-level privileges to `authenticated` only. Nothing is granted to `anon`.

| Table | SELECT | Write |
|---|---|---|
| members | `is_admin()` OR own row AND active | insert/update: admin rules; no DELETE |
| assignments | `is_admin()` OR own | `is_admin()` |
| roles | `is_admin()` OR carried by own assignment | super admin |
| positions | any active member | super admin |
| position_roles | `is_admin()` OR own position | super admin |
| org_units | any active member | super admin |
| periods | `is_admin()` OR (active member AND `is_active`) OR own assignment's period | `is_admin()`; `is_active` only via RPC; no DELETE |
| org_settings | any active member | super admin |
| audit_log | `is_admin()` | trigger only |

## 6. Active period

`periods.is_active`. At most one (DB-enforced). Start/end dates are informational only. Only admins can switch it. Local seed: 2026/2027 active, plus 2021/2022 to 2025/2026. Production data is not in the repo.

## 7. System admin

Stored in `members.access_level`, not a separate table.
- `super_admin`: set by hand, not tied to a period (maintainer, pembina).
- `admin`: set by hand, OR derived from an active-period assignment whose position carries role `organization_admin` (`grants_admin = true`).

Positions carrying `organization_admin`: **Ketua Umum, Sekretaris Jenderal, Sekretaris Umum 1, Sekretaris Umum 2, Kepala Departemen, Kepala Biro.**

## 8. Org structure (baseline data in migration 4, present in every environment)

- Root: `PMK ITERA` (organization). BPH: `BPH PMK ITERA`.
- Departments: `Departemen Internal`, `Departemen Eksternal`, `Departemen Pelayanan Khusus`, `Departemen Talenta`, `Departemen Operasional`, `Departemen CMIT`, `Departemen Pembinaan Rohani`. Bureau: `Biro Kewirausahaan`.
- Divisions: Internal (EO, Harmonisasi); Eksternal (Intra Kampus, Ekstra Kampus); Pelayanan Khusus (Worship, Worship Creator, Musik); Talenta (Art Interest, Ekstra Youth); **Operasional (Logistik, Akomodasi)**; CMIT (Pubdok, Desain, IT); Pembinaan Rohani (Gospel Group, Doa).

Positions (unit type, rank, unique per unit):

| Position | Unit type | Rank | Unique | Roles carried |
|---|---|---|---|---|
| Ketua Umum | bph | 10 | yes | `bph`, `organization_admin` |
| Sekretaris Jenderal | bph | 20 | yes | `bph`, `organization_admin` |
| Sekretaris Umum 1 / 2 | bph | 30 | yes | `bph`, `organization_admin` |
| Bendahara Umum 1 / 2 | bph | 30 | yes | `bph`, `bendahara` |
| Kepala Departemen | department | 40 | yes | `kepala_departemen`, `organization_admin` |
| Sekretaris Departemen | department | 50 | yes | `sekretaris` |
| Kepala Biro | bureau | 40 | yes | `kepala_departemen`, `organization_admin` |
| Sekretaris Biro | bureau | 50 | yes | `sekretaris` |
| Kepala Divisi | division | 60 | yes | `kepala_divisi` |
| Staff | division | 70 | no | `staff` |
| Staff | bureau | 70 | no | `staff` |

Role keys: `organization_admin`, `bph`, `bendahara`, `kepala_departemen`, `sekretaris`, `kepala_divisi`, `staff`.
Note: role `sekretaris` belongs only to department/bureau secretaries. BPH secretaries carry `bph` + `organization_admin`.
No `anggota` (regular member) role and no `panitia` (committee) role.

## 9. Member status and type

- Status = `is_active` + `deactivated_at`. Deactivation also bans the Auth user (app level). Inactive members see nothing via RLS. No delete via API.
- `member_type`: `student` (uses `nim`) or `lecturer` (uses `nip`). Lecturers cannot hold assignments.

## 10. Link to Supabase Auth

`members.user_id` -> `auth.users(id)`. No sign-up trigger. PI-CORE's server creates the Auth user (service role, temporary password) and then inserts the member row. Local config: sign-up disabled, anonymous sign-in disabled. Hosted settings cannot be verified from the repo. `user_id` may be NULL (member without login).

## 11. Risks for NEXUS (shared Supabase project)

1. **Exposed schemas:** only `public` and `graphql_public` are exposed. Schema `nexus` must be added to the hosted project's "Exposed schemas" setting, which affects the shared project.
2. **`private.*` functions** are PI-CORE internals. NEXUS can call them but they may change without notice. `public.current_access()` is the only public helper.
3. **Member list for non-admins** is blocked by PI-CORE RLS. NEXUS needs SECURITY DEFINER functions in its own schema. They bypass PI-CORE RLS, so they must filter by the caller's NEXUS permission and never expose email, phone, NIM, or NIP unless approved.
4. **Own-permission checks work as invoker:** a user can read their own assignments, own position_roles, own roles, the active period, and org_units. So computing "my NEXUS permissions" needs no elevated rights.
5. **Name-based matching** of `Departemen Operasional` breaks if someone renames the unit (no stable key).
6. **Schema churn:** migration 4 already replaced roles/positions/assignments once. All reads must stay in `src/lib/picore/`.
7. **Default privileges** for new tables in `nexus` are unknown on the hosted project. Enable RLS on every table and revoke defaults explicitly.
8. **Audit:** PI-CORE's audit trigger does not cover NEXUS tables. NEXUS needs its own audit if wanted.

## 12. Open questions raised

Moved to `docs/OPEN_QUESTIONS.md` (section "PI-CORE schema").
