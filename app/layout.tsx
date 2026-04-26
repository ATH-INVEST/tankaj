import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.tankaj.si"),
  title: {
    default: "Tankaj.si – Ne tankaj več na pamet",
    template: "%s | Tankaj.si",
  },
  description:
    "Primerjaj cene goriva in izračunaj dejanski strošek poti. Najnižja cena na liter ni vedno najboljša izbira.",
  keywords: [
    "cena goriva",
    "bencin cena",
    "dizel cena",
    "najcenejša črpalka",
    "gorivo Slovenija",
    "gorivo Hrvaška",
    "tankaj pametno",
  ],
  authors: [{ name: "Tankaj.si" }],
  creator: "Tankaj.si",

  openGraph: {
    title: "Tankaj.si – Ne tankaj več na pamet",
    description:
      "Najnižja cena na liter ni vedno najboljša izbira. Izračunaj realni strošek poti.",
    url: "https://www.tankaj.si",
    siteName: "Tankaj.si",
    locale: "sl_SI",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Tankaj.si – pametno tankanje",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "Tankaj.si – Ne tankaj več na pamet",
    description:
      "Izračunaj, katera črpalka se ti dejansko splača.",
    images: ["/og-image.png"],
  },

  robots: {
    index: true,
    follow: true,
  },

  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="sl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900">
        {children}
      </body>
    </html>
  );
}