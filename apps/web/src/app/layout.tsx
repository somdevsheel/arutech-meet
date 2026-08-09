import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arutech Meet",
  description: "Video meetings, online classrooms, and calls — by Arutech Consultancy Services LLP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
