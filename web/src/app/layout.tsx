import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import {
  Inter,
  JetBrains_Mono,
  Noto_Sans_Devanagari,
  Noto_Sans_Telugu,
  Noto_Sans_Tamil,
  Noto_Sans_Kannada,
  Noto_Sans_Malayalam,
} from "next/font/google";
import "./globals.css";
import { UiModeProvider } from "@/context/ui-mode-context";
import { DensityProvider } from "@/context/density-context";
import DensityPreviewBadge from "@/components/dev/density-preview-badge";
import { ThemeProvider } from "@/context/theme-context";
import { LanguageProvider } from "@/context/language-context";
import { getServerLocale } from "@/lib/i18n/server";
import { LOCALE_META } from "@/lib/i18n/locales";
import CookieConsent from "@/components/cookie-consent";
import InstallPrompt from "@/components/install-prompt";
import RegisterSW from "@/components/register-sw";
import LaunchHandoff from "@/components/launch-handoff";

// Variable fonts: one file per family covers every weight (vs 12 static files).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

/**
 * INDIC GLYPH COVERAGE. Inter has none — not one Devanagari, Telugu, Tamil, Kannada
 * or Malayalam codepoint. Without these five families the six Indian languages fall
 * through to whatever `sans-serif` resolves to, which is usually fine on Android and
 * Windows and is tofu boxes wherever it is not. "Usually fine" is not a floor for the
 * screen an elderly user reads their language list on.
 *
 * COSTS NOTHING TO ENGLISH USERS. Each family is emitted with only its own script
 * subset, so the CSS carries a `unicode-range` the browser matches before it fetches
 * anything: an English page never requests a single one of these files.
 * `preload: false` is the other half of that — a preload link would fetch them
 * eagerly and undo it. `display: 'swap'` so text is readable while a face loads,
 * rather than invisible.
 *
 * Five families cover six languages: Hindi and Marathi share Devanagari.
 */
const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-indic-devanagari",
  subsets: ["devanagari"],
  display: "swap",
  preload: false,
});

const notoTelugu = Noto_Sans_Telugu({
  variable: "--font-indic-telugu",
  subsets: ["telugu"],
  display: "swap",
  preload: false,
});

const notoTamil = Noto_Sans_Tamil({
  variable: "--font-indic-tamil",
  subsets: ["tamil"],
  display: "swap",
  preload: false,
});

const notoKannada = Noto_Sans_Kannada({
  variable: "--font-indic-kannada",
  subsets: ["kannada"],
  display: "swap",
  preload: false,
});

const notoMalayalam = Noto_Sans_Malayalam({
  variable: "--font-indic-malayalam",
  subsets: ["malayalam"],
  display: "swap",
  preload: false,
});

const FONT_VARIABLES = [
  inter.variable,
  jetbrainsMono.variable,
  notoDevanagari.variable,
  notoTelugu.variable,
  notoTamil.variable,
  notoKannada.variable,
  notoMalayalam.variable,
].join(" ");

export const metadata: Metadata = {
  title: "Re-MIND-eЯ | Healthcare Companion",
  description:
    "Your calm, intelligent healthcare companion. Medication tracking, medication progress tracking, and caregiver coordination. Secure and always present.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

// `viewportFit: 'cover'` is what makes env(safe-area-inset-*) resolve to anything other
// than 0. The floating bottom dock and the install FAB both sit in the region a phone's
// home indicator occupies, so without this the last card on every scrolling page ends up
// underneath them on notched devices.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request nonce set by proxy.ts. Reading headers() here also opts the whole app into
  // dynamic rendering — required for nonce-based CSP (the nonce must be fresh per request).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // From the `language` cookie. Free to read — this layout already awaits headers()
  // for the nonce, so every route is dynamic regardless. Rendering the right `lang`
  // and the right copy server-side is what removes the flash of English.
  const locale = await getServerLocale();
  return (
    <html
      lang={LOCALE_META[locale].htmlLang}
      suppressHydrationWarning
      className={`${FONT_VARIABLES} h-full antialiased`}
    >
      <head>
        {/* Apply saved theme before paint to avoid a flash of the wrong theme.
            Default when nothing is saved is LIGHT — must stay in lockstep with
            context/theme-context.tsx, which also defaults to light. Only a saved
            'dark' choice paints dark; anything else paints light.
            nonce: required so the strict CSP (no 'unsafe-inline') allows this inline script. */}
        {/* suppressHydrationWarning on BOTH nonce'd scripts: browsers hide the
            nonce content attribute (it reads back as ""), so React's hydration
            diff always sees client "" vs server nonce and logs a false
            mismatch. Nothing is actually wrong — the scripts already ran. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('theme')==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}else{document.documentElement.style.colorScheme='light';}}catch(e){}})();`,
          }}
        />
        {/* THE LANGUAGE MIGRATION SCRIPT — and it is only that.
            `lang` is now rendered server-side from the cookie, so the ordinary path
            needs no script at all. This covers one case: somebody who chose a
            language before the cookie existed has localStorage and no cookie, so the
            server rendered them English. Stamping `lang` before paint keeps the Indic
            font and the screen-reader voice right for that one render; the provider
            then writes the cookie and every later request is server-correct.
            Delete this once enough time has passed that no live user is cookie-less.
            Keep the key and the tag list in lockstep with lib/i18n/locales.ts. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(/(^|; )language=/.test(document.cookie))return;var l=localStorage.getItem('language');if(l&&['en','hi','te','ta','kn','ml','mr'].indexOf(l)>-1)document.documentElement.lang=l;}catch(e){}})();`,
          }}
        />
        {/* PWA launch handoff, before paint for the same reason as the theme script:
            /launch.html forwards here with ?launch=1&s=<start>. The attribute makes
            the LaunchHandoff overlay (the same brand-assembly scene) visible from the
            FIRST frame, and --lh-seek is a NEGATIVE animation-delay that fast-forwards
            it to wherever the splash page had got to — without it the animation would
            visibly restart at the handover. 1400ms must match DURATION in
            launch-handoff.tsx and --dur in launch.html. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(!/[?&]launch=1(&|$)/.test(location.search))return;var d=document.documentElement;d.setAttribute('data-launching','1');var m=/[?&]s=(\\d+)/.exec(location.search);if(m){var e=Date.now()-Number(m[1]);if(e>0)d.style.setProperty('--lh-seek',(-Math.min(e,1400))+'ms');}}catch(e){}})();`,
          }}
        />
        {/* THE DENSITY SPLIT's first-paint half — same reason as the theme script
            above. The server cannot know it is rendering into the Capacitor
            webview, so every page streams the BROWSER density; without this the
            app's home screen would visibly collapse to the app density the moment
            React hydrated. This stamps data-density before paint, and one rule in
            globals.css hides `.browser-only` while it says "app".

            It is an APPROXIMATION, corrected by DensityProvider within the first
            commit — it cannot know about elderly at all, and it learns "this is
            the app" from a flag the provider wrote on a previous load (Capacitor
            injects window.Capacitor too late to rely on here), so the very first
            launch after install still flashes once. Ordered: an explicit
            ?preview= wins, then the remembered flag. Keep the storage keys in
            lockstep with lib/design/density.ts. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement,o=null,m=/[?&]preview=(app|browser)(&|$)/.exec(location.search);if(m){o=m[1];try{sessionStorage.setItem('previewDensity',o);}catch(e){}}else{try{var s=sessionStorage.getItem('previewDensity');if(s==='app'||s==='browser')o=s;}catch(e){}}var n=false;try{n=!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());}catch(e){}if(!n){try{n=localStorage.getItem('isNativeApp')==='1';}catch(e){}}d.setAttribute('data-density',o?o:(n?'app':'browser'));}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <LaunchHandoff />
        {/* Outermost, because every other provider's subtree may need a label. */}
        <LanguageProvider initialLocale={locale}>
          <ThemeProvider>
            <UiModeProvider>
              {/* Inside UiModeProvider: elderly outranks every other density. */}
              <DensityProvider>
                {children}
                <RegisterSW />
                <InstallPrompt />
                <CookieConsent />
                {/* Renders only while ?preview= is forcing a density. */}
                <DensityPreviewBadge />
              </DensityProvider>
            </UiModeProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
