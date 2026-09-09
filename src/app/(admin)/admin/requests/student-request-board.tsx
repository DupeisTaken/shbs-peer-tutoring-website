"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { DAY_NAMES, minToHm } from "~/lib/time";

type Row = RouterOutputs["studentWorkflow"]["adminRequests"][number];
type Tutor = { id: string; englishName: string };
export function StudentRequestBoard() {
  const t = useTranslations("workflow");
  const rows = api.studentWorkflow.adminRequests.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const tutors = api.admin.tutors.useQuery();
  const legacyReviews = api.studentWorkflow.legacyReviews.useQuery();
  const legacyProcessed = (legacyReviews.data ?? []).filter(
    (r) => r.state !== "PENDING",
  );
  const [tab, setTab] = useState<
    "matching" | "assigned" | "reviews" | "processed"
  >("matching");
  const groups = {
    matching: (rows.data ?? []).filter(
      (r) =>
        r.state === "OPEN" &&
        r.subjects.some((s) => !r.pairings.some((p) => p.subject === s.name)),
    ),
    assigned: (rows.data ?? []).filter(
      (r) =>
        r.state === "OPEN" &&
        r.subjects.every((s) => r.pairings.some((p) => p.subject === s.name)),
    ),
    reviews: [
      ...(rows.data ?? []).flatMap((row) =>
        row.reviews
          .filter((review) => review.state === "PENDING")
          .map((review) => ({ row, review })),
      ),
      ...(legacyReviews.data ?? [])
        .filter((r) => r.state === "PENDING")
        .map((review) => ({ row: { name: review.name }, review })),
    ],
    processed: (rows.data ?? []).filter((r) => r.state !== "OPEN"),
  };
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold">{t("boardTitle")}</h2>
        <p className="muted mt-2 max-w-3xl text-sm">{t("boardHelp")}</p>
      </div>
      <div
        role="tablist"
        aria-label={t("navigation")}
        className="flex flex-wrap gap-2"
      >
        {(["matching", "assigned", "reviews", "processed"] as const).map(
          (key) => (
            <button
              key={key}
              role="tab"
              id={`tab-${key}`}
              aria-controls="student-workflow-panel"
              aria-selected={tab === key}
              className={tab === key ? "btn-primary" : "btn-secondary"}
              onClick={() => setTab(key)}
            >
              {t(key)}{" "}
              <span className="ml-2 rounded-full bg-black/10 px-2 text-xs">
                {groups[key].length +
                  (key === "processed" ? legacyProcessed.length : 0)}
              </span>
            </button>
          ),
        )}
      </div>
      {rows.error && (
        <p role="alert" className="text-red-700">
          {rows.error.message}
        </p>
      )}
      {legacyReviews.error && (
        <p role="alert" className="text-red-700">
          {legacyReviews.error.message}
        </p>
      )}
      <div
        role="tabpanel"
        id="student-workflow-panel"
        aria-labelledby={`tab-${tab}`}
        className="space-y-3"
      >
        {rows.isLoading ? (
          <p>{t("loading")}</p>
        ) : tab === "reviews" ? (
          groups.reviews.map(({ row, review }) => (
            <ReviewCard key={review.id} row={row} review={review} />
          ))
        ) : (
          groups[tab].map((row) => (
            <RequestCard
              key={row.id}
              row={row}
              tutors={(tutors.data ?? []).filter(
                (tu) => tu.status === "ACTIVE",
              )}
            />
          ))
        )}
        {tab === "processed" &&
          legacyProcessed.map((r) => (
            <article key={r.id} className="card space-y-2 p-5">
              <h3 className="font-semibold">
                {r.name} · {t("scheduleReject")}
              </h3>
              <span className="badge-slate">{t(`reviewState.${r.state}`)}</span>
              <p className="muted text-sm">{r.reason}</p>
            </article>
          ))}
        {!rows.isLoading &&
          !groups[tab].length &&
          !(tab === "processed" && legacyProcessed.length) && (
            <p className="muted rounded-xl border border-dashed border-slate-200 p-8 text-center">
              {t("emptySection")}
            </p>
          )}
      </div>
    </section>
  );
}
function RequestCard({ row, tutors }: { row: Row; tutors: Tutor[] }) {
  const t = useTranslations("workflow");
  const utils = api.useUtils();
  const resend = api.studentWorkflow.resend.useMutation({
    onSuccess: () => utils.studentWorkflow.adminRequests.invalidate(),
  });
  return (
    <article className="card space-y-4 p-5">
      <header className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h3 className="font-semibold break-words">{row.name}</h3>
          <div className="flex flex-wrap gap-2">
            <span
              className={
                row.state !== "OPEN"
                  ? "badge-slate"
                  : row.confirmedAt
                    ? "badge-green"
                    : "badge-amber"
              }
            >
              {t(
                row.state !== "OPEN"
                  ? `state.${row.state}`
                  : row.confirmedAt
                    ? "verified"
                    : "unverified",
              )}
            </span>
            {row.editedAt && <span className="badge-amber">{t("edited")}</span>}
          </div>
          <p className="muted text-xs">
            {t("priority", {
              time: new Date(row.submittedAt).toLocaleString(),
            })}
          </p>
        </div>
        {row.state === "OPEN" && !row.confirmedAt && (
          <button
            className="btn-secondary btn-sm self-start"
            disabled={resend.isPending}
            onClick={() => resend.mutate({ id: row.id })}
          >
            {t("resend")}
          </button>
        )}
      </header>
      {!row.confirmedAt && row.verificationDueAt && row.state === "OPEN" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t("deadline", {
            time: new Date(row.verificationDueAt).toLocaleString(),
          })}
        </p>
      )}
      {resend.isSuccess && (
        <p role="status" className="text-sm">
          {t(resend.data.emailSent ? "resendSent" : "resendFailed")}
        </p>
      )}
      {resend.error && (
        <p role="alert" className="text-red-700">
          {resend.error.message}
        </p>
      )}
      <div className="grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
        <div>
          <p className="font-medium">{t("contact")}</p>
          <p className="muted mt-1 break-all">{row.email}</p>
          <p className="muted break-words">{row.contact}</p>
        </div>
        <div>
          <p className="font-medium">{t("availability")}</p>
          <p className="muted mt-1">
            {row.slots
              .map(
                (s) =>
                  `${DAY_NAMES[s.dayOfWeek]} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
              )
              .join(", ")}
          </p>
        </div>
      </div>
      {row.state === "OPEN" ? (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          {row.subjects.map((subject) => (
            <Assignment
              key={subject.id}
              row={row}
              subject={subject}
              tutors={tutors}
            />
          ))}
        </div>
      ) : (
        <p className="muted text-sm">
          {t(row.state === "ABORTED" ? "abortFinal" : "closedFinal")}
        </p>
      )}
      {row.reviews.some((r) => r.state !== "PENDING") && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">
            {t("reviewHistory")}
          </summary>
          <ul className="mt-3 space-y-2">
            {row.reviews
              .filter((r) => r.state !== "PENDING")
              .map((r) => (
                <li key={r.id}>
                  {t(
                    r.kind === "STUDENT_ABORT"
                      ? "applyAbort"
                      : "scheduleReject",
                  )}{" "}
                  · {t(`reviewState.${r.state}`)}
                  <p className="muted">{r.reason}</p>
                </li>
              ))}
          </ul>
        </details>
      )}
    </article>
  );
}
function Assignment({
  row,
  subject,
  tutors,
}: {
  row: Row;
  subject: { id: string; name: string };
  tutors: Tutor[];
}) {
  const t = useTranslations("workflow");
  const utils = api.useUtils();
  const [tutorId, setTutorId] = useState("");
  const [open, setOpen] = useState(false);
  const assign = api.studentWorkflow.assign.useMutation({
    onSuccess: async () => {
      setOpen(false);
      await Promise.all([
        utils.studentWorkflow.adminRequests.invalidate(),
        utils.admin.tutees.invalidate(),
        utils.admin.pairings.invalidate(),
      ]);
    },
  });
  const pairing = row.pairings.find((p) => p.subject === subject.name);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="min-w-36 text-sm font-medium">{subject.name}</span>
      {pairing ? (
        <span className="badge-green">{pairing.tutor.englishName}</span>
      ) : (
        <>
          <select
            aria-label={t("chooseTutor", { subject: subject.name })}
            className="select field-auto min-w-48"
            value={tutorId}
            onChange={(e) => setTutorId(e.target.value)}
          >
            <option value="">{t("selectTutor")}</option>
            {tutors.map((tu) => (
              <option key={tu.id} value={tu.id}>
                {tu.englishName}
              </option>
            ))}
          </select>
          <button
            className="btn-primary btn-sm"
            disabled={!tutorId}
            onClick={() => setOpen(true)}
          >
            {t("assign")}
          </button>
        </>
      )}
      {assign.isSuccess && !assign.data.emailSent && (
        <p role="status" className="text-amber-800">
          {t("resendFailed")}
        </p>
      )}
      {open && (
        <TimedActionDialog
          action="ASSIGN"
          target={row.id}
          title={t("assignTitle", { name: row.name })}
          message={`${subject.name} → ${tutors.find((tu) => tu.id === tutorId)?.englishName ?? ""}\n\n${t(row.confirmedAt ? "assignVerifiedConsequences" : "assignConsequences")}`}
          busy={assign.isPending}
          error={assign.error?.message}
          onCancel={() => setOpen(false)}
          onConfirm={(ticket) =>
            assign.mutate({
              id: row.id,
              subjectId: subject.id,
              tutorId,
              ticket,
            })
          }
        />
      )}
    </div>
  );
}
function ReviewCard({
  row,
  review,
}: {
  row: Pick<Row, "name">;
  review: Row["reviews"][number];
}) {
  const t = useTranslations("workflow");
  const utils = api.useUtils();
  const [decision, setDecision] = useState<boolean | null>(null);
  const resolve = api.studentWorkflow.resolveReview.useMutation({
    onSuccess: async () => {
      setDecision(null);
      await Promise.all([
        utils.studentWorkflow.adminRequests.invalidate(),
        utils.studentWorkflow.legacyReviews.invalidate(),
        utils.admin.tutees.invalidate(),
        utils.admin.pairings.invalidate(),
      ]);
    },
  });
  return (
    <article className="card space-y-4 p-5">
      <div>
        <span className="badge-amber">{t("needsReview")}</span>
        <h3 className="mt-2 font-semibold">
          {row.name} ·{" "}
          {t(review.kind === "STUDENT_ABORT" ? "applyAbort" : "scheduleReject")}
        </h3>
        {review.assignment && (
          <p className="muted mt-2 text-sm">
            {review.assignment.subject} · {review.assignment.tutor.englishName}
          </p>
        )}
      </div>
      <p className="rounded-lg bg-slate-50 p-4 text-sm whitespace-pre-wrap">
        {review.reason}
      </p>
      <div className="flex gap-3">
        <button className="btn-danger btn-sm" onClick={() => setDecision(true)}>
          {t("approve")}
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={() => setDecision(false)}
        >
          {t("deny")}
        </button>
      </div>
      {decision !== null && (
        <TimedActionDialog
          action={decision ? "APPROVE" : "DENY"}
          target={review.id}
          title={t(decision ? "approve" : "deny")}
          message={`${row.name}${review.assignment ? ` · ${review.assignment.subject} · ${review.assignment.tutor.englishName}` : ""}\n\n${t(
            !decision
              ? "denyConsequences"
              : review.kind === "STUDENT_ABORT"
                ? "approveAbortConsequences"
                : "approveScheduleConsequences",
          )}`}
          busy={resolve.isPending}
          error={resolve.error?.message}
          onCancel={() => setDecision(null)}
          onConfirm={(ticket) =>
            resolve.mutate({ id: review.id, approve: decision, ticket })
          }
        />
      )}
    </article>
  );
}
