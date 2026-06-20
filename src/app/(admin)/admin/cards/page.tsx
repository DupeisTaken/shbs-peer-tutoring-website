"use client";

import { useMemo, useState } from "react";

import { api } from "~/trpc/react";
import { type CardLike, disciplineStanding } from "~/lib/discipline";

type Card = {
  id: string;
  color: "YELLOW" | "RED";
  source: "TUTOR" | "AUTO";
  reason: string | null;
  reviewStatus: "PENDING" | "VALID" | "INVALID";
  reviewNote: string | null;
  createdAt: Date;
  tutee: { id: string; englishName: string };
  issuedByTutor: { englishName: string } | null;
  session: { date: Date } | null;
};

const dot = (color: "YELLOW" | "RED") => (color === "RED" ? "🟥" : "🟨");

function PendingCard({ card, onChanged }: { card: Card; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const review = api.admin.reviewCard.useMutation({ onSuccess: onChanged });

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {dot(card.color)} {card.tutee.englishName}
            <span className="muted ml-2 text-xs">
              {card.source === "AUTO" ? "auto-issued" : `by ${card.issuedByTutor?.englishName ?? "tutor"}`}
              {card.session ? ` · ${new Date(card.session.date).toLocaleDateString()}` : ""}
            </span>
          </p>
          <p className="muted mt-1 text-sm">{card.reason ?? "—"}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[12rem] flex-1"
          placeholder="Review note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="btn-secondary btn-sm"
          disabled={review.isPending}
          onClick={() =>
            review.mutate({ id: card.id, reviewStatus: "VALID", reviewNote: note || undefined })
          }
        >
          Valid
        </button>
        <button
          className="btn-secondary btn-sm"
          disabled={review.isPending}
          onClick={() =>
            review.mutate({ id: card.id, reviewStatus: "INVALID", reviewNote: note || undefined })
          }
        >
          Invalid
        </button>
      </div>
    </div>
  );
}

export default function CardsPage() {
  const utils = api.useUtils();
  const cards = api.admin.disciplinaryCards.useQuery();
  const invalidate = () => utils.admin.disciplinaryCards.invalidate();

  const all = useMemo(() => cards.data ?? [], [cards.data]);
  const pending = all.filter((c) => c.reviewStatus === "PENDING");

  // Group by tutee and compute standing from VALID cards (3 yellow = 1 red, 2 red = removal).
  const standings = useMemo(() => {
    const byTutee = new Map<string, { name: string; cards: CardLike[] }>();
    for (const c of all) {
      const entry = byTutee.get(c.tutee.id) ?? { name: c.tutee.englishName, cards: [] };
      entry.cards.push({ color: c.color, reviewStatus: c.reviewStatus });
      byTutee.set(c.tutee.id, entry);
    }
    return [...byTutee.entries()]
      .map(([id, v]) => ({ id, name: v.name, ...disciplineStanding(v.cards) }))
      .sort((a, b) => b.effectiveReds - a.effectiveReds);
  }, [all]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Discipline · cards</h1>
        <p className="muted mt-1">
          Recheck tutor-requested cards and flag each valid or invalid. Standing counts only
          valid cards (3 yellow = 1 red; 2 reds = removal-pending).
        </p>
      </div>

      <section className="card p-5">
        <h2 className="font-semibold text-slate-900">
          Pending review <span className="badge-amber ml-1">{pending.length}</span>
        </h2>
        <div className="mt-3 space-y-3">
          {pending.map((c) => (
            <PendingCard key={c.id} card={c} onChanged={invalidate} />
          ))}
          {pending.length === 0 && <p className="muted">Nothing awaiting review.</p>}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="p-5 pb-0">
          <h2 className="font-semibold text-slate-900">Tutee standing</h2>
        </div>
        <table className="data-table mt-3">
          <thead>
            <tr>
              <th>Tutee</th>
              <th>Valid 🟨</th>
              <th>Valid 🟥</th>
              <th>Effective reds</th>
              <th>Pending</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => (
              <tr key={s.id}>
                <td className="font-medium text-slate-800">{s.name}</td>
                <td>{s.validYellow}</td>
                <td>{s.validRed}</td>
                <td>{s.effectiveReds}</td>
                <td className="text-slate-500">{s.pendingYellow + s.pendingRed}</td>
                <td>
                  {s.removalPending ? (
                    <span className="badge-red">removal pending</span>
                  ) : s.effectiveReds >= 1 ? (
                    <span className="badge-amber">on warning</span>
                  ) : (
                    <span className="badge-slate">ok</span>
                  )}
                </td>
              </tr>
            ))}
            {standings.length === 0 && (
              <tr>
                <td colSpan={6} className="text-slate-500">
                  No cards on record.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
