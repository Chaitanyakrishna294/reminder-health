---
name: ux-copy
description: Re-MIND-eЯ's copy constitution. Use on ANY change that adds or edits user-facing words — UI labels, buttons, headings, toasts, errors, empty states, notification text, native alarm strings, or anything Remi says. Enforces sentence case, zero-blame language, the elderly plainest register, no emoji, and the never-imply-medical-verification rule.
---

# Copy rules for Re-MIND-eЯ

These are decisions, not preferences. The audience is Indian patients and their
caregivers, often elderly, often anxious, reading a screen about medication they
may have just missed. Every rule below exists because the alternative hurts
someone.

Apply to: buttons, headings, body, toasts, errors, empty states, notification
titles/bodies, `strings.xml` for the native alarm, and every line Remi speaks.

## 1. Sentence case everywhere

- "Add your first medicine", never "Add Your First Medicine". **Buttons included.**
- Capitals are for names and the start of sentences. **Never for emphasis** — that
  is what weight is for.
- **The one exception:** uppercase mono is a *structural wayfinding label* —
  `MORNING`, `DUE NOW`, `CARE CIRCLE`. It is **never a full sentence**. If a label
  grows into a sentence, it stops being an eyebrow and takes sentence case with it.

## 2. Zero-blame — report, never scold

The screen states what happened. It does not editorialise about the person.

- ✅ "Missed · due 13:00"  ❌ "You forgot this dose"
- ✅ "3 of 7 taken today"  ❌ "You've only taken 3!"
- ✅ "Skipped"  ❌ "Skipped again"
- **No guilt framing on missed doses, ever.** No "still", "again", "only", "but",
  exclamation marks, or streak-loss language on a failure path.
- Skipping is a **legitimate answer**, not a failure. Never colour it as an error
  or word it as a lapse.
- Asymmetry is deliberate: reward the taken path visibly, let the skipped path be
  quiet. Quiet is not the same as disapproving.

## 3. Elderly mode: the plainest register

- Short **direct sentences**. One idea per sentence.
- **No jokes. No questions.** "Can I wake you?" becomes "I need permission to show
  alarms."
- **Remi shows; Remi does not chat.** In elderly mode Remi appears only at welcome,
  celebration, and offline reassurance — and says less everywhere.
- No idiom, no wordplay, no cleverness. Specific beats clever generally; in elderly
  mode it is the only option.

## 4. No emoji in interface copy

- Not in labels, toasts, headings, notification text, or button text.
- **Emotion is Remi's job.** A 🎉 in a success message is the mascot's line spoken
  by someone else.
- Emoji currently used as *dose icons* are v1 placeholders being replaced by the
  icon set — that is iconography, not copy, and is tracked separately.

## 5. Never imply the app verifies medical correctness

This is the disclaimer as a copy rule, and it is the one with legal weight.

- The app **does not check** what the user entered. Never write copy that suggests
  it validates a dose, a schedule, an interaction, or a drug name.
- ❌ "Correct dose"  ❌ "Verified"  ❌ "Safe to take"  ❌ "Your schedule looks right"
- ✅ "1 tablet · 08:30" — state what the user entered, attributed to them.
- Never recommend, adjust, or interpret medication. Reminder tool only.
- When a dose cannot be recorded, say so honestly: it will show as missed. Do not
  soften it into ambiguity.

## 6. Errors explain and offer a way out

- What went wrong, then what to do. No apologies, no vagueness, no blame.
- ✅ "Can't reach the internet · your alarms still work" + Retry
- ❌ "Something went wrong"
- If the app is at fault, the app owns it — that is the one place Remi's `sorry`
  expression belongs.

## Checklist before finishing any copy change

1. Sentence case, including buttons?
2. Any uppercase that is a *sentence* rather than a structural label?
3. Any word that blames, nags, or counts failures back at the user?
4. Would this read plainly to an anxious 70-year-old?
5. Any emoji?
6. Does anything imply the app checked the medicine?
