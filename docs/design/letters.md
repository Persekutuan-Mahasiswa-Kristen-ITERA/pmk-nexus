# Letters ("Surat Menyurat"): screen design

> Status: **PROPOSED, waiting for owner approval.** Nothing is built. Words and ASCII only, no code.
> Scope: every screen of `docs/modules/letters.md` section 7 (spec APPROVED 2026-11-09, L1-L11 accepted as recommended): 13 screens, numbered 1 to 13 below.
> Sources: `CLAUDE.md` section 8; `docs/DECISIONS.md` D-014, D-017, D-021, D-022, D-023, D-024; `docs/design/stitch/design-system.md`, `screens.md` (10, 11, Dashboard card); the approved pattern `docs/design/inventory-borrowing.md` (read whole); what is built (`src/components/ui/*`: `PageHeaderCard`, `HeaderStat`, `ModuleNav`, `StatusChip`, `Timeline`, `Sheet`, `DashboardCard`; `src/modules/inventory-borrowing/ui/inventory-header.tsx`; theme variables in `src/app/globals.css`).
> All people, counterparts, subjects and dates in the wireframes are **placeholders** in [brackets]. Letter numbers and counts are **format examples**, not data. The number format `PMK/NEX/SM/2026/001` is the provisional D-024 format and stays a setting. Stitch filler (Direktorat Jenderal Pajak, Rektorat, "Dokumen Disposisi", Verifikasi / Disetujui / Menunggu, an SM number under Surat Keluar, "+ Buat Surat Baru", "Halaman 1 dari 4") is not used.
> Language: UI copy is Indonesian with "kamu". Everything else is English. No em dashes, no emoji, no exclamation marks in UI copy.

**Design Read.** Work tool for two kinds of people: every member who needs a letter (a student on a phone, asking and then checking back), and the BPH secretaries who keep the register (typing in letters, photographing paper, issuing numbers). Mode: Operate. Dials: **ENERGY 2 / RHYTHM 2 / MOTION 2**. Reason: the screens are for a job (ask, decide, register, find), so they stay calm; the dials sit at 2 only because D-023 already shipped the warm header card, the short entrance rise and the press feedback, and this module adds no new motion (everything off under `prefers-reduced-motion`). RHYTHM 2: lists, forms, a detail page and a settings page differ on purpose. Identity: the flat walnut bar and Playfair headings of the shell, plus **one** module motif, the **number plate** (the official letter number set large on the gold tint, screen 3 and screen 7). The number is the one thing a letter module exists to produce, so it gets the single focal card, and nothing else on the screen competes with it.

Skills read and applied: `antislop`, `antislop-ui`, `antislop-human`, `antislop-copywriting`, `design-taste-frontend` (app-screen rules), `impeccable` (Operate mode), `stop-slop`. Skills that conflict with Stitch (saturated brand bar, serif display on app screens, brand-filled buttons) lose to D-014, as in `inventory-borrowing.md` section 2.

---

## 1. Key decisions and why (simple words)

| # | Decision | Why |
|---|---|---|
| K1 | One module, route-based segments in the same control as Inventory: **Surat Masuk, Surat Keluar, Permohonan Saya, Antrean**. A person sees only the segments they may use. A plain member sees one, so no control is drawn at all and they land straight on "Permohonan Saya". | Each segment answers one question: "what came in", "what went out", "where is my request", "what needs me". Showing only what a person may use keeps it short for most members (they have one job here). `ModuleNav` already hides itself with fewer than two items. |
| K2 | The register is a **card list on phones** (table from 1024 px). | A letter has a long number, a counterpart, a long Perihal, a date, a file mark and sometimes a chip. Six table columns at 390 px would cut every one of them. Inventory made the same choice for requests (X8). |
| K3 | The list **row leads with the letter number**, bold, in tabular figures, allowed to break after a slash. | Secretaries look for a letter by number first. A 19-character number must never push the card wider than the screen, also at 200% zoom. |
| K4 | The **number plate**: on the detail, the number is set on its own gold-tint card in Plus Jakarta Sans bold (not Playfair), with "Salin nomor". | Playfair Display draws old-style figures by default (digits of uneven height). An official number must read evenly. The secretary also needs to paste the number into the Word file of the letter, so copying is a real job, not decoration. |
| K5 | **Register first, then write the letter.** On the outgoing form the number comes at save and files are optional; the file is added later with "Tambah berkas". | Spec F3 and F4. A letter must carry its number before it is signed, so the number has to exist before the file does. The form says so in one sentence (screen 4). The request flow has the opposite order (file and number at the same time); that conflict is **G1**, the most important question in this document. |
| K6 | The request is **three required fields and a few optional ones** (Perihal, Ditujukan kepada, Keperluan; Atas nama, Dibutuhkan paling lambat, up to 3 attachments). Hints under each field say what the secretary needs. | L3 (b). A member asks for a letter rarely and does not know the secretary's needs, so each hint is a plain sentence, not a label. |
| K7 | A secretary acts on a request on **the same page the requester reads**, with an extra panel of buttons. "Terbitkan Surat" is a page of its own, not a dialog. | Same pattern as the head's review in Inventory (11.2). Issuing needs a file picker, three fields and a confirmation. A bottom sheet with an upload list on a phone keyboard is a trap. |
| K8 | Buttons that start a save are never greyed. A refusal is a message next to the problem. Actions a person may not do are absent. | Same rules as Inventory K8 and K9, and as login. |
| K9 | A **quiet default**: on register rows the chip appears only for **Dibatalkan** (and "Nomor lama"). "Aktif" is shown on the detail and in the filter. | 95 percent of rows are Aktif. A green chip on every row is a wall of the same word that hides the one that matters. Inventory did the same ("a fully good item shows no chip"). **[needs OK]**, P3. |
| K10 | Status chips carry the meaning in text; colour only repeats it. One chip set (screen 13), same anatomy as Inventory section 17. | Colour-blind and low-vision users. |
| K11 | The requester sees **their own request, number and file only**, never the register (spec L9). The register shows letters, never member data. | Access rules (spec section 2, R14). |
| K12 | The Dashboard card shows **counts only**, never a subject or a counterpart. | Spec L11 (a). |

---

## 2. Deviations from Stitch, from the spec and from existing screens (reason FIRST)

Nothing here is applied silently. **[needs OK]** marks a change to something the owner already approved or a look that is not in Stitch.

| # | What differs | Reason | Status |
|---|---|---|---|
| X1 | Stitch 10/11 put a list and a floating pill "+ Buat Surat Baru" on one scroll. Replaced by four route-based segments and one plain primary button per register tab ("Catat Surat Masuk", "Catat Surat Keluar"). | The pill leads nowhere (spec section 6) and pills are for status chips and filter tags (D-014). A button at the top of the list is in the thumb zone and is the same pattern as "Ajukan Peminjaman". | Follows D-014 and spec |
| X2 | Stitch's centred "ARSIP ELEKTRONIK" chip above the title is not used. | A pill above a heading repeats the heading (Inventory X3, D-014). The warm `PageHeaderCard` with the period pill replaces it. | Follows D-014, D-023 |
| X3 | Stitch's status row "Semua (22), Verifikasi (5), Disetujui (12), Menunggu (5)" and the per-card badges are dropped. Register status is Aktif or Dibatalkan only. | Spec L5 and section 6. Nobody defined the Stitch statuses. | Decided by spec |
| X4 | Stitch's per-card buttons "Lihat Surat" and "Unduh PDF" are dropped from list rows. A row is one link to the detail, where one "Lihat" opens each file. | Files follow rights (spec 4.4) and may be images; two buttons on every card are 40 targets on one screen and most letters have no file yet. | Follows spec section 6 |
| X5 | The Surat segments show **no count in brackets** on the register tabs. The counts sit in the header tiles ("Surat masuk 12", "Surat keluar 9"). Only "Antrean (n)" keeps a bracket count, meaning "needs your action". Spec F1 says each tab shows a count. | A bracket count on "Surat Masuk (12)" cannot follow the search and the filters, so it says 12 while the list says 3. The header tiles say the same thing in the right place and are larger. In Inventory the bracket is reserved for "needs you" (X6 there); this keeps the control meaning one thing. | **[needs OK]** P2 |
| X6 | Register rows show a chip only for Dibatalkan and "Nomor lama". Spec F1 says a chip "Aktif" or "Dibatalkan" on every row. | See K9. | **[needs OK]** P3 |
| X7 | From 1024 px the register becomes a table in a **wider column (max 1024 px)** than the 768 px column of Inventory. | A letter table needs room for number, counterpart, Perihal, date, files, status. At 768 px the Perihal would be cut to one short line. | **[needs OK]** P4, small |
| X8 | The success tone of `AlertMessage` and the grey chip tone are used as added in Inventory (X9, X10 there). | Already approved there; reused unchanged. | Already approved |
| X9 | A "Salin nomor" button, a "Catat surat lain" link after saving and a "preview of the next number" on the Terbitkan page are added. None is in the spec. | Each is a real job the secretaries do (paste the number into the Word file; register several letters in a row; know which number the file must carry). They are small and removable. | **[needs OK]** P5, P6 |
| X10 | The numbering settings screen has its own layout (format card, next-number card, change history) in the NEXUS settings area, which has no design yet. | Spec section 7 item 9 asks for it; the settings shell belongs to the access-control design (gap G10). | **[needs OK]** P11 |
| X11 | No destructive (red) button. "Batalkan nomor", "Tolak permohonan", "Tarik berkas" use the normal walnut buttons; the consequence is written above the button. | Stitch has no red button (Inventory X12). | Within Stitch |
| X12 | Field borders `#81756A` and 16 px field text on all forms. | Already approved (D-017 Q2). | Approved |

Icons: the app ships Lucide icons (Inventory G12). Each icon below is named by meaning only and always sits next to text; the frontend uses the set already built.

---

## 3. Shared building blocks

Everything in `inventory-borrowing.md` sections 3.1 to 3.7 and 17 applies unchanged (colour roles, Stitch hex values, type roles, dialog and bottom-sheet rules, form patterns, date format, shared messages, skeletons). Only what is new or different is listed here. Colour values used in this document are exactly those of `design-system.md` and the theme file; nothing is invented.

### 3.1 Page frame

- `AppFrame` with the drawer. Each section page opens with the `PageHeaderCard` of D-023: period pill ("Periode 2026/2027"), Playfair title "Surat Menyurat", one plain line under it, optional tiles, and an optional count box at the right ("Hasil 42 surat"). The module nav sits under it (`InventoryHeader` pattern, one `LettersHeader` for this module).
- One plain line under the title, by who is looking: holders of `letters.view`: "Arsip surat resmi PMK ITERA." Everyone else: "Ajukan surat ke sekretaris dan pantau prosesnya di sini."
- Tiles (`HeaderStat`, shown only on Surat Masuk, Surat Keluar and Antrean; hidden while loading or if the count failed, as in Inventory): **"Surat masuk"** and **"Surat keluar"** (counts of Aktif letters in the active period, with the note "{n} dibatalkan" under it only when n is above 0) and, for `letter_requests.view_all` holders, **"Permohonan menunggu"** (count of Diajukan, all periods, see G9). Plain numbers, no percent, no delta. A tile with a warning figure is used only for "Permohonan menunggu" when it is above 0.
- Columns: lists use the wide column (576 px, 768 px from tablet width, 1024 px from desktop for the register table, X7). Forms and details use the narrow column (448 px).
- Forms and action pages replace the segmented control with a "Kembali" text link (as Inventory 3.2).

### 3.2 Letter number display

- A number is plain text, never a link by itself, in Plus Jakarta Sans bold with tabular figures (14 px in lists, `numeric-metric` 20/26 on the plate).
- A `<wbr>` after every slash, so `PMK/NEX/SM/2026/012` wraps at 358 px and at 200% zoom instead of overflowing.
- The number is never reformatted, shortened or recomputed from parts on screen. It is the stored text (spec 4.1).
- Screen readers read it as one phrase through `aria-label` ("Nomor surat PMK NEX SM 2026 012") on the plate only; list rows keep the visible text.

### 3.3 FilePicker (new shared component, for screens 4, 5, 6, 9)

The Inventory `PhotoPicker` adapted to letters (PDF, JPG, PNG; 5 MB; at most 3). One component, three uses (register form, "Tambah berkas", request form, Terbitkan page).

```
|  Berkas (boleh kosong, maksimal 3)           |
|  PDF, JPG, atau PNG. Paling besar 5 MB.      |
|  Foto diperkecil otomatis sebelum diunggah.  |
|                                              |
|  +------------------+ +------------------+   |
|  |    Ambil foto    | |   Pilih berkas   |   |  2 outline buttons, 48 px
|  +------------------+ +------------------+   |
|                                              |
|  +------+  surat-undangan.pdf                |  tile: 72 px, r8
|  | PDF  |  1,2 MB . Terunggah (check)  [Hapus]|  document tile for PDF
|  +------+                                    |
|  +------+  foto-surat.jpg                    |
|  | img  |  Mengunggah 45%                    |  thumbnail for images
|  +------+  [=======-------]                  |  flat bar: track #F0E9DC, fill #62431F
|  +------+  scan-2.png                        |
|  | img  |  Gagal diunggah. [Coba lagi][Hapus]|
|  +------+                                    |
```

| Aspect | Specification |
|---|---|
| Buttons | "Ambil foto" opens the phone camera (rear, `capture`), because a photo of a paper letter is the main case on a phone; hidden on a computer. "Pilih berkas" opens the file chooser (files and gallery). At 3 files both disappear and a line says "Maksimal 3 berkas." |
| Accepted | PDF, JPG, PNG, checked by the real type (spec LT-26). Other: "Format tidak didukung. Pakai PDF, JPG, atau PNG." |
| Size | Over 5 MB after resizing (PDF is never resized): "Berkas terlalu besar. Batasnya 5 MB. Perkecil dulu atau pilih berkas lain." |
| Resize | Images only, in the browser, before upload; long side about 2000 px so printed text stays readable, quality lowered in steps until the file is under 5 MB. Tile shows "Memperkecil..." with a static spinner. [ASSUMPTION] 2000 px, the engineer may tune it (G14). |
| Upload | Starts when the file is chosen (a bad connection shows while the person still holds the paper), "Mengunggah {n}%" with a flat bar (`role=progressbar`). Same choice as Inventory P8. Files never attached to a saved letter or request are not records. |
| Done | "Terunggah" with a check icon, name and size ("1,2 MB", decimal comma). |
| Failure | "Berkas gagal diunggah. Coba lagi." with "Coba lagi" and "Hapus". No network: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi." |
| Daily cap (10 unattached uploads in 24 hours) | "Terlalu banyak unggahan dalam 24 jam. Coba lagi nanti." |
| Order | In the order chosen. The first file is shown first everywhere; there is no "main file" setting. |
| While busy | Saving is refused with a message under the button, not a greyed button: "Tunggu sampai semua berkas selesai diunggah." |
| Privacy | Nothing is shown to other members. Files open only for those allowed in spec 4.4, through a signed link made when the button is pressed (so it never expires under an open page). |
| Accessibility | A group labelled "Berkas {n}" per tile; the live region announces "Berkas 2 terunggah" or "Berkas 3 gagal diunggah"; image thumbnails `alt="Pratinjau berkas {n}"`; PDF tile has the text "PDF". Targets: buttons 48, "Hapus" and "Coba lagi" 44. |

### 3.4 Messages specific to Letters

| Situation | Text | Notes |
|---|---|---|
| No active period (module banner) | "Belum ada periode aktif. Permohonan belum bisa dibuat." | Info banner under the title. For register holders the register segments disappear (their keys match nothing, spec R7), so this is the line a member needs. On the register and Terbitkan forms (direct link): "Belum ada periode aktif. Surat belum bisa dicatat." |
| No permission (direct link to a register tab or the queue) | `ForbiddenScreen` (existing), with the period sentence when there is no active period. | |
| Own request on the review page | "Tidak bisa memproses permohonanmu sendiri. Sekretaris lain yang memutuskan." plus, for `letters.manage` holders: "Kamu bisa mencatat suratmu langsung di Surat Keluar." | Spec F6.2, A-n9. |
| Lone processor | "Hanya kamu yang bisa memproses saat ini. Permohonanmu sendiri menunggu sekretaris lain." | Info card on the queue, only when the viewer holds `process`, is the only holder, and has an open request of their own. |
| Request caps | Open: "Kamu sudah punya 5 permohonan yang berjalan. Tunggu salah satunya selesai atau batalkan dulu." Daily: "Batas permohonan hari ini sudah tercapai (10). Coba lagi besok." | Numbers come from the setting (spec L10 (b)). Shown in an alert above the form, and again as the refusal on submit. |
| Number copied | "Nomor disalin." (`role=status`). Failure: "Nomor tidak bisa disalin. Pilih nomornya lalu salin sendiri." | |
| File link failed | "Berkas tidak bisa dibuka. Coba lagi." | |
| Conflict | "Data sudah berubah. Muat ulang." with "Muat ulang". | Spec states table. |
| Skeleton captions | "Memuat surat...", "Memuat permohonan...", "Memuat antrean...", "Memuat form...", "Memuat pengaturan..." | Flat ivory bars, `role=status`. |

### 3.5 Components: what exists, what is new

| Need | Reuse | New or extended |
|---|---|---|
| Frame, drawer, header card, tiles | `AppFrame`, `NavDrawer` (one item in `nav.ts`), `PageHeaderCard`, `HeaderStat` | `LettersHeader` (copy of the `InventoryHeader` pattern) |
| Module nav | `ModuleNav` | none |
| Cards, alerts, buttons, fields, chips, timeline, sheet, steppers | as built | none |
| Chips | `StatusChip` | new texts only (screen 13); no new tone |
| Pagination, filters, URL state, export | Inventory generalisations (`list-url`, `list-navigation`, export menu) | none beyond props |
| Files | `PhotoPicker` pattern | `FilePicker` (3.3) |
| Number plate | `Card` with the gold tint of `DashboardCard` icon tile | `NumberPlate` (screen 3) |
| Copy to clipboard | none | one small button, native `navigator.clipboard`, fails soft |

---

## 4. Screen 1: Module landing and navigation

**Goal.** Let each person reach the part of the module they may use, and see at a glance whether something waits for them.

**Who sees it.** Every active member sees the drawer item and the page. Segments appear by key: Surat Masuk and Surat Keluar need `letters.view`; Antrean needs `letter_requests.view_all` (included in `process`); Permohonan Saya is fixed for everyone (spec L9). Register segments disappear when there is no active period (spec R7).

**Path.** Opens the drawer -> taps "Surat Menyurat" -> lands on the first segment the person has -> switches with the segmented control.

### 4.1 Drawer item

- Label **"Surat Menyurat"** (the Stitch label). Icon: an envelope. Position: after "Notulensi Rapat" and before "Manajemen & Inventaris" (Stitch order, `nav.ts` comment). Active when the path starts with `/surat`.
- Shown to **every active member**, because everybody needs "Permohonan Saya". This is the exception to D-021 noted in spec section 12 note 1; the drawer item has no key of its own, the register segments do. It joins `nav.ts` only when the module ships (R-24).
- No badge on the drawer item; the count lives in the Antrean segment.

### 4.2 Wireframe: a BPH secretary (all four segments), 390 px

```
+----------------------------------------------+
| ############ app bar (unchanged) ############ |
|                                              |
|  +----------------------------------------+  |  PageHeaderCard, warm fill
|  | (Periode 2026/2027)                    |  |  period pill
|  | Surat Menyurat          +------------+ |  |  Playfair 32 + count box
|  | Arsip surat resmi       | Hasil      | |  |  (list screens only)
|  | PMK ITERA.              | 12 surat   | |  |
|  |                         +------------+ |  |
|  | +---------+ +---------+ +-----------+  |  |  HeaderStat tiles
|  | |Surat    | |Surat    | |Permohonan |  |  |
|  | |masuk    | |keluar   | |menunggu   |  |  |
|  | |  12     | |   9     | |    3      |  |  |
|  | |1 dibatal| |         | |           |  |  |
|  | +---------+ +---------+ +-----------+  |  |
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |  track #F0E9DC, r12, pad 4
|  |[Surat   ][Surat   ][Permohonan][Antrean|  |  4 equal segments, 56 px
|  |[Masuk   ][Keluar  ][Saya      ][ (3)  ]|  |  active = walnut, white text
|  +----------------------------------------+  |
|                                              |
|  ... content of the chosen section ...       |
+----------------------------------------------+
```

A plain member (no control, one section, no tiles):

```
|  +----------------------------------------+  |
|  | (Periode 2026/2027)                    |  |
|  | Surat Menyurat      +----------------+ |  |
|  | Ajukan surat ke     | Permohonan     | |  |
|  | sekretaris dan      | 2 berjalan     | |  |
|  | pantau prosesnya    +----------------+ |  |
|  | di sini.                               |  |
|  +----------------------------------------+  |
|  ... Permohonan Saya content (screen 7) ...  |
```

### 4.3 Sections

| Section | Route (proposal) | Visible when | Contents |
|---|---|---|---|
| Surat Masuk | `/surat/masuk` | `letters.view` | screen 2 (register); detail `/surat/{id}` (screen 3); forms `/surat/catat/masuk` (screen 4) |
| Surat Keluar | `/surat/keluar` | `letters.view` | screen 2; forms `/surat/catat/keluar` |
| Permohonan Saya | `/surat/saya` | every active member | screen 7; form `/surat/ajukan` (screen 6); detail `/surat/permohonan/{id}` |
| Antrean | `/surat/antrean` | `letter_requests.view_all` | screen 8; review `/surat/permohonan/{id}` (same page as the requester detail); `/surat/permohonan/{id}/terbitkan` (screen 9) |

`/surat` itself redirects to the first segment the person has. Action pages (forms, Terbitkan) are not sections; they show "Kembali" instead of the control. The numbering settings live in the NEXUS settings area (`/pengaturan/penomoran-surat`, screen 10), not in this control.

### 4.4 Behaviour and reasons

- The segments are **real links** (`<nav>`, `aria-current="page"`), not a tablist, exactly as Inventory 4.4: each section has its own address, Back works, a link can be shared.
- Labels wrap to two lines at 390 px ("Surat / Masuk", "Permohonan / Saya"). Four labels cannot fit on one line at a readable size, and a scrolling tab strip would hide the fourth.
- The bracket count in "Antrean (3)" is the number of requests that wait for **this person's action**: Diajukan requests of all periods that are not their own. Shown only to `letter_requests.process` holders and only above 0. BPH who only hold `view_all` see "Antrean" with no number. Accessible name "Antrean, 3 perlu tindakan". **[PROPOSAL P2]**
- **Where a person lands.** Always the first segment they have, in the order of the control. No guessing by counts. A secretary who wants the queue taps the one segment, with the number in view (G13).
- **[PROPOSAL P1]** Keep this four-segment design. Alternatives: (b) two levels, "Register" (with Masuk and Keluar inside) and "Permohonan" (with mine and queue inside): fewer segments but one more screen of choosing before any content; (c) put "Antrean" inside "Permohonan Saya" as a second list: a secretary then looks for her work in a member's page. Recommendation: this design, because it matches Inventory, which the owner has already used.

### 4.5 States

| State | What shows |
|---|---|
| Loading | Header card, title and control draw at once; the tiles and the Antrean count arrive when ready. A failed count shows no number and no error (it is a hint, not data). |
| No active period | Info banner (3.4). Register segments and Antrean disappear (rules match nothing). Permohonan Saya stays and is readable. |
| Section without the key (direct link) | `ForbiddenScreen`. |
| Error | The section shows its own error. The control stays. |

### 4.6 Accessibility and touch

- `nav` with `aria-label="Bagian surat menyurat"`. Visible focus: 2 px walnut outline, 2 px offset (as the shell).
- Segments 56 px high, at least 80 px wide (four segments at 358 px are about 88 px). Active: white on `#62431F` (8.97:1) with bold and `aria-current`; inactive `#4F453B` on `#F0E9DC` (7.74:1).
- 1280 px: the control keeps its height, labels on one line, width of the content column. The header tiles sit in one row of three; the count box stays at the right of the title.

---

## 5. Screen 2: Register list ("Surat Masuk" and "Surat Keluar")

**Goal.** Find a letter by number, counterpart or subject, see whether it has a file, and (for managers) register a new one.

**Who sees it.** `letters.view`. The register button needs `letters.manage`. "Ekspor" needs `letters.export`. Each tab lists only its own type (spec section 6).

**Path.** Opens a tab -> types a number, counterpart or subject, or sets filters -> opens a letter (screen 3) -> or taps the register button (screen 4).

### 5.1 Wireframe, idle (390 px, Surat Masuk, a secretary)

```
|  [ header card with tiles, screen 1 ]        |
|  [ segmented control, Surat Masuk active ]   |
|                                              |
|  +----------------------------------------+  |
|  |         + Catat Surat Masuk            |  |  primary, 48 px, letters.manage only
|  +----------------------------------------+  |
|  [Q] Cari nomor, pengirim, atau perihal...   |  48 px
|                                              |
|  [ Filter (1) v ]                 [Ekspor v] |  44 px each; Ekspor only with key
|  (Semua periode x)                           |  filter tag, only non-default filters
|                                              |
|  +----------------------------------------+  |  card, r12, 1 px #EADFCF
|  | PMK/NEX/SM/2026/012                    |  |  bold 14, tabular, breaks at "/"
|  | [Nama pengirim]                        |  |  body-md, semibold
|  | [Perihal surat, dipotong di baris ke-2 |  |  body-md, 2 lines max
|  | kalau panjang...]                      |  |
|  | Diterima 14 Okt 2026   [clip] 2 berkas |  |  body-sm #7A6652
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | PMK/NEX/SM/2026/011        (Dibatalkan)|  |  chip only for Dibatalkan
|  | [Nama pengirim]                        |  |
|  | [Perihal surat]                        |  |
|  | Diterima 9 Okt 2026    Belum ada berkas|  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | 045/PMK/2025        (Nomor lama)       |  |  "Nomor lama" chip, ivory
|  | ...                                    |  |
|  +----------------------------------------+  |
|                                              |
|     [< Prev]  [1] [2] [3]  [Next >]          |
|     Menampilkan 1-20 dari 42 surat           |
+----------------------------------------------+
```

On **Surat Keluar** the button reads "Catat Surat Keluar", the search placeholder is "Cari nomor, tujuan, atau perihal...", the second line is the addressee, and the last line reads "Tanggal surat 12 Okt 2026". A letter that came from a request carries the small text "Dari permohonan" after the date.

Filter card open (below the Filter button, pushes the list down; same card as Inventory 5.1):

```
|  +----------------------------------------+  |
|  | Filter Surat                   Reset   |  |  label-lg + text button 44 px
|  |                                        |  |
|  |  Periode             Tahun nomor       |  |
|  |  [Periode aktif   v] [Semua tahun   v] |  |  2 columns, 48 px
|  |                                        |  |
|  |  Status                                |  |
|  |  (Semua) (Aktif) (Dibatalkan)          |  |  filter tags, single choice
|  |                                        |  |
|  |  [ ] Tanpa berkas                      |  |  checkbox row, 48 px
|  +----------------------------------------+  |
```

### 5.2 Elements and choices

| Element | Specification | Reason |
|---|---|---|
| Primary button | "+ Catat Surat Masuk" / "+ Catat Surat Keluar". Full width, 48 px. Only for `letters.manage`; absent without it. | One focal point for the person who registers. "Catat" is the word of the spec ("register") and of Inventory ("Catat pengembalian"). |
| Search | Hidden label "Cari surat". Searches number (part of it), counterpart and Perihal, case-insensitive, nothing else (spec LT-25). After 450 ms of no typing or on Enter, page 1. Max 120 characters: "Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter." | Spec F1, A-LT15. |
| "Filter (n)" | Outline, 44 px, shows how many filters differ from the default. `aria-expanded`. From 768 px the card is always open and the button is hidden. | Inventory P3. |
| Filter tags | One removable pill per non-default filter ("Semua periode", "Tahun 2026", "Dibatalkan", "Tanpa berkas"), each with a 44 px remove target ("Hapus filter Semua periode"). The default (active period) shows no tag. | D-014 allows pills for filter tags. |
| Periode | Select: "Periode aktif" (default), "Semua periode". Old periods are read-only, so a letter of an old period opens read-only (screen 3). | Spec F1. Choosing one specific old period is not in the spec (G8). |
| Tahun nomor | Select: "Semua tahun" and the years that exist in the register. | Spec F1: the year in the number is the calendar year, not the period. |
| Status | Filter tags, single choice: Semua, Aktif, Dibatalkan. | Spec F1. |
| Tanpa berkas | Checkbox row. Matches letters with no visible file. | Spec F1. It is also the secretary's to-do list (letters registered first, file later, K5). |
| Card | Whole card is one link to screen 3. Focus ring around the card. Line 1 number (bold). Line 2 counterpart. Line 3 Perihal (2 lines). Line 4 date and file mark. | K2, K3. |
| Date line | Surat Masuk: "Diterima {tanggal}". Surat Keluar: "Tanggal surat {tanggal}". | The date a secretary looks for differs by type. |
| File mark | Paperclip icon and "2 berkas", or the text "Belum ada berkas" (plain meta text, no colour). Withdrawn files are not counted for non-managers. | A missing file is information, not an error. |
| Chips | Only "Dibatalkan" (grey) and "Nomor lama" (ivory). See K9. | P3 |
| Order | Newest registered first (G8). | A late-registered letter would otherwise hide in the middle. |
| "Ekspor" | Screen 11. | |

### 5.3 States

| State | What shows |
|---|---|
| Loading | Header and controls draw at once. Six flat ivory card skeletons (number bar 150 x 14, two text bars, meta bar), caption "Memuat surat..." (`role=status`). Controls stay usable. |
| Empty (nothing in the active period, no filters) | Card: "Belum ada surat masuk." (or "keluar"). Managers: "Catat surat pertama dengan tombol di atas." Others: "Surat akan muncul di sini setelah sekretaris mencatatnya." |
| Empty for the period but older letters exist | When "Periode aktif" is chosen and there are none: "Belum ada surat di periode ini." with text button "Lihat semua periode". |
| No match | Card: "Tidak ada hasil. Ubah pencarian atau filter." with text buttons "Hapus pencarian" and "Reset". |
| Error | Warning alert "Terjadi gangguan. Coba lagi sebentar lagi." with outline button "Coba lagi". Controls above stay. Never "no access". |
| No active period | The register segments are gone (3.4). A direct link shows `ForbiddenScreen` with the period sentence. |
| Forbidden | `ForbiddenScreen` (P-SEKDEP, plain member, admin without BPH). |
| Success | Not applicable (read screen). Export has its own messages (screen 11). Returning from a form shows its success message at the top. |

### 5.4 Accessibility and touch

- The list is `<ul>` of cards on phones (`aria-label="Daftar surat masuk, halaman 1 dari 3"`), a real `<table>` with a caption from 1024 px. In the table the number cell is the row header and the link.
- Tab order: primary button, search, Filter, Ekspor, filter tags, cards, pagination.
- Targets: 48 (primary, search, selects, checkbox row), 44 (Filter, Ekspor, tag remove, Reset, pagination), cards are 96 px or more of link. Gaps 8 px or more.
- The result line "Menampilkan 1-20 dari 42 surat" is `role=status`.
- Text pairs: body brown `#4F453B` on white 9.35:1; meta `#7A6652` on white 5.45:1; chips as in Inventory section 17.
- 1024 px and up: table with columns Nomor, Pengirim (or Ditujukan kepada), Perihal (2 lines), Tanggal, Berkas, Status; zebra rows, ivory header, 48 px minimum row, number never cut (it wraps at the slashes); the filter card always open in one row (Periode, Tahun nomor, Status, Tanpa berkas); tiles in one row.

---

## 6. Screen 3: Letter detail

**Goal.** Show everything about one letter: its number, files, who registered it and what changed. For managers, the place to edit, add files and void.

**Who sees it.** `letters.view`. "Ubah rincian", "Tambah berkas", "Tarik berkas" and "Batalkan nomor" need `letters.manage`, and only on an Aktif letter of the active period (spec F4). Withdrawn files are visible only to managers (A-LT9). Without the key: `ForbiddenScreen`. A letter that does not exist answers "Surat ini tidak ditemukan."

**Path.** From the register -> reads the number and details -> "Lihat" a file -> (manager) "Ubah rincian", "Tambah berkas", or "Batalkan nomor".

### 6.1 Wireframe (narrow column, 390 px; a manager, Aktif, two files, from a request)

```
+----------------------------------------------+
|  < Surat Keluar                              |  text button, 44 px
|  Detail Surat Keluar                         |  Playfair 24
|  (Aktif)                                     |  chips
|                                              |
|  +----------------------------------------+  |  NUMBER PLATE, gold tint, r12
|  | Nomor surat                            |  |  body-sm #7A6652 on white label
|  | PMK/NEX/SK/2026/012                    |  |  numeric-metric 20/26 bold #2C1E11
|  | [ Salin nomor ]                        |  |  text button, 44 px
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |  only when it applies (info tone)
|  | (i) Surat dari periode 2025/2026.      |  |
|  | Hanya bisa dibaca.                     |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Rincian                                |  |  headline-sm
|  | Perihal        [Perihal surat]         |  |  label / value rows (dl)
|  | Ditujukan      [Nama penerima]         |  |
|  | kepada                                 |  |
|  | Tanggal surat  12 Okt 2026             |  |
|  | Catatan        [teks, bila ada]        |  |
|  | Periode        2026/2027               |  |
|  | Dari           [Perihal permohonan]    |  |  link, only for view_all holders
|  | permohonan     oleh [Nama pemohon]     |  |
|  | Dicatat        [Nama sekretaris]       |  |
|  |                14 Okt 2026, 10.12 WIB  |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Berkas (2)                             |  |
|  | [PDF] surat-keluar-012.pdf             |  |
|  |       1,2 MB            [ Lihat ]      |  |  44 px
|  |----------------------------------------|  |
|  | [Foto] foto-lampiran.jpg  (Ditarik)    |  |  managers only
|  |       0,8 MB . Alasan: [teks]          |  |
|  |       [ Lihat ]                        |  |
|  | [ + Tambah berkas ]                    |  |  outline, managers only
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Riwayat                                |  |  Timeline, newest first
|  |  (o) Rincian diubah oleh [Nama]        |  |
|  |  |   16 Okt 2026, 09.05 WIB            |  |
|  |  |   Perihal: "[lama]" menjadi "[baru]"|  |
|  |  (o) Dicatat oleh [Nama]               |  |
|  |      14 Okt 2026, 10.12 WIB            |  |
|  +----------------------------------------+  |
|  [            Ubah rincian                ]  |  outline, managers only
|  [            Batalkan nomor              ]  |  outline, managers only
+----------------------------------------------+
```

Surat Masuk differs in the Rincian rows: "Diterima {tanggal}", "Tanggal surat" (if filled), "Pengirim", "Nomor dari pengirim" (if filled), "Perihal", "Catatan", "Periode", "Dicatat". It has no "Dari permohonan" row.

### 6.2 Banners above Rincian (at most one of each, info tone)

| When | Text |
|---|---|
| Letter is Dibatalkan | "Nomor ini dibatalkan pada 20 Okt 2026 oleh [Nama]. Alasan: [teks]. Nomor tidak dipakai lagi dan suratnya tidak bisa dipulihkan." All buttons of the manager are absent. A chip "Dibatalkan" (grey) sits next to "Aktif" being absent. |
| Letter of a non-active period (Aktif) | "Surat dari periode 2025/2026. Hanya bisa dibaca." |
| Letter without any visible file, Aktif, in the active period (managers only) | "Belum ada berkas. Tambahkan berkas setelah suratnya selesai." with the "Tambah berkas" button in the Berkas card. |

Chips next to the title: "Aktif" (success) or "Dibatalkan" (grey), and "Nomor lama" (ivory) when the number was typed from an old letter.

### 6.3 Fields and actions

| Item | Specification |
|---|---|
| "Salin nomor" | Copies the stored number text. Success "Nomor disalin." (`role=status`). Present for every viewer; it changes nothing. |
| "Lihat" (file) | Asks the server for a signed link at the moment of pressing and opens it in a new tab. Errors: "Berkas tidak bisa dibuka. Coba lagi." Each file row shows type, name (long names break at word, never overflow), size and, for managers on withdrawn files, the chip "Ditarik" (grey) and the reason. |
| "+ Tambah berkas" | Managers, Aktif letter of the active period, fewer than 3 visible files. Opens a bottom sheet (dialog 7.3). At 3: the text "Sudah 3 berkas. Tarik satu kalau perlu menggantinya." |
| "Tarik berkas" | A text button on each visible file, managers only. Dialog 7.2. |
| "Ubah rincian" | Opens screen 4 in edit mode. |
| "Batalkan nomor" | Dialog 7.1. |
| Riwayat | Newest first. Event texts: "Dicatat oleh {nama}", "Rincian diubah oleh {nama}" (with "{Isian}: "{lama}" menjadi "{baru}"" for each changed field), "Berkas ditambahkan: {nama file}", "Berkas ditarik: {nama file}" (reason as detail), "Nomor dibatalkan oleh {nama}" (reason as detail). Names come from PI-CORE; never any email or phone. More than 5 entries: the rest sit behind a "Lihat semua riwayat ({n})" disclosure. |

### 6.4 States

| State | What shows |
|---|---|
| Loading | Title, a plate skeleton, three flat cards, caption "Memuat surat...". |
| Not found | Card "Surat ini tidak ditemukan." with text button "Kembali ke daftar". |
| Error | Warning alert with "Coba lagi". |
| Conflict (changed while a dialog was open) | "Data sudah berubah. Muat ulang." |
| Success | After a manager saves an edit, adds a file, withdraws a file or voids, this page shows the success message ("Perubahan disimpan." / "Berkas ditambahkan." / "Berkas ditarik." / "Nomor dibatalkan."). |
| Empty (no files) | Berkas card: "Belum ada berkas." for everyone; managers also see the button. |
| Forbidden | `ForbiddenScreen`. |

### 6.5 Accessibility and touch

- One `h1`; the cards are `section`s with `h2`; Rincian is a `<dl>`. The plate has `aria-label="Nomor surat {nomor}"`, which reads the number with its parts.
- Targets: buttons 48; "Salin nomor", "Lihat", "Tarik berkas" 44; the back link 44.
- The chip text "Dibatalkan" and the banner both say it; the strike or colour is never the only signal.
- 1280 px: Rincian and Berkas sit left, Riwayat sits in a right column (from 1024 px); the plate spans the top; max width 1024 px.

---

## 7. Screen 4: Register and edit a letter ("Catat Surat Masuk", "Catat Surat Keluar", "Ubah rincian", "Nomor lama")

**Goal.** Let a secretary register a letter once and correctly, get its number, and later fix a typo with a history.

**Who sees it.** `letters.manage`. Anyone else reaching the address sees `ForbiddenScreen`. Edit works only on an Aktif letter of the active period (spec F4), otherwise the detail shows no button.

**Path (register).** Register tab -> "+ Catat Surat ..." -> fills the fields -> adds files (optional) -> "Simpan Surat" -> lands on the detail with "Surat dicatat. Nomornya PMK/NEX/SM/2026/012." and a link "Catat surat lain".

### 7.1 Wireframe: Surat Masuk (narrow column, 390 px)

```
+----------------------------------------------+
|  < Surat Masuk                               |
|  Catat Surat Masuk                           |  Playfair 24
|                                              |
|  +----------------------------------------+  |  info card
|  | Nomor surat                            |  |
|  | Dibuat otomatis saat disimpan dan tidak|  |
|  | bisa diubah. Lihat pengaturan nomor.   |  |  link to screen 10 (read view)
|  +----------------------------------------+  |
|  +----------------------------------------+  |  checkbox card, r12, 44+ px
|  | [ ] Surat lama                         |  |
|  |     Pilih ini untuk mencatat surat yang|  |
|  |     sudah punya nomor dari sebelum     |  |
|  |     NEXUS.                             |  |
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |
|  | Surat                                  |  |
|  | Tanggal diterima (wajib)               |  |
|  | [dd/mm/yyyy                          ] |  |  default today, not in the future
|  | Pengirim (wajib)                       |  |
|  | [                                    ] |  |
|  | Perihal (wajib)                        |  |
|  | [                                    ] |  |  textarea 3 rows
|  | Tanggal surat (boleh kosong)           |  |
|  | [dd/mm/yyyy                          ] |  |
|  | Nomor surat dari pengirim (boleh kosong)|  |
|  | [                                    ] |  |
|  | Catatan (boleh kosong)                 |  |
|  | [                                    ] |  |  textarea
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [ FilePicker, 3.3 ]                    |  |
|  +----------------------------------------+  |
|  [             Simpan Surat               ]  |
|  Batal                                       |
+----------------------------------------------+
```

"Surat lama" checked adds a field at the top of the Surat card and an info alert:

```
|  | Nomor lama (wajib)                     |  |
|  | [                                    ] |  |  typed exactly as on the old letter
|  | (i) Nomor ini dicatat apa adanya dan   |  |
|  | tidak menggeser urutan nomor otomatis. |  |
|  | Nomor yang sudah ada tidak bisa        |  |
|  | dicatat dua kali.                      |  |
```
With "Surat lama" checked the first card changes to "Nomor surat: ditulis sendiri di bawah" and the date fields may be in the past (no limit on how far).

### 7.2 Wireframe: Surat Keluar (differences only)

```
|  Catat Surat Keluar                          |
|  +----------------------------------------+  |
|  | Nomor surat                            |  |
|  | Dibuat otomatis saat disimpan. Catat   |  |
|  | dulu untuk mendapat nomor, lalu tulis  |  |
|  | suratnya dengan nomor itu dan tambahkan|  |
|  | berkasnya nanti.                       |  |
|  +----------------------------------------+  |
|  [ ] Surat lama  (same card as above)        |
|  | Tanggal surat (wajib)                  |  |  default today, not in the future
|  | Ditujukan kepada (wajib)               |  |
|  | Perihal (wajib)                        |  |
|  | Catatan (boleh kosong)                 |  |
|  | [ FilePicker ]  (boleh kosong)         |  |
```
Reason for the sentence in the first card: the number has to be printed on the letter before it is signed, so a secretary registers first. This is the K5 decision, and it is why files are optional here.

### 7.3 Wireframe: edit ("Ubah rincian")

```
|  < Detail Surat Keluar                       |
|  Ubah rincian                                |
|  +----------------------------------------+  |
|  | Nomor surat                            |  |
|  | PMK/NEX/SK/2026/012                    |  |  read-only, plain text
|  | Nomor tidak bisa diubah.               |  |
|  +----------------------------------------+  |
|  ... same fields, filled; no FilePicker ...  |
|  [          Simpan Perubahan              ]  |
|  Batal                                       |
```
Files are managed on the detail ("Tambah berkas", "Tarik berkas"), not in the edit form: each file action has its own history row and its own reason.

### 7.4 Fields

| Field | Applies to | Type | Validation | Error text |
|---|---|---|---|---|
| Surat lama | both, register only | checkbox card | Off by default. Not offered in edit. | |
| Nomor lama | both, only when "Surat lama" is on | text, wajib | 1 to 60 characters; refused if the same text already exists (the register or a past "Nomor lama") | "Isi nomor lama." / "Nomor ini sudah ada di register." |
| Tanggal diterima | incoming | date, wajib | Default today (Jakarta). Not in the future. | "Pilih tanggal diterima." / "Tanggal diterima tidak boleh setelah hari ini." |
| Tanggal surat | incoming (boleh kosong), outgoing (wajib) | date | Not in the future (A-LT19). Outgoing default today. | "Pilih tanggal surat." / "Tanggal surat tidak boleh setelah hari ini." |
| Pengirim | incoming | text, wajib | 1 to 150 characters | "Isi pengirim." / "Pengirim terlalu panjang. Pakai paling banyak 150 karakter." |
| Ditujukan kepada | outgoing | text, wajib | 1 to 150 | "Isi tujuan surat." / "Terlalu panjang. Pakai paling banyak 150 karakter." |
| Perihal | both | textarea, wajib | 1 to 200 | "Isi perihal." / "Perihal terlalu panjang. Pakai paling banyak 200 karakter." |
| Nomor surat dari pengirim | incoming | text, boleh kosong | up to 60 | "Terlalu panjang. Pakai paling banyak 60 karakter." |
| Catatan | both | textarea, boleh kosong | up to 500 | "Catatan terlalu panjang. Pakai paling banyak 500 karakter." |
| Berkas | register only | FilePicker, boleh kosong | up to 3, PDF/JPG/PNG, 5 MB | see 3.3 |

Limits are those of A-LT18; the database enforces them too (LT-44). Counterpart label by type: "Pengirim" for incoming, "Ditujukan kepada" for outgoing, the same words in the list, detail and export.

### 7.5 Actions

| Action | What it does |
|---|---|
| "Simpan Surat" | Server validates. Success: the detail with the success message "Surat dicatat. Nomornya PMK/NEX/SM/2026/012." (number in bold) and a text link "Catat surat lain" that opens a fresh form of the same type. One history row ("Dicatat"). Problems: a summary alert at the top ("Ada {n} isian yang perlu diperbaiki.", Inventory 3.4) and the first field focused; the button is never greyed. |
| "Simpan Surat" with "Surat lama" on | First opens a check sheet (3.3 of Inventory): title "Periksa nomor lama", text "Nomor yang kamu tulis: [nomor]. Nomor ini tidak bisa diubah setelah disimpan." buttons "Simpan Surat" and "Periksa lagi". **[PROPOSAL P9]** Reason: a typed number is the one number nobody checks for the person, and the spec says a number is never editable. |
| "Simpan Perubahan" | Saves the changed fields, one history row with before and after. If nothing changed: "Belum ada yang diubah." under the button (no save, no history row). |
| "Batal" | Back, with "Buang perubahan?" if anything was typed or a file chosen (Inventory 3.4). |

### 7.6 First-use hint (no number set yet)

When no automatic number of this type has ever been issued in this calendar year and no starting number was set, managers see an info alert above the form: "Nomor pertama akan menjadi 001. Kalau PMK sudah punya surat bernomor tahun ini, minta System Admin mengatur nomor berikutnya dulu." Reason: spec L7 (a). A fresh counter at go-live would repeat numbers already on paper. **[PROPOSAL P10]** Needs a flag "never set" from the numbering settings (G6).

### 7.7 States

| State | What shows |
|---|---|
| Loading (edit) | Flat skeleton of the cards, caption "Memuat form...". |
| Saving | Button spinner and "Menyimpan..."; fields read-only; a second press is ignored. |
| Validation | Summary alert and field errors (Inventory 3.4). |
| No active period | No form. Warning alert "Belum ada periode aktif. Surat belum bisa dicatat." with text button "Kembali". |
| Number consumed rule | A failed save or upload uses no number (spec R2): "Berkas gagal diunggah. Coba lagi." and nothing is saved. |
| Conflict | "Data sudah berubah. Muat ulang." Typed text is kept where possible. |
| Server error | Warning alert above the button: "Terjadi gangguan. Coba lagi sebentar lagi." Input kept. |
| Letter is not editable (Dibatalkan, old period) | The address answers with an info card: "Surat ini tidak bisa diubah." and text button "Kembali ke surat". |
| Forbidden | `ForbiddenScreen`. |
| Success | The detail with the message above. |
| Empty | Not applicable (a form). |

### 7.8 Accessibility and touch

- Sections are `fieldset`s with legends. The "Surat lama" card is one `label` around a native checkbox, the whole card is the target (56 px or more).
- Field errors are text with an icon, linked by `aria-describedby`; the summary lists links to the fields (Inventory 3.4).
- Native date inputs (phone pickers). Fields 48 px, 16 px text; the focused field scrolls above the keyboard (`scroll-mb-24`).
- Wider screens: one column (max 448 px); from 1024 px the FilePicker card sits beside the field card.

---

## 8. Screen 5: Dialogs on the letter detail (void, withdraw a file, add a file)

All use the bottom sheet of Inventory 3.3 (390 px: sheet at the bottom with 12 px top corners; from 768 px centred, 448 px wide). Escape closes, focus returns to the button that opened it. Buttons stacked, 48 px, primary on top, text cancel underneath. A conflict ("Data sudah berubah. Muat ulang.") or a server error stays inside the dialog above the buttons.

### 8.1 "Batalkan nomor" (void)

- Title: "Batalkan nomor?"
- Text: "Nomor [nomor] tetap tercatat di register sebagai Dibatalkan dan tidak akan dipakai lagi. Suratnya tidak bisa dipulihkan. Kalau suratnya masih perlu, catat surat baru dengan nomor baru."
- Extra paragraph only when the letter came from a request: "Surat ini diterbitkan dari permohonan [Perihal permohonan]. Permohonannya tetap berstatus Diterbitkan dan pemohon akan melihat tanda Nomor dibatalkan."
- Field: "Alasan (wajib)", textarea. Error "Tulis alasan pembatalan."
- Buttons: "Batalkan nomor" (primary) and "Kembali" (text).
- Success: the detail shows "Nomor dibatalkan." and the grey banner of 6.2.

### 8.2 "Tarik berkas" (withdraw)

- Title: "Tarik berkas?"
- Text: "[nama file] disembunyikan dari semua orang kecuali pengelola surat. Berkasnya tidak dihapus dan tetap ada di riwayat."
- Field: "Alasan (wajib)". Error "Tulis kenapa berkas ini ditarik."
- Buttons: "Tarik berkas" and "Kembali".
- Blocked case (G4): when this is the last visible file of a letter that came from a request, the dialog shows a warning alert instead of the confirm button: "Ini satu-satunya berkas yang dilihat pemohon. Tambahkan berkas pengganti dulu, lalu tarik yang salah." and one button "Mengerti".

### 8.3 "Tambah berkas"

- Title: "Tambah berkas"
- Body: the FilePicker (3.3) with the count of room left ("Boleh menambah {n} berkas lagi.").
- Buttons: "Simpan berkas" (primary) and "Batal". Saving with an upload still running is refused with the message of 3.3.
- Success: "Berkas ditambahkan." One history row per file.

---

## 9. Screen 6: Request form ("Ajukan Surat")

**Goal.** Let any active member ask the secretaries for a letter and say enough that no one has to chase them.

**Who sees it.** Every active member (fixed right, spec L9). With no active period the form is replaced by a message (spec R7).

**Path.** Permohonan Saya -> "+ Ajukan Surat" -> fills the fields -> adds attachments (optional) -> "Ajukan Surat" -> lands on the request detail with "Permohonan terkirim. Cek statusnya di Permohonan Saya."

### 9.1 Wireframe (narrow column, 390 px)

```
+----------------------------------------------+
|  < Kembali                                   |
|  Ajukan Surat                                |  Playfair 24
|                                              |
|  +----------------------------------------+  |  info card
|  | Sekretaris akan menyiapkan dan         |  |
|  | menerbitkan suratnya. Kamu bisa        |  |
|  | mengunduh hasilnya di Permohonan Saya. |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |  only when a cap is reached (3.4)
|  | (!) Kamu sudah punya 5 permohonan yang |  |
|  | berjalan. ...                          |  |
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |
|  | Isi surat                              |  |
|  | Perihal (wajib)                        |  |
|  | [                                    ] |  |  textarea 2 rows
|  | Tulis pokok isi surat dalam satu       |  |  hint, body-sm
|  | kalimat.                               |  |
|  | Ditujukan kepada (wajib)               |  |
|  | [                                    ] |  |
|  | Nama orang atau lembaga yang menerima  |  |
|  | surat.                                 |  |
|  | Keperluan (wajib)                      |  |
|  | [                                    ] |  |  textarea 4 rows, grows to 8
|  | Jelaskan apa yang dibutuhkan: kegiatan,|  |
|  | tanggal, dan hal lain yang perlu masuk |  |
|  | ke surat.                              |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Tambahan                               |  |
|  | Atas nama (boleh kosong)               |  |
|  | [                                    ] |  |
|  | Isi kalau suratnya atas nama panitia   |  |
|  | atau tim, misalnya nama kegiatan.      |  |
|  | Dibutuhkan paling lambat (boleh kosong)|  |
|  | [dd/mm/yyyy                          ] |  |
|  | Sekretaris melihat tanggal ini di      |  |
|  | antrean.                               |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Lampiran                               |  |
|  | [ FilePicker, 3.3 ]                    |  |
|  | Lampirkan berkas pendukung, misalnya   |  |
|  | proposal atau draf.                    |  |
|  +----------------------------------------+  |
|  [              Ajukan Surat              ]  |
|  Batal                                       |
+----------------------------------------------+
```

"Ajukan lagi" opens the same form prefilled from a rejected or cancelled request, with an info alert at the top: "Diisi dari permohonan sebelumnya. Periksa lagi sebelum mengirim." Attachments are not copied (G15).

### 9.2 Fields

| Field | Type | Validation | Error text |
|---|---|---|---|
| Perihal | textarea, wajib | 1 to 200 | "Isi perihal surat." / "Perihal terlalu panjang. Pakai paling banyak 200 karakter." |
| Ditujukan kepada | text, wajib | 1 to 150 | "Isi tujuan surat." / "Terlalu panjang. Pakai paling banyak 150 karakter." |
| Keperluan | textarea, wajib | 1 to 1000 | "Isi keperluannya supaya sekretaris tahu apa yang ditulis." / "Keperluan terlalu panjang. Pakai paling banyak 1000 karakter." |
| Atas nama | text, boleh kosong | up to 120 | "Terlalu panjang. Pakai paling banyak 120 karakter." |
| Dibutuhkan paling lambat | date, boleh kosong | Not before today (Jakarta) | "Tanggal tidak boleh sebelum hari ini." |
| Lampiran | FilePicker, boleh kosong | up to 3, PDF/JPG/PNG, 5 MB | see 3.3 |

Never a requester field: the saved requester is the signed-in member and the period is the active period, both set by the server (spec F5.3).

### 9.3 Actions

| Action | What it does |
|---|---|
| "Ajukan Surat" | Server validates everything again. Saves as Diajukan. Goes to the request detail with the success message. Pressing with problems: the summary alert and the first problem field focused. A cap refusal shows the alert of 3.4 at the top. The button is never greyed. |
| "Batal" | Back, with "Buang perubahan?" if anything was typed. |

### 9.4 States

| State | What shows |
|---|---|
| No active period | No form. Warning alert "Belum ada periode aktif. Permohonan belum bisa dibuat." and text button "Kembali". |
| Loading | Skeleton of the cards, caption "Memuat form...". |
| Submitting | "Mengirim..." with spinner; fields read-only; second press ignored. |
| Cap reached | Alert above the form and the same text as the refusal (3.4). |
| Upload failed | The request is not saved: "Berkas gagal diunggah. Coba lagi." |
| Server error / network | Warning alert above the button (Inventory 3.6); input kept. |
| Right removed | "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA." |
| Success | Request detail (screen 7) with "Permohonan terkirim. Cek statusnya di Permohonan Saya." |
| Empty | Not applicable. |

### 9.5 Accessibility and touch

- `fieldset`s with legends "Isi surat", "Tambahan", "Lampiran". Hints are linked with `aria-describedby`.
- Fields 48 px (textareas at least 3 rows), 16 px text; buttons 48.
- Wider screens: one column (max 448 px) centred.

---

## 10. Screen 7: Permohonan Saya (list) and request detail (requester view)

**Goal.** Let a member see where each request stands, read what the secretary said, and download the letter once it is issued. This is the only status channel because NEXUS sends no notifications.

**Who sees it.** Every active member, own requests only (fixed right, spec L9). A BPH member or a secretary also sees their own requests here, with no extra rights.

**Path.** Opens "Permohonan Saya" -> sees open requests first -> opens one -> reads the timeline and the note -> downloads the file, or cancels (only while Diajukan), or asks again.

### 10.1 Wireframe: list (390 px)

```
|  [ header card: "Permohonan 2 berjalan" ]    |
|  [ segmented control, if more than one ]     |
|  [         + Ajukan Surat                ]   |  primary, 48 px; absent without a period
|                                              |
|  (Berjalan) (Selesai) (Semua)                |  filter tags, single choice
|                                              |
|  +----------------------------------------+  |  request card, r12
|  | [Perihal permohonan, 2 baris]          |  |  body-md semibold
|  | Kepada [Penerima]                      |  |
|  | Diajukan 9 Des 2026       (Diproses)   |  |  chip
|  | Sedang disiapkan oleh [Nama].          |  |  text
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Perihal permohonan]                   |  |
|  | Kepada [Penerima]                      |  |
|  | Diajukan 2 Des 2026     (Diterbitkan)  |  |
|  | Nomor PMK/NEX/SK/2026/012              |  |  bold, tabular
|  | Berkas siap diunduh.                   |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Perihal permohonan]                   |  |
|  | Diajukan 1 Des 2026       (Ditolak)    |  |
|  | Catatan dari [Nama]: [dua baris        |  |
|  | pertama catatan...]                    |  |
|  +----------------------------------------+  |
|     [< Prev]  [1] [2]  [Next >]              |
|     Menampilkan 1-20 dari 24 permohonan      |
```

Each card is one link (visible focus ring around the card). Order: open requests (Diajukan, Diproses) first, newest first; then closed ones, newest first. Card line text by status:

| Status | Card line under the date |
|---|---|
| Diajukan | "Menunggu sekretaris." |
| Diproses | "Sedang disiapkan oleh [Nama]." |
| Diterbitkan | "Nomor [nomor]" and "Berkas siap diunduh." If the number was voided: chip "Nomor dibatalkan" (grey) and the line "Nomor ini dibatalkan. Ajukan lagi kalau suratnya masih perlu." |
| Ditolak | "Catatan dari [Nama]: [first 2 lines]" |
| Dibatalkan | "Kamu membatalkan permohonan ini." |

### 10.2 Wireframe: request detail (requester, narrow column)

```
+----------------------------------------------+
|  < Permohonan Saya                           |
|  [Perihal permohonan]                        |  Playfair 24, wraps
|  (Diterbitkan)                               |  chip
|                                              |
|  +----------------------------------------+  |  NUMBER PLATE, only when Diterbitkan
|  | Nomor surat                            |  |
|  | PMK/NEX/SK/2026/012                    |  |
|  | [ Salin nomor ]                        |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |  state line by status (10.3)
|  | Suratmu sudah terbit. Unduh berkasnya  |  |
|  | di bawah.                              |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Berkas surat                           |  |  only when Diterbitkan and number not voided
|  | [PDF] surat-keluar-012.pdf             |  |
|  |       1,2 MB            [ Unduh ]      |  |  44 px, signed link on press
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Permohonan                             |  |
|  | Ditujukan      [Penerima]              |  |
|  | kepada                                 |  |
|  | Atas nama      [teks, bila ada]        |  |
|  | Keperluan      [teks]                  |  |
|  | Dibutuhkan     15 Des 2026             |  |
|  | paling lambat                          |  |
|  | Diajukan       9 Des 2026, 10.12 WIB   |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Lampiran (2)                           |  |  own attachments
|  | [PDF] proposal.pdf        [ Lihat ]    |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |  only after a decision
|  | Catatan dari sekretaris                |  |
|  | [Nama sekretaris]                      |  |
|  | 10 Des 2026, 14.05 WIB                 |  |
|  | "[Catatan]"                            |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Riwayat                                |  |  Timeline, newest first
|  |  (o) Diterbitkan, dicatat [Nama]       |  |
|  |  |   10 Des 2026, 14.05 WIB            |  |
|  |  (o) Diproses oleh [Nama]              |  |
|  |  |   9 Des 2026, 15.20 WIB             |  |
|  |  (o) Diajukan                          |  |
|  |      9 Des 2026, 10.12 WIB             |  |
|  +----------------------------------------+  |
|  [ Batalkan permohonan ]                     |  outline; only while Diajukan
|  [ Ajukan lagi ]                             |  outline; Ditolak or Dibatalkan
+----------------------------------------------+
```

The "Catatan dari sekretaris" card shows on Ditolak always (the note is required), and on Diproses or Diterbitkan when the secretary wrote one.

### 10.3 Status text and what each says to the requester

| Status | Chip (screen 13) | State line on the detail |
|---|---|---|
| Diajukan | Diajukan (ivory) | "Menunggu sekretaris. Kamu masih bisa membatalkannya sampai sekretaris mulai memprosesnya." |
| Diproses | Diproses (warning) | "Sekretaris sedang menyiapkan suratmu. Permohonan ini sudah tidak bisa dibatalkan. Kalau ada yang perlu diubah, hubungi sekretaris di luar aplikasi." |
| Diterbitkan | Diterbitkan (success) | "Suratmu sudah terbit. Unduh berkasnya di bawah." |
| Diterbitkan, number voided | Diterbitkan (success) and Nomor dibatalkan (grey) | Warning alert: "Nomor surat ini sudah dibatalkan oleh pengelola surat, jadi berkasnya tidak tersedia lagi. Ajukan permohonan baru kalau kamu masih membutuhkan surat." The file card is not shown (G5). |
| Ditolak | Ditolak (destructive) | "Permohonan ditolak. Baca catatan sekretaris di bawah." The button "Ajukan lagi" appears. |
| Dibatalkan | Dibatalkan (grey) | "Permohonan dibatalkan." With who cancelled and the reason in the timeline. The button "Ajukan lagi" appears. |

### 10.4 Actions

| Action | Who and when | What it does |
|---|---|---|
| "Batalkan permohonan" | The requester, only while Diajukan (A-LT6). Absent after Diproses. | Dialog: title "Batalkan permohonan?", text "Permohonan tidak bisa dibuka lagi. Kamu bisa membuat permohonan baru.", field "Alasan (boleh kosong)". Buttons "Batalkan permohonan" and "Kembali". Success "Permohonan dibatalkan." |
| "Ajukan lagi" | The requester, on Ditolak or Dibatalkan | Opens screen 6 prefilled (P14). |
| "Unduh" | The requester, only when Diterbitkan and the number is not voided | Signed link made when pressed. Error "Berkas tidak bisa dibuka. Coba lagi." |
| "Lihat" (attachment) | The requester and `view_all` holders | Same. |

### 10.5 States

| State | What shows |
|---|---|
| Loading | Flat card skeletons, caption "Memuat permohonan...". |
| Empty (no requests at all) | Card: "Kamu belum punya permohonan." with a primary button "Ajukan Surat". |
| Empty for a filter | "Tidak ada permohonan di sini." and text button "Lihat semua". |
| Not found or someone else's request | Card "Permohonan ini tidak ditemukan." (same answer for both, so it reveals nothing). |
| Error | Warning alert with "Coba lagi". |
| No active period | Banner; the list and the detail stay readable (spec R7, L9). |
| Cancel succeeds | Detail with the success message. |
| Conflict (a secretary took it while the dialog was open) | "Data sudah berubah. Muat ulang." |
| Waiting too long | No special state. NEXUS has no reminder; "Menunggu sekretaris." stays. If nobody holds `process` the requester sees the same line (spec R12 says "Menunggu"). |

### 10.6 Accessibility and touch

- The timeline is the shared `Timeline` (ordered list; dots decorative; current step bold; each entry has a `<time>`).
- The plate has the same `aria-label` as screen 3. Cards are one 44 px or taller link. Buttons 48; "Unduh", "Lihat", "Salin nomor" 44.
- Status is always in the chip text and the state line, never colour alone.
- Wider screens: from 1024 px "Riwayat" sits in a right column.

---

## 11. Screen 8: Antrean Permohonan (queue)

**Goal.** Give the secretaries one list of what needs them, oldest first, and a way to see everything not finished across periods for the handover.

**Who sees it.** `letter_requests.view_all` (included in `process`). The action buttons need `process`. BPH without `process` sees the list and the details, no buttons. There is **no export** here (A-LT17).

**Path.** Opens Antrean -> sees "Menunggu" oldest first -> opens a request (screen 9) -> processes it.

### 11.1 Wireframe (390 px)

```
|  [ header card with tiles, "Permohonan menunggu" ] |
|  [ segmented control, Antrean active ]       |
|                                              |
|  Tampilkan                                   |
|  [Menunggu (3)                            v] |  select, 48 px
|  [Q] Cari pemohon atau perihal...            |
|  [ Filter tanggal  v ]                       |
|                                              |
|  +----------------------------------------+  |  lone processor hint (3.4)
|  | (i) Hanya kamu yang bisa memproses ... |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Nama pemohon]             (Diajukan)  |  |
|  | [Perihal permohonan]                   |  |
|  | Kepada [Penerima] . Atas nama [Tim]    |  |
|  | Diajukan 9 Des 2026 . 2 lampiran       |  |
|  | Dibutuhkan paling lambat 15 Des 2026   |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Nama] Pengajuanmu    (Diajukan)       |  |
|  | ...                                    |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Nama pemohon] (Diproses) (Lewat tanggal)|
|  | ...                                    |  |
|  | Dibutuhkan paling lambat 8 Des 2026    |  |
|  +----------------------------------------+  |
|     [< Prev]  [1] [2]  [Next >]              |
|     Menampilkan 1-3 dari 3 permohonan        |
```

"Tampilkan" options (the count in brackets, only where it helps this person):

| Option | Contains | Default for |
|---|---|---|
| Menunggu | Diajukan, oldest first | `process` holders |
| Sedang diproses | Diproses, oldest first | |
| Selesai | Diterbitkan, Ditolak, Dibatalkan, newest first | |
| Semua | All of the active period | BPH without `process` |
| Belum selesai, semua periode | Diajukan and Diproses of every period (handover, 11.3) | |

Filters: status (the select), a date range ("Filter tanggal" card with Dari and Sampai, requests submitted in that range), requester name (the search, which also matches Perihal). Same filter-card style as screen 2.

Card contents: requester name (PI-CORE name), the plain text marker "Pengajuanmu" for the viewer's own, Perihal, "Kepada ..." and "Atas nama ..." when filled, "Diajukan {tanggal}" and "{n} lampiran" when there are any, and the needed-by line when filled. A whole card is the link to the review page.

**Derived "Lewat tanggal"** (warning chip, secretaries only, never shown to the requester): the needed-by date is before today and the request is still Diajukan or Diproses. In the card the needed-by line also reads "Dibutuhkan paling lambat 8 Des 2026 (lewat 3 hari)". **[PROPOSAL P15, small]**.

### 11.2 Elements and states

| Item | Specification |
|---|---|
| Order | Menunggu: oldest first (spec F6.1). |
| Own request | Plain text "Pengajuanmu" next to the name; the review page has no buttons (screen 9). |
| Lone processor hint | 3.4. Needs a count of `process` holders, a number the server already computes for the A-n9 hint. |

| State | What shows |
|---|---|
| Loading | Flat card skeletons, caption "Memuat antrean...". |
| Empty queue (Menunggu) | "Tidak ada permohonan yang menunggu." |
| Empty (other option) | "Tidak ada permohonan di sini." |
| No match | "Tidak ada hasil. Ubah pencarian atau filter." with "Reset". |
| Error | Warning alert (Inventory 3.6). |
| Forbidden | `ForbiddenScreen`; with no active period it adds the period sentence (spec R7). |
| Right removed while open | "Aksesmu sudah berubah..." on the next action. |
| Success | Not applicable (read screen). |

### 11.3 Handover view ("Belum selesai, semua periode")

```
|  Tampilkan                                   |
|  [Belum selesai, semua periode            v] |
|  +----------------------------------------+  |
|  | (i) Daftar ini untuk serah terima      |  |
|  | pengurus. Isinya semua permohonan yang |  |
|  | belum selesai, termasuk dari periode   |  |
|  | sebelumnya.                            |  |
|  +----------------------------------------+  |
|  5 belum selesai: 3 menunggu, 2 diproses.    |  body-md, real counts
|                                              |
|  Periode 2025/2026 (2)                       |  h2, Playfair headline-lg
|  [ cards as above ]                          |
|  Periode 2026/2027 (3)                       |
|  [ cards as above ]                          |
```
Group heading per period, oldest period first, then oldest request first inside it. Old-period requests stay actionable by whoever holds the key now (spec F9.3), so the buttons on their detail work as usual; an issued letter from an old request is registered in the active period (shown on screen 9). Empty: "Tidak ada permohonan yang belum selesai." Loading: "Memuat daftar...". Wider screens: groups become tables.

### 11.4 Accessibility and touch

- Select and cards use the same markup as screen 2 and Inventory 11.1. Counts in the options are part of the option text.
- Each period group is a `section` with `h2` ("Periode 2025/2026, 2 permohonan" read in full).
- Cards are 44 px or taller links; select 48; filter and pagination 44.
- 768 px and up: cards become table rows (Pemohon, Perihal, Diajukan, Dibutuhkan, Status); the table is the same pattern as the register.

---

## 12. Screen 9: Request review, Proses, Tolak and Terbitkan

**Goal.** Let a secretary act on a request with all facts in front of her, and issue a letter in one safe step that gives the requester a number and a file.

**Who sees it.** `letter_requests.view_all` sees the page. The action buttons need `letter_requests.process` and are **absent on the viewer's own request** (access control L6). A BPH member without `process` sees the page with no buttons.

**Path.** Antrean -> opens a request -> reads the fields and attachments -> "Proses permohonan" or "Terbitkan surat" or "Tolak permohonan".

### 12.1 Wireframe: review (same page as screen 7, extra panel; 390 px)

```
|  < Antrean                                   |
|  [Perihal permohonan]                        |  Playfair 24
|  (Diajukan) (Lewat tanggal)                  |  chips
|                                              |
|  +----------------------------------------+  |  only when it applies
|  | (i) Permohonan ini dari periode        |  |
|  | 2025/2026. Suratnya akan dicatat di    |  |
|  | periode 2026/2027.                     |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |  only when the requester is deactivated
|  | (i) Pemohon sudah tidak aktif.         |  |
|  | Permohonan tetap bisa diproses.        |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Permohonan                             |  |
|  | Pemohon        [Nama]                  |  |
|  | Atas nama      [teks, bila ada]        |  |
|  | Ditujukan      [Penerima]              |  |
|  | kepada                                 |  |
|  | Keperluan      [teks, penuh]           |  |
|  | Dibutuhkan     15 Des 2026             |  |
|  | paling lambat  (lewat 3 hari)          |  |
|  | Diajukan       9 Des 2026, 10.12 WIB   |  |
|  +----------------------------------------+  |
|  [ Lampiran card, with "Lihat" per file ]    |
|  +----------------------------------------+  |
|  | Tindakan                               |  |
|  | [        Proses permohonan           ] |  |  primary (while Diajukan)
|  | [        Terbitkan surat             ] |  |  outline
|  | [        Tolak permohonan            ] |  |  outline
|  +----------------------------------------+  |
|  [ Riwayat card ]                            |
```

Own request, no buttons:

```
|  +----------------------------------------+  |
|  | (i) Tidak bisa memproses permohonanmu  |  |
|  | sendiri. Sekretaris lain yang          |  |
|  | memutuskan. Kamu bisa mencatat suratmu |  |
|  | langsung di Surat Keluar.              |  |  second sentence only with letters.manage
|  +----------------------------------------+  |
```
With only one `process` holder a second line: "Saat ini hanya ada satu sekretaris yang bisa memproses, jadi permohonan ini menunggu sekretaris lain." (A-n9.)

**Order of the buttons (P8).** While Diajukan: primary "Proses permohonan", then "Terbitkan surat", then "Tolak permohonan". While Diproses: primary "Terbitkan surat", then "Tolak permohonan". The panel sits **directly under the Lampiran card** and before Riwayat, as Inventory 24 moved its buttons next to the facts they use. Reason: the primary button is the most likely next step. "Terbitkan surat" straight from Diajukan stays available (A-LT5) as an outline button, for a small task that needs no waiting.

### 12.2 Dialogs (bottom sheets, Inventory 3.3)

**"Proses permohonan".**
- Title "Proses permohonan?"
- Text: "Pemohon akan melihat permohonannya sedang diproses dan tidak bisa membatalkannya lagi."
- Field "Catatan untuk pemohon (boleh kosong)".
- Buttons "Proses permohonan" and "Batal". Success "Permohonan diproses."

**"Tolak permohonan".**
- Title "Tolak permohonan?"
- Field "Alasan penolakan (wajib)", hint "Pemohon akan membaca alasan ini." Error "Tulis alasan penolakan, supaya pemohon tahu."
- Buttons "Tolak permohonan" and "Batal". Success "Permohonan ditolak."

Conflict on any of them: "Data sudah berubah. Muat ulang." with "Muat ulang".

### 12.3 Wireframe: "Terbitkan surat" (its own page, narrow column)

```
+----------------------------------------------+
|  < Permohonan                                |
|  Terbitkan surat                             |  Playfair 24
|                                              |
|  +----------------------------------------+  |
|  | [Nama pemohon]            (Diproses)   |  |  summary card
|  | [Perihal permohonan]                   |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |  info card, the number question (G1)
|  | Nomor surat                            |  |
|  | Nomor berikutnya: PMK/NEX/SK/2026/012  |  |  bold, "belum dipesan"
|  | Nomor ini belum dipesan. Dibuat saat   |  |
|  | kamu menekan Terbitkan Surat. Pastikan |  |
|  | berkasnya memakai nomor yang sama.     |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Isi surat                              |  |
|  | Perihal (wajib)                        |  |  prefilled from the request
|  | [                                    ] |  |
|  | Ditujukan kepada (wajib)               |  |  prefilled
|  | [                                    ] |  |
|  | Tanggal surat (wajib)                  |  |  default today, not in the future
|  | [dd/mm/yyyy                          ] |  |
|  | Catatan untuk pemohon (boleh kosong)   |  |
|  | [                                    ] |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Berkas surat (wajib, 1 sampai 3)       |  |
|  | [ FilePicker, 3.3 ]                    |  |
|  +----------------------------------------+  |
|  [            Terbitkan Surat             ]  |
|  Batal                                       |
+----------------------------------------------+
```

Old-period request: an info alert at the top: "Permohonan ini dari periode 2025/2026. Suratnya dicatat di periode aktif 2026/2027."

### 12.4 Check sheet before issuing

Pressing "Terbitkan Surat" with valid input opens a check sheet: title "Terbitkan surat ini?", text "Nomor surat dibuat sekarang dan tidak bisa diubah. Pemohon bisa mengunduh berkasnya begitu suratnya terbit.", buttons "Terbitkan surat" and "Periksa lagi". **[PROPOSAL P7]** Reason: a number is consumed and never reused (spec R2). One calm check is cheap insurance, and it is the same idea as "Simpan pengembalian?" in Inventory.

### 12.5 Number mismatch (G1 option c)

The page sends the number it showed. If another letter took it in the meantime, the server saves nothing and the sheet shows a warning alert: "Nomor berikutnya sudah berubah menjadi PMK/NEX/SK/2026/013. Berkas yang kamu unggah mungkin memakai nomor lama." with buttons "Terbitkan dengan nomor baru" and "Periksa lagi". No number is used until the person chooses. **[PROPOSAL P6, depends on the owner's answer to G1]**

### 12.6 Fields

| Field | Type | Validation | Error text |
|---|---|---|---|
| Perihal | textarea, wajib | 1 to 200; may differ from the request | "Isi perihal surat." |
| Ditujukan kepada | text, wajib | 1 to 150 | "Isi tujuan surat." |
| Tanggal surat | date, wajib | Not in the future; default today | "Pilih tanggal surat." / "Tanggal surat tidak boleh setelah hari ini." |
| Catatan untuk pemohon | textarea, boleh kosong | up to 500 | "Catatan terlalu panjang. Pakai paling banyak 500 karakter." |
| Berkas surat | FilePicker, wajib | 1 to 3 | "Tambahkan minimal satu berkas surat." |

### 12.7 Actions and results

| Action | Result |
|---|---|
| "Terbitkan Surat" (after the check) | One transaction: next SK number, linked outgoing register row, file(s) attached, request set to Diterbitkan. Goes to the review page with "Surat terbit. Nomornya PMK/NEX/SK/2026/012." and, for `letters.view` holders, a text link "Lihat di register". |
| Failure of any step | Nothing is saved and no number is used: "Surat belum terbit. Tidak ada nomor yang terpakai. Coba lagi." |
| "Batal" | Back, with "Buang perubahan?" if anything changed. |

### 12.8 States

| State | What shows |
|---|---|
| Loading | Skeleton of the summary and the cards, caption "Memuat form...". |
| Request already decided (second secretary, other device) | "Data sudah berubah. Muat ulang." |
| Own request | The page shows only the info alert of 12.1, no form. |
| Upload failed | "Berkas gagal diunggah. Coba lagi." Nothing saved. |
| No active period | "Belum ada periode aktif. Surat belum bisa dicatat." |
| Saving | "Menerbitkan..." with spinner; fields read-only. |
| Server error | Warning alert above the button, input and uploaded files kept. |
| Forbidden | `ForbiddenScreen`. |
| Success | The review page with the success message. |

### 12.9 Accessibility and touch

- Review page buttons 48, stacked, 8 px gaps; dialog and sheet buttons 48; Escape closes, focus returns to the button that opened the dialog.
- The number card is plain text with `role=status` when the mismatch message replaces it.
- Fields 48 px, 16 px text; the keyboard never covers the focused field (`scroll-mb-24`).
- Wider screens: Terbitkan stays one column (max 448 px); on 1024 px the review page puts Riwayat in a right column.

---

## 13. Screen 10: Numbering settings ("Penomoran Surat")

**Goal.** Let the System Admin set the number format once and continue the numbers PMK already used on paper, and let the secretaries read it.

**Who sees it.** The System Admin always (access control L3), with fields. Holders of `letters.manage` (BPH secretaries) see the same page read-only (A-LT12). Everyone else: `ForbiddenScreen`. No new permission key.

**Path.** Pengaturan -> "Penomoran Surat" -> (admin) edits the format or sets the next number -> sees the change in the history. Secretaries reach it from the link on the register form.

The NEXUS settings area has no design yet. This screen is designed as a page of its own with a "Kembali" link; where the link lives is gap G10.

### 13.1 Wireframe: System Admin (narrow column, 390 px)

```
+----------------------------------------------+
|  < Kembali                                   |
|  Penomoran Surat                             |  Playfair 24
|                                              |
|  +----------------------------------------+  |  info card
|  | Perubahan hanya berlaku untuk surat    |  |
|  | yang dinomori sesudahnya. Nomor yang   |  |
|  | sudah ada tidak berubah.               |  |
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |
|  | Nomor berikutnya                       |  |  headline-sm
|  | Tahun 2026                             |  |
|  |----------------------------------------|  |
|  | Surat masuk                            |  |
|  | Terakhir dipakai   045                 |  |
|  | Nomor berikutnya                       |  |
|  | PMK/NEX/SM/2026/046                    |  |  bold, tabular
|  | [ Atur nomor berikutnya ]              |  |  text button, 44 px
|  |----------------------------------------|  |
|  | Surat keluar                           |  |
|  | Terakhir dipakai   belum ada           |  |
|  | Nomor berikutnya                       |  |
|  | PMK/NEX/SK/2026/001                    |  |
|  | [ Atur nomor berikutnya ]              |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Format nomor                           |  |
|  | Awalan (wajib)                         |  |
|  | [PMK/NEX                             ] |  |
|  | Kode surat masuk (wajib)               |  |
|  | [SM                                  ] |  |
|  | Kode surat keluar (wajib)              |  |
|  | [SK                                  ] |  |
|  | Jumlah angka urutan (wajib)            |  |
|  | [3                                   ] |  |  number, 1 to {max}
|  | Pemisah (wajib)                        |  |
|  | [/                                   ] |  |
|  | [x] Sertakan tahun                     |  |  checkbox row, 48 px
|  |                                        |  |
|  | Hasilnya untuk nomor berikutnya        |  |  live preview, role=status
|  | PMK/NEX/SM/2026/046                    |  |
|  | PMK/NEX/SK/2026/001                    |  |
|  | [          Simpan format             ] |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Riwayat perubahan                      |  |  Timeline, newest first
|  |  (o) Format diubah oleh [Nama]         |  |
|  |  |   [tanggal, jam WIB]                |  |
|  |  |   Awalan: "[lama]" menjadi "[baru]" |  |
|  |  (o) Nomor berikutnya surat masuk 2026 |  |
|  |      diatur ke 046 oleh [Nama]         |  |
|  |      Alasan: [teks]                    |  |
|  +----------------------------------------+  |
+----------------------------------------------+
```

The two blocks sit in a fixed order: "Nomor berikutnya" first (what the admin must do at go-live, spec L7 (a)), "Format nomor" second.

### 13.2 Fields

| Field | Type | Rule | Error text |
|---|---|---|---|
| Awalan | text, wajib | 1 to {n} characters; letters, digits, slash, hyphen, dot | "Isi awalan." / "Pakai huruf, angka, garis miring, titik, atau tanda hubung." |
| Kode surat masuk, Kode surat keluar | text, wajib | 1 to {n}; same characters; the two codes must differ | "Isi kode." / "Kode surat masuk dan surat keluar tidak boleh sama." |
| Jumlah angka urutan | number, wajib | Whole number 1 to {max}. Past the limit the sequence just grows (spec 4.3). | "Isi angka bulat, 1 sampai {max}." |
| Pemisah | text, wajib | 1 character from the allowed set | "Isi satu tanda pemisah." |
| Sertakan tahun | checkbox | Default on | |
| Preview | read-only | Rebuilds as the fields change, using the real next sequence of each type (not a fixed "001"), so it shows exactly what the next letter will get. | |

A change that would produce a number text that already exists is refused (spec R5): "Format ini menghasilkan nomor yang sudah dipakai ([nomor]). Ubah formatnya."

### 13.3 Actions and dialogs

| Action | What it does |
|---|---|
| "Simpan format" | Opens a check sheet: title "Simpan format baru?", text "Nomor berikutnya akan menjadi [nomor baru], bukan [nomor lama]. Nomor yang sudah ada tidak berubah. Perubahan ini dicatat.", buttons "Simpan format" and "Periksa lagi". Success: "Format disimpan." |
| "Atur nomor berikutnya" | Sheet. Title "Atur nomor berikutnya". Shows "Jenis: Surat masuk" and "Tahun: 2026" as plain text. Field "Nomor berikutnya (wajib)", hint "Terakhir dipakai: 045. Isi angka yang lebih besar dari itu." with the live result "Hasilnya: PMK/NEX/SM/2026/046". Field "Alasan (wajib)", placeholder "Contoh: melanjutkan nomor dari buku surat." Error "Isi angka bulat yang lebih besar dari {nomor terakhir}." / "Tulis alasannya." Buttons "Simpan nomor" and "Batal". Success "Nomor berikutnya diatur." |

Rule proposed (G6, P11): the next number can only go **up**, never down or equal to the last one used, so a number can never repeat. The admin sets it once at go-live and rarely after.

### 13.4 Read-only variant (BPH secretary)

Same page. The two cards show the values as text (a `<dl>`: Awalan, Kode surat masuk, Kode surat keluar, Jumlah angka urutan, Pemisah, Tahun disertakan, and the two "Nomor berikutnya" lines), with no buttons and one info line at the top: "Hanya System Admin yang bisa mengubah penomoran. Hubungi admin PMK ITERA kalau ada yang perlu diubah." The history card stays.

### 13.5 States

| State | What shows |
|---|---|
| Loading | Flat skeleton of the cards, caption "Memuat pengaturan...". |
| Not set yet | Counters show "Terakhir dipakai: belum ada" and the next number "001" (3.2). For the admin an info alert at the top: "Kalau PMK sudah punya surat bernomor tahun ini, atur nomor berikutnya dulu sebelum sekretaris mencatat surat." |
| Saving | "Menyimpan..." with spinner; fields read-only. |
| Validation | Summary alert and field errors (Inventory 3.4). |
| Refused format | The error of 13.2 above the button; input kept. |
| Conflict | "Data sudah berubah. Muat ulang." |
| Error | Warning alert (Inventory 3.6). |
| Forbidden | `ForbiddenScreen`. |
| No active period | The page works (the admin can open settings, access control AC-43). |
| Success | The page again with the success message. |
| Empty history | "Belum ada perubahan." |

### 13.6 Accessibility and touch

- Fields 48 px, checkbox row 48 px, buttons 48, text buttons 44. The preview is `role=status` so a screen reader hears the new number after each change.
- Cards are `section`s with `h2`; the counters are a `<dl>`.
- Wider screens: "Nomor berikutnya" and "Format nomor" sit side by side from 1024 px; the history card spans below.

---

## 14. Screen 11: Export menu

**Goal.** Download the register of the current tab as Excel, CSV or PDF, the same way as Data Anggota and Inventory.

**Who sees it.** `letters.export` on Surat Masuk and Surat Keluar. The button is **absent** for everyone else. The request list has no export (A-LT17), so Antrean and Permohonan Saya show no button.

### 14.1 Wireframe (identical to Inventory 15.1)

```
   [ Ekspor  v ]
   +------------------------------+
   | Unduh semua hasil filter     |
   | sebagai:                     |
   | Excel (.xlsx)                |   44 px rows
   | CSV (.csv)                   |
   | PDF (.pdf)                   |
   | Surat yang dibatalkan ikut   |   body-sm, plain text
   | diunduh dengan statusnya.    |
   +------------------------------+
```

### 14.2 Text and behaviour

| Item | Text |
|---|---|
| Button | "Ekspor" (44 px, outline walnut, download icon, chevron) |
| Menu intro | "Unduh semua hasil filter sebagai:" |
| Formats | "Excel (.xlsx)", "CSV (.csv)", "PDF (.pdf)" |
| Note | "Surat yang dibatalkan ikut diunduh dengan statusnya." (so number gaps are explainable, spec F8.2) |
| Busy | Spinner and "Menyiapkan file..." (a second press ignored) |
| Done | "Unduhan dimulai: {nama file}" (`role=status`). File names `surat-masuk-{tanggal}.xlsx` and `surat-keluar-{tanggal}.xlsx` (same for csv and pdf). |
| Errors | The Data Anggota messages (refused, invalid filter, unavailable, no network), unchanged. If the log row cannot be written, no file is returned and the "unavailable" message shows. |

Rules carried over (spec F8): all matching rows (not only the page), same order and columns as the screen, header with the period filter and the export date in WIB, dates in WIB, no file contents and no links, one export-log row before the file is returned.

### 14.3 States, accessibility, touch

- States: closed, open, busy, done, error (as Inventory 15.3). No empty state: the button appears only when there are rows. Keyboard: Enter or Space opens; Tab through the three formats; Escape closes and returns focus; a press outside closes.
- Targets: button 44, menu rows 44.

---

## 15. Screen 12: Dashboard card "Surat Menyurat"

**Goal.** Show how many letters this period holds and, for the secretaries, how many requests wait. Counts only, never a subject or a counterpart.

**Who sees it.** `letters.view` holders (spec L11 (a), access control A-n1). The "menunggu" line needs `letter_requests.view_all`. Regular members get **no card** (no view right); they use "Permohonan Saya". The card is designed here; its place on the Dashboard is the Dashboard module's decision.

### 15.1 Wireframe (390 px, full-width `DashboardCard`)

```
+----------------------------------------------+
|  [envelope tile]  Surat Menyurat             |  gold-tint icon tile 44 px + headline-sm
|                                              |
|   12                          9              |  numeric-metric 20/26 bold #2C1E11
|   surat masuk                 surat keluar   |  body-sm #7A6652
|   di periode 2026/2027        di periode     |
|                               2026/2027      |
|                                              |
|  (only with view_all)                        |
|  3 permohonan menunggu                       |  text link to Antrean, 44 px
|  ------------------------------------------  |  hairline
|  Buka register                            >  |  foot link, 48 px
+----------------------------------------------+
```

### 15.2 Copy

| Item | Text |
|---|---|
| Title | "Surat Menyurat" (Stitch name) |
| Figures | "{n} surat masuk", "{m} surat keluar", both with "di periode {label}" |
| Screen-reader label | "{n} surat masuk dan {m} surat keluar di periode {label}, {k} permohonan menunggu" |
| Links | Foot link "Buka register" (to Surat Masuk). For `view_all`: "{k} permohonan menunggu" (to Antrean, "Menunggu"). |
| Empty | "Belum ada surat di periode ini." (no zeros as figures) |
| Loading | Two flat ivory bars (60 x 24, 90 x 12), caption "Memuat data surat...", no shimmer in the reduced-motion setting |
| Error | In the card only, so the rest of the Dashboard stays: "Data surat belum bisa dimuat." and text button "Coba lagi" |
| No active period | The card is absent (the register is unreadable then, spec R7). |

Definitions (G9, to confirm): "surat masuk" and "surat keluar" count Aktif letters of the active period; Dibatalkan letters are not counted. "Menunggu" counts Diajukan requests of all periods, so an open request of an old period is never hidden. The card shows a letter title, counterpart, subject or number **nowhere** (Stitch's "Dokumen Resmi Terakhir" tile is not used, spec L11).

### 15.3 Accessibility and touch

- Figures are text. `#2C1E11` on white 15+:1; `#7A6652` on white 5.45:1. No meaning is carried by colour.
- Links 44 px; the foot link 48 px (as `DashboardCardLink`).
- Wider screens: the two figures sit in one row; half-width placement would need the figures stacked, as noted for Inventory (P7 there).

---

## 16. Screen 13: Status chip set

**Goal.** One chip family for every request status, register status and marker. The words carry the meaning; colour only repeats it.

**Anatomy.** Exactly the `StatusChip` of Inventory section 17 (pill, 24 px, 1 px border, 11 px bold, sentence case, no dot, no icon, no animation). Tones are the five that exist; none is added.

| Chip text | Tone | Meaning | Where |
|---|---|---|---|
| Diajukan | Ivory | Waiting for a secretary | Request lists and detail, queue |
| Diproses | Warning | A secretary took it; the requester can no longer cancel | same |
| Diterbitkan | Success | Letter issued, number and file exist | same |
| Ditolak | Destructive | Rejected, note given | same |
| Dibatalkan (request) | Grey | Cancelled by the requester | same |
| Aktif | Success | Register entry in use | Letter detail, filter tags, settings history |
| Dibatalkan (letter) | Grey | Number voided, still in the register | Register rows, detail, export |
| Nomor lama | Ivory | Registered with a number from before NEXUS | Register rows, detail |
| Nomor dibatalkan | Grey | The number behind an issued request was voided | Request lists and detail |
| Ditarik | Grey | A file withdrawn by a manager | Letter detail, managers only |
| Lewat tanggal | Warning | Needed-by date passed and the request is still open | Queue and review, secretaries only |

**Why these choices.**
- "Dibatalkan" is grey in both places (request cancelled, number voided): in both cases something ended without a result. The word is the same because the meaning is the same.
- "Diproses" is amber because Stitch already used amber for "in progress" ("Sedang Diproses", "Sedang Dipinjam"); only the tone mapping is taken, not the Stitch wording.
- "Aktif" is on the detail and in filters, not on every list row (K9, P3). The register row stays calm, and the one chip you see is the exception.
- Chip text does not depend on the tint: "Nomor dibatalkan" still says it with all colour removed. High-contrast and forced-colours modes keep the 1 px border.
- Pills are used only for these chips and the filter tags (D-014). The segmented control, the checkbox cards and the buttons are 8 or 12 px.
- A row shows at most two chips: the status plus the one marker that matters most.

---

## 17. Contrast check

Pairs already computed in `inventory-borrowing.md` section 18 are reused unchanged (white on `#62431F` 8.97, `#4F453B` on white 9.35, `#4F453B` on `#F0E9DC` 7.74, `#62431F` on `#F0E9DC` 7.43, `#7A6652` on white 5.45, the five chip tones 5.59 to 7.30, `#932924` on white 8.13, focus line 8.97, `#81756A` as a non-text border 4.48 against 3:1). One pair is new here:

| Pair | Ratio | Result |
|---|---|---|
| `#4F453B` on the header tint `--nx-gold-tint` (`#F8F3E5`), the one-line text under the title | about 8.4 | pass |

`#7A6652` is never used on ivory or on the gold tint (it only passes by 4.52 on ivory); meta lines sit on white. Gold `#C59A27` carries no text. Computed by hand with the WCAG 2.x formula because this agent has no shell; QA should repeat the new pair with `contrast-check.py`.

---

## 18. Anti-slop and design self-check

- **Default dashboard shell:** none. Each screen is built around one decision: find a letter (register), ask for one (request form), follow it (my requests), decide (review), issue (Terbitkan), set the numbering. The only figures are real counts defined in the spec; none is a percent or a trend.
- **Invented content:** none. Counterparts, subjects, people and dates are [placeholders]. The number format is the D-024 format and is labelled a setting. No testimonials, no activity feed. Stitch filler is listed in section 2 and not used.
- **Generic tables and menus:** columns are chosen for the decision (number first, then counterpart and Perihal). No row menu; every action is a visible text button naming its result.
- **Decoration:** no gradients of my own, no glass, no left stripes, no decorative dots or eyebrow pills. The warm header card and the icon tile of the Dashboard card come from D-023 (already approved and built). Shadow only on cards (Stitch level 1) and dialogs (level 2). Radius: 8 controls, 12 cards, pills only on chips and filter tags.
- **Colour:** only theme variables. Gold carries no text. The single accent is walnut on actions; the single module motif is the number plate.
- **Icons:** envelope (the module), paperclip (a file exists), download, copy, calendar (period pill), each beside text. None is a generic AI glyph.
- **States:** every data screen lists empty, loading, error, forbidden or not applicable, and no-active-period where it matters. Empty states name the cause and the next step ("Belum ada surat di periode ini." with "Lihat semua periode").
- **Copy:** no exclamation marks, buzzwords, em dashes or emoji. Buttons name the action ("Catat Surat Masuk", "Proses permohonan", "Terbitkan Surat", "Batalkan nomor"), never "Lanjut" or "Kirim". "Kamu" throughout. Messages name the actor or the object.
- **Human:** keyboard path, focus order and targets per screen; no `outline: none`; messages are text first; dialogs close with Escape and return focus; the number wraps at slashes so zoom to 200% reflows; the phone keyboard never covers a field; the number reads as one phrase to a screen reader.
- **Resilience:** one conflict message for every "someone else changed it"; a failed upload or save never uses a number; buttons are never greyed as the way to refuse.
- **Competitor test:** the module is a register by nature, but the Stitch walnut bar, the "kamu" voice, the number plate, "register first, then write" and the Aktif/Dibatalkan vocabulary are particular to PMK NEXUS.
- **Delivery gate for a design document:** nothing was run in a browser (R-35 not applicable), so every control was checked by reading this document against the Stitch tokens, the built components and the spec. Em dash search: none in this file. Skill scripts (`impeccable context`, taste `draw.mjs`, `inspect.mjs`, `contrast-check.py`) could not be run (no shell); their written guidance was applied and Stitch tokens were the visual source. Hard Gate items R-02, R-03, R-17, R-18, R-23 to R-28, R-32, R-36 to R-38: pass by inspection (targets listed per screen, no fake numbers or logos, every control has a result, states listed, keyboard listed).

---

## 19. Proposals needing the owner (P1 onward)

Same convention as the inventory design: **P1 to P3, P6, P9, P11** are the ones I would like an answer to; the rest I will assume unless you object.

| # | Question | Options | Recommendation |
|---|---|---|---|
| P1 | Navigation inside the module | (a) four segments: Surat Masuk, Surat Keluar, Permohonan Saya, Antrean (this design; a member sees one); (b) two levels: Register and Permohonan; (c) fold Antrean into Permohonan Saya | (a) |
| P2 | Counts on the segments | (a) no count on the register tabs, counts in the header tiles; "(n)" only on Antrean for "needs your action" (this design); (b) "Surat Masuk (12)" as the spec F1 says | (a): a bracket count cannot follow the search and filters |
| P3 | Chip on register rows | (a) only Dibatalkan and "Nomor lama" show a chip; Aktif is the quiet default; (b) every row has "Aktif" or "Dibatalkan" as spec F1 says | (a) |
| P4 | Wide register | (a) cards on phones and tablet, a table from 1024 px in a column up to 1024 px; (b) keep the 768 px column and cards everywhere | (a) |
| P5 | Small helpers outside the spec: "Salin nomor" and "Catat surat lain" | (a) keep both; (b) drop them | (a): both save real taps |
| P6 | The number on the final file (also G1) | (a) as spec: number assigned when the file is issued, no preview (secretary cannot know the number to print); (b) show "Nomor berikutnya" on Terbitkan with a mismatch warning (this design); (c) a step "Ambil nomor" that reserves a number at Diproses | (b) |
| P7 | Check sheet before issuing a letter | (a) "Terbitkan surat ini?" sheet; (b) no check | (a) |
| P8 | Button order on the review page | (a) Diajukan: "Proses permohonan" primary, "Terbitkan surat" outline; Diproses: "Terbitkan surat" primary; (b) always "Terbitkan surat" primary | (a) |
| P9 | "Nomor lama" mode | (a) checkbox card "Surat lama" with a check sheet showing the typed number before saving; (b) a separate form for old letters | (a) |
| P10 | First-use hint when no numbering start was set | (a) info alert on the register form for managers; (b) none | (a) |
| P11 | Numbering settings | (a) two cards (next number, format) plus a change history; the next number can only go up, with a reason; (b) free editing of the counter | (a) |
| P12 | Dashboard card | (a) counts only, "{n} surat masuk, {m} surat keluar di periode {label}", plus "{k} permohonan menunggu" for view_all; (b) add the latest letter tile | (a) |
| P13 | Chip colours | as section 16 (Diproses amber, Dibatalkan grey in both places) | as shown |
| P14 | "Ajukan lagi" | (a) button on Ditolak and Dibatalkan, form prefilled, attachments not copied; (b) no button | (a) |
| P15 | "Lewat tanggal" chip for secretaries | (a) show on the queue and review when the needed-by date passed; (b) show nothing | (a) |

Small items I will assume unless you object: the h1 of a letter detail is "Detail Surat Masuk" and the number plate carries the number (K4); the request detail is titled by its Perihal (G2); an old letter registered as "Nomor lama" gets the active period (G7); register order is newest registered first (G8).

---

## 20. Gaps where the spec is silent (G1 onward)

| # | Gap | What I did / recommendation |
|---|---|---|
| **G1** | **The number must be printed on the letter before it is signed, but a request issues the number and the file in one step** (spec F6.4, LT-13). With the spec as approved, the file a secretary uploads cannot contain the number NEXUS assigns, unless she guesses it. Direct registration (F3) does not have this problem because files are optional, so she registers, gets the number, writes the letter, and adds the file later. | Screen 9 shows "Nomor berikutnya" (not reserved) and warns on mismatch (P6 (b)). It needs no spec change except one backend rule: the issue call carries the number shown and refuses if it changed. Alternatives: (c) reserve the number at Diproses (a voided number if abandoned), or relax LT-13 so a request can be issued first and the file added after. **Please decide**; this is the biggest question in this document. |
| G2 | Requests have no reference code like `PJM-0001`. | No reference. The detail title is the Perihal, and the date identifies it. If you want one, copy the Inventory pattern (one sequence, never reused, assigned by the database). |
| G3 | Spec F4 lists the editable fields but not the received date. | Designed as editable (typing mistakes are common), with history. |
| G4 | Do withdrawn files count toward the limit of 3? And can the file the requester downloads be withdrawn? | Withdrawn files do not count. The last visible file of a letter that came from a request cannot be withdrawn until a replacement is added (dialog 8.2). Needs the analyst's OK. |
| G5 | Voided number behind an issued request: may the requester still download? Do they see the void reason? | Designed: the file is hidden and the reason is not shown (a voided letter should not circulate; the reason is internal). The requester sees "Nomor dibatalkan" and a way to ask again. |
| G6 | "Set the next sequence once" (L7 a): can it go down, and for which year? Is there a "never set" flag? | Only up, with a reason, current year only; a flag "never set" feeds the first-use hint (7.6, P10, P11). |
| G7 | A letter registered with "Nomor lama" gets the active period (spec F2) even if it is from an older period or year; a typo in the typed number cannot be edited (the number is never editable). | The active period is used. The typed number is checked in a sheet before saving (P9). A wrong one is voided and registered again. |
| G8 | Register sort order, and whether the period filter can pick one specific old period. | Newest registered first; only "Periode aktif" and "Semua periode" (the year filter narrows the rest). |
| G9 | Definitions of the counts in the header tiles and the Dashboard card (L11 does not say whether Dibatalkan counts, or which periods "menunggu" covers). | Aktif only; "menunggu" counts Diajukan of all periods. |
| G10 | The NEXUS settings area (access rules editor, numbering) has no design or route yet. How does a BPH secretary reach the read view? Where is the numbering-change log read? | Screen 10 is designed on its own with a "Kembali" link; the register form links to its read view for managers; the last changes show in the page's own history card. The settings shell needs its own design. |
| G11 | May the requester see the names of the secretary who processed or issued? | Yes, in the timeline and on the cards (PI-CORE names only, as G8 in Inventory). Confirm. |
| G12 | Whether a deactivated requester's request shows a marker to the secretary. | Info alert "Pemohon sudah tidak aktif. Permohonan tetap bisa diproses." (spec R8). Needs the active flag through `src/lib/picore/`. |
| G13 | Where a secretary lands. | The first segment she has (Surat Masuk), with the Antrean number visible. No guessing by counts. |
| G14 | Image resize target for readable letters. | About 2000 px long side, under 5 MB (an assumption; the engineer may tune it). |
| G15 | Are attachments copied when "Ajukan lagi" is used? | Not copied; the person adds them again. |
| G16 | The request form's "Dibutuhkan paling lambat" semantics: only a hint for the secretary, no promise. | Hint text says so ("Sekretaris melihat tanggal ini di antrean."). No automatic reminder (no notifications in Phase 1). |
| G17 | Icon set. `login.md` names Material Symbols, the app is built with Lucide (Inventory G12). | Left as built; icons are named by meaning. |

---

## 21. Verification notes

- No design file was run or rendered. Sizes come from the Stitch scale, the Stitch HTML structure of screens 10 and 11 (segmented control, cards), and the built components listed in the sources.
- Contrast values were computed by hand (section 17). The script could not run; QA should repeat the new pair.
- Not covered here: the settings shell and the access rules editor (G10), the export-log reading screen (A-MD14), the Dashboard layout around the card, and the "how to start a new period" guide (the handover filter of screen 8 belongs in it).
- Numbers and counts in the wireframes are format examples. Every PMK fact (counterparts, subjects, officers) is a placeholder; nothing here was invented as data.
