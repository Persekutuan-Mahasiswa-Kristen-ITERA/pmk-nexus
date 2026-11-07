# Access Control (cross-cutting module spec)

> Status: **APPROVED** by the owner on 2026-11-05 (D-012). Revision 2, configurable model (D-011).
> Amended 2026-11-06 (D-019, owner OK): default rule D32 added (`member_data.view` for role `kepala_departemen`), 31 -> 33 default rules; new sensitive key `member_data.view_export_log` with rule D33 for role `bph` (owner 2026-11-06); B9 answered as option (b); Member Data shows a "Pembina" marker (member type). D32, D33 and the new key are added by migration `20261106200000_nexus_member_data.sql` (not yet applied to the hosted project).
> Amended 2026-11-07 (D-022, owner OK, Inventory and Borrowing): new key `borrowing.handle` (handover, return, outside-party requests; keys 21 -> 22); `borrowing.approve` now means approve, reject and extend only; default rule D30 (whole Operations unit approves) is retired and replaced by D34 and D35 (only the heads approve) plus D36 (every Operations holder gets `borrowing.handle`); active default rules 33 -> 35; L6 now covers only approve, reject and extend; L9 widened (cancel until pick-up); L12 also lists `*.handle`; B4 and B29 updated. **The migration is written (2026-11-07): `20261107100000_nexus_borrowing_access_rules.sql`, committed in 7a8399a but NOT yet applied to the hosted project.** It adds `borrowing.handle` (22 keys) and D34-D36, and retires D30: D30 is disabled and listed in the new table `nexus.retired_default_rules`, and `restore_default_access_rules()` never re-enables it. Result: 35 enabled rules plus 1 retired. Until it is applied to hosted, the hosted database still follows the pre-amendment rules (old D30, no `borrowing.handle`). The Inventory and Borrowing tables, functions and storage bucket are in two further migrations (`20261107100100`, `20261107100200`), see `docs/modules/inventory-borrowing.md`.
> Sources: `CLAUDE.md` (sections 4-7, 11), `docs/PMK-NEXUS-context.md` (section 4: the access table is now only the DEFAULT rule set), `docs/picore/schema-report.md`, `docs/DECISIONS.md` (D-007 to D-011), `docs/OPEN_QUESTIONS.md` (B, B-bis, C).
> No SQL or code here. Tags: **D-0xx** = owner decision, **[A-Bx]** = [ASSUMPTION] tied to open question Bx, **[A-n]** = [ASSUMPTION] without its own question (section 11), **L1-L11** = locked rule (section 4).

---

## 1. Purpose, users, scope

**Purpose.** Define who may do what in every Phase 1 NEXUS module (Dashboard, Member Data, Finance, Meeting Minutes, Letters, Inventory, Borrowing, NEXUS settings) when permissions are **rules the System Admin can edit**, not code. This spec is the base for the access mapping and RLS step; every module spec depends on it.

**Who uses it.**
- System Admin: edits the access rules on the settings screen.
- BPH: reads the rule change log (B24).
- Every other member: is affected by the rules; never sees the rules screen.

**Core idea in one paragraph.** A rule says: "THIS subject gets THIS permission, with THIS scope." Rules are evaluated per request against the user's assignments in the ACTIVE period, so access follows management changes by itself. A few rules are LOCKED and always win (section 4). Nothing here changes PI-CORE.

**How one request is decided (same logic in server code and RLS).**
1. No session, no `members` row with `user_id = auth.uid()`, or `members.is_active = false` -> **No access**. Stop (L1).
2. Find the active period (`periods.is_active = true`). Read `members.access_level` -> System Admin flag (L2).
3. Load my assignments in the active period (`assignments` rows with my `member_id` and that `period_id`).
4. For every ENABLED rule, check if its subject matches me (section 2.2). A match gives (permission, scope).
5. Union all matches (R2). Apply "manage includes view" and "export needs view" (R15).
6. Apply locked limiters to the concrete action: self-approval, closed period, hidden fields (section 4).
7. Allow or deny. Anything not granted is denied.

---

## 2. Building blocks

### 2.1 Permission catalog (stable keys)

Keys are fixed in code and never renamed. The admin chooses from this list; the admin cannot invent keys. 22 keys cover Phase 1 (21 until the 2026-11-07 amendment, which added `borrowing.handle`; migration `20261107100000`, not yet on hosted).

| Key | What it unlocks | Scopes allowed | Sensitive |
|---|---|---|---|
| `finance.view` | See transactions, balances, Finance dashboard card | all | **Yes** |
| `finance.manage` | Create, edit (active period), void transactions. Includes view | all | **Yes** |
| `finance.export` | Export Finance to Excel/CSV/PDF | all | **Yes** |
| `minutes.view` | Read meeting minutes and their attachments | all, own unit | No |
| `minutes.manage` | Create, edit (active period), archive minutes, upload attachments. Includes view | all, own unit | No |
| `minutes.export` | Export minutes | all, own unit | No |
| `letters.view` | Read the letter register (incoming and outgoing) | all | No |
| `letters.manage` | Create/edit incoming and outgoing letters, assign letter numbers, archive. Includes view | all | No |
| `letters.export` | Export the letter register | all | No |
| `letter_requests.view_all` | See everybody's letter requests (own requests are always visible, L9) | all | No |
| `letter_requests.process` | Approve, reject, issue a number for a letter request. Includes view_all. Never own requests (L6) | all | No |
| `inventory.view` | Read the inventory catalog | all | No |
| `inventory.manage` | Create, edit, archive items. Includes view | all | No |
| `inventory.export` | Export inventory | all | No |
| `borrowing.view_all` | See everybody's borrowing requests (own are always visible, L9) | all | No |
| `borrowing.approve` | Approve or reject a request, and extend the end date of an approved or borrowed request. Includes view_all. Never on own requests (L6). Power key (L12) [A-n7 amended 2026-11-07, D-022] | all | No (power key) |
| `borrowing.handle` | **New 2026-11-07 (D-022).** Record the handover (pick-up), record the return (good, damaged or lost, with note and photo for damaged/lost), cancel an approved request that was not picked up (reason required), correct a wrong **return** (reason required, only once per request, refused if the stock changed since the return; there is no correction of a handover), record a request on behalf of an outside party. Includes view_all. NOT limited by L6 (the owner allows recording your own handover and return; the history shows who recorded it). Power key (L12): never to "every active member", written reason required. **`is_sensitive` = false and never baseline (decision A-IB36, taken by the database engineer; the reason is in the header of `20261107100000_nexus_borrowing_access_rules.sql`).** Same treatment as `borrowing.approve`: the protection is the L12 rule (role, position or unit subject and a written reason), not the sensitive-key warning | all | No (power key) |
| `borrowing.export` | Export borrowing | all | No |
| `member_data.view` | See the Member Data list: name, main unit and position (active period), active/inactive, and a "Pembina" marker for lecturers (member type). Never email, phone, NIM, NIP (L4). Also unlocks the Dashboard Members count | all | **Yes** |
| `member_data.export` | Export that same list | all | **Yes** |
| `member_data.view_export_log` | Read the Member Data export log (who exported, when, format, filters). The System Admin always reads it as a fixed right (L3) | all | **Yes** |
| `access_rules.view_log` | Read the access-rule change log (B24) | all | No |

Scope meaning:
- **all** = every record in the module.
- **own unit** = only records whose `org_unit_id` equals the unit of the assignment that matched the rule. Only Meeting Minutes records carry a unit (D-008), so only `minutes.*` accept it. The screen must reject "own unit" on any other key, and on "every active member" rules (no assignment, so no unit).
- A third scope "own unit and its child units" is proposed in B26 [ASSUMPTION]; the default rules do not use it.

Not in the catalog, because they are fixed (section 4): submit and cancel own requests, see own requests, the Dashboard itself (each card follows the matching `*.view` key; Members count follows `member_data.view`), the settings screen and editing rules (System Admin only).

### 2.2 Subject types

A rule has exactly ONE subject. There is no subject type for an individual member (L10).

| # | Subject type | Stored value | Matches a member when... (PI-CORE tables/columns) | Period-based |
|---|---|---|---|---|
| S1 | **PI-CORE role** | `roles.key` (e.g. `bph`, `bendahara`, `sekretaris`, `kepala_departemen`, `kepala_divisi`, `staff`) | The member has an active-period assignment whose `assignments.position_id` appears in `position_roles` with a `role_id` whose `roles.key` equals the stored key. Roles without a key cannot be chosen (B30). Never match by role name. | Yes |
| S2 | **PI-CORE position** | `positions.id` (any unit) | The member has an active-period assignment with that `assignments.position_id`. | Yes |
| S3 | **PI-CORE org unit** | `org_units.id`; optional **position limit** (`positions.id`); optional **include child units** flag [A-B26] | The member has an active-period assignment with `assignments.org_unit_id` = that unit (or, if the flag is on, that unit or any descendant via `org_units.parent_id`). With a position limit, `assignments.position_id` must also equal it. Without a limit, any position counts. | Yes |
| S4 | **Every active member** (baseline) | none | Every member who passes L1. No assignment needed. | No |

Notes:
- Include-child-units is an option on S3 subjects only (default off). Reason: PI-CORE divisions sit under departments; one rule on "Departemen Operasional" can cover Logistik and Akomodasi, and a new division is covered automatically. [A-B26]
- "Own unit" scope on a matching assignment = that assignment's own `org_unit_id` (for example the division, not its parent).
- A person with several matching assignments gets the union (R2); several units add up.
- If a stored role key, position id, or unit id no longer exists, the rule matches nobody (R16) and the screen warns (section 5).
- Lecturers (`member_type = 'lecturer'`) cannot hold assignments, so only S4 rules can reach them [A-B15].

### 2.3 Fixed identities (NOT rules)

| Identity | How it is decided | What it means |
|---|---|---|
| **System Admin** | Active member AND `members.access_level` in (`admin`, `super_admin`), set by hand in PI-CORE (D-007). Not period-based. Positions, role `organization_admin`, and `roles.grants_admin` are ignored. | Always has the settings screen, the rules editor, and the log (L3). Business data only through rules that match the admin as a person (baseline or their own assignments). |
| **No access** | Any of: no session; no member linked to the Auth user; `is_active = false`; unreadable member row. | Sees only a "no access" page. Beats every rule (L1). |
| **Active member (baseline)** | Passes L1. | Gets the fixed own-request rights (L9) plus every S4 rule. Everybody (admin, officers, lecturers) is a baseline member. |

---

## 3. Default rule set

This is the set seeded at setup. It reproduces the revision 1 recommendations (owner accepted them as defaults), with one addition on 2026-11-06: D32, from the owner's answer to B9 (D-019). The admin can disable or add rules afterwards.

**Seeding rule.** Positions and units are looked up BY NAME once, at setup, and stored as IDs (D-009). Roles are stored by key. If a lookup fails (name differs in production, A3), setup must stop and report it; it must not skip silently. After setup nothing matches by name.

Scope is "all" unless stated. Subjects: `role:bph` means S1 with key `bph`, and so on.

| # | Subject | Permission | Scope | Reproduces (rev. 1) |
|---|---|---|---|---|
| D01 | Every active member | `inventory.view` | all | G7: read-only catalog to pick items (B8) |
| D02 | role `bph` | `finance.view` | all | G2 views Finance (B6) |
| D03 | role `bph` | `finance.export` | all | G2 export |
| D04 | role `bph` | `minutes.view` | all | G2 views all minutes |
| D05 | role `bph` | `minutes.export` | all | G2 export |
| D06 | role `bph` | `letters.view` | all | G2 views register |
| D07 | role `bph` | `letters.export` | all | G2 export |
| D08 | role `bph` | `letter_requests.view_all` | all | G2 views all letter requests |
| D09 | role `bph` | `inventory.export` | all | G2 export |
| D10 | role `bph` | `borrowing.view_all` | all | G2 views all borrowing |
| D11 | role `bph` | `borrowing.export` | all | G2 export |
| D12 | role `bph` | `member_data.view` | all | B9 (b): BPH (D32 adds department/bureau heads) |
| D13 | role `bph` | `member_data.export` | all | B9 (b): export stays BPH only |
| D14 | role `bph` | `access_rules.view_log` | all | B24 |
| D15 | position Sekretaris Jenderal | `letters.manage` | all | G3 (D-008) |
| D16 | position Sekretaris Jenderal | `letter_requests.process` | all | G3 |
| D17 | position Sekretaris Jenderal | `minutes.manage` | all | G3 |
| D18 | position Sekretaris Umum 1 | `letters.manage` | all | G3 |
| D19 | position Sekretaris Umum 1 | `letter_requests.process` | all | G3 |
| D20 | position Sekretaris Umum 1 | `minutes.manage` | all | G3 |
| D21 | position Sekretaris Umum 2 | `letters.manage` | all | G3 |
| D22 | position Sekretaris Umum 2 | `letter_requests.process` | all | G3 |
| D23 | position Sekretaris Umum 2 | `minutes.manage` | all | G3 |
| D24 | role `bendahara` | `finance.manage` | all | G4 (B3) |
| D25 | role `bendahara` | `finance.export` | all | G4 export (explicit, so Treasurer keeps export if D03 is disabled) |
| D26 | role `sekretaris` | `minutes.manage` | own unit | G5 (D-008, B17, B22) |
| D27 | role `sekretaris` | `minutes.export` | own unit | G5 export [A-n2] |
| D28 | unit Departemen Operasional, include child units ON, any position | `inventory.manage` | all | G6 (D-009, B4): Operasional + Logistik + Akomodasi |
| D29 | same unit subject as D28 | `inventory.export` | all | G6 export |
| D30 | same unit subject as D28 | `borrowing.approve` | all | **RETIRED 2026-11-07 (D-022).** Was: whole Operations unit approves and marks borrowed/returned. Replaced by D34-D36. Migration `20261107100000` disables this row (kept in the list and the log, A-n8; not edited in place) and lists it in `nexus.retired_default_rules`, so `restore_default_access_rules()` never re-enables it |
| D31 | same unit subject as D28 | `borrowing.export` | all | G6 export |
| D32 | role `kepala_departemen` | `member_data.view` | all | B9 (b), owner 2026-11-06, D-019. Covers Kepala Departemen and Kepala Biro. Sensitive key: the seed needs a written reason (L12). Added by migration `20261106200000_nexus_member_data.sql` |
| D33 | role `bph` | `member_data.view_export_log` | all | D-019 M8, owner 2026-11-06. Sensitive key (L12). Added by migration `20261106200000_nexus_member_data.sql` |
| D34 | unit Departemen Operasional, include child units ON, **position limit: Kepala Departemen** | `borrowing.approve` | all | IB2 (b), owner 2026-11-07, D-022. Only the department head approves, rejects and extends. Power key: written reason (L12). Added by migration `20261107100000_nexus_borrowing_access_rules.sql` |
| D35 | unit Departemen Operasional, include child units ON, **position limit: Kepala Divisi** | `borrowing.approve` | all | IB2 (b), D-022. Kepala Divisi of Logistik and Akomodasi (and of any division added later, because of include-child-units). Written reason (L12). Added by migration `20261107100000_nexus_borrowing_access_rules.sql` |
| D36 | same unit subject as D28 (any position) | `borrowing.handle` | all | IB2 (b), D-022. Every Operations holder (including the heads and Sekretaris Departemen Operasional) records handover and return and outside-party requests. Written reason (L12). Added by migration `20261107100000_nexus_borrowing_access_rules.sql` |

**Row count: 35 enabled + 1 retired** (D30 is retired, so the table has 36 rows counting it): 1 baseline, 14 for `bph`, 9 for the three BPH secretary positions, 2 for `bendahara`, 2 for `sekretaris`, 6 for Operations (D28, D29, D31, D34, D35, D36), 1 for `kepala_departemen`. Before 2026-11-07 the count was 33.

**Position names for D34/D35.** Checked against `docs/picore/schema-report.md` section 8 (2026-11-07): `Kepala Departemen` (unit type `department`, rank 40, unique per unit, role `kepala_departemen`) and `Kepala Divisi` (unit type `division`, rank 60, unique per unit, role `kepala_divisi`) exist in the PI-CORE seed. Positions are tied to a unit TYPE, so `Kepala Divisi` is one position row that can be held in Logistik and in Akomodasi. The schema report does not say whether the two divisions currently have a person in that position (assignments are data, not seed): this must be checked before applying (same read-only check as B31). If the seed lookup by name and unit type finds no row, setup stops and reports (seeding rule above).

Differences from revision 1, for the record:
- Revision 1 listed Operations units one by one (Operasional, Logistik, Akomodasi, no automatic children). D28-D31 use one unit with "include child units", which gives the same result today and also covers a division added later. If the owner prefers exact listing, replace D28-D31 with 12 rows (3 units x 4 permissions).
- 2026-11-07 (D-022): D30 is retired. Approval is now two rows with a position limit (D34 Kepala Departemen, D35 Kepala Divisi), and a new key `borrowing.handle` goes to the whole Operations unit (D36). D28, D29, D31 are unchanged. Reason: only heads decide, but any Operations member can hand items over and take them back.
- "G1 System Admin has no business data", "G7 own requests", and the self-approval block are not rows; they are fixed (sections 2.3 and 4).
- BPH secretary and Operations are no longer special groups; they are just rows D15-D23 and D28-D31, from 2026-11-07 D28, D29, D31 and D34-D36 (D-011, D-022).

---

## 4. Locked rules (never configurable)

Enforced in server code AND RLS, independent of what the rules table contains. **A locked rule always wins over any configured rule.** The rules screen must refuse, or ignore with a visible message, any rule that tries to bend a locked rule.

| # | Locked rule | Source |
|---|---|---|
| L1 | Inactive member, unlinked Auth user, or no session = no access at all. Checked first, on every request, inside every permission helper (a still-valid token is not enough). No rule can grant anything to such a user. | D-011, D3 |
| L2 | System Admin comes ONLY from `members.access_level` in (`admin`, `super_admin`) of an active member. No rule, position, or role can create or remove it. NEXUS never calls `private.is_admin()` and never reads `roles.grants_admin`. | D-007 |
| L3 | A System Admin always has the settings screen, the rules editor, and the change log, whatever the rules say. This prevents locking the system out. | D-011 |
| L4 | Email, phone, NIM, NIP, `must_change_password`, `audit_log`, `org_settings` are never read or returned by NEXUS. Member Data shows only name, unit, position, active/inactive, and a "Pembina" marker for lecturers (member type, D-019). No catalog key can widen this. **Single exception (D-015):** one dedicated `nexus` function may read the CALLER's own `must_change_password` and return it as one boolean; it never answers about another member. | D-010, D-015 |
| L5 | No permanent delete anywhere, including rules (disable instead) and the change log (append-only). Archive or void replaces delete. | CLAUDE.md 6.5 |
| L6 | Nobody approves their own request: letter request processing and borrowing approval are blocked when the processor is the requester (matched on `members.id`). **Amended 2026-11-07 (D-022):** for borrowing, L6 covers ONLY approve, reject and extend (`borrowing.approve`). Recording the handover or return of your own request (`borrowing.handle`) is allowed by the owner; the status history shows who recorded it. For an outside-party request recorded by an Operations member, that member is the requester of record, so L6 blocks them from approving it. | B21 (locked), D-022 |
| L7 | Records of a non-active period are read-only for everyone, except open items (pending letter requests, borrowings not yet returned), which stay actionable by whoever holds `letter_requests.process` / `borrowing.approve` / `borrowing.handle` now (each for its own actions). Finance corrections go into the active period. | A-n6 |
| L8 | Who may read old-period records = whoever currently holds the matching view right (or a right that includes it) in the active period. No special access for former officers. | B20 (locked) |
| L9 | Every active member can submit letter requests and borrowing requests, see the status, number, and processor note of their OWN requests, and cancel their own request before it is processed. **Widened 2026-11-07 (D-022) for borrowing:** the requester may cancel their own request until pick-up, that is while it is Diajukan or Disetujui; after approval a reason is required. Letter requests keep "before it is processed". Not a rule; cannot be disabled. | D-011, D-022 |
| L10 | Rules apply only to roles, positions, org units, or "every active member". Never to an individual member. Rules resolve only against ACTIVE-period assignments. | D-011 |
| L11 | Rules table and change log can be written only by the System Admin through the settings screen. No catalog key lets anyone else edit rules. Log rows can never be edited or deleted, even by the admin. Files stay in private buckets; file access follows the parent record's view right. | D-011, CLAUDE.md 11 |
| L12 | Sensitive and power keys (`finance.*`, `member_data.*`, every `*.manage`, `*.approve`, `*.process`, `*.handle`) can never be granted to the "every active member" subject; granting them to a role, position, or unit requires a non-empty written reason. Enforced in the database. | D-013 (security review W3) |

Order of evaluation: L1 first, then fixed identities, then rules, then locked limiters (L4, L6, L7) on the result.

**Known risk (D-011).** The System Admin can add a rule that grants business access to a position or unit they themselves hold (or to "every active member", which includes the admin). This weakens the D-007 separation. Mitigation: every change is logged with before/after, sensitive grants show a warning, BPH can read the log (B24). Optional extra: B28.

---

## 5. Rules admin screen (behavior, not UI design)

Only the System Admin sees this screen (L3, L11).

| Function | Behavior |
|---|---|
| **List** | Shows every rule: subject (with the current name looked up from PI-CORE), permission key, scope, enabled/disabled, created by/when, last change by/when, optional note. Disabled rules stay in the list. Filter by permission, subject, status, or warning. |
| **Add** | Pick a subject type (role, position, org unit + optional position limit + include-child-units, or every active member), a permission from the catalog, a scope allowed for that permission. Optional note. |
| **Validation on add (blocked)** | Subject missing in PI-CORE; role without a key; permission not in the catalog; scope not allowed for that permission (e.g. own unit on `finance.view`, or on a baseline rule); a duplicate of an existing rule (same subject, permission, scope, flags); any attempt to name an individual member. |
| **Disable / enable** | A switch per rule. Takes effect on the holder's next request. Rules are never deleted (L5). A rule is not edited in place: to change scope or subject, disable it and add a new one, so history stays clean [A-n8]. |
| **Sensitive warning** | Adding or enabling a rule with a sensitive key (`finance.*`, `member_data.*`) shows a warning and needs an explicit confirmation. Extra-strong wording when the subject is "every active member", an org unit, or a position outside BPH. No second approver in Phase 1 (B25). |
| **Stale-ID warning** | A rule whose role key, position id, or unit id no longer exists in PI-CORE, or whose unit is deactivated (`org_units.is_active = false`), is flagged. It grants nothing while stale (R16). |
| **"Nobody can use it" warning** | For `letters.manage`, `finance.manage`, `borrowing.approve` (now only the Operations heads, D34/D35), `borrowing.handle` (D36) (and `letter_requests.process` [A-n9]): warn when NO holder exists in the active period (all matching rules disabled, stale, or their positions are vacant). Computed live, so it can appear after a period switch without any rule edit. Soft hint for `letter_requests.process` and `borrowing.approve` when only ONE holder exists, because that person cannot approve their own request (L6) [A-n9]. Only counts are shown, not names. |
| **Change log** | Every add, disable, enable (and seed or restore-defaults action, B28) writes one row: rule id, action, who (`members.id` + name at that time), when, full rule content BEFORE and AFTER (empty before on add), optional note. Append-only (L11). Readable by the System Admin and by holders of `access_rules.view_log` (B24). BPH can read the log but not the rule editor. |
| **Locked rules** | Shown on the screen as a read-only list ("these always apply") so the admin knows what cannot be changed. |

---

## 6. Rules

| # | Rule |
|---|---|
| R1 | **Active period.** S1-S3 rules are evaluated only against assignments whose `period_id` is the active period. Assignments of other periods grant nothing. S4 (baseline) needs no assignment. |
| R2 | **Combining.** Rights = union of all matching enabled rules. "all" beats "own unit". Scopes from several assignments or units are unioned. **Rules only grant.** There are no deny rules; to remove access, disable the rule. |
| R3 | **Period change and rule change.** When PI-CORE switches the active period (`set_active_period`) or the admin changes a rule, access changes on the next request, with no logout or deploy. Do NOT cache permissions in the JWT, cookies, or long-lived server cache. One helper serves both the app and RLS, so there is one definition. [A-n3] |
| R4 | **History.** Records keep the `period_id` they were created in. See L7 and L8. |
| R5 | **Deactivated member.** `is_active = false` = No access on the next request even with a valid token (L1). Their records stay, and their name still shows on them. |
| R6 | **Lecturers.** They hold no assignments, so only S4 rules can reach them [A-B15]. |
| R7 | **System Admin is never implied by position** (L2). Being System Admin gives the settings screen, the rules editor, the log, and baseline rights. If the admin is also a position holder or a baseline member, rules apply to them like to anyone else. Being Chairperson never makes someone admin. |
| R8 | **IDs and keys, not names.** Subjects are stored as role key, position id, or unit id. Renaming a position or unit in PI-CORE changes nothing. Every rule change is logged (section 5). |
| R9 | **Sensitive data.** Finance and Member Data are sensitive keys: warning on grant. Member Data never has email, phone, NIM, NIP (L4). Private storage, short-lived signed URLs; file access follows the parent record's view right (e.g. a minute attachment follows `minutes.view`). |
| R10 | **Enforcement.** Every rule and every locked rule is enforced in RLS on every `nexus` table (default deny, explicit policies) and again in server actions. The UI only hides things for convenience. A direct API call with a valid token must give the same result as the UI. Locked rules must hold even if the rules table is empty, edited by hand in the database, or full of wrong rules. |
| R11 | **No active period.** S1-S3 rules match nothing. Baseline rules and the admin screen still work. Nobody can create period-based records (finance, minutes, letters, requests, borrowing). The app shows a banner. [A-n4] |
| R12 | **Scope of "own".** "Own requests" and "own unit" are matched on stable ids (`members.id`, `org_unit_id`), never `user_id` or email. |
| R13 | **One rule, one grant.** A rule grants exactly one permission to exactly one subject. Bundles ("act as Treasurer") are not a feature; the default set simply contains several rows. |
| R14 | **Locked wins.** See section 4: a configured rule can never override a locked rule. |
| R15 | **Implications.** `*.manage` includes `*.view` of the same scope. `letter_requests.process` includes `letter_requests.view_all`. `borrowing.approve` and `borrowing.handle` each include `borrowing.view_all` (neither includes the other). An export key works only where the user can also view the same data (export never exceeds view). Nothing else is implied. [A-B27] |
| R16 | **Stale or disabled rules grant nothing.** A rule pointing to a missing role key, position, or unit never matches and never falls back to a name. |

---

## 7. Data needed

### 7.1 Read from PI-CORE (only through `nexus` SECURITY DEFINER functions, called only from `src/lib/picore/`, D-010)

| PI-CORE table | Fields NEXUS may read | Why |
|---|---|---|
| `members` | `id`, `user_id`, `full_name`, `is_active`, `access_level`, `member_type` | Caller identity, L1, L2, lecturers, names on records and in the log, Member Data |
| `assignments` | `member_id`, `org_unit_id`, `position_id`, `period_id` | Matching S1-S3 |
| `periods` | `id`, `label`, `is_active` | Active period, period labels |
| `position_roles` | `position_id`, `role_id` | Role of a position (S1) |
| `roles` | `id`, `key`, `name` | Role picker, S1 matching by key |
| `positions` | `id`, `name`, `rank`, `unit_type` | Position picker, stale check, Member Data display |
| `org_units` | `id`, `parent_id`, `type`, `name`, `is_active` | Unit picker, child-unit logic, stale check, minutes unit picker |

Never read or return: `email`, `phone`, `nim`, `nip`, `must_change_password` (sole exception: the caller-only function of D-015), `audit_log`, `org_settings`, `deactivated_at`. Never call `private.*` (D-010).

Functions answer in this shape (design level): "who am I" = member id, System Admin flag, active-period id, and the list of effective permissions, each with scope "all" or a list of unit IDs. Plus a few lookups limited by the caller's rights (names for display, Member Data list for those allowed, picker lists for the admin).

### 7.2 Stored by NEXUS (schema `nexus`)

| Item | Content |
|---|---|
| **Access rules** (replaces the D-009 mapping table) | Per rule: subject type; subject value (role key, position id, or unit id; none for baseline); optional position limit; include-child-units flag; permission key; scope; enabled flag; note; created by/at; updated by/at. Only the System Admin can write. Read by the permission helper. |
| **Access rule change log** | Per entry: rule id, action, actor `members.id`, actor name snapshot, timestamp, before (rule content), after (rule content), note. Append-only. Read by the System Admin and `access_rules.view_log` holders. PI-CORE's audit trigger does not cover NEXUS tables, so NEXUS keeps this log itself. |
| **Default rule seed** | Section 3, written once at setup. |
| **On every record** | `members.id` of the creator (and the subject for requests), `period_id`, created/updated timestamps. Foreign keys to PI-CORE tables are the database engineer's call; recommendation: plain id values without FK, so NEXUS can never block a PI-CORE change. |
| **Member Data export log** | Append-only: exporter `members.id`, time, format, filters used (unit id, status, search used yes/no), active period id. No PII, no search text, no exported rows. No update, no delete. Readers: System Admin + BPH through key `member_data.view_export_log` (rule D33, owner 2026-11-06). Details: that spec, section 4.2 (D-019). |
| **Meeting minutes** | Also `org_unit_id` (needed for "own unit" scope, D-008). |
| **Letters, requests, borrowing, finance** | `period_id`. Inventory items are not tied to a period [A-n5]. |

---

## 8. Edge cases

| # | Case | Expected behavior |
|---|---|---|
| E1 | User holds Treasurer and Department Secretary assignments (P-BEND-SEK) | Union of D02-D14 (via `bph`), D24-D25, D26-D27. Finance full, minutes of all units viewable, minutes edit only in the secretary's unit. Letter processing stays denied. |
| E2 | Operations staff who is also BPH secretary (P-OPS-BPH) | Union of D28, D29, D31, D36 (via Logistik), D02-D14 and D15-D23 (Sekum 2 carries `bph`). Manages inventory, records handover and return, all letters and minutes, views everything. Does not approve borrowing (Staff is not a head). |
| E3 | A position or unit referenced by a rule is deleted in PI-CORE and recreated (new id) | The old rule matches nobody and grants nothing (R16). Screen flags it as stale. The admin adds a new rule for the new id and disables the stale one. A stale rule for letters/finance/borrowing triggers the "nobody can use it" warning if no other rule covers it. |
| E4 | No active period | See R11. Officers lose rule-based access (S1-S3) until a period is activated, including reading existing records. Baseline rules (D01) and the admin screen still work. [A-n4] |
| E5 | Member deactivated mid-session | Next request = No access (L1). Open pages fail with a "no access" message. Their records remain. |
| E6 | Officer from a previous period tries to edit old data | No assignment now = baseline only = denied. Current officer = record is read-only (L7); correction goes in the active period. |
| E7 | Regular member with no assignment | Baseline: own requests, inventory catalog (D01), Dashboard cards they may open. Nothing else unless the admin adds a baseline rule. |
| E8 | Period switches while a borrowing is "borrowed" or a letter request is pending | Open items stay actionable by the current `borrowing.approve` (approve, reject, extend) / `borrowing.handle` (handover, return) / `letter_requests.process` holders (L7). Other edits stay blocked. |
| E9 | Person holds the same rule-matching position in two units (two `sekretaris` assignments) | "Own unit" scope = both units (R2). |
| E10 | Position holder replaced mid-period | Old holder loses access on their next request; successor gets it as soon as PI-CORE records the assignment. Rules are not touched. |
| E11 | Auth user not linked to a member, or member deactivated | No access (L1). One combined message for both cases (D-016): "Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA." |
| E12 | Lecturer logs in | Baseline only (R6) [A-B15]. |
| E13 | System Admin's `access_level` is lowered while on the rules screen | Next request is denied (R3). |
| E14 | Requester is also the processor | Blocked by L6 even if a rule grants the permission (approve, reject and extend only for borrowing; recording your own handover or return is allowed, D-022). If only one holder exists, a second holder is needed (PI-CORE can add an assignment). For borrowing the approvers are now only the Operations heads (at most three by default: Kepala Departemen, Kepala Divisi Logistik, Kepala Divisi Akomodasi), so a head's own request needs another head. |
| E15 | No active-period holder for `letters.manage`, `finance.manage`, `borrowing.approve` or `borrowing.handle` (vacant position or all rules disabled) | That module cannot be managed. The admin cannot manage it either (L2, R7). The admin sees the "nobody can use it" warning and can add or enable a rule that covers a position that IS filled. |
| E16 | Admin disables all rules or the rules table is empty | Baseline-only world: only L9 own requests remain, plus the locked admin screen (L3). No lock-out. Section 3 can re-seed; see B28. |
| E17 | Two rules overlap (e.g. `role:bph` and a position rule give the same permission) | Fine, union (R2). Disabling one does not remove access granted by the other. The screen should show this when a rule is disabled but the user still has access through another rule [A-n10]. |
| E18 | Admin is also an officer (e.g. `super_admin` who is Bendahara) | Gets rule-based rights for their position like anyone, in addition to admin rights. Self-benefiting rule changes: see known risk (section 4) and B28. |
| E19 | A new division is created under Departemen Operasional | Covered at once by D28, D29, D31, D34, D35 and D36 because of include-child-units [A-B26]: its Kepala Divisi can approve and every holder in it can handle. If the flag is off, it is not covered. |
| E20 | Rule with a sensitive key given to "every active member" | Rejected by the database (L12, D-013). The screen explains that sensitive and power keys need a role, position, or unit subject and a written reason. |
| E21 | Unit deactivated in PI-CORE (`is_active = false`) but old assignments exist | Matching continues from assignments as PI-CORE reports them [A-n11]; the screen warns. |
| E22 | Rule changed while a user has a page open | Their next request uses the new rules; an open page fails on its next action with a clear message. |

---

## 9. Acceptance criteria

All ACs assume the default rule set (section 3) unless stated. Test personas use the seed units and positions from the schema report (names subject to A3).

| Persona | Setup |
|---|---|
| P-ADMIN | `access_level = 'admin'`, active, no assignments |
| P-SUPER | `access_level = 'super_admin'`, active |
| P-ADMIN-BEND | `access_level = 'admin'` + Bendahara Umum 1 |
| P-KETUM | Ketua Umum, `access_level = 'member'` |
| P-SEKJEN | Sekretaris Jenderal |
| P-BEND | Bendahara Umum 1 |
| P-SEKDEP | Sekretaris Departemen in Departemen Internal |
| P-KADEP-OPS | Kepala Departemen in Departemen Operasional |
| P-STAFF-LOG | Staff in Logistik |
| P-STAFF-PUB | Staff in Pubdok (not Operations) |
| P-PLAIN | active member, no assignments |
| P-BEND-SEK | Bendahara Umum 2 + Sekretaris Departemen in Departemen Internal |
| P-OPS-BPH | Staff in Logistik + Sekretaris Umum 2 |
| P-OLD | Sekretaris Jenderal in the previous period only |
| P-INACTIVE | `is_active = false` |
| P-LECT | `member_type = 'lecturer'`, `access_level = 'member'` |
| P-UNLINKED | Auth user with no matching `members.user_id` |

**System Admin**
- AC-01 P-KETUM (`access_level = 'member'`) cannot open NEXUS settings, and a direct read or write of the access-rules table or log with their token is rejected, except that a holder of `access_rules.view_log` can read the log (see AC-60).
- AC-02 P-ADMIN and P-SUPER can view, add, and disable rules on the settings screen.
- AC-03 P-ADMIN (no assignments) cannot read any finance transaction, minute, letter register row, or Member Data list via UI or API (default rules).
- AC-04 A Kepala Departemen with `access_level = 'member'` is not System Admin although PI-CORE `private.is_admin()` returns true for them.
- AC-05 After PI-CORE changes P-ADMIN's `access_level` to `member`, their next request to settings is denied.

**BPH (rules D02-D14)**
- AC-06 P-KETUM can view Finance, all meeting minutes of every unit, the letter register, all letter requests, inventory, all borrowing requests, and Member Data.
- AC-07 P-KETUM cannot create or edit a finance transaction, a minute, a letter, an inventory item, and cannot approve a borrowing request.
- AC-08 P-KETUM can export what they can view and cannot see or export email, phone, NIM, or NIP.

**BPH secretaries (rules D15-D23)**
- AC-09 P-SEKJEN can create, edit, number, and archive incoming and outgoing letters and can approve or reject a letter request submitted by another member.
- AC-10 P-SEKJEN can create and edit meeting minutes for any org unit, including the BPH unit.
- AC-11 P-SEKJEN cannot create a finance transaction or approve a borrowing request.
- AC-12 P-SEKJEN cannot approve a letter request that P-SEKJEN submitted.
- AC-13 If the rule for a position exists and is enabled, any active-period holder of that position gets its permission; if the rule is disabled, the holder loses it on the next request.

**Treasurer (rules D24-D25)**
- AC-14 P-BEND can create, edit, void, and export finance transactions of the active period.
- AC-15 P-BEND cannot edit a transaction whose `period_id` is not the active period.
- AC-16 P-BEND cannot create or edit meeting minutes or letters, and cannot approve borrowing requests.

**Department/Bureau Secretary (rules D26-D27)**
- AC-17 P-SEKDEP can create and edit meeting minutes for Departemen Internal and cannot create or edit minutes for another unit, via UI or direct API call.
- AC-18 P-SEKDEP cannot see minutes of Departemen Eksternal (own unit only).
- AC-19 P-SEKDEP cannot view the letter register, assign a number, or process a letter request, but can submit a letter request and see its status.
- AC-20 P-SEKDEP cannot view Finance or Member Data.
- AC-21 A user with Sekretaris Departemen in two units can edit minutes of both and of no other unit.

**Operations (rules D28, D29, D31, D34-D36; D30 retired)**
- AC-22 (amended 2026-11-07, D-022) P-STAFF-LOG, P-KADEP-OPS, a Staff in Akomodasi and a Sekretaris Departemen in Operasional can create, edit, and archive inventory items, record handover and return, and record an outside-party request (D28, D36). Only P-KADEP-OPS and a Kepala Divisi in Logistik or Akomodasi can approve, reject or extend borrowing requests of others (D34, D35); P-STAFF-LOG (Staff) cannot approve, reject or extend.
- AC-23 P-STAFF-PUB (not in the unit) cannot create or edit inventory items and cannot approve borrowing requests.
- AC-24 (amended) P-KADEP-OPS and a Kepala Divisi cannot approve, reject or extend their own borrowing request (L6); P-STAFF-LOG CAN record handover and return of their own request (D-022).
- AC-25 If rules D28, D29, D31 or D34-D36 are disabled, the affected holders lose the matching permission on their next request.
- AC-26 P-STAFF-LOG cannot view Finance, the letter register, or minutes.

**Regular member (baseline D01 and L9)**
- AC-27 P-PLAIN can submit a letter request and a borrowing request and can read only their own requests; another member's request is not returned by the API.
- AC-28 P-PLAIN can read the inventory catalog and cannot edit it.
- AC-29 P-PLAIN cannot read Finance, meeting minutes, the letter register, Member Data, the rules table, or the log (UI hides them and a direct API call returns nothing or an error).
- AC-30 P-PLAIN can cancel their own request before it is processed and cannot cancel another member's request.
- AC-31 P-PLAIN's Dashboard shows no card for a module they cannot view.

**No access (L1)**
- AC-32 P-INACTIVE cannot reach any NEXUS page or data; every API call returns no data or an error.
- AC-33 P-UNLINKED (and a deactivated member) sees the combined "account not usable in NEXUS" page (D-016) and no data.
- AC-34 A request with no session is redirected to login and every direct API call is rejected.

**Combining**
- AC-35 P-BEND-SEK can edit finance, edit minutes of Departemen Internal, view minutes of every unit, and cannot edit minutes of another unit.
- AC-36 (amended) P-OPS-BPH (Staff in Logistik + Sekretaris Umum 2) can record handover and return (D36), process letter requests, and view all modules; they cannot approve borrowing (Staff is not a head).
- AC-37 Removing one of two assignments removes only that assignment's rights on the next request.

**Period change**
- AC-38 After the active period switches, a user whose only assignment belongs to the old period has only baseline rights on their next request, with no logout or deploy.
- AC-39 After the switch, a user who is Bendahara Umum 1 in the new period can create finance transactions on their first request.
- AC-40 P-OLD cannot view Finance, minutes, or the letter register after the switch.
- AC-41 After the switch, a current treasurer can read finance transactions of the previous period but cannot edit or void them (L7, L8).
- AC-42 A letter request still pending after the switch can be processed by a current `letter_requests.process` holder, and a borrowing still "borrowed" can be marked returned by a current `borrowing.handle` holder (L7; approving or extending needs a current `borrowing.approve` holder).
- AC-43 With no active period, officers get baseline rights only and creating a period-based record is rejected with a clear message. P-ADMIN can still open settings.

**Deactivation**
- AC-44 After P-PLAIN or P-KETUM is deactivated in PI-CORE, their next NEXUS request fails even though their Auth token has not expired.
- AC-45 Records created by a deactivated member remain visible to users who have view rights, and their name still appears on them.
- AC-46 P-LECT gets only baseline rights; no rule that targets a role, position, or unit applies to them [A-B15].

**Sensitive data and enforcement**
- AC-47 No NEXUS function or API response contains `email`, `phone`, `nim`, or `nip` of any member.
- AC-48 A signed file URL for a minute attachment is not returned to a user who cannot view that minute, and expires within a short time.
- AC-49 NEXUS code never calls a PI-CORE `private.*` function and never reads `roles.grants_admin`.
- AC-50 Every table in schema `nexus` has RLS enabled and a test proves that a user with no policy match reads zero rows.
- AC-51 No NEXUS screen or API offers permanent delete of a record, a rule, or a log entry.

**Configurable rules (new)**
- AC-52 When P-ADMIN adds an enabled rule (e.g. position Staff in unit Pubdok gets `inventory.manage`), P-STAFF-PUB can use that permission on their next request, with no logout or deploy.
- AC-53 When P-ADMIN disables that rule, P-STAFF-PUB loses the permission on the next request; enabling it again restores it. The rule stays in the list after disabling.
- AC-54 A rule that points to a deleted or unknown position, unit, or role key grants nothing to anyone, and the rules screen shows a stale-ID warning on that rule.
- AC-55 No configured rule can give access to an inactive or unlinked member: with the baseline rule D01 (`inventory.view` for every active member) and a rule granting `finance.view` to role `staff` (with a written reason), P-INACTIVE and P-UNLINKED still get nothing.
- AC-56 No configured rule can expose email, phone, NIM, or NIP: with `member_data.view` and `member_data.export` granted to role `staff` (with a written reason), responses and exports still contain none of these fields.
- AC-57 No configured rule can enable self-approval: with `borrowing.approve` and `letter_requests.process` granted to role `staff` (with a written reason), a user still cannot approve, reject or extend their own request. (`borrowing.handle` is deliberately not self-blocked, D-022.)
- AC-58 No configured rule can make a closed-period record editable: a rule granting `finance.manage` does not let anyone edit a transaction of a non-active period.
- AC-59 Every rule add, disable, and enable creates a log entry with who, when, and the full rule before and after; log entries cannot be edited or deleted, even by P-ADMIN.
- AC-60 P-KETUM (BPH) can read the change log and cannot add, disable, or enable a rule. P-PLAIN cannot read the log.
- AC-61 There is no way to create a rule for an individual member: the API rejects a rule whose subject is a member id or email, and the screen offers only role, position, org unit, and every active member.
- AC-62 The screen rejects scope "own unit" on any permission that does not allow it (e.g. `finance.view`) and on a baseline rule.
- AC-63 Adding or enabling a rule with a sensitive key (`finance.*`, `member_data.*`) shows a warning and requires confirmation before it is saved.
- AC-64 If no active-period holder has `letters.manage`, `finance.manage`, `borrowing.approve` or `borrowing.handle`, the screen shows a warning, and the warning appears after a period switch even if no rule was edited.
- AC-65 A duplicate rule (same subject, permission, scope, and flags) is rejected.
- AC-66 An org-unit rule with include-child-units covers an assignment in a division of that unit; the same rule with the flag off does not [A-B26].
- AC-67 A rule with "own unit" scope gives access only to records of the unit of the matching assignment.
- AC-68 P-ADMIN-BEND receives Finance rights through their Treasurer position while P-ADMIN (no assignments) does not; being admin alone adds no business rights.
- AC-69 If every rule is disabled, P-ADMIN can still open the rules screen and the log (L3), and members still have own-request rights (L9).
- AC-70 (D32, D-019) P-KADEP-OPS and a Kepala Biro can open the Member Data list and see the Dashboard Members count, and cannot export it; P-SEKDEP and P-STAFF-LOG cannot see Member Data.
- AC-71 (D-019) With rules D12 and D32 both disabled, no BPH member or department head can open Member Data. Granting `member_data.view` to "every active member" is rejected (L12). Full Member Data criteria: `docs/modules/member-data.md` section 9.
- AC-72 (D-022) Granting `borrowing.handle` or `borrowing.approve` to "every active member", or to any subject without a written reason, is rejected by the database (L12).
- AC-73 (D-022) With rules D34 and D35 enabled, only holders of Kepala Departemen in Departemen Operasional and Kepala Divisi in Logistik or Akomodasi hold `borrowing.approve`; a Staff, Sekretaris Departemen Operasional, and any member outside the unit do not.
- AC-74 (D-022) With rule D36 enabled, every active-period holder of any position in Departemen Operasional, Logistik or Akomodasi holds `borrowing.handle`; a Staff in Pubdok does not.
- AC-75 (D-022) A holder of `borrowing.handle` can record the handover and return of their own request, and the history row names them; no configured rule can make `borrowing.approve` skip L6.
- AC-76 (D-022) A requester can cancel their own borrowing request while it is Diajukan or Disetujui (reason required after approval) and not after pick-up; another member cannot cancel it.
- AC-77 (D-022) The permission catalog contains exactly 22 keys, and the default rule set has 35 enabled rows plus 1 retired row (D30, disabled and listed in `nexus.retired_default_rules`; "restore defaults" never re-enables it). `borrowing.handle` is not sensitive and not baseline. Full Inventory and Borrowing criteria: `docs/modules/inventory-borrowing.md` section 11.

---

## 10. Open questions

Status key: **default chosen, configurable (D-011)** = the answer is only the starting rule set, the admin may change it. **locked** = not configurable. **[ASSUMPTION]** = needs owner confirmation.

| Id | Question | Options | Recommendation / status |
|---|---|---|---|
| B3 | Is Treasurer only Bendahara Umum 1/2 (role `bendahara`)? | (a) Yes. (b) Also another position later. | (a). **Default chosen, configurable (D-011)**: rules D24-D25. |
| B4 | Which positions inside the Operations units manage inventory and borrowing? | (a) Every assignment in the units. (b) Only Kepala, Kepala Divisi, Staff. (c) (b) plus Sekretaris Departemen. | **[ANSWERED 2026-11-07, D-022, with IB2 (b)]** Manage inventory, record handover/return (`borrowing.handle`), export: every assignment in the Operations units (D28, D29, D31, D36). Approve, reject, extend (`borrowing.approve`): only Kepala Departemen and Kepala Divisi (D34, D35). Configurable (D-011). |
| B6 | Does "BPH views all modules" include Finance for all six BPH positions? | (a) Yes. (b) Finance only Ketua Umum + Treasurer. (c) Everything except Finance. | (a). **Default chosen, configurable (D-011)**: D02-D03. Sensitive, flagged to the owner. |
| B7 | Is a committee (panitia) member a separate group? | (a) No, regular member. (b) Add a committee list. | (a). **Default chosen, configurable (D-011)**: PI-CORE has no committee role; only baseline rules can reach them. |
| B8 | What does a regular member see? | (a) Own requests + read-only catalog + Dashboard without business cards. (b) No catalog. (c) Own requests only. | (a). **Default chosen, configurable (D-011)**: D01 is the only baseline rule; own requests are locked (L9). |
| B9 | Who may see Member Data? | (a) BPH only. (b) BPH + department/bureau heads (role `kepala_departemen`). (c) All active members: **blocked by locked rule L12 (D-013)**, not possible. Fields always name, unit, position, status (+ "Pembina" marker). | **[ANSWERED 2026-11-06: (b), D-019]** View: BPH (D12) + `kepala_departemen` (D32). Export: BPH only (D13). Configurable (D-011). |
| B15 | What can a lecturer (pembina) do? | (a) Baseline only. (b) Baseline plus read-only oversight. (c) No access. | (a). Lecturers hold no assignments, so only baseline rules can reach them. If the owner wants pembina oversight, add a baseline rule (which would then apply to all members) or give the pembina `access_level` admin (settings only). Ask the owner whether pembina should oversee. |
| B17 | May department/bureau secretaries read letters or minutes of other units? | (a) Own unit's minutes only; no register. (b) Also the register. (c) Also all minutes. | (a). **Default chosen, configurable (D-011)**: D26-D27. |
| B18 | Should System Admin see business data? | (a) No. (b) Member Data only. (c) All like BPH. | (a). **Default chosen, configurable (D-011)** in the sense that the admin can add rules, with the known risk in section 4. |
| B19 | May members of a unit read their own unit's minutes? | (a) No, only the secretary and BPH. (b) Unit head, read-only. (c) Every unit member, read-only. | (a). **Default chosen, configurable (D-011)**: (c) = one unit rule with `minutes.view`, scope own unit. |
| B20 | Who may read records of previous periods? | (a) Current view-right holders. (b) Only the active period. (c) (a) plus former officers. | (a). **Locked (L8).** |
| B21 | May a processor approve their own request? | (a) Blocked. (b) Allowed. (c) Allowed but flagged. | (a). **Locked (L6).** |
| B22 | Does a department secretary's scope include child divisions? | (a) Own unit only. (b) Unit and divisions. | (a). **Default chosen, configurable (D-011)**, but only if B26 adds a child-unit scope. |
| B23 | May a requester download the issued letter file from their own request? | (a) Status and number only. (b) Also the final file. | (b), follows the own-record rule (L9). **Default chosen, configurable (D-011)** only as far as L9 allows; today it is part of L9. |
| B24 | Who may read the rule change log? | (a) System Admin + BPH. (b) Admin only. (c) Admin + BPH + all officers. | (a) [ASSUMPTION], implemented as D14 (`access_rules.view_log` to role `bph`). BPH sees the log (which includes full rule content) but not the editor. |
| B25 | Should a sensitive rule change need a second person's approval? | (a) No: warning + log only. (b) Another admin or a BPH member confirms. | (a) for Phase 1 [ASSUMPTION]. Revisit if abuse appears. |
| B26 | **New.** How do child units (divisions) work in rules? | (a) Include-child-units flag on unit subjects only; "own unit" scope is exactly one unit (B22 not configurable). (b) The flag plus a third scope value "own unit and its child units". (c) One shared flag for subject and scope. | (b) [ASSUMPTION used in this spec]. It keeps two clear ideas (who matches, which records) and makes B22 configurable. D-011 lists only two scopes, so (b) adds one value; owner to confirm. |
| B27 | **New.** Do `manage` keys include `view`, and must export be granted separately? | (a) manage includes view; export works only where view exists. (b) Every key is independent; admin grants view and manage separately. | (a) [ASSUMPTION used in R15]. Fewer rows, fewer mistakes (a manager who cannot view is a bug). |
| B28 | **New.** (1) Should there be a "restore missing defaults" action? (2) How are rule changes that benefit the admin's own positions treated? | (1)(a) Yes, re-adds missing default rows only, never deletes custom rules, logged. (b) No, re-seed via migration only. (2)(a) Allowed, only logged. (b) Allowed but marked "self-benefit" in the log so BPH sees it. (c) Blocked. | (1)(a). (2)(b): it reduces the D-007 weakening without blocking real cases like a pembina who is also an officer. |
| B29 | **New.** What if the only holder(s) of an approval permission would approve their own request (one person holds `borrowing.approve`)? | (a) Locked: wait for a second holder; screen shows a hint. (b) Allow the admin to approve as emergency override, logged. | (a), same as B21. The hint is in section 5 [A-n9]. 2026-11-07: this matters more now, because `borrowing.approve` is held only by the Operations heads (D34, D35), at most three people by default. If only one head is in office, their own request waits; the admin can add a rule for another position (logged, with a written reason). |
| B30 | **New.** PI-CORE roles without a `key` cannot be targeted by role rules. Allow custom roles? | (a) No; ask the PI-CORE admin to give the role a key, or use a position/unit rule. (b) Allow selecting by role id. | (a), as in D-011 (role by `roles.key`). |

---

## 11. Assumption register and document notes

| Id | Assumption |
|---|---|
| A-n1 | The Dashboard is visible to every active member; each card follows the view key of its module. The "Members" count follows `member_data.view`. |
| A-n2 | Export never exceeds view. Export keys are granted separately per module (Excel/CSV/PDF per C11). |
| A-n3 | Permissions are computed per request and never cached. If too slow on the free tier, a cache of at most 60 seconds may be proposed later. |
| A-n4 | With no active period, S1-S3 rules match nothing and period-based records cannot be created. |
| A-n5 | Inventory items are not period-scoped; finance, minutes, letters, requests, and borrowings are. |
| A-n6 | Closing rule for non-active-period records (L7). |
| A-n7 | **Superseded 2026-11-07 (D-022).** Was: `borrowing.approve` covers approve/reject AND marking borrowed/returned. Now two keys: `borrowing.approve` = approve, reject, extend (heads, L6 applies); `borrowing.handle` = handover, return, cancel-before-pick-up on behalf, one correction of a wrong return, outside-party requests (every Operations holder, L6 does not apply). |
| A-n8 | A rule is not edited in place; change = disable + add new. Keeps the log simple. |
| A-n9 | "Nobody can use it" warning also covers `letter_requests.process`; a soft hint appears when only one holder of an approval key exists. |
| A-n10 | When a rule is disabled but a user still has the permission through another rule, the screen says so (informational). |
| A-n11 | Assignments in a deactivated unit still count as PI-CORE reports them; the screen only warns. |

**Conflicts and inconsistencies found (documents not changed here):**

1. `CLAUDE.md` section 6 and `docs/PMK-NEXUS-context.md` section 4 describe a FIXED access table. Per D-011 they are now the default rules. `CLAUDE.md` is the owner's file and is untouched; the context doc section 4 already says "default".
2. D-011 gives two scopes ("all", "own unit"), but making B22 configurable needs a child-unit scope. Raised as B26.
3. D-011 says the System Admin can edit all rules, while D-007 and the context doc keep admin separate from business data. The known risk is documented in section 4 and B28.
4. D-009 described the Operations mapping as units listed by ID, "with its divisions". This spec expresses it as one unit subject with include-child-units (B26). Equal today, different when a new division is added.
5. `docs/OPEN_QUESTIONS.md` B8 defines a regular member as an active member WITHOUT an assignment. This spec treats every active member as baseline (also those with assignments). **Resolved 2026-11-05:** B8 aligned.
6. `docs/PMK-NEXUS-context.md` section 8, item 11 ("Who is the Secretary?") is still open although D-008 and B2 answered it. **Resolved 2026-11-05:** item marked answered.
7. Context section 4 says "Operations Department Head and staff" and lists "Sekretaris Departemen?" for Operations, overlapping the `sekretaris` rules. **Resolved 2026-11-07 (B4, D-022):** every position in the Operations units manages inventory and handles loans (so Sekretaris Departemen Operasional is included); only the two head positions approve. Note that rule D26 (role `sekretaris`, minutes of their own unit) still applies to that person separately.
8. Context section 5.1 puts a member count on the Dashboard for everyone, while B9 restricts Member Data. This spec shows the count only to `member_data.view` holders (A-n1).
9. Context section 4 lists "Committee (panitia)" as an access row, but PI-CORE has no such role; committee people are baseline members (B7).
10. `docs/OPEN_QUESTIONS.md` B-bis says B15 can be widened "only if a rule can target them". Confirmed here: only baseline rules can reach lecturers.
