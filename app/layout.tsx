import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Canviagram — Canvas + IA para gestionar tu día",
  description:
    "Planea en Tablero, Tabla o Canvas, pídele a la IA o a Telegram y enfócate cada día en tu vista Hoy.",
  icons: {
    icon: [
      { url: "/brand/isotipo-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/isotipo-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/brand/isotipo-180.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Canviagram — Canvas + IA para gestionar tu día",
    description:
      "Tablero, Hoy, Canvas y Telegram con IA: abre tu Café Luna sin caos.",
    images: [{ url: "/brand/logo-desc-debajo-horizontal.png", width: 1435, height: 431, alt: "Canviagram — Canvas + IA para gestionar tu día" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2B6B8F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${sans.variable} ${display.variable} font-sans`}>{children}</body>
    </html>
  );
}
