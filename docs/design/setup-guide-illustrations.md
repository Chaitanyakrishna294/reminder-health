# Setup guide illustrations — generation prompts

Per [[mascot-asset-workflow]]: Claude writes the prompts, the maintainer generates and
drops the PNGs, Claude compresses them in place with sharp.

**Drop generated files at** `web/public/setup/` as the filenames given below.
They are not wired into the UI yet — `setup-step-card.tsx` renders the numbered steps
and the green "how you know it worked" line. Wiring is one `<Image>` per item once the
assets exist.

---

## Why illustrations at all

The guide's failure mode is not that the words are wrong — they were verified on a real
vivo. It is that **someone unfamiliar with a phone cannot tell when they have arrived at
the right screen.** Android settings screens all look alike: a white list of grey rows.
A picture of the destination turns "did I get there?" from a memory question into a
matching question, and matching is the thing this audience can actually do.

So these are **destination pictures, not step-by-step comics.** One image per setup
item, showing the screen the user is trying to reach, with the one control they must
change made obvious. Four images total.

---

## Constraints that apply to every prompt

- **Not a real screenshot, and not pretending to be.** A stylised, simplified rendering
  of an Android settings screen. A real screenshot of one phone misleads owners of
  every other phone, and screenshots age badly with OS updates.
- **No brand marks.** No Google, vivo, iQOO or Android logos, no manufacturer skins.
- **No readable body text.** Row labels are neutral grey bars, EXCEPT the one row that
  matters, which carries its real English label. Text baked into an image cannot be
  translated for the Hindi/Telugu phase, so the less of it the better.
- **Palette from our tokens**, not Android's: paper ground `#F6F2F5`, card `#FFFFFF`,
  ink `#0F1C5A`, the highlight accent `#CC3D64`, the "on" switch `#1E8E5A`.
- **Flat, sticker-style, no gradients, no drop shadows, no 3D.** Same rendering law as
  Remi — these sit on the same page as the mascot and must not look imported.
- **Light mode only.** Elderly mode is always light, and this guide matters most there.
- **Square, 1024×1024**, transparent or `#F6F2F5` background.
- **No Remi.** He is not a narrator here; the mascot's slots are the empty state, the
  dialog and the guide bubble (`MASCOT_SLOTS`). A character pointing at settings would
  make a serious screen look playful.

---

## 1 — `web/public/setup/notifications.png`

> A flat vector illustration of a simplified Android phone settings screen, viewed
> straight on. Light background `#F6F2F5`, white rounded card filling most of the
> frame. At the top, a small app icon square and the title row. Below it a vertical
> list of five settings rows: four rows are plain light-grey placeholder bars with no
> readable text. The FIRST row is highlighted — it has a soft pink `#CC3D64` outline at
> 2px, the label "Notifications" in dark navy `#0F1C5A`, and a toggle switch on its
> right shown in the ON position, filled green `#1E8E5A` with the knob to the right.
> Flat colours only, no gradients, no shadows, no 3D, no logos, no photorealism.
> Clean geometric shapes, generous spacing, thick rounded corners.

## 2 — `web/public/setup/exact-alarms.png`

> A flat vector illustration of a simplified Android "Alarms & reminders" permission
> screen. Light `#F6F2F5` background, white rounded card. At the top a small alarm-clock
> glyph in dark navy `#0F1C5A` and the heading text "Alarms & reminders". Below, a list
> of three app rows, each with a small rounded-square app icon on the left and a toggle
> on the right. The top row is highlighted with a 2px pink `#CC3D64` outline and its
> toggle is ON, filled green `#1E8E5A`. The other two rows are plain grey placeholder
> bars with grey toggles in the OFF position. Flat colours, no gradients, no shadows,
> no brand logos, no readable text except the heading.

## 3 — `web/public/setup/battery.png`

> A flat vector illustration of a simplified Android app battery settings screen. Light
> `#F6F2F5` background, white rounded card. At the top a simple battery glyph in dark
> navy `#0F1C5A`. Below it a group of three radio-button options stacked vertically. The
> options read "Unrestricted", "Optimised" and "Restricted" in dark navy. The FIRST
> option, "Unrestricted", is selected — its radio button is filled pink `#CC3D64` and the
> whole row carries a soft pink 2px outline. The other two rows have empty grey radio
> circles. Flat colours only, no gradients, no shadows, no 3D, no logos.

## 4 — `web/public/setup/autostart.png`

> A flat vector illustration of a simplified Android "Autostart" settings screen. Light
> `#F6F2F5` background, white rounded card. At the top the heading "Autostart" in dark
> navy `#0F1C5A`. Below, a vertical list of four app rows, each with a small rounded
> square app icon on the left and a toggle switch on the right. The SECOND row is
> highlighted with a 2px pink `#CC3D64` outline and its toggle is ON, filled green
> `#1E8E5A`; the other three rows are plain grey placeholder bars with grey toggles in
> the OFF position. Flat colours, no gradients, no shadows, no logos, no readable text
> except the heading.

---

## After generating

1. Drop the four PNGs into `web/public/setup/`.
2. Tell Claude — the files get compressed in place with sharp (same as the mascot set),
   then wired into `setup-step-card.tsx` as one image per item, `aria-hidden` with the
   steps remaining the accessible source of truth. **The illustration is a confirmation
   aid, never the instruction** — a picture nobody can read aloud is not a step.
