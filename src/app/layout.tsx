import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

import { TRPCReactProvider } from "~/trpc/react";
import { APP_TITLE } from "~/lib/branding";
import { DEFAULT_THEME, THEME_COOKIE, isTheme } from "~/lib/theme";

export const metadata: Metadata = {
  title: APP_TITLE,
  description: `Pairings, attendance, and service-hour tracking for the ${APP_TITLE} program.`,
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = isTheme(themeCookie) ? themeCookie : DEFAULT_THEME;
  return (
    <html lang={locale} data-theme={theme} className={`${geist.variable}`}>
      <body>
        <NextIntlClientProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
