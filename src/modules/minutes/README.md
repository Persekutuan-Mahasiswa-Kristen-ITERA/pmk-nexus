# src/modules/minutes (Notulensi Rapat)

Meeting minutes per organisational unit: list with search and filters, detail, record and edit forms, void, attachments (add, withdraw), export (list or one minute) and the Dashboard counts.
Spec: `docs/modules/meeting-minutes.md` (approved 2026-11-09, N1-N7; section 7 is the approved design incl. copy). Decision: D-027. Access: `docs/modules/access-control.md` keys `minutes.view`, `minutes.manage`, `minutes.export` (rules D04, D05, D17, D20, D23, D26, D27, D37).
Database: `supabase/migrations/20261111100000_nexus_minutes_access_rules.sql` (D37), `20261111100100_nexus_minutes.sql` (12 public functions `nexus.minute_*`, decisions M1-M7) and `20261111100200_nexus_minutes_storage.sql` (bucket `nexus-minute-files`).

Status (2026-11-10): **contract round 1** (`types.ts`). Server layer and screens not built yet.

## Layout (planned)

| Path | Runs on | What |
|---|---|---|
| `types.ts` | both | **The contract**: limits, enums, zod input schemas, row/result types, error union, DB hint map (`minuteErrorFromDb`), zod mapping (`minuteErrorFromZod`), HTTP status, Indonesian copy (`MINUTE_COPY`, `minuteErrorMessage()`), labels, unit label, `minuteCapabilities()` with unit scopes, routes. Change only via the tech lead |
| `server/access.ts` | server | Session check (`getAccessState()`) + capability, then the user's Supabase client |
| `server/minutes.ts` | server | Reads: `listMinutes`, `listMinuteUnits`, `getMinuteDetail`, `getMinuteDashboardCounts` |
| `server/actions.ts` | server | Server Actions (`minutes.manage`): `recordMinute`, `updateMinute`, `addMinuteFiles`, `withdrawMinuteFile`, `voidMinute` |
| `server/file-actions.ts` | server | `getMinuteFileLink` (signed link at the press, 300 s) |
| `server/files.ts` | server | Upload handler for `POST /api/minutes/files` (magic bytes, own folder, cap) |
| `server/export.ts`, `server/export-file.ts` | server | `POST /api/minutes/export` (xlsx / csv / pdf; 1000-row guard in the database plus the `total_count` cut check) |
| `ui/` | both | Screens and components (frontend engineer) |
| `src/app/(app)/notulensi/**` | both | Pages `/notulensi`, `/notulensi/catat`, `/notulensi/[id]`, `/notulensi/[id]/ubah` and `actions.ts` (thin `"use server"` wrappers that call `getAccessState()` first) |

The RPC wrappers and every Storage call go in `src/lib/picore/minutes.ts`: the functions read PI-CORE names, units, periods and assignments, so they belong to the single PI-CORE access layer (CLAUDE.md 4).

## Entry points and the right each needs

| Entry point | Needs | RPC |
|---|---|---|
| `listMinutes`, `listMinuteUnits`, `getMinuteDetail`, `getMinuteDashboardCounts` | `minutes.view` (any scope) | `minute_list`, `minute_unit_options`, `minute_detail`, `minute_dashboard_counts` |
| `recordMinute` | `minutes.manage` on the chosen unit + active period | `minute_record` |
| `updateMinute`, `addMinuteFiles`, `withdrawMinuteFile`, `voidMinute` | `minutes.manage` on the minute's unit; Aktif minute of the active period | `minute_update`, `minute_add_files`, `minute_withdraw_file`, `minute_void` |
| `getMinuteFileLink` | may read the minute (and, for a withdrawn file, manage its unit) | `minute_detail` + signed URL (policy `minute_file_can_read`) |
| `POST /api/minutes/files` | `minutes.manage` (any scope) + active period (M4) | Storage upload with the user's client (policy `minute_file_can_upload`) |
| `POST /api/minutes/export` | `minutes.export` (limited to where view holds) | `minute_export` (writes the export log) |

## Scopes (the part that differs from Letters)

Minutes keys accept unit scopes. `minuteCapabilities()` returns a `MinuteScope` per key (`none`, `all`, or `units` with ids), combined across assignments. Buttons that depend on ONE minute come from the database (`detail.actions`); the unit select and the unit filter come from `minute_unit_options()` (`canRecord`, `canRead`). The server checks `minuteScopeIncludes(manage, unitId)` before `minute_record`; the database checks again.

## Copy not in the spec (gap, written in the Letters tone; to be recorded as [ASSUMPTION])

New: `unit_required` "Pilih unit."; `invalid_unit` "Unit ini tidak bisa dipilih. Muat ulang halaman."; `invalid_dates` "Tanggal rapat tidak valid."; `not_found` "Notulensi ini tidak ditemukan."; `minute_voided` "Notulensi yang dibatalkan tidak bisa diubah."; `file_required` "Pilih minimal satu berkas."; unit filter "Semua unit"; vanished unit "Unit tidak ditemukan"; R9 warning "Tanggal ini di luar masa periode {periode}. Notulensi tetap bisa disimpan."; history "Lampiran ditambahkan oleh {nama}", "Lampiran ditarik oleh {nama}", empty value "kosong"; "Tambah lampiran" sheet button "Simpan lampiran"; notices "Notulensi dibatalkan.", "Lampiran ditambahkan.", "Berkas ditarik."; export file names `notulensi-YYYY-MM-DD.<ext>` and `notulensi-rapat-<tanggal rapat>.<ext>`; export headers "No", "Judul rapat", "Waktu dicatat", "Jumlah berkas", "Alasan pembatalan" (others reuse the detail labels).

Reused from Letters / Data Anggota: full `forbidden` text; withdraw reason "Tulis kenapa berkas ini ditarik."; search too long; export filter mismatch; `file_already_attached`; file not found / cannot open; `upload_limit`; chip "Ditarik"; history change line; "Belum ada yang diubah."; "Boleh menambah {n} berkas lagi.".

Kept from the spec where it differs from Letters: generic error "Terjadi gangguan. Coba lagi." (Letters adds "sebentar lagi"); too long "Terlalu panjang (maksimal {n} karakter)."; file errors "Hanya PDF, JPG, atau PNG.", "Berkas terlalu besar (maksimal 5 MB).".
