import "~/styles/globals.css";

import { type Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";

import { TRPCReactProvider } from "~/trpc/react";
import { IntlProvider } from "~/app/_components/intl-provider";
import { APP_TITLE } from "~/lib/branding";
import { DEFAULT_THEME, THEME_COOKIE, isTheme } from "~/lib/theme";
import { StudentPolicyGate } from "~/app/_components/student-policy-gate";

export const metadata: Metadata = {
  title: APP_TITLE,
  description: `Pairings, attendance, and service-hour tracking for the ${APP_TITLE} program.`,
  // Next.js derives the tab icon from src/app/icon.png; replace that image to rebrand.
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const timeZone = await getTimeZone();
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = isTheme(themeCookie) ? themeCookie : DEFAULT_THEME;
  return (
    <html lang={locale} data-theme={theme} className={GeistSans.variable}>
      <body>
        <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
          <TRPCReactProvider>
            <StudentPolicyGate />
            {children}
          </TRPCReactProvider>
        </IntlProvider>
      </body>
    </html>
  );
}
