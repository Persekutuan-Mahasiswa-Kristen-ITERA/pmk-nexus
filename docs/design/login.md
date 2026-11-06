# Login and sign-in states: screen design

> Status: **APPROVED by the owner on 2026-11-06 (D-017)**, including Q1 (a), Q2 (a), Q3 (a) and the new strings in section 2.8. Not built yet.
> Scope: the login screen and the four states around it (no access, password pending, loading after login, generic error).
> Sources: `docs/modules/auth-login.md` (APPROVED; sections 3, 4, 6, 13), `docs/DECISIONS.md` D-014, D-015, D-016, `docs/design/stitch/design-system.md`, `docs/design/stitch/screens.md`, Stitch HTML `08-notulensi-rapat` (app bar and form inputs), `docs/PMK-NEXUS-context.md` section 6, PI-CORE login (`/home/fycode/Documents/pi-core-v2/src/app/login/`, `src/lib/i18n/id.ts`, read only).
> Stitch has no NEXUS login screen. Everything below uses Stitch tokens only. No new hex values and no new fonts.
> Words only: wireframes are ASCII, no code.

**Design Read.** Sign-in form for PMK members (students, on a phone, often between classes or in a meeting), in the Stitch "Executive Heritage Modern" style. Dials: **ENERGY 1 / RHYTHM 1 / MOTION 1**. Reason: a login has one job, and it is the first thing every officer sees after a rotation, so it must be calm and predictable. Identity comes from the flat walnut app bar, the Playfair title, and one gold ring on the crest slot.

---

## 1. Key decisions and why (simple words)

| # | Decision | Why |
|---|---|---|
| K1 | One white card with the form, centred in a single column (max 448 px), on the cream canvas `#FBF8F3`. | Stitch puts every screen in one column. One card means one focal point: the "Masuk" button. |
| K2 | The same 64 px flat walnut app bar as every other NEXUS screen, but with only the crest and "PMK ITERA". No hamburger, no bell. | The bar tells the member "this is the same app" before and after login. The hamburger opens a menu that depends on permissions and the bell has no destination yet, so before login they would be dead controls (rules R-24, R-26). The bar keeps the same height in every state, so nothing jumps when the real shell loads. |
| K3 | Title is "Masuk ke PMK-NEXUS" in Playfair, not just "Masuk". | The app bar says only "PMK ITERA". The title names the product and the action together. The 9 px "PMK-NEXUS" label under the bar title in Stitch is too small to read (size floor is 11 px), so it is not used. |
| K4 | Reuse PI-CORE's structure and wording (fields, order, error meaning, "Lupa kata sandi?" note, footer line). Use the NEXUS Stitch look. | Members must recognise "same account, same words". See C13 in section 8. |
| K5 | Three message tones, always icon plus text, never colour alone: red = you entered something wrong, amber = not your fault, try again, ivory = information. | The member can tell in one glance whether to retype, wait, or just read. |
| K6 | The submit button stays brown while submitting and says "Memeriksa...". It is never greyed out. | A greyed button fails contrast and hides what is happening. Inputs become read-only, not disabled, so their text stays readable. |
| K7 | "Lupa kata sandi?" sits under the password field, not in the label row as in PI-CORE. | In the label row it is an 18 px high target. Under the field it gets a full 44 px target, and it reads in the order the person acts: type, stuck, ask, submit. |
| K8 | Only one accent: the gold ring around the crest slot. Gold is never used for text on cream or white. | Gold `#C59A27` on white is 2.62:1 (fails). On the brown bar a gold ring is 5.26:1 and reads as the brand mark. |
| K9 | No logo is invented. The crest slot is an empty ring until the owner supplies the file (C12). | Rule R-23: never create a logo without instruction. |
| K10 | After login the shell shows a flat skeleton with the text "Memeriksa akunmu...". No module data until the access check ends. | Spec 6.4. The text says what is happening, so it never looks frozen. |

---

## 2. Shared building blocks (used by all five screens)

### 2.1 Colour roles (Stitch hex only)

| Role | Hex | Used for |
|---|---|---|
| Canvas | `#FBF8F3` | Page background (assumption in D-014; Stitch HTML uses `#fff8f5`) |
| Card | `#FFFFFF` | The card, with 1 px border `#EADFCF` and Stitch elevation 1 shadow |
| Walnut | `#62431F` | App bar, primary button, text links, outline button border and text, focus ring |
| Walnut hover | `#513719` | Primary button hover |
| App bar divider | `#4D3418` | 1 px under the app bar |
| Deep brown | `#482D0A` | Page title (Stitch `primary`) |
| Espresso | `#2C1E11` | Text typed in fields |
| Label brown | `#4A3520` | Field labels |
| Body brown | `#4F453B` | Lead text, loading caption, reveal-icon colour (Stitch `on-surface-variant`) |
| Meta brown | `#7A6652` | Placeholder, footer line |
| Outline | `#81756A` | Leading field icons, **proposed** field border (see D1 in section 9) |
| Input fill | `#FCFBF8` | Field background |
| Ivory | `#F0E9DC` | Information tone background, ghost hover, skeleton bars |
| Ivory border | `#DECDB5` | Information tone border |
| Gold (ring) | `#EFC04B` | 1 px ring on the crest slot, on the brown bar only |
| Error | `#932924` on `#FBEBEA` | Wrong-input tone |
| Warning | `#875A00` on `#FEF7DA`, border `#E8D58C` | Try-again tone |

Never used: gold `#C59A27` or `#D6AD36` as text or as a line on cream or white; green (nothing succeeds on these screens, the screen just changes).

### 2.2 Type roles (Playfair Display + Plus Jakarta Sans only)

| Where | Token | Size / line | Weight | Colour |
|---|---|---|---|---|
| App bar "PMK ITERA" | headline-lg (Playfair) | 22 / 28 | 600 | white |
| Screen title | display-sm (Playfair) | 24 / 32 | 600 | `#482D0A` |
| Lead, alert text, note text | body-md | 14 / 20 | 400 | see tone |
| Field label | label-lg | 13 / 18 | 600 | `#4A3520` |
| Field text | 16 / 24, Plus Jakarta Sans 400 (see D1: not a Stitch token) | 16 / 24 | 400 | `#2C1E11` |
| Button label | headline-sm | 16 / 24 | 600 | white or `#62431F` |
| Link-button ("Lupa kata sandi?", "Keluar" as text) | label-lg | 13 / 18 | 600, underlined | `#62431F` |
| Footer line | body-sm | 12 / 18 | 400 | `#7A6652` |

Nothing below 12 px. No uppercase labels, no wide tracking.

### 2.3 Space, radius, elevation

- Spacing scale from Stitch: 4 / 8 / 16 / 20 / 28; gutter 12; page margin 16 (24 and 32 allowed on wide screens). The 6 px label-to-field gap is Stitch's own value in its forms.
- Radius: card 12, field 8, button 8, alert 8. No pills anywhere on these screens (pills are for status chips only).
- Elevation: the card uses Stitch level 1 (white, 1 px `#EADFCF`, soft shadow). Nothing else has a shadow. Reason: one raised surface marks the one thing to act on.

### 2.4 App bar, login variant

- 64 px high, full width, flat bottom edge, `#62431F`, 1 px bottom divider `#4D3418`. Not fixed on these screens (it scrolls away when the keyboard needs the space).
- Content centred as one group: crest slot, 8 px gap, "PMK ITERA".
- No hamburger, no bell, no subtitle.

### 2.5 Logo slot (placeholder, open question C12)

- A circle of **28 x 28 px** (Stitch size), 1 px ring `#EFC04B`, fill `#EADFCF`, empty inside (no icon, no letter). It is decorative (`aria-hidden`) because "PMK ITERA" sits next to it.
- File needed from the owner: square, round or transparent background, SVG preferred, or PNG at least 192 x 192 px (shown at 28 CSS px, about 84 device pixels on an Android Large screen at 3x).
- Note for the owner: PI-CORE already has a round seal at `pi-core-v2/public/brand/pmk-logo-192.png`. I did not copy it. Fine detail (the text on the seal) will not be readable at 28 px, so check it once placed.

### 2.5a Field and alert components

- **Text field:** label above (13 px, 6 px gap), box 48 px high, full width, radius 8, fill `#FCFBF8`, 1 px border (see D1), leading icon 20 px in `#81756A` 12 px from the left edge, text starts at 40 px. Hover: border `#62431F`. Focus: border becomes 2 px `#62431F` (the 1 px border plus a 1 px inner line, so the box does not change size) with Stitch's soft halo `#62431F1F`. Error: border `#932924`. Read-only (while submitting): same look.
- **Password reveal:** a 44 x 44 px button inside the right end of the field, icon `visibility` / `visibility_off` (Material Symbols Outlined, matching Stitch), colour `#4F453B`, `aria-pressed`, accessible name "Tampilkan kata sandi" / "Sembunyikan kata sandi".
- **Alert (inline message):** radius 8, padding 12, icon 20 px at the left (Material Symbols), text body-md, gap 8. No border on the error tone (Stitch gives none); the warning and information tones use the border hexes in 2.1. One alert at a time.

| Tone | Used for | Fill / text / icon | Icon |
|---|---|---|---|
| Error | Wrong credentials, empty fields | `#FBEBEA` / `#932924` | `error` |
| Warning | 429, no network, server problem, still pending | `#FEF7DA` / `#875A00` | `schedule` (429), `wifi_off` (network), `warning` (server) |
| Information | Session ended, forgot-password note | `#F0E9DC` / `#62431F` | `info` |

Icon relevance (rule R-04): each icon states the situation in the same words as the text beside it. They are Material Symbols because the Stitch screens already use that set. Icons are never put in a coloured circle or tile.

### 2.6 Buttons

- **Primary:** full width in the card, 48 px, `#62431F`, white label, radius 8. Hover `#513719`. Press: scale 0.98 for 100 ms. Busy: spinner `progress_activity` 18 px left of the label, label changes, `aria-busy`, further presses ignored.
- **Secondary (outline):** 48 px, 1.5 px `#62431F` border, `#62431F` label, white fill. Hover fill `#F0E9DC`.
- **Text button:** minimum 44 x 44 px tap area, label-lg underlined `#62431F`.
- Focus on every button and link: 2 px outline `#62431F`, 2 px offset (8.97:1 on white, 8.46:1 on the canvas). Never removed.

### 2.7 Motion (MOTION 1)

- Allowed: hover, press, focus, and the spinner while a request runs (it shows work in progress).
- Not allowed: entrance animations, shake on error, pulsing dots, shimmer on skeletons, glow.
- `prefers-reduced-motion`: no press scale, the spinner icon stays static, content and text are unchanged.

### 2.8 Final copy (Indonesian only, D-016 E5)

Strings from spec 6.4a are kept. Changes and additions are marked. No exclamation marks, no emoji.

| Key | Text | Note |
|---|---|---|
| Tab title | "Masuk | PMK-NEXUS" | new |
| Login title | "Masuk ke PMK-NEXUS" | spec says "Masuk"; reason K3 |
| Lead | "Pakai email dan kata sandi akun PI-CORE kamu." | spec: lead naming PI-CORE (EC17); wording adjusted to PI-CORE's "kamu" tone |
| Labels | "Email", "Kata sandi" | same as PI-CORE |
| Email placeholder | "nama@student.itera.ac.id" | same as PI-CORE; password field has no placeholder (the label is enough) |
| Forgot link | "Lupa kata sandi?" | spec |
| Forgot note | "Kata sandi direset oleh admin PMK ITERA. Minta kata sandi sementara kepada mereka, lalu ganti di PI-CORE." | spec |
| Submit / busy | "Masuk" / "Memeriksa..." | spec |
| Wrong credentials | "Email atau kata sandi salah." | spec |
| Empty fields | "Isi email dan kata sandi kamu." | spec |
| Too many attempts | "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi." | spec |
| No network | "Tidak bisa terhubung. Periksa internetmu lalu coba lagi." | spec |
| Server problem (form) | "Terjadi gangguan. Coba lagi sebentar lagi." | spec |
| Session ended | "Sesi kamu berakhir. Masuk lagi." | spec |
| Footer | "Akun dibuat oleh admin PMK ITERA." | spec |
| No access | "Belum ada akses" / "Akunmu belum bisa dipakai di NEXUS. Hubungi admin PMK ITERA." / "Keluar" | spec, D-016 |
| Pending | "Ganti kata sandi dulu" / "Kamu masih memakai kata sandi sementara. Ganti kata sandi di PI-CORE, lalu kembali ke sini." / "Buka PI-CORE", "Sudah ganti? Muat ulang", "Keluar" | spec, D-015 |
| Still pending after reload | "Kata sandimu belum berubah. Ganti di PI-CORE dulu, lalu coba lagi." | **new**, needs owner review; without it "Sudah ganti? Muat ulang" would do nothing visible |
| Loading caption | "Memeriksa akunmu..." | **new** |
| Error screen | Title "Terjadi gangguan", body "Coba lagi sebentar lagi. Kalau masih gagal, hubungi admin PMK ITERA.", button "Coba lagi" | spec sentence split so the title and body do not repeat each other; second sentence **new** (an error should name the next step) |
| Error retry failed (screen reader only) | "Masih terjadi gangguan." | **new** |

---

## 3. Contrast check

Method: WCAG 2.x formula from the `antislop-human` skill, computed by hand (no shell was available to run `contrast-check.py`; see section 10). Normal text needs 4.5:1, large text and non-text parts need 3:1.

| Pair (foreground on background) | Ratio | Result |
|---|---|---|
| `#482D0A` title on `#FFFFFF` | 12.69 | pass |
| `#482D0A` on canvas `#FBF8F3` | 11.98 | pass |
| `#4F453B` lead on `#FFFFFF` | 9.35 | pass |
| `#4F453B` loading caption on canvas | 8.82 | pass |
| `#4A3520` label on `#FFFFFF` | 11.53 | pass |
| `#2C1E11` typed text on `#FCFBF8` | 15.60 | pass |
| `#7A6652` placeholder on `#FCFBF8` | 5.27 | pass |
| `#7A6652` footer on canvas | 5.15 | pass |
| `#62431F` link/outline text on `#FFFFFF` | 8.97 | pass |
| `#62431F` on canvas | 8.46 | pass |
| White on `#62431F` (button, app bar) | 8.97 | pass |
| White on `#513719` (button hover) | 10.99 | pass |
| `#62431F` on `#F0E9DC` (information tone, ghost hover) | 7.43 | pass |
| `#932924` on `#FBEBEA` (error tone) | 7.04 | pass |
| `#875A00` on `#FEF7DA` (warning tone) | 5.59 | pass |
| `#875A00` icon on `#FFFFFF` (error screen) | 6.01 | pass |
| Reveal icon `#4F453B` on `#FCFBF8` | 9.03 | pass (non-text 3:1) |
| Gold ring `#EFC04B` on `#62431F` | 5.26 | pass (non-text 3:1) |
| Focus line `#62431F` on `#FFFFFF` | 8.97 | pass (non-text 3:1) |
| Error field border `#932924` on `#FCFBF8` | 7.86 | pass (non-text 3:1) |
| **Field border, Stitch `#D8CCBA` on `#FCFBF8`** | **1.53** | **FAIL non-text 3:1** (and 1.58 on the white card) |
| **Field border, proposed `#81756A` on `#FCFBF8`** | **4.33** | pass (4.48 on the white card) |
| Not used: `#C59A27` on `#FFFFFF` | 2.62 | fails, so gold is never text |
| Not used: `#dcb184` (Stitch app bar subtitle) on `#62431F` | 4.55 | passes but only as the 9 px label, which is too small |

No body-text pair is below 4.5:1. The only failure is Stitch's own field border (section 9, D1). Skeleton bars and the card border `#EADFCF` are decoration, not information, so they are not held to 3:1.

---

## 4. Screen 1: Login (`/login`)

**Goal.** Let a member sign in with the PI-CORE email and password, and tell them clearly what to do when it fails.

**User's path.** Opens the NEXUS link (or is redirected here from a protected page, or after a session ended) -> types email and password (or a password manager fills them) -> presses "Masuk" -> sees the loading shell, then the Dashboard. Side paths: stuck on the password -> "Lupa kata sandi?" -> reads the note -> asks the admin offline. Wrong input -> reads the red message -> retypes the password.

### 4.1 Wireframe, idle (390 px wide, canvas `#FBF8F3`)

```
+----------------------------------------------+
| ############ app bar 64 px #62431F ########## |
| ############   (o)  PMK ITERA   ############# |   crest 28 px, gold ring
|----------------------------------------------|
|                                              |  28 px
|  +----------------------------------------+  |  card: white, r12,
|  |  Masuk ke PMK-NEXUS                    |  |  1px #EADFCF, padding 20
|  |  Pakai email dan kata sandi akun       |  |
|  |  PI-CORE kamu.                         |  |
|  |                                        |  |  20 px
|  |  Email                                 |  |
|  |  +----------------------------------+  |  |
|  |  | [mail]  nama@student.itera.ac.id |  |  |  48 px
|  |  +----------------------------------+  |  |
|  |                                        |  |  16 px
|  |  Kata sandi                            |  |
|  |  +----------------------------------+  |  |
|  |  | [lock]  ..........        [eye]  |  |  |  48 px, eye = 44x44
|  |  +----------------------------------+  |  |
|  |  Lupa kata sandi?                      |  |  44 px tap area
|  |                                        |  |  8 px
|  |  +----------------------------------+  |  |
|  |  |              Masuk               |  |  |  48 px, #62431F
|  |  +----------------------------------+  |  |
|  +----------------------------------------+  |
|                                              |
|                                              |  free space
|        Akun dibuat oleh admin PMK ITERA.     |  12 px, #7A6652
|                                              |  24 px + safe area
+----------------------------------------------+
```

Height at 390 x 844: bar 64 + gap 28 + card about 380 = 472. The rest is whitespace on purpose. The footer line is pinned to the bottom of the viewport (it floats up when the keyboard is open, it never overlaps the form).

### 4.2 Elements, top to bottom

1. **App bar** (2.4). Not interactive.
2. **Card** `#FFFFFF`, 1 px `#EADFCF`, radius 12, padding 20, margin 16 each side, 28 px below the bar.
3. **Title** (h1) "Masuk ke PMK-NEXUS", display-sm, `#482D0A`. One line at 390 px (about 225 px wide in a 318 px card).
4. **Lead** body-md `#4F453B`, 4 px below the title. May wrap to two lines.
5. **Alert slot**, 20 px below the lead. Empty in the idle state, takes no space.
6. **Email field**, 20 px below the lead (or the alert). Label "Email", `type=email`, mobile email keyboard, no auto-capitalise, no spell check, `autocomplete=username`, keyboard action key "Berikutnya".
7. **Password field**, 16 px below. Label "Kata sandi", `autocomplete=current-password`, reveal button, keyboard action key "Masuk".
8. **"Lupa kata sandi?"** text button, 4 px below the password field, left aligned, with a small `expand_more` / `expand_less` icon (18 px) after the text to show it opens. `aria-expanded`, `aria-controls` the note.
9. **Forgot note** (only when open): information alert, 8 px above the button.
10. **"Masuk"** primary button, 8 px below the link (or the note).
11. **Footer line**, centred, 12 px, `#7A6652`, pinned to the bottom with 24 px bottom padding plus the device safe area.

Not on this screen: sign-up, "create account", social login, language switch, "remember me", version text.

### 4.3 States

| State | What the screen shows | Behaviour |
|---|---|---|
| **Idle** | As in 4.1. No autofocus (the keyboard would cover the title on a phone). | Pressing Enter in either field submits. |
| **Empty fields** | Error alert "Isi email dan kata sandi kamu." Only the empty field(s) get the red border and `aria-invalid`. | Checked in the browser, no request sent. Focus moves to the first empty field. |
| **Submitting** | Button: spinner plus "Memeriksa...", still brown, press ignored. Both fields read-only, same look. Any old alert is removed. | Stays in this state until the page changes. On success the button does NOT go back to "Masuk", to avoid a flash before the redirect. If sign-in takes longer than about 15 seconds the engineer ends it as "no network" [ASSUMPTION, needs engineering check]. |
| **Wrong credentials** | Error alert "Email atau kata sandi salah." Both fields red border and `aria-invalid`. Email stays filled, password is cleared. | One message for unknown email, wrong password and a deactivated account (AUTH-07, AUTH-08). No counter of attempts. Focus moves to the password field. The alert is `role=alert` so it is read aloud. |
| **Rate limited (429)** | Warning alert, `schedule` icon, "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi." Fields are not marked red (the input is not the problem) and stay filled, password included. | Button is usable straight away (no countdown: the real wait time is unknown). Focus stays on the button. |
| **No network** | Warning alert, `wifi_off` icon, "Tidak bisa terhubung. Periksa internetmu lalu coba lagi." Fields stay filled. | Never shows the wrong-credentials text (AUTH-11). |
| **Server problem** (Auth 5xx, project paused) | Warning alert, `warning` icon, "Terjadi gangguan. Coba lagi sebentar lagi." Fields stay filled. | Same rule as no network. |
| **Session ended** | Information alert, `info` icon, "Sesi kamu berakhir. Masuk lagi." shown on page load, `role=status`. Fields empty. | Removed when the person submits. The return address stays in the URL, never the email (AR12). Focus is not moved. |
| **Forgot note open** | Information alert under the link with the spec text. | No field, no request (AUTH-26). Pressing the link again closes it. The page does not scroll by itself. |
| **Already signed in** | No UI. The server redirects to the return address or the Dashboard before anything is drawn (AUTH-05). | People in the No-access or password-pending state still see the form here, so they can sign in as someone else. |
| **Success** | No separate screen. The page becomes Screen 4 (loading), then the Dashboard. | |

Only one alert shows at a time. Error text never holds raw Supabase wording, a user id, or the word "banned" (AUTH-43). The password never appears in a URL or a message (AUTH-44).

Wireframe of the alert slot variants (the rest of the card is unchanged):

```
 Error (red tone)            Warning (amber tone)        Information (ivory)
 +----------------------+    +----------------------+    +----------------------+
 | (!) Email atau kata  |    | (clock) Terlalu      |    | (i) Sesi kamu        |
 |  sandi salah.        |    |  banyak percobaan... |    |  berakhir. Masuk     |
 +----------------------+    +----------------------+    |  lagi.               |
  fill #FBEBEA text #932924   #FEF7DA  #875A00           +----------------------+
                                                          #F0E9DC  #62431F
```

Forgot note open (bottom part of the card):

```
  |  Kata sandi                            |
  |  [lock]  ..........              [eye]|
  |  Lupa kata sandi? (^)                  |
  |  +----------------------------------+  |
  |  | (i) Kata sandi direset oleh      |  |
  |  |  admin PMK ITERA. Minta kata     |  |
  |  |  sandi sementara kepada mereka,  |  |
  |  |  lalu ganti di PI-CORE.          |  |
  |  +----------------------------------+  |
  |  [            Masuk                ]   |
```

### 4.4 Focus order, keyboard, screen reader

- Tab order follows the visual order: Email -> Kata sandi -> Tampilkan kata sandi (eye) -> Lupa kata sandi? -> Masuk. Four stops plus the two fields; no skip link needed on a page this short.
- Enter in a field submits. Space or Enter on the eye and the link toggles them. No dialogs, so no Escape handling is needed.
- Visible focus on every control (2.6 and 2.5a). The field focus is a 2 px brown border, not just a colour tint.
- Page structure: `lang=id`, one `h1`, form inside `main`. The h1 is the first thing a screen reader reaches.
- Each field has a real `label`. The alert is linked to both fields with `aria-describedby` when they are invalid. The eye button announces its state ("Tampilkan kata sandi" / "Sembunyikan kata sandi" with pressed state).
- Messages are announced: errors with `role=alert`, the session notice with `role=status`.
- Not colour-only: every red or amber message has an icon and its own sentence; invalid fields also carry the message text.
- Zoom: layout reflows at 200% text size (no fixed heights on text, card grows, footer flows after the card).
- Mobile keyboard: a focused field scrolls into view above the keyboard (reserve about 96 px of bottom scroll padding so the field is never covered).

### 4.5 Touch targets

| Control | Size |
|---|---|
| Email and password fields | full width x 48 px |
| Reveal (eye) button | 44 x 44 px, inside the field, 2 px from its edges |
| "Lupa kata sandi?" | at least 44 px high, at least 44 px wide, full text width plus 8 px each side |
| "Masuk" | full width x 48 px |
| Gap between targets | at least 8 px |

### 4.6 Wider screens

Stitch has only a 390 px design and puts every screen in a centred column (max 448 px), so login does the same. At 768 px and above: the app bar spans the full width, the card stays 448 px wide and is centred, with 64 px between the bar and the card. Type sizes do not grow. The footer stays at the bottom. No split-screen brand panel (see C13).

---

## 5. Screen 2: No access

**Goal.** Tell a signed-in person, once, that their account cannot use NEXUS, without revealing why (deactivated and not linked look identical, D-016).

**User's path.** Signs in with correct credentials -> check returns zero rows -> sees this card -> presses "Keluar" -> back to `/login`. Reloading also returns to `/login` because the local session is dropped on the first render.

### 5.1 Wireframe

```
+----------------------------------------------+
| ############   (o)  PMK ITERA   ############# |   same bar, no controls
|----------------------------------------------|
|                                              |  28 px
|  +----------------------------------------+  |
|  |  Belum ada akses                       |  |  Playfair 24, #482D0A
|  |  Akunmu belum bisa dipakai di NEXUS.   |  |  body-md #4F453B
|  |  Hubungi admin PMK ITERA.              |  |
|  |                                        |  |  20 px
|  |  +----------------------------------+  |  |
|  |  |             Keluar               |  |  |  outline, 48 px
|  |  +----------------------------------+  |  |
|  +----------------------------------------+  |
+----------------------------------------------+
```

### 5.2 Elements and choices

1. App bar (login variant).
2. Card (same as Screen 1).
3. Title "Belum ada akses" (h1), body text, one outline button "Keluar".

Choices and reasons:
- "Keluar" is outline, not filled. It is a safe exit, not an invitation; nothing here should look like "continue".
- No illustration and no lock icon. The title and sentence say it. An icon would repeat them.
- No menu, no links, no data (spec 6.2). No "Coba lagi": the answer will not change by retrying.
- The sentence has no contact detail because none is defined yet. Do not invent a phone number or email.

### 5.3 States

| State | Behaviour |
|---|---|
| Default | As above. |
| Pressing "Keluar" | Spinner plus "Keluar", `aria-busy`. Ends the local session and goes to `/login` with no notice. |
| Error on sign-out | Warning alert above the button: "Terjadi gangguan. Coba lagi sebentar lagi." The button returns to normal. |
| Loading | Not applicable; the page is only reached after the check finished. |
| Empty | Not applicable. |
| Direct visit by a normal member | Redirect to the Dashboard (EC14); not designed. |

Optional addition (needs owner approval, not in the spec): a small line under the sentence, "Masuk sebagai nama@student.itera.ac.id" read from the session (not from PI-CORE tables). It would help the most common case, signing in with the wrong account. It adds one more string and shows the email on screen, so it is left out of the base design.

### 5.4 Focus, screen reader, targets, contrast

- Focus lands on the h1 area on load (so a screen reader reads the message first), then Tab reaches "Keluar".
- The message is in the page, not an alert, because the person caused no error.
- "Keluar" 48 px high, full width. Contrast: title 12.69, body 9.35, button 8.97 (section 3).

---

## 6. Screen 3: Password pending ("Ganti kata sandi dulu")

**Goal.** Stop a member who still has a temporary password, send them to PI-CORE to change it, and let them come back without logging in again (D-015, F6).

**User's path.** Signs in -> sees this card -> presses "Buka PI-CORE" -> PI-CORE asks for the same temporary password and then for a new one -> returns to NEXUS -> presses "Sudah ganti? Muat ulang" -> enters the Dashboard without a new login.

### 6.1 Wireframe

```
+----------------------------------------------+
| ############   (o)  PMK ITERA   ############# |
|----------------------------------------------|
|                                              |  28 px
|  +----------------------------------------+  |
|  |  Ganti kata sandi dulu                 |  |
|  |  Kamu masih memakai kata sandi         |  |
|  |  sementara. Ganti kata sandi di        |  |
|  |  PI-CORE, lalu kembali ke sini.        |  |
|  |                                        |  |  20 px
|  |  +----------------------------------+  |  |
|  |  |          Buka PI-CORE            |  |  |  primary, 48 px
|  |  +----------------------------------+  |  |
|  |  +----------------------------------+  |  |  8 px gap
|  |  |     Sudah ganti? Muat ulang      |  |  |  outline, 48 px
|  |  +----------------------------------+  |  |
|  |            Keluar                      |  |  text button, 44 px
|  +----------------------------------------+  |
+----------------------------------------------+
```

### 6.2 Elements and choices

1. App bar (login variant), card, h1, body text.
2. "Buka PI-CORE": primary, a real link (not a script button) to the PI-CORE change-password address from one configuration value (A-AUTH-2). Opens in a NEW tab (owner decision Q3 (a), D-017; `target="_blank" rel="noopener noreferrer"`). No arrow icon: the label names the destination.
3. "Sudah ganti? Muat ulang": outline, re-checks the account.
4. "Keluar": text button, centred under the two buttons.

Order of the three buttons follows the person's journey: go, come back, leave. Only one is filled.

### 6.3 States

| State | Behaviour |
|---|---|
| Default | As above. |
| "Muat ulang" running | Spinner plus "Memeriksa...", `aria-busy`. Other buttons stay usable. |
| Password changed | Page becomes the Dashboard. No message needed. |
| Still pending | Warning alert above the buttons, `warning` icon: "Kata sandimu belum berubah. Ganti di PI-CORE dulu, lalu coba lagi." (new string, section 2.8). Announced with `role=alert`. Without it the button would look broken. |
| Check failed | Warning alert: "Terjadi gangguan. Coba lagi sebentar lagi." The person stays on this screen (not signed out, AR10). |
| "Keluar" | Same as Screen 2. |

### 6.4 Focus, screen reader, targets, contrast

- Focus order: h1 (on load), Buka PI-CORE, Sudah ganti? Muat ulang, Keluar.
- "Buka PI-CORE" has an accessible name that includes the destination ("Buka PI-CORE"); it is a link, announced as a link.
- Targets: 48, 48, 44 px high, 8 px between them.
- Contrast: all pairs in section 3 (white on `#62431F` 8.97, `#62431F` on white 8.97, warning 5.59).

---

## 7. Screen 4: Loading after login

**Goal.** Fill the wait while the access check runs, show nothing from any module, and say what is happening.

**User's path.** Presses "Masuk" -> this screen appears -> the real shell replaces it (or Screen 2, 3 or 5).

### 7.1 Wireframe

```
+----------------------------------------------+
| ############   (o)  PMK ITERA   ############# |   real bar height, no controls yet
|----------------------------------------------|
|                                              |
|  Memeriksa akunmu...                         |  13 px, #4F453B, role=status
|  [==== 180 x 32 ====]                        |  title bar, flat #F0E9DC
|  [========== 260 x 14 ==========]            |  subtitle bar
|                                              |
|  +--------------------+ +------------------+ |
|  | [== 90 x 12 ==]    | | [== 90 x 12 ==]  | |  two metric cards
|  | [== 60 x 24 ==]    | | [== 60 x 24 ==]  | |  height 96
|  +--------------------+ +------------------+ |
|  +----------------------------------------+  |
|  | [== 140 x 14 ==]                       |  |  full card, height 160
|  | [==== 100% x 12 ====]                  |  |
|  | [==== 100% x 12 ====]                  |  |
|  +----------------------------------------+  |
+----------------------------------------------+
```

### 7.2 Choices

- The bar is the same bar. The hamburger and bell are absent until the check ends, because the menu content depends on permissions that are not known yet (nothing may suggest a module exists).
- Skeleton blocks are flat `#F0E9DC` bars inside white cards (card style as in 2.1). No shimmer and no pulse (MOTION 1). Reason: a moving gradient is decoration, and the caption already says the page is working.
- The skeleton is generic on purpose. The real Dashboard shows only the cards a member may open, so the skeleton cannot know the final shape. It holds the page margins, the title row and card radii so the layout shifts as little as possible.
- No numbers, no names, no module words in the skeleton. Never module data before the check ends (spec 6.4).

### 7.3 States

| State | Behaviour |
|---|---|
| Loading | As above. |
| Ends OK | Real shell (Dashboard). |
| Ends with zero rows | Screen 2. |
| Ends pending | Screen 3. |
| Ends with an error | Screen 5. |
| Slow (over about 10 s) | Stays the same. Proposal for engineering: after about 10 s switch the caption to "Masih memeriksa..." [ASSUMPTION, new string, optional]. |

### 7.4 Accessibility

- The caption is a `role=status` region; the skeleton bars are `aria-hidden`.
- Nothing is focusable on this screen. Contrast: caption `#4F453B` on canvas 8.82.

---

## 8. Screen 5: Generic error ("Terjadi gangguan")

**Goal.** Say that something broke on our side or in the connection, keep the person signed in, and give one action.

**User's path.** Signed in, but the access check could not finish (network, database, paused project) -> sees this card -> presses "Coba lagi".

### 8.1 Wireframe

```
+----------------------------------------------+
| ############   (o)  PMK ITERA   ############# |
|----------------------------------------------|
|                                              |  28 px
|  +----------------------------------------+  |
|  |  (!)  Terjadi gangguan                 |  |  warning icon #875A00 24 px,
|  |  Coba lagi sebentar lagi. Kalau masih  |  |  title Playfair 24
|  |  gagal, hubungi admin PMK ITERA.       |  |
|  |                                        |  |  20 px
|  |  +----------------------------------+  |  |
|  |  |            Coba lagi             |  |  |  primary, 48 px
|  |  +----------------------------------+  |  |
|  +----------------------------------------+  |
+----------------------------------------------+
```

### 8.2 Choices and states

- The error sits in the content area under the normal bar, not as a full-screen takeover. The shell stays recognisable.
- Amber, not red: the person did nothing wrong. Only the small icon carries the colour.
- No technical text, no error code (AR7, AUTH-43). The person is not signed out and this is never shown as "no access" (AUTH-18).

| State | Behaviour |
|---|---|
| Default | As above. |
| Retrying | Button shows spinner plus "Memeriksa...", `aria-busy`. |
| Retry works | Goes to the page the person wanted. |
| Retry fails | Back to the same screen. A hidden live region says "Masih terjadi gangguan." so a screen reader user knows the retry ran. |
| No network at all | Same screen (the browser cannot tell the cause apart reliably). |

- Focus: title area on load, then "Coba lagi". Target 48 px.
- Contrast: icon `#875A00` on white 6.01, body 9.35, button 8.97.

---

## 9. Conflicts and proposed design changes (reason first)

Nothing below is applied silently. D1 to D3 need the owner's decision before the UI is built; until then the build follows Stitch exactly and the login field border fails a contrast rule.

| # | Where | Conflict | My proposal and reason |
|---|---|---|---|
| D1 | Stitch inputs vs `antislop-human` non-text contrast (R-25 family) | Stitch field border `#D8CCBA` is 1.53:1 against the field. A person with low vision cannot find the box edge, and the fill `#FCFBF8` is almost the same colour as the card. | Use Stitch's own outline colour `#81756A` (4.33:1) for the 1 px field border on the login form. Also set field text to 16 px (Stitch token is 14 px): iOS Safari zooms the page when an input is under 16 px, and NEXUS is meant to be installed as a PWA on iPhones too (A-AUTH-3). Both changes would apply to every NEXUS form later. |
| D2 | Stitch app bar vs a login screen | Stitch bar has a hamburger and a bell. | Login variant has neither (no destinations before the access check; rules R-24, R-26). Also: not fixed, no 9 px subtitle. |
| D3 | Stitch required-field marker | Stitch marks required fields with a red `*` (`#ba1a1a`). | Omitted on login: both fields are required and nothing is optional, so the star adds noise. |
| S1 | Spec 6.1 heading "Masuk" | Spec says heading "Masuk". | "Masuk ke PMK-NEXUS" (reason K3). |
| S2 | Spec F6: "Buka PI-CORE" opens in the same tab | After changing the password PI-CORE shows its own page. The person has to navigate back to NEXUS themselves, and the NEXUS page with "Sudah ganti? Muat ulang" is gone. | Resolved: new tab (Q3 (a), D-017). Spec F6 updated. |
| S3 | Spec 6.4 loading, no Stitch skeleton | Stitch has no loading, empty or error states. | Designed from Stitch tokens in section 7. |
| S4 | New strings not in spec 6.4a | "Memeriksa akunmu...", "Kata sandimu belum berubah...", second sentence of the error body, "Masih terjadi gangguan." (screen reader only). | Marked "new" in 2.8, need owner review. |
| T1 | `design-taste-frontend` app-screen rules vs Stitch | The skill discourages a saturated brand-coloured bar and brand-filled buttons on light app screens, and a serif display face for titles. | Stitch wins (skills never override the design). Kept: walnut bar, walnut primary button, Playfair title. Applied from the skill: one raised surface, no gradients or glows, skeleton as flat bars at real size, errors inside the content with a retry action, placeholders at 4.5:1 or better. |
| P1 | PI-CORE login vs Stitch | PI-CORE uses a curved brand panel, drifting gold glow, a breathing logo, a shimmer on the button, a disabled Google row and an English/Indonesian switch. | None of these are copied (flat bar, no gradient, no loops, no dead control, Indonesian only). See C13. |
| L1 | Logo | Real file is not delivered (C12). PI-CORE has one in its repo. | Empty ring placeholder (2.5). Owner decides whether to reuse the PI-CORE seal. |

---

## 10. Anti-slop self-check

Skills applied: `antislop` (core), `antislop-ui`, `antislop-human`, `antislop-copywriting`, `design-taste-frontend` (app-screen rules only), `impeccable` (Operate mode: the tool disappears into the task), `stop-slop`.

**What I checked and what I changed**

- Stat cards, fake numbers, activity feeds, charts: none on these screens. The loading skeleton holds no numbers or names (R-17, R-38).
- Fake logo: removed. The crest slot is an empty ring with a size and a file spec (R-23).
- Dead controls: removed the hamburger and bell from the login bar, and PI-CORE's disabled Google row (R-24, R-26).
- Copy: removed the exclamation marks and filler; no em dashes; no "Selamat datang", no buzzwords; buttons name the action ("Masuk", "Buka PI-CORE", "Coba lagi"), not "Lanjut" or "Submit". The error screen first repeated "Terjadi gangguan" in title and body, so the sentence was split.
- Decoration: no gradient, glow, glass, pills, tinted icon circles, left stripes, eyebrow badge, decorative dots, or entrance animation. Shadow only on the single card. Radius: 12 card, 8 controls, one rule.
- Colour: gold is used once (crest ring). Brown is the action colour. Three message tones, each with icon and text.
- Icons: Material Symbols Outlined (the Stitch set), each tied to a meaning (mail, lock, eye, info, clock, wifi off, warning), none generic (no sparkle, no shield).
- Hierarchy: one focal point per screen (the "Masuk" button or the message), whitespace is structural (the empty lower half of the login is the quiet, the footer sits at the foot).
- Contrast: every text pair at 4.5:1 or more, every non-text part at 3:1 or more except Stitch's field border, which is reported as D1.
- Human: full keyboard path, visible focus on every control, no `outline: none`, messages announced, no colour-only signal, 44 px minimum targets (the link gets a 44 px area), text zooms to 200%, keyboard does not cover fields.
- Resilience: every screen has idle, loading or busy, error, and success or next-step behaviour (empty is not applicable to a form).
- Palette and fonts: only Stitch hex values and the two Stitch fonts. One deviation is proposed (D1: 16 px field text, a size not a font).

**Delivery Gate (design document, nothing was run)**

- Hard Gate (R-02, R-03, R-17, R-18, R-23, R-24, R-25, R-26, R-27, R-32, R-36, R-37, R-38): PASS by inspection. Evidence: no em dash in this file, targets listed in 4.5, no invented numbers or logo, every control has a destination or action, states listed per screen, focus and keyboard listed in 4.4. R-25: one non-text failure carried over from Stitch and reported (D1).
- R-35 (run it before delivering): NOT APPLICABLE, this is a text design, so each element was checked by reading the spec and Stitch tokens, not by clicking.
- Purpose-Gate: PASS. One reason per decision is in section 1 and section 2. Glass, glow, gradient and arrows: not used.
- Liveliness: ENERGY 1, RHYTHM 1, MOTION 1 declared and held. One focal point per screen. One accent (gold ring). Identity motif: Playfair title on flat walnut.
- Competitor test (swap the logo and name): the walnut bar, Playfair serif title and cream canvas are the Stitch identity, but the screen itself is mostly a standard form, as it should be on an Operate screen.

---

## 11. Open questions for the owner (max 3)

**Q1 (C13). Should NEXUS reuse PI-CORE's login design?**
- (a) Reuse structure and wording, NEXUS Stitch look. **Recommended.**
- (b) Copy PI-CORE's screen as is (brand panel, curve, glow, Google row).
- (c) A fully new NEXUS login with its own wording.

Reasons for (a): one account means the member should meet the same words in both apps (Email, Kata sandi, "Lupa kata sandi?", "Akun dibuat oleh admin PMK ITERA."), the same field order and the same meaning of errors, so it feels like the same account. The look follows Stitch (D-014), so (b) would bring PI-CORE's other palette, a curved panel (Stitch's bar is flat), a glow and a breathing logo that loop forever, and a disabled Google row that does nothing. PI-CORE's tagline is English and its language switch is out of scope (D-016). (c) would make members relearn a screen they already know. This design is (a).

**Q2. Field border and field text size (D1).** May the login form use the darker Stitch outline colour `#81756A` for field borders and 16 px field text, and may the same apply to all NEXUS forms?
- (a) Yes, for all forms. **Recommended** (it fixes a contrast failure and the iPhone zoom).
- (b) Only on login, keep Stitch values elsewhere (inconsistent forms).
- (c) No, keep Stitch exactly (the field border fails the 3:1 rule).

**Q3. "Buka PI-CORE": same tab or new tab (S2)?**
- (a) New tab. **Recommended.** The NEXUS page with "Sudah ganti? Muat ulang" stays open behind it; the person closes the PI-CORE tab and presses the button. Caveat: inside an installed PWA a new tab may open outside the app.
- (b) Same tab, as in the spec. The person must find the way back to NEXUS themselves.

---

## 12. Verification notes

- `contrast-check.py` could not be run by the designer (no shell). The tech lead re-computed the key pairs with the WCAG formula on 2026-11-06; all matched section 3 (incl. `#D8CCBA` 1.53 fail, `#81756A` 4.33 pass). All ratios in section 3 were computed by hand with the WCAG formula from the skill. QA should re-run the script on the pairs before build; the near-threshold ones are `#81756A` on white (4.48, used only for icons and borders, never for text) and `#7A6652` on canvas (5.15).
- `impeccable` setup (`impeccable context`) could not run for the same reason. Its Operate-mode guidance was read from `reference/operate.md`; its `craft-floor.md` was not loaded because this task is planning only. No `PRODUCT.md` or `DESIGN.md` was read for it; Stitch tokens were used as the visual source.
- `antislop` mode (during or after) was not set: no `~/.config/antislop/settings.json` exists and a sub-agent cannot ask. The rules were applied while designing (the "during" behaviour).
- No design file was run in a browser. Sizes and spacing come from the Stitch scale and Stitch HTML `08-notulensi-rapat`, not from a render.
- Not covered here: the "Aksesmu sudah berubah. Masuk lagi atau hubungi admin PMK ITERA." message (spec 6.4a), which appears inside module screens after a Server Action fails, and the Dashboard itself.
