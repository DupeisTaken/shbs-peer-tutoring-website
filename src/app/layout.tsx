import "~/styles/globals.css";

import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";

import { TRPCReactProvider } from "~/trpc/react";
import { IntlProvider } from "~/app/_components/intl-provider";
import { BRANDING } from "~/lib/branding";
import { BrandingProvider } from "~/app/_components/branding-provider";
import { brandingMetadata } from "~/server/branding-metadata";
import { DEFAULT_THEME, THEME_COOKIE, isTheme } from "~/lib/theme";
import { StudentPolicyGate } from "~/app/_components/student-policy-gate";
import { auth } from "~/server/auth";
import { sessionIdentity } from "~/lib/session-identity";

export async function generateMetadata() {
  return brandingMetadata();
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const timeZone = await getTimeZone();
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = isTheme(themeCookie) ? themeCookie : DEFAULT_THEME;
  const session = await auth();
  const identity = sessionIdentity(session);
  return (
    <html lang={locale} data-theme={theme} className={GeistSans.variable}>
      <body>
        <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
          <BrandingProvider branding={BRANDING}>
            <TRPCReactProvider identity={identity}>
              <Suspense fallback={null}>
                <StudentPolicyGate />
              </Suspense>
              {children}
            </TRPCReactProvider>
          </BrandingProvider>
        </IntlProvider>
      </body>
    </html>
  );
}
