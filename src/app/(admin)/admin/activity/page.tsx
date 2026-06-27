"use client";

import { Children } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { BarList, type BarItem } from "~/app/_components/charts";

/**
 * Single pane of glass: the live status of every kind of request/activity — tutee signups, tutor
 * applications, lifecycle requests, discipline cards, crew validation, and attendance surveys —
 * each linking to where it can be actioned (and reverted). A hero count + a triage bar chart show
 * how much is waiting and where the backlog concentrates; the panels below hold the detail. See the
 * "Admin philosophies" note in CLAUDE.md.
 */
export default function ActivityPage() {
  const t = useTranslations();
  const tutees = api.admin.tutees.useQuery();
  const apps = api.admin.tutorApplications.useQuery();
  const cards = api.admin.disciplinaryCards.useQuery();
  const sessions = api.admin.sessions.useQuery();
  const tutorRequests = api.admin.tutorRequests.useQuery();
  const tuteeRequests = api.admin.tuteeRemovalRequests.useQuery();
  const sessionFlags = api.admin.sessionFlags.useQuery();
  const crewApplications = api.admin.crewApplications.useQuery();
  const crewRequests = api.admin.crewRequests.useQuery();
  const features = api.program.features.useQuery().data;

  const pendingTutees = (tutees.data ?? [])
    .filter((x) => x.status === "PENDING")
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const openApps = (apps.data ?? []).filter(
    (a) => a.status === "PENDING" || a.status === "INTERVIEW",
  );
  const pendingCards = (cards.data ?? []).filter((c) => c.reviewStatus === "PENDING");
  const recentSessions = (sessions.data ?? []).slice(0, 10);
  const openRequests = tutorRequests.data ?? [];
  const openTuteeRequests = tuteeRequests.data?.pendingOptOuts ?? [];
  const openFlags = sessionFlags.data ?? [];
  const openCrewApps = crewApplications.data ?? [];
  const openCrewReqs = crewRequests.data ?? [];

  // Triage: every actionable queue, sized by backlog and tinted by urgency (red = a problem to
  // resolve, amber = a member-initiated request on a clock, accent = an inbound waiting to process).
  const triage: BarItem[] = [
    { key: "signups", label: t("admin.activity.counters.pendingSignups"), value: pendingTutees.length, tone: "accent", href: "/admin/requests" },
    { key: "apps", label: t("admin.activity.counters.openApplications"), value: openApps.length, tone: "accent", href: "/admin/applications" },
    ...(features?.DISCIPLINE
      ? [{ key: "cards", label: t("admin.activity.counters.cardsToReview"), value: pendingCards.length, tone: "red" as const, href: "/admin/discipline" }]
      : []),
    { key: "tutorReq", label: t("admin.activity.counters.tutorRequests"), value: openRequests.length, tone: "amber", href: "/admin/tutor-requests" },
    { key: "tuteeReq", label: t("admin.activity.counters.tuteeRequests"), value: openTuteeRequests.length, tone: "amber", href: "/admin/tutee-requests" },
    ...(features?.CREW
      ? [
          { key: "flags", label: t("admin.activity.counters.sessionFlags"), value: openFlags.length, tone: "red" as const, href: "/admin/session-flags" },
          { key: "crewApps", label: t("admin.activity.counters.crewApplications"), value: openCrewApps.length, tone: "accent" as const, href: "/admin/crew" },
          { key: "crewReq", label: t("admin.activity.counters.crewRequests"), value: openCrewReqs.length, tone: "amber" as const, href: "/admin/crew" },
        ]
      : []),
  ];
  const totalOpen = triage.reduce((n, x) => n + x.value, 0);
  const activeQueues = triage.filter((x) => x.value > 0).length;
  const backlog = triage.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const loading = [tutees, apps, cards, tutorRequests, tuteeRequests, sessionFlags, crewApplications, crewRequests].some(
    (q) => q.isLoading,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.activity.title")}</h1>
        <p className="muted mt-1">{t("admin.activity.subtitle")}</p>
      </div>

      {/* Hero — how much is waiting, and where it concentrates. */}
      <section className="card grid gap-6 bg-accent-50/40 p-6 lg:grid-cols-5 lg:p-7">
        <div className="lg:col-span-2">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-accent-700 uppercase">
            {t("admin.activity.hero.title")}
          </p>
          <p className="mt-2 text-6xl font-bold tracking-tight text-slate-900 tabular-nums">{totalOpen}</p>
          <p className="mt-1 text-sm font-medium text-slate-500">{t("admin.activity.hero.openItems")}</p>
          {totalOpen > 0 && (
            <p className="muted mt-1 text-xs">{t("admin.activity.hero.across", { count: activeQueues })}</p>
          )}
        </div>
        <div className="lg:col-span-3 lg:border-l lg:border-accent-100 lg:pl-6">
          {totalOpen > 0 ? (
            <>
              <p className="section-title mb-3">{t("admin.activity.hero.triage")}</p>
              <BarList items={backlog} />
            </>
          ) : (
            <div className="flex h-full items-center">
              <p className="text-sm font-medium text-slate-500">
                {loading ? "…" : t("admin.activity.hero.allClear")}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Tutee signups */}
      <Panel
        title={t("admin.activity.panels.tuteeSignups.title")}
        count={pendingTutees.length}
        href="/admin/requests"
        empty={t("admin.activity.panels.tuteeSignups.empty")}
        manageLabel={t("admin.activity.manage")}
      >
        {pendingTutees.map((tutee, i) => (
          <Row key={tutee.id}>
            <span className="badge-slate">#{i + 1}</span>
            <span className="font-medium text-slate-800">{tutee.englishName}</span>
            <span className="muted text-xs">{tutee.firstChoice?.name ?? "—"}</span>
            <span className="muted ml-auto text-xs">{new Date(tutee.createdAt).toLocaleString()}</span>
          </Row>
        ))}
      </Panel>

      {/* Tutor applications */}
      <Panel
        title={t("admin.activity.panels.tutorApplications.title")}
        count={openApps.length}
        href="/admin/applications"
        empty={t("admin.activity.panels.tutorApplications.empty")}
        manageLabel={t("admin.activity.manage")}
      >
        {openApps.map((a) => (
          <Row key={a.id}>
            <span className="font-medium text-slate-800">{a.name}</span>
            <span className="badge-amber">{a.status.toLowerCase()}</span>
            <span className="muted text-xs">
              {t("admin.activity.panels.tutorApplications.votes", { count: a.votes.length })}
            </span>
            <span className="muted ml-auto text-xs">
              {t("admin.activity.panels.tutorApplications.panelists", { count: a.interviewers.length })}
            </span>
          </Row>
        ))}
      </Panel>

      {/* Tutor lifecycle requests (opt-out / reentry) */}
      <Panel
        title={t("admin.activity.panels.tutorRequests.title")}
        count={openRequests.length}
        href="/admin/tutor-requests"
        empty={t("admin.activity.panels.tutorRequests.empty")}
        manageLabel={t("admin.activity.manage")}
      >
        {openRequests.map((r) => (
          <Row key={r.id}>
            <span className="font-medium text-slate-800">{r.tutor.englishName}</span>
            <span className={r.kind === "OPT_OUT" ? "badge-amber" : "badge-green"}>
              {t(`admin.tutorRequests.kind.${r.kind}`)}
            </span>
            <span className="muted ml-auto text-xs">
              {r.approvable
                ? t("admin.tutorRequests.cooldownDone")
                : r.eligibleAt
                  ? t("admin.tutorRequests.cooldownUntil", {
                      date: new Date(r.eligibleAt).toLocaleDateString(),
                    })
                  : ""}
            </span>
          </Row>
        ))}
      </Panel>

      {/* Tutee removal requests (tutor-raised) */}
      <Panel
        title={t("admin.activity.panels.tuteeRequests.title")}
        count={openTuteeRequests.length}
        href="/admin/tutee-requests"
        empty={t("admin.activity.panels.tuteeRequests.empty")}
        manageLabel={t("admin.activity.manage")}
      >
        {openTuteeRequests.map((r) => (
          <Row key={r.id}>
            <span className="font-medium text-slate-800">{r.tutee.englishName}</span>
            <span className="badge-amber">{t("admin.tuteeRequests.kind.VOLUNTARY")}</span>
            <span className="muted text-xs">{r.tutorName ?? "—"}</span>
            <span className="muted ml-auto text-xs">
              {r.eligibleAt
                ? t("admin.tuteeRequests.autoApprovesOn", {
                    date: new Date(r.eligibleAt).toLocaleDateString(),
                  })
                : ""}
            </span>
          </Row>
        ))}
      </Panel>

      {/* Crew validation + lifecycle panels (hidden when the crew module is off) */}
      {features?.CREW && (
        <>
          {/* Attendance discrepancy flags (crew validation) */}
          <Panel
            title={t("admin.activity.panels.sessionFlags.title")}
            count={openFlags.length}
            href="/admin/session-flags"
            empty={t("admin.activity.panels.sessionFlags.empty")}
            manageLabel={t("admin.activity.manage")}
          >
            {openFlags.map((f) => (
              <Row key={f.id}>
                <span className="font-medium text-slate-800">{f.tutor}</span>
                <span className="badge-red">
                  {t("admin.sessionFlags.discrepancy", { observed: f.observed, expected: f.expected })}
                </span>
                <span className="muted text-xs">{f.subject}</span>
                <span className="muted ml-auto text-xs">{new Date(f.date).toLocaleDateString()}</span>
              </Row>
            ))}
          </Panel>

          {/* Crew applications */}
          <Panel
            title={t("admin.activity.panels.crewApplications.title")}
            count={openCrewApps.length}
            href="/admin/crew"
            empty={t("admin.activity.panels.crewApplications.empty")}
            manageLabel={t("admin.activity.manage")}
          >
            {openCrewApps.map((a) => (
              <Row key={a.id}>
                <span className="font-medium text-slate-800">{a.name}</span>
                {a.gradeLevel != null && <span className="badge-slate">G{a.gradeLevel}</span>}
                <span className="muted ml-auto text-xs">{new Date(a.createdAt).toLocaleDateString()}</span>
              </Row>
            ))}
          </Panel>

          {/* Crew opt-out / reentry requests */}
          <Panel
            title={t("admin.activity.panels.crewRequests.title")}
            count={openCrewReqs.length}
            href="/admin/crew"
            empty={t("admin.activity.panels.crewRequests.empty")}
            manageLabel={t("admin.activity.manage")}
          >
            {openCrewReqs.map((r) => (
              <Row key={r.id}>
                <span className="font-medium text-slate-800">{r.member}</span>
                <span className={r.kind === "OPT_OUT" ? "badge-amber" : "badge-green"}>
                  {t(`admin.crew.reqKind.${r.kind}`)}
                </span>
                <span className="muted ml-auto text-xs">
                  {r.approvable
                    ? t("admin.crew.cooldownDone")
                    : r.eligibleAt
                      ? t("admin.crew.cooldownUntil", { date: new Date(r.eligibleAt).toLocaleDateString() })
                      : ""}
                </span>
              </Row>
            ))}
          </Panel>
        </>
      )}

      {/* Card issues (hidden when the discipline module is off) */}
      {features?.DISCIPLINE && (
        <Panel
          title={t("admin.activity.panels.cards.title")}
          count={pendingCards.length}
          href="/admin/discipline"
          empty={t("admin.activity.panels.cards.empty")}
          manageLabel={t("admin.activity.manage")}
        >
          {pendingCards.map((c) => (
            <Row key={c.id}>
              <span>{c.color === "RED" ? "🟥" : "🟨"}</span>
              <span className="font-medium text-slate-800">{c.tutee.englishName}</span>
              <span className="muted truncate text-xs">{c.reason ?? "—"}</span>
              <span className="muted ml-auto text-xs">
                {c.source === "AUTO"
                  ? t("admin.activity.panels.cards.auto")
                  : (c.issuedByTutor?.englishName ?? t("admin.activity.panels.cards.tutor"))}
              </span>
            </Row>
          ))}
        </Panel>
      )}

      {/* Attendance surveys (informational — not part of the open-items count) */}
      <Panel
        title={t("admin.activity.panels.surveys.title")}
        count={recentSessions.length}
        href="/admin/attendance"
        empty={t("admin.activity.panels.surveys.empty")}
        manageLabel={t("admin.activity.manage")}
      >
        {recentSessions.map((s) => (
          <Row key={s.id}>
            <span className="muted text-xs">{new Date(s.date).toLocaleDateString()}</span>
            <span className="font-medium text-slate-800">{s.tutor.englishName}</span>
            <span className="muted text-xs">{s.pairing.subject}</span>
            <span className="text-xs text-slate-500">{s.tutorStatus}</span>
            <span className="muted ml-auto text-xs">
              {t("admin.activity.panels.surveys.hours", { hours: s.shCount.toFixed(1) })}
            </span>
          </Row>
        ))}
      </Panel>
    </div>
  );
}

function Panel({
  title,
  count,
  href,
  empty,
  manageLabel,
  children,
}: {
  title: string;
  count?: number;
  href: string;
  empty: string;
  manageLabel: string;
  children: React.ReactNode;
}) {
  const hasItems = Children.toArray(children).length > 0;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="section-title">{title}</h2>
          {count != null && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 tabular-nums">
              {count}
            </span>
          )}
        </div>
        <Link href={href} className="link text-sm">
          {manageLabel}
        </Link>
      </div>
      <div className="divide-y divide-slate-100 px-5 pb-3">
        {hasItems ? children : <p className="muted py-2">{empty}</p>}
      </div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 py-2 text-sm">{children}</div>;
}
