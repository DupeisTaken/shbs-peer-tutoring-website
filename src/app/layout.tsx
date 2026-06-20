import "~/styles/globals.css";

import { type Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

import { TRPCReactProvider } from "~/trpc/react";
import { APP_TITLE } from "~/lib/branding";

export const metadata: Metadata = {
  title: APP_TITLE,
  description: `Pairings, attendance, and service-hour tracking for the ${APP_TITLE} program.`,
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

// Body / UI typeface — a clean, professional grotesque for dense interface text.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Display typeface for headings — an editorial serif that gives the app a more
// formal, Claude/Anthropic-adjacent voice. Used for page titles and section heads.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"],
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <NextIntlClientProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
