"use client";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import {
  ParticipantName,
  participantNameLabel,
} from "~/app/_components/participant-name";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { disciplineStanding } from "~/lib/discipline";
import { NativeDisclosureIcon } from "~/app/_components/icons";
import { DisciplineSlots } from "~/app/_components/discipline-slots";
import { useReadOnly } from "~/app/_components/read-only";
import { useDialogPending } from "~/app/_components/ui/modal";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";

type Card = {
  id: string;
  color: "YELLOW" | "RED";
  source: "TUTOR" | "AUTO";
  reason: string | null;
  reviewStatus: "PENDING" | "VALID" | "INVALID";
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  tutee: { id: string; englishName: string };
  issuedByTutor: { englishName: string } | null;
  session: { date: Date } | null;
};

const dot = (color: "YELLOW" | "RED") => (color === "RED" ? "🟥" : "🟨");

function PendingCard({
  card,
  onChanged,
  readBlocked,
  readFeedback,
}: {
  card: Card;
  onChanged: () => void;
  readBlocked: boolean;
  readFeedback: ReactNode;
}) {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const [note, setNote] = useState("");
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(card.updatedAt);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const reloadPending = useRef(false);
  const submitting = useRef(false);
  const review = api.admin.reviewCard.useMutation({
    onSuccess: onChanged,
    // Failed/queued writes keep the draft mounted; only explicit Reload adopts a version.
    onSettled: () => {
      submitting.current = false;
    },
  });
  // Register this write only; inherited busy freezes the note and sibling actions.
  const busy = useDialogPending(review.isPending);
  const controlsBusy = busy || reloading;
  const submit = (reviewStatus: "VALID" | "INVALID") => {
    if (
      readBlocked ||
      busy ||
      submitting.current ||
      reloadPending.current ||
      readOnly
    )
      return;
    submitting.current = true;
    review.mutate({
      id: card.id,
      reviewStatus,
      reviewNote: note || undefined,
      expectedUpdatedAt,
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      {readFeedback}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {dot(card.color)} <ParticipantName name={card.tutee.englishName} />
            <span className="muted ml-2 text-xs">
              {card.source === "AUTO"
                ? t("admin.cards.autoIssued")
                : t("admin.cards.issuedBy", {
                    name:
                      card.issuedByTutor?.englishName ?? t("admin.cards.tutor"),
                  })}
              {card.session
                ? ` · ${programFormat.dateTime(new Date(card.session.date), { dateStyle: "medium", timeZone: "UTC" })}`
                : ""}
            </span>
          </p>
          <p className="muted mt-1 text-sm">{card.reason ?? "—"}</p>
        </div>
      </div>
      {!readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            // Match the review actions while allowing the preferred width to
            // shrink inside a narrow or enlarged-text detail dialog.
            className="input field-auto-bounded control-compact flex-1 [--field-min-width:12rem] lg:min-h-8 lg:py-1"
            placeholder={t("admin.cards.reviewNotePlaceholder")}
            aria-label={t("admin.cards.reviewNotePlaceholder")}
            value={note}
            disabled={controlsBusy}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="compact"
            disabled={controlsBusy || readBlocked}
            onClick={() => submit("VALID")}
          >
            {t("admin.cards.valid")}
          </Button>
          <Button
            size="compact"
            disabled={controlsBusy || readBlocked}
            onClick={() => submit("INVALID")}
          >
            {t("admin.cards.invalid")}
          </Button>
        </div>
      )}
      {!readOnly &&
        review.error &&
        (review.error.data?.approvalId ? (
          <p role="status" className="mt-1 text-sm text-amber-800">
            {t("approvals.queuedBody")}
          </p>
        ) : (
          <p role="alert" className="mt-1 text-sm text-red-600">
            {review.error.message}
          </p>
        ))}
      {!readOnly &&
        review.error?.data?.code === "CONFLICT" &&
        !review.error.data.approvalId && (
          <button
            type="button"
            className="btn-secondary mt-2"
            disabled={controlsBusy}
            onClick={async () => {
              if (busy || submitting.current || reloadPending.current) return;
              // Reload is a read, not a registered write, but it must not reset an active save.
              reloadPending.current = true;
              setReloading(true);
              setReloadError(null);
              try {
                const latest =
                  // Explicit Reload must bypass the normal 30-second query cache.
                  (
                    await utils.admin.disciplinaryCards.fetch(undefined, {
                      staleTime: 0,
                    })
                  ).find((row) => row.id === card.id);
                if (latest) {
                  setNote(latest.reviewNote ?? "");
                  setExpectedUpdatedAt(latest.updatedAt);
                  review.reset();
                }
              } catch (error) {
                setReloadError(
                  error instanceof Error
                    ? error.message
                    : t("uiPatterns.loadFailed"),
                );
              } finally {
                reloadPending.current = false;
                setReloading(false);
              }
            }}
          >
            {t("academics.reload")}
          </button>
        )}
      {!readOnly && reloadError && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {reloadError}
        </p>
      )}
    </div>
  );
}

export default function CardsPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const cards = api.admin.disciplinaryCards.useQuery(undefined, {
    enabled: !denied,
  });
  const accessDenied =
    cards.error?.data?.code === "FORBIDDEN" ||
    cards.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.disciplinaryCards, undefined, "query"),
      });
    } else if (cards.isSuccess && !cards.isFetching) setDenied(false);
  }, [accessDenied, cards.isSuccess, cards.isFetching, queryClient]);
  const section = t("admin.cards.title");
  useSessionPageScroll({
    id: "discipline-v1",
    ready: cards.data !== undefined && !denied && !accessDenied,
    enabled: !denied && !accessDenied,
  });
  const retry = () => {
    void cards.refetch();
  };
  const readFeedback = (
    <QueryFeedback
      hasData={cards.data !== undefined}
      loading={cards.data === undefined && !cards.error}
      error={!!cards.error}
      retrying={cards.isFetching}
      loadingTitle={t("managementRecovery.loading", { section })}
      errorTitle={t(
        cards.data === undefined
          ? "managementRecovery.loadFailed"
          : "managementRecovery.refreshFailed",
        { section },
      )}
      retryLabel={t("managementRecovery.retry", { section })}
      onRetry={retry}
    />
  );
  const invalidate = () => utils.admin.disciplinaryCards.invalidate();

  const all = useMemo(() => cards.data ?? [], [cards.data]);
  const pending = all.filter((c) => c.reviewStatus === "PENDING");

  // Group by tutee and compute standing from VALID cards (3 yellow = 1 red, 2 red = removal).
  const standings = useMemo(() => {
    const byTutee = new Map<string, { name: string; cards: Card[] }>();
    for (const c of all) {
      const entry = byTutee.get(c.tutee.id) ?? {
        name: c.tutee.englishName,
        cards: [],
      };
      entry.cards.push(c);
      byTutee.set(c.tutee.id, entry);
    }
    return [...byTutee.entries()]
      .map(([id, v]) => ({
        id,
        name: v.name,
        cards: v.cards,
        ...disciplineStanding(
          v.cards.map((c) => ({
            color: c.color,
            reviewStatus: c.reviewStatus,
          })),
        ),
      }))
      .sort((a, b) => b.effectiveReds - a.effectiveReds);
  }, [all]);

  // Empty standings are meaningful only after a completed read. Cached review
  // children keep their notes/version snapshots mounted through transport errors.
  if (denied || accessDenied || cards.data === undefined)
    return (
      <div className="space-y-6">
        <h1 className="page-title">{section}</h1>
        {denied || accessDenied ? (
          <StatePanel
            kind="denied"
            title={t("managementRecovery.denied", { section })}
            action={
              <Button
                size="compact"
                disabled={cards.isFetching}
                onClick={retry}
              >
                {t("managementRecovery.retry", { section })}
              </Button>
            }
          />
        ) : (
          readFeedback
        )}
      </div>
    );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{t("admin.cards.title")}</h1>
        <p className="muted mt-1">{t("admin.cards.intro")}</p>
      </div>

      {readFeedback}

      <section className="card p-5">
        <h2 className="section-title">
          {t("admin.cards.pendingReview")}{" "}
          <span className="badge-amber ml-1">{pending.length}</span>
        </h2>
        <div className="mt-3">
          <SummaryTable label={t("admin.cards.pendingReview")}>
            <thead>
              <tr>
                <th>{t("admin.cards.table.tutee")}</th>
                <th>{t("admin.cards.table.card")}</th>
                <th>{t("admin.cards.table.status")}</th>
                <th className="table-actions-heading">
                  {t("tablePatterns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {pending.map((c) => (
                <tr key={c.id}>
                  <td>
                    <ParticipantName name={c.tutee.englishName} />
                  </td>
                  <td>{dot(c.color)}</td>
                  <td>{t(`admin.cards.reviewStatus.${c.reviewStatus}`)}</td>
                  <TableActions>
                    <TableDetails
                      label={t(
                        readOnly
                          ? "tablePatterns.details"
                          : "tablePatterns.edit",
                      )}
                      title={`${participantNameLabel(c.tutee.englishName, undefined, t("participantNames.unnamed"))} · ${t("admin.cards.pendingReview")}`}
                    >
                      <PendingCard
                        card={c}
                        onChanged={invalidate}
                        readBlocked={!!cards.error}
                        readFeedback={readFeedback}
                      />
                    </TableDetails>
                  </TableActions>
                </tr>
              ))}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {t("admin.cards.nothingPending")}
                  </td>
                </tr>
              )}
            </tbody>
          </SummaryTable>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="section-title">{t("admin.cards.standingHeading")}</h2>
        <p className="muted mt-1 text-xs">{t("admin.cards.standingHelp")}</p>
        <div className="mt-3">
          <SummaryTable sortable label={t("admin.cards.standingHeading")}>
            <thead>
              <tr>
                <th>{t("admin.cards.table.tutee")}</th>
                <th>{t("admin.cards.table.card")}</th>
                <th>{t("admin.cards.table.status")}</th>
                <th className="table-actions-heading">
                  {t("tablePatterns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={s.id}>
                  <td
                    data-sort-value={s.name ?? ""}
                    className="font-medium text-slate-800"
                  >
                    <ParticipantName name={s.name} />
                  </td>
                  <td data-sort-value={s.effectiveReds}>
                    <DisciplineSlots
                      validRed={s.validRed}
                      validYellow={s.validYellow}
                    />
                  </td>
                  <td>
                    {s.removalPending ? (
                      <span className="badge-red">
                        {t("admin.cards.standing.removalPending")}
                      </span>
                    ) : s.effectiveReds >= 1 ? (
                      <span className="badge-amber">
                        {t("admin.cards.standing.onWarning")}
                      </span>
                    ) : (
                      <span className="badge-slate">
                        {t("admin.cards.standing.ok")}
                      </span>
                    )}
                    {s.pendingYellow + s.pendingRed > 0 && (
                      <span className="muted text-xs">
                        {t("admin.cards.pendingCount", {
                          n: s.pendingYellow + s.pendingRed,
                        })}
                      </span>
                    )}
                  </td>
                  <TableActions>
                    <TableDetails
                      title={participantNameLabel(
                        s.name,
                        undefined,
                        t("participantNames.unnamed"),
                      )}
                    >
                      <ul className="space-y-3">
                        {s.cards.map((c) => (
                          <li key={c.id} className="text-xs text-slate-600">
                            {dot(c.color)}{" "}
                            <span
                              className={
                                c.reviewStatus === "INVALID"
                                  ? "text-slate-400 line-through"
                                  : ""
                              }
                            >
                              {c.reason ?? "—"}
                            </span>{" "}
                            <span className="text-slate-400">
                              ·{" "}
                              {t(`admin.cards.reviewStatus.${c.reviewStatus}`)}{" "}
                              ·{" "}
                              {c.source === "AUTO"
                                ? t("admin.cards.auto")
                                : (c.issuedByTutor?.englishName ??
                                  t("admin.cards.tutor"))}
                              {c.session
                                ? ` · ${programFormat.dateTime(new Date(c.session.date), { dateStyle: "medium", timeZone: "UTC" })}`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </TableDetails>
                  </TableActions>
                </tr>
              ))}
              {standings.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {t("admin.cards.noCardsOnRecord")}
                  </td>
                </tr>
              )}
            </tbody>
          </SummaryTable>
        </div>
      </section>

      {/* Full history (collapsed by default) */}
      <section className="card p-5">
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 [&::-webkit-details-marker]:hidden">
            <NativeDisclosureIcon />
            <h2 className="section-title">{t("admin.cards.historyHeading")}</h2>
            <span className="badge-slate">{all.length}</span>
          </summary>
          <div className="mt-3">
            <SummaryTable label={t("admin.cards.historyHeading")}>
              <thead>
                <tr>
                  <th>{t("admin.cards.table.date")}</th>
                  <th>{t("admin.cards.table.tutee")}</th>
                  <th>{t("admin.cards.table.card")}</th>
                  <th>{t("admin.cards.table.source")}</th>
                  <th>{t("admin.cards.table.status")}</th>
                  <th className="table-actions-heading">
                    {t("tablePatterns.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...all]
                  .sort(
                    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
                  )
                  .map((c) => (
                    <tr key={c.id}>
                      <td className="text-xs text-slate-500">
                        {programFormat.dateTime(new Date(c.createdAt), {
                          dateStyle: "medium",
                        })}
                      </td>
                      <td className="text-slate-700">{c.tutee.englishName}</td>
                      <td>{dot(c.color)}</td>
                      <td className="text-slate-500">
                        {c.source === "AUTO"
                          ? t("admin.cards.auto")
                          : (c.issuedByTutor?.englishName ??
                            t("admin.cards.tutor"))}
                      </td>
                      <td>
                        <span
                          className={
                            c.reviewStatus === "VALID"
                              ? "badge-green"
                              : c.reviewStatus === "INVALID"
                                ? "badge-slate"
                                : "badge-amber"
                          }
                        >
                          {t(`admin.cards.reviewStatus.${c.reviewStatus}`)}
                        </span>
                      </td>
                      <TableActions>
                        <TableDetails
                          title={`${c.tutee.englishName} · ${programFormat.dateTime(new Date(c.createdAt), { dateStyle: "medium" })}`}
                        >
                          <dl className="space-y-2">
                            <dt className="font-semibold">
                              {t("admin.cards.table.reason")}
                            </dt>
                            <dd>{c.reason ?? "—"}</dd>
                            <dt className="font-semibold">
                              {t("admin.cards.reviewNotePlaceholder")}
                            </dt>
                            <dd>{c.reviewNote ?? "—"}</dd>
                            <dt className="font-semibold">
                              {t("admin.cards.table.source")}
                            </dt>
                            <dd>
                              {c.source === "AUTO"
                                ? t("admin.cards.auto")
                                : (c.issuedByTutor?.englishName ??
                                  t("admin.cards.tutor"))}
                            </dd>
                          </dl>
                        </TableDetails>
                      </TableActions>
                    </tr>
                  ))}
                {all.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-slate-500">
                      {t("admin.cards.tableEmpty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </SummaryTable>
          </div>
        </details>
      </section>
    </div>
  );
}
