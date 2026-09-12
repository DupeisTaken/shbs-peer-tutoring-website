"use client";
import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { DAY_NAMES, minToHm } from "~/lib/time";

type Request = RouterOutputs["studentWorkflow"]["mine"][number];
export function StudentWorkspace() {
  const t = useTranslations("workflow");
  const query = api.studentWorkflow.mine.useQuery();
  if (query.isLoading) return <p role="status">{t("loading")}</p>;
  if (query.error)
    return (
      <p role="alert" className="text-red-700">
        {query.error.message}
      </p>
    );
  const active = query.data?.find((r) => r.state === "OPEN");
  const quarterBlocked = query.data?.some((r) => r.state === "ABORTED");
  return (
    <div className="space-y-6">
      <nav
        aria-label={t("navigation")}
        className="flex flex-wrap gap-4 border-b border-slate-200 pb-3 text-sm"
      >
        <a className="link" href="#current-request">
          {t("current")}
        </a>
        <a className="link" href="#request-history">
          {t("processed")}
        </a>
      </nav>
      <section id="current-request" className="space-y-4">
        <h2 className="section-title">{t("current")}</h2>
        {active ? (
          <CurrentRequest key={active.id} row={active} />
        ) : (
          <div className="card space-y-3 p-6">
            <p>{t(quarterBlocked ? "abortFinal" : "noActive")}</p>
            {!quarterBlocked && (
              <Link href="/signup" className="btn-primary">
                {t("newRequest")}
              </Link>
            )}
          </div>
        )}
      </section>
      <section id="request-history" className="space-y-3">
        <h2 className="section-title">{t("processed")}</h2>
        {query.data
          ?.filter((r) => r.state !== "OPEN")
          .map((row) => (
            <div key={row.id} className="card p-5">
              <span className="badge-slate">{t(`state.${row.state}`)}</span>
              <p className="mt-2 text-sm">
                {row.subjects.map((s) => s.name).join(", ")}
              </p>
              <p className="muted mt-2 text-sm">
                {t(row.state === "ABORTED" ? "abortFinal" : "closedFinal")}
              </p>
            </div>
          ))}
        {!query.data?.some((r) => r.state !== "OPEN") && (
          <p className="muted">{t("noHistory")}</p>
        )}
      </section>
    </div>
  );
}
function CurrentRequest({ row }: { row: Request }) {
  const programFormat = useFormatter();
  const t = useTranslations("workflow");
  const utils = api.useUtils();
  const options = api.tutee.signupOptions.useQuery();
  const [slots, setSlots] = useState(row.slots.map((s) => s.id));
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<"RECALL" | "ABORT" | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => utils.studentWorkflow.mine.invalidate();
  const edit = api.studentWorkflow.editAvailability.useMutation({
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const recall = api.studentWorkflow.recall.useMutation({
    onSuccess: async () => {
      setAction(null);
      await refresh();
    },
  });
  const abort = api.studentWorkflow.applyAbort.useMutation({
    onSuccess: async () => {
      setAction(null);
      await refresh();
    },
  });
  const abortPending = row.reviews.some(
    (r) => r.kind === "STUDENT_ABORT" && r.state === "PENDING",
  );
  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-green">{t("verified")}</span>
          {row.editedAt && <span className="badge-amber">{t("edited")}</span>}
        </div>
        <p className="text-lg font-semibold">
          {row.subjects.map((s) => s.name).join(" · ")}
        </p>
        <p className="muted text-sm">
          {t("priority", { time: programFormat.dateTime(new Date(row.submittedAt), { dateStyle: "medium", timeStyle: "short" }) })}
        </p>
        <div className="border-t border-slate-100 pt-4">
          <h3 className="font-semibold">{t("assignments")}</h3>
          {row.pairings.length ? (
            row.pairings.map((p) => (
              <p key={p.id} className="mt-2 text-sm">
                {p.subject} · {p.tutor.englishName} · {DAY_NAMES[p.dayOfWeek]}{" "}
                {minToHm(p.startMin)}–{minToHm(p.endMin)}
              </p>
            ))
          ) : (
            <p className="muted mt-2">{t("waitingMatch")}</p>
          )}
        </div>
      </div>
      <section className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">{t("availability")}</h3>
          <button
            className="btn-secondary btn-sm"
            onClick={() => {
              setSlots(row.slots.map((s) => s.id));
              setEditing(!editing);
            }}
          >
            {t(editing ? "cancel" : "editAvailability")}
          </button>
        </div>
        <p className="muted text-sm">{t("availabilityHelp")}</p>
        {editing ? (
          <div className="space-y-4">
            {options.isLoading && <p role="status">{t("loading")}</p>}
            {options.error && (
              <p role="alert" className="text-red-700">
                {options.error.message}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {options.data?.slots.map((slot) => (
                <label
                  key={slot.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={slots.includes(slot.id)}
                    onChange={(e) =>
                      setSlots((prev) =>
                        e.target.checked
                          ? [...prev, slot.id]
                          : prev.filter((id) => id !== slot.id),
                      )
                    }
                  />
                  {DAY_NAMES[slot.dayOfWeek]} {minToHm(slot.startMin)}–
                  {minToHm(slot.endMin)}
                </label>
              ))}
            </div>
            <button
              className="btn-primary"
              disabled={!slots.length || edit.isPending || !options.data}
              onClick={() => edit.mutate({ id: row.id, slotIds: slots })}
            >
              {t("saveAvailability")}
            </button>
            {edit.error && <p role="alert">{edit.error.message}</p>}
          </div>
        ) : (
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {row.slots.map((slot) => (
              <li key={slot.id}>
                {DAY_NAMES[slot.dayOfWeek]} {minToHm(slot.startMin)}–
                {minToHm(slot.endMin)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h3 className="font-semibold">{t("participation")}</h3>
        <p className="mt-2 text-sm text-slate-600">
          {t(row.pairings.length ? "abortHelp" : "recallHelp")}
        </p>
        {abortPending ? (
          <p role="status" className="mt-3 font-medium">
            {t("abortPending")}
          </p>
        ) : (
          <button
            className="btn-danger btn-sm mt-4"
            onClick={() => {
              setReason("");
              setAction(row.pairings.length ? "ABORT" : "RECALL");
            }}
          >
            {t(row.pairings.length ? "applyAbort" : "recall")}
          </button>
        )}
      </section>
      {action && (
        <TimedActionDialog
          action={action}
          target={row.id}
          title={t(action === "ABORT" ? "applyAbort" : "recall")}
          message={t(
            action === "ABORT" ? "abortConsequences" : "recallConsequences",
          )}
          busy={recall.isPending || abort.isPending}
          error={recall.error?.message ?? abort.error?.message}
          canConfirm={action !== "ABORT" || !!reason.trim()}
          onCancel={() => setAction(null)}
          onConfirm={(ticket) =>
            action === "ABORT"
              ? abort.mutate({ id: row.id, reason, ticket })
              : recall.mutate({ id: row.id, ticket })
          }
        >
          {action === "ABORT" && (
            <label className="block text-sm">
              {t("reason")}
              <textarea
                className="input mt-2 w-full"
                rows={3}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
        </TimedActionDialog>
      )}
    </div>
  );
}
