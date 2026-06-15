import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { UiModeProvider } from "@/context/ui-mode-context";
import CookieConsent from "@/components/cookie-consent";
import InstallPrompt from "@/components/install-prompt";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Re-MIND-eЯ | Healthcare Companion",
  description:
    "Your calm, intelligent healthcare companion. Medication tracking, medication progress tracking, and caregiver coordination — secure and always present.",
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
      <body className="min-h-full flex flex-col">
        <UiModeProvider>
          {children}
          <InstallPrompt />
          <CookieConsent />
        </UiModeProvider>
      </body>
    </html>
  );
}
