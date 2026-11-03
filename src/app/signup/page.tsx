import { getTranslations } from "next-intl/server";

import { brandingMetadata } from "~/server/branding-metadata";
import { SignupForm } from "./signup-form";
import { db } from "~/server/db";
import { readPublicSignupTransition } from "~/server/program/public-signup-transition";
import { PublicFormPage } from "~/app/_components/public-form-page";
import { auth } from "~/server/auth";
import { redirect } from "next/navigation";
import { readRecoveryWorkflowDraft } from "~/server/recovery/workflow-draft";

export async function generateMetadata() {
  return brandingMetadata("Request a tutor");
}

// This page depends on both current database configuration and the wall clock at request time.
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams = Promise.resolve({}),
}: { searchParams?: Promise<{ recoveryDraft?: string | string[] }> } = {}) {
  const t = await getTranslations();
  const transition = await readPublicSignupTransition(db);
  const draftId = (await searchParams).recoveryDraft;
  let recoveryDraft;
  let draftConsumed = false;
  if (typeof draftId === "string") {
    const session = await auth();
    if (!session?.user.id)
      redirect(
        `/signin?callbackUrl=${encodeURIComponent(`/signup?recoveryDraft=${encodeURIComponent(draftId)}`)}`,
      );
    const draft = await readRecoveryWorkflowDraft(
      db,
      { draftId },
      { id: session.user.id },
    );
    draftConsumed = draft.state === "CONSUMED";
    if (draft.answers)
      recoveryDraft = {
        draftId: draft.draftId,
        version: draft.version,
        answers: draft.answers,
      };
  }

  return (
    <PublicFormPage
      wide
      title={t("public.signup.title")}
      backLabel={t("common.backToMain")}
      description={<p>{t("survey.intro")}</p>}
    >
      <div className="mt-6">
        {draftConsumed ? (
          <p role="status" className="card p-6">
            {t("recoveryWorkflow.consumed")}
          </p>
        ) : (
          <SignupForm
            initialTransition={transition}
            recoveryDraft={recoveryDraft}
          />
        )}
      </div>
    </PublicFormPage>
  );
}
