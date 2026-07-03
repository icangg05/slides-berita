import type { Metadata, Viewport } from "next";
import { Sen, DM_Sans } from "next/font/google";
import "./globals.css";

// Sen — assertive, modern headings (PRD tipografi).
const sen = Sen({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-sen",
  display: "swap",
});

// DM Sans — high-legibility body text on a large panel.
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kendari News Kiosk — Diskominfo Kota Kendari",
  description:
    "Papan informasi digital berita terkini Kota Kendari — dikelola oleh Dinas Komunikasi dan Informatika Kota Kendari.",
  robots: { index: false, follow: false },
};

// Locked portrait signage viewport — no user zoom on the kiosk panel.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. ColorZilla adds
    // `cz-shortcut-listen` to <body>) inject attributes before React hydrates,
    // which would otherwise trip a hydration mismatch warning.
    <html
      lang="id"
      className={`${sen.variable} ${dmSans.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
