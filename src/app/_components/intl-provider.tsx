"use client";

import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";

import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { getMessageFallback, onIntlError } from "~/i18n/fallback";

/**
 * Client wrapper around NextIntlClientProvider that applies the shared missing-key handling
 * (highlighted key placeholders) to client components. The handlers are functions, so they can't
 * be passed across the server→client boundary — they're imported and applied here on the client.
 * `locale`/`messages` come from the server (request config) and are serializable.
 */
export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={DEFAULT_TIME_ZONE}
      getMessageFallback={getMessageFallback}
      onError={onIntlError}
    >
      {children}
    </NextIntlClientProvider>
  );
}
