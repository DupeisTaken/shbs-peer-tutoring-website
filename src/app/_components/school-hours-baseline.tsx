"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { formatSchoolHours as hours } from "~/lib/school-hours-format";
import { SchoolHoursBlockers, SchoolHoursValue } from "./school-hours-preview";
import type { useActionReview } from "./ui/action-review";
import { Button } from "./ui/button";
import { InlineNotice } from "./ui/patterns";
import { SummaryTable, TableActions, TableDetails } from "./ui/summary-table";

type Basis = RouterOutputs["schoolHours"]["baselinePreview"];
type Draft = {
  schoolAccountKey: string;
  earned: string;
  extras: string;
  deductions: string;
  crew: string;
  reviewed: boolean;
};
const fields = ["earned", "extras", "deductions", "crew"] as const;
const reviewable = (person: Basis["participants"][number], basis: Basis) =>
  person.needsReview || !basis.headReportId;
const initial = (basis: Basis) =>
  Object.fromEntries(
    basis.participants
      .filter((person) => reviewable(person, basis))
      .map((person) => [
        person.beneficiaryId,
        {
          schoolAccountKey: person.schoolAccountKey ?? "",
          earned: person.alreadyReported?.earned.toString() ?? "",
          extras: person.alreadyReported?.extras.toString() ?? "",
          deductions: person.alreadyReported?.deductions.toString() ?? "",
          crew: person.alreadyReported?.crew.toString() ?? "",
          reviewed: false,
        },
      ]),
  ) as Record<string, Draft>;

/** Opening values are intentional per-person inputs. Never infer an already
 * reported balance from current source totals or silently prefill zero. */
export function SchoolHoursBaselineEditor({
  basis,
  canReview,
  blocked,
  review,
  reload,
  refresh,
}: {
  basis: Basis;
  canReview: boolean;
  blocked: boolean;
  review: ReturnType<typeof useActionReview>;
  reload: () => Promise<Basis>;
  refresh: () => Promise<Basis>;
}) {
  const t = useTranslations("schoolHours");
  const [captured, setCaptured] = useState(basis);
  const [drafts, setDrafts] = useState(() => initial(basis));
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const mutation = api.schoolHours.reviewBaseline.useMutation();
  const stale =
    captured.contentHash !== basis.contentHash ||
    captured.baselineVersion !== basis.baselineVersion;
  const pending = captured.participants.filter((person) =>
    reviewable(person, captured),
  );
  const selected = pending.filter(
    (person) => drafts[person.beneficiaryId]?.reviewed,
  );
  const valid =
    selected.length > 0 &&
    selected.every((person) => {
      const draft = drafts[person.beneficiaryId];
      return (
        draft?.reviewed &&
        !!draft.schoolAccountKey.trim() &&
        fields.every(
          (key) =>
            draft[key].trim() !== "" &&
            Number.isFinite(Number(draft[key])) &&
            Number(draft[key]) >= 0,
        )
      );
    });
  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((previous) => ({
      ...previous,
      [id]: { ...previous[id]!, ...patch },
    }));
  const commit = () => {
    if (
      blocked ||
      stale ||
      !canReview ||
      !acknowledged ||
      !valid ||
      !reason.trim()
    )
      return;
    const participants = selected.map((person) => {
      const draft = drafts[person.beneficiaryId]!;
      return {
        beneficiaryId: person.beneficiaryId,
        schoolAccountKey: draft.schoolAccountKey.trim(),
        earned: Number(draft.earned),
        extras: Number(draft.extras),
        deductions: Number(draft.deductions),
        crew: Number(draft.crew),
        reviewed: true as const,
      };
    });
    review.open({
      key: `school-baseline:${captured.baselineVersion}:${captured.contentHash}`,
      title: t("confirmBaseline"),
      description: t("baselineReviewHelp"),
      confirmLabel: t("confirmBaseline"),
      confirmVariant: "primary",
      details: <p>{t("baselineCount", { count: participants.length })}</p>,
      commit: () =>
        mutation.mutateAsync({
          expectedContentHash: captured.contentHash,
          expectedBaselineVersion: captured.baselineVersion,
          reason: reason.trim(),
          acknowledged: true,
          participants,
        }),
      refresh: async () => {
        const fresh = await refresh();
        const submitted = new Set(
          participants.map((person) => person.beneficiaryId),
        );
        setCaptured(fresh);
        // Saving one reviewed batch must not discard another person's draft.
        // Fresh evidence still requires a new explicit per-person acknowledgement.
        setDrafts((previous) => {
          const next = initial(fresh);
          for (const id of Object.keys(next)) {
            if (!submitted.has(id) && previous[id])
              next[id] = { ...previous[id], reviewed: false };
          }
          return next;
        });
        setAcknowledged(false);
      },
      renderError: () => t("writeFailed"),
    });
  };
  return (
    <section className="space-y-3" aria-label={t("baselineTitle")}>
      <h3 className="text-sm font-semibold">{t("baselineTitle")}</h3>
      <p className="text-sm text-slate-700">{t("baselineHelp")}</p>
      <p className="muted text-sm">{t("mappingHelp")}</p>
      {basis.archivedSourceCount > 0 && (
        <InlineNotice>
          {t("archivedSources", { count: basis.archivedSourceCount })}
        </InlineNotice>
      )}
      <SchoolHoursBlockers
        blockers={basis.blockers}
        participants={basis.participants}
      />
      {stale && (
        <InlineNotice
          tone="warning"
          action={
            <Button
              size="compact"
              disabled={blocked}
              onClick={() =>
                void reload()
                  .then((fresh) => {
                    setCaptured(fresh);
                    setDrafts(initial(fresh));
                    setAcknowledged(false);
                  })
                  .catch(() => undefined)
              }
            >
              {t("reload")}
            </Button>
          }
        >
          {t("staleBaseline")}
        </InlineNotice>
      )}
      <SummaryTable label={t("baselineTitle")}>
        <thead>
          <tr>
            <th>{t("individual")}</th>
            <th className="text-right">{t("sourceTutoring")}</th>
            <th className="text-right">{t("sourceCrew")}</th>
            <th>{t("reviewState")}</th>
            <th className="table-actions-heading">{t("details")}</th>
          </tr>
        </thead>
        <tbody>
          {captured.participants.map((person) => (
            <tr key={person.beneficiaryId}>
              <td>
                {person.exportName}
                <span className="muted block text-xs">
                  {t("sourceCount", { count: person.sourceCount })}
                </span>
              </td>
              <td className="text-right tabular-nums">
                <SchoolHoursValue
                  value={
                    person.current.earned +
                    person.current.extras -
                    person.current.deductions
                  }
                  sourceSummary
                />
              </td>
              <td className="text-right tabular-nums">
                <SchoolHoursValue value={person.current.crew} sourceSummary />
              </td>
              <td>
                {t(
                  drafts[person.beneficiaryId]?.reviewed
                    ? "reviewed"
                    : person.needsReview
                      ? "needsReview"
                      : "baselineCommitted",
                )}
              </td>
              <TableActions>
                <TableDetails
                  title={person.exportName}
                  label={t(
                    reviewable(person, captured) ? "reviewPerson" : "details",
                  )}
                >
                  <p>{t("sourceEvidence")}</p>
                  <dl className="grid grid-cols-2 gap-3">
                    <dt>{t("sourceTutoring")}</dt>
                    <dd>
                      {hours(
                        person.current.earned +
                          person.current.extras -
                          person.current.deductions,
                      )}
                    </dd>
                    {fields.map((key) => (
                      <div key={key} className="contents">
                        <dt>{t(key)}</dt>
                        <dd>{hours(person.current[key])}</dd>
                      </div>
                    ))}
                  </dl>
                  {reviewable(person, captured) &&
                  drafts[person.beneficiaryId] ? (
                    <fieldset
                      disabled={!canReview || blocked || stale}
                      className="space-y-3"
                    >
                      <legend className="sr-only">
                        {t("alreadyReported")}
                      </legend>
                      <label className="block space-y-1">
                        <span className="block">{t("schoolAccount")}</span>
                        <input
                          className="input w-full"
                          maxLength={200}
                          value={drafts[person.beneficiaryId]!.schoolAccountKey}
                          onChange={(event) =>
                            update(person.beneficiaryId, {
                              schoolAccountKey: event.target.value,
                            })
                          }
                        />
                      </label>
                      <p className="font-semibold">{t("alreadyReported")}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {fields.map((key) => (
                          <label key={key} className="space-y-1">
                            <span className="block">{t(key)}</span>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              required
                              className="input w-full"
                              value={drafts[person.beneficiaryId]![key]}
                              onChange={(event) =>
                                update(person.beneficiaryId, {
                                  [key]: event.target.value,
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <label className="flex min-h-11 items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={drafts[person.beneficiaryId]!.reviewed}
                          onChange={(event) =>
                            update(person.beneficiaryId, {
                              reviewed: event.target.checked,
                            })
                          }
                        />
                        <span>{t("personAcknowledgement")}</span>
                      </label>
                    </fieldset>
                  ) : (
                    <>
                      <p className="font-semibold">{t("alreadyReported")}</p>
                      <dl className="grid grid-cols-2 gap-3">
                        {fields.map((key) => (
                          <div key={key} className="contents">
                            <dt>{t(key)}</dt>
                            <dd>
                              {person.alreadyReported
                                ? hours(person.alreadyReported[key])
                                : t("none")}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  )}
                </TableDetails>
              </TableActions>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
      {!canReview && (
        <p className="muted text-sm">{t("adminReviewRequired")}</p>
      )}
      {canReview && pending.length > 0 && (
        <fieldset className="space-y-3" disabled={blocked || stale}>
          <p className="text-sm text-slate-700">{t("baselineBatchHelp")}</p>
          <p role="status" className="text-sm font-semibold">
            {t("baselineSelectedCount", { count: selected.length })}
          </p>
          <label className="block space-y-1 text-sm">
            <span className="block">{t("baselineReason")}</span>
            <textarea
              className="input w-full"
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>{t("baselineAcknowledgement")}</span>
          </label>
          <Button
            variant="primary"
            disabled={
              !valid ||
              !acknowledged ||
              !reason.trim() ||
              review.blocked(
                `school-baseline:${captured.baselineVersion}:${captured.contentHash}`,
              )
            }
            onClick={commit}
          >
            {t("confirmBaseline")}
          </Button>
        </fieldset>
      )}
    </section>
  );
}
