/**
 * LANDING PAGE CONFIG — the facts that change, in one place.
 *
 * ── THE NAME ──
 *
 * The landing page ships as **Remily** (maintainer's decision, 2026-08-21,
 * "non-negotiable"). The rest of the product is still `Re-MIND-eЯ`: 65
 * references across the repo, and it is the Android `app_name` and the Play
 * listing title.
 *
 * **That seam is real and is not hidden here.** Someone who installs from a
 * Remily page currently lands in an app called Re-MIND-eЯ. Keeping the name in a
 * constant is what makes the eventual rename a sweep rather than a rebuild — and
 * what stops a half-done rename from leaving two names inside one page.
 */
export const BRAND = 'Remily';

/**
 * ── THE DOWNLOAD — GitHub release asset (decided 2026-08-21) ──
 *
 * The URL below is **already final and never needs editing again**, because
 * `/releases/latest/download/<asset>` is GitHub's stable alias: it always serves
 * the newest published release's asset with that filename. Ship v1, v2, v9 — the
 * link on this page stays the same. That is the property that made this the right
 * host over Supabase Storage, alongside free bandwidth on a public repo (verified
 * public: release assets download with no auth) and zero new RLS surface, which
 * matters in a repo whose storage policies have drawn blood twice.
 *
 * **THE ASSET MUST BE NAMED EXACTLY `remily.apk`.** The alias resolves by
 * filename, so a release whose asset is called `app-release.apk` or
 * `remily-v1.0.apk` will 404 this link while looking perfectly fine in the
 * GitHub UI. Rename on upload.
 *
 * **A PRE-RELEASE IS NOT "LATEST".** GitHub excludes pre-releases from that
 * alias. If the closed-test build is published with the pre-release box ticked,
 * this URL 404s. Publish it as a normal release, or point at the tag directly.
 */
export const DOWNLOAD_URL =
  'https://github.com/Chaitanyakrishna294/reminder-health/releases/latest/download/remily.apk';

/**
 * ── AND THE FLAG THAT KEEPS IT HONEST ──
 *
 * **There are zero releases on the repo today** — checked against the API, not
 * assumed. So the URL above currently 404s, and a download button pointing at a
 * 404 is the exact failure this page refuses everywhere else.
 *
 * Code cannot know whether the asset exists without a network call, so this is a
 * deliberate manual flag: **flip it to `true` the moment the first release is
 * published, and change nothing else.** The URL is already right.
 *
 * It is a plain constant rather than an env var on purpose. An env var flips
 * invisibly and fails silently on a typo; a constant is a diff somebody reviews —
 * and this repo has already paid once for a value piped into `vercel env add`
 * that arrived subtly wrong and broke a thing while looking configured.
 */
export const DOWNLOAD_READY = false;

/** Where the primary action goes while there is no APK. */
export const WEB_APP_HREF = '/install';

/**
 * The single citation on the page.
 *
 * The brief asked for figures "from the research evidence pack with real
 * citations baked in". **There is no evidence pack in this repo** — `docs/`
 * contains zero DOIs and zero citations; that was checked, not assumed. So
 * rather than a placeholder (which the brief rightly forbids) or an invented
 * number, exactly ONE figure appears, and it is one anybody can verify against a
 * primary source.
 */
export const ADHERENCE_SOURCE = {
  claim: 'About half of people on long-term medication do not take it as prescribed.',
  cite: 'WHO, Adherence to Long-Term Therapies (2003)',
  href: 'https://iris.who.int/handle/10665/42682',
} as const;

/**
 * THE SCROLL STORY — one day of doses.
 *
 * The times are the narrative device from the motion reference, but the COLOURS
 * are ours: each section is tinted from the app's own slot palette, the same four
 * hues the day rail uses to bucket doses into morning / midday / evening / night.
 * The reference invented a dawn-to-night palette; we already had one that means
 * something, so the story is told in the product's own colours.
 *
 * `tint` is the percentage of the slot hue mixed into the page ground — small
 * numbers on purpose. These are SURFACES, and the one-accent rule still holds:
 * nothing here is touchable, so nothing here is pink.
 */
/**
 * TINT DEPTHS ARE CAPPED BY CONTRAST, NOT BY TASTE.
 *
 * The first pass used 26% on `gap` and 24% on `reliability` to deepen the day as
 * it wore on. Measured, both failed the 4.5:1 floor: the WHO citation link came
 * out at 4.18 and the reliability lede at 4.07, because `--muted-foreground` and
 * `--primary-strong` are tuned against `--background`, and mixing a slot hue into
 * the ground darkens what they sit on.
 *
 * So the narrative is carried by HUE, not by saturation — morning, midday,
 * evening and night are already four different colours, which is the story. Any
 * new section keeps its tint in this range unless its text is re-measured.
 */
export const SECTIONS = [
  { id: 'top', time: '07:00', label: 'wake', slot: 'morning', tint: 14 },
  { id: 'gap', time: '09:00', label: 'the gap', slot: 'morning', tint: 16 },
  { id: 'how', time: '13:00', label: 'how it works', slot: 'midday', tint: 14 },
  { id: 'features', time: '17:00', label: 'what is inside', slot: 'evening', tint: 12 },
  { id: 'reliability', time: '20:00', label: 'reliability', slot: 'evening', tint: 15 },
  { id: 'get', time: '23:00', label: 'get it', slot: 'night', tint: 100 },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** The ground for a section, mixed from the frozen slot token. */
export function sectionGround(slot: string, tint: number): string {
  if (tint >= 100) return `var(--slot-${slot})`;
  return `color-mix(in oklab, var(--slot-${slot}) ${tint}%, var(--background))`;
}
