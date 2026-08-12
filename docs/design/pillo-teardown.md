# Pillo — Complete UI/UX Teardown

**Purpose:** reference document for designing Re-MIND-eR. Every screen from the captured flow is broken down into layout zones, exact placement, components, states, and the UX rule behind it.

**Measurement basis:** screenshots are 1080 × 2400 px at ~3× density. All values below are given in **dp** (px ÷ 3) against a **360 dp** logical width. Values marked `~` are measured off the screenshots and are accurate to ±2 dp. Colours are sampled approximations — verify against the real build before using as tokens.

---

## 1. Design System

### 1.1 Colour tokens

| Token | Value (approx) | Used for |
|---|---|---|
| `primary` | `#4C6FFF` | Primary buttons, active states, section eyebrows, FABs, checkbox fill |
| `primary-pressed` | `#3355E0` | Mockup "Take now" in previews |
| `primary-subtle` | `#C9D5FF` | Selected list rows, "Reschedule" pill, circular back button |
| `primary-faint` | `#E4EAFF` | "View more music" pill background |
| `mascot-blue` | `#3D6BF5` | Character fill |
| `surface` | `#FFFFFF` | Cards, sheets, list groups |
| `background` | `#F5F5F5` | Page background on most screens |
| `background-alt` | `#EDEDED` | Time-wheel and alarm screens (deliberately dimmer) |
| `fill-quiet` | `#F2F2F2` | Unselected answer cards, secondary pills, emoji tiles |
| `text-primary` | `#1C1C1E` | Headlines, labels |
| `text-secondary` | `#8A8A8E` | Sub-labels, "No data", placeholders |
| `text-disabled` | `#BDBDBD` | Faded wheel neighbours, disabled "Next" |
| `divider` | `#E5E5E5` | 1 dp list separators |
| `overlay-scrim` | `#000000` @ ~55% | Coach-mark dimming |
| `overlay-sheet` | `#2C2C2E` | Dark coach-mark modal |
| `danger` | `#FF4A4A` | "Essential" permission tag |
| `illustration-cream` | `#FDF7DC` | Meal Checker upsell card |

**Accent discipline:** exactly one hue does all the work. Colour is never decorative — if something is blue, it is either interactive or currently selected. The only exceptions are emoji (which carry their own palette) and the pastel tiles on the Health tab.

**Health tab pastel set** (the one place a secondary palette exists): Water `#E3F2FD` / Mood `#FFF3DC` / Sleep `#EDE7FF` / Weight `#F0F0F0` / Blood Pressure `#FFE6EA` / Heart Rate `#F5F5F5` / Glucose, HbA1c, SpO2, Body Temp `#F5F5F5` with red-family emoji.

### 1.2 Typography

Single family throughout — a bold geometric sans (Poppins / Gilroy / Circular class, with the single-storey `a` and circular `o`).

| Role | Size | Weight | Line height | Align |
|---|---|---|---|---|
| Screen headline | 26–28 dp | 700 | 1.25 | Centre (onboarding) / Left (forms & tabs) |
| Tab title (`Today`, `Meds`, `Health`) | 28 dp | 700 | 1.2 | Left |
| Section eyebrow (`SET FREQUENCY`) | 13 dp | 600, all-caps, +4% tracking | — | Centre |
| Card / row label | 17–18 dp | 500 | 1.3 | Left |
| Answer-card label | 18 dp | 500 | — | Centre |
| Sub-label / metadata | 14 dp | 400 | 1.35 | Left |
| Button label | 18 dp | 600 | — | Centre |
| Chip label | 15 dp | 500 | — | Centre |
| Wheel — selected | 30 dp | 700 | — | Centre |
| Wheel — neighbour | 30 dp | 700 @ `text-disabled` | — | Centre |

**Rule observed:** exactly one 26 dp+ headline per screen. Nothing else on the screen is allowed to compete with it.

### 1.3 Spacing scale

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56`

- **Screen horizontal gutter:** 16 dp (onboarding cards) → 16 dp (all tabs). Consistent everywhere.
- **Headline → first control:** 32–40 dp.
- **Between stacked cards:** 10–12 dp.
- **Between list rows inside one grouped card:** 0 (separated by 1 dp divider instead).
- **Bottom CTA → screen bottom:** 24 dp on onboarding, 16 dp above bottom nav on tab screens.

### 1.4 Radius & elevation

| Element | Radius |
|---|---|
| Primary/secondary button (pill) | Full (height ÷ 2) — ~28 dp |
| Answer card, grouped list card | 16 dp |
| Small pill (`View more schedule`, `Scan`, `Stock Calculator`) | Full |
| Emoji tile / med icon tile | 12 dp |
| Checkbox | 8 dp (rounded square, not a circle) |
| Phone mockup in choice cards | 24 dp |
| Coach-mark modal | 20 dp |
| Alarm wallpaper preview card | 24 dp |

**Elevation:** almost none. Cards separate from background by fill contrast (`#FFF` on `#F5F5F5`), not shadow. The only real shadows are on the FAB and the coach-mark modal.

### 1.5 Iconography

Deliberately **mixed**, and this is a real decision worth noting:

- **Emoji** for anything emotional or categorical — ☀️ 🕛 🌙 🛏️ (time slots), 💗 📷 📝 🥗 🫙 📅 🩺 (optional details), 💧 😊 🌙 ⚖️ (health metrics).
- **Line icons** for system actions — back arrow, X, settings gear, share, sort, chevron, speaker.
- **Filled blue glyphs** for the three safety tools on the Med tab.

Emoji reduce build cost and read instantly for low-literacy and elderly users; line icons keep chrome quiet. The mix is inconsistent by strict design-system standards but works because the two sets never sit in the same row.

---

## 2. Layout Zoning

Nearly every screen uses the same five-band vertical structure:

```
┌─────────────────────────────────┐
│ 0–30 dp     STATUS BAR (OS)     │
├─────────────────────────────────┤
│ 40–70 dp    STEP BAND           │  eyebrow + progress bar
├─────────────────────────────────┤
│ 88–110 dp   NAV BAND            │  back arrow / X, left-aligned 16 dp
├─────────────────────────────────┤
│ 110–140 dp  HEADLINE            │  1–3 lines, then 32 dp gap
├─────────────────────────────────┤
│             CONTENT             │  cards, wheel, list, carousel
│             (flexible)          │
├─────────────────────────────────┤
│ bottom      ACTION BAND         │  primary CTA + optional text link
└─────────────────────────────────┘
```

**Pinned-bottom rule:** the primary CTA is *always* anchored to the bottom of the viewport, never inline after content. Content scrolls under it. Thumb reach is treated as sacred.

**Empty space is not filled.** Screen 3 has ~800 dp of unused vertical space below three cards. That is intentional — it prevents the user from scanning past the decision.

---

## 3. Component Inventory

### 3.1 Progress bar (stepper)

- **Placement:** x = 16 dp → 344 dp, y ≈ 66 dp, height 6 dp, full radius.
- **Anatomy:** grey track `#E8E8E8` + blue fill + **six 8 dp dots** overlaid at equal intervals marking step boundaries.
- **States:** fill width animates between dots. Steps observed: `SET FREQUENCY → SET TIME → ALARM TYPE → ALARM WALLPAPER → REMINDER SOUND` (+ permissions, un-tracked).
- **⚠ Defect:** the fill does **not** advance between the frequency question and the "Great!" interstitial — identical fill position on two consecutive screens. The user gets zero feedback for an answered question.
- **Second variant:** the Meal Checker sub-flow uses a different stepper — 4 plain black 2 dp segments flush to the top edge, no dots, no label. Two stepper languages in one product is a consistency failure.

### 3.2 Section eyebrow

- **Placement:** centred, y ≈ 48 dp, above the progress bar.
- 13 dp, all-caps, `primary`, letter-spaced.
- **⚠ Defect:** reads `SET FREQUENCY` while the question asks *how many* medications — that's a count, not a frequency. Label and content disagree.

### 3.3 Back / close affordance

- **Back arrow:** 24 dp glyph, left-aligned at 16 dp, y ≈ 100 dp. Appears from step 2 onward.
- **Close (X):** same size and position, used on **sheets** rather than steps (Optional Details, med picker, stock).
- **Circular back:** 48 dp circle, `primary-subtle` fill, bottom-left at 16 dp — used only in the alarm/logging flow where the bottom band holds both back and forward.
- **⚠ Defect:** the first question screen has *no* back affordance at all. Mis-tap = trapped.

### 3.4 Answer card (single-select)

```
┌──────────────────────────────────────────┐  ← 328 dp wide, 62 dp tall
│                                          │     radius 16, fill #F2F2F2
│              Only 1 med                  │     label 18 dp / 500, centred
│                                          │
└──────────────────────────────────────────┘
```

- Stacked with 10 dp gaps starting at y ≈ 188 dp.
- **Tap = commit + advance.** No Next button on this screen.
- **⚠ No selected state exists** — the screen leaves before one could render. That removes the confirmation beat users expect.

### 3.5 Selectable row (multi-select)

```
┌──────────────────────────────────────────┐  ← 328 × 64 dp, radius 16
│  ☀️   Morning                      [✓]   │
└──────────────────────────────────────────┘
   ↑16    ↑56                        ↑288
```

- Emoji at x = 16 dp (28 dp box), label at x = 56 dp, checkbox right-aligned ending at 312 dp.
- **Unselected:** fill `#F2F2F2`, checkbox = 26 dp rounded square, 2 dp `#D0D0D0` border, transparent inside.
- **Selected:** fill `primary-subtle`, checkbox filled `primary` with a white 16 dp check.
- Whole row is the hit target (328 × 64 dp) — not just the checkbox.
- Sub-instruction `( Select all that apply )` sits centred 8 dp under the headline in 16 dp `text-secondary`, with literal spaces inside the parentheses.

### 3.6 Scroll wheel (time picker)

- Three columns: hour (x ≈ 70–130), minute (x ≈ 150–210), meridiem (x ≈ 230–290). Colon fixed between columns 1 and 2.
- Selected row centred vertically at ~40% screen height, bounded by two 1 dp hairlines ~24 dp apart.
- ±1 neighbour visible at `text-disabled`; ±2 fades further.
- Minute column steps by 5.
- Background switches to `background-alt` for wheel screens — a subtle mode cue that this screen is an input, not a choice.
- **Variant:** the meal lead-time wheel adds a static `Before` label to the left of the columns and swaps meridiem for a `min`/`Hour` unit column.

### 3.7 Comparison choice card (Alarm Type)

- Two cards side by side, each ~156 dp wide, split at the 16 dp gutter with a 16 dp centre gap.
- **Anatomy top→bottom:** phone mockup (~156 × 210 dp) → title (22 dp / 700) → 2-line description (16 dp) → 28 dp checkbox, all centre-aligned.
- **Recommended badge:** `primary` pill, ~10 dp above the mockup's top-left, overlapping the card edge so it reads as a sticker.
- **Selected state:** mockup gets a 3 dp `primary` border, title + description switch from `text-primary` to `primary`, checkbox fills. **Three simultaneous selection signals** — expensive but unmissable.
- Unselected card renders its mockup in dark grey so it reads as literally "less bright."

### 3.8 Full-bleed carousel (Alarm Wallpaper)

- Active card ~278 dp wide, centred, with ~10 dp of the neighbours peeking at both edges — the peek is what teaches swipeability.
- Card content: mute icon top-right (40 dp, translucent white), `TIME TO TAKE MEDS` lockup, `👁 View medications >` pill, giant mascot face bleeding off the bottom, gradient-to-black at the base for text legibility.
- **Name + description** bottom-left in white over the gradient.
- **Preview button:** dark translucent pill, full card width minus 24 dp, sitting 16 dp from the card bottom.
- **Thumbnail strip:** 5 slots, ~54 × 72 dp, 12 dp gaps, active one ringed 3 dp `primary`; last slot is a `···` overflow tile.
- **Dynamic CTA:** the button text *names the selection* — `Select Short-tempered`, `Select Nagging`, `Select Fuming`. Removes any doubt about which card is committed.

### 3.9 Audio row (ringtone)

- 328 × 72 dp, radius 16.
- Vinyl-record icon 44 dp at x = 16 (colour-coded per track), name at x = 76.
- **Selected:** fill `primary-subtle` **and** a 48 dp white circular play button appears at the right — preview affordance only exists on the selected row, which keeps the list quiet.
- Unselected rows are `#FFFFFF` here (not `#F2F2F2`) because the page background is grey on this screen.

### 3.10 Permission card

- ~296 dp wide, `primary` fill, radius 20, in a 2-card swipe carousel with 8 dp dot indicators below.
- **Counter pill** `1/2` top-left (white fill, dark text). **`Essential` tag** top-right (`danger` fill, white text).
- Body = an illustrated, device-accurate reproduction of the actual Android settings screen, with a **pointing-hand cursor** on the exact row to tap.
- Caveat line `(Permission name may differ by device)` in translucent white — pre-empts the #1 support ticket.
- CTA `Go to Settings →` deep-links straight to the OS page.

### 3.11 Coach-mark

- Full-screen scrim; the **target element remains at full opacity** and un-dimmed (reminder card on 1/3, `+ Schedule` FAB on 3/3, which additionally gets a white 4 dp ring).
- Modal: `overlay-sheet` dark card, radius 20, ~296 dp wide, with a small tail pointing at the target.
- Content: `n/3` counter (16 dp, top-left) → question headline (22 dp / 700, white) → white primary button → grey secondary button → plain-text `Later`.
- **Three-tier action hierarchy** — filled / tinted / text — appears consistently across every modal in the app.

### 3.12 Grouped settings list (Optional Details)

- White card, radius 16, rows ~72 dp, 1 dp dividers inset to x = 16 dp.
- Row: 44 dp emoji tile (radius 12, `fill-quiet`) at x = 16 → label at x = 72 → trailing control right-aligned to 344 dp.
- **Trailing control varies by type:** blue `Add` button (~64 × 40 dp, radius 12) for anything that opens a sub-flow; a **toggle** for binary settings (Rx Label). The control shape tells you what will happen before you tap.
- Groups are separated by 16 dp of background showing through.
- **⚠ Defect:** the pinned `Done` button overlaps the last visible row (Prescribing Doctor), which is clipped underneath. Missing bottom padding equal to CTA height + 16 dp.

### 3.13 Chip cluster (skip reasons)

- Wrapped flow layout inside the white card, 12 dp horizontal / 12 dp vertical gaps, chips sized to content, height 44 dp, radius full, fill `fill-quiet`.
- Nine chips: 8 preset reasons + a `⚙ Custom` chip that carries a leading icon to distinguish it.
- Sits **below** a large free-text area — typing is offered first, chips are the shortcut. On mobile that ordering is arguably backwards (see §7).

### 3.14 Bottom navigation

- Height 56 dp + safe area, `surface` fill, no top border.
- 5 tabs evenly distributed: **Today / Med / Progress / Health / Me**, each a 24 dp line icon over a 12 dp label.
- **Active state:** icon and label go black **and** the tab gets a `fill-quiet` rounded-rect pill behind it (~72 × 44 dp). Inactive tabs are `text-secondary`.

### 3.15 FAB (extended)

- Bottom-right, 16 dp from right edge, 16 dp above the nav bar.
- Pill shape, `primary`, `+` glyph + label. **Label changes per tab** — `+ Schedule` (Today), `+ Med` (Med), `+ Log` (Health). The action is always "add the thing this tab is about."

### 3.16 Buttons — the full ladder

| Tier | Style | Placement | Example |
|---|---|---|---|
| Primary | Full-width pill, `primary` fill, white 18 dp/600 | Pinned bottom, 328 dp wide, 56 dp tall | `Next`, `Done`, `Go to Settings →` |
| Primary (disabled) | Same shape, `fill-quiet` fill, `text-disabled` label | Same | `Next` on empty Name Medication |
| Secondary | Tinted pill, `primary-faint` or `fill-quiet` | Inline, content-width, centred | `View more music`, `Stock Calculator`, `Pause medications` |
| Tertiary | Plain text, `text-primary` or `text-secondary` | Centred under primary | `Later`, `No thanks`, `Import/Restore Data` |
| Destructive-ish | Grey pill | Pinned bottom | `Cancel` on Stock Calculator |

### 3.17 Ring countdown timer

The single most sophisticated component in the app.

```
                 ╭──────────────────╮
            ╭────┤  MASCOT HEAD     ├────╮   ← rides the leading edge
          ╭─┘    ╰──────────────────╯    └─╮
         │                                  │
        │            04 : 53                 │  ← 40 dp / 700, centred
        │          ┌───────────┐             │
        │          │  + 1 min  │             │  ← 40 dp pill, primary-subtle
         │         └───────────┘            │
          ╰─╮                            ╭─╯
            ╰────────────────────────────╯
```

- **Ring:** ~300 dp outer diameter, ~34 dp stroke, centred at ~42% screen height. Track `#E0E0E0`, progress fill drawn clockwise from 12 o'clock.
- **Mascot as progress head:** a ~72 dp mascot face sits on the ring's leading edge and travels around it as time depletes. This is the whole design in one move — the character *is* the progress indicator, so watching the clock and watching the character are the same act.
- **Two-state colour + expression, switched together:**

  | State | Ring fill | Mascot face |
  |---|---|---|
  | On time | `primary-subtle` `#AEC3FF` | Happy, open mouth, wide eyes |
  | Overdue | Coral `#F9A3A3` | Angry — furrowed brows, frown, hair spiked |

  The ring also *reverses direction of meaning* when overdue: pre-expiry it depletes a full blue ring; post-expiry a coral arc grows from 12 o'clock as the restart timer counts down.
- **Centre stack:** `MM : SS` in 40 dp/700 with a spaced colon, then a `+ 1 min` pill (~120 × 44 dp, `primary-subtle` fill, `primary` label) directly below.
- **Auxiliary:** `👁 View meds due now` tinted pill above the action row; 2-dot page indicator top-centre; speaker toggle top-right (shows `🔇×` when muted).
- **Action row:** 48 dp circular back (left) — 200 dp `Taken` primary (centre) — 48 dp circular note button (right). One thumb-sized primary flanked by two secondaries.

### 3.18 Tooltip coach-mark (speech bubble)

Distinct from the dark modal coach-mark (§3.11) and used only inside the timer.

- White card, radius 16, ~264 dp wide, with a **downward-pointing tail** aimed at the element being explained.
- `1/2` counter in `primary` at the top, 20 dp/700 headline below, white `Next` button rendered as a separate card beneath the highlighted element.
- Scrim dims everything except the ring and the `Taken` button.
- Two steps: `Take your meds before time's up` → `If you're late, the alarm will restart`. The second one is shown against the *overdue* ring state, so the warning is demonstrated rather than described.

### 3.19 Celebration / reward screen

- **Full-bleed `primary` background** — the only screen in the app that floods the accent colour edge to edge. Colour alone signals "this is different."
- X close top-left in a translucent white rounded square.
- Green gradient heart (`#22C55E → #A3E635`), ~200 dp, centred at ~38% height, with a soft double-layer offset for depth.
- Headline `You earned a Heart!` 34 dp/700 white.
- Subcopy with an **underlined inline link** on `at no cost` — the phrase that defuses the obvious objection is the one made tappable.
- Actions inverted for the dark ground: **white** primary (`Donate a Heart`) + white-text tertiary (`Save it for later`).

---

## 4. Screen-by-Screen Specification

### PHASE 1 — Onboarding (14 screens)

#### S1 · Splash
- Headline `Hello, I'm Pillo!` at ~41% screen height, 28 dp/700, centred, `text-primary`.
- Mascot ~160 dp wide, centred, its ellipse shadow at ~65% height.
- No chrome, no button. **Auto-advances.**
- *Purpose:* establish the character before asking for anything.

#### S2 · Intent framing
- Headline 3 lines at ~33% height: `I have a few questions before we set your medication schedule!`
- Mascot below (sparkle-eye variant — the mood changes per screen).
- `Next` pinned bottom.
- *Purpose:* sets expectation of length. First-person voice makes the coming interrogation feel conversational.

#### S3 · How many medications
- Step band: `SET FREQUENCY` + 6-dot bar (fill at position 1).
- Headline 2 lines centred, y ≈ 132 dp.
- Three answer cards from y ≈ 188 dp: `Only 1 med` / `2 meds` / `More than 2 meds`.
- `Import/Restore Data` — 18 dp `text-primary` at ~92% height, centred, no button chrome.
- *Defects:* no back arrow; no selected state; bucketed answer loses the 3-vs-11 distinction that determines the whole schedule UI.

#### S4 · Encouragement interstitial
- `Great!` / `Let's set up your med schedule` centred at ~35% height.
- Mascot with clipboard + pencil (a *task-appropriate* prop — the mascot's costume signals the phase).
- No visible CTA in frame; the progress bar has not moved.
- *Defect:* a full screen and a tap spent on zero information.

#### S5 · When do you take it
- Headline + `( Select all that apply )`.
- Four selectable rows (Morning ☀️ / Noon 🕛 / Evening 🌙 / Bedtime 🛏️) from y ≈ 250 dp.
- `View more schedule` — content-width grey pill, centred, 16 dp below the last row. Escape hatch for non-standard regimens.
- `Next` pinned bottom (required here because multi-select can't auto-advance).

#### S6 · Set time (repeated per slot)
- Header switches to `SET TIME`; the same slot emoji from S5 appears above the headline — **visual continuity between the choice and its configuration.**
- Headline names the specific slot: `What time do you take your med in the evening?`
- Wheel centred; background `background-alt`.
- `Next` pinned.
- *Loop:* this screen repeats N times where N = slots selected on S5.

#### S7 · Alarm type
- `ALARM TYPE`, fill at position 3.
- Two comparison cards (§3.7). Left is pre-selected and badged `Recommended`.
- Descriptions do persuasion work: *"Full screen alert to capture attention"* vs *"Small alert for adherent users"* — the second one flatters you into the weaker option only if you've earned it.

#### S8–S10 · Alarm wallpaper
- Carousel of mascot personalities: **Short-tempered**, **Nagging**, **Fuming** (+ more behind `···`).
- Each preview is a faithful render of the actual alarm screen, so what you pick is what you'll see.
- Fuming's preview additionally shows `7:00 AM | + 5m late` — demonstrating the escalation behaviour, not just describing it.
- *This is the product's differentiator.* Adherence is reframed from a chore into a relationship with a character who reacts to you.

#### S11 · Reminder sound
- Progress bar fully filled.
- Mascot in headphones (mood/prop matched to task again).
- Three tracks: `Sprout`, `Nagging`, `Rage` — named on an escalation scale that mirrors the wallpaper personalities.
- `View more music` secondary pill.

#### S12–S13 · Permission priming
- **No progress bar** — signals "we're past the setup, this is the last gate."
- Blue `One last step!` eyebrow + black 2-line headline.
- 2-card carousel (§3.10).
- *This is the single best-executed screen in the flow.* Permissions are asked **after** ~11 screens of sunk cost, taught with illustrations of the real OS UI, marked `Essential` in red, and the user is deep-linked rather than instructed.

#### S14 · OS hand-off
- Android's native `Display over other apps` list; pillo sits at top, `Not allowed`.
- *Gap:* no visible return path or verification screen. The app should poll on resume and confirm success.

### PHASE 2 — First-run guidance (coach-marks)

#### S15 · Coach-mark 1/3
- Scrim over the home screen; the auto-created reminder card `My Medication 01 · 1 Tablet | Daily` stays lit.
- `Would you like to add a med name to reminder for accurate tracking?`
- Actions: `+ Add name` (white) / `📷 Scan my med` (grey) / `Later` (text).
- *Note:* onboarding **already created a working reminder** before the user named anything. The user has value on screen before doing any data entry. This is the most transferable idea in the whole app.

#### S26 · Coach-mark 3/3
- Same pattern, spotlight moves to the `+ Schedule` FAB with a white ring.
- `Would you like to add another med?` → `Add Medication` / `Later`.

### PHASE 3 — Medication detail entry

#### S16 · Name Medication
- Back arrow, headline left-aligned, underlined search field with magnifier at x = 16.
- Bottom cluster: `📷 Scan` (dark pill, ~86 dp) + `🔍 Search by Treatment` (grey pill, fills remaining width) side by side, 12 dp above a **disabled** `Next`.
- *Three input paths offered simultaneously:* type, scan, browse. Disabled CTA correctly gates on empty input.

#### S17 · Choose your medication name (sheet)
- X close top-left; 2-line headline.
- **Horizontally scrollable tab bar** at y ≈ 195 dp: active tab is black + 3 dp black underline + faint `#F7F7F7` background; inactive tabs are `text-secondary`. Neighbours are clipped mid-word at both edges — the clipping *is* the scroll affordance.
- Categories: Hypertension · Diabetes · High Cholesterol · Supplements · Depression · Thyroid · Asthma · Hairloss/Prostatic hyperplasia · Contraceptives.
- List rows ~56 dp, label at x = 16, 1 dp full-bleed divider, no chevrons, no icons — maximum scan speed.
- Generic names, with brand names in parentheses where recognisable.
- **`Type Medication Name`** in `text-secondary` as the final row of *every* category — the escape hatch is always in the same place.

#### S18 · Enter Dose Amount
- Split field, 328 dp wide, 64 dp tall, radius 12, 1 dp border, divided at ~40%: numeric on the left, unit dropdown (`Tablet` + chevron) on the right.
- `🔄 Custom dose pattern` grey pill, content-width, centred, 24 dp below.
- `Done` pinned.

#### S19 · Optional Details (sheet)
- Grouped list (§3.12): Purpose 💗 · Photo 📷 · Instructions 📝 · Meal Checker 🥗 · Stock 🫙 · Duration 📅 · Rx Label (toggle) — then a second group opening with Prescribing Doctor 🩺.
- *This is the app's core structural decision:* the required path is **name + dose only**. Everything else is a menu of opt-ins, so power users get depth and casual users get out in two screens.

### PHASE 4 — Optional feature sub-flows

#### S20–S23 · Meal Checker
1. **Upsell** — cream illustration card with a mock notification (`Start Fasting Now / Fast for 2 hours…`), headline `Does your med-guide include meal instructions?`, subcopy, `Try Now`.
2. **Configure** — `First, select the meal instruction for your med` + med name; three outlined cards (before / after / with meal); a greyed phone mockup below previews the resulting alarm in real time.
3. **Activate checker** — mock in-alarm dialog `Wait, have you had a meal? / Yes, I had a meal / No, I haven't`; `Activate Checker` + `No thanks`.
4. **Meal-time notification** — mock `It's Time to Start Eating` banner; `Get notification` + `No thanks`; then a lead-time wheel `Before [10] [min]`.

**The repeatable formula:** *show the artefact → let them configure it → preview the artefact again → offer an explicit decline.* Every optional feature in the app follows it.

#### S24–S25 · Stock
- **S24:** headline, then a live numeric entry rendering as `20 pills left` above a full-width rule — the unit is written into the value, so there's no separate label. `Stock Calculator` grey pill below. Keyboard is open on entry with the blue `Next` **sitting directly on the keypad's top edge** (full-bleed, square corners here — an inconsistency with the pill CTA everywhere else).
- **S25:** two-row card (`Most recent refill date → Select Date` / `Refill quantity → Enter Count`), a 32 dp downward arrow, then a result card `Stock — pills left`. The arrow makes the input→output causality literal. `Cancel` pinned bottom.

### PHASE 5 — Steady-state tabs

#### Today (home)
```
16 dp  Today  [📅]                    [📄] [⚙]
       ─────────────────────────────────────
       S    M    T    W    T    F    S       ← week strip
       9   (10)  11   12   13   14   15      ← today circled black
       ─────────────────────────────────────
       ┌───────────────────────────────┐
       │ 7:00 PM                   🔊  │     ← time group header
       │ ┌───────────────────────────┐ │
       │ │ ⬤  dolo               ⋮  │ │     ← reminder card
       │ │    1 Tablet | Daily       │ │
       │ └───────────────────────────┘ │
       │        + Med / Tracker        │     ← dashed inline add
       └───────────────────────────────┘

       As needed                    [⇅]      ← second section + sort

       ┌───────────────────────────────┐
       │ Got feedback?                 │     ← feedback prompt card
       └───────────────────────────────┘
                          ┌──────────────┐
                          │ + Schedule   │   ← FAB
                          └──────────────┘
       ─────────────────────────────────────
       Today   Med   Progress  Health   Me
```
- Doses are **grouped by time**, not listed flat — the group header carries a per-time mute control.
- `+ Med / Tracker` sits *inside* the time group, so adding is contextual to that slot.

#### Med
- Title `Meds` + `Safety Reports` white pill + share icon.
- **Three tool cards** in a row (~104 dp each): Drug-Drug Interaction (blue `i` pill) · Side Effects Checker (blue ⚠) · Nutrient Loss Checker (blue ↓). Positioned *above* the list — clinical safety is framed as the headline feature, not a settings item.
- `Meds List` → `Scheduled (1)` + sort control → med cards (name / `1 Tablet | Daily` / `20 pills left` / chevron).
- `⏸ Pause medications` grey pill, centred — a first-class action for travel or a paused course.
- `+ Med` FAB.

#### Health
- Title + share icon.
- Vertical metric cards, ~104 dp tall: name (20 dp/700) + `No data` (14 dp `text-secondary`) on the left, pastel emoji tile (~64 dp, radius 16) on the right with a **small blue `+` badge** overlapping its top-right corner.
- Metrics: Water · Mood · Sleep · Weight · Blood Pressure · Heart Rate · Glucose · HbA1c · SpO2 · Body Temperature.
- `+ Log` FAB.
- *Note:* every metric renders even when empty, with a per-card `+`. The empty state **is** the call to action — no separate onboarding needed.

#### Progress
- Title `Progress` + a white **`🌳 Giving`** pill + share icon.
- **Streak card** — full-width, radius 16, `primary` fill:
  - `Adherence Streak >` (22 dp/700 white) top-left, `⚙ Setup` translucent pill top-right.
  - `1` at ~56 dp/700 with `day` baseline-aligned beside it, bottom-left.
  - Green gradient heart, ~110 dp, right side, with a white outline stroke.
  - **Bottom strip** in a lighter blue→cyan gradient: `Free Donation | 1 💚`, centred. Physically attached to the streak card — adherence and donation are one object.
- **Monthly adherence card** — white, radius 16:
  - `August` (26 dp/700) + `Monthly adherence` sub-label; `<` `>` month arrows top-right as 48 dp grey rounded squares (forward is disabled/greyed at the current month).
  - 1 dp rule, then SUN–SAT column headers in `text-secondary` caps.
  - 7-column date grid. Today = blue numeral inside a 2 dp `primary` ring. Past dates black, **future dates `text-disabled`**.
  - **Density legend** along the bottom: five dots stepping `100% / ~75% / ~50% / ~25% / 0%` from full `primary` to near-white. Each day cell fills with the corresponding tint — a heatmap calendar with a legend, not a chart.

### PHASE 6 — The alarm (the moment that matters)

#### S30 · Full-screen alarm
- Background `background-alt`; mute icon top-right in a white 56 dp rounded square.
- Stack, all centred: `7:05PM Meds` eyebrow (18 dp `text-secondary`) → **med name 34 dp/700** → dose `1 Tablet` (20 dp) → med icon tile (~80 dp, radius 16) → dashed-border instruction box (`Instructions will be shown once you add`).
- Actions: `Take now →` (primary, 56 dp) → `Skipped` (grey, 56 dp) → `⏰ Reschedule` (`primary-subtle` pill, content-width, centred).
- **Hierarchy is unambiguous:** the desired action is blue and top; the honest-but-undesired action is grey; the deferral is smallest and tinted.
- The empty instruction box is a **dashed placeholder** rather than a hidden element — it advertises the feature the user hasn't configured.

#### S31 · Skip-reason capture
- Headline `Note why you skipped for the future reference` + `dolo 1 Tablet` sub-line.
- Large white card: `Tap here to type` textarea occupying the upper ~55%, then the wrapped chip cluster (§3.13) in the lower portion.
- Circular back (bottom-left) + `Next →` (bottom-right, ~156 dp) — the only two-button bottom band in the app.
- *Framing to steal:* "for the future reference," not "why did you fail." Zero blame, and it converts a missed dose into adherence-analytics data.

#### S32 · Log complete
- Mascot with clipboard + pencil (same asset as S4 — the "recording" mood).
- `Log complete` 34 dp/700 centred.
- White result card: grey status icon → `Skipped` (24 dp/700) → med name (`text-secondary`).
- Circular back + `Close` with a **countdown numeral** — auto-dismisses so a half-asleep user doesn't leave the screen open.
- Status icon colour is the state signal: grey for skipped (presumably green for taken).

### PHASE 6B — The `Take now` branch (Countdown Timer)

This is where Pillo does its most interesting work, and it is a **feature, not a confirmation**.

#### S33 · Countdown upsell (bottom sheet)
- Rises over the dimmed alarm screen — the alarm stays visible above it (`10:15PM Meds` still legible), so context is never lost.
- Cream illustration card, radius 20: a woman drinking water, with an Rx bottle beside her and **the mascot perched on the bottle cap**, arms out, with `×××` motion marks. The mascot is inserted into the user's real-world scene.
- Headline `Take your meds now with Countdown timer ⏱` (28 dp/700, centred, emoji inline in the headline).
- Subcopy, 3 lines, `text-secondary`: *"Delay is the main reason for missed doses. Countdown timer helps you take your med on time, without distractions."* — **states the behavioural problem before offering the fix.** This is the only place in the app that justifies a feature with a claim about behaviour rather than convenience.
- `Try Countdown timer →` primary, pinned.

#### S34–S35 · Timer coach-marks
- `1/2 Take your meds before time's up` — shown against a **blue, on-time** ring at `04:59`.
- `2/2 If you're late, the alarm will restart` — shown against a **coral, overdue** ring at `01:00` with the angry mascot.
- The two states are taught by showing both, back to back, before the user experiences either. Costs two taps, saves an entire support article.

#### S36–S37 · The running timer
- Headline `Tap the button below when you have taken` — instruction-first, no med name shown. The screen's whole job is a single action.
- Ring component (§3.17) at `04:53` (on time, blue, happy) then `01:43` (overdue, coral, angry).
- Default duration: **5 minutes**. Extension: `+ 1 min`, unlimited taps.
- `👁 View meds due now` for multi-med time slots.
- `Taken` (primary) / back (left circle) / note (right circle).
- **On expiry the alarm restarts** rather than auto-logging as missed — the timer is a nag loop, not a deadline.

#### S38 · Add Note
- Reached from the note icon on the timer row — so a symptom can be captured *at the moment of dosing*, which is exactly when recall is best.
- Back arrow, `Add Note` headline (28 dp/700, left).
- White card: a row of two chips — **`⬤ General`** category chip (with a colour dot) + **`Aug 10, 10:15PM`** timestamp chip (pre-filled, editable) — above a `Tap here to type` area.
- Three white expander rows below, each with a leading `+`: `Severity Level`, `Condition`, `Measurement`. Same progressive-disclosure logic as Optional Details — structured clinical fields exist but never block a quick free-text note.
- `Next` primary, pinned.

#### S39 · Reward (Hearts)
- Celebration screen (§3.19): `You earned a Heart!` → `Donate a Heart` / `Save it for later`.
- **The reward loop:** take a dose on time → earn a Heart → donate it to a charity at no cost to you.
- *Why this is smart:* it converts adherence into **altruistic** motivation rather than points or badges. A streak you keep for yourself is easy to abandon when you feel bad; a streak that funds a charity is harder to drop, and it dodges the infantilising tone that gamification usually brings to a health app. The cost is presumably borne by a sponsor — hence `at no cost` being the underlined phrase.
- Hearts surface again on the Progress streak card (`Free Donation | 1 💚`) and in the `🌳 Giving` header pill, so the loop is closed and visible.

**Full branch map from the alarm:**

```
ALARM
 ├─ Take now ──→ Countdown upsell (first run only)
 │                └─ Timer (5:00, +1 min, restart on expiry)
 │                     ├─ Taken ──→ Log complete ──→ You earned a Heart!
 │                     │                                ├─ Donate a Heart
 │                     │                                └─ Save it for later
 │                     └─ Note icon ──→ Add Note (category, timestamp,
 │                                      severity, condition, measurement)
 ├─ Skipped ──→ Reason chips / free text ──→ Log complete (grey, no Heart)
 └─ Reschedule ──→ snooze picker
```

**The asymmetry is the point:** the taken path ends in colour, a green heart, and a charitable act. The skipped path ends in a grey icon and silence. No scolding copy anywhere — the reward's *absence* does all the work.

---

## 4B. Settings, Log, Trends & Me (from the screen recording)

The screenshots covered the happy path. The recording exposes the depth underneath it — and this is where Pillo turns out to be a far more serious product than the onboarding suggests.

### 4B.1 Settings › Alarm

```
Alarm
 ├─ Volume                                        >
 ├─ Sound                                         >
 ├─ Alarm size                                    >
 ├─ Alarm wallpaper                               >
 ├─ Alarm strength                                >
 ├─ After the alarm     Countdown timer·Note·Donation
 └─ Smart Snooze        0 active
General
 ├─ Alarm optimization  2 / 3 done ⚠
 ├─ Preferences · Widgets · Share report
 ├─ Back up / Restore data · Import log data
 └─ Restore subscription
More
 └─ Remove ads · Send feedback · Share Pillo to friends
    · Rate Pillo · About                     (v0.6.18)
```

- Grouped list, ~64 dp rows, leading 20 dp line icon, chevron trailing.
- **Two-line rows carry live state as the sub-label** — `Countdown timer · Note · Donation`, `0 active`, `2 / 3 done`. You can read the whole configuration without opening anything.
- `Alarm optimization` renders its sub-label in a warning treatment when incomplete. Settings surfaces its own unfinished business.

### 4B.2 Alarm wallpaper — three tiers

A segmented control with three modes, which reframes the personality feature entirely:

| Tab | Characters | Behaviour |
|---|---|---|
| **Varies over time** | Short-tempered, Moody, Fuming, Fuming mini | Expression escalates as you run late |
| **Single emotion** | Nagging, Worried, Cheerful | One fixed mood, held throughout |
| **Basic** | Simple and Informative | No character — med info only |

- Rows are name + one-line description + a live phone thumbnail on the right; the selected row gets a `primary` border.
- **`Cheerful` and `Basic` are the tell.** The angry-mascot escalation I flagged earlier as a risk for elderly and anxious users is *already solved* — the user picks their own emotional register, including opting out entirely. That is the correct answer to the concern, and it costs one segmented control.

### 4B.3 Alarm Strength — three fail-safes

Each toggle has its own detail screen with an illustration and a device mockup:

| Setting | Copy | Notes |
|---|---|---|
| **Force log** | *"Won't let you leave the app until you log"* | Badged `Alarm Strength Lv. 🔵🔵🔵` |
| **Bypass DND** | *"Rings through even in Do Not Disturb mode"* | Single toggle screen |
| **Auto-dismiss** | *"Saves battery, but might miss a dose"* | Carries a red **`Fail safe`** warning tag; sub-settings for `Black screen & mute after 30 min` and `Restart alarm after 5 min` |

**The honesty here is exceptional.** The battery-saving option is labelled with its own downside — *might miss a dose* — in red, on the screen that sells it. Most products would bury that.

### 4B.4 "After the alarm" — a user-composed pipeline

The single most interesting screen in the app.

```
Customize steps after the alarm goes off

 ┌────┐  ① Alarm goes off
 │view│
 └────┘
 ┌────┐  ② Countdown timer                    [ON]
 │view│     Timer that prevents med procrastination
 └────┘     Time frame                       5 min
 ┌────┐  ③ Dose Note        Note memorable events  [OFF]
 │view│     Adjust dose as needed  Change dose directly [OFF]
 └────┘     Skip Note        Note reason to skip     [ON]
 ┌────┐  ④ Giving                          Manually
 │view│
 └────┘
```

- Numbered steps in sequence, each with a **thumbnail preview + `View` label** on the left that opens a modal demoing that step.
- Every step is independently toggleable with its own time/mode parameter.
- **This is the whole post-alarm flow exposed as an editable pipeline.** The user isn't choosing settings; they're assembling the sequence they'll experience. It's the "show the artefact" principle applied to an entire flow rather than one screen.

### 4B.5 Smart Snooze — context-aware rules

| Rule | Trigger |
|---|---|
| Driving safety mode | Auto-snooze while you're driving |
| Auto snooze on calls | Auto-snooze during phone calls |
| Phone-in-use snooze | Prompt 3 min before the alert during active phone use |
| Location-based snooze | *"Snooze until home — reminder will resume when you arrive"* (`+ Add Place`) |
| Keep dose spacing | Auto-adjust timing between doses |

- Each has an illustrated setup screen with a mock notification and a single `+ Set …` / `+ Add Place` CTA.
- **Dose spacing** is illustrated with two dose cards and a red `⇅ Maintain 5 hours` bar between them — *"Keep your meds properly spaced! We'll auto-adjust your schedule if you take a dose late or earlier."* This is clinical safety logic rendered as a picture.

### 4B.6 Alarm optimization — the permission checklist

`Please grant all permissions for reliable reminders`

- **Essential:** `1. Allow 'Push notification'` ✓ · `2. Allow 'Display over other apps'` ✓ · `3. Exclude pillo from battery optimization` — rendered as a **full red card with a `Set it up` button** because it's unresolved.
- **Recommended:** `Disable "Do not disturb" mode`, `Restart the app after OS Update / Reboot`.
- Every item carries a `Why is this essential?` link.
- **The pattern to steal:** a persistent, re-visitable health check for the permissions your product depends on, with completion state (`2 / 3 done`) surfaced in the parent settings row. For a PWA with push notifications this is arguably *more* necessary than it is for a native app.

### 4B.7 Preferences · Widgets · Share report

- **Preferences:** Privacy Protection · Dark theme · Text size · Time format · Week starts on · Language.
- **Widgets:** `Med Cabinet` (meds + stock), `Today's Schedule` (Premium), `Giving garden` (*"Watch your giving garden grow on your home screen"* — a tree that grows with your streak). Each shows a real preview card above `+ Add Widget`.
- **Share report:** a 2-column grid of six export types — Medication List · Medication Records · Measurement Records · Note Records · Allergies — each an icon tile with a one-line description. This is the "bring it to your doctor" feature, and it's given a whole screen rather than a menu item.
- **Back up / Restore:** `Sign up to back up or restore data` → Google sign-in. Account creation is deferred until the user has a reason to want one.

### 4B.8 Log tab

Reached from the notes icon in the `Today` header (not the tab bar).

- `Log` title, share icon; `Filters` + month chips below.
- Day-grouped entries (`Today, Aug 11` / `Yesterday, Aug 10`), each row = status icon + med name + dose + status line.
- **Status icon carries the whole state:** grey `?` = scheduled but unlogged (`Scheduled at 7:05PM`), blue ✓ = taken (`Taken at 10:20PM`).
- Blue `+ Log` FAB for retroactive entry.

### 4B.9 Today — the parts the screenshots missed

- **Calendar expand sheet:** tapping the header calendar icon opens a month grid with **per-day dose dots** beneath each date, plus a flat agenda list (`Today, Aug 11` → med name + time, one row each).
- **`As needed dose`** section below the scheduled groups, with `+ Log extra dose`.
- **`Got feedback? We'd love to hear your thoughts` / `Send`** card at the bottom of the scroll — feedback capture placed where a satisfied user naturally ends up.

### 4B.10 Trends (Progress › View details)

- `Day` / `Week` segmented tabs.
- Month strip with an expand chevron to a full calendar.
- Per-day panel: `Adherence 0%` / `100%` with a **ring chart** on the right, then `Scheduled med` list with check marks.
- Separate `As-needed med` list, with an explicit note: *"As-needed medications are excluded from adherence calculations."*
- **The methodology is stated on the screen.** A number that could be gamed or misread is given its definition inline — rare and worth copying, especially for a product whose core metric is adherence.
- Empty day states are gentle: `No meds for today 😊`.

### 4B.11 Me tab

```
 ⬤  My Profile                             ✎
     Medication    3 medications  >
     Condition     –
     Allergy       –
    [ ▢ Note ]  [ 📅 Appointment ]

 Medical team
  ├─ Prescribers        >   "Call doctor by one click"
  ├─ Pharmacies         >   "Call pharmacy by one click"
  └─ Medical facilities >   "Manage your Medical facilities"

 Care team
  ├─ + Dependents
  └─ + Caregivers  🔒 Premium
```

- Profile card is a **clinical summary**, not an account page — meds, conditions, allergies, with `Note` and `Appointment` as the two actions.
- Each Medical team section is an empty state with an illustration, a benefit-led headline, and one `+ Add …` button. The value proposition is stated before any data exists.
- **`Dependents` and `Caregivers` are Pillo's version of your Care Circle** — and `Caregivers` is the paywalled feature. That's a direct signal about where this category monetises.

### 4B.12 Exit dialog

A custom `Would you like to exit now?` dialog with the `pillo` wordmark and `Cancel` / `Exit`. Branded even on the way out — and a deliberate friction point for an app whose value depends on staying installed.

---

## 5. Navigation Model

```
Splash
  └─ Onboarding wizard (linear, 6 steps, back-enabled from step 2)
       └─ Permission gate (carousel → OS deep link)
            └─ HOME (Today)
                 ├─ Coach-marks 1/3 → 2/3 → 3/3 (one-time)
                 ├─ Tab bar ──┬─ Today ── calendar sheet · Log · Settings
                 │            ├─ Med ── Safety tools / Meds List / Pause
                 │            ├─ Progress ── Giving · Trends (Day/Week)
                 │            ├─ Health ── metric log sheets
                 │            └─ Me ── Profile · Medical team · Care team
                 ├─ Settings ─┬─ Alarm ┬─ Volume · Sound · Size · Wallpaper
                 │            │        ├─ Alarm strength (Force log / DND /
                 │            │        │   Auto-dismiss)
                 │            │        ├─ After the alarm (step pipeline)
                 │            │        └─ Smart Snooze (5 context rules)
                 │            ├─ Alarm optimization (permission checklist)
                 │            ├─ Preferences · Widgets · Share report
                 │            └─ Back up / Restore · About
                 ├─ FAB → Add med
                 │          ├─ Name (type / scan / browse-by-treatment)
                 │          ├─ Dose
                 │          └─ Optional Details ──┬─ Purpose
                 │                                ├─ Photo
                 │                                ├─ Instructions
                 │                                ├─ Meal Checker (4-step sub-flow)
                 │                                ├─ Stock ── Stock Calculator
                 │                                ├─ Duration
                 │                                ├─ Rx Label (toggle)
                 │                                └─ Prescribing Doctor
                 └─ ALARM (system overlay)
                            ├─ Take now → Countdown timer → Taken
                            │                → Log complete → Heart reward
                            │                                   ├─ Donate
                            │                                   └─ Save
                            │             └─ Add Note
                            ├─ Skipped → reason capture → Log complete
                            └─ Reschedule → snooze picker
```

**Depth discipline:** the wizard is linear (no branching), sub-flows are modal sheets that always return to the caller, and the tab bar is only ever reachable from the home layer. You can never get lost more than two levels deep.

---

## 6. Interaction Patterns Worth Naming

| Pattern | Where | Why it works |
|---|---|---|
| **Tap-to-commit** | Single-select screens | Removes a Next tap. Only used where the choice is irreversible-by-design and immediately visible. |
| **Explicit-Next for multi-select** | Time slots, wheels | Correct — multi-select and continuous inputs *need* a commit. |
| **Mascot mood-matching** | Every narrative screen | The mascot's expression and props change per task (sparkle eyes = curious, clipboard = recording, headphones = audio). One character, many states, zero extra copy. |
| **Show the artefact** | Alarm type, wallpaper, meal checker, permissions | Every abstract setting is previewed as the literal thing it produces. Nothing is explained in prose that could be shown as a mockup. |
| **Dynamic CTA labels** | `Select Nagging`, FAB per tab | The button restates the selection or the context, so commitment is never ambiguous. |
| **Always-present escape hatch** | `Type Medication Name`, `View more schedule`, `View more music`, `Custom` chip | Every constrained list ends with an unconstrained option, in a consistent position. |
| **Three-tier decline** | `Try Now` / `No thanks`, `Add name` / `Later` | Declining is always available, always plain text, never hidden or guilt-worded. |
| **Deferred permission** | S12 | Asked at maximum sunk cost, minimum abandonment. |
| **Value before data entry** | A working reminder exists before the med is named | The user sees the product working before they've typed a character. |
| **Auto-dismiss confirmation** | Countdown on `Close` | Respects that the user is mid-routine and may not be looking at the screen. |
| **Character as data visualisation** | Mascot rides the timer ring | The progress indicator and the emotional feedback are the same pixel. No second element needed to convey urgency. |
| **Teach both states before either happens** | Timer coach-marks 1/2 and 2/2 | The overdue state is demonstrated on a coral ring with an angry face, so the consequence is understood in advance. |
| **Reward asymmetry, not punishment** | Heart on taken, grey icon on skipped | Motivation comes from what you miss out on, never from being told off. |
| **Altruistic gamification** | Hearts → charity donation | Sidesteps the infantilising tone of points and badges in a medical context, and makes the streak socially costly to break. |
| **Capture at the moment of truth** | Add Note lives on the timer | Symptom recall is best while the dose is in hand. |
| **Justify with the behaviour, not the feature** | Countdown upsell copy | *"Delay is the main reason for missed doses"* — states the problem, then sells the fix. |
| **State in the sub-label** | `2 / 3 done`, `0 active`, `Countdown timer · Note · Donation` | The settings list is readable as a status dashboard without opening a single row. |
| **Editable pipeline, not a settings list** | After the alarm | The user assembles the sequence they'll experience, with a preview thumbnail per step. |
| **Name the downside on the selling screen** | Auto-dismiss: *"Saves battery, but might miss a dose"* + red `Fail safe` tag | Trust bought cheaply, in a category where trust is the product. |
| **Let the user pick the emotional register** | Wallpaper tabs: Varies over time / Single emotion / Basic | Personality escalation becomes opt-in instead of imposed — the fix for the anxious-user risk. |
| **State the methodology inline** | *"As-needed medications are excluded from adherence calculations"* | The headline metric explains itself where it's displayed. |
| **Persistent permission health check** | Alarm optimization, `2 / 3 done` | Permissions aren't a one-time gate; they're a monitored dependency with a re-entry point. |
| **Defer account creation** | Google sign-in only at Back up / Restore | The user signs up when they have something to lose, not before. |

---

## 7. Defects & Risks (ranked)

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | **High** | Progress bar doesn't advance between S3 and S4 | Advance the fill on every committed answer; animate it. |
| 2 | **High** | No back affordance on the first question | Add the back arrow from step 1 (it can exit to splash). |
| 3 | **High** | `Done` overlaps the last row on Optional Details | Add bottom padding = CTA height + 16 dp to the scroll container. |
| 4 | Med | `SET FREQUENCY` label contradicts a count question | Rename the step `YOUR MEDS` or move the count out of this step. |
| 5 | Med | `More than 2 meds` is a lossy bucket | Use a stepper (1–20+); the value drives the schedule UI. |
| 6 | Med | Two different progress-bar languages (dotted vs. segmented) | Unify on one stepper component. |
| 7 | Med | No selected state on single-select cards | Render selection for ~150 ms before transitioning. |
| 8 | Med | `Great!` interstitial costs a tap for no information | Merge into the next screen's header. |
| 9 | Med | Free-text area sits *above* the reason chips | Put chips first; most users will never type. Reveal the textarea on `Custom`. |
| 10 | Med | No post-permission verification | Poll on app resume; show a success or retry state. |
| 11 | Low | Alarm CTA is full-bleed square on the stock screen, pill everywhere else | Normalise. |
| 12 | Low | Emoji as functional iconography | Fine for speed, but emoji render differently per OS version and don't scale with accessibility text settings. Consider a custom icon set for the load-bearing ones. |
| 13 | Low | `changing schedule` chip is lower-case while its siblings are sentence-case | Copy pass. |

**Accessibility notes:** contrast of `text-secondary` on `background` is borderline for WCAG AA at 14 dp. The faded wheel neighbours are decorative but would be announced by a screen reader without care. Touch targets are excellent throughout (nothing below 44 dp). The tap-to-commit pattern is hostile to motor-impaired users with no undo — the missing back button compounds this.

---

## 8. Direct Translation to Re-MIND-eR

### Adopt as-is
1. **Working reminder before data entry.** Create a placeholder med during onboarding, then coach-mark the user into naming it.
2. **Optional Details as a menu.** Your app has more surface than Pillo (Health Vault, Care Circle, dual-channel). Required path must stay at name + dose; everything else becomes an opt-in row with an `Add` button.
3. **Per-feature mini-onboarding.** Upsell → configure → preview → `No thanks`. Reuse this for Health Vault, Care Circle invites, and Telegram fallback.
4. **Deferred, illustrated permission priming.** Your PWA push-permission prompt should follow S12 exactly — after value, with a mockup of the browser prompt and a device caveat line.
5. **Skip-reason chips.** You already track adherence; this feeds it structured data for free, with zero-blame copy.
6. **Preview-the-artefact rule.** Never describe a notification — render it.

### Adapt
- **Your slot-tint idea replaces the mascot as the mood layer.** Warm amber for Morning, neutral bright for Noon, deep indigo for Evening, near-dark for Bedtime. This does the emotional work Pillo does with characters, without a mascot's art budget, and it doubles as a legibility win (a bedtime alarm on a dark ground at 11 pm).
- **Your 5-minute counter — with an important correction.** Pillo **already ships this**, almost exactly as you described it: a 5-minute default, a `+ 1 min` extension, the mascot riding the ring, and an alarm restart on expiry. Your idea is validated but it is not a differentiator on its own, and if you build only what's above you'll ship a straight copy of S36.

  What Pillo does **not** do is vary the instruction by dose form — its timer screen says nothing about *how* to take the med. That gap is your actual edge, and it's a real one: a countdown that says "grab your inhaler — 2 pumps" is doing clinical work, not just applying time pressure. Build the timer, but make the instruction the headline of the screen rather than an afterthought.

  Spec:
  - On `Take now`, transition to a countdown state on the *same* screen (don't navigate).
  - Slot tint stays; add a 5:00 ring or bar. **Don't copy the mascot-on-the-ring device** — that's Pillo's signature and you have no mascot. Use the slot tint's colour as the ring fill instead, deepening as time runs out.
  - Instruction copy switches on `dose_form` — this is the screen's headline, not a caption:
    - `tablet` / `capsule` → "Grab your tablet and a glass of water"
    - `inhaler` → "Grab your inhaler — 2 pumps"
    - `injection` → "Get your shot ready"
    - `liquid` → "Measure your dose and drink"
    - `drops`, `patch`, `topical` → add these; the enum should be complete before you build the copy map.
  - End state: auto-log as taken on countdown completion, with a `Didn't take it` escape available for the full 5 minutes.
- **Role split at screen 1.** Pillo has no caregiver concept, so it doesn't need one. You do — `I'm managing my own meds` / `I'm helping someone else` at the top turns Care Circle from a feature you explain into a path they chose.
- **Elderly Mode inherits the good bones:** 44 dp+ targets, one question per screen, tap-only input, emoji labels. Add a larger type scale and drop the mascot personality escalation (an angry face is a poor choice for an anxious elderly user).
- **The reward loop is the strongest idea in the app — but Care Circle gives you a better version.** Pillo motivates with a charity donation because it has no social layer. You do. A taken dose that notifies a caregiver ("Mum took her 8am") is a stronger and more honest motivator than an abstract Heart, and it costs you no sponsor relationship. Keep the asymmetry, though: reward the taken path visibly, and let the skipped path be quiet rather than scolding.
- **Add Note on the dosing screen.** Trivial to build on your existing schema and it feeds both adherence analytics and the Health Vault. Copy the structure: free text first, with `Severity` / `Condition` / `Measurement` as `+` expanders that never block a quick note.
- **The heatmap calendar with a legend.** Your adherence analytics almost certainly have this data already; Pillo's 5-step density scale with an explicit legend is a cheap, readable way to render a month at a glance.
- **A permission health check screen — you need this more than Pillo does.** Web push on a PWA is far more fragile than an Android foreground service: permission revoked, service worker evicted, iOS requiring install-to-home-screen first, browser-level notification blocks. Build the `Alarm optimization` equivalent as a re-visitable checklist with `n / m done` surfaced in Settings, and have your Telegram fallback prompt reference it when push fails. This is the single highest-value thing in the recording for your architecture.
- **`After the alarm` as an editable pipeline.** You already have escalation logic in the scheduler; exposing it as numbered, toggleable steps with previews turns an opaque backend behaviour into a feature the user can see and trust. It would also make your escalation bugs *visible* to you in the UI.
- **Dose spacing as a safety rule.** Pillo auto-adjusts subsequent doses when one is taken late. Given your race conditions around virtual dose resolution, this is worth thinking about as a product rule before it becomes a support problem.
- **`Share report` for the doctor's visit.** Six export types on a dedicated screen. Your Health Vault already stores documents with permission-based sharing — a "generate a report to bring to your appointment" surface is a small addition on top of infrastructure you've already built, and it's the moment a health app earns its keep.
- **Note the monetisation signal.** Pillo paywalls **Caregivers**, not medication tracking. If Re-MIND-eR ever needs revenue, Care Circle is the feature the market has already decided people will pay for — not the reminders.

### Reject
- **The interstitial encouragement screens.** Pacing padding at 6 am.
- **Bucketed med counts.** Use a real number.
- **The escalating-anger personalities as a default.** ~~Charming for a 25-year-old, potentially distressing for the elderly and chronically ill user your Care Circle targets.~~ **Retracted after the recording:** Pillo already solves this with the three-tier wallpaper picker (Varies over time / Single emotion / Basic), so the user chooses their own emotional register and can opt out of the character entirely. Copy that structure rather than rejecting the feature — but keep `Basic` as the *default* for Elderly Mode rather than an option buried behind a tab.
- **The `Fuming mini` / `Moody` proliferation.** Nine character variants is a lot of art for an MVP. Ship two registers (neutral + encouraging) and add intensity later if retention data asks for it.
- **Emoji as your entire icon system.** Fine for a fast MVP; brittle for a health product that needs consistent rendering.

---

*Compiled from 42 captured screens plus a 3:13 screen recording of the Pillo Android app (v0.6.18), sampled to ~300 deduplicated frames. Measurements are derived from 1080 × 2400 captures and should be verified before being committed as design tokens. Still not captured: the Reschedule/snooze picker, the Log complete screen on the taken path, Safety Reports output, and the Adherence Streak detail behind `Setup`.*
