import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FocusX",
  description: "FocusX API and admin panel",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
