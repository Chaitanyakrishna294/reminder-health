import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { UiModeProvider } from "@/context/ui-mode-context";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* Apply saved theme before paint to avoid a flash of the wrong theme.
            The no-saved-theme fallback MUST stay in lockstep with
            getTimeBasedTheme() in context/theme-context.tsx (dark 7 PM–7 AM).
            It previously seeded from prefers-color-scheme, so on an OS set to
            dark at midday this script painted dark and ThemeProvider then
            corrected it to light — the very flash it exists to prevent. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light'){var h=new Date().getHours();t=(h>=19||h<7)?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}else{document.documentElement.style.colorScheme='light';}}catch(e){}})();`,
          }}
        />
        {/* PWA launch handoff, before paint for the same reason as the theme script:
            /launch.html forwards here with ?launch=1, and this attribute makes the
            LaunchHandoff overlay (the same splash scene) visible from the FIRST frame —
            no gap between the splash page and the still-loading dashboard. The overlay
            removes the attribute once the window has fully loaded. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(/[?&]launch=1(&|$)/.test(location.search))document.documentElement.setAttribute('data-launching','1');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <LaunchHandoff />
        <ThemeProvider>
          <UiModeProvider>
            {children}
            <RegisterSW />
            <InstallPrompt />
            <CookieConsent />
          </UiModeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
