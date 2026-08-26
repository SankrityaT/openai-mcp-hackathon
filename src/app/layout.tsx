import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Newsreader } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});

const geistPixel = localFont({
  src: "./fonts/geist-pixel-latin.woff2",
  variable: "--font-geist-pixel",
  weight: "400",
  style: "normal",
  display: "swap",
  preload: false,
  fallback: ["monospace"],
});

export const metadata: Metadata = {
  title: "Cardea | Your Canvas Beyond the Prompt",
  description:
    "Cardea turns complex goals into living workspaces where you can watch, steer, and approve coordinated work across the web.",
  applicationName: "Cardea",
  keywords: ["Cardea", "agent workspace", "WebMCP", "human in the loop"],
  openGraph: {
    title: "Cardea | Your Canvas Beyond the Prompt",
    description:
      "Turn any goal into a living workspace. Watch, steer, and approve coordinated work across the web.",
    type: "website",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F0E8" },
    { media: "(prefers-color-scheme: dark)", color: "#11110F" },
  ],
};

const themeScript = `
  try {
    const saved = localStorage.getItem("cardea-theme");
    const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = saved === "dark" || saved === "light" ? saved : system;
  } catch (_) {
    document.documentElement.dataset.theme = "light";
  }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${newsreader.variable} ${geistPixel.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
