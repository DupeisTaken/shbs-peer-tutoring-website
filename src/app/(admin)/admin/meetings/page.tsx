"use client";

import { Button, ChoiceButton } from "~/app/_components/ui/button";
import { FormActions, StatePanel } from "~/app/_components/ui/patterns";
import { useDialog } from "~/app/_components/confirm-dialog";
import { useState } from "react";
import { useFormatter, useTranslations, useTimeZone } from "next-intl";

import { parseProgramDateTime, programDateKey } from "~/lib/program-time";
import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";
import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";

/** The statuses an admin picks directly. EXEMPT (X) is auto-applied to inactive tutors;
 *  EXCUSED_ABSENT comes only from a tutor's self-excuse and shows as a read-only badge. */
const ATTENDANCE_OPTIONS = [
  { value: "PRESENT", labelKey: "admin.meetings.status.present" },
  {
    value: "UNEXCUSED_ABSENT",
    labelKey: "admin.meetings.status.unexcusedAbsent",
  },
] as const;
type MeetingStatus =
  "PRESENT" | "EXCUSED_ABSENT" | "UNEXCUSED_ABSENT" | "EXEMPT";

export default function MeetingsPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const timeZone = useTimeZone();
  const [inputError, setInputError] = useState("");
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const { confirm, dialog } = useDialog();
  const meetings = api.admin.meetings.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const [showPast, setShowPast] = useState(false);
  const invalidate = () => utils.admin.meetings.invalidate();
  const create = api.admin.createMeeting.useMutation({
    onSuccess: async () => {
      setTitle("");
      await invalidate();
    },
  });
  const del = api.admin.deleteMeeting.useMutation({ onSuccess: invalidate });

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => programDateKey(new Date(), timeZone));
  const [time, setTime] = useState("12:00");
  const [selected, setSelected] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Meeting attendance only concerns ACTIVE tutors; the rest show as exempt (X).
  const tutorOpts = (tutors.data ?? []).map((tu) => ({
    id: tu.id,
    englishName: tu.englishName,
    active: tu.status === "ACTIVE",
    status: tu.status,
  }));

  return (
    <div className="space-y-6">
      {dialog}
      {meetings.error && (
        <StatePanel
          kind="error"
          title={t("uiPatterns.loadFailed")}
          action={
            <Button onClick={() => void meetings.refetch()}>
              {t("uiPatterns.retry")}
            </Button>
          }
        >
          {meetings.error.message}
        </StatePanel>
      )}
      {inputError && <p role="alert">{inputError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("admin.meetings.title")}</h1>
        <button
          className="btn-secondary control-standard"
          aria-expanded={showSummary}
          onClick={() => setShowSummary((v) => !v)}
        >
          {showSummary
            ? t("admin.meetings.summary.hide")
            : t("admin.meetings.summary.show")}
        </button>
      </div>

      {showSummary && (
        <MeetingSummary meetings={meetings.data ?? []} tutors={tutorOpts} />
      )}

      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) {
              try {
                setInputError("");
                create.mutate({
                  title: title.trim(),
                  date: parseProgramDateTime(
                    `${date}T${time || "00:00"}`,
                    timeZone,
                  ),
                });
              } catch (error) {
                setInputError(
                  error instanceof Error ? error.message : "Invalid date",
                );
              }
            }
          }}
        >
          {/* Preferred widths shrink to the form width at enlarged text sizes;
              fixed rem minimums would override the controls' max-width. */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("admin.meetings.titlePlaceholder")}
            aria-label={t("admin.meetings.titlePlaceholder")}
            className="input field-auto-bounded [--field-min-width:12rem]"
          />
          <input
            aria-label={t("uiPatterns.meetingDate")}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input field-auto-bounded [--field-min-width:9rem]"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label={t("admin.meetings.timeLabel")}
            className="input field-auto-bounded [--field-min-width:7rem]"
          />
          <button
            className="btn-primary"
            disabled={!title.trim() || create.isPending}
          >
            {t("admin.meetings.create")}
          </button>
        </form>
      )}

      {create.error && (
        <p role="alert" className="text-sm text-red-700">
          {create.error.message}
        </p>
      )}
      {del.error && (
        <p role="alert" className="text-sm text-red-700">
          {del.error.message}
        </p>
      )}
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <div className="card min-w-0 overflow-hidden lg:col-span-3">
          <ul className="divide-y divide-slate-100">
            {(meetings.data ?? []).map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    onClick={() => setSelected(selected === m.id ? null : m.id)}
                    aria-expanded={selected === m.id}
                    className="hover:text-accent-600 min-h-11 min-w-0 flex-1 text-left font-medium break-words text-slate-900 lg:min-h-8"
                  >
                    {m.title} ·{" "}
                    {programFormat.dateTime(new Date(m.date), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </button>
                  {!readOnly && (
                    <button
                      disabled={del.isPending}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: t("uiPatterns.deleteMeeting"),
                            message: t("uiPatterns.deleteMeetingHelp", {
                              title: m.title,
                            }),
                            confirmLabel: t("admin.meetings.delete"),
                            cancelLabel: t("uiPatterns.cancel"),
                            danger: true,
                          })
                        )
                          del.mutate({ id: m.id });
                      }}
                      className="link-danger"
                    >
                      {t("admin.meetings.delete")}
                    </button>
                  )}
                </div>
                {/* Tutor-submitted excuses surface here automatically. */}
                {(() => {
                  const ex = m.attendances.filter((a) => a.excusedAt != null);
                  if (ex.length === 0) return null;
                  return (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-xs font-semibold text-amber-800">
                        {t("admin.meetings.selfExcused", { count: ex.length })}
                      </p>
                      <ul className="mt-1 space-y-0.5 text-sm text-amber-900">
                        {ex.map((a) => (
                          <li key={a.tutorId}>
                            {a.tutor.englishName}
                            {a.reason ? ` — ${a.reason}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
                {selected === m.id && (
                  <div className="mt-3 min-w-0 space-y-3">
                    <PastTutorsToggle
                      showPast={showPast}
                      onChange={setShowPast}
                    />
                    {/* The reveal control hides unrecorded past tutors only; recorded
                        attendance stays visible and the mounted editor keeps its draft. */}
                    <AttendanceEditor
                      meetingId={m.id}
                      readOnly={readOnly}
                      tutors={visibleTutors(
                        tutorOpts,
                        showPast,
                        m.attendances.map((a) => a.tutorId),
                      )}
                      current={Object.fromEntries(
                        m.attendances.map((a) => [a.tutorId, a.status]),
                      )}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Per-tutor meeting attendance summary, alongside the list. */}
        <div className="min-w-0 lg:col-span-2">
          <TutorMeetingStats
            meetings={meetings.data ?? []}
            tutors={tutorOpts}
          />
        </div>
      </div>
    </div>
  );
}

/** Per-tutor attendance tally across all meetings (present / excused / unexcused), worst first.
 *  Shown beside the meetings list so coordinators can spot patterns at a glance. */
function TutorMeetingStats({
  meetings,
  tutors,
}: {
  meetings: MeetingRecord[];
  tutors: { id: string; englishName: string; active: boolean }[];
}) {
  const t = useTranslations();
  const tally = new Map<
    string,
    { present: number; excused: number; unexcused: number }
  >();
  for (const m of meetings) {
    for (const a of m.attendances) {
      const e = tally.get(a.tutorId) ?? {
        present: 0,
        excused: 0,
        unexcused: 0,
      };
      if (a.status === "PRESENT") e.present++;
      else if (a.status === "EXCUSED_ABSENT") e.excused++;
      else if (a.status === "UNEXCUSED_ABSENT") e.unexcused++;
      tally.set(a.tutorId, e);
    }
  }
  const rows = tutors
    .map((tu) => ({
      ...tu,
      ...(tally.get(tu.id) ?? { present: 0, excused: 0, unexcused: 0 }),
    }))
    .filter((r) => r.present + r.excused + r.unexcused > 0)
    .sort(
      (a, b) =>
        b.unexcused - a.unexcused ||
        b.excused - a.excused ||
        a.englishName.localeCompare(b.englishName),
    );

  return (
    <div className="card min-w-0 overflow-x-auto">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="section-title">{t("admin.meetings.stats.title")}</h2>
        <p className="muted mt-0.5 text-xs">{t("admin.meetings.stats.help")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="muted px-4 py-3 text-sm">
          {t("admin.meetings.stats.empty")}
        </p>
      ) : (
        <SummaryTable label={t("admin.meetings.stats.title")}>
          <thead>
            <tr>
              <th>{t("admin.meetings.stats.tutor")}</th>
              <th className="text-right">
                {t("admin.meetings.status.present")}
              </th>
              <th className="text-right">
                {t("admin.meetings.status.excusedAbsent")}
              </th>
              <th className="text-right">
                {t("admin.meetings.status.unexcusedAbsent")}
              </th>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? "" : "text-slate-400"}>
                <td className="font-medium whitespace-nowrap text-slate-700">
                  {r.englishName}
                </td>
                <td className="text-right text-green-600">{r.present}</td>
                <td
                  className={`text-right ${r.excused > 0 ? "text-amber-600" : "text-slate-300"}`}
                >
                  {r.excused}
                </td>
                <td
                  className={`text-right font-semibold ${
                    r.unexcused > 0 ? "text-red-600" : "text-slate-300"
                  }`}
                >
                  {r.unexcused}
                </td>
                <TableActions>
                  <TableDetails title={r.englishName}>
                    <MeetingRecordDetails
                      meetings={meetings}
                      tutorId={r.id}
                      active={r.active}
                    />
                  </TableDetails>
                </TableActions>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      )}
    </div>
  );
}

/** Read-only matrix: every tutor (rows) × every meeting (columns), showing attendance at a glance.
 *  Inactive tutors are exempt (X); cells with no record show a dot. */
function MeetingSummary({
  meetings,
  tutors,
}: {
  meetings: MeetingRecord[];
  tutors: { id: string; englishName: string; active: boolean }[];
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const byMeeting = new Map<string, Map<string, string>>();
  for (const m of meetings) {
    const inner = new Map<string, string>();
    for (const a of m.attendances) inner.set(a.tutorId, a.status);
    byMeeting.set(m.id, inner);
  }

  const cell = (status: string | undefined, active: boolean) => {
    if (!active)
      return {
        text: "X",
        cls: "text-slate-400",
        title: t("admin.meetings.exempt"),
      };
    switch (status) {
      case "PRESENT":
        return {
          text: "P",
          cls: "text-green-600",
          title: t("admin.meetings.status.present"),
        };
      case "EXCUSED_ABSENT":
        return {
          text: "EA",
          cls: "text-amber-600",
          title: t("admin.meetings.status.excusedAbsent"),
        };
      case "UNEXCUSED_ABSENT":
        return {
          text: "UA",
          cls: "text-red-600",
          title: t("admin.meetings.status.unexcusedAbsent"),
        };
      default:
        return { text: "·", cls: "text-slate-300", title: "—" };
    }
  };

  return (
    <div className="card overflow-hidden">
      <SummaryTable label={t("admin.meetings.summary.show")}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white">
              {t("admin.meetings.summary.tutor")}
            </th>
            {meetings.map((m) => (
              <th
                key={m.id}
                className="text-center whitespace-nowrap"
                title={m.title}
              >
                {programFormat.dateTime(new Date(m.date), {
                  dateStyle: "medium",
                })}
              </th>
            ))}
            <th className="table-actions-heading">
              {t("tablePatterns.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {tutors.map((tu) => (
            <tr key={tu.id} className={tu.active ? "" : "text-slate-400"}>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-white text-left font-medium whitespace-nowrap text-slate-700"
              >
                {tu.englishName}
              </th>
              {meetings.map((m) => {
                const c = cell(byMeeting.get(m.id)?.get(tu.id), tu.active);
                return (
                  <td
                    key={m.id}
                    className={`text-center text-xs font-semibold ${c.cls}`}
                    title={c.title}
                  >
                    {c.text}
                  </td>
                );
              })}
              <TableActions>
                <TableDetails title={tu.englishName}>
                  <MeetingRecordDetails
                    meetings={meetings}
                    tutorId={tu.id}
                    active={tu.active}
                  />
                </TableDetails>
              </TableActions>
            </tr>
          ))}
          {(meetings.length === 0 || tutors.length === 0) && (
            <tr>
              <td colSpan={meetings.length + 2} className="text-slate-500">
                {t("admin.meetings.summary.noMeetings")}
              </td>
            </tr>
          )}
        </tbody>
      </SummaryTable>
    </div>
  );
}

type MeetingRecord = {
  id: string;
  title: string;
  date: Date;
  attendances: { tutorId: string; status: string; reason?: string | null }[];
};

/** Full titles, dates and recorded absence reasons live behind the row's detail link. */
function MeetingRecordDetails({
  meetings,
  tutorId,
  active,
}: {
  meetings: MeetingRecord[];
  tutorId: string;
  active: boolean;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const statusKeys: Record<string, string> = {
    PRESENT: "admin.meetings.status.present",
    EXCUSED_ABSENT: "admin.meetings.status.excusedAbsent",
    UNEXCUSED_ABSENT: "admin.meetings.status.unexcusedAbsent",
    EXEMPT: "admin.meetings.exempt",
  };
  return (
    <ul className="space-y-4">
      {meetings.map((meeting) => {
        const record = meeting.attendances.find(
          (entry) => entry.tutorId === tutorId,
        );
        const status = record?.status ?? (!active ? "EXEMPT" : "");
        return (
          <li
            key={meeting.id}
            className="space-y-1 border-b border-slate-100 pb-3 last:border-0"
          >
            <h3 className="font-semibold">{meeting.title}</h3>
            <p className="text-slate-500">
              {format.dateTime(new Date(meeting.date), {
                dateStyle: "full",
                timeStyle: "short",
              })}
            </p>
            <p>{statusKeys[status] ? t(statusKeys[status]) : "—"}</p>
            {record?.reason && (
              <p>
                <span className="font-medium">
                  {t("tablePatterns.reason")}:{" "}
                </span>
                {record.reason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AttendanceEditor({
  meetingId,
  readOnly,
  tutors,
  current,
}: {
  meetingId: string;
  readOnly: boolean;
  tutors: { id: string; englishName: string; active: boolean }[];
  current: Record<string, string>;
}) {
  const t = useTranslations();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Record<string, MeetingStatus>>(
    () => current as Record<string, MeetingStatus>,
  );
  const save = api.admin.recordMeetingAttendance.useMutation({
    onSuccess: () => utils.admin.meetings.invalidate(),
  });

  return (
    <div className="mt-3 min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {/* Narrow rows put choices beneath names; grid items and long labels can shrink
          without clipping. Desktop keeps the compact name/choices arrangement. */}
      <div className="space-y-3 lg:space-y-1.5">
        {tutors.map((tu) => {
          // Inactive (unavailable) tutors are exempt (X) — shown grayed and not editable.
          if (!tu.active) {
            return (
              <div
                key={tu.id}
                className="flex min-w-0 flex-col items-start justify-between gap-2 text-sm text-slate-400 sm:flex-row sm:items-center"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {tu.englishName}
                </span>
                <span className="badge-slate">
                  {t("admin.meetings.exempt")}
                </span>
              </div>
            );
          }
          const value = draft[tu.id];
          // A self-excused tutor (EXCUSED_ABSENT) is shown as a read-only badge, not editable here.
          if (value === "EXCUSED_ABSENT") {
            return (
              <div
                key={tu.id}
                className="flex min-w-0 flex-col items-start justify-between gap-2 text-sm sm:flex-row sm:items-center"
              >
                <span className="min-w-0 [overflow-wrap:anywhere] text-slate-700">
                  {tu.englishName}
                </span>
                <span className="badge-amber">
                  {t("admin.meetings.status.excusedAbsent")}
                </span>
              </div>
            );
          }
          return (
            <div
              key={tu.id}
              className="flex min-w-0 flex-col items-start justify-between gap-2 text-sm sm:flex-row sm:items-center"
            >
              <span className="min-w-0 [overflow-wrap:anywhere] text-slate-700">
                {tu.englishName}
              </span>
              <div
                role="group"
                aria-label={t("uiPatterns.attendanceFor", {
                  name: tu.englishName,
                })}
                className="flex max-w-full flex-wrap gap-1 sm:justify-end"
              >
                {ATTENDANCE_OPTIONS.map((opt) => (
                  <ChoiceButton
                    key={opt.value}
                    selected={value === opt.value}
                    className="max-w-full [overflow-wrap:anywhere]"
                    disabled={readOnly || save.isPending}
                    onClick={() => {
                      setDraft((d) => ({ ...d, [tu.id]: opt.value }));
                      save.reset();
                    }}
                  >
                    {t(opt.labelKey)}
                  </ChoiceButton>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <FormActions>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              const entries = tutors
                .filter((tu) => tu.active && draft[tu.id])
                .map((tu) => ({ tutorId: tu.id, status: draft[tu.id]! }));
              save.mutate({ meetingId, entries });
            }}
            disabled={save.isPending}
          >
            {save.isPending
              ? t("admin.meetings.saving")
              : t("admin.meetings.saveAttendance")}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              setDraft(current as Record<string, MeetingStatus>);
              save.reset();
            }}
          >
            {t("uiPatterns.cancel")}
          </Button>
        </FormActions>
      )}
      {save.isSuccess && (
        <span role="status" className="ml-2 text-sm text-green-700">
          {t("admin.meetings.saved")}
        </span>
      )}
      {save.error && (
        <span role="alert" className="ml-2 text-sm text-red-700">
          {save.error.message}
        </span>
      )}
    </div>
  );
}
