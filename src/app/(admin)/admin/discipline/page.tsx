"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { disciplineStanding } from "~/lib/discipline";
import { NativeDisclosureIcon } from "~/app/_components/icons";

/**
 * Six-slot discipline meter: a red card fills 3 slots, a yellow fills 1 (so 3 yellow = 1 red,
 * and a full 6 = 2 reds = removal). Only VALID cards count.
 */
function DisciplineSlots({ validRed, validYellow }: { validRed: number; validYellow: number }) {
  let red = validRed * 3;
  let yellow = validYellow;
  const slots = Array.from({ length: 6 }, () => {
    if (red > 0) {
      red--;
      return "red";
    }
    if (yellow > 0) {
      yellow--;
      return "yellow";
    }
    return "empty";
  });
  return (
    <span className="inline-flex gap-1 align-middle">
      {slots.map((s, i) => (
        <span
          key={i}
          className={`h-4 w-4 rounded-sm border ${
            s === "red"
              ? "border-red-600 bg-red-500"
              : s === "yellow"
                ? "border-amber-500 bg-amber-400"
                : "border-slate-200 bg-slate-100"
          }`}
        />
      ))}
    </span>
  );
}

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

function PendingCard({ card, onChanged }: { card: Card; onChanged: () => void }) {
  const t = useTranslations();
  const [note, setNote] = useState("");
  const review = api.admin.reviewCard.useMutation({
    onSuccess: onChanged,
    onError: onChanged, // refresh on a stale-write conflict so the version updates
  });

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {dot(card.color)} {card.tutee.englishName}
            <span className="muted ml-2 text-xs">
              {card.source === "AUTO"
                ? t("admin.cards.autoIssued")
                : t("admin.cards.issuedBy", {
                    name: card.issuedByTutor?.englishName ?? t("admin.cards.tutor"),
                  })}
              {card.session ? ` · ${new Date(card.session.date).toLocaleDateString()}` : ""}
            </span>
          </p>
          <p className="muted mt-1 text-sm">{card.reason ?? "—"}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[12rem] flex-1"
          placeholder={t("admin.cards.reviewNotePlaceholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="btn-secondary btn-sm"
          disabled={review.isPending}
          onClick={() =>
            review.mutate({
              id: card.id,
              reviewStatus: "VALID",
              reviewNote: note || undefined,
              expectedUpdatedAt: card.updatedAt,
            })
          }
        >
          {t("admin.cards.valid")}
        </button>
        <button
          className="btn-secondary btn-sm"
          disabled={review.isPending}
          onClick={() =>
            review.mutate({
              id: card.id,
              reviewStatus: "INVALID",
              reviewNote: note || undefined,
              expectedUpdatedAt: card.updatedAt,
            })
          }
        >
          {t("admin.cards.invalid")}
        </button>
      </div>
      {review.error && <p className="mt-1 text-sm text-red-600">{review.error.message}</p>}
    </div>
  );
}

export default function CardsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const cards = api.admin.disciplinaryCards.useQuery();
  const invalidate = () => utils.admin.disciplinaryCards.invalidate();

  const all = useMemo(() => cards.data ?? [], [cards.data]);
  const pending = all.filter((c) => c.reviewStatus === "PENDING");

  // Group by tutee and compute standing from VALID cards (3 yellow = 1 red, 2 red = removal).
  const standings = useMemo(() => {
    const byTutee = new Map<string, { name: string; cards: Card[] }>();
    for (const c of all) {
      const entry = byTutee.get(c.tutee.id) ?? { name: c.tutee.englishName, cards: [] };
      entry.cards.push(c);
      byTutee.set(c.tutee.id, entry);
    }
    return [...byTutee.entries()]
      .map(([id, v]) => ({
        id,
        name: v.name,
        cards: v.cards,
        ...disciplineStanding(
          v.cards.map((c) => ({ color: c.color, reviewStatus: c.reviewStatus })),
        ),
      }))
      .sort((a, b) => b.effectiveReds - a.effectiveReds);
  }, [all]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{t("admin.cards.title")}</h1>
        <p className="muted mt-1">{t("admin.cards.intro")}</p>
      </div>

      <section className="card p-5">
        <h2 className="section-title">
          {t("admin.cards.pendingReview")}{" "}
          <span className="badge-amber ml-1">{pending.length}</span>
        </h2>
        <div className="mt-3 space-y-3">
          {pending.map((c) => (
            <PendingCard key={c.id} card={c} onChanged={invalidate} />
          ))}
          {pending.length === 0 && <p className="muted">{t("admin.cards.nothingPending")}</p>}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="section-title">{t("admin.cards.standingHeading")}</h2>
        <p className="muted mt-1 text-xs">{t("admin.cards.standingHelp")}</p>
        <div className="mt-3 divide-y divide-slate-100">
          {standings.map((s) => (
            <details key={s.id} className="group py-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 [&::-webkit-details-marker]:hidden">
                <NativeDisclosureIcon />
                <span className="w-40 truncate font-medium text-slate-800 group-open:text-accent-700">
                  {s.name}
                </span>
                <DisciplineSlots validRed={s.validRed} validYellow={s.validYellow} />
                {s.removalPending ? (
                  <span className="badge-red">{t("admin.cards.standing.removalPending")}</span>
                ) : s.effectiveReds >= 1 ? (
                  <span className="badge-amber">{t("admin.cards.standing.onWarning")}</span>
                ) : (
                  <span className="badge-slate">{t("admin.cards.standing.ok")}</span>
                )}
                {s.pendingYellow + s.pendingRed > 0 && (
                  <span className="muted text-xs">
                    {t("admin.cards.pendingCount", { n: s.pendingYellow + s.pendingRed })}
                  </span>
                )}
              </summary>
              <ul className="mt-2 ml-1 space-y-1">
                {s.cards.map((c) => (
                  <li key={c.id} className="text-xs text-slate-600">
                    {dot(c.color)}{" "}
                    <span
                      className={
                        c.reviewStatus === "INVALID" ? "text-slate-400 line-through" : ""
                      }
                    >
                      {c.reason ?? "—"}
                    </span>{" "}
                    <span className="text-slate-400">
                      · {t(`admin.cards.reviewStatus.${c.reviewStatus}`)} ·{" "}
                      {c.source === "AUTO"
                        ? t("admin.cards.auto")
                        : (c.issuedByTutor?.englishName ?? t("admin.cards.tutor"))}
                      {c.session ? ` · ${new Date(c.session.date).toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {standings.length === 0 && (
            <p className="muted py-2">{t("admin.cards.noCardsOnRecord")}</p>
          )}
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
          <div className="mt-3 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("admin.cards.table.date")}</th>
                  <th>{t("admin.cards.table.tutee")}</th>
                  <th>{t("admin.cards.table.card")}</th>
                  <th>{t("admin.cards.table.reason")}</th>
                  <th>{t("admin.cards.table.source")}</th>
                  <th>{t("admin.cards.table.status")}</th>
                </tr>
              </thead>
              <tbody>
                {[...all]
                  .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                  .map((c) => (
                    <tr key={c.id}>
                      <td className="text-xs text-slate-500">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                      <td className="text-slate-700">{c.tutee.englishName}</td>
                      <td>{dot(c.color)}</td>
                      <td className="text-slate-600">{c.reason ?? "—"}</td>
                      <td className="text-slate-500">
                        {c.source === "AUTO"
                          ? t("admin.cards.auto")
                          : (c.issuedByTutor?.englishName ?? t("admin.cards.tutor"))}
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
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}
