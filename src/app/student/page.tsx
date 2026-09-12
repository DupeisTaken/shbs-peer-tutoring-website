import Link from "next/link";
import { MessageInbox } from "~/app/_components/message-inbox";
import { AccountSettings } from "~/app/_components/account-settings";
import { getTranslations } from "next-intl/server";
import { StudentPortal } from "~/app/_components/student-portal";
import { LegacyParticipation } from "./legacy-participation";
import { StudentWorkspace } from "./student-workspace";
import { TuteeOverview } from "./tutee-overview";
import { resolveTuteeView } from "./views";
import { db } from "~/server/db";
import { getActivePeriodOrNull } from "~/server/period";
import { getFeatures } from "~/server/program/features";
import { getPeriodDisplay } from "~/lib/period";

export const dynamic = "force-dynamic";
/** Keep intake and historical links stable while presenting one focused workspace at a time. */
export default async function StudentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, signup, currentPeriod, features] = await Promise.all([
    searchParams,
    getTranslations("tuteePortal"),
    getTranslations("public.signup"),
    getActivePeriodOrNull(db),
    getFeatures(db),
  ]);
  const view = resolveTuteeView(params.view);
  const period = currentPeriod
    ? getPeriodDisplay(currentPeriod, features.QUARTER_SYSTEM)
    : null;
  return (
    <>
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
        <Link href="/signup" className="btn-primary" prefetch={false}>
          {t("requestTutor")}
        </Link>
      </div>
      {view === "dashboard" && <TuteeOverview />}
      {view === "messages" && <MessageInbox />}
      {view === "account" && <AccountSettings embedded />}
      {view === "requests" && (
        <>
          <StudentWorkspace />
          <LegacyParticipation />
        </>
      )}
      {view === "support" && (
        <section className="card space-y-3 p-5">
          <h2 className="section-title">{t("needHelp")}</h2>
          <p className="muted text-sm">{t("supportHelp")}</p>
          <Link href="/student?view=messages" className="btn-secondary">
            {t("messages")}
          </Link>
        </section>
      )}
      {(view === "schedule" || view === "attendance" || view === "support") && (
        <StudentPortal key={view} view={view} />
      )}
    </>
  );
}
