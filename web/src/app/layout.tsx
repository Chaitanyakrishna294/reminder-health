import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { UiModeProvider } from "@/context/ui-mode-context";
import { DensityProvider } from "@/context/density-context";
import DensityPreviewBadge from "@/components/dev/density-preview-badge";
import { ThemeProvider } from "@/context/theme-context";
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
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
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
      </body>
    </html>
  );
}
