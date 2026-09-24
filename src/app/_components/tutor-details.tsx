"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { AcceptanceRecords } from "./acceptance-records";
import { ProfileDialog } from "./profile-dialog";
import { useReadOnly } from "./read-only";

/** Keep the entry beside the tutor's name, within reach on horizontally scrolling rosters.
 * No detail/history query is mounted until staff explicitly open this person. */
export function TutorDetailsButton({
  tutorId,
  name,
}: {
  tutorId: string;
  name: string;
}) {
  const t = useTranslations("tutorDetails");
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (readOnly) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn-secondary btn-sm mt-2 min-h-11 text-left whitespace-normal lg:min-h-8"
        aria-label={t("openFor", { name })}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t("open")}
      </button>
      {open && (
        <ProfileDialog
          title={t("title", { name })}
          onClose={() => {
            setOpen(false);
            // Restore the exact roster entry after React removes the modal.
            requestAnimationFrame(() => trigger.current?.focus());
          }}
        >
          <TutorDetails key={tutorId} tutorId={tutorId} />
        </ProfileDialog>
      )}
    </>
  );
}

function TutorDetails({ tutorId }: { tutorId: string }) {
  const t = useTranslations("tutorDetails");
  const common = useTranslations();
  const query = api.tutorDetails.get.useQuery({ tutorId });
  if (query.isLoading) return <p role="status">{t("loading")}</p>;
  if (query.error)
    return (
      <div role="alert" className="space-y-3">
        <p>{t("error")}</p>
        <button
          className="btn-secondary min-h-11 lg:min-h-8"
          onClick={() => void query.refetch()}
        >
          {t("retry")}
        </button>
      </div>
    );
  if (!query.data) return null;
  const detail = query.data;
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label={t("account")}>
        <div className="flex flex-wrap items-center gap-2">
          {detail.badges.map((badge) => (
            <span className="badge-slate" key={badge}>
              {badge === "TRANSLATOR"
                ? common("membership.translator")
                : common(`admin.users.roles.${badge}`)}
            </span>
          ))}
          <span className="badge-slate">
            {common(`admin.tutorStatus.${detail.status}`)}
          </span>
        </div>
        {detail.alternativeNames && (
          <p className="text-sm [overflow-wrap:anywhere]">
            {detail.alternativeNames}
          </p>
        )}
        <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="muted">{t("account")}</dt>
            <dd className="mt-1">{t(detail.userId ? "linked" : "unlinked")}</dd>
          </div>
          <div>
            <dt className="muted">{common("admin.tutors.colGrade")}</dt>
            <dd className="mt-1">{detail.gradeLevel ?? "—"}</dd>
          </div>
          <div>
            <dt className="muted">{common("admin.tutors.colEmail")}</dt>
            <dd className="mt-1 [overflow-wrap:anywhere]">
              {detail.email?.trim()
                ? detail.email
                : common("accountProfile.noEmail")}
            </dd>
          </div>
          {detail.username && (
            <div>
              <dt className="muted">{t("username")}</dt>
              <dd className="mt-1 [overflow-wrap:anywhere]">
                @{detail.username}
              </dd>
            </div>
          )}
        </dl>
        {detail.tutorAccessRevoked && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm">
            {t("accessRevoked")}
          </p>
        )}
      </section>

      <section className="space-y-4" aria-labelledby={`subjects-${detail.id}`}>
        <div>
          <h3 id={`subjects-${detail.id}`} className="font-semibold">
            {t("subjects")}
          </h3>
          <p className="muted mt-1 text-sm">{t("subjectHelp")}</p>
        </div>
        {detail.groups.length === 0 && (
          <p className="muted text-sm">{t("empty")}</p>
        )}
        {detail.groups.map((group) => (
          <section
            key={group.id}
            className="overflow-hidden rounded-xl border border-slate-200"
            aria-labelledby={`group-${group.id}`}
          >
            <h4
              id={`group-${group.id}`}
              className="bg-slate-50 px-4 py-3 font-semibold [overflow-wrap:anywhere]"
            >
              {group.name}
            </h4>
            <ul className="divide-y divide-slate-200">
              {group.subjects.map((subject) => (
                <li key={subject.id} className="space-y-3 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {subject.name}
                    </p>
                    {subject.level && (
                      <span className="badge-slate">{subject.level}</span>
                    )}
                    {!subject.active && (
                      <span className="badge-slate">{t("archived")}</span>
                    )}
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="muted text-xs">{t("qualification")}</dt>
                      <dd className="mt-1 space-y-1">
                        <span
                          className={
                            subject.qualified ? "badge-green" : "badge-slate"
                          }
                        >
                          {t(
                            subject.qualified
                              ? "qualified"
                              : subject.approval === "PENDING"
                                ? "pending"
                                : subject.approval === "REJECTED"
                                  ? "rejected"
                                  : "unqualified",
                          )}
                        </span>
                        {subject.qualified &&
                          subject.approval &&
                          subject.approval !== "APPROVED" && (
                            <p className="text-xs">
                              {t(
                                subject.approval === "PENDING"
                                  ? "directPending"
                                  : "directRejected",
                              )}
                            </p>
                          )}
                        {subject.inheritedFrom.length > 0 && (
                          <p className="muted text-xs [overflow-wrap:anywhere]">
                            {t("inherited", {
                              sources: subject.inheritedFrom
                                .map((source) => source.name)
                                .join(", "),
                            })}
                          </p>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="muted text-xs">{t("willingness")}</dt>
                      <dd className="mt-1">
                        <span
                          className={
                            subject.willing === true
                              ? "badge-green"
                              : "badge-slate"
                          }
                        >
                          {t(
                            subject.willing === null
                              ? "notRecorded"
                              : subject.willing
                                ? "willing"
                                : "unwilling",
                          )}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
      {detail.userId ? (
        <AcceptanceRecords key={detail.userId} userId={detail.userId} />
      ) : (
        <section className="space-y-2 border-t border-slate-200 pt-5">
          <h3 className="font-semibold">{common("policyHistory.title")}</h3>
          <p className="muted text-sm">
            {common("accountProfile.noAccountHistory")}
          </p>
        </section>
      )}
    </div>
  );
}
