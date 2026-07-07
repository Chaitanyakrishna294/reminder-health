import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { UiModeProvider } from "@/context/ui-mode-context";
import { ThemeProvider } from "@/context/theme-context";
import CookieConsent from "@/components/cookie-consent";
import InstallPrompt from "@/components/install-prompt";

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
        {/* Apply saved theme before paint to avoid a flash of the wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <UiModeProvider>
            {children}
            <InstallPrompt />
            <CookieConsent />
          </UiModeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
