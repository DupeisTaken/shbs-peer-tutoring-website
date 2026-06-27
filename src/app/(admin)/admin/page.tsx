import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { db } from "~/server/db";
import { getFeatures } from "~/server/program/features";
import { api } from "~/trpc/server";
import { BarList, SegmentBar, type BarItem } from "~/app/_components/charts";

const STATUS_TONE: Record<string, string> = {
  PRESENT: "badge-green",
  EXTRA: "badge-slate",
  RESCHEDULED: "badge-amber",
  TUTOR_ABSENT: "badge-red",
};

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

  const sh = features.SERVICE_HOURS;
  const activeTutors = summary.rows.filter((r) => r.active).length;
  const pendingTutees = tutees.filter((x) => x.status === "PENDING").length;
  const activeTutees = tutees.filter((x) => x.status === "ACTIVE").length;
  const inactiveTutees = tutees.filter((x) => x.status === "INACTIVE").length;
  const recent = sessions.slice(0, 8);

  // Hero adapts to whether service hours are tracked: hours (the program's headline output) when
  // on, else active pairings (the core unit). The bar list shows who contributed, accordingly.
  const heroFigure = sh ? summary.totals.total.toFixed(1) : String(pairings.length);
  const heroUnit = sh ? t("admin.dashboard.hours.unit") : t("admin.dashboard.stats.pairings");
  const bars: BarItem[] = [...summary.rows]
    .filter((r) => (sh ? r.total !== 0 : r.sessions > 0))
    .sort((a, b) => (sh ? b.total - a.total : b.sessions - a.sessions))
    .slice(0, 7)
    .map((r) => ({
      key: r.tutorId,
      label: r.englishName,
      value: sh ? Math.max(r.total, 0) : r.sessions,
      display: sh ? `${r.total.toFixed(1)} h` : String(r.sessions),
    }));

  const { present, excused, unexcused } = summary.totals;
  const attTotal = present + excused + unexcused;
  const presentRate = attTotal > 0 ? Math.round((present / attTotal) * 100) : 0;

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("admin.dashboard.title")}</h1>

      {/* Hero — the program's headline output, alongside who logged it. */}
      <section className="card grid gap-6 bg-accent-50/40 p-6 lg:grid-cols-5 lg:p-7">
        <div className="lg:col-span-2">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-accent-700 uppercase">
            {summary.scope.label}
          </p>
          <p className="mt-2 text-6xl font-bold tracking-tight text-slate-900 tabular-nums">
            {heroFigure}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-500">{heroUnit}</p>
          {sh && (
            <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
              <Metric label={t("admin.dashboard.hours.earned")} value={summary.totals.earned.toFixed(1)} />
              {summary.totals.extras > 0 && (
                <Metric
                  label={t("admin.dashboard.hours.extras")}
                  value={`+${summary.totals.extras.toFixed(1)}`}
                  tone="emerald"
                />
              )}
              {summary.totals.punishments > 0 && (
                <Metric
                  label={t("admin.dashboard.hours.penalties")}
                  value={`−${summary.totals.punishments.toFixed(1)}`}
                  tone="red"
                />
              )}
            </dl>
          )}
        </div>
        <div className="lg:col-span-3 lg:border-l lg:border-accent-100 lg:pl-6">
          <p className="section-title mb-3">
            {sh ? t("admin.dashboard.hours.byTutor") : t("admin.dashboard.sessionsByTutor")}
          </p>
          <BarList items={bars} emptyLabel={t("admin.dashboard.hours.noData")} />
        </div>
      </section>

      {pendingTutees > 0 && (
        <Link
          href="/admin/requests"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 transition hover:bg-amber-100"
        >
          <span className="font-semibold">{t("admin.dashboard.pendingBanner", { count: pendingTutees })}</span>
          <span className="ml-auto font-semibold">{t("admin.dashboard.reviewNow")}</span>
        </Link>
      )}

      {/* KPI tiles + the two proportion visualizations. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-4">
          <Kpi label={t("admin.dashboard.stats.pairings")} value={pairings.length} href="/admin/pairings" />
          <Kpi label={t("admin.dashboard.stats.activeTutors")} value={activeTutors} href="/admin/tutors" />
          <Kpi label={t("admin.dashboard.stats.sessions")} value={summary.totals.sessions} href="/admin/attendance" />
          <Kpi
            label={t("admin.dashboard.stats.pendingSignups")}
            value={pendingTutees}
            href="/admin/requests"
            highlight={pendingTutees > 0}
          />
        </div>

        <section className="card p-5">
          <p className="section-title">{t("admin.dashboard.attendance.title")}</p>
          <p className="mt-1 mb-4 text-3xl font-bold text-slate-900 tabular-nums">
            {presentRate}%{" "}
            <span className="text-sm font-medium text-slate-400">
              {t("admin.dashboard.attendance.present")}
            </span>
          </p>
          <SegmentBar
            segments={[
              { key: "p", value: present, tone: "emerald", label: t("admin.dashboard.attendance.present") },
              { key: "e", value: excused, tone: "amber", label: t("admin.dashboard.attendance.excused") },
              { key: "u", value: unexcused, tone: "red", label: t("admin.dashboard.attendance.unexcused") },
            ]}
          />
        </section>

        <section className="card p-5">
          <p className="section-title">{t("admin.dashboard.pipeline.title")}</p>
          <p className="mt-1 mb-4 text-3xl font-bold text-slate-900 tabular-nums">
            {activeTutees}{" "}
            <span className="text-sm font-medium text-slate-400">
              {t("admin.dashboard.pipeline.active")}
            </span>
          </p>
          <SegmentBar
            segments={[
              { key: "a", value: activeTutees, tone: "accent", label: t("admin.dashboard.pipeline.active") },
              { key: "p", value: pendingTutees, tone: "amber", label: t("admin.dashboard.pipeline.pending") },
              { key: "i", value: inactiveTutees, tone: "slate", label: t("admin.dashboard.pipeline.inactive") },
            ]}
          />
        </section>
      </div>

      {features.CREW && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label={t("admin.dashboard.stats.crewPatrols")} value={crew.patrols} href="/admin/crew" />
          <Kpi label={t("admin.dashboard.stats.crewMembers")} value={crew.members} href="/admin/crew" />
          <Kpi
            label={t("admin.activity.counters.sessionFlags")}
            value={crew.openFlags}
            href="/admin/session-flags"
            highlight={crew.openFlags > 0}
          />
          <Kpi label={t("admin.dashboard.stats.crewHours")} value={crew.hours.toFixed(1)} href="/admin/crew" />
        </div>
      )}

      {/* Recent submissions. */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5">
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
                  <td className="whitespace-nowrap text-slate-500 tabular-nums">
                    {new Date(s.date).toLocaleDateString()}
                  </td>
                  <td className="font-medium text-slate-800">{s.tutor.englishName}</td>
                  <td>{s.pairing.subject}</td>
                  <td>
                    <span className={STATUS_TONE[s.tutorStatus] ?? "badge-slate"}>{s.tutorStatus}</span>
                  </td>
                  <td className="text-right font-semibold text-slate-900 tabular-nums">
                    {s.shCount.toFixed(1)}
                  </td>
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

function Kpi({
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
      className={`card flex flex-col justify-between p-4 transition hover:shadow-md ${
        highlight ? "ring-2 ring-amber-300" : ""
      }`}
    >
      <p className="text-[11px] font-semibold tracking-[0.1em] text-slate-500 uppercase">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{value}</p>
    </Link>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "red";
}) {
  const color = tone === "emerald" ? "text-emerald-600" : tone === "red" ? "text-red-600" : "text-slate-900";
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}
