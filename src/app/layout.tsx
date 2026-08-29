import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Geist, Newsreader } from "next/font/google";
import localFont from "next/font/local";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteOrigin } from "@/core/agent-surface/site";
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
  // `metadataBase` resolves every relative metadata URL (canonical, Open
  // Graph) against this deployment's own origin, so a preview build does not
  // advertise production URLs.
  metadataBase: new URL(siteOrigin()),
  title: `${SITE_NAME} | ${SITE_TAGLINE}`,
  // Google Search Console ownership proof; required for OAuth branding
  // verification. Do not remove after verification, Google re-checks it.
  verification: { google: "aSFYAAEqQ7qMRC2rvKHVYIbBhBSTzHQAICx1-i8aQxI" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["Cardea", "agent workspace", "WebMCP", "human in the loop"],
  // A self-referencing canonical keeps the apex URL the one that ranks, rather
  // than letting a query-string or preview variant compete with it.
  alternates: {
    canonical: "/",
    types: { "text/markdown": "/" },
  },
  openGraph: {
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description:
      "Turn any goal into a living workspace. Watch, steer, and approve coordinated work across the web.",
    type: "website",
    siteName: SITE_NAME,
    url: "/",
    // A capture of the real hero, not a stock plate: the headline over the
    // actual product working on the threshold. Regenerate it whenever the
    // hero composition changes, or the card starts lying about the page.
    images: [
      {
        url: "/images/og-cardea.jpg",
        width: 1600,
        height: 900,
        alt: "Cardea's canvas working on the threshold: a live browser node, a pending approval, and the composer.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description:
      "Turn any goal into a living workspace. Watch, steer, and approve coordinated work across the web.",
    images: ["/images/og-cardea.jpg"],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  // No themeColor: Chrome paints its own chrome (the tab strip / top bar)
  // using this value, keyed to the OS's system color scheme, not to the
  // page's own light/dark toggle. The two can disagree, and the visible
  // result reads as a stray black bar sitting above the page, unrelated to
  // anything the app itself renders.
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Set by src/proxy.ts on every request (Content-Security-Policy nonce).
  // Reading it here — via `headers()`, a dynamic API — is also what forces
  // this layout, and everything under it, into dynamic rendering: nonces
  // are single-use per request, so a statically-generated page couldn't
  // carry a fresh one. See src/proxy.ts's module comment for the full CSP
  // nonce strategy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${newsreader.variable} ${geistPixel.variable}`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
