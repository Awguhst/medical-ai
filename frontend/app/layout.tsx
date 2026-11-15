import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
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

/**
 * The backend address is a runtime setting of the server (API_URL), not a
 * build-time constant, so the same image can be pointed at any backend. The
 * layout renders per request and hands the value to the browser in an inline
 * script, which lib/api.ts reads before each call.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const apiUrl = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "").trim();
  const config = `window.__MEDAI_API_URL__=${JSON.stringify(apiUrl).replace(/</g, "\\u003c")};`;
  return (
    <html lang="bg">
      <body>
        {apiUrl && <script id="medai-config" dangerouslySetInnerHTML={{ __html: config }} />}
        {children}
      </body>
    </html>
  );
}
