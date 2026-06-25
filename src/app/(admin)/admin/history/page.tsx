"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { TEAM_TITLE } from "~/lib/branding";
import { useReadOnly } from "~/app/_components/read-only";

type Scope = "year" | "S1" | "S2" | "Q1" | "Q2" | "Q3" | "Q4";
type Depth = "summary" | "detailed" | "full";
type Cell = string | number | null;

/** Quote a CSV cell when it contains a comma, quote, or newline. */
function toCsv(rows: Cell[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c == null ? "" : String(c);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

/** Trigger a client-side CSV download (UTF-8 BOM so Excel reads accents correctly). */
function downloadCsv(filename: string, rows: Cell[][]) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const d = (v: string | Date) => new Date(v).toLocaleDateString();

export default function ReportsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly(); // VIEWER — PII is always masked server-side
  const periods = api.admin.periods.useQuery();

  const years = useMemo(() => {
    const set = new Set((periods.data ?? []).map((p) => p.schoolYear));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [periods.data]);

  const [schoolYear, setSchoolYear] = useState<string>("");
  const [scope, setScope] = useState<Scope>("year");
  const [depth, setDepth] = useState<Depth>("summary");
  const [maskPii, setMaskPii] = useState(false);
  const activeYear = schoolYear !== "" ? schoolYear : (years[0] ?? "");

  const report = api.admin.periodReport.useQuery(
    {
      schoolYear: activeYear,
      ...(scope === "year" ? {} : scope === "S1" || scope === "S2" ? { semester: scope } : { quarter: scope }),
      depth,
      maskPii,
    },
    { enabled: !!activeYear },
  );

  const r = report.data;
  const slug = (r?.scope.label ?? activeYear).replace(/[^\w-]+/g, "_");

  return (
    <div className="space-y-6">
      {/* Controls — hidden from the printed/PDF output. */}
      <div className="no-print space-y-4">
        <div>
          <h1 className="page-title">{t("admin.reports.title")}</h1>
          <p className="muted mt-1">{t("admin.reports.subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="label">{t("admin.reports.schoolYear")}</span>
            <select
              value={activeYear}
              onChange={(e) => setSchoolYear(e.target.value)}
              className="select field-auto min-w-32"
            >
              {years.length === 0 && <option value="">—</option>}
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="label">{t("admin.reports.scope")}</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              className="select field-auto min-w-40"
            >
              <option value="year">{t("admin.reports.wholeYear")}</option>
              <option value="S1">{t("admin.reports.s1")}</option>
              <option value="S2">{t("admin.reports.s2")}</option>
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="label">{t("admin.reports.depth")}</span>
            <select
              value={depth}
              onChange={(e) => setDepth(e.target.value as Depth)}
              className="select field-auto min-w-40"
            >
              <option value="summary">{t("admin.reports.depthSummary")}</option>
              <option value="detailed">{t("admin.reports.depthDetailed")}</option>
              <option value="full">{t("admin.reports.depthFull")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={readOnly || maskPii}
              disabled={readOnly}
              onChange={(e) => setMaskPii(e.target.checked)}
              className="accent-accent-600"
            />
            <span>{t("admin.reports.maskPii")}</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-primary btn-sm" onClick={() => window.print()} disabled={!r}>
            {t("admin.reports.print")}
          </button>
        </div>
      </div>

      {report.isLoading && <p className="muted">{t("admin.reports.loading")}</p>}

      {r && (
        <div className="print-area space-y-6">
          {/* Report header / print masthead */}
          <div className="report-keep print-masthead border-b border-slate-200 pb-3">
            <p className="print-only print-kicker">{t("admin.reports.title")}</p>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              {t("admin.reports.reportHeading", { team: TEAM_TITLE, period: r.scope.label })}
            </h2>
            <p className="muted text-xs">
              {t("admin.reports.generatedAt", { when: new Date().toLocaleString() })}
              {r.scope.masked ? ` · ${t("admin.reports.maskedNote")}` : ""}
            </p>
          </div>

          {/* Summary — grouped (hours · attendance · activity) for clarity */}
          <section className="space-y-4">
            <div className="report-section-head">
              <h3 className="section-title">{t("admin.reports.sections.summary")}</h3>
            </div>

            <StatGroup label={t("admin.reports.group.hours")} caption={t("admin.reports.hoursCaption")}>
              <Stat label={t("admin.reports.stat.total")} value={`${r.summary.hours.total.toFixed(1)} h`} primary />
              <Stat label={t("admin.reports.stat.earned")} value={`${r.summary.hours.earned.toFixed(1)} h`} />
              <Stat label={t("admin.reports.stat.extras")} value={`+${r.summary.hours.extras.toFixed(1)} h`} />
              <Stat label={t("admin.reports.stat.penalties")} value={`−${r.summary.hours.punishments.toFixed(1)} h`} />
            </StatGroup>

            <StatGroup label={t("admin.reports.group.attendance")} caption={t("admin.reports.attendanceCaption")}>
              <Stat label={t("admin.reports.stat.sessions")} value={String(r.summary.sessions)} />
              <Stat label={t("admin.reports.stat.tuteesServed")} value={String(r.summary.counts.tuteesServed)} />
              <Stat label={t("admin.reports.stat.present")} value={String(r.summary.attendance.present)} />
              <Stat label={t("admin.reports.stat.excused")} value={String(r.summary.attendance.excused)} />
              <Stat label={t("admin.reports.stat.unexcused")} value={String(r.summary.attendance.unexcused)} />
            </StatGroup>

            <StatGroup label={t("admin.reports.group.activity")}>
              <Stat label={t("admin.reports.stat.cards")} value={String(r.summary.counts.cards)} />
              <Stat label={t("admin.reports.stat.meetings")} value={String(r.summary.counts.meetings)} />
              <Stat label={t("admin.reports.stat.signups")} value={String(r.summary.counts.signups)} />
              <Stat label={t("admin.reports.stat.applications")} value={String(r.summary.counts.applications)} />
              <Stat label={t("admin.reports.stat.removals")} value={String(r.summary.counts.removals)} />
              <Stat label={t("admin.reports.stat.statusRequests")} value={String(r.summary.counts.statusRequests)} />
            </StatGroup>

            <StatGroup label={t("admin.reports.group.crew")} caption={t("admin.reports.crewCaption")}>
              <Stat label={t("admin.reports.stat.patrols")} value={String(r.summary.counts.patrols)} />
              <Stat label={t("admin.reports.stat.flags")} value={String(r.summary.counts.flags)} />
            </StatGroup>
          </section>

          {/* Per-tutor service hours */}
          <ReportTable
            title={t("admin.reports.sections.perTutor")}
            onCsv={() =>
              downloadCsv(`report_${slug}_tutors.csv`, [
                ["Tutor", "Active", "Sessions", "Earned", "Extras", "Penalties", "Total"],
                ...r.tutors.map((x) => [x.englishName, x.active ? "yes" : "no", x.sessions, x.earned.toFixed(2), x.extras.toFixed(2), x.punishments.toFixed(2), x.total.toFixed(2)]),
              ])
            }
            csvLabel={t("admin.reports.csv")}
            empty={r.tutors.length === 0 ? t("admin.reports.noData") : null}
            head={[
              t("admin.reports.col.tutor"),
              t("admin.reports.col.sessions"),
              t("admin.reports.col.earned"),
              t("admin.reports.col.extras"),
              t("admin.reports.col.penalties"),
              t("admin.reports.col.total"),
            ]}
            numericFrom={1}
          >
            {r.tutors.map((x) => (
              <tr key={x.tutorId} className={x.active ? "" : "text-slate-400"}>
                <td>{x.englishName}{!x.active && ` ${t("admin.reports.inactive")}`}</td>
                <td className="text-right">{x.sessions}</td>
                <td className="text-right">{x.earned.toFixed(1)}</td>
                <td className="text-right">{x.extras.toFixed(1)}</td>
                <td className="text-right">{x.punishments.toFixed(1)}</td>
                <td className="text-right font-semibold">{x.total.toFixed(1)}</td>
              </tr>
            ))}
          </ReportTable>

          {/* Detailed sections */}
          {depth !== "summary" && (
            <>
              <ReportTable
                title={t("admin.reports.sections.sessions")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_sessions.csv`, [
                    ["Date", "Tutor", "Subject", "Status", "Hours", "Tutees", "Comments"],
                    ...r.sessions.map((s) => [d(s.date), s.tutor, s.subject, s.tutorStatus, s.shCount.toFixed(2), s.tutees.map((tt) => `${tt.name} (${tt.status})`).join("; "), s.comments]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.sessions.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.tutor"),
                  t("admin.reports.col.subject"),
                  t("admin.reports.col.status"),
                  t("admin.reports.col.hours"),
                  t("admin.reports.col.tutees"),
                ]}
                numericFrom={4}
              >
                {r.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(s.date)}</td>
                    <td>{s.tutor}</td>
                    <td>{s.subject}</td>
                    <td className="text-slate-500">{s.tutorStatus}</td>
                    <td className="text-right">{s.shCount.toFixed(1)}</td>
                    <td className="text-slate-600">
                      {s.tutees.map((tt) => `${tt.name} (${tt.status})`).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </ReportTable>

              <ReportTable
                title={t("admin.reports.sections.cards")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_cards.csv`, [
                    ["Date", "Tutee", "Card", "Source", "Status", "Issued by", "Reason"],
                    ...r.cards.map((c) => [d(c.date), c.tutee, c.color, c.source, c.reviewStatus, c.issuedBy, c.reason]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.cards.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.tutee"),
                  t("admin.reports.col.card"),
                  t("admin.reports.col.source"),
                  t("admin.reports.col.status"),
                  t("admin.reports.col.reason"),
                ]}
              >
                {r.cards.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(c.date)}</td>
                    <td>{c.tutee}</td>
                    <td>{c.color === "RED" ? "🟥" : "🟨"}</td>
                    <td className="text-slate-500">{c.source}</td>
                    <td className="text-slate-500">{c.reviewStatus}</td>
                    <td className="text-slate-600">{c.reason ?? "—"}</td>
                  </tr>
                ))}
              </ReportTable>

              <ReportTable
                title={t("admin.reports.sections.meetings")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_meetings.csv`, [
                    ["Date", "Title", "Present", "Excused", "Unexcused"],
                    ...r.meetings.map((m) => [d(m.date), m.title, m.present, m.excused, m.unexcused]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.meetings.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.title"),
                  t("admin.reports.col.present"),
                  t("admin.reports.col.excused"),
                  t("admin.reports.col.unexcused"),
                ]}
                numericFrom={2}
              >
                {r.meetings.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(m.date)}</td>
                    <td>{m.title}</td>
                    <td className="text-right text-green-600">{m.present}</td>
                    <td className="text-right text-amber-600">{m.excused}</td>
                    <td className="text-right text-red-600">{m.unexcused}</td>
                  </tr>
                ))}
              </ReportTable>

              <ReportTable
                title={t("admin.reports.sections.meetingStats")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_meeting_attendance.csv`, [
                    ["Tutor", "Present", "Excused absent", "Unexcused absent"],
                    ...r.meetingStats.map((x) => [x.tutor, x.present, x.excused, x.unexcused]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.meetingStats.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.tutor"),
                  t("admin.meetings.status.present"),
                  t("admin.meetings.status.excusedAbsent"),
                  t("admin.meetings.status.unexcusedAbsent"),
                ]}
                numericFrom={1}
              >
                {r.meetingStats.map((x) => (
                  <tr key={x.tutorId}>
                    <td className="whitespace-nowrap">{x.tutor}</td>
                    <td className="text-right text-green-600">{x.present}</td>
                    <td className={`text-right ${x.excused > 0 ? "text-amber-600" : "text-slate-300"}`}>
                      {x.excused}
                    </td>
                    <td
                      className={`text-right font-semibold ${
                        x.unexcused > 0 ? "text-red-600" : "text-slate-300"
                      }`}
                    >
                      {x.unexcused}
                    </td>
                  </tr>
                ))}
              </ReportTable>

              <ReportTable
                title={t("admin.reports.sections.adjustments")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_adjustments.csv`, [
                    ["Date", "Tutor", "Type", "Amount", "Reason"],
                    ...r.adjustments.map((a) => [d(a.date), a.tutor, a.type, a.amount.toFixed(2), a.reason]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.adjustments.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.tutor"),
                  t("admin.reports.col.type"),
                  t("admin.reports.col.amount"),
                  t("admin.reports.col.reason"),
                ]}
                numericFrom={3}
              >
                {r.adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(a.date)}</td>
                    <td>{a.tutor}</td>
                    <td className={a.type === "PUNISHMENT" ? "text-red-600" : "text-green-600"}>{a.type}</td>
                    <td className="text-right">{a.amount.toFixed(2)}</td>
                    <td className="text-slate-600">{a.reason ?? "—"}</td>
                  </tr>
                ))}
              </ReportTable>

              {/* Crew patrols — service hours earned walking rooms (kept separate from tutoring). */}
              <ReportTable
                title={t("admin.reports.sections.crewStats")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_crew.csv`, [
                    ["Member", "Patrols", "Hours"],
                    ...r.crewStats.map((x) => [x.member, x.patrols, x.hours.toFixed(2)]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.crewStats.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.member"),
                  t("admin.reports.col.patrols"),
                  t("admin.reports.col.hours"),
                ]}
                numericFrom={1}
              >
                {r.crewStats.map((x) => (
                  <tr key={x.userId}>
                    <td className="whitespace-nowrap">{x.member}</td>
                    <td className="text-right">{x.patrols}</td>
                    <td className="text-right font-semibold">{x.hours.toFixed(1)}</td>
                  </tr>
                ))}
              </ReportTable>

              {/* Attendance discrepancy flags — crew counted fewer students than the tutor reported. */}
              <ReportTable
                title={t("admin.reports.sections.flags")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_flags.csv`, [
                    ["Date", "Tutor", "Subject", "Expected", "Observed", "State"],
                    ...r.flags.map((x) => [d(x.date), x.tutor, x.subject, x.expected, x.observed, x.state]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.flags.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.tutor"),
                  t("admin.reports.col.subject"),
                  t("admin.reports.col.expected"),
                  t("admin.reports.col.observed"),
                  t("admin.reports.col.flagState"),
                ]}
                numericFrom={3}
              >
                {r.flags.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(x.date)}</td>
                    <td>{x.tutor}</td>
                    <td>{x.subject}</td>
                    <td className="text-right">{x.expected}</td>
                    <td className="text-right font-semibold text-red-600">{x.observed}</td>
                    <td className="text-slate-500">{t(`admin.sessionFlags.state.${x.state}`)}</td>
                  </tr>
                ))}
              </ReportTable>
            </>
          )}

          {/* Full sections */}
          {depth === "full" && (
            <>
              <ReportTable
                title={t("admin.reports.sections.applications")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_applications.csv`, [
                    ["Date", "Name", "Status", "Contact"],
                    ...r.applications.map((a) => [d(a.date), a.name, a.status, a.contact]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.applications.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.name"),
                  t("admin.reports.col.status"),
                  t("admin.reports.col.contact"),
                ]}
              >
                {r.applications.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(a.date)}</td>
                    <td>{a.name}</td>
                    <td className="text-slate-500">{a.status}</td>
                    <td className="text-slate-600">{a.contact ?? "—"}</td>
                  </tr>
                ))}
              </ReportTable>

              <ReportTable
                title={t("admin.reports.sections.signups")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_signups.csv`, [
                    ["Date", "Name", "Grade", "Status", "First choice", "Second choice", "Contact"],
                    ...r.signups.map((s) => [d(s.date), s.name, s.grade, s.status, s.firstChoice, s.secondChoice, s.contact]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.signups.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.name"),
                  t("admin.reports.col.grade"),
                  t("admin.reports.col.status"),
                  t("admin.reports.col.subjects"),
                  t("admin.reports.col.contact"),
                ]}
              >
                {r.signups.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(s.date)}</td>
                    <td>{s.name}</td>
                    <td className="text-slate-500">{s.grade ?? "—"}</td>
                    <td className="text-slate-500">{s.status}</td>
                    <td className="text-slate-600">
                      {[s.firstChoice, s.secondChoice].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="text-slate-600">{s.contact ?? "—"}</td>
                  </tr>
                ))}
              </ReportTable>

              <ReportTable
                title={t("admin.reports.sections.removals")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_removals.csv`, [
                    ["Date", "Tutee", "Kind", "State"],
                    ...r.removals.map((x) => [d(x.date), x.tutee, x.kind, x.state]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.removals.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.tutee"),
                  t("admin.reports.col.kind"),
                  t("admin.reports.col.state"),
                ]}
              >
                {r.removals.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(x.date)}</td>
                    <td>{x.tutee}</td>
                    <td className="text-slate-500">{x.kind}</td>
                    <td className="text-slate-500">{x.state}</td>
                  </tr>
                ))}
              </ReportTable>

              <ReportTable
                title={t("admin.reports.sections.statusRequests")}
                onCsv={() =>
                  downloadCsv(`report_${slug}_tutor_requests.csv`, [
                    ["Date", "Tutor", "Kind", "State"],
                    ...r.statusRequests.map((x) => [d(x.date), x.tutor, x.kind, x.state]),
                  ])
                }
                csvLabel={t("admin.reports.csv")}
                empty={r.statusRequests.length === 0 ? t("admin.reports.noData") : null}
                head={[
                  t("admin.reports.col.date"),
                  t("admin.reports.col.tutor"),
                  t("admin.reports.col.kind"),
                  t("admin.reports.col.state"),
                ]}
              >
                {r.statusRequests.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-slate-500">{d(x.date)}</td>
                    <td>{x.tutor}</td>
                    <td className="text-slate-500">{x.kind}</td>
                    <td className="text-slate-500">{x.state}</td>
                  </tr>
                ))}
              </ReportTable>
            </>
          )}

          {/* Running footer — repeats on every printed page (program · period). */}
          <div className="print-running-foot">
            <span>{TEAM_TITLE}</span>
            <span>{r.scope.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className="card p-3">
      <p className="muted text-xs">{label}</p>
      <p
        className={`mt-1 font-semibold tabular-nums ${
          primary ? "text-2xl text-accent-700" : "text-xl text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** A labelled cluster of summary stats with an optional caption, kept together when printed. */
function StatGroup({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="report-keep space-y-1.5">
      <div className="report-section-head flex flex-wrap items-baseline gap-x-2">
        <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</h4>
        {caption && (
          <span className="report-caption text-[11px] font-normal text-slate-400 italic">
            {caption}
          </span>
        )}
      </div>
      {/* Auto-fit columns so a group never leaves ragged empty cells (hours = 4, attendance = 5). */}
      <div
        className="grid gap-x-5 gap-y-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))" }}
      >
        {children}
      </div>
    </div>
  );
}

/** A titled report section: a heading + a CSV button (screen only) over a data table. */
function ReportTable({
  title,
  head,
  children,
  onCsv,
  csvLabel,
  empty,
  numericFrom,
}: {
  title: string;
  head: string[];
  children: React.ReactNode;
  onCsv: () => void;
  csvLabel: string;
  empty: string | null;
  numericFrom?: number;
}) {
  return (
    <section className="space-y-2">
      <div className="report-section-head flex items-center justify-between">
        <h3 className="section-title">{title}</h3>
        <button className="no-print link text-sm" onClick={onCsv}>
          {csvLabel}
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={h} className={numericFrom != null && i >= numericFrom ? "text-right" : ""}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td colSpan={head.length} className="text-slate-500">
                  {empty}
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
