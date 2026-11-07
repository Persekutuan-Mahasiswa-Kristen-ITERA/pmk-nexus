# Inventory and Borrowing ("Manajemen & Inventaris"): screen design

> Status: **PROPOSED, waiting for owner approval.** Nothing is built. Words and ASCII only, no code.
> Scope: the 14 screens listed in section 4 to section 17 for `docs/modules/inventory-borrowing.md` (APPROVED revision 2; sections 2, 3, 4, 5, 9, 11, 12).
> Sources: `CLAUDE.md` section 8; `docs/DECISIONS.md` D-014, D-017, D-021, D-022; `docs/design/stitch/design-system.md`, `screens.md` (12, 13, 14, the drawer, and the Surat segmented control in 10); `docs/design/login.md` (approved D-017); what is built for Data Anggota (`src/modules/member-data/ui/*`) and the shell (`src/components/shell/*`, `src/components/ui/*`, `src/components/access/forbidden-screen.tsx`).
> All item names, people, references and dates in the wireframes are **placeholders** written in [brackets] or as plain format examples. PMK has not supplied item names, categories or locations (IB10), so none are invented. Stitch filler (Drum Elektrik, Koordinator, H-3, 80%, group borrowers, Inv-001/LOG) is not used.
> Language: UI copy is Indonesian with "kamu". Everything else is English. No em dashes, no emoji, no exclamation marks in UI copy.

**Design Read.** Work tool for PMK members (students on a phone, often standing next to a shelf) and for the Operations team (handing items out and taking them back), in the Stitch "Executive Heritage Modern" style. Mode: Operate (the tool disappears into the task). Dials: **ENERGY 1 / RHYTHM 2 / MOTION 1**. Reason: these screens are for doing a job (find an item, ask for it, decide, hand over, check back in), so they stay calm and predictable. RHYTHM is 2 because lists, cards, forms and dialogs differ on purpose. Identity comes from the flat walnut bar, Playfair headings and the one gold ring already in the shell, nothing added.

---

## 1. Key decisions and why (simple words)

| # | Decision | Why |
|---|---|---|
| K1 | One module, four route-based sections shown as a segmented control: Katalog, Peminjaman Saya, Antrean, Kelola Barang. A member sees only the first two. | Each section answers one question: "what exists", "where is my request", "what needs me", "what do I maintain". The Stitch Surat screen (10) already uses this control, so it is not a new pattern. Showing only what a person may use keeps it short for most members. |
| K2 | Catalog rows show "4 dari 5 baik", not a percentage and not a stock bar. | Owner IB12: counts, no percentage. Counts are what a person needs when deciding "is there enough". |
| K3 | A tracked item row has an expander ("Lihat 5 unit"); a quantity item row shows its single code. | This is the visible difference between the two modes. A person sees at once whether they are looking at one pool or at separate units. |
| K4 | The request form asks for dates first, then items. | Availability depends on the dates. With dates known, every item line can say "Tersedia 3 dari 4" the moment it is added. |
| K5 | The "Setujui" and "Tolak" actions open a small dialog (a bottom sheet on phones). | A decision needs a note field and a conflict message. A dialog keeps the head on the request, with the facts still visible behind it. |
| K6 | Stock changes on an existing item go through three named dialogs (Tambah jumlah, Ubah kondisi, Keluarkan dari stok), never through free number fields. | Every change must leave a history row with a reason (spec F2 step 5). A dialog names the intent ("move 2 from Baik to Rusak"), so the history is honest and a typo cannot silently change the stock. |
| K7 | Return screen: default is "everything came back good". The person taps only the exceptions. | Most returns are clean. The common case takes one tap (Catat pengembalian); damaged or lost needs a note and a photo, by owner decision IB8. |
| K8 | Buttons that start a save are never greyed out. A refusal is shown as a message next to the problem. | Same rule as login (K6 in `login.md`): a grey button fails contrast and hides the reason. |
| K9 | Actions a person may not do are absent, not greyed (spec section 2). | Matches the access rules and the existing Data Anggota export button. |
| K10 | Names of other borrowers never appear for members. Availability is counts and dates only. | Spec R8 and IB-18. |
| K11 | Status chips always carry the meaning in text; colour only repeats it. | Colour-blind and low-vision users. Section 17. |
| K12 | The Dashboard card shows counts as plain figures, with the clarification that the "on loan" units are part of the "good" units. | Spec A-IB32 counts loaned units as baik. Shown side by side without a hint it reads as 42 + 5. See P7. |

---

## 2. Deviations from Stitch and from existing screens (reason FIRST)

Nothing here is applied silently. Items marked **[needs OK]** change something the owner already approved or add a look that is not in Stitch.

| # | What differs | Reason | Status |
|---|---|---|---|
| X1 | Stitch 12/13/14 put loan cards and the inventory master on one scroll. Replaced by four sections. | Members may only see their own requests (L9) and the catalog; the heads' and Ops' lists need their own screens. Already decided in spec section 6. | Decided by spec |
| X2 | The Stitch tiles "Total Aset / Dipinjam / Siap Pakai", "Kondisi Baik 91%", the 80% bar and the progress bar are dropped. | Owner IB12: counts only. | Approved by owner (D-022) |
| X3 | The Stitch brown pill labels ("Manajemen Peminjaman", "Master Aset", "3 Aktivitas") and the "PMK-NEXUS" ribbon chip above the heading are not used. | D-014: pills only for status chips and filter tags. A pill above a heading repeats the heading. | Follows D-014 |
| X4 | "Detail Tiket" becomes "Detail Pengajuan". | "Tiket" is a help-desk word. People say pengajuan or peminjaman. The spec already says this link needs a real screen. | **[needs OK]** (P14, minor) |
| X5 | The H-3 notice and "Koordinator Logistik" text are removed. | Filler (IB4, spec section 6). | Decided by spec |
| X6 | The segmented control (Stitch 10) shows counts as plain text in brackets, "Antrean (3)", not in a gold pill. | A pill is for a status. A count is not a status. Also gold text/fills on light backgrounds fail contrast. | **[needs OK]** |
| X7 | On a phone the catalog filter card is folded behind a "Filter (n)" button; applied filters show underneath as removable filter tags. | The catalog has five filter controls. Open by default they push the first item below the first screen (about 480 px of controls). Data Anggota has two, so it can stay open there. | **[needs OK]** (P3) |
| X8 | The list of requests uses cards, not the table used for members. | A request has name, items, dates, two chips and a warning. A 4-column table at 390 px would cut names. Stitch 12 also uses cards for loans. | Consistent with Stitch |
| X9 | A "success" message tone (Stitch success palette `#205E3F` on `#EDF7F1`, border `#BCDDC8`) is added to `AlertMessage`. | Login had no success state. These flows end with success ("Pengajuan terkirim"). The colours are already in Stitch (status chips). | **[needs OK]** (small) |
| X10 | The neutral grey chip (`#4A463D` on `#E9E2D5`, border `#D3C4B7`) is used for Dibatalkan and Hilang. | These values come from Stitch screen 04 (the "Alumni" chip), so they are not invented, but they are not yet in the NEXUS theme file. Needs one theme variable. | **[needs OK]** (small) |
| X11 | Dialogs on phones are bottom sheets with elevation 2 (white, 1 px `#E2D7C5`, Stitch level-2 shadow). | Stitch level 2 is "dropdowns, modals, filter sheets". A bottom sheet keeps the buttons in the thumb zone. The drawer already uses Radix Dialog, so nothing new is needed. | Within Stitch |
| X12 | No destructive (red) button. "Tolak", "Keluarkan dari stok", "Batalkan pengajuan" use the normal walnut buttons. The consequence is written in the dialog text. | Stitch defines no red button. Inventing one would add a style. The sentence above the button carries the weight. | Within Stitch |
| X13 | Field borders `#81756A` and 16 px field text on all forms. | Already approved (D-017 Q2). Listed only so nobody reverts it for these forms. | Approved |

Skill conflicts (Stitch wins, as the instructions say):
- `design-taste-frontend` and `impeccable` discourage a saturated brand-colour bar, brand-filled buttons and a serif display face on app screens. Stitch (D-014) fixes all three. Kept: walnut bar, walnut primary button, Playfair headings. Applied from the skills: one raised surface per screen, no gradients or glows, flat skeletons, quiet borders, errors inside the content with a next action, no invented numbers.
- `antislop-ui` flags Lucide-style icons as a default look. The app already ships Lucide icons (`nav-drawer.tsx`, `member-filters.tsx`) although `login.md` named Material Symbols (Stitch). I did not change this. Each icon below is named by meaning only; the frontend uses the set already built. Reported as a gap (G12).

---

## 3. Shared building blocks

### 3.1 Colour and type roles (Stitch hex only; same roles as `login.md` 2.1 and 2.2)

| Role | Hex | Used for |
|---|---|---|
| Canvas | `#FBF8F3` | Page background |
| Card | `#FFFFFF` | Cards, dialogs. 1 px `#EADFCF`, Stitch elevation 1 (dialogs elevation 2, border `#E2D7C5`) |
| Walnut | `#62431F` | App bar, primary button, links, outline buttons, active segment, focus ring |
| Ivory | `#F0E9DC` | Table header, segmented control track, ghost hover, skeleton bars, expanded unit area |
| Ivory border | `#DECDB5` | Ivory chip border |
| Deep brown | `#482D0A` | Page title |
| Espresso | `#2C1E11` | Text in fields, metric values |
| Label brown | `#4A3520` | Field labels |
| Body brown | `#4F453B` | Body text, text on ivory |
| Meta brown | `#7A6652` | Meta lines (never on ivory, see contrast table) |
| Outline | `#81756A` | Field borders, unselected option borders, timeline dots |
| Zebra | `#FDFBF7` | Alternate table row |
| Success / warning / error tones | see section 17 | Chips and messages |

Type: Playfair Display for page titles (display-lg 32/40 on module pages, display-sm 24/32 on forms and detail pages) and dialog titles (headline-lg 22/28). Plus Jakarta Sans for everything else: field text 16, body-md 14, body-sm 12, label-lg 13, label-sm 11 for table headers and chips (Stitch values, as built). Numbers in tables, counts, dates and quantities use tabular figures.

### 3.2 Page frame

- `AppFrame` with the drawer. List screens use the wide column of Data Anggota (max 576 px, 768 px from tablet width). Forms and detail pages use the narrow column (max 448 px, Stitch content width).
- Title block as in Data Anggota: Playfair title, "Periode {label}" under it, and on list screens a small count box on the right ("Hasil 42 barang").
- Module navigation (K1): a segmented control under the title block, on every screen of the module except forms and dialogs (forms replace it with a "Kembali" text link).

### 3.3 Dialog and bottom sheet (used by screens 4, 7, 8, 10)

- Radix Dialog (already in the drawer): focus trap, Escape closes, focus returns to the button that opened it, page behind is inert.
- 390 px: sheet fixed to the bottom, full width, top corners 12 px, max height 90% of the screen, content scrolls, header and footer stay. Tablet and up (from 768 px): centred, 448 px wide, all corners 12 px.
- Veil: flat espresso at 40%, no blur (same as the drawer).
- Header: title (Playfair headline-lg) and a 44 px close button ("Tutup"). Footer: buttons stacked, full width, 48 px, primary on top, the cancel as a text button underneath (thumb zone). 8 px gap.
- First focus: first field when there is one; the title when it is only a confirmation.
- Busy: primary shows spinner and a present-tense label ("Menyimpan..."), close and cancel are marked `aria-disabled`, a second press is ignored.
- Keyboard on phone: the sheet height follows the visible area, the focused field scrolls above the keyboard (`scroll-mb-24`, as `TextField`).
- Error inside a dialog: one AlertMessage above the footer, `role=alert`; the dialog stays open and keeps what was typed.

### 3.4 Form patterns

- Field: `TextField` (label above, 48 px, radius 8, `#81756A` border, walnut border plus halo on focus). Textarea: same box, 3 rows, grows to 6, no resize handle. Select: native select styled as in `member-filters.tsx` (48 px, chevron). Date: native `type=date` (phone pickers are best), 48 px. Number: `inputmode=numeric`, 48 px.
- Required fields carry "(wajib)" after the label text, not a red star (D3 in `login.md`). Optional fields say "(boleh kosong)".
- Field error: below the field, body-sm, `#932924`, with a small error icon, linked by `aria-describedby`, field border `#932924`. Colour is never the only signal.
- When a submit fails validation: one AlertMessage at the top of the form ("Ada {n} isian yang perlu diperbaiki."), `role=alert`, focus moves to it, and it lists links to each field. Focus then goes to the first field when the person follows the first link.
- Submit button: full width, 48 px, never greyed. Busy label: spinner plus "Menyimpan..." (or the verb of the action).
- Leaving a form with unsaved input: dialog "Buang perubahan?" with "Buang" and "Lanjut mengisi".
- Success: the person lands on the next screen with an `AlertMessage` success tone, `role=status`, text such as "Barang disimpan. Kodenya INV-0042."

### 3.5 Dates and numbers

- Dates are Asia/Jakarta calendar dates (R19). "Today" for minimums, overdue and "Belum diambil" is the Jakarta date.
- Display: single day "10 Des 2026"; same month "10-12 Des 2026"; across months "30 Nov-2 Des 2026"; across years "30 Des 2026-2 Jan 2027". Months: Jan, Feb, Mar, Apr, Mei, Jun, Jul, Agu, Sep, Okt, Nov, Des. Duration is inclusive: "(3 hari)".
- Times: "9 Des 2026, 14.05 WIB".
- Counts use a dot for thousands (`formatCount`).
- Overdue: "Terlambat 3 hari" = today minus end date, in days.

### 3.6 Shared messages (reuse the existing strings where they exist)

| Situation | Text | Notes |
|---|---|---|
| PI-CORE or database unreachable | "Terjadi gangguan. Coba lagi sebentar lagi." | Existing `COPY.unavailable`. Warning tone, button "Coba lagi". Stays signed in. |
| No network | "Tidak bisa terhubung. Periksa internetmu lalu coba lagi." | Existing. |
| Right removed while open | "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA." | Existing. |
| No permission (direct link) | Existing `ForbiddenScreen`: "Tidak punya akses" / "Kamu tidak punya akses ke halaman ini. Kalau kamu memerlukannya, hubungi admin PMK ITERA." With `noActivePeriod` it adds the period explanation. | Used for Antrean, Kelola Barang and every action page without the key. |
| No active period | "Belum ada periode aktif. Pengajuan belum bisa dibuat." | Info banner at the top of the module (catalog and own requests stay readable). Keys held through Operations or BPH match nothing then (R11), so Antrean and Kelola Barang show the Forbidden screen with the period text. |
| Conflict | "Data sudah berubah. Muat ulang." plus button "Muat ulang" | Spec states table. Warning tone. |
| No match in a list | "Tidak ada hasil. Ubah pencarian atau filter." plus text buttons "Hapus pencarian" and "Reset" | Same as Data Anggota. |
| Search too long | "Kata pencarian terlalu panjang. Pakai paling banyak 120 karakter." | Existing pattern. |
| Skeleton | Flat ivory bars at the real row height, caption in body brown ("Memuat barang...", "Memuat pengajuan..."), `role=status`, no shimmer, no pulse. | MOTION 1. |

### 3.7 Components: what exists, what is new

| Need | Reuse | New or extended |
|---|---|---|
| Frame, drawer, app bar | `AppFrame`, `NavDrawer` (add one item in `nav.ts`) | - |
| Cards and states | `Card`, `StatusCard`, `AlertMessage` | Add the success tone (X9) |
| Buttons, spinner | `buttonClass` (primary, outline, text), `Spinner` | - |
| Fields | `TextField`, `SelectField` pattern from `member-filters.tsx` | Move `SelectField` and the textarea box to `components/ui`; add `DateField`, `QuantityStepper`, `RadioCards` |
| Table | `MemberTable` pattern (zebra, ivory header) | Generic `DataTable` shell for catalog and Kelola Barang |
| Chips | local `StatusChip` in `member-table.tsx` | One shared `StatusChip` with the tone set of section 17 |
| Pagination, filters, URL state | `member-pagination.tsx`, `list-navigation.tsx`, `list-url.ts` | Generalise (they are tied to member params) |
| Export | `member-export.tsx` | Generalise: endpoint, parameters, label text as props |
| Forbidden | `ForbiddenScreen` | - |
| Dialog and sheet | Radix Dialog (as in `nav-drawer.tsx`) | `Sheet` wrapper (3.3) |
| Module nav | - | `ModuleNav` (segmented links) |
| Timeline | - | `Timeline` (ordered list) |
| Photo picker | - | `PhotoPicker` (screen 10) |
| Unit picker | - | `UnitChecklist` |

---

## 4. Screen 1: Module landing and navigation

**Goal.** Let each person reach the part of the module they may use, and see at a glance whether something waits for them.

**Who sees it.** Every active member (`inventory.view`, baseline D01). Sections appear by key: Antrean needs `borrowing.view_all` (included in `approve` and `handle`); Kelola Barang needs `inventory.manage`.

**Path.** Opens the drawer -> taps "Manajemen & Inventaris" -> lands on Katalog (screen 2) -> switches sections with the segmented control.

### 4.1 Drawer item

- Label **"Manajemen & Inventaris"** (the Stitch drawer wording in 12 and 14; spec section 6). Icon: a box or package. Position: last, as in Stitch (after Surat Menyurat). It joins `nav.ts` only when the module ships (D-021), and shows for every active member because `inventory.view` is baseline.
- Active when the path starts with `/inventaris`. No badge on the drawer item (A-IB21 is a proposal for the Dashboard module, not this one). The count lives in the Antrean section label.

### 4.2 Wireframe (390 px, a head who is also an Operations member sees all four)

```
+----------------------------------------------+
| ############ app bar (unchanged) ############ |
|----------------------------------------------|
|  Manajemen & Inventaris                      |  Playfair 32
|  Periode 2026/2027                           |  body-md
|                                              |  16
|  +----------------------------------------+  |  track #F0E9DC, r12, pad 4
|  |[Katalog][Peminjaman][Antrean ][Kelola ]|  |  4 equal segments
|  |[       ][ Saya     ][ (3)     ][ Barang]|  |  active = walnut, white text
|  +----------------------------------------+  |  segment min 56 px, r8
|                                              |
|  ... content of the chosen section ...       |
+----------------------------------------------+
```

A plain member sees two segments, each half the width:

```
|  +----------------------------------------+  |
|  |[    Katalog    ][  Peminjaman Saya    ]|  |
|  +----------------------------------------+  |
```

### 4.3 Sections

| Section | Route (proposal for the frontend) | Visible when | Contents |
|---|---|---|---|
| Katalog | `/inventaris` | everyone | screen 2; item detail `/inventaris/barang/{id}` is a child (screen 3) |
| Peminjaman Saya | `/inventaris/saya` | everyone (L9, fixed) | screen 7; detail `/inventaris/pengajuan/{ref}` |
| Antrean | `/inventaris/antrean` | `borrowing.view_all`, `approve` or `handle` | screen 8 and screen 11 |
| Kelola Barang | `/inventaris/kelola` | `inventory.manage` | screens 4 and 5 |

Action pages (`/inventaris/ajukan`, `.../serah-terima`, `.../terima-kembali`, `.../kelola/barang/baru`) are not sections. They replace the segmented control with a "Kembali" text link.

### 4.4 Behaviour and reasons

- The four segments are **real links** (`<nav>`, `aria-current="page"`), not an ARIA tablist. Each section is its own page with its own address, so Back works and a link can be shared. Reason: tabs that only swap content on the client would need extra keyboard code and lose the address.
- Labels may wrap to two lines ("Peminjaman / Saya", "Kelola / Barang"). Reason: four labels cannot fit one line at 358 px at a readable size. A scrolling tab strip would hide the fourth section.
- Count in "Antrean (3)": the number of requests that wait for **this person's action** (a head: Diajukan requests that are not their own; an Operations member: Disetujui requests waiting for pick-up plus Terlambat loans). Computed on the server. No count when zero or when the person only holds `view_all` (BPH). [PROPOSAL P12: definition]. The accessible name reads "Antrean, 3 perlu tindakan".
- A **[PROPOSAL P1]** to keep this four-section design. Alternatives: (a) a single "Antrean" for heads and a separate "Daftar kerja" for Operations (more tabs, one more concept); (b) merge Kelola Barang into Katalog with manager buttons (fewer tabs, but members and managers then see different pages at the same address). Recommendation: this design, because the spec asked for a queue and a work list that share one list of requests, and a manager workspace that members never see.

### 4.5 States

| State | What shows |
|---|---|
| Loading | Title and the segmented control draw at once (they need no data except the count); the count appears when it arrives. A failed count shows no number and no error (it is a hint, not data). |
| No active period | Info banner under the title: "Belum ada periode aktif. Pengajuan belum bisa dibuat." Antrean and Kelola Barang disappear from the control (their keys match nothing, R11). |
| Section without the key (direct link) | `ForbiddenScreen`. |
| Error | The section shows its own error (3.6). The control stays. |

### 4.6 Accessibility and touch

- `nav` with `aria-label="Bagian inventaris"`. Tab order follows the visual order. Visible focus: 2 px walnut outline, 2 px offset (as in the shell).
- Segments 56 px high (two-line capable), at least 80 px wide. Text 13 px semibold: active white on `#62431F` (8.97:1), inactive `#4F453B` on `#F0E9DC` (7.74:1). Active state is fill plus bold plus `aria-current`, not colour alone.
- Wider screens: from 768 px the control keeps its height, labels stay on one line, and its width is the content column (max 768 px).

---

## 5. Screen 2: Catalog list ("Katalog")

**Goal.** Find an item, see whether enough of it is in good condition, and start a request.

**Who sees it.** `inventory.view` (every active member). The "Ekspor" button needs `inventory.export`. "Tambah barang" in the empty state needs `inventory.manage`. Archived items and units are not shown here (A-IB5).

**Path.** Opens Katalog -> types a name or code, or sets filters -> reads the counts -> opens an item (screen 3) or taps "Ajukan Peminjaman" (screen 6).

### 5.1 Wireframe, idle (390 px)

```
+----------------------------------------------+
|  Manajemen & Inventaris        +-----------+ |
|  Periode 2026/2027             | Hasil     | |  count box (as Data Anggota)
|                                | 42 barang | |
|                                +-----------+ |
|  [ segmented control, screen 1 ]             |
|                                              |
|  +----------------------------------------+  |
|  |          + Ajukan Peminjaman           |  |  primary, 48 px
|  +----------------------------------------+  |
|  [Q] Cari nama atau kode barang...           |  48 px
|                                              |
|  [ Filter (2)  v ]                [Ekspor v] |  both 44 px; Ekspor only with key
|  (Kategori: [Audio] x) (Kondisi: Baik x)     |  removable filter tags (pills)
|                                              |
|  +----------------------------------------+  |  table card, r12
|  | BARANG                     BAIK / TOTAL|  |  header #F0E9DC, 11 px caps
|  |----------------------------------------|  |
|  | [Barang A]                     4 dari 5|  |  name = link, bold
|  | INV-0012 . [Kategori] . [Lokasi]  baik |  |  body-sm
|  | (1 Perlu servis)                       |  |  chip, only if any
|  |----------------------------------------|  |  zebra row #FDFBF7
|  | [Barang B]                     3 dari 5|  |
|  | 5 unit . [Kategori] . 2 lokasi    baik |  |
|  | [Lihat 5 unit  v]   (1 Rusak)          |  |  expander, 44 px
|  |----------------------------------------|  |
|  | [Barang C]                     0 dari 2|  |
|  | INV-0020 . [Kategori] . [Lokasi]  baik |  |
|  | (2 Rusak)                              |  |
|  +----------------------------------------+  |
|                                              |
|     [< Prev]  [1] [2] [3]  [Next >]          |  as member-pagination
|     Menampilkan 1-20 dari 42 barang          |
+----------------------------------------------+
```

Filter card open (below the Filter button, pushes the list down, same card style as Data Anggota):

```
|  +----------------------------------------+  |
|  | Filter Barang                  Reset   |  |  label-lg + text button 44 px
|  |                                        |  |
|  |  Kategori            Lokasi            |  |
|  |  [Semua kategori v]  [Semua lokasi  v] |  |  2 columns, 48 px
|  |                                        |  |
|  |  Kondisi                               |  |
|  |  (Semua) (Baik) (Perlu servis) (Rusak) |  |  filter tags, single choice
|  |                                        |  |
|  |  Tersedia pada tanggal (boleh kosong)  |  |  [PROPOSAL P2]
|  |  Dari               Sampai             |  |
|  |  [dd/mm/yyyy    ]   [dd/mm/yyyy     ]  |  |
|  +----------------------------------------+  |
```

Expanded tracked item (unit area on ivory, text `#4F453B`):

```
|  | [Barang B]                     3 dari 5|  |
|  | 5 unit . [Kategori] . 2 lokasi    baik |  |
|  | [Sembunyikan unit ^]                   |  |
|  |  +----------------------------------+  |  |
|  |  | INV-0031  (Baik)       [Lokasi]  |  |  |
|  |  | INV-0032  (Baik)       [Lokasi]  |  |  |
|  |  | INV-0033  (Perlu servis) [Lokasi]|  |  |
|  |  | INV-0034  (Rusak)      [Lokasi]  |  |  |
|  |  | INV-0035  (Baik)       [Lokasi]  |  |  |
|  |  +----------------------------------+  |  |
```

### 5.2 Elements and choices

| Element | Specification | Reason |
|---|---|---|
| Primary button "+ Ajukan Peminjaman" | Full width, 48 px. Label as in Stitch. Absent when there is no active period (the banner explains). | One focal point. Matches Stitch 12 label. |
| Search | Same box as Data Anggota. Label (hidden) "Cari barang", placeholder "Cari nama atau kode barang...". Searches name and code. After 450 ms of no typing or on Enter, resets to page 1. Max 120 characters. | Spec F1 and R21. |
| "Filter (n)" button | Outline, 44 px, shows the number of active filters. `aria-expanded`, controls the card. Opens the card inline (no sheet). From 768 px the card is always open and the button is hidden. | X7 / P3. |
| Filter tags under the button | One removable pill per active filter ("Kategori: Audio", "Lokasi: ...", "Kondisi: Baik", "10-12 Des"). Each has a 44 px remove target with the accessible name "Hapus filter Kategori: Audio". | Pills are allowed for filter tags (D-014). Shows what is applied when the card is closed. |
| Kategori, Lokasi | Selects fed by the Ops lists. Options "Semua kategori" / "Semua lokasi" then active entries; a deactivated entry still used by items appears at the end as "{nama} (nonaktif)". | IB10. |
| Kondisi | Filter tags, single choice: "Semua", "Baik", "Perlu servis", "Rusak". Matches items that have at least one unit or quantity in that condition. | Spec F1 (condition filter). "Baik" is the same as "can be lent today". |
| Tersedia pada tanggal | Optional date range, same validation as screen 3. When set, the right column changes to "Tersedia {n} dari {m}" for that range, the Kondisi tag "Semua" stays, and items with 0 free sort last. | **[PROPOSAL P2]**: the request "which items are free that weekend?" is what members ask. Needs one bulk availability call per page of 20 (same restricted function as R8, called per item). If that is too heavy, ship without it. |
| Reset | Text button, clears search and all filters. | As Data Anggota. |
| "Ekspor" | Screen 12. Right aligned, same row as Filter. | |
| Table | Header "BARANG" and "BAIK / TOTAL" (uppercase 11 px, Stitch). Zebra. Rows are not tappable as a whole; the item name is the link. | Same as Data Anggota (no row-wide tap), avoids accidental opens while scrolling. |
| Name link | Walnut, semibold, underlined on focus and hover, block with 44 px height (row padding counts). | |
| Line 2 | Quantity item: `INV-0012 . {kategori} . {lokasi}`. Tracked item: `{n} unit . {kategori} . {lokasi}` (or `{n} lokasi` when units are in different places). Missing: "Tanpa kategori", "Lokasi belum diatur". | K3. |
| Right column | `{baik} dari {total}` in 14 px bold, caption "baik" in 12 px. Never a percentage, never a bar. Tabular figures. | K2. |
| Condition chips | Only for conditions other than Baik that have a count: "1 Perlu servis", "1 Rusak". Hilang units are not counted in the total (spec A-IB32). | Quiet default: a fully good item shows no chip, the text already says "5 dari 5 baik". |
| Expander (tracked only) | Text button "Lihat {n} unit" / "Sembunyikan unit", 44 px, `aria-expanded`, `aria-controls`. Opens the unit area under the row. Units show code, condition chip, location. Not who holds them. | K3, R8. |

### 5.3 States

| State | What shows |
|---|---|
| Loading | Heading and controls draw at once. The table area shows 6 flat ivory row bars (title bar 140 x 14, line 2 bar 200 x 12, right bar 48 x 14) with the caption "Memuat barang..." (`role=status`). Controls stay usable. |
| Empty catalog (no filters) | Card: "Belum ada barang di inventaris." For members add: "Barang akan muncul di sini setelah tim Operasional menambahkannya." For `inventory.manage` holders add a primary button "Tambah barang" instead of that second line. |
| No match | Card: "Tidak ada hasil. Ubah pencarian atau filter." with text buttons "Hapus pencarian" (when searching) and "Reset". |
| Date range invalid | Under the date fields: "Tanggal akhir tidak boleh sebelum tanggal mulai." The list keeps its last result. |
| Error | Warning alert "Terjadi gangguan. Coba lagi sebentar lagi." with outline button "Coba lagi". Controls above stay. |
| No active period | Banner (screen 1); list readable; primary button absent. |
| Forbidden | Not applicable (baseline). A deactivated person never reaches it (L1). |
| Success | Not applicable (read screen). Export has its own message (screen 12). |

### 5.4 Accessibility and touch

- `<table>` with a caption "Daftar barang, halaman {n} dari {m}". Row header cell = the name link. The right column is a real cell with the visible text "4 dari 5 baik" read as one phrase.
- Tab order: primary button, search, Filter, Ekspor, filter tags, table links and expanders, pagination.
- Targets: 48 (primary, search), 44 (Filter, Ekspor, tag remove, expander, pagination, Reset), name links 44 high. Gaps 8 px or more.
- Zebra and chip text pairs: see section 17 (all at least 5.45:1; chips at least 5.59:1). Expanded area uses `#4F453B` on `#F0E9DC` (7.74:1).
- The result count has `role=status` so a screen reader hears "Menampilkan 1-20 dari 42 barang" after each change.
- Wider screens (768 px and up): the filter card is always open in one row (Kategori, Lokasi, Kondisi, dates); the table gets columns Kode, Barang, Kategori, Lokasi, Baik / Total, Kondisi lain; the expander still opens an area under the row.

---

## 6. Screen 3: Item detail and availability check

**Goal.** Show everything about one item and answer "is it free on my dates?" without ever saying who has it.

**Who sees it.** `inventory.view`. "Ubah barang" needs `inventory.manage`. Archived items: managers see the item with a "Nonaktif" chip; for everyone else the address answers "Barang ini tidak ditemukan."

**Path.** From Katalog -> reads stock -> picks two dates -> reads "Tersedia 2 dari 4" -> taps "Ajukan barang ini" (screen 6 opens with the item and the dates filled in).

### 6.1 Wireframe (quantity item; 390 px)

```
+----------------------------------------------+
|  < Katalog                                   |  text button, 44 px
|                                              |
|  [Nama barang]                               |  Playfair 24, can wrap
|  INV-0012                                    |  body-sm, #7A6652
|                                              |
|  +----------------------------------------+  |  card
|  | Rincian                                |  |  headline-sm
|  | [Deskripsi, bila ada]                  |  |
|  | Kategori     [Kategori]                |  |  label / value rows
|  | Lokasi       [Lokasi]                  |  |
|  | Dicatat      Dihitung per jumlah       |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Stok per kondisi                       |  |
|  | (Baik)                              4  |  |
|  | (Perlu servis)                      1  |  |
|  | (Rusak)                             0  |  |
|  | Total                               5  |  |  semibold, top divider
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Cek ketersediaan                       |  |
|  | Mulai              Sampai              |  |
|  | [dd/mm/yyyy  ]     [dd/mm/yyyy      ]  |  |
|  | Sampai tanggal ini ikut dihitung.      |  |
|  |                                        |  |
|  |  Tersedia 2 dari 4                     |  |  result, role=status
|  |  pada 10-12 Des 2026. 2 lainnya sudah  |  |
|  |  dipesan atau sedang dipinjam.         |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  |         Ajukan barang ini              |  |  primary
|  +----------------------------------------+  |
|  [ Ubah barang ]                             |  outline, managers only
+----------------------------------------------+
```

Tracked item: "Dicatat" reads "Dilacak per unit", the code under the title is replaced by "{n} unit", and a card "Unit" sits between "Stok per kondisi" and "Cek ketersediaan":

```
|  | Unit                                   |  |
|  | INV-0031 (Baik)          [Lokasi]      |  |
|  | INV-0032 (Baik)          [Lokasi]      |  |
|  | INV-0033 (Perlu servis)  [Lokasi]      |  |
```
(For managers: archived units show with the chip "Nonaktif", lost units with "Hilang".)

### 6.2 Fields: availability check

| Field | Type | Rule | Error text |
|---|---|---|---|
| Mulai | date, 48 px | Not before today (Jakarta) | "Tanggal mulai tidak boleh sebelum hari ini." |
| Sampai | date, 48 px | Not before Mulai. Helper: "Sampai tanggal ini ikut dihitung." | "Tanggal akhir tidak boleh sebelum tanggal mulai." |

The check runs by itself when both dates are valid (after a short pause), announced in a `role=status` region. Without JavaScript a button "Cek" sends the same form. Result copy:

| Result | Text |
|---|---|
| Some free | "Tersedia {n} dari {m}" and "pada {rentang}. {k} lainnya sudah dipesan atau sedang dipinjam." (the second sentence only when k > 0) |
| All free | "Tersedia {m} dari {m}" and "pada {rentang}." |
| None | "Tidak tersedia pada tanggal itu. Coba tanggal lain." |
| Loading | "Memeriksa ketersediaan..." (spinner icon, static with reduced motion) |
| Error | Warning alert "Ketersediaan tidak bisa dimuat. Coba lagi." and outline button "Coba lagi" |

The number never links to anyone and no other request is described, only counts (R8, IB-18). The denominator is the quantity in Baik (lendable stock), not the total.

### 6.3 Actions

| Action | Shown when | What it does |
|---|---|---|
| "Ajukan barang ini" | Item active, at least one in Baik, active period exists | Opens screen 6 with this item and the dates already set. Absent otherwise. |
| Text instead of the button | No Baik stock | "Belum ada yang berkondisi baik, jadi barang ini belum bisa dipinjam." |
| "Ubah barang" | `inventory.manage` | Opens screen 4 in edit mode. |
| "< Katalog" | Always | Back to the list with the same filters (kept in the address). |

### 6.4 States

| State | What shows |
|---|---|
| Loading | Title bar and three flat cards (ivory bars), caption "Memuat barang...". |
| Not found or archived (non-manager) | Card "Barang ini tidak ditemukan." with text button "Kembali ke katalog". |
| Error | Warning alert (3.6) with "Coba lagi". |
| No active period | The check still works; "Ajukan barang ini" is absent and the banner explains. |
| Success | Not applicable. After a manager saves an edit, this page shows the success message from screen 4. |

### 6.5 Accessibility and touch

- One `h1` (item name); cards are `section`s with `h2`. The condition list is a `<dl>`.
- Result region `aria-live=polite`. Dates have real labels.
- Targets: dates 48, buttons 48, back link 44.
- Wider screens: Rincian and Stok sit side by side from 768 px; the availability card spans the full width; max 768 px.

---

## 7. Screen 4: Item form (add and edit), condition change, write-off, archive

**Goal.** Let Operations add an item once, correctly, and change it later with a reason on every change.

**Who sees it.** `inventory.manage` (every Operations holder by default). Anyone else reaching the address sees `ForbiddenScreen`. No photo upload exists on this form (IB9).

**Path (add).** Kelola Barang -> "Tambah barang" -> chooses how to record it -> fills name, category, location and stock or units -> "Simpan" -> lands on the item detail with "Barang disimpan. Kodenya INV-0042."

**Path (edit).** Item detail or Kelola Barang row -> "Ubah barang" -> edits name, description, category, location, or uses a stock dialog -> "Simpan".

### 7.1 Wireframe: add, step 1 (mode choice first; narrow column)

```
+----------------------------------------------+
|  < Kelola Barang                             |
|                                              |
|  Tambah barang                               |  Playfair 24
|                                              |
|  +----------------------------------------+  |
|  | Cara mencatat (wajib)                  |  |  legend
|  |                                        |  |
|  |  ( ) Dihitung per jumlah               |  |  radio card, r12, 1.5 px #81756A
|  |      Untuk barang sejenis yang cukup   |  |
|  |      dihitung jumlahnya. Satu kode     |  |
|  |      untuk seluruh barang.             |  |
|  |                                        |  |
|  |  ( ) Dilacak per unit                  |  |
|  |      Untuk barang yang kondisinya      |  |
|  |      dicatat satu per satu. Setiap     |  |
|  |      unit punya kode sendiri.          |  |
|  |                                        |  |
|  |  Pilihan ini tidak bisa diubah         |  |
|  |  setelah barang pernah dipinjam.       |  |
|  +----------------------------------------+  |
+----------------------------------------------+
```

The rest of the form appears after a choice (selected card: border 2 px `#62431F`, fill `#F0E9DC`, filled radio dot; the check is the radio itself, not colour only).

### 7.2 Wireframe: add, step 2, "Dihitung per jumlah"

```
|  Tambah barang                               |
|  Dihitung per jumlah         [Ganti pilihan] |  text button; before save only
|                                              |
|  +----------------------------------------+  |
|  | Nama barang (wajib)                    |  |
|  | [                                    ] |  |
|  | Deskripsi (boleh kosong)               |  |
|  | [                                    ] |  |
|  | [                                    ] |  |
|  | Kategori (boleh kosong)                |  |
|  | [Pilih kategori                     v] |  |
|  | Lokasi (boleh kosong)                  |  |
|  | [Pilih lokasi                       v] |  |
|  | Kode                                   |  |
|  | Dibuat otomatis saat disimpan.         |  |  plain text, not a field
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Jumlah per kondisi                     |  |
|  | Baik          [-] [  0 ] [+]           |  |
|  | Perlu servis  [-] [  0 ] [+]           |  |
|  | Rusak         [-] [  0 ] [+]           |  |
|  | Total         0                        |  |  live sum
|  | Hanya yang Baik yang bisa dipinjam.    |  |
|  +----------------------------------------+  |
|  [               Simpan                    ]  |
|  Batal                                       |
```

"Dilacak per unit" replaces the second card with the units list:

```
|  +----------------------------------------+  |
|  | Unit                                   |  |
|  | Kode dibuat otomatis saat disimpan.    |  |
|  |                                        |  |
|  |  Unit 1                      [Hapus]   |  |
|  |  Kondisi   [Baik                    v] |  |
|  |  Lokasi    [Pilih lokasi            v] |  |
|  |  Unit 2                      [Hapus]   |  |
|  |  Kondisi   [Baik                    v] |  |
|  |  Lokasi    [Pilih lokasi            v] |  |
|  |  [ + Tambah unit ]                     |  |  outline; copies last row values
|  +----------------------------------------+  |
```
In this mode the item-level "Lokasi" field is not shown (location is per unit, spec section 4).

### 7.3 Wireframe: edit (stock is read-only text with named actions)

Quantity item:

```
|  Ubah barang                                 |
|  Kode  INV-0012                              |  read-only, "Kode tidak bisa diubah."
|  Dihitung per jumlah (tidak bisa diubah)     |
|  ... Nama, Deskripsi, Kategori, Lokasi ...   |  editable
|  +----------------------------------------+  |
|  | Stok per kondisi                       |  |
|  | (Baik) 4   (Perlu servis) 1   (Rusak) 0|  |
|  | Total 5                                |  |
|  | [Tambah jumlah] [Ubah kondisi]         |  |  text buttons, 44 px
|  | [Keluarkan dari stok]                  |  |
|  +----------------------------------------+  |
|  [ Simpan ]    Batal                         |
|  ------------------------------------------  |
|  [ Nonaktifkan barang ]                      |  outline, at the bottom
```

Tracked item, per unit row in edit mode:

```
|  +----------------------------------------+  |
|  | INV-0033   (Perlu servis)              |  |
|  | Lokasi  [Lokasi                     v] |  |
|  | [Ubah kondisi] [Keluarkan] [Nonaktifkan]|  |  text buttons, 44 px
|  +----------------------------------------+  |
|  [ + Tambah unit ]                           |
```
Archived units show the chip "Nonaktif" and one button "Aktifkan kembali". Lost units show "Hilang" and no action (see gap G7).

### 7.4 Fields

| Field | Type | Validation | Error text |
|---|---|---|---|
| Cara mencatat | radio cards, wajib at creation | One must be chosen | "Pilih cara mencatat barang ini." |
| Nama barang | text, wajib | 1 to 120 characters, not only spaces | "Isi nama barang." / "Nama barang terlalu panjang. Pakai paling banyak 120 karakter." |
| Deskripsi | textarea, boleh kosong | Max length set by the backend ({n}) | "Deskripsi terlalu panjang. Pakai paling banyak {n} karakter." |
| Kategori | select | From active categories. **[PROPOSAL P4]**: optional | (none) |
| Lokasi | select (quantity items) / per unit select (tracked) | From active locations. **[PROPOSAL P4]**: optional | (none) |
| Jumlah Baik, Perlu servis, Rusak | stepper, whole number | 0 up to the fixed maximum ({max}); total at least 1 at creation | "Isi angka bulat, 0 sampai {max}." / "Isi minimal satu barang." |
| Unit: Kondisi | select, wajib | Baik, Perlu servis, Rusak (fixed list) | "Pilih kondisi unit." |
| Unit: Lokasi | select | as Lokasi | (none) |
| Units | at least one row at creation | | "Tambahkan minimal satu unit." |

Empty lists: when there are no categories (or locations), the select shows the single disabled option "Belum ada kategori" and under it a text link "Tambah kategori" (opens screen 5). Reason: both lists start empty (IB10), so this is the first thing Operations will meet.

### 7.5 Actions

| Action | What it does |
|---|---|
| "Simpan" | Server validates. Success: opens the detail with a success message ("Barang disimpan. Kodenya INV-0042." for a quantity item; "{n} unit disimpan: INV-0043 sampai INV-0045." for tracked; "Perubahan disimpan." on edit). One history row is written ("dibuat" or "diubah"). |
| "Ganti pilihan" | Before the first save only: returns to step 1 and keeps typed name and description. |
| "Batal" | Leaves the form; asks "Buang perubahan?" if anything was typed. |
| "Tambah jumlah" | Dialog 7.6 a. |
| "Ubah kondisi" | Dialog 7.6 b. |
| "Keluarkan dari stok" / "Keluarkan" (unit) | Dialog 7.6 c. |
| "Nonaktifkan barang" / "Nonaktifkan" (unit) | Dialog 7.6 d. |
| "Aktifkan kembali" | Shown on an archived item or unit. Restores it at once (reversible, no dialog). Success message "Barang diaktifkan kembali." |

### 7.6 Dialogs (all use 3.3; every one ends in one history row)

**a. Tambah jumlah** (quantity items; new stock arrived). Title "Tambah jumlah". Fields: Kondisi (select, default Baik), Jumlah ("Jumlah (wajib)", whole number at least 1), Catatan (boleh kosong). Buttons "Tambah" and "Batal". Error: "Isi angka bulat, mulai 1."

**b. Ubah kondisi.** Title "Ubah kondisi".
- Quantity item fields: "Dari kondisi" (select, only conditions that have stock, shows the count), "Ke kondisi" (select, the other two), "Jumlah" (1 up to the count in "Dari"), "Catatan".
- Tracked unit: title "Ubah kondisi {kode}", field "Kondisi baru" (radio, the other two), "Catatan".
- Note rule: **required** when the move goes to a worse condition (Baik to Perlu servis or Rusak, Perlu servis to Rusak); optional when it improves (after servis). Error: "Tulis alasannya, misalnya apa yang rusak." (worse moves only).
- Blocked move: "Tidak bisa. Barang yang baik tidak boleh kurang dari {n}, karena {n} sudah dipesan untuk peminjaman yang belum selesai." Names of borrowers never appear (R18).
- Buttons "Simpan" and "Batal".

**c. Keluarkan dari stok** (lost or thrown away; never a delete). Title "Keluarkan dari stok". Text: quantity item "Jumlah ini dikurangi dari stok. Riwayatnya tetap tersimpan." Tracked unit "Unit {kode} berstatus Hilang. Kodenya tidak dipakai lagi dan tetap ada di riwayat." Fields: quantity item: "Dari kondisi" and "Jumlah"; both: "Catatan (wajib)" with the hint "Tulis hilang atau dibuang, dan alasannya." Error: "Tulis alasannya." Primary "Keluarkan dari stok". Blocked while open requests would be short (same message as b). Note: the unit status is "Hilang" in both cases (spec F2 step 6; see gap G7).

**d. Nonaktifkan.** Title "Nonaktifkan barang?" Text: "Barang ini hilang dari katalog dan dari form pengajuan. Kamu bisa mengaktifkannya lagi kapan saja." Primary "Nonaktifkan". Blocked (open request line or on loan): AlertMessage warning inside the dialog, no confirm button: "Barang ini masih punya {n} peminjaman yang belum selesai. Selesaikan atau batalkan dulu." (count only, no names, IB-13).

### 7.7 States

| State | What shows |
|---|---|
| Loading (edit) | Flat skeleton of the cards, caption "Memuat barang...". |
| Saving | "Simpan" shows spinner and "Menyimpan...". Fields become read-only (same look). |
| Validation | Summary alert at the top plus field errors (3.4). |
| Conflict | "Data sudah berubah. Muat ulang." with "Muat ulang". Typed text is kept where possible. |
| Server error | Warning alert above the button: "Terjadi gangguan. Coba lagi sebentar lagi." |
| Forbidden | `ForbiddenScreen`. |
| Success | Detail page with success message. |
| Empty | Not applicable (a form). Empty category or location lists: see 7.4. |

### 7.8 Accessibility and touch

- Radio cards are a `fieldset` with a `legend`; each card is one `label` around a native radio (the whole card is the 44+ px target). Selected state = radio dot, bold title, thicker border.
- Steppers: the number field is a real input; "-" and "+" are buttons named "Kurangi jumlah Baik" and "Tambah jumlah Baik", 48 x 48 px. At 0 the "-" button is disabled (it cannot go lower; a disabled button here carries no information that is lost).
- The live "Total" is `role=status`.
- Rows of unit actions wrap; each text button is at least 44 px high with 8 px gaps.
- Wider screens: the form stays one column (max 448 px); on 1024 px and up the "Cara mencatat" cards sit side by side.

---

## 8. Screen 5: Categories and locations

**Goal.** Let Operations keep the two pick lists, starting from empty, without ever deleting anything.

**Who sees it.** `inventory.manage` (assumption A-IB2). Reached from Kelola Barang (link "Kategori dan lokasi").

**Path.** Kelola Barang -> "Kategori dan lokasi" -> adds, renames or deactivates an entry -> goes back to the item form.

### 8.1 Wireframe (390 px)

```
+----------------------------------------------+
|  < Kelola Barang                             |
|  Kategori dan lokasi                         |  Playfair 24
|                                              |
|  +----------------------------------------+  |  two-segment control, as screen 1
|  | [   Kategori   ][    Lokasi    ]       |  |
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |
|  | Tambah kategori                        |  |
|  | Nama kategori (wajib)                  |  |
|  | [                                    ] |  |
|  | [              Tambah                ] |  |  primary
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |  list card, zebra rows
|  | [Kategori A]       (Aktif)   12 barang |  |
|  | [Ubah nama]  [Nonaktifkan]             |  |  text buttons, 44 px
|  |----------------------------------------|  |
|  | [Kategori B]       (Aktif)    0 barang |  |
|  | [Ubah nama]  [Nonaktifkan]             |  |
|  +----------------------------------------+  |
|  > Nonaktif (1)                              |  details, closed by default
+----------------------------------------------+
```

Rename in place: the row becomes a field with "Simpan" and "Batal" (focus moves to the field; Escape cancels).

### 8.2 Fields and actions

| Field or action | Rule | Text |
|---|---|---|
| Nama kategori / Nama lokasi | text, wajib, 1 to {n} characters, unique among entries of the same list (ignoring case) | "Isi nama." / "Nama ini sudah ada." / "Nama terlalu panjang. Pakai paling banyak {n} karakter." |
| "Tambah" | Adds the entry as Aktif, clears the field, keeps focus in it, announces "Kategori ditambahkan." (`role=status`) | |
| "Ubah nama" | Renames. Items keep pointing at the entry, so they show the new name. | Success: "Nama diubah." |
| "Nonaktifkan" | Dialog: "Nonaktifkan {nama}?" "Barang yang memakainya tetap memakai nama ini. Tidak bisa dipilih untuk barang baru." Buttons "Nonaktifkan", "Batal". | |
| "Aktifkan kembali" (inside Nonaktif) | Restores at once. | |
| Count "12 barang" | How many items use the entry. Plain text, body-sm. | |

There is no delete and no reorder in this design (G6): entries sort alphabetically.

### 8.3 States

| State | What shows |
|---|---|
| Empty list (first use) | In the list card: "Belum ada kategori. Tambahkan yang pertama di atas." (for locations: "Belum ada lokasi. Tambahkan yang pertama di atas."). Focus is not forced into the field (keyboard would cover the message on a phone). |
| Empty Kelola Barang (lists not filled yet) | On Kelola Barang, an info alert: "Kategori dan lokasi masih kosong. Isi daftarnya dulu supaya bisa dipilih di form barang." with a text button "Isi daftar". |
| Loading | Flat skeleton rows, caption "Memuat daftar...". |
| Saving | Button spinner and "Menyimpan...". |
| Error | Warning alert (3.6). Typed text stays. |
| Conflict (someone else changed it) | "Data sudah berubah. Muat ulang." |
| Forbidden | `ForbiddenScreen`. |

### 8.4 Accessibility and touch

- Each row is a `li`; actions have names that include the entry ("Ubah nama Kategori A"). The status chip text "Aktif" / "Nonaktif" is read.
- The two-segment control uses links with `aria-current`, like screen 1.
- Targets: field 48, "Tambah" 48, row buttons 44, gap 8.
- Wider screens: the add card sits left of the list from 1024 px; otherwise stacked.

---

## 9. Screen 6: Borrowing request form (and "Untuk pihak luar")

**Goal.** Let any active member ask for items for a date range and see, while filling, whether the stock is there. Let an Operations member record the same request for an outside party.

**Who sees it.** Every active member (fixed right L9). The "Untuk siapa" choice needs `borrowing.handle`. With no active period the form is replaced by a message (R11).

**Path.** Katalog -> "+ Ajukan Peminjaman" (or "Ajukan barang ini" on an item) -> sets the dates -> adds items and quantities -> writes the purpose -> "Ajukan Peminjaman" -> lands on Detail Pengajuan with "Pengajuan terkirim. Cek statusnya di Peminjaman Saya."

### 9.1 Wireframe (narrow column, 390 px)

```
+----------------------------------------------+
|  < Kembali                                   |
|  Ajukan Peminjaman                           |  Playfair 24
|                                              |
|  (only for Operations)                       |
|  +----------------------------------------+  |
|  | Untuk siapa                            |  |
|  |  (o) Untuk saya                        |  |  radio
|  |  ( ) Untuk pihak luar                  |  |
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |
|  | Tanggal                                |  |
|  | Mulai (wajib)                          |  |
|  | [dd/mm/yyyy                          ] |  |
|  | Sampai (wajib)                         |  |
|  | [dd/mm/yyyy                          ] |  |
|  | Sampai tanggal ini ikut dihitung.      |  |
|  | 3 hari                                 |  |  live duration
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Barang                                 |  |
|  |  [Nama barang]                         |  |
|  |  INV-0012                              |  |
|  |  Jumlah     [-] [  2 ] [+]   [Hapus]   |  |
|  |  Tersedia 3 dari 4 pada 10-12 Des      |  |  per line, role=status
|  |  ------------------------------------  |  |
|  |  [Nama barang lain]                    |  |
|  |  5 unit                                |  |
|  |  Jumlah     [-] [  1 ] [+]   [Hapus]   |  |
|  |  Tidak tersedia pada tanggal itu.      |  |
|  |  [ + Tambah barang ]                   |  |  outline
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Keperluan                              |  |
|  | Keperluan atau kegiatan (wajib)        |  |
|  | [Nama kegiatan atau tim            ]   |  |  placeholder, 3 rows
|  | Catatan (boleh kosong)                 |  |
|  | [                                  ]   |  |
|  +----------------------------------------+  |
|  [            Ajukan Peminjaman            ]  |
|  Batal                                       |
+----------------------------------------------+
```

"Untuk pihak luar" adds a card above "Tanggal":

```
|  +----------------------------------------+  |
|  | Pihak peminjam                         |  |
|  | Nama organisasi (wajib)                |  |
|  | [                                    ] |  |
|  | Nama penanggung jawab (wajib)          |  |
|  | [                                    ] |  |
|  | Kamu tercatat sebagai pencatat. Nomor  |  |
|  | telepon dan email tidak disimpan di    |  |
|  | NEXUS. Hubungi mereka di luar aplikasi.|  |
|  +----------------------------------------+  |
```

Item picker (bottom sheet, 3.3):

```
|  Pilih barang                        [Tutup] |
|  [Q] Cari nama atau kode barang...           |
|  +----------------------------------------+  |
|  | [Nama barang]                          |  |  whole row = button, 56 px
|  | INV-0012 . [Kategori] . 4 baik         |  |
|  |----------------------------------------|  |
|  | [Nama barang lain]                     |  |
|  | 5 unit . [Kategori] . 3 baik           |  |
|  |----------------------------------------|  |
|  | [Barang yang sudah dipilih]            |  |
|  | Sudah ditambahkan (check)              |  |  not selectable
|  +----------------------------------------+  |
```
Choosing a row adds the line and closes the sheet, focus goes to that line's quantity field.

### 9.2 Fields

| Field | Type | Validation | Error text |
|---|---|---|---|
| Untuk siapa | radio, only for `borrowing.handle` | Default "Untuk saya" | |
| Nama organisasi | text, wajib (outside party) | 1 to 120 characters | "Isi nama organisasi." |
| Nama penanggung jawab | text, wajib (outside party) | 1 to 120 characters | "Isi nama penanggung jawab." |
| Mulai | date, wajib | Not before today (Jakarta) | "Pilih tanggal mulai." / "Tanggal mulai tidak boleh sebelum hari ini." |
| Sampai | date, wajib | Not before Mulai. No maximum length of loan (IB5) | "Pilih tanggal akhir." / "Tanggal akhir tidak boleh sebelum tanggal mulai." |
| Barang (lines) | at least one; each item once | Only active items with stock in Baik are offered | "Tambahkan minimal satu barang." |
| Jumlah per line | stepper, whole number | 1 up to the free quantity for the whole range | "Isi angka bulat, mulai 1." / "Hanya {n} yang tersedia pada tanggal itu." |
| Keperluan atau kegiatan | textarea, wajib | 1 to {n} characters | "Isi keperluannya, misalnya nama kegiatan atau tim." |
| Catatan | textarea, boleh kosong | up to {n} characters | "Catatan terlalu panjang. Pakai paling banyak {n} karakter." |

Same item twice: the picker marks it "Sudah ditambahkan" and does not allow it (R20). Contact fields: none exist (IB14).

### 9.3 Live availability on each line

| Situation | Line text (icon plus text) |
|---|---|
| Dates not set yet | "Pilih tanggal untuk melihat ketersediaan." (neutral) |
| Checking | "Memeriksa ketersediaan..." |
| Enough | "Tersedia {n} dari {m} pada {rentang}." (success tone) |
| Not enough | "Hanya {n} tersedia pada tanggal itu. Kurangi jumlahnya." (warning tone) |
| None | "Tidak tersedia pada tanggal itu. Hapus barang ini atau ganti tanggal." (error tone) |
| Could not load | "Ketersediaan tidak bisa dimuat." plus text button "Coba lagi" |

It refreshes when the dates or the quantity change (short pause), is `role=status` per line, and never says who has the item. Pending requests of others hold nothing (IB6), so the number counts only approved and borrowed stock. The server re-checks on submit; the form is only a preview (spec F3.4).

### 9.4 Actions

| Action | What it does |
|---|---|
| "+ Tambah barang" | Opens the item picker. |
| "Hapus" on a line | Removes the line (no confirmation, it is easy to add again). |
| "Ajukan Peminjaman" | Validates on the server. Saves as Diajukan, period = active period, requester = the signed-in member (outside party: the recorder). Goes to Detail Pengajuan with the success message. For an outside party the message reads "Pengajuan untuk {organisasi} tersimpan. Menunggu persetujuan." Pressing with problems: the top summary alert and the first problem line is focused (button never greyed). |
| "Batal" | Back, with "Buang perubahan?" if anything was typed. |

### 9.5 States

| State | What shows |
|---|---|
| No active period | No form. Warning alert "Belum ada periode aktif. Pengajuan belum bisa dibuat." and the text button "Kembali ke katalog". |
| Loading | Skeleton of the three cards, caption "Memuat form...". |
| Picker empty | "Belum ada barang yang bisa dipinjam." (no item is active with Baik stock). |
| Picker no match | "Tidak ada hasil. Ubah pencarian." |
| Stock changed between form and save | Warning alert at the top: "Stok berubah. Cek lagi." The form keeps every input, the availability lines refresh and the changed lines are marked. |
| Submitting | "Mengirim..." with spinner; fields read-only; second press ignored. |
| Server error / network | Warning alert (3.6) above the button; input kept. |
| Right removed | "Aksesmu sudah berubah..." (3.6). |
| Success | Detail Pengajuan with success message. |

### 9.6 Accessibility and touch

- Sections are `fieldset`s with legends ("Tanggal", "Barang", "Keperluan"). Each line is a `li` whose controls have names that include the item ("Jumlah {nama barang}", "Hapus {nama barang}").
- The summary alert after a failed submit lists links to the fields (3.4).
- Steppers 48 x 48 with the number field in the middle; picker rows 56 px; all buttons 48; "Hapus" 44 px.
- Focus order follows the page order; the picker is a dialog with Escape and a focus trap.
- Wider screens: the form stays one column (max 448 px) centred; from 1024 px "Tanggal" and "Barang" can sit side by side.

---

## 10. Screen 7: Peminjaman Saya and Detail Pengajuan

**Goal.** Let a member see where each request stands, what the head said, and cancel while it is still allowed. This screen is the only status channel because NEXUS sends no notifications (IB14).

**Who sees it.** Every active member, own requests only (fixed right L9). An Operations member also sees the requests they recorded for outside parties here (they are the requester of record).

**Path.** Opens "Peminjaman Saya" -> sees the open requests first -> opens one -> reads the timeline and the note -> cancels if needed.

### 10.1 Wireframe: list (390 px)

```
+----------------------------------------------+
|  Manajemen & Inventaris        +-----------+ |
|  Periode 2026/2027             | Pengajuan | |
|                                | 3 berjalan| |
|                                +-----------+ |
|  [ segmented control ]                       |
|                                              |
|  [          + Ajukan Peminjaman          ]   |
|                                              |
|  (Berjalan) (Selesai) (Semua)                |  filter tags, single choice
|                                              |
|  +----------------------------------------+  |  request card, r12, 1 px #EADFCF
|  | [Referensi]               (Terlambat 3 h)|  |  chip(s)
|  | [Barang A], [Barang B] +1 barang       |  |
|  | 10-12 Des 2026 . 3 hari                |  |
|  | (Dipinjam)                             |  |
|  | Sebagian kembali, sisa 1 dari 3        |  |  text
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Referensi]                (Disetujui) |  |
|  | [Barang C]                             |  |
|  | 20-21 Des 2026 . 2 hari                |  |
|  | Catatan dari [Nama kepala]: [teks...]  |  |  first 2 lines of the note
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Referensi]                  (Diajukan)|  |
|  | Untuk: [Organisasi] (pihak luar)       |  |  only for outside-party requests
|  | ...                                    |  |
|  +----------------------------------------+  |
|     [< Prev]  [1] [2]  [Next >]              |
|     Menampilkan 1-20 dari 24 pengajuan       |
+----------------------------------------------+
```

Each card is one link (the reference is the link text, stretched over the card with a visible focus ring around the card). Order: open requests by start date (soonest first), closed ones newest first.

### 10.2 Wireframe: Detail Pengajuan (requester view, narrow column)

```
+----------------------------------------------+
|  < Peminjaman Saya                           |
|  Pengajuan [Referensi]                       |  Playfair 24
|  (Dipinjam) (Terlambat 3 hari)               |  chips
|                                              |
|  +----------------------------------------+  |  only when derived state applies
|  | (!) Terlambat 3 hari. Kembalikan       |  |  warning tone
|  | barang ke tim Operasional.             |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Ringkasan                              |  |
|  | Pemohon     [Nama]                     |  |
|  | Tanggal     10-12 Des 2026 (3 hari)    |  |
|  | Keperluan   [teks]                     |  |
|  | Catatan     [teks, bila ada]           |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Barang                                 |  |
|  | [Nama barang]                          |  |
|  | Diminta  Disetujui  Diserahkan Kembali |  |  4 small cells, appear as they apply
|  |   2         2          2          1    |  |
|  | Unit: INV-0031, INV-0032               |  |  tracked items
|  | Sisa belum kembali: 1                  |  |
|  | Rusak 1 (Perlu servis)  [Foto bukti (2)]|  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Keputusan                              |  |  only after a decision
|  | Disetujui oleh [Nama kepala]           |  |
|  | 9 Des 2026, 14.05 WIB                  |  |
|  | "[Catatan kepala]"                     |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | Riwayat                                |  |
|  |  (o) Diajukan                          |  |  timeline, newest first
|  |  |   9 Des 2026, 10.12 WIB             |  |
|  |  (o) Disetujui oleh [Nama]             |  |
|  |  |   9 Des 2026, 14.05 WIB             |  |
|  |  (o) Diserahkan, dicatat [Nama]        |  |
|  |  |   10 Des 2026, 09.30 WIB            |  |
|  |  (o) Tanggal kembali diubah            |  |
|  |      12 Des 2026 menjadi 15 Des 2026   |  |
|  |      Catatan: [teks]                   |  |
|  +----------------------------------------+  |
|  [ Batalkan pengajuan ]                      |  outline; only while allowed
+----------------------------------------------+
```

### 10.3 Status text and what each says to the requester

| Stored status or derived state | Chip (section 17) | Extra line on the detail |
|---|---|---|
| Diajukan | Diajukan | "Menunggu keputusan dari kepala Operasional." |
| Disetujui | Disetujui | "Ambil barang ke tim Operasional pada tanggal mulai." |
| Disetujui, start date passed, not picked up (derived) | Disetujui plus Belum diambil | Info alert: "Barang belum diambil. Ambil ke tim Operasional, atau batalkan pengajuan kalau tidak jadi." |
| Ditolak | Ditolak | The head's note in the Keputusan card; button "Ajukan lagi" (P11) |
| Dibatalkan | Dibatalkan | Who cancelled and the reason, in the timeline |
| Dipinjam | Dipinjam | "Kembalikan barang ke tim Operasional paling lambat {tanggal}." |
| Dipinjam, partly returned (derived) | Dipinjam plus Sebagian kembali | "Sisa belum kembali: {n}." per line |
| Dipinjam, end date passed (derived) | Dipinjam plus Terlambat {n} hari | Warning alert (see wireframe) |
| Dikembalikan | Dikembalikan (plus "Ada masalah" if any damaged or lost) | "Semua barang sudah kembali." |

### 10.4 Actions (on the detail, by person and state)

| Action | Who and when | What it does |
|---|---|---|
| "Batalkan pengajuan" | The requester of record: while Diajukan; or Disetujui and not yet picked up. Never after Dipinjam. | Dialog below. Status becomes Dibatalkan, held stock is freed. |
| "Foto bukti ({n})" | `borrowing.view_all` holders and the requester | Opens a viewer sheet with the photos (short-lived signed links). Error: "Foto tidak bisa dimuat. Coba lagi." |
| Head and Operations actions | See screens 8, 9, 10 | Same page, buttons by key and state. Absent when not allowed. |

Cancel dialog: title "Batalkan pengajuan?". Text "Pengajuan tidak bisa dibuka lagi. Kamu bisa membuat pengajuan baru." Field: "Alasan (boleh kosong)" while Diajukan; "Alasan (wajib)" once Disetujui (error "Tulis alasan pembatalan."). Buttons "Batalkan pengajuan" (primary) and "Kembali" (text). A cancelling Operations member (not the requester) sees the same dialog with the reason always wajib.

### 10.5 States

| State | What shows |
|---|---|
| Loading (list or detail) | Flat card skeletons, caption "Memuat pengajuan...". |
| Empty (no requests at all) | Card: "Kamu belum punya pengajuan." plus a primary button "Ajukan Peminjaman". |
| Empty for a filter | "Tidak ada pengajuan di sini." and text button "Lihat semua". |
| Not found or someone else's request | Card "Pengajuan ini tidak ditemukan." (the same answer for both, so it reveals nothing). |
| Error | Warning alert (3.6) with "Coba lagi". |
| No active period | Banner; the list and detail stay readable (L9). |
| Cancel succeeds | Detail shows success "Pengajuan dibatalkan." |
| Conflict (already decided while the dialog was open) | "Data sudah berubah. Muat ulang." |

### 10.6 Accessibility and touch

- The timeline is an ordered list; each entry has the text of the event, the person and a `<time>` element. The dot is decorative (`aria-hidden`); the current step is also bold. Dots: current = filled `#62431F`, earlier = outline `#81756A`.
- The four-cell quantity row is a `<dl>` per line so a screen reader hears "Diminta 2, Disetujui 2, ...".
- Targets: cards are one 44+ px link; buttons 48; viewer button 44.
- Wider screens: at 768 px the lines become a real table (Barang, Diminta, Disetujui, Diserahkan, Kembali, Sisa); from 1024 px Riwayat sits in a right column.

---

## 11. Screen 8: Approval queue, review, approve or reject, extend

**Goal.** Let a head decide a request with the facts in front of them, and give Operations a work list for what is waiting.

**Who sees it.** The Antrean section: `borrowing.view_all` (included in `approve` and `handle`). Approve, reject and extend: `borrowing.approve` (heads only), never on their own request (L6). Handover and return buttons: `borrowing.handle` (screens 9 and 10). BPH sees the list and the detail with no buttons.

**Path (head).** Opens Antrean -> sees "Menunggu persetujuan" oldest first -> opens a request -> checks availability and warnings -> "Setujui" or "Tolak" with a note. For an extension: opens an approved or borrowed request -> "Ubah tanggal kembali".

### 11.1 Wireframe: Antrean list (390 px)

```
+----------------------------------------------+
|  Manajemen & Inventaris        +-----------+ |
|  Periode 2026/2027             | Pengajuan | |
|                                | 3 menunggu| |
|                                +-----------+ |
|  [ segmented control, Antrean active ]       |
|                                              |
|  Tampilkan                                   |
|  [Menunggu persetujuan (3)                v] |  select, 48 px
|  [Q] Cari nama pemohon atau barang...        |
|  [ Filter tanggal  v ]            [Ekspor v] |
|                                              |
|  +----------------------------------------+  |  hint, only for a lone head with own pending request
|  | (i) Hanya kamu yang bisa menyetujui    |  |
|  | saat ini. Pengajuanmu sendiri menunggu |  |
|  | kepala lain.                           |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Nama pemohon]             (Diajukan)  |  |
|  | [Barang A] x2, [Barang B] x1           |  |
|  | 10-12 Des 2026 . 3 hari                |  |
|  | (!) 2 pengajuan lain di tanggal sama   |  |  warning text + icon
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Nama pemohon] (Pengajuanmu)  (Diajukan)|  |
|  | ...                                    |  |
|  +----------------------------------------+  |
|     [< Prev]  [1] [2]  [Next >]              |
|     Menampilkan 1-3 dari 3 pengajuan        |
+----------------------------------------------+
```

"Tampilkan" options (a count in brackets, shown only for the groups this person may act on):

| Option | Contains | Default for |
|---|---|---|
| Menunggu persetujuan | Diajukan, oldest first | Heads |
| Siap diambil | Disetujui, not yet handed over (includes Belum diambil), soonest start first | Operations members who are not heads |
| Sedang dipinjam | Dipinjam, by end date, Terlambat first | |
| Terlambat | Dipinjam with end date before today | |
| Selesai | Dikembalikan, Ditolak, Dibatalkan, newest first | |
| Semua | All of the current period | BPH |
| Belum selesai, semua periode | Screen 11 | |

A person who is both head and Operations lands on "Menunggu persetujuan". Search matches requester name, organisation name and item name (spec F4 filters: status, date range, item, requester, Terlambat). "Filter tanggal" opens the card with Dari and Sampai (requests whose range overlaps it), same card style as screen 2.

Card contents: requester name (PI-CORE name; for an outside party the organisation name, then "Dicatat oleh {nama}" in the second line), item summary with quantities, date range with duration, status chip(s), and a warning line when relevant. "Pengajuanmu" is a plain text marker next to the name for the person's own requests. The whole card is the link to Detail Pengajuan.

### 11.2 Wireframe: Detail Pengajuan, head's review (same page as screen 7, extra panel)

```
|  < Antrean                                   |
|  Pengajuan [Referensi]            (Diajukan) |
|                                              |
|  +----------------------------------------+  |
|  | (!) 2 pengajuan lain berstatus Diajukan|  |  warning tone
|  | di tanggal yang sama. Menyetujui satu  |  |
|  | bisa membuat yang lain tidak kebagian. |  |
|  +----------------------------------------+  |
|  [ Ringkasan card: pemohon, tanggal, keperluan ]
|  +----------------------------------------+  |
|  | Barang dan ketersediaan                |  |
|  | [Nama barang]                          |  |
|  | Diminta 2    Tersedia sekarang 3 dari 4|  |
|  | Disetujui    [-] [ 2 ] [+]             |  |  default = diminta, can be lower
|  |----------------------------------------|  |
|  | [Barang lain]                          |  |
|  | Diminta 1    Tersedia sekarang 0 dari 2|  |  error tone, text
|  | Disetujui    [-] [ 0 ] [+]             |  |
|  +----------------------------------------+  |
|  [ Riwayat card ]                            |
|  [            Setujui                    ]   |  primary
|  [            Tolak                      ]   |  outline
+----------------------------------------------+
```

Own request, no buttons:

```
|  +----------------------------------------+  |
|  | (i) Tidak bisa memproses pengajuanmu   |  |
|  | sendiri. Kepala lain yang memutuskan.  |  |
|  +----------------------------------------+  |
```
With only one head in office, a second line: "Saat ini hanya ada satu pemberi persetujuan, jadi pengajuan ini menunggu kepala lain." (B29: no override.)

### 11.3 Approve, reject and extend: fields, dialogs

**Per-line approval quantity.** Stepper from 0 to the requested quantity, never above "Tersedia sekarang". "Tersedia sekarang" counts approved and borrowed stock only for the requested range, and does not count this request (pending requests hold nothing). Lowering a quantity below the requested one makes the note wajib (A-IB14).

**Dialog "Setujui pengajuan".** Text: a one-line summary ("{n} barang, 10-12 Des 2026"). Field "Catatan (boleh kosong)"; "Catatan (wajib)" if any quantity is lower than requested, error "Tulis kenapa jumlahnya dikurangi." Buttons "Setujui pengajuan" and "Batal".

**Dialog "Tolak pengajuan".** Field "Alasan penolakan (wajib)", hint "Pemohon akan membaca alasan ini." Error "Tulis alasan penolakan, supaya pemohon tahu." Buttons "Tolak pengajuan" and "Batal".

**Conflict on approve.** Stock ran out between opening and pressing (another head, or a quantity change): the dialog stays open with a warning alert "Stok tidak cukup di tanggal itu. Pengajuan tetap menunggu." and the line quantities refresh to the new numbers; the head can lower them or press "Tolak". Status already changed by someone else: "Data sudah berubah. Muat ulang." with "Muat ulang".

**Dialog "Ubah tanggal kembali"** (extend; Disetujui or Dipinjam; `borrowing.approve`; not on own request). Shows "Tanggal kembali sekarang: 12 Des 2026". Fields:

| Field | Type | Validation | Error text |
|---|---|---|---|
| Tanggal kembali baru (wajib) | date | After the current end date (later only, spec F8) | "Pilih tanggal setelah {tanggal sekarang}." |
| Catatan (wajib) | textarea | At least one character | "Tulis alasan perpanjangan." |

Conflict: "Bentrok dengan pengajuan lain pada {tanggal}. Tanggal belum diubah." (a date, never a name). Buttons "Simpan tanggal baru" and "Batal". Success: "Tanggal kembali diubah." and a timeline entry (old date, new date, note, who).

### 11.4 Actions summary (Detail Pengajuan, by key and state)

| Button | Key | Shown when |
|---|---|---|
| Setujui, Tolak | `borrowing.approve` | Diajukan and not the viewer's own |
| Ubah tanggal kembali | `borrowing.approve` | Disetujui or Dipinjam and not the viewer's own |
| Serahkan barang | `borrowing.handle` | Disetujui (screen 9) |
| Terima pengembalian | `borrowing.handle` | Dipinjam with outstanding quantity (screen 10) |
| Batalkan pengajuan | `borrowing.handle` or the requester | Disetujui and not picked up (cancel dialog, reason wajib) |
| Koreksi pengembalian | `borrowing.handle` | Dikembalikan. Dialog: title "Kembalikan status ke Dipinjam?", text "Pakai ini hanya untuk memperbaiki salah catat pengembalian. Koreksi hanya bisa sekali per pengajuan, dan ditolak kalau stok barang sudah berubah. Tindakan ini tercatat.", field "Alasan (wajib)", error "Tulis alasan koreksi.", button "Koreksi pengembalian". |

Buttons that the viewer may not use are absent, never grey (K9). Handover and return of the viewer's own request are allowed; the page says so (screens 9 and 10).

### 11.5 States

| State | What shows |
|---|---|
| Loading | Flat card skeletons, caption "Memuat antrean...". |
| Empty queue (Menunggu persetujuan) | "Tidak ada pengajuan yang menunggu." |
| Empty for another option | "Tidak ada pengajuan di sini." |
| No match | "Tidak ada hasil. Ubah pencarian atau filter." with "Reset". |
| Error | Warning alert (3.6). |
| Forbidden | `ForbiddenScreen`. With no active period it adds the period text. |
| Right removed while open | "Aksesmu sudah berubah..." on the next action. |
| Conflict | As 11.3. |
| Success | Detail page with a success message: "Pengajuan disetujui." / "Pengajuan ditolak." / "Tanggal kembali diubah." |

### 11.6 Accessibility and touch

- The "Tampilkan" select and the cards use the same markup as Data Anggota filters and screen 7 cards. Counts in the options are part of the option text so a screen reader hears them.
- Dialog buttons 48, steppers 48, cards 44+. Escape closes a dialog, focus returns to "Setujui" or "Tolak".
- Warnings use an icon and a full sentence; the "not enough" line in the review panel is text, not red alone.
- Wider screens: from 768 px the queue cards become table rows (Pemohon, Barang, Tanggal, Status); the review panel and the history sit side by side from 1024 px.

---

## 12. Screen 9: Handover ("Serahkan barang")

**Goal.** Record what was actually given to the borrower, and which physical units for tracked items.

**Who sees it.** `borrowing.handle` (any Operations member, also for their own request, IB2).

**Path.** Antrean -> "Siap diambil" -> opens a request -> "Serahkan barang" -> sets quantities or ticks units -> "Catat serah terima" -> the request becomes Dipinjam.

### 12.1 Wireframe (narrow column, 390 px)

```
+----------------------------------------------+
|  < Pengajuan [Referensi]                     |
|  Serahkan barang                             |  Playfair 24
|                                              |
|  +----------------------------------------+  |
|  | [Nama pemohon]          (Disetujui)    |  |
|  | 10-12 Des 2026 . 3 hari                |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |  own request only
|  | (i) Kamu mencatat serah terima         |  |
|  | pengajuanmu sendiri. Riwayat mencatat  |  |
|  | namamu sebagai pencatat.               |  |
|  +----------------------------------------+  |
|                                              |
|  +----------------------------------------+  |  quantity item
|  | [Nama barang]                          |  |
|  | INV-0012 . Disetujui 2                 |  |
|  | Diserahkan   [-] [  2 ] [+]            |  |
|  | + Tambah catatan                       |  |  text button, opens a field
|  +----------------------------------------+  |
|  +----------------------------------------+  |  tracked item
|  | [Nama barang lain]                     |  |
|  | Disetujui 2 . Dipilih 1 dari 2         |  |
|  | [Q] Cari kode                          |  |  only when more than 8 units
|  |  [x] INV-0031  [Lokasi]                |  |  checkbox rows, 48 px
|  |  [ ] INV-0032  [Lokasi]                |  |
|  |  [ ] INV-0035  [Lokasi]                |  |
|  | (!) Dipilih 1, disetujui 2. Tulis      |  |
|  | kenapa jumlahnya kurang.               |  |
|  | Catatan (wajib)                        |  |
|  | [                                    ] |  |
|  +----------------------------------------+  |
|  [         Catat serah terima            ]   |
|  Batal                                       |
+----------------------------------------------+
```

### 12.2 Fields

| Field | Type | Rule | Error text |
|---|---|---|---|
| Diserahkan (quantity item) | stepper | 0 up to the approved quantity | "Isi angka bulat, paling banyak {n}." |
| Units (tracked item) | checkbox list | Only units in Baik that are on no other open loan. The number ticked is the number handed over. | "Pilih paling banyak {n} unit." |
| Catatan | textarea | Boleh kosong ("Tambah catatan", for condition). **Wajib** when handing over less than approved. | "Tulis kenapa jumlahnya kurang dari yang disetujui." |

If fewer lendable units exist than approved (a unit went to service meanwhile, R10), a warning above the list: "Hanya {n} unit baik yang bisa diserahkan, padahal disetujui {m}. Serahkan yang ada dan tulis alasannya."

### 12.3 Actions and rules

| Action | What it does |
|---|---|
| "Catat serah terima" | Status becomes Dipinjam, handed quantities count as on loan, one history row names the recorder. Goes to the detail with "Serah terima tercatat. Status: Dipinjam." |
| Nothing handed over (all zero) | Pressing shows, under the buttons: "Pilih minimal satu barang yang diserahkan. Kalau tidak ada yang diserahkan, batalkan pengajuan." with the text button "Batalkan pengajuan" (opens the cancel dialog, reason wajib). Spec F5.3. |
| Before the start date | The form is replaced by an info alert: "Belum bisa diserahkan. Tanggal mulai peminjaman: {tanggal}." (A-IB8, an assumption). |
| "Batal" | Back to the detail. |

### 12.4 States

| State | What shows |
|---|---|
| Loading | Skeleton of the summary and the line cards, caption "Memuat serah terima...". |
| A unit was taken in the meantime | Warning alert: "Unit {kode} baru dipakai pengajuan lain. Pilih unit lain." The ticked list refreshes. |
| Status already changed | "Data sudah berubah. Muat ulang." |
| Saving | "Menyimpan..." with spinner. |
| Error | Warning alert (3.6), input kept. |
| Forbidden | `ForbiddenScreen`. |
| Empty | Not applicable (a request always has lines). |
| Success | Detail with the success message. |

### 12.5 Accessibility and touch

- The unit list is a `fieldset` with a legend "Pilih unit untuk {nama barang}". Each checkbox row is one `label`, 48 px high, whole row tappable. Counter "Dipilih 1 dari 2" is `role=status`.
- Stepper and buttons 48; checkbox target 48 x 48.
- Wider screens: line cards in two columns from 1024 px; otherwise one column (max 448 px).

---

## 13. Screen 10: Return ("Terima pengembalian") with the photo picker

**Goal.** Record what came back and in what condition, with a note and photos for anything damaged or lost, and allow a partial return.

**Who sees it.** `borrowing.handle` (also for their own request, IB2).

**Path.** Antrean -> "Sedang dipinjam" -> opens the request -> "Terima pengembalian" -> leaves "Baik" for the clean lines, marks exceptions -> adds note and photos for damage or loss -> "Catat pengembalian" -> sees a short check -> saves.

### 13.1 Wireframe: quantity item (narrow column)

```
+----------------------------------------------+
|  < Pengajuan [Referensi]                     |
|  Terima pengembalian                         |
|                                              |
|  +----------------------------------------+  |
|  | [Nama pemohon]    (Dipinjam)(Terlambat)|  |
|  | 10-12 Des 2026 . 3 hari                |  |
|  +----------------------------------------+  |
|  +----------------------------------------+  |
|  | [Nama barang]                          |  |
|  | INV-0012 . Belum kembali: 3            |  |
|  |                                        |  |
|  | Kembali baik   [-] [  2 ] [+]          |  |  default = all outstanding
|  | Rusak          [-] [  1 ] [+]          |  |
|  | Hilang         [-] [  0 ] [+]          |  |
|  | Masih di peminjam: 0                   |  |  live
|  |                                        |  |
|  |  Barang rusak (1)                      |  |  appears when Rusak > 0
|  |  Kondisi sekarang (wajib)              |  |
|  |   (o) Perlu servis   ( ) Rusak         |  |
|  |  Catatan (wajib)                       |  |
|  |  [                                   ] |  |
|  |  Foto bukti (wajib, 1 sampai 3)        |  |
|  |  [ photo picker, below ]               |  |
|  +----------------------------------------+  |
```

Tracked item, one row per unit still out:

```
|  +----------------------------------------+  |
|  | [Nama barang lain]                     |  |
|  | Belum kembali: 2 unit                  |  |
|  |                                        |  |
|  | INV-0031                               |  |
|  | [ Baik | Rusak | Hilang | Belum ]      |  |  4 segments, 48 px, radio group
|  |                                        |  |
|  | INV-0032                               |  |
|  | [ Baik | Rusak | Hilang | Belum ]      |  |
|  |  Rusak: Kondisi sekarang (wajib)       |  |  opens under the unit
|  |   (o) Perlu servis   ( ) Rusak         |  |
|  |  Catatan (wajib)       [           ]   |  |
|  |  Foto bukti (wajib)    [picker]        |  |
|  +----------------------------------------+  |
|  [        Catat pengembalian             ]   |
|  Batal                                       |
```
"Belum" means the unit stays out (a partial return, spec F6.4). Default is "Baik" for every unit.

Photo picker (one per damaged or lost outcome):

```
|  Foto bukti (wajib, 1 sampai 3)              |
|  Foto diperkecil otomatis sebelum diunggah.  |
|                                              |
|  +------------------+ +------------------+   |
|  |    Ambil foto    | | Pilih dari galeri|   |  2 outline buttons, 48 px
|  +------------------+ +------------------+   |
|                                              |
|  +------+  Foto 1                            |  tile: 72 px thumbnail, r8
|  | img  |  Terunggah (check)      [Hapus]    |
|  +------+                                    |
|  +------+  Foto 2                            |
|  | img  |  Mengunggah 45%                    |
|  +------+  [=======-------]                  |  flat bar: track #F0E9DC, fill #62431F
|  +------+  Foto 3                            |
|  | img  |  Gagal diunggah.  [Coba lagi][Hapus]|
|  +------+                                    |
```

### 13.2 Fields and rules

| Field | Type | Rule | Error text |
|---|---|---|---|
| Kembali baik, Rusak, Hilang (quantity item) | steppers | Whole numbers; the three together may not exceed the quantity still out. Default Baik = all that is out. What is not counted stays out ("Masih di peminjam: n"). | "Jumlah melebihi yang belum kembali ({n})." |
| Unit outcome (tracked) | radio segments Baik / Rusak / Hilang / Belum | One per unit | |
| Kondisi sekarang | radio, wajib for Rusak | Perlu servis or Rusak. Applies to all damaged units or pieces of that line in this return. If their conditions differ, record the return twice (G11) | "Pilih kondisi barang sekarang." |
| Catatan | textarea | **Wajib** for Rusak and Hilang. Boleh kosong for Baik | "Tulis catatan: apa yang rusak atau hilang." |
| Foto bukti | photo picker | **Wajib**, 1 to 3 photos for Rusak and Hilang. Never for Baik | "Tambahkan minimal satu foto." |

A line with both Rusak and Hilang gets two evidence blocks (one per outcome), as the spec records one note and photo set per outcome.

### 13.3 Photo picker behaviour

| Aspect | Specification |
|---|---|
| Choice | "Ambil foto" opens the phone camera (file input with `capture`, rear camera). "Pilih dari galeri" opens the gallery (several photos allowed up to the limit). On a computer both open the file chooser; "Ambil foto" is hidden there. At 3 photos both buttons disappear and a line says "Maksimal 3 foto." |
| Accepted | JPG, PNG, WebP. Other types: "Format foto tidak didukung. Pakai JPG, PNG, atau WebP." (Phone gallery pickers convert HEIC to JPG when the input asks for these types.) |
| Size before resizing | Up to {max} MB per original ([PROPOSAL P8b]: 15 MB). Over it: "Foto terlalu besar. Pakai foto di bawah {max} MB." |
| Resize | In the browser, before upload: long side about 1280 px, quality lowered in steps until the file is at most 1.5 MiB, the bucket limit (A-IB31, A-IB43). The tile shows "Memperkecil..." with a static spinner. If it cannot get under the limit: "Foto masih terlalu besar setelah diperkecil. Coba foto lain." |
| Upload | Starts as soon as the resize ends (the person learns about a bad connection while still standing at the desk). Tile shows "Mengunggah {n}%" and a flat progress bar (`role=progressbar`, `aria-valuenow`). |
| Done | "Terunggah" with a check icon and the thumbnail. |
| Failure | "Gagal diunggah." with "Coba lagi" (sends the resized photo again, no new pick) and "Hapus". Network-specific: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi." |
| Remove | "Hapus" per tile (accessible name "Hapus foto 2"), 44 px. |
| While busy | Saving is refused with a message under the button, not a disabled button: "Tunggu sampai semua foto selesai diunggah." |
| Rule of the spec | If an upload failed, the line is not saved: "Foto gagal diunggah. Coba lagi." (spec states table) |
| Privacy | Nothing is shown to other members. Photos open only for `borrowing.view_all` holders and the requester (signed links). |

[PROPOSAL P8] Upload on pick (above) versus upload on save. On pick is easier on weak Wi-Fi (failure is visible early, saving is quick) but can leave unused files if the person abandons the screen; the spec says evidence is never purged (L5), so unused files need a rule (gap G5). Recommendation: upload on pick, and let the backend treat unattached files as not-evidence so they can be cleaned.

### 13.4 Check before saving

Pressing "Catat pengembalian" with valid input opens a small sheet (3.3): title "Simpan pengembalian?", a plain summary such as "Kembali baik 3, rusak 1, hilang 0. Masih di peminjam: 0." and buttons "Simpan pengembalian" and "Periksa lagi". Reason: records are append-only and only one reasoned correction exists (A-IB15), so one calm check is cheap insurance. [PROPOSAL P15] If you prefer fewer steps, drop it.

### 13.5 Actions and results

| Action | Result |
|---|---|
| Save with everything back and good | Status Dikembalikan. Message "Pengembalian tercatat. Semua barang sudah kembali." |
| Save with something still out | Request stays Dipinjam, shows Sebagian kembali. Message "Pengembalian tercatat. Masih di peminjam: {n}." |
| Save with damaged or lost lines | Condition of the unit or quantity moves to the stated condition (or the unit is written off as Hilang); the request shows the "Ada masalah" chip when it is closed. Message "Pengembalian tercatat. Ada barang rusak atau hilang." |
| "Batal" | Back to the detail, with "Buang perubahan?" if anything was entered. |

### 13.6 States

| State | What shows |
|---|---|
| Loading | Skeleton, caption "Memuat pengembalian...". |
| Photo states | As 13.3. |
| Validation | Summary alert at the top (3.4), each problem line marked. |
| Own request | Info alert as in screen 9: "Kamu mencatat pengembalian pengajuanmu sendiri. Riwayat mencatat namamu sebagai pencatat." |
| Already returned (second tap, other device) | "Data sudah berubah. Muat ulang." (one history row only, IB-48). |
| Server error | Warning alert, nothing saved, input and photos kept. |
| Forbidden | `ForbiddenScreen`. |
| Success | Detail with the success message. |

### 13.7 Accessibility and touch

- The four-segment unit control is a `radiogroup` of native radios styled as segments; each segment 48 px high, at least 72 px wide at 310 px; the selected one is filled walnut with bold text (not colour alone).
- Photo buttons are real buttons with file inputs behind them; each tile is a group labelled "Foto bukti {n}" with its status in text; the live region announces "Foto 2 terunggah" or "Foto 3 gagal diunggah".
- Thumbnails carry `alt="Foto bukti {n}"`.
- Targets: steppers 48, segments 48, photo buttons 48, "Hapus" 44, "Coba lagi" 44.
- Wider screens: unit rows in two columns from 768 px; the photo tiles line up in a row.

---

## 14. Screen 11: Open loans view for period handover

**Goal.** Give the outgoing and incoming officers one list of everything not finished, across periods, and a file to hand over.

**Who sees it.** `borrowing.view_all` holders (section Antrean). The "Ekspor" button needs `borrowing.export`. Actions on a request inside the list still follow the keys.

**Path.** Antrean -> "Tampilkan: Belum selesai, semua periode" -> reads the summary and the groups -> exports the list -> the new team continues from it.

### 14.1 Wireframe (390 px)

```
+----------------------------------------------+
|  [ segmented control, Antrean active ]       |
|  Tampilkan                                   |
|  [Belum selesai, semua periode            v] |
|                                              |
|  +----------------------------------------+  |
|  | (i) Daftar ini untuk serah terima      |  |  info tone
|  | pengurus. Isinya semua pengajuan yang  |  |
|  | belum selesai, termasuk dari periode   |  |
|  | sebelumnya.                            |  |
|  +----------------------------------------+  |
|                                  [Ekspor v]  |
|  7 belum selesai: 2 menunggu persetujuan,    |  |  real counts, body-md
|  1 siap diambil, 4 dipinjam (1 terlambat).   |
|                                              |
|  Periode 2025/2026 (3)                       |  h2, Playfair headline-lg
|  +----------------------------------------+  |
|  | [Nama pemohon]   (Dipinjam)(Terlambat 5 h)|
|  | [Barang A] x2                          |  |
|  | 1-3 Nov 2026 . sisa belum kembali 2    |  |
|  +----------------------------------------+  |
|  ...                                         |
|  Periode 2026/2027 (4)                       |
|  +----------------------------------------+  |
|  | ... cards as in screen 8               |  |
```

### 14.2 Choices

| Choice | Reason |
|---|---|
| A group heading per period, oldest period first, then overdue first inside each group | The incoming team must see what is oldest and most urgent first. |
| The summary sentence uses real counts only; no bars, no percentages | IB12 spirit, R-17. |
| The export uses the same filter and its menu text reads "Unduh daftar peminjaman yang belum selesai sebagai:" | Spec F11.5 and A-IB11; the file holds the same rows as the screen. |
| Rows reuse the screen 8 card | One pattern to learn. |
| Old-period requests that are still open can be processed by whoever holds the key now (L7), so the buttons on their detail pages work as usual | Spec F11.2. |

### 14.3 States

| State | What shows |
|---|---|
| Loading | Skeleton of the info card and two groups, caption "Memuat daftar...". |
| Empty | "Tidak ada pengajuan yang belum selesai." (good news, plain text) |
| Error | Warning alert (3.6). |
| No active period | Not reachable (Operations keys match nothing, R11). The ForbiddenScreen with the period text shows. Spec R12 asks the handover guide to say "activate the new period first". |
| Success | Not applicable; export has its own message (screen 12). |

### 14.4 Accessibility and touch

- Each group is a `section` with an `h2`; the count in the heading is read ("Periode 2025/2026, 3 pengajuan").
- Same card targets as screen 8.
- Wider screens: groups become tables with the same columns as the queue.

---

## 15. Screen 12: Export menu

**Goal.** Download the current list as Excel, CSV or PDF, in the same way as Data Anggota.

**Who sees it.** `inventory.export` on Katalog and Kelola Barang; `borrowing.export` on Antrean. The button is absent for everyone else. A member cannot export their own requests (A-IB22), so Peminjaman Saya has no export.

### 15.1 Wireframe (identical to Data Anggota)

```
   [ Ekspor  v ]
   +------------------------------+
   | Unduh semua hasil filter     |
   | sebagai:                     |
   | Excel (.xlsx)                |   44 px rows
   | CSV (.csv)                   |
   | PDF (.pdf)                   |
   +------------------------------+
```
Elevation 2 menu, 240 px wide, right aligned. The button: 44 px, outline walnut 1.5 px, download icon, "Ekspor" and a chevron.

### 15.2 Text and behaviour

| Item | Text |
|---|---|
| Button | "Ekspor" |
| Menu intro (Katalog and Kelola Barang) | "Unduh semua hasil filter sebagai:" |
| Menu intro (Antrean) | "Unduh semua hasil filter sebagai:" ("Unduh daftar peminjaman yang belum selesai sebagai:" when that option is chosen) |
| Formats | "Excel (.xlsx)", "CSV (.csv)", "PDF (.pdf)" |
| Busy | Spinner and "Menyiapkan file..." (button stays, a second press is ignored) |
| Done | "Unduhan dimulai: {nama file}" (`role=status`). File names: `inventaris-{tanggal}.xlsx` and `peminjaman-{tanggal}.xlsx` (the same for csv and pdf) |
| Errors | The Data Anggota messages: refused ("Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA."), invalid filter ("Ekspor ditolak karena filter tidak cocok. Muat ulang halaman, lalu coba lagi."), unavailable ("Terjadi gangguan. Coba lagi sebentar lagi."), no network ("Tidak bisa terhubung. Periksa internetmu lalu coba lagi.") |

Rules carried over: all rows matching the current filters, in screen order, same columns as the screen; dates in WIB; the header holds the period label and the export date (A-IB12); evidence photos are never exported; the file is only returned after the log row is written, otherwise the unavailable message shows and no file is made (A-IB33). The inventory export includes archived entries only when the Nonaktif filter is on (that filter lives in Kelola Barang).

### 15.3 States, accessibility, touch

- States: closed, open, busy, done, error (as in `member-export.tsx`). No empty state: the button appears only when there are rows (as Data Anggota). No loading skeleton.
- Keyboard: Enter or Space opens the menu; arrow keys are not required, Tab moves through the three formats; Escape closes it and returns focus to the button; a press outside closes it.
- Targets: button 44, menu rows 44.
- Build note: generalise `MemberExport` (endpoint, parameter names, labels) rather than copying it.

---

## 16. Screen 13: Dashboard card "Inventaris Status"

**Goal.** Show the state of the inventory in three counts, with no percentage.

**Who sees it.** Every active member (D01). The optional waiting line needs `borrowing.approve`. The card is designed here; where it sits on the Dashboard is the Dashboard module's decision.

### 16.1 Wireframe (390 px, full-width card)

```
+----------------------------------------------+
|  Inventaris Status                           |  headline-sm
|                                              |
|   42                          3              |  numeric-metric 20/26 bold #2C1E11
|   unit baik                   unit perlu     |  body-sm #7A6652
|   5 di antaranya sedang       servis         |
|   dipinjam                                   |
|                                              |
|  (optional, heads only)                      |
|  3 pengajuan menunggu persetujuan            |  text link to Antrean
|  Lihat katalog                               |  text link, 44 px
+----------------------------------------------+
```

The example string from the spec, "42 unit baik · 5 dipinjam · 3 perlu servis", is the one-line fallback used for the screen-reader label and the export-free plain text. Visually the card uses figures so each count is its own item.

### 16.2 Copy

| Item | Text |
|---|---|
| Title | "Inventaris Status" (Stitch name kept) |
| Figures | "{n} unit baik", sub-line "{k} di antaranya sedang dipinjam"; "{n} unit perlu servis" |
| Screen-reader label | "{n} unit baik, {k} sedang dipinjam, {s} perlu servis" |
| Links | "Lihat katalog" (to Katalog); for approvers "{n} pengajuan menunggu persetujuan" (to Antrean, "Menunggu persetujuan") |
| Empty | "Belum ada barang di inventaris." (no zeros, no percent) |
| Loading | Three flat ivory bars (60 x 24, 90 x 12), caption "Memuat inventaris...", no shimmer |
| Error | In the card only, so the rest of the Dashboard stays: warning text "Data inventaris belum bisa dimuat." and text button "Coba lagi" |
| No active period | Card still shows (baseline right) |

Definitions are spec A-IB32: baik counts units or quantity in Baik including those on loan; dipinjam counts what is out now; perlu servis counts Perlu servis; archived entries and lost units are excluded; Rusak is not shown.

### 16.3 Accessibility and touch

- Figures are text, not images. Contrast: `#2C1E11` on white 15+:1; `#7A6652` on `#FFFFFF` 5.45:1.
- The links are 44 px high text buttons. No colour is used to carry meaning on this card.
- Wider screens: the three figures sit in one row of three cells.

**[PROPOSAL P7] Wording and layout.** The spec example reads like 42 + 5 + 3, but the 5 loaned units are part of the 42. Option (a): the nested wording above (recommended). Option (b): disjoint groups, "37 siap dipakai, 5 dipinjam, 3 perlu servis" (clearer to add up, but changes the spec definition of baik, and moves the 42 figure). Layout: full width gives the three figures room; Stitch's half-width card would force wrapping at 12 px. The Dashboard module decides, but a half-width card needs the figures stacked in three lines.

---

## 17. Screen 14: Status chip set

**Goal.** One chip family for every request status, derived state and condition. The words carry the meaning; colour only repeats it.

**Anatomy (as built for Data Anggota).** Pill, 24 px high, horizontal padding 8 px, 1 px border, text 11 px bold (label-sm), sentence case, `white-space: nowrap`. No dot, no icon, no glow, no animation (the Stitch "pulsing dot" variants are not used). A chip is never the only thing on a row: the row has text next to it.

**Tones (Stitch values only):**

| Tone | Text | Fill | Border | Contrast (text on fill) |
|---|---|---|---|---|
| Success | `#205E3F` | `#EDF7F1` | `#BCDDC8` | 7.01:1 |
| Warning | `#875A00` | `#FEF7DA` | `#E8D58C` | 5.59:1 |
| Destructive | `#932924` | `#FBEBEA` | none (Stitch gives none) | 7.04:1 |
| Ivory (waiting, neutral, archive) | `#62431F` | `#F0E9DC` | `#DECDB5` | 7.43:1 |
| Grey (ended, gone) | `#4A463D` | `#E9E2D5` | `#D3C4B7` | 7.30:1 |

**Request statuses and derived states:**

| Chip text | Tone | Meaning | Where |
|---|---|---|---|
| Diajukan | Ivory | Waiting for a head | Lists, detail, queue |
| Disetujui | Success | Approved, stock held | |
| Ditolak | Destructive | Rejected, note given | |
| Dibatalkan | Grey | Cancelled | |
| Dipinjam | Warning | Items are out (the Stitch "Sedang Dipinjam" tone) | |
| Dikembalikan | Success | All items back | |
| Terlambat {n} hari | Destructive | Dipinjam and the end date passed (derived) | Next to Dipinjam |
| Belum diambil | Warning | Disetujui and the start date passed (derived) | Next to Disetujui |
| Sebagian kembali | Ivory | Some items back, some still out (derived) | Next to Dipinjam |
| Ada masalah | Destructive | Closed with something damaged or lost | Next to Dikembalikan |

On list rows at most two chips show: the status plus the most urgent derived one (Terlambat, then Belum diambil). "Sebagian kembali" is written as a text line with the remaining count in lists ("sisa 1 dari 3") and is a chip only on the detail.

**Conditions and item states:**

| Chip text | Tone | Meaning |
|---|---|---|
| Baik | Success | Lendable |
| Perlu servis | Warning | Not lendable |
| Rusak | Destructive | Not lendable |
| Hilang | Grey | Written off (unit status; never shown to members) |
| Nonaktif | Ivory | Archived item, unit or list entry (as the member-status chip) |
| Aktif | Success | Active list entry |

**Why these choices.**
- Stitch already gives amber to "Sedang Dipinjam", green to "Aktif" and "Selesai", red to "Ditolak", ivory to "Arsip" and grey to "Alumni". Nothing is invented; five tones cover fifteen meanings because the text does the work.
- Disetujui and Dikembalikan are both green. They never sit on one row as the main status, they differ in text, and on the detail the timeline names each step. **[PROPOSAL P9]** If you want them apart, Dikembalikan could be grey; I did not choose that because grey in this set already means "ended without a result" (Dibatalkan).
- "Belum diambil" is amber, not red: it asks the borrower to act, it is not a failure. "Terlambat" is red because stock is blocked past the agreed date.
- Chip text does not rely on tint: remove all colour and "Terlambat 3 hari" still says it. High-contrast and forced-colours modes keep the 1 px border (Destructive has none; its text colour is replaced by the system text colour, and the words still read).
- Pills are used only for these chips and for the filter tags (D-014). The segmented control, the radio cards and the buttons are 8 or 12 px.

**Accessibility.** The chip is plain text in the page flow (no `title` tooltips needed). A screen reader reads "Dipinjam, Terlambat 3 hari". Contrast values in the table were computed with the WCAG formula by hand (see section 18).

---

## 18. Contrast check (computed by hand with the WCAG 2.x formula)

Pairs already computed in `login.md` section 3 are repeated here only where reused. New pairs are marked.

| Pair | Ratio | Result |
|---|---|---|
| White on `#62431F` (button, active segment, bar) | 8.97 | pass |
| `#4F453B` on `#FFFFFF` (body) | 9.35 | pass |
| `#4F453B` on `#F0E9DC` (inactive segment, unit area) **new** | 7.74 | pass |
| `#62431F` on `#F0E9DC` (ivory chip) | 7.43 | pass |
| `#7A6652` on `#FFFFFF` (meta lines, dashboard labels) **new** | 5.45 | pass |
| `#7A6652` on `#FBF8F3` (canvas) | 5.15 | pass |
| `#7A6652` on `#F0E9DC` **new** | 4.52 | passes only just: not used on ivory, use `#4F453B` |
| `#205E3F` on `#EDF7F1` (success chip) **new** | 7.01 | pass |
| `#875A00` on `#FEF7DA` (warning chip) | 5.59 | pass |
| `#932924` on `#FBEBEA` (destructive chip) | 7.04 | pass |
| `#932924` on `#FFFFFF` (field error text) **new** | 8.13 | pass |
| `#4A463D` on `#E9E2D5` (grey chip) **new** | 7.30 | pass |
| `#875A00` on `#FFFFFF` (warning icon) | 6.01 | pass |
| `#81756A` on `#FFFFFF` (field border, unselected radio, timeline dot) | 4.48 | pass (non-text 3:1) |
| Focus line `#62431F` on `#FFFFFF` | 8.97 | pass (non-text 3:1) |
| Not used: `#C59A27` as text | 2.62 on white | fails, so gold never carries text here |

The `contrast-check.py` script could not be run (this agent has no shell). A QA run should repeat the pairs marked "new", and the near-threshold one: `#7A6652` on `#F0E9DC`.

---

## 19. Anti-slop and design self-check

Skills read: `antislop`, `antislop-ui`, `antislop-human`, `antislop-copywriting`, `design-taste-frontend` (app-screen rules), `impeccable` (Operate mode), `stop-slop`. Mode of `antislop` (during or after) is not set (no settings file), so the rules were applied while designing, as in `login.md`.

- **Default dashboard shell:** none. Each screen is built around one decision: find (Katalog), ask (form), decide (head), hand over, take back. No stat row, chart or feed. The only figures are real counts from the spec.
- **Invented content:** none. Item names, categories, locations, references and people appear only as [placeholders]. No testimonials, no activity feed, no percentages. Copy examples avoid inventing PMK facts.
- **Generic tables and menus:** columns are chosen from the decision (Barang and Baik / Total). Row menus are not used; visible text buttons name the action. Every button has a defined result.
- **Decoration:** no gradients, glows, glass, tinted icon squares, decorative dots, left stripes, eyebrow badges or entrance animations. Shadow only on dialogs and menus (elevation 2) and on the single card elevation of Stitch. Radius: 8 controls, 12 cards, pills only for chips and filter tags.
- **Colour:** gold is not used for text. The only accent is walnut on actions. One tone per meaning.
- **Icons:** each tied to a meaning and always with text; none generic. See the icon-set note in section 2.
- **States:** every data screen lists empty, loading, error, forbidden or not applicable, and no-active-period where it matters. Empty states name the cause and the next step ("Kategori dan lokasi masih kosong. Isi daftarnya dulu...").
- **Copy:** no exclamation marks, buzzwords, em dashes or emoji. Buttons name the action ("Setujui pengajuan", "Catat pengembalian"), not "Lanjut". Messages name the actor or the object. "Kamu" throughout. Read aloud, the sentences are short.
- **Human:** keyboard path and focus order per screen; no `outline: none`; messages are text first; steppers and segments have text names; dialogs close with Escape and return focus; zoom to 200% reflows (cards and labels wrap, no fixed text heights); the phone keyboard never covers a focused field (`scroll-mb-24`, sheet height follows the visible area).
- **Resilience:** one conflict message for every "someone else changed it" case. Buttons are never greyed as the way to refuse.
- **Competitor test:** the screens are generic tools by nature, but the Stitch walnut bar, Playfair headings, the "kamu" voice, the Baik / Perlu servis / Rusak vocabulary and the "available counts, never who" rule are particular to PMK NEXUS.
- **Delivery gate for a design document:** nothing was run in a browser (R-35 not applicable), so every control was checked by reading this spec against Stitch tokens and the built components. Em dash search: none in this file. Hard Gate items R-02, R-03, R-17, R-18, R-23, R-24, R-25, R-26, R-27, R-32, R-36, R-37, R-38: pass by inspection (targets listed per screen, no fake numbers or logos, every control has a result, states listed, keyboard listed).

---

## 20. Decisions needed from the owner ([PROPOSAL] summary)

| # | Question | Options | Recommendation |
|---|---|---|---|
| P1 | Navigation inside the module | (a) four segments: Katalog, Peminjaman Saya, Antrean, Kelola Barang (this design); (b) merge Kelola Barang into Katalog; (c) split Antrean into queue and work list | (a) |
| P2 | Date-aware availability filter in the catalog | (a) none, availability by date only on item and form; (b) optional "Tersedia pada tanggal" in the filter card | (b) if the backend can answer for 20 items at once; otherwise (a) |
| P4 | Category and location on the item form | (a) both optional; (b) both required; (c) category optional, location required. Also: a quantity item has one location in the form (the model allows one per stock row) | (a) while the lists are new and empty, then revisit |
| P5 | Can the way of recording an item change? | (a) never after creation; (b) until the first request | (a): converting units to counts changes codes |
| P6 | Stock changes only by dialogs (Tambah jumlah, Ubah kondisi, Keluarkan dari stok) | (a) dialogs; (b) free number fields with a note on save | (a): each change names its reason and history |
| P7 | Dashboard card wording and layout | see section 16 | (a) nested wording, full width |
| P8 | Photo upload timing and the file limit before resizing (15 MB proposed) | (a) upload when picked; (b) upload on save | (a) with the backend treating unattached files as not evidence |
| P9 | Chip colours | Dikembalikan green (like Disetujui) or grey | green |

Small items I will assume unless you object: P3 (filter card folded on phones), P10 (one resulting condition per damaged line in one return), P11 ("Ajukan lagi" button on rejected or cancelled requests, prefilled from the old request), P12 (definition of the count in "Antrean (n)", section 4.4), P14 ("Detail Pengajuan" instead of "Detail Tiket"), P15 (the "Simpan pengembalian?" check), plus the two theme additions X9 and X10.

---

## 21. Spec gaps found

| # | Gap | What I did |
|---|---|---|
| G1 | Spec F2 does not say whether category and location are required, and the data model gives a quantity item a location per stock row. | Proposed optional, one location per quantity item (P4). |
| G2 | There is no "add stock" action in the spec (history kinds are created, edited, condition move, write-off, archived, reactivated), and no way to fix a typo in a count. | Designed "Tambah jumlah" under "edited". A correction by subtraction goes through "Keluarkan dari stok" with a note. Ask the analyst to name both. |
| G3 | The request reference format is undefined (A-IB24). | Wireframes use `[Referensi]`. The detail shows it as the page title. |
| G4 | No maximum text length for description, purpose, note and list names, and no maximum stock number. | Copy uses `{n}` and `{max}`; the backend fixes them. |
| G5 | Photos "never purged" (L5) versus files uploaded and then abandoned. | Upload-on-pick needs a rule for unattached files (P8). |
| G6 | Lists have a "sort order" field but no way to reorder was specified. | Alphabetical, no reorder UI. |
| G7 | A lost unit (Hilang) cannot be restored if it is found again. "Hilang" and "dibuang" are both status Hilang. | No action shown for Hilang units. Ask whether "found again" needs a reasoned restore. |
| G8 | What the requester may see of staff: names of the approver and of the Operations member who recorded a handover or return. L9 lists status, decision note and timeline only. | Names are shown in the timeline (PI-CORE names, no contact data). Confirm. |
| G9 | The list-level availability filter needs a bulk form of the R8 function, which the spec defines per item. | P2. |
| G10 | The meaning of "perlu tindakan" for the Antrean count is not defined. | Defined in 4.4 (P12). |
| G11 | A damaged outcome stores one resulting condition (A-IB30), but a line may have pieces in different conditions. | One condition per damaged group in one return; record a second return for the others (P10). |
| G12 | `login.md` names Material Symbols as the icon set but the app is built with Lucide. | Left as built; icons are named by meaning. |
| G13 | Whether the handover screen should block before the start date is only an assumption (A-IB8). | Designed blocked, with the date in the message. |
| G14 | Overdue day count and "Belum diambil" are derived, but the spec does not say whether BPH sees them. | Shown to everyone who can see the request (they are derived from fields BPH already sees). |

---

## 22. Verification notes

- No design file was run or rendered. Sizes come from the Stitch scale, the Stitch HTML structure (12, 13, 10 for the segmented control, 01 for the timeline), and the built components. Widths such as "about 480 px of controls" are estimates from those sizes.
- Contrast values were computed by hand (section 18). The script could not run; QA should re-run it on the pairs marked "new".
- The skill commands that run scripts (`impeccable context`, taste `draw.mjs`, `inspect.mjs`) could not be run here (no shell). Their written guidance was applied, and Stitch tokens were the visual source.
- Not covered here: the export-log screen (A-MD14), the Dashboard layout around the card, the page that lists the heads' own approvals history, and the "how to start a new period" guide (R12 note).

## 23. Owner decisions on this design (2026-11-07)

Asked and answered by the owner:
- **P6 (a):** stock on existing items changes only through dialogs (Tambah jumlah, Ubah kondisi, Keluarkan dari stok), each with a required reason and a history entry. Also covers fixing a count typo (G2).
- **P7 (a):** Dashboard card: "{n} unit baik, {m} di antaranya sedang dipinjam" and "{k} perlu servis", full width.
- **Request reference (G3):** `PJM-0001`, one sequence, never reused, assigned by the database (same pattern as `INV-0001`).
- **P2 (b):** optional "Tersedia pada tanggal" filter in the catalog filter card; needs a bulk availability function (G9).

Taken as recommended (recorded as assumptions A-IB37..A-IB46 in `docs/OPEN_QUESTIONS.md` section H; the owner can change them):
- P1 (a) four route-based segments; P3 filter card folded on phones; P4 (a) category and location optional; P5 (a) recording mode never changes; P8 (a) evidence photo uploads when picked, files never attached to a saved return are not evidence and may be cleaned up; P9 Dikembalikan chip green; P10 one resulting condition per damaged line; P11 "Ajukan lagi" prefilled; P12 Antrean count as designed; P14 "Detail Pengajuan"; P15 confirm before saving a return.
- G1: one location per item (not per stock row). G4: field length limits set by the database engineer and shown as `{max}`. G6: list order A-Z, no reorder screen. G7: a written-off (Hilang) unit can be restored ("Ditemukan kembali") with a reason by an `inventory.manage` holder, item must be active (amended 2026-11-07 after the DB security review, A-IB45). G8: the requester sees the names of the approver and the Ops members who recorded handover and return in the timeline. G12: icons stay Lucide (as built).
