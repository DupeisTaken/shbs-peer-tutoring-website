"use client";

import { Children } from "react";
import Link from "next/link";

import { api } from "~/trpc/react";

/**
 * Single pane of glass: the current status of every kind of request/activity — tutee signups,
 * tutor applications, interview decisions, discipline cards, and attendance surveys — each
 * with a link to the page where it can be actioned (and reverted). See the "Admin philosophies"
 * note in CLAUDE.md.
 */
export default function ActivityPage() {
  const tutees = api.admin.tutees.useQuery();
  const apps = api.admin.tutorApplications.useQuery();
  const cards = api.admin.disciplinaryCards.useQuery();
  const sessions = api.admin.sessions.useQuery();

  const pendingTutees = (tutees.data ?? [])
    .filter((t) => t.status === "PENDING")
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const openApps = (apps.data ?? []).filter(
    (a) => a.status === "PENDING" || a.status === "INTERVIEW",
  );
  const pendingCards = (cards.data ?? []).filter((c) => c.reviewStatus === "PENDING");
  const recentSessions = (sessions.data ?? []).slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Activity</h1>
        <p className="muted mt-1">
          Current status of every request across the program. Each item links to where you can
          act on it.
        </p>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Counter label="Pending signups" value={pendingTutees.length} href="/admin/requests" />
        <Counter label="Open applications" value={openApps.length} href="/admin/applications" />
        <Counter label="Cards to review" value={pendingCards.length} href="/admin/cards" />
        <Counter
          label="Recent surveys"
          value={recentSessions.length}
          href="/admin/submissions"
        />
      </div>

      {/* Tutee signups */}
      <Panel title="Tutee signup requests" href="/admin/requests" empty="No pending signups.">
        {pendingTutees.map((t, i) => (
          <Row key={t.id}>
            <span className="badge-slate">#{i + 1}</span>
            <span className="font-medium text-slate-800">{t.englishName}</span>
            <span className="muted text-xs">{t.firstChoice?.name ?? "—"}</span>
            <span className="muted ml-auto text-xs">
              {new Date(t.createdAt).toLocaleString()}
            </span>
          </Row>
        ))}
      </Panel>

      {/* Tutor applications */}
      <Panel
        title="Tutor applications"
        href="/admin/applications"
        empty="No open applications."
      >
        {openApps.map((a) => (
          <Row key={a.id}>
            <span className="font-medium text-slate-800">{a.name}</span>
            <span className="badge-amber">{a.status.toLowerCase()}</span>
            <span className="muted text-xs">
              {a.votes.length} vote{a.votes.length === 1 ? "" : "s"}
            </span>
            <span className="muted ml-auto text-xs">
              {a.interviewers.length} panelist{a.interviewers.length === 1 ? "" : "s"}
            </span>
          </Row>
        ))}
      </Panel>

      {/* Card issues */}
      <Panel title="Discipline cards to review" href="/admin/cards" empty="Nothing to review.">
        {pendingCards.map((c) => (
          <Row key={c.id}>
            <span>{c.color === "RED" ? "🟥" : "🟨"}</span>
            <span className="font-medium text-slate-800">{c.tutee.englishName}</span>
            <span className="muted truncate text-xs">{c.reason ?? "—"}</span>
            <span className="muted ml-auto text-xs">
              {c.source === "AUTO" ? "auto" : (c.issuedByTutor?.englishName ?? "tutor")}
            </span>
          </Row>
        ))}
      </Panel>

      {/* Attendance surveys */}
      <Panel
        title="Recent attendance surveys"
        href="/admin/submissions"
        empty="No surveys yet."
      >
        {recentSessions.map((s) => (
          <Row key={s.id}>
            <span className="muted text-xs">{new Date(s.date).toLocaleDateString()}</span>
            <span className="font-medium text-slate-800">{s.tutor.englishName}</span>
            <span className="muted text-xs">{s.pairing.subject}</span>
            <span className="text-xs text-slate-500">{s.tutorStatus}</span>
            <span className="muted ml-auto text-xs">{s.shCount.toFixed(1)} h</span>
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
      className={`card block p-4 transition hover:shadow-md ${value > 0 ? "ring-1 ring-indigo-200" : ""}`}
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
  children,
}: {
  title: string;
  href: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasItems = Children.toArray(children).length > 0;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <Link href={href} className="link text-sm">
          Manage →
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
