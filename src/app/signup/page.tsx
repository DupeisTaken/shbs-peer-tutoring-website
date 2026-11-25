import { getTranslations } from "next-intl/server";

import { pageMetadata } from "~/server/branding-metadata";
import { SignupForm } from "./signup-form";
import { SignupIntro } from "./signup-intro";
import { db } from "~/server/db";
import { readPublicSignupTransition } from "~/server/program/public-signup-transition";
import { PublicFormPage } from "~/app/_components/public-form-page";
import { getSignedInWorkspaceHeader } from "~/app/_components/signed-in-workspace-header";
import { auth } from "~/server/auth";
import { notFound, redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { readRecoveryWorkflowDraft } from "~/server/recovery/workflow-draft";
import Link from "next/link";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { inTransaction } from "~/server/transactions";
import { readStudentSignupRestriction } from "~/server/student-intake-restriction";

export async function generateMetadata() {
  return pageMetadata("public.signup.title");
}

// This page depends on both current database configuration and the wall clock at request time.
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams = Promise.resolve({}),
}: { searchParams?: Promise<{ recoveryDraft?: string | string[] }> } = {}) {
  const t = await getTranslations();
  const session = await auth();
  const draftId = (await searchParams).recoveryDraft;
  let recoveryDraft;
  let draftConsumed = false;
  if (typeof draftId === "string") {
    if (!session?.user.id)
      redirect(
        `/signin?callbackUrl=${encodeURIComponent(`/signup?recoveryDraft=${encodeURIComponent(draftId)}`)}`,
      );
    const draft = await readRecoveryWorkflowDraft(
      db,
      { draftId },
      { id: session.user.id },
    ).catch((error: unknown) => {
      // Missing/non-owned drafts, inactive accounts and changed exact ownership
      // are all unavailable here. Keep the same 404 without disclosing existence;
      // database, validation and other unexpected failures retain their boundary.
      if (
        error instanceof TRPCError &&
        ["NOT_FOUND", "FORBIDDEN", "CONFLICT"].includes(error.code)
      )
        notFound();
      throw error;
    });
    draftConsumed = draft.state === "CONSUMED";
    if (draft.answers)
      recoveryDraft = {
        draftId: draft.draftId,
        version: draft.version,
        answers: draft.answers,
      };
  }

  const { transition, restriction } = await inTransaction(db, async (tx) => {
    const transition = await readPublicSignupTransition(tx);
    // Keep the active intake and account restriction in the transition's period
    // barrier. An already consumed exact recovery receipt remains recoverable.
    const restriction =
      session?.user.id && !draftConsumed
        ? await readStudentSignupRestriction(
            tx,
            transition.current?.termId ?? null,
            session.user.id,
          )
        : null;
    return { transition, restriction };
  });

  const headerTitle = t("components.workspaceTitles.signupForms");
  const signedInHeader = session?.user
    ? await getSignedInWorkspaceHeader({
        href: "/",
        title: headerTitle,
        session,
      })
    : null;

  return (
    <PublicFormPage
      wide
      headerTitle={headerTitle}
      header={signedInHeader ?? undefined}
      title={t("public.signup.title")}
      backLabel={t("common.backToMain")}
      description={restriction?.blocked ? undefined : <SignupIntro />}
    >
      <div className="mt-6">
        {draftConsumed ? (
          <p role="status" className="card p-6">
            {t("recoveryWorkflow.consumed")}
          </p>
        ) : restriction?.blocked ? (
          <InlineNotice
            announcement="status"
            action={
              restriction.canOpenWorkspace ? (
                <Link href="/student?view=requests" className="btn-secondary">
                  {t("tuteePortal.viewMyRequests")}
                </Link>
              ) : undefined
            }
          >
            <p>
              {t(
                transition.current?.kind === "semester"
                  ? "workflow.semesterCopy.abortFinal"
                  : "workflow.abortFinal",
              )}
            </p>
          </InlineNotice>
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
