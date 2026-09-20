"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { qualificationSnapshot } from "~/lib/qualification-applications";

/** The application card owns panel setup; this component owns additional-request decisions only. */
export function QualificationReview({
  app,
  onChanged,
}: {
  app: {
    id: string;
    status: string;
    updatedAt: Date;
    qualificationReason?: string | null;
    qualificationSnapshot?: unknown;
    decisionComment: string | null;
    requestedTutorId?: string | null;
    interviewers?: { isHead: boolean; tutor: { id: string } }[];
  };
  onChanged: () => Promise<unknown> | void;
}) {
  const t = useTranslations("qualificationRequests");
  const me = api.account.me.useQuery().data;
  const utils = api.useUtils();
  const [comment, setComment] = useState("");
  const mutation = api.qualificationApplication.decide.useMutation({
    onSuccess: async () => {
      await Promise.all([
        onChanged(),
        utils.qualificationApplication.mine.invalidate(),
        utils.subjectAvailability.options.invalidate(),
        utils.admin.tutors.invalidate(),
      ]);
    },
    onError: () => onChanged(),
  });
  const canReview =
    !!me &&
    ["ADMIN", "HEAD"].includes(me.role) &&
    me.tutorId !== app.requestedTutorId &&
    (app.status !== "INTERVIEW" ||
      (!me.tutorAccessRevoked &&
        app.interviewers?.some(
          (person) => person.isHead && person.tutor.id === me.tutorId,
        )));
  const open = app.status === "PENDING" || app.status === "INTERVIEW";
  const grants = qualificationSnapshot(app.qualificationSnapshot);
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm break-words whitespace-pre-wrap">
        {app.qualificationReason}
      </p>
      {app.decisionComment && (
        <p className="text-sm">
          {t("result", { comment: app.decisionComment })}
        </p>
      )}
      {!!grants.length && (
        <p className="text-sm">
          {t("granted", {
            subjects: grants.map((subject) => subject.name).join(", "),
          })}
        </p>
      )}
      {open && (
        <p className="muted text-sm">
          {t(app.status === "INTERVIEW" ? "interviewReview" : "directHelp")}
        </p>
      )}
      {open && !canReview && (
        <p className="muted text-sm">{t("reviewerOnly")}</p>
      )}
      {open && canReview && (
        <>
          <label
            className="block text-sm font-medium"
            htmlFor={`qualification-decision-${app.id}`}
          >
            {t("decisionNote")}
          </label>
          <textarea
            id={`qualification-decision-${app.id}`}
            className="textarea w-full"
            rows={2}
            maxLength={500}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {[true, false].map((accept) => (
              <button
                key={String(accept)}
                className={`${accept ? "btn-primary" : "btn-secondary"} min-h-11 lg:min-h-9`}
                disabled={!comment.trim() || mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    id: app.id,
                    accept,
                    comment,
                    expectedUpdatedAt: app.updatedAt,
                  })
                }
              >
                {t(accept ? "approve" : "reject")}
              </button>
            ))}
          </div>
          {mutation.error && (
            <p role="alert" className="text-sm text-red-700">
              {mutation.error.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
