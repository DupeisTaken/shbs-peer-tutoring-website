import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { APP_TITLE } from "~/lib/branding";
import {
  resolveSignedInLandingLinks,
  signedInLandingLinkLabels,
} from "~/lib/signed-in-landing-links";
import { LandingView } from "~/app/_components/landing-view";
import {
  renderSignedInWorkspaceHeader,
  SIGNED_IN_HEADER_ACCOUNT_SELECT,
} from "~/app/_components/signed-in-header";

/**
 * Root route (`/`): always lands on Program Home.
 * Suspended accounts still route directly to `/suspended` for appeal; active signed-in
 * accounts receive the unified workspace header and role-aware link replacements.
 */
export default async function Home() {
  const session = await auth();
  if (session?.user) {
    const account = await db.user.findUnique({
      where: { id: session.user.id },
      select: SIGNED_IN_HEADER_ACCOUNT_SELECT,
    });
    if (account?.suspendedAt) redirect("/suspended");

    if (account && !account.mergedIntoId) {
      const [t, features] = await Promise.all([
        getTranslations(),
        getFeatures(db),
      ]);
      const signedInLinks = resolveSignedInLandingLinks({
        account,
        crewEnabled: features.CREW,
        labels: signedInLandingLinkLabels(t),
      });
      return (
        <LandingView
          signedInHeader={renderSignedInWorkspaceHeader({
            account,
            crewEnabled: features.CREW,
            t,
            href: "/",
            title: APP_TITLE,
            currentArea: "home",
            containerClassName: "mx-auto max-w-5xl",
          })}
          signedInLinks={signedInLinks}
        />
      );
    }
  }

  return <LandingView />;
}
