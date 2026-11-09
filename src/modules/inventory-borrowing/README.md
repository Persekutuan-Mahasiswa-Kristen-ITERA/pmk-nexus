# src/modules/inventory-borrowing (Manajemen & Inventaris Barang)

Inventory catalog plus borrowing (request, approve, hand over, return), with exports and evidence photos.
Spec: `docs/modules/inventory-borrowing.md`. Design: `docs/design/inventory-borrowing.md`. Decisions: D-020, D-022.
Database: `supabase/migrations/20261107100000..20261107100200` (public RPCs `nexus.inventory_*`, `nexus.borrowing_*`).

Status (2026-11-08): **server built** (contract round 2 plus `export_too_large` and `photo_too_large`; server functions, Server Actions, the three route handlers). **UI part A in progress** (frontend engineer). Not yet tested against a real database (QA).

## Layout

| Path | Runs on | What |
|---|---|---|
| `types.ts` | both | **The contract**: limits, enums, zod input schemas, row/result types, error union + DB hint map + Indonesian copy (`inventoryErrorMessage()`), labels (status, timeline, item history, export status), date helpers, `inventoryCapabilities()`. Change only via the tech lead |
| `server/access.ts` | server | `requireInventory(capability)`: session check (`getAccessState()`) + capability, then the user's Supabase client |
| `server/catalog.ts` | server | Catalog reads: `listCatalog`, `getItemDetail`, `getItemAvailability`, `getAvailabilityBulk`, `listEntries`, `listItemHistory`, `getInventoryStatusCounts` |
| `server/manage-actions.ts` | server | Server Actions for `inventory.manage`: item create/update, units, stock dialogs, write-off, restore, archive, category/location lists |
| `server/borrowing.ts` | server | Borrowing reads: `listMyRequests`, `listQueue`, `getQueueCounts`, `listOpenLoans`, `listBorrowingPeriods`, `getRequestDetail`, `getRequestDetailByReference`, `listHandoverUnits`, `getEvidencePhotoLinks` |
| `server/borrowing-actions.ts` | server | Server Actions for the state machine: submit, approve, reject, extend, cancel, hand over, return, correct return |
| `server/validation.ts` | server | zod failure -> contract error (first issue; `field`, `ref`), start-date check, `safely()` (never throws) |
| `server/export.ts` | server | Catalog and borrowing export handlers (same pattern as Data Anggota), HTTP status per error. An answer with fewer rows than the database's `total_count` (cut by PostgREST `max_rows`) is refused with `export_too_large` |
| `server/export-file.ts` | server | Builds the xlsx / csv / PDF (landscape) files with `src/lib/export/*`; one status column via `inventoryExportStatusLabel()`; dates in WIB |
| `server/evidence.ts` | server | Evidence upload handler (A-IB50): same-origin, `borrowing.handle`, size (`photo_too_large`), declared type and magic bytes (`invalid_photo`), upload with the user's client, random name, no overwrite |
| `ui/` | both | Screens and components (frontend engineer) |

Shared helpers: `src/lib/http/request.ts` (same-origin check, size-capped body reader, 405), `src/lib/supabase/limits.ts` (`readTotalCount`, `isCut`). Route files: `src/app/api/inventory/export`, `src/app/api/inventory/borrowing/export`, `src/app/api/inventory/evidence` (thin; they call `getAccessState()` and delegate).

The RPC wrappers (and the evidence bucket calls) are in `src/lib/picore/inventory-borrowing.ts`: the functions return PI-CORE names and period labels and check PI-CORE assignments, so they belong to the single PI-CORE access layer (CLAUDE.md 4).

## Entry points

| Entry point | Needs | RPC |
|---|---|---|
| `listCatalog`, `getItemDetail`, `getItemAvailability`, `getAvailabilityBulk`, `listEntries`, `getInventoryStatusCounts` | `inventory.view` | `inventory_item_list`, `_item_detail`, `_item_availability`, `_availability_bulk`, `_category_list` / `_location_list`, `_status_counts` |
| `listItemHistory` | `inventory.manage` or `borrowing.view_all` | `inventory_item_history_list` |
| 15 manage actions | `inventory.manage` | `inventory_item_create` ... `inventory_location_set_active` |
| `listMyRequests`, `getRequestDetail`, `getRequestDetailByReference` | active member (L9; detail also `view_all`) | `borrowing_my_requests`, `borrowing_request_detail`, `borrowing_request_detail_by_ref` |
| `listQueue` (incl. period filter), `getQueueCounts`, `listOpenLoans`, `listBorrowingPeriods` | `borrowing.view_all` | `borrowing_queue`, `_queue_counts`, `_open_loans`, `borrowing_period_list` |
| `submitRequest` | active member + active period (outside party: `borrowing.handle`) | `borrowing_request_create` |
| `approveRequest`, `rejectRequest`, `extendRequest` | `borrowing.approve`, never own (L6) | `borrowing_request_approve`, `_reject`, `_extend` |
| `cancelRequest` | requester of record, or `borrowing.handle` (approved only) | `borrowing_request_cancel` |
| `listHandoverUnits`, `handOverRequest`, `recordReturn`, `correctReturn` | `borrowing.handle` | `borrowing_handover_units`, `_hand_over`, `_return`, `_correct_return` |
| `getEvidencePhotoLinks` | requester or `borrowing.view_all` | signed URLs on bucket `nexus-borrowing-evidence` |
| `POST /api/inventory/evidence` | `borrowing.handle`, request Dipinjam | Magic-byte check, then Storage upload with the user's client (A-IB50; policy `borrowing_evidence_can_upload`) |
| `POST /api/inventory/export` | `inventory.export` | `inventory_export` (writes the export log) |
| `POST /api/inventory/borrowing/export` | `borrowing.export` | `borrowing_export` (writes the export log) |

Every entry point: session + capability first, zod validation, ONE RPC with the user's client (the database checks again), never throws, returns `InventoryResult<T>`. Database errors are mapped only through `INVENTORY_DB_HINTS`; anything else is `unavailable` (fail closed).

## Decided 2026-11-08 (were open points)

- Detail by reference: `borrowing_request_detail_by_ref` + `requestReferenceSchema`.
- Evidence upload through the NEXUS route with a magic-byte check (A-IB50); signed links 300 s (A-IB51); originals up to 15 MB before resizing (A-IB52); extend conflict date found by the server, else the message without a date (A-IB53).
- Correction: `already_corrected` (once only, also respected by `actions.canCorrectReturn`) is separate from `correction_conflict` (stock changed); returns raise `stock_mismatch`.
- Inventory export returns the manager catalog rows; the file shows one status column (`inventoryExportStatusLabel`).
- Queue and borrowing export accept a period filter (`periodId`; choices from `borrowing_period_list`).

## Open points

- `INVENTORY_ERROR_COPY_VARIANTS.insufficientStock.extendWithoutDate` is the design 11.3 text without "pada {tanggal}" (A-IB53); the owner has not seen that exact string.
