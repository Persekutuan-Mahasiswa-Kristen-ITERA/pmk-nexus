import type { Metadata } from "next";
import { Playfair_Display, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Stitch fonts (D-014): Playfair Display for titles, Plus Jakarta Sans for body, forms and data.
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-playfair",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "PMK-NEXUS", template: "%s | PMK-NEXUS" },
  description: "Sistem administrasi dan operasional PMK ITERA",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PMK-NEXUS",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/brand/pmk-logo-96.png", type: "image/png", sizes: "96x96" }],
    apple: [{ url: "/brand/pmk-logo-192.png", type: "image/png", sizes: "192x192" }],
  },
};

export const viewport = {
  themeColor: "#5C3A21",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${playfair.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
