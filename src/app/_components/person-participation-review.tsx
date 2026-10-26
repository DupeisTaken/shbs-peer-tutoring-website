"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { RouterOutputs } from "~/trpc/react";
import { InlineNotice } from "./ui/patterns";

type Preview = RouterOutputs["personCombine"]["preview"];

/** Stable reasons are translated here; original source/work references remain
 * visible so staff resolve the exact work in its existing authorized workflow. */
export function PersonParticipationReview({ blockers, sources }: Pick<Preview, "blockers" | "sources">) {
  const t = useTranslations("personParticipation");
  const records = useTranslations("combineRecords");
  const format = useFormatter();
  if (!blockers.length) return <InlineNotice tone="success">{t("clear")}</InlineNotice>;
  return <section className="space-y-3" aria-label={t("title")}>
    <h3 className="font-semibold">{t("title")}</h3>
    <p className="muted text-sm">{t("help")}</p>
    {blockers.map((blocker) => <div key={blocker.id} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="font-medium text-amber-950">{t(`reason.${blocker.reason}`)}</p>
      <ul className="space-y-1 text-sm">
        {blocker.sources.map((ref) => {
          const source = sources.find((item) => item.ref.kind === ref.kind && item.ref.id === ref.id);
          return <li key={`${ref.kind}:${ref.id}`}>
            {records(`kind.${ref.kind}`)} · {source?.name ?? ref.id}
            <span className="muted block text-xs break-all">{ref.id}</span>
          </li>;
        })}
      </ul>
      {blocker.work.length > 0 && <ul className="space-y-1 text-sm">
        {blocker.work.map((work) => <li key={`${work.kind}:${work.id}`}>
          <span className="break-all">{t("workReference", { id: work.id })}</span>
          {work.dueAt && <span className="block">{t("deadline", { date: format.dateTime(work.dueAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>}
          {work.availableAt && <span className="block">{t("availableAt", { date: format.dateTime(work.availableAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>}
        </li>)}
      </ul>}
      {(blocker.blocksFinalization || blocker.blocksRetirement) &&
        <p className="text-sm">{t(blocker.blocksFinalization ? "blocksFinalization" : "blocksRetirement")}</p>}
      <Link className="link inline-flex min-h-11 items-center text-sm lg:min-h-8" href={blocker.destination}>
        {t(`destination.${blocker.destination.split("/").at(-1)}`)}
      </Link>
    </div>)}
  </section>;
}
