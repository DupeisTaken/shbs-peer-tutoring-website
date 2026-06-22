"use client";

import { Children } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Single pane of glass: the current status of every kind of request/activity — tutee signups,
 * tutor applications, interview decisions, discipline cards, and attendance surveys — each
 * with a link to the page where it can be actioned (and reverted). See the "Admin philosophies"
 * note in CLAUDE.md.
 */
export default function ActivityPage() {
  const t = useTranslations();
  const tutees = api.admin.tutees.useQuery();
  const apps = api.admin.tutorApplications.useQuery();
  const cards = api.admin.disciplinaryCards.useQuery();
  const sessions = api.admin.sessions.useQuery();
  const tutorRequests = api.admin.tutorRequests.useQuery();

  const pendingTutees = (tutees.data ?? [])
    .filter((t) => t.status === "PENDING")
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const openApps = (apps.data ?? []).filter(
    (a) => a.status === "PENDING" || a.status === "INTERVIEW",
  );
  const pendingCards = (cards.data ?? []).filter((c) => c.reviewStatus === "PENDING");
  const recentSessions = (sessions.data ?? []).slice(0, 10);
  const openRequests = tutorRequests.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{t("admin.activity.title")}</h1>
        <p className="muted mt-1">{t("admin.activity.subtitle")}</p>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Counter label={t("admin.activity.counters.pendingSignups")} value={pendingTutees.length} href="/admin/requests" />
        <Counter label={t("admin.activity.counters.openApplications")} value={openApps.length} href="/admin/applications" />
        <Counter label={t("admin.activity.counters.cardsToReview")} value={pendingCards.length} href="/admin/discipline" />
        <Counter
          label={t("admin.activity.counters.tutorRequests")}
          value={openRequests.length}
          href="/admin/tutor-requests"
        />
        <Counter
          label={t("admin.activity.counters.recentSurveys")}
          value={recentSessions.length}
          href="/admin/attendance"
        />
      </div>

      {/* Tutee signups */}
      <Panel
        title={t("admin.activity.panels.tuteeSignups.title")}
        href="/admin/requests"
        empty={t("admin.activity.panels.tuteeSignups.empty")}
        manageLabel={t("admin.activity.manage")}
      >
        {pendingTutees.map((tutee, i) => (
          <Row key={tutee.id}>
            <span className="badge-slate">#{i + 1}</span>
            <span className="font-medium text-slate-800">{tutee.englishName}</span>
            <span className="muted text-xs">{tutee.firstChoice?.name ?? "—"}</span>
            <span className="muted ml-auto text-xs">
              {new Date(tutee.createdAt).toLocaleString()}
            </span>
          </Row>
        ))}
      </Panel>

      {/* Tutor applications */}
      <Panel
        title={t("admin.activity.panels.tutorApplications.title")}
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

      {/* Card issues */}
      <Panel
        title={t("admin.activity.panels.cards.title")}
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

      {/* Attendance surveys */}
      <Panel
        title={t("admin.activity.panels.surveys.title")}
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
            <span className="muted ml-auto text-xs">{t("admin.activity.panels.surveys.hours", { hours: s.shCount.toFixed(1) })}</span>
          </Row>
        ))}
      </Panel>
    </div>
  );
}

function Counter({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className={`card block p-4 transition hover:shadow-md ${value > 0 ? "ring-1 ring-accent-200" : ""}`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </Link>
  );
}

function Panel({
  title,
  href,
  empty,
  manageLabel,
  children,
}: {
  title: string;
  href: string;
  empty: string;
  manageLabel: string;
  children: React.ReactNode;
}) {
  const hasItems = Children.toArray(children).length > 0;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3">
        <h2 className="section-title">{title}</h2>
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
