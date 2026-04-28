import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import MobileAppBar from "@/components/MobileAppBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://tankaj.si";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Tankaj.si • Cene goriva in EV polnilnice",
    template: "%s | Tankaj.si",
  },
  description:
    "Primerjaj cene goriva in EV polnilnic v Sloveniji, na Hrvaškem, v Avstriji in Italiji. Tankaj.si izračuna realni strošek poti, čas in najboljšo izbiro v tvoji bližini.",
  keywords: [
    "cena goriva",
    "cene goriv danes",
    "bencin cena",
    "dizel cena",
    "najcenejša črpalka",
    "cene goriv Slovenija",
    "cene goriv Hrvaška",
    "cene goriv Avstrija",
    "cene goriv Italija",
    "EV polnilnice",
    "električne polnilnice",
    "cena polnjenja EV",
    "cena elektrike za avto",
    "polnjenje električnega avta",
    "DC polnilnice",
    "AC polnilnice",
    "kje se splača tankati",
    "kje se splača polniti",
    "Tankaj.si",
  ],
  authors: [{ name: "Tankaj.si" }],
  creator: "Tankaj.si",
  publisher: "Tankaj.si",
  applicationName: "Tankaj.si",
  category: "utility",
  manifest: "/manifest.json",
  alternates: {
    canonical: siteUrl,
  },
  appleWebApp: {
    capable: true,
    title: "Tankaj",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Tankaj.si • Cene goriva in EV polnilnice",
    description:
      "Najnižja cena ni vedno najboljša izbira. Primerjaj gorivo in EV polnilnice glede na ceno, razdaljo, čas in realni strošek poti.",
    url: siteUrl,
    siteName: "Tankaj.si",
    locale: "sl_SI",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Tankaj.si – primerjava cen goriva in EV polnilnic",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tankaj.si • Cene goriva in EV polnilnice",
    description:
      "Izračunaj, kje se ti dejansko splača tankati ali polniti električni avto glede na ceno, razdaljo in čas.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#06140f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
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
      <body className="flex min-h-full flex-col bg-[#06140f] text-white">
        {children}
        <MobileAppBar />

        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-29HNWBQDL1"
          strategy="afterInteractive"
        />
        <Script id="ga-script" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;

            gtag('js', new Date());
            gtag('config', 'G-29HNWBQDL1', {
              page_path: window.location.pathname,
            });
          `}
        </Script>
      </body>
    </html>
  );
}
