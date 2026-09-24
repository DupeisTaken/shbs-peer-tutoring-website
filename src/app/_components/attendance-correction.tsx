"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

const ratings = [
  "ratingPreparedness",
  "ratingParticipation",
  "ratingUnderstanding",
  "ratingBehavior",
  "ratingProgress",
] as const;
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h! * 60 + m!;
};

/** A merged block is corrected as one unit. Server derives totals and reconciles consequences. */
export function AttendanceCorrection({ id }: { id: string }) {
  const t = useTranslations("corrections");
  const attendanceText = useTranslations("tutor.attendance");
  const [open, setOpen] = useState(true);
  const utils = api.useUtils();
  const records = api.corrections.attendance.useQuery(
    { id },
    { enabled: open },
  );
  const rooms = api.admin.rooms.useQuery(undefined, { enabled: open });
  const save = api.corrections.correctAttendance.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.admin.sessions.invalidate(),
        utils.corrections.attendance.invalidate(),
        utils.admin.auditLog.invalidate(),
      ]);
      setOpen(false);
    },
  });
  const primary = records.data?.find(
    (s) => !s.mergeGroupId || s.mergeGroupId === s.id,
  );
  const students = [
    ...new Map(
      records.data?.flatMap((s) => s.tutees).map((s) => [s.tuteeId, s]),
    ).values(),
  ];
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="text-left"
    >
      <summary className="link cursor-pointer">{t("editAttendance")}</summary>
      {open && primary && rooms.data && (
        <form
          key={primary.updatedAt.toISOString()}
          className="mt-3 grid max-w-3xl gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const value = (key: string) =>
              typeof data.get(key) === "string"
                ? (data.get(key) as string)
                : "";
            save.mutate({
              id: primary.id,
              expectedUpdatedAt: primary.updatedAt,
              reason: value("reason"),
              date:
                value("date") === primary.date.toISOString().slice(0, 10)
                  ? primary.date
                  : new Date(value("date")),
              startMin: minutes(value("start")),
              endMin: minutes(value("end")),
              tutorStatus: value("status") as typeof primary.tutorStatus,
              tutorAbsentReason: value("absence") || null,
              comments: value("comments") || null,
              online: data.has("online"),
              actualRoomId: value("room") || null,
              ratingPreparedness: value(ratings[0])
                ? Number(value(ratings[0]))
                : null,
              ratingParticipation: value(ratings[1])
                ? Number(value(ratings[1]))
                : null,
              ratingUnderstanding: value(ratings[2])
                ? Number(value(ratings[2]))
                : null,
              ratingBehavior: value(ratings[3])
                ? Number(value(ratings[3]))
                : null,
              ratingProgress: value(ratings[4])
                ? Number(value(ratings[4]))
                : null,
              tutees: students.map((s) => ({
                tuteeId: s.tuteeId,
                status: value(`status-${s.tuteeId}`) as typeof s.status,
                absenceReason: value(`absence-${s.tuteeId}`) || null,
              })),
            });
          }}
        >
          <p className="muted text-sm sm:col-span-2">{t("attendanceHelp")}</p>
          <label className="block">
            <span className="label">{t("date")}</span>
            <input
              className="input"
              name="date"
              type="date"
              required
              defaultValue={primary.date.toISOString().slice(0, 10)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["start", "end"] as const).map((key) => (
              <label key={key}>
                <span className="label">{t(key)}</span>
                <input
                  className="input"
                  type="time"
                  name={key}
                  required
                  defaultValue={clock(
                    key === "start" ? primary.startMin : primary.endMin,
                  )}
                />
              </label>
            ))}
          </div>
          <label className="block">
            <span className="label">{t("tutorStatus")}</span>
            <select
              className="select"
              name="status"
              defaultValue={primary.tutorStatus}
            >
              {["PRESENT", "RESCHEDULED", "EXTRA", "TUTOR_ABSENT"].map((s) => (
                <option key={s} value={s}>
                  {attendanceText(`tutorStatusOpt.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t("absence")}</span>
            <input
              className="input"
              name="absence"
              defaultValue={primary.tutorAbsentReason ?? ""}
            />
          </label>
          <label className="flex items-center gap-2 self-start">
            <input
              type="checkbox"
              name="online"
              defaultChecked={primary.online}
            />
            {t("online")}
          </label>
          <label className="block">
            <span className="label">{t("room")}</span>
            <select
              className="select"
              name="room"
              defaultValue={primary.actualRoomId ?? ""}
            >
              <option value="">{t("none")}</option>
              {rooms.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {students.map((s) => (
            <fieldset
              key={s.tuteeId}
              className="space-y-2 border-t border-slate-200 pt-2"
            >
              <legend className="font-medium">{s.tutee.englishName}</legend>
              <label className="block">
                <span className="label">{t("studentStatus")}</span>
                <select
                  className="select"
                  name={`status-${s.tuteeId}`}
                  defaultValue={s.status}
                >
                  {["PRESENT", "EXCUSED_ABSENT", "UNEXCUSED_ABSENT"].map(
                    (status) => (
                      <option key={status} value={status}>
                        {attendanceText(`tuteeStatusOpt.${status}`)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="block">
                <span className="label">{t("absence")}</span>
                <input
                  className="input"
                  name={`absence-${s.tuteeId}`}
                  defaultValue={s.absenceReason ?? ""}
                />
              </label>
            </fieldset>
          ))}
          <div className="grid grid-cols-2 gap-2">
            {ratings.map((key) => (
              <label key={key}>
                <span className="label">{t(key)}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={5}
                  name={key}
                  defaultValue={primary[key] ?? ""}
                />
              </label>
            ))}
          </div>
          <label className="block">
            <span className="label">{t("comments")}</span>
            <textarea
              className="input"
              name="comments"
              defaultValue={primary.comments ?? ""}
            />
          </label>
          <label className="block">
            <span className="label">{t("reason")}</span>
            <textarea className="input" name="reason" required />
          </label>
          <button
            className="btn-primary"
            disabled={save.isPending || rooms.isLoading}
          >
            {t("save")}
          </button>
          {save.error && (
            <p role="alert" className="text-sm text-red-600">
              {save.error.message}
            </p>
          )}
        </form>
      )}
      {open && records.error && <p role="alert">{records.error.message}</p>}
    </details>
  );
}
