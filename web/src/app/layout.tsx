import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Gambit — Play Chess",
  description:
    "A fast C++ chess engine compiled to WebAssembly, wrapped in a clean React board. Play in your browser, fully offline.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <Navbar />
        {children}
      </body>
    </html>
  );
}
