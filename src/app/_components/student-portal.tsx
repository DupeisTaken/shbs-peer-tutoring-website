"use client";
import { formText } from "~/lib/form-values";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { minToHm, DAY_NAMES } from "~/lib/time";
import { useDialog } from "./confirm-dialog";

export function StudentPortal() {
  const t = useTranslations("workflows");
  const [page, setPage] = useState(0);
  const data = api.student.me.useQuery({ page });
  const shared = api.student.feedbackSettings.useQuery();
  const { promptText, dialog } = useDialog();
  const appeal = api.student.appeal.useMutation({
    onSuccess: () => data.refetch(),
  });
  if (data.error) return <p role="alert">{data.error.message}</p>;
  if (!data.data) return <p>{t("loading")}</p>;
  const { student, sessions, cards, appeals } = data.data;
  return (
    <div className="space-y-6">
      {dialog}
      <section className="card p-6">
        <h2 className="section-title">{t("schedule")}</h2>
        {!student?.pairings.length && (
          <p className="muted mt-3">{t("empty")}</p>
        )}
        {student?.pairings.map(({ pairing: p }, i) => (
          <div key={i} className="mt-3 rounded-lg bg-slate-50 p-4">
            <p className="font-semibold">
              {p.subject} · {p.tutor.englishName}
            </p>
            <p className="muted">
              {DAY_NAMES[p.dayOfWeek]} · {minToHm(p.startMin)}–
              {minToHm(p.endMin)} · {p.room?.name}
            </p>
          </div>
        ))}
      </section>
      <section className="card space-y-4 p-6">
        <h2 className="section-title">{t("attendance")}</h2>
        <p className="muted text-sm">
          {t(shared.data ? "sharedFeedback" : "privateFeedback")}
        </p>
        {!sessions.length && <p>{t("empty")}</p>}
        {sessions.map((row) => (
          <div
            key={row.session.id}
            className="rounded-lg border border-slate-200 p-4"
          >
            <p className="font-medium">
              {row.session.date.toLocaleDateString()} ·{" "}
              {row.session.pairing.subject} · {row.status}
            </p>
            <FeedbackForm sessionId={row.session.id} initial={row.feedback} />
          </div>
        ))}
      </section>
      <section className="card space-y-4 p-6">
        <h2 className="section-title">{t("cards")}</h2>
        {!cards.length && <p className="muted">{t("empty")}</p>}
        {cards.map((card) => (
          <div key={card.id} className="rounded-lg border border-slate-200 p-4">
            <p className="font-medium">
              {card.color} · {card.reviewStatus}
            </p>
            <p>{card.reason}</p>
            <p className="muted text-xs">
              {t("deadline")}: {card.deadline.toLocaleString()}
            </p>
            <button
              className="btn-secondary mt-3"
              disabled={
                appeal.isPending ||
                appeals.some((a) => a.cardId === card.id) ||
                card.deadline < new Date()
              }
              onClick={async () => {
                const body = await promptText({
                  title: t("appeal"),
                  reasonLabel: t("body"),
                  confirmLabel: t("submit"),
                  cancelLabel: t("cancel"),
                  required: true,
                });
                if (body) appeal.mutate({ cardId: card.id, body });
              }}
            >
              {t("appeal")}
            </button>
          </div>
        ))}
        {appeal.error && <p role="alert">{appeal.error.message}</p>}
      </section>
      <section className="card space-y-3 p-6">
        <h2 className="section-title">{t("appeals")}</h2>
        {!appeals.length && <p className="muted">{t("empty")}</p>}
        {appeals.map((a) => (
          <div key={a.id} className="border-b border-slate-100 py-3">
            <p>{a.body}</p>
            <p className="muted">
              {a.state} · {a.decision}
            </p>
          </div>
        ))}
      </section>
      <Pager
        page={page}
        setPage={setPage}
        more={
          sessions.length === 20 || cards.length === 20 || appeals.length === 20
        }
      />
    </div>
  );
}
function FeedbackForm({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: { rating: number; body: string } | null;
}) {
  const t = useTranslations("workflows");
  const save = api.student.feedback.useMutation();
  return (
    <details className="mt-3">
      <summary className="link cursor-pointer">{t("feedback")}</summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          save.mutate({
            sessionId,
            rating: Number(d.get("rating")),
            body: formText(d, "body"),
          });
        }}
      >
        <label className="block">
          <span className="label">{t("rating")}</span>
          <input
            className="input w-24"
            type="number"
            name="rating"
            min={1}
            max={5}
            required
            defaultValue={initial?.rating ?? 4}
          />
        </label>
        <label className="block">
          <span className="label">{t("body")}</span>
          <textarea
            name="body"
            defaultValue={initial?.body ?? ""}
            className="input w-full"
            maxLength={2000}
            required
          />
        </label>
        <button className="btn-primary" disabled={save.isPending}>
          {t("save")}
        </button>
        {save.isSuccess && <p role="status">{t("saved")}</p>}
        {save.error && <p role="alert">{save.error.message}</p>}
      </form>
    </details>
  );
}
export function Pager({
  page,
  setPage,
  more,
}: {
  page: number;
  setPage: (p: number) => void;
  more: boolean;
}) {
  const t = useTranslations("workflows");
  return (
    <nav className="flex gap-3">
      <button
        className="btn-secondary"
        disabled={!page}
        onClick={() => setPage(page - 1)}
      >
        {t("previous")}
      </button>
      <button
        className="btn-secondary"
        disabled={!more}
        onClick={() => setPage(page + 1)}
      >
        {t("next")}
      </button>
    </nav>
  );
}
