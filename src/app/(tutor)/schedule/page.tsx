import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { api } from "~/trpc/server";
import { TutorSchedule } from "~/app/(tutor)/_components/tutor-schedule";
import { DepartureBanner } from "~/app/_components/school-departure";
import { PolicyConsent } from "~/app/_components/policy-consent";

/** The shared tutor layout owns suspension, onboarding and linked-account gates;
 * repeat the dashboard's early guard before invoking any self-scoped reader. */
export default async function TutorSchedulePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!session.tutorId) redirect("/admin");
  const [me, features, t] = await Promise.all([
    api.tutor.me(),
    getFeatures(db),
    getTranslations(),
  ]);
  const inactive = me.status !== "ACTIVE";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:py-8">
      <div>
        <h1 className="page-title">{t("tutor.schedulePage.title")}</h1>
        <p className="muted mt-1">{t("tutor.schedulePage.help")}</p>
        <nav
          aria-label={t("tutor.navigation.dashboard")}
          className="mt-3 flex flex-wrap gap-x-5 gap-y-1"
        >
          <Link
            className="link inline-flex min-h-11 items-center lg:min-h-8"
            href="/dashboard#tutor-pairings"
          >
            {t("tutor.schedulePage.backToPairings")}
          </Link>
          <Link
            className="link inline-flex min-h-11 items-center lg:min-h-8"
            href="/dashboard#tutor-preferences"
          >
            {t("tutor.schedulePage.preferences")}
          </Link>
          <Link
            className="link inline-flex min-h-11 items-center lg:min-h-8"
            href="/dashboard#room-schedule"
          >
            {t("tutor.schedulePage.rooms")}
          </Link>
        </nav>
      </div>
      <PolicyConsent slug="tutor-policy" />
      <DepartureBanner />
      {inactive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <p className="font-semibold">
            {t(
              me.status === "PENDING"
                ? "tutor.tasks.activation"
                : "tutor.dashboard.inactive.title",
            )}
          </p>
          <p className="mt-1 text-sm">
            {me.status === "PENDING"
              ? t("tutor.tasks.readonlyHelp")
              : t("tutor.dashboard.inactive.body", {
                  status: t(`tutor.status.${me.status}`),
                })}
          </p>
          {me.status === "OPTED_OUT" && (
            <p className="mt-2 text-sm">
              {t("tutor.dashboard.inactive.reentryHint")}
            </p>
          )}
          {me.status === "PENDING" && (
            <Link
              className="link mt-2 inline-flex min-h-11 items-center"
              href="/dashboard#tutor-activation"
            >
              {t("tutor.tasks.activation")}
            </Link>
          )}
        </div>
      )}
      <TutorSchedule
        active={!inactive}
        interviewsEnabled={features.INTERVIEWS}
        meetingsEnabled={features.MEETINGS}
        now={new Date()}
      />
    </div>
  );
}
