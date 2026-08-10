# android-app

Capacitor shell for the reminder-health Android app. See root [`CLAUDE.md`](../CLAUDE.md)'s
"Android conversion (Capacitor)" section for the full plan — this file only covers what's
specific to this directory.

## What this is (and isn't)

`capacitor.config.json`'s `server.url` points the native WebView at the **deployed** site
(`https://reminder-health.vercel.app`), not at anything built here. `www/` is a required-but-
unused placeholder — Capacitor's CLI needs `webDir` to point at a real directory, but the
WebView navigates straight to `server.url` at runtime and never serves `www/index.html`.

This is **not** a TWA (the abandoned `android-twa/` at the repo root). The native bridge stays
live on the loaded page — the deployed site's JS can call Kotlin plugins (see
`android/app/src/main/java/com/reminderhealth/app/PingPlugin.kt`). The alarm core (M2) will be
pure native and never depend on this WebView being open.

`capacitor.config.json` is JSON, not TS — `@capacitor/cli` 7.6.8's on-the-fly TypeScript config
loader is incompatible with the TypeScript version currently on npm (an internal
`ts.ModuleKind.CommonJS` lookup fails). JSON sidesteps that entirely; there's no computed config
here anyway, so nothing is lost. Revisit `.ts` config if `@capacitor/cli` ships a fix.

**Kotlin is not in Capacitor's default Android template** (it's Java-only until you add it) —
manually wired in via `android/build.gradle` (`ext.kotlin_version = '2.1.0'` +
`kotlin-gradle-plugin` classpath) and `android/app/build.gradle` (`apply plugin: 'kotlin-android'`
+ `kotlin-stdlib`). If Android Studio flags an AGP 8.7.2 / Kotlin 2.1.0 compatibility warning on
first open, bump `kotlin_version` to whatever it suggests — nothing else depends on the exact
patch version.

## Setup — this machine has no JDK/Android SDK yet (as of 2026-08-10)

Scaffolding is done and committed; it hasn't been built or run. Once Android Studio is installed
(bundles a JDK and lets you install the SDK — target **compileSdk 35 / minSdk 23**, matching
`android/variables.gradle`):

```bash
cd android-app
npm install                # if node_modules isn't already present
npx cap sync android       # re-run after any capacitor.config.json or plugin change
npx cap open android       # opens android/ in Android Studio
```

**Don't re-run `npx cap add android`** — it would overwrite `MainActivity.java` and both
`build.gradle` files (the Kotlin wiring above) with the stock template. `android/` already has
its own `.gitignore` from the Capacitor template (`build/`, `.gradle/`, `local.properties`,
`*.iml`, keystores, etc.) — only source is tracked.

Build/run from Android Studio (simplest — it'll offer to download any missing SDK platform), or
`cd android && ./gradlew assembleDebug` from a shell once `ANDROID_HOME`/`local.properties`
points at an installed SDK.

## Icon/splash — placeholder, not final branding

Generated via `npx capacitor-assets generate --android` from `assets/icon.png` +
`assets/icon-foreground.png` (both copies of the existing PWA icons in `web/public/`, not
dedicated adaptive-icon art — the safe-zone padding adaptive icons expect isn't there, so the
launcher icon may look slightly cropped). Good enough to not ship the generic default Capacitor
icon for M1; real mascot-based icon/splash art is a natural fit for the **UI Redesign** phase
(see `CLAUDE.md`) once its tokens are chosen — re-run the same `capacitor-assets generate`
command with updated `assets/` sources when that happens. `@capacitor/assets` is a devDependency
for exactly that reuse.

`npm install -D @capacitor/assets` pulled in `sharp`/`minimatch`/`tar` and other transitive deps
that `npm audit` flags with 9 advisories (1 critical, in `tar`) — all in `@capacitor/assets`'
own dependency tree (`@trapezedev/project` → `replace`/`xcode`), all currently **"No fix
available"** upstream, and none reachable outside manually running `capacitor-assets generate`
locally — this never runs in CI, ships in the app, or touches the Play Store artifact. Not
urgent; re-check with `npm audit` next time `@capacitor/assets` gets bumped.

## Bridge proof (M1 deliverable) — scaffolded, not yet verified

`PingPlugin.kt` is a trivial native plugin with one method (`ping`). `MainActivity.java` calls it
via `evaluateJavascript` once the page finishes loading (a custom `BridgeWebViewClient` override),
entirely from native code — this proves the JS↔native round trip on the **deployed** page without
requiring any change to `web/`. To verify once it runs on a device/emulator: `adb logcat | grep
Ping` (or the Logcat pane in Android Studio) should show `[Ping] native replied: pong: hello from
webview` shortly after the app opens. Delete `PingPlugin.kt` and the `MainActivity.java` override
once this is confirmed and M2's real plugins (`syncSchedule`, `setSession`, `getPendingActions`)
exist — this was only ever meant to prove the bridge works, not to ship.
