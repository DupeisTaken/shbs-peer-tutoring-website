import "server-only";

import { type Metadata } from "next";
import { connection } from "next/server";
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
