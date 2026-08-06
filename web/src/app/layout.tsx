import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { UiModeProvider } from "@/context/ui-mode-context";
import { ThemeProvider } from "@/context/theme-context";
import CookieConsent from "@/components/cookie-consent";
import InstallPrompt from "@/components/install-prompt";
import RegisterSW from "@/components/register-sw";

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
      </head>
      <body className="min-h-full flex flex-col">
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
