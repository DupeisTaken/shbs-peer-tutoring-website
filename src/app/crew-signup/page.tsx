import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { pageMetadata } from "~/server/branding-metadata";
import { CrewSignupForm } from "./crew-signup-form";
import { PublicFormPage } from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";

export async function generateMetadata() {
  return pageMetadata("public.crewSignup.title");
}

export default async function CrewSignupPage() {
  // Crew module off -> no public crew application.
  const features = await getFeatures(db);
  if (!features.CREW) redirect("/");

  const [t, session] = await Promise.all([getTranslations(), auth()]);
  const signedIn = Boolean(session?.user);
  const signedInHeader = signedIn
    ? await getSignedInWorkspaceHeader({
        href: "/crew-signup",
        title: t("public.crewSignup.title"),
        session,
      })
    : null;
  return (
    <PublicFormPage
      wide
      title={t("public.crewSignup.title")}
      description={t("public.crewSignup.intro")}
      backLabel={t("common.backToMain")}
      header={signedInHeader ?? undefined}
    >
      <CrewSignupForm signedIn={signedIn} />

      {!signedIn && (
        <p className="muted mt-6 text-center">
          {t("public.crewSignup.alreadyMember")}{" "}
          <Link href="/signin" className="link">
            {t("public.crewSignup.signIn")}
          </Link>
        </p>
      )}
    </PublicFormPage>
  );
}
