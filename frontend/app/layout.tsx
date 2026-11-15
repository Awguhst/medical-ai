import type { Metadata, Viewport } from "next";
import "@fontsource-variable/golos-text";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedAI Bulgaria: AI медицински асистент",
  description:
    "МедAI е AI асистент за обща медицинска информация на български език с експериментален анализ на рентгенови снимки.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0d0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  );
}
