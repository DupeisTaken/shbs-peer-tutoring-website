"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useDialogPending } from "./ui/modal";

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
  const common = useTranslations();
  const [open, setOpen] = useState(true);
  const [closeRequested, setCloseRequested] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reloadPending = useRef(false);
  const submitting = useRef(false);
  const utils = api.useUtils();
  const records = api.corrections.attendance.useQuery(
    { id },
    { enabled: open },
  );
  const rooms = api.admin.rooms.useQuery(undefined, { enabled: open });
  // The uncontrolled fields and expected version belong to this one draft.
  // Background refreshes cannot replace either; reopening/reload is deliberate.
  const [snapshot, setSnapshot] = useState<typeof records.data>();
  const [draftRevision, setDraftRevision] = useState(0);
  if (open && !snapshot && records.data && rooms.data)
    setSnapshot(records.data);
  const save = api.corrections.correctAttendance.useMutation({
    onSettled: () => {
      submitting.current = false;
    },
    onSuccess: async () => {
      await Promise.all([
        utils.admin.sessions.invalidate(),
        utils.corrections.attendance.invalidate(),
        utils.admin.auditLog.invalidate(),
      ]);
      setCloseRequested(true);
    },
  });
  const busy = useDialogPending(save.isPending);
  // A successful write can request collapse before mutation callbacks have settled.
  const expanded = open && (!closeRequested || busy);
  const primary = snapshot?.find(
    (s) => !s.mergeGroupId || s.mergeGroupId === s.id,
  );
  const students = [
    ...new Map(
      snapshot?.flatMap((s) => s.tutees).map((s) => [s.tuteeId, s]),
    ).values(),
  ];
  return (
    <details
      open={expanded}
      onToggle={(e) => {
        if (busy) {
          e.currentTarget.open = expanded;
          return;
        }
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) setSnapshot(undefined);
      }}
      className="text-left"
    >
      <summary
        className="link cursor-pointer"
        aria-disabled={busy}
        onClick={(event) => {
          if (busy) event.preventDefault();
          else if (!expanded) setCloseRequested(false);
        }}
      >
        {t("editAttendance")}
      </summary>
      {expanded && primary && rooms.data && (
        <form
          key={draftRevision}
          className="mt-3 max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              busy ||
              submitting.current ||
              reloadPending.current ||
              closeRequested
            )
              return;
            const data = new FormData(e.currentTarget);
            const value = (key: string) =>
              typeof data.get(key) === "string"
                ? (data.get(key) as string)
                : "";
            submitting.current = true;
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
          <fieldset
            disabled={busy || reloading}
            className="grid min-w-0 gap-4 sm:grid-cols-2"
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
                {["PRESENT", "RESCHEDULED", "EXTRA", "TUTOR_ABSENT"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {attendanceText(`tutorStatusOpt.${s}`)}
                    </option>
                  ),
                )}
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
            <p className="muted text-sm">{common("approvals.reversalHelp")}</p>
            <button className="btn-primary" disabled={busy || rooms.isLoading}>
              {t("save")}
            </button>
            {save.error &&
              (save.error.data?.approvalId ? (
                <p role="status" className="text-sm text-amber-800">
                  {common("approvals.queuedBody")}
                </p>
              ) : (
                <p role="alert" className="text-sm text-red-600">
                  {save.error.message}
                </p>
              ))}
            {save.error?.data?.code === "CONFLICT" &&
              !save.error.data.approvalId && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    if (busy || submitting.current || reloadPending.current)
                      return;
                    // Freeze this draft while its explicit read can replace it; never register GET as a write.
                    reloadPending.current = true;
                    setReloading(true);
                    try {
                      const result = await records.refetch();
                      if (result.isSuccess && result.data) {
                        setSnapshot(result.data);
                        setDraftRevision((revision) => revision + 1);
                        save.reset();
                      }
                    } finally {
                      reloadPending.current = false;
                      setReloading(false);
                    }
                  }}
                >
                  {common("academics.reload")}
                </button>
              )}
          </fieldset>
        </form>
      )}
      {expanded && records.error && <p role="alert">{records.error.message}</p>}
    </details>
  );
}
