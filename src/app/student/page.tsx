import { auth } from "~/server/auth";
import { randomUUID } from "node:crypto";
import { accountPortalAccess } from "~/server/portal-access";
import Link from "next/link";
import { MessageInbox } from "~/app/_components/message-inbox";
import { AccountSettings } from "~/app/_components/account-settings";
import { getTranslations } from "next-intl/server";
import { StudentPortal } from "~/app/_components/student-portal";
import { LegacyParticipation } from "./legacy-participation";
import { LegacyContinuation } from "./legacy-continuation";
import { StudentWorkspace } from "./student-workspace";
import { TuteeOverview } from "./tutee-overview";
import { resolveTuteeView } from "./views";
import { db } from "~/server/db";
import { getActivePeriodOrNull } from "~/server/period";
import { getFeatures } from "~/server/program/features";
import { getPeriodDisplay } from "~/lib/period";
import { SessionPagePosition } from "~/app/_components/session-view-state";
import { inTransaction } from "~/server/transactions";
import { readStudentSignupRestriction } from "~/server/student-intake-restriction";
import {
  StudentSignupAction,
  StudentSignupRestrictionFeedback,
  StudentSignupRestrictionProvider,
} from "./signup-restriction";

export const dynamic = "force-dynamic";
/** Keep intake and historical links stable while presenting one focused workspace at a time. */
export default async function StudentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const [params, t, signup, intake, workflows] = await Promise.all([
    searchParams,
    getTranslations("tuteePortal"),
    getTranslations("public.signup"),
    // A read snapshot binds the displayed period and restriction without taking
    // the exclusive period barrier used by signup and refresh writers.
    inTransaction(
      db,
      async (tx) => {
        const currentPeriod = await getActivePeriodOrNull(tx);
        const features = await getFeatures(tx);
        const restriction = session?.user
          ? await readStudentSignupRestriction(
              tx,
              currentPeriod?.termId ?? null,
              session.user.id,
            )
          : null;
        return { currentPeriod, features, restriction };
      },
      { isolationLevel: "RepeatableRead" },
    ),
    getTranslations("workflows"),
  ]);
  const { currentPeriod, features, restriction } = intake;
  const access = session?.user
    ? await accountPortalAccess(session.user.id)
    : null;
  const view = resolveTuteeView(params.view);
  const viewScope = currentPeriod?.termId ?? "no-period";
  const period = currentPeriod
    ? getPeriodDisplay(currentPeriod, features.QUARTER_SYSTEM)
    : null;
  return (
    <StudentSignupRestrictionProvider
      key={viewScope}
      snapshotKey={randomUUID()}
      initialRestriction={{
        intakeTermId: currentPeriod?.termId ?? null,
        blocked: restriction?.blocked ?? false,
        canOpenWorkspace: restriction?.canOpenWorkspace ?? false,
      }}
    >
      {view === "account" && (
        <SessionPagePosition id="student-account-v1" scope={viewScope} ready />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="muted text-xs font-semibold tracking-wider uppercase">
            {t("title")}
          </p>
          <h1 className="page-title mt-1">{t(view)}</h1>
          {period && (
            <p className="badge-slate mt-2">
              {signup(period.kind, { period: period.label })}
            </p>
          )}
        </div>
        <StudentSignupAction
          initiallyBlocked={restriction?.blocked ?? false}
          departed={access?.departed ?? false}
        />
      </div>
      <StudentSignupRestrictionFeedback />
      {(view === "dashboard" || view === "requests") && !access?.departed && (
        <LegacyContinuation key={viewScope} />
      )}
      {view === "dashboard" && <TuteeOverview viewScope={viewScope} />}
      {view === "messages" && <MessageInbox viewScope={viewScope} />}
      {view === "account" && <AccountSettings embedded />}
      {view === "requests" && (
        <>
          <StudentWorkspace
            viewScope={viewScope}
            quarterBlocked={restriction?.blocked ?? false}
          />
          <LegacyParticipation />
        </>
      )}
      {view === "support" && (
        <section className="card space-y-3 p-5">
          <p className="muted text-sm">{t("supportHelp")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/student?view=messages" className="btn-secondary">
              {t("messages")}
            </Link>
            <Link href="/student-support" className="btn-secondary">
              {workflows("feedback")}
            </Link>
          </div>
        </section>
      )}
      {(view === "schedule" || view === "attendance" || view === "support") && (
        <StudentPortal key={view} view={view} viewScope={viewScope} />
      )}
    </StudentSignupRestrictionProvider>
  );
}
