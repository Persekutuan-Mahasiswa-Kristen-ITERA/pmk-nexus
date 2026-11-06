import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PMK-NEXUS",
  description: "Administration and operations system of PMK ITERA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
