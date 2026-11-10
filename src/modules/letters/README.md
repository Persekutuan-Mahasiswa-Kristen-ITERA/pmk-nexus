# src/modules/letters (Surat Menyurat)

Letter register (Surat Masuk, Surat Keluar) with system numbering, letter files, the letter request flow (Ajukan, Proses, Ambil nomor, Terbitkan, Tolak), numbering settings, export and the Dashboard counts.
Spec: `docs/modules/letters.md` (incl. the "Ambil nomor" amendment). Design: `docs/design/letters.md`. Decisions: D-024, D-025.
Database: `supabase/migrations/20261110100000_nexus_letters.sql` (27 public functions `nexus.letter_*`) and `20261110100100_nexus_letters_storage.sql` (bucket `nexus-letter-files`). Reference: `supabase/README.md` section 3.2.

Status (2026-11-10): **contract round 2** (`types.ts`): owner approved the choices and the gap copy (2026-11-09); adapted to the database fix 7e510bd (`p_letter_version` on Terbitkan, `letter_my_request_caps`, new queue columns). Server layer built (`server/**`, `src/lib/picore/letters.ts`, routes `/api/letters/files` and `/api/letters/export`); UI in progress.

## Layout (planned)

| Path | Runs on | What |
|---|---|---|
| `types.ts` | both | **The contract**: limits, enums, zod input schemas, row/result types, error union + DB hint map + Indonesian copy (`letterErrorMessage()`, per-field texts), labels, date and number helpers, `letterCapabilities()`, `letterSegments()`. Change only via the tech lead |
| `server/access.ts` | server | Session check (`getAccessState()`) + capability, then the user's Supabase client |
| `server/register.ts` | server | Register reads: `listLetters`, `listLetterYears`, `getLetterDetail`, `getLetterDashboardCounts` |
| `server/register-actions.ts` | server | Server Actions (`letters.manage`): `registerLetter`, `updateLetter`, `addLetterFiles`, `withdrawLetterFile`, `voidLetter` |
| `server/requests.ts` | server | Request reads: `listMyRequests`, `getMyRequestCaps`, `listRequestQueue`, `getLetterQueueCounts`, `getRequestDetail` |
| `server/request-actions.ts` | server | Server Actions of the state machine: `submitRequest`, `cancelRequest`, `processRequest`, `takeRequestNumber`, `issueRequest`, `rejectRequest` |
| `server/numbering.ts`, `server/numbering-actions.ts` | server | `getNumberingSettings`, `listNumberingHistory`; System Admin: `updateNumberingFormat`, `setNextNumber` |
| `server/file-actions.ts` | server | `getLetterFileLink` (signed link at the press, 300 s) |
| `server/files.ts` | server | Upload handler for `POST /api/letters/files` (magic bytes, own folder, cap) |
| `server/export.ts`, `server/export-file.ts` | server | `POST /api/letters/export` (xlsx / csv / pdf, `total_count` cut check) |
| `ui/` | both | Screens and components (frontend engineer) |
| `src/app/(app)/surat/actions.ts` | server | The Server Actions the screens import (through `ui/server-actions.ts`): thin `"use server"` wrappers with the contract names above, each calls `getAccessState()` first (OPEN_QUESTIONS F2), then the module action. Also `loadLetterYears`, `loadMyRequestCaps`, `loadLetterQueueCounts`, `loadNumberingHistory` for Client Component reads |

The RPC wrappers and every Storage call go in `src/lib/picore/letters.ts`: the functions read PI-CORE names, periods and assignments, so they belong to the single PI-CORE access layer (CLAUDE.md 4).

## Entry points and the right each needs

| Entry point | Needs | RPC |
|---|---|---|
| `listLetters`, `listLetterYears`, `getLetterDetail`, `getLetterDashboardCounts` | `letters.view` | `letter_list`, `letter_year_list`, `letter_detail`, `letter_dashboard_counts` |
| `registerLetter` | `letters.manage` + active period | `letter_register` |
| `updateLetter`, `addLetterFiles`, `withdrawLetterFile`, `voidLetter` | `letters.manage`, Aktif letter of the active period | `letter_update`, `letter_add_files`, `letter_withdraw_file`, `letter_void` |
| `listMyRequests`, `getMyRequestCaps` | active member (L9) | `letter_my_requests`, `letter_my_request_caps` |
| `getRequestDetail` | requester or `letter_requests.view_all` | `letter_request_detail` |
| `listRequestQueue`, `getLetterQueueCounts` | `letter_requests.view_all` | `letter_request_queue`, `letter_request_queue_counts` |
| `submitRequest` | active member + active period | `letter_request_create` |
| `cancelRequest` | the requester, Diajukan | `letter_request_cancel` |
| `processRequest`, `takeRequestNumber`, `issueRequest`, `rejectRequest` | `letter_requests.process`, never own (L6) | `letter_request_process`, `_take_number`, `_issue`, `_reject` |
| `getNumberingSettings`, `listNumberingHistory` | System Admin or `letters.manage` | `letter_numbering_settings`, `letter_numbering_history` |
| `updateNumberingFormat`, `setNextNumber` | System Admin | `letter_numbering_update_format`, `letter_numbering_set_next` |
| `getLetterFileLink` | may read the parent and the file (database decides) | detail RPC + signed URL on `nexus-letter-files` (policy `letter_file_can_read`) |
| `POST /api/letters/files` | active member + active period | Storage upload with the user's client (policy `letter_file_can_upload`) |
| `POST /api/letters/export` | `letters.export` (+ view) | `letter_export` (writes the export log) |

Every entry point: session + capability first, zod validation, ONE RPC with the user's client (the database checks again), never throws, returns `LetterResult<T>`. Database errors are mapped only through `LETTER_DB_HINTS`; anything else is `unavailable` (fail closed).

## Decided (owner 2026-11-09, unless noted)

- "Permohonan Saya" defaults to **Semua**: an issued request (the one with the file) counts as closed.
- No "Sertakan tahun" input: the year is mandatory (D2). The UI shows no checkbox (the read view may keep "Tahun disertakan" as plain text).
- Request timeline: "Ditolak oleh {nama}", "Dibatalkan oleh {nama}".
- Gap copy: too long = "{Kolom} terlalu panjang. Pakai paling banyak {n} karakter." per field (`letterFieldName`); queue date range = "Tanggal akhir tidak boleh sebelum tanggal mulai."; `file_already_attached` = "Berkas ini sudah terpasang. Pilih berkas lain."; file not found (outside "Lihat") = "Berkas tidak ditemukan. Muat ulang halaman.".
- (Contract) Saved file paths never reach the browser; "Lihat"/"Unduh" ask `getLetterFileLink`, which reads the detail and signs the path.
- (Contract) A bucket refusal with an active period is the 24-hour cap (`upload_limit`, 429). `not_requester` -> `forbidden`; `numbering_exhausted`, `year_required` -> `unavailable`.
- (Contract) "Not in the future" / "not before today" checks run on the server with `jakartaToday()` before the RPC, not in zod.
- (Contract) Terbitkan prefills from `detail.letter` (the register row's current values) and sends `letter.version` as `letterVersion`; a register edit in between answers `state_changed` instead of being overwritten.

## Still on the generic text ("Terjadi gangguan. Coba lagi sebentar lagi.")

`invalid_dates` on a single malformed date field (the date pickers prevent it); `no_active_period` on cancel / process / reject (their buttons are absent without a period); `reason_required` outside void / withdraw / set next (no other form requires a reason); `text_too_long` on a field without a name (none today); `unavailable` itself. Approved texts reused: `request_open` and `year_not_current` use "Data sudah berubah. Muat ulang."; `export_too_large` the Inventory text; `file_required` on "Tambah berkas" the Terbitkan text. Export column headers: proposed when the writer is built.

## Database gaps

None left for the designed screens after 7e510bd (daily-cap count, handover group counts, "Nomor dibatalkan" in the queue and the Terbitkan prefill are now covered).
