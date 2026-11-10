# src/lib/picore

THE ONLY place in NEXUS that reads PI-CORE data (members, roles, positions, periods, assignments). No other file may query PI-CORE tables, views, or functions directly. Why: when PI-CORE publishes its official Integrations API, only this folder needs to change. Rules: read through PI-CORE views or functions only, never write to PI-CORE, and never assume its schema (check the PI-CORE migrations first).

This includes the `nexus` RPCs that read PI-CORE tables on the caller's behalf (`supabase/README.md` section 3): they are PI-CORE-backed, so they are called from here too.

## What lives here

| File | Exports | Reads | Used by |
|---|---|---|---|
| `context.ts` | `readMyContext`, `readPasswordChangePending`, `readMyPermissions`, type `PicoreRead<T>` | `nexus.my_context()`, `nexus.my_password_change_pending()`, `nexus.my_permissions()` | `src/lib/auth/session.ts` only (AUTH-41) |
| `member-data.ts` | `readMemberList`, `readMemberUnitOptions`, `readActiveMemberCount`, `exportMemberRows`, `readMemberExportLog`, `mapMemberDataError` | `nexus.member_data_list()`, `member_data_unit_options()`, `member_data_active_count()`, `member_data_export()` (VOLATILE, writes the export log; call once per export), `member_data_export_log_list()` | `src/modules/member-data/server/` only. Types come from `src/modules/member-data/types.ts` |
| `inventory-borrowing.ts` | `read*` (catalog, history, counts, requests, queue, periods, detail, handover units), inventory and borrowing write wrappers, `exportInventoryRows`, `exportBorrowingRows`, `uploadEvidencePhoto`, `readEvidencePhotoLinks`, `mapInventoryDbError`, `buildInventoryError`, type `BorrowingExportRow` | every public `nexus.inventory_*` / `nexus.borrowing_*` RPC (`inventory_export` and `borrowing_export` are VOLATILE and write the export log; call once per export); Storage bucket `nexus-borrowing-evidence` (its policies run the PI-CORE-backed `borrowing_evidence_can_upload` / `_can_read`, and every `.from(` stays in this folder) | `src/modules/inventory-borrowing/server/` only. Types come from `src/modules/inventory-borrowing/types.ts` |
| `letters.ts` | `read*` (register list, years, detail, Dashboard counts, own requests, caps, queue, queue counts, request detail, numbering settings and history), register write wrappers (`registerLetterRow`, `updateLetterRow`, `addLetterFileRows`, `withdrawLetterFileRow`, `voidLetterRow`), request state machine wrappers (`createLetterRequest`, `cancelLetterRequest`, `processLetterRequest`, `takeLetterRequestNumber`, `issueLetterRequest`, `rejectLetterRequest`), numbering writes (`updateNumberingFormatRow`, `setNumberingNextRow`), `exportLetterRows`, `uploadLetterFile`, `readLetterFileLink`, `mapLetterDbError`, `buildLetterError` | every public `nexus.letter_*` RPC (`letter_export` is VOLATILE and writes the export log; call once per export); Storage bucket `nexus-letter-files` (its policies run the PI-CORE-backed `letter_file_can_upload` / `_can_read`; upload into the caller's own folder, signed links 300 s with the user's session, never the service role) | `src/modules/letters/server/` only. Types come from `src/modules/letters/types.ts` |

## Rules for code in this folder

1. Server only (`import "server-only"`). Always call with the USER's session client (`src/lib/supabase/server.ts`), never a service role client (NEXUS has none).
2. Validate every answer with zod. An unexpected shape, a database error, or an exception returns `{ ok: false }`; the caller turns that into the "error" state (fail closed). An error is never read as "no access", `false`, or "member".
3. Map snake_case rows to the camelCase types in `src/lib/auth/types.ts` (or the module's `types.ts`).
4. Log only the function name and the error code. Never tokens, user ids, emails, or row data.
5. Never read email, phone, NIM, NIP, or any other column the `nexus` functions do not return (D-010, L4).
6. Map database errors to the module's error codes, trusting only the documented hints (`permission_required` -> forbidden, known 22023 hints -> invalid input with the field). Anything else is "unavailable" (fail closed); never pass a database message on.
