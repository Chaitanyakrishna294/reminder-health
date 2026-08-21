/**
 * THE LANDING PAGE'S ONE CONFIGURABLE FACT: where "get the app" goes.
 *
 * It lives here, alone, because the blueprint's rule is that the download link is
 * never written into page copy — Play-Store day has to be a one-line change, not a
 * hunt through markup.
 *
 * ── WHY IT POINTS AT THE PWA TODAY, AND WHY THAT NEEDS A CAVEAT ──
 *
 * There is no APK. No `.apk` exists in this repo, the Play Console is unpaid and
 * the closed test has not run, so a "Download for Android" button would point at
 * nothing. `/install` is real and works today: the Progressive Web App, added to
 * the home screen.
 *
 * **But the web app does NOT have the native alarms the page headlines.** Exact
 * alarms, the full-screen alarm activity, ringing offline with the process dead
 * and re-arming after a reboot — all of that is Kotlin, and it ships only in the
 * Android build. The web version's reminders come from the server pipeline and
 * need a connection.
 *
 * So the page states that difference at the point of decision rather than burying
 * it. A landing page that lets someone install the web app believing they have
 * offline alarms has mis-sold the one promise the product is built around, and the
 * person who finds out is a patient at 3am.
 */

/** Where the primary call to action goes. Swap on Play-Store day. */
export const APP_CTA_HREF = '/install';

/** The primary action's label. Sentence case (ux-copy §1). */
export const APP_CTA_LABEL = 'Add to home screen';

/**
 * True once `APP_CTA_HREF` points at a real Android build. Flipping this is what
 * removes the "web version" caveat from the hero and the install section — the
 * caveat and the link are one decision, so they are one flag.
 */
export const ANDROID_BUILD_AVAILABLE = false;

/**
 * The single citation on the page. The blueprint requires every number to cite a
 * source; this repo has no evidence pack, so exactly one figure is quoted and it
 * is one anybody can verify.
 */
export const ADHERENCE_SOURCE = {
  claim: 'About half of people on long-term medication do not take it as prescribed.',
  cite: 'World Health Organization, Adherence to Long-Term Therapies: Evidence for Action (2003)',
  href: 'https://iris.who.int/handle/10665/42682',
} as const;
