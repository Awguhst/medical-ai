import type { Metadata, Viewport } from "next";
import "@fontsource-variable/golos-text";
import "@fontsource-variable/manrope";
import "./globals.css";

import { PREFERENCE_BOOT_SCRIPT } from "@/lib/preferences";

export const metadata: Metadata = {
  // The title is rendered by ChatInterface (React hoists it into <head>) so it
  // follows the interface language; a static title here would override it.
  description:
    "МедAI е AI асистент за обща медицинска информация на български и английски език с експериментален анализ на рентгенови снимки.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0d0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang and data-theme are rewritten on the client from the stored preferences
  // (by the boot script before paint, then by the app), hence the suppressed warning.
  return (
    <html lang="bg" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: PREFERENCE_BOOT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
