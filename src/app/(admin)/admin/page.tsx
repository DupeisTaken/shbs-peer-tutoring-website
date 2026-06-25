import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { api } from "~/trpc/server";

export default async function AdminHome() {
  const t = await getTranslations();
  const [pairings, summary, tutees, sessions, crew, features] = await Promise.all([
    api.admin.pairings(),
    api.admin.periodSummary(),
    api.admin.tutees(),
    api.admin.sessions(),
    api.admin.crewSummary(),
    getFeatures(db),
  ]);

  const activeTutors = summary.rows.filter((r) => r.active).length;
  const totalHours = summary.totals.total;
  const pendingTutees = tutees.filter((t) => t.status === "PENDING").length;
  const activeTutees = tutees.filter((t) => t.status === "ACTIVE").length;
  const recent = sessions.slice(0, 8);

  return (
    <div className="space-y-8">
      <h1 className="page-title">{t("admin.dashboard.title")}</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label={t("admin.dashboard.stats.pairings")} value={pairings.length} href="/admin/pairings" />
        <Stat label={t("admin.dashboard.stats.activeTutors")} value={activeTutors} href="/admin/tutors" />
        <Stat label={t("admin.dashboard.stats.activeTutees")} value={activeTutees} href="/admin/tutees" />
        <Stat
          label={t("admin.dashboard.stats.pendingSignups")}
          value={pendingTutees}
          href="/admin/requests"
          highlight={pendingTutees > 0}
        />
        {features.SERVICE_HOURS && (
          <Stat
            label={t("admin.dashboard.stats.serviceHours", { month: summary.scope.label })}
            value={totalHours.toFixed(1)}
            href="/admin/service-hours"
          />
        )}
        {features.CREW && (
          <Stat
            label={t("admin.dashboard.stats.crewPatrols")}
            value={crew.patrols}
            href="/admin/crew"
            highlight={crew.openFlags > 0}
          />
        )}
      </div>

      {pendingTutees > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t("admin.dashboard.pendingBanner", { count: pendingTutees })}{" "}
          <Link href="/admin/requests" className="font-semibold underline">
            {t("admin.dashboard.reviewNow")}
          </Link>
        </div>
      )}

      {/* Recent submissions */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="section-title">{t("admin.dashboard.recentSubmissions.title")}</h2>
          <Link href="/admin/attendance" className="link text-sm">
            {t("admin.dashboard.recentSubmissions.viewAll")}
          </Link>
        </div>
        <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.dashboard.recentSubmissions.columns.date")}</th>
              <th>{t("admin.dashboard.recentSubmissions.columns.tutor")}</th>
              <th>{t("admin.dashboard.recentSubmissions.columns.subject")}</th>
              <th>{t("admin.dashboard.recentSubmissions.columns.status")}</th>
              <th className="text-right">{t("admin.dashboard.recentSubmissions.columns.sh")}</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.date).toLocaleDateString()}</td>
                <td>{s.tutor.englishName}</td>
                <td>{s.pairing.subject}</td>
                <td className="text-slate-500">{s.tutorStatus}</td>
                <td className="text-right">{s.shCount.toFixed(1)}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  {t("admin.dashboard.recentSubmissions.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  highlight = false,
}: {
  label: string;
  value: string | number;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`card block p-4 transition hover:shadow-md ${
        highlight ? "ring-2 ring-amber-300" : ""
      }`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </Link>
  );
}
