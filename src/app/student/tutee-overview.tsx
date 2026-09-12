"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

/** Overview reads the same owned records as the detailed panels; it never creates an enrollment. */
export function TuteeOverview() {
  const t = useTranslations("tuteePortal");
  const personal = api.student.me.useQuery({ page: 0 });
  const requests = api.studentWorkflow.mine.useQuery();
  const open = requests.data?.filter((row) => row.state === "OPEN");
  return (
    <div className="space-y-6">
      <section className="border-accent-100 bg-accent-50/45 rounded-xl border p-5 sm:p-6">
        <h2 className="text-xl font-semibold">{t("welcome", { name: personal.data?.user.name ?? "" })}</h2>
        <p className="muted mt-2 max-w-2xl">{t("intro")}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/signup" className="btn-primary" prefetch={false}>{t("requestTutor")}</Link>
          <Link href="/student?view=requests" className="btn-secondary">{t("manageRequests")}</Link>
        </div>
        <p className="muted mt-3 text-sm">{t("formHelp")}</p>
      </section>
      {(personal.error ?? requests.error) && <p role="alert">{personal.error?.message ?? requests.error?.message}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/student?view=schedule" className="card block p-5 transition hover:border-accent-300">
          <h2 className="section-title">{t("schedule")}</h2>
          <p className="mt-3 text-3xl font-bold">{personal.isLoading || personal.error ? "—" : personal.data?.schedule.length ?? 0}</p>
          <p className="muted mt-1 text-sm">{t("scheduledSubjects")}</p>
        </Link>
        <Link href="/student?view=requests" className="card block p-5 transition hover:border-accent-300">
          <h2 className="section-title">{t("requests")}</h2>
          <p className="mt-3 text-3xl font-bold">{requests.isLoading || requests.error ? "—" : open?.length ?? 0}</p>
          <p className="muted mt-1 text-sm">{t("openRequests")}</p>
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(["attendance", "support", "account"] as const).map((view) => (
          <Link key={view} href={view === "account" ? "/my-account" : `/student?view=${view}`} className="card block space-y-2 p-5">
            <h2 className="font-semibold">{t(view)}</h2>
            <p className="muted text-sm">{t(`${view}Help`)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
