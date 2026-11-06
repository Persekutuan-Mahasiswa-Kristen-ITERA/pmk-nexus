# src/modules/member-data (Data Anggota)

Read-only member directory over PI-CORE, plus export (Excel, CSV, PDF) and the export log.
Spec: `docs/modules/member-data.md` (rev. 2). Decisions: D-010, D-019, D-020. Database: `supabase/README.md` section 3.

## Layout

| Path | Runs on | What |
|---|---|---|
| `types.ts` | both | **The contract** with the UI: input schemas (zod), row/page/option/log types, error union, `formatMemberUnit()`, `memberDataCapabilities()`. Change only via the tech lead |
| `server/access.ts` | server | `requireMemberData(capability)`: session check (`getAccessState()`) + permission, then the user's Supabase client |
| `server/queries.ts` | server | `listMembers`, `getMemberUnitOptions`, `getActiveMemberCount`, `listMemberExportLog` |
| `server/params.ts` | server | `parseMemberListSearchParams()`: safe reading of the page address (`q`, `unit`, `status`, `page`) |
| `server/export.ts` | server | `handleMemberDataExport()`: the whole POST export (same-origin, permission, body, one DB call, file) |
| `server/export-file.ts` | server | `buildMemberExportFile()`: rows -> file bytes, name and content type |
| `ui/` | both | Screens and components (frontend engineer) |

The database calls live in `src/lib/picore/member-data.ts` (the only place allowed to call the Member Data RPCs). The file writers live in `src/lib/export/` (shared by future modules).

## Entry points and their checks

Every entry point checks the session and the permission itself, then the database function checks again (defense in depth). Nothing is cached across requests, so access follows the active period (R3).

| Entry point | Needs | Notes |
|---|---|---|
| `listMembers(input)` | `member_data.view` | Page size default 20, max 50. A page past the end returns the last page |
| `getMemberUnitOptions()` | `member_data.view` | Active bph/department/bureau units in PI-CORE order |
| `getActiveMemberCount()` | `member_data.view` | Dashboard "Members" (M5b) |
| `listMemberExportLog(input)` | System Admin or `member_data.view_export_log` | Newest first, max 50 per page |
| `POST /api/member-data/export` | `member_data.export` (+ view) | Form fields `q`, `unit`, `status`, `format`. Other methods: 405. Cross-site: 403 |

All return `MemberDataResult<T>` and never throw. Error codes: `unauthenticated` (401), `forbidden` (403), `invalid_input` + field (400), `unavailable` (503). The UI owns the Indonesian wording.

## Export

1. Same-origin check (Origin must match the request host; `Sec-Fetch-Site` must be `same-origin` when sent).
2. Session + `member_data.export`.
3. Strict body validation (a bad value is refused, not replaced, so the file always matches the screen).
4. ONE call to `nexus.member_data_export` (writes the export-log row in the same transaction; if the log fails, no rows come back and no file is sent).
5. File built in memory, sent with `Content-Disposition: attachment`, `Cache-Control: no-store`. Name `data-anggota-YYYY-MM-DD.<ext>` (Asia/Jakarta). Nothing is stored.

Columns: No, Nama Lengkap, Pembina (Ya / empty), Unit (division shown as "Departemen · Divisi"), Jabatan, Status (Aktif / Nonaktif). Missing unit/position = "-". XLSX and PDF start with the title, the period label and the export time; CSV is the plain table.

Safety: CSV cells starting with `= + - @`, tab or CR get a leading `'` (formula injection). XLSX text cells are always written as text (shared strings), never as formulas, so no prefix is needed there. PDF embeds Plus Jakarta Sans (OFL) so Latin, Latin Extended and Vietnamese names render.

### How to add a format

1. Add the value to `memberExportFormatSchema` in `types.ts` (contract change: tell the tech lead) AND to the database check in `nexus.member_data_export` and `nexus.member_data_export_logs.format` (database engineer: new migration).
2. Add a writer in `src/lib/export/` if none fits (keep it pure; no new library without the owner's OK, D-020).
3. Add the content type and a `case` in `buildMemberExportFile()` (`server/export-file.ts`). TypeScript fails until every format has a case.
