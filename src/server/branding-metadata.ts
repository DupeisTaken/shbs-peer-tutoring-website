import "server-only";

import { type Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { APP_TITLE } from "~/lib/branding";

/** Defer metadata to a request so a single image can serve each deployment's runtime title. */
export async function brandingMetadata(pageTitle?: string): Promise<Metadata> {
  await connection();
  return {
    title: pageTitle ? `${pageTitle} · ${APP_TITLE}` : APP_TITLE,
    ...(!pageTitle
      ? {
          description: `Pairings, attendance, and service-hour tracking for the ${APP_TITLE} program.`,
        }
      : {}),
    // Next.js derives the tab icon from the repository-owned src/app/icon.png.
  };
}

/** Resolve a localized route title so browser tabs and Next's route announcer stay specific per page. */
export async function pageMetadata(titleKey: string): Promise<Metadata> {
  const t = await getTranslations();
  return brandingMetadata(t(titleKey));
}
