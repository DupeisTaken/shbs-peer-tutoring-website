"use client";

import { useState } from "react";
import Link from "next/link";
import {
  RecruitmentNotice,
  useRecruitmentStatus,
} from "~/app/_components/recruitment-notice";
import { useLocale, useTranslations } from "next-intl";

import {
  signupSettings,
  fieldMissing,
  subjectFieldKey,
  normalizeTutorSubject,
  missingTutorSubject,
} from "~/lib/signup-fields";
import { api } from "~/trpc/react";
import { useBranding } from "~/app/_components/branding-provider";
import { PolicyAgreement } from "~/app/_components/policy-agreement";

type CourseRow = {
  subjectId: string;
  taken: boolean | undefined;
  grade: string;
  hasApScore: boolean | undefined;
  apScore: string;
  selfStudied: boolean | undefined;
  selfStudyNote: string;
};

const emptyRow: CourseRow = {
  subjectId: "",
  taken: undefined,
  grade: "",
  hasApScore: undefined,
  apScore: "",
  selfStudied: undefined,
  selfStudyNote: "",
};

export function TutorSignupForm() {
  const { APP_TITLE } = useBranding();
  const t = useTranslations();
  const locale = useLocale();
  const options = api.application.options.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const policy = api.application.policy.useQuery({ locale });
  const submit = api.application.submit.useMutation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
  const [rows, setRows] = useState<CourseRow[]>(
    Array.from({ length: 3 }, () => ({ ...emptyRow })),
  );
  const [agreedRevision, setAgreedRevision] = useState<string | null>(null);
  const agreed =
    !!policy.data?.revision && agreedRevision === policy.data.revision;

  const courses = options.data?.subjects ?? [];
  const fields = options.data?.fields ?? signupSettings(null).tutor;

  const setRow = (i: number, patch: Partial<CourseRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const visibleRows = rows.filter(
    (_, i) => fields[subjectFieldKey(i)] !== "hidden",
  );
  const chosen = visibleRows.map((r) => r.subjectId).filter(Boolean);
  const requiredSubjectsComplete = rows.every(
    (row, i) => !fieldMissing(fields, subjectFieldKey(i), row.subjectId),
  );
  const qualificationsComplete = visibleRows
    .filter((r) => r.subjectId)
    .every((row) => {
      const isAp =
        courses.find((c) => c.id === row.subjectId)?.level?.apScored ?? false;
      return (
        missingTutorSubject(
          normalizeTutorSubject(row, fields, isAp),
          fields,
          isAp,
        ).length === 0
      );
    });
  const status = useRecruitmentStatus(options.data?.recruitment);
  const missing = [
    ...(!courses.length ? ["subjects"] : []),

    ...(!policy.data?.body?.trim() || !policy.data?.revision ? ["policy"] : []),
  ];
  const readOnly = status !== "open" || missing.length > 0;
  const canSubmit =
    !readOnly &&
    name.trim() &&
    email.trim() &&
    !fieldMissing(fields, "preferredContact", preferredContact) &&
    requiredSubjectsComplete &&
    qualificationsComplete &&
    policy.data?.revision &&
    chosen.length >= 1 &&
    new Set(chosen).size === chosen.length &&
    agreed &&
    !submit.isPending;

  if (submit.isSuccess) {
    return (
      <div className="card p-8 text-center">
        <h2 className="text-xl font-semibold text-slate-900">
          {t("public.tutorSignup.successTitle")}
        </h2>
        <p className="muted mt-2">
          {t("public.tutorSignup.successBody", {
            name: name.trim(),
            email: email.trim(),
          })}
        </p>
        <p className="muted mt-4">{t("public.applicationRetryNotice")}</p>
        <p className="muted mt-4">
          {t("public.tutorSignup.journey.registerHelp")}
        </p>
        <Link
          href="/register"
          className="btn-secondary mt-4 min-h-11 lg:min-h-10"
        >
          {t("public.tutorSignup.haveCode")}
        </Link>
      </div>
    );
  }

  // An empty picker or an unreadable policy is not an actionable application form.
  // Keep retry local to these reads; submitting again is never the recovery action.
  if (options.isError || policy.isError)
    return (
      <section className="card space-y-4 p-6">
        <p role="alert">{t("public.tutorSignup.loadFailed")}</p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            void options.refetch();
            void policy.refetch();
          }}
        >
          {t("survey.retry")}
        </button>
      </section>
    );
  if (options.isLoading || policy.isLoading)
    return (
      <p role="status" className="card p-6">
        {t("workflows.loading")}
      </p>
    );
  return (
    <>
      {readOnly && (
        <RecruitmentNotice
          status={status}
          missing={missing}
          window={options.data?.recruitment}
          policy={policy.data}
        />
      )}
      <form
        className="card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit || !policy.data) return;
          submit.mutate({
            name: name.trim(),
            email: email.trim(),
            agreed: true,
            policyRevision: policy.data.revision,
            preferredContact:
              fields.preferredContact === "hidden"
                ? ""
                : preferredContact.trim(),
            // Keep all three positions so a hidden second choice cannot shift the third.
            subjects: rows.map((row, i) =>
              fields[subjectFieldKey(i)] === "hidden"
                ? { subjectId: "" }
                : normalizeTutorSubject(
                    row,
                    fields,
                    courses.find((c) => c.id === row.subjectId)?.level
                      ?.apScored ?? false,
                  ),
            ),
          });
        }}
      >
        {/* Native fieldset prevents mouse, keyboard and assistive-input edits in preview mode. */}
        <fieldset
          disabled={readOnly}
          className="min-w-0 space-y-6"
          aria-label={t("recruitment.responses")}
        >
          <div>
            <p className="label">{t("public.tutorSignup.fields.courses")}</p>
            <p className="muted mb-2">{t("public.tutorSignup.coursesHelp")}</p>
            <div className="space-y-3">
              {rows.map((row, i) => {
                if (fields[subjectFieldKey(i)] === "hidden") return null;
                const usedElsewhere = rows
                  .filter(
                    (_, idx) =>
                      idx !== i && fields[subjectFieldKey(idx)] !== "hidden",
                  )
                  .map((r) => r.subjectId);
                const selected = courses.find((c) => c.id === row.subjectId);
                // Preview includes conditional AP questions without requiring a subject selection.
                const isAp = readOnly || (selected?.level?.apScored ?? false);
                return (
                  <div
                    key={i}
                    className="space-y-3 rounded-lg border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1 space-y-1">
                        <span className="label">
                          {t(`signupFields.labels.${subjectFieldKey(i)}`)}{" "}
                          <span className="muted inline-block text-xs">
                            {t(`signupFields.${fields[subjectFieldKey(i)]}`)}
                          </span>
                        </span>
                        <select
                          className="select field-auto min-h-11 max-w-full min-w-0 lg:min-h-10"
                          aria-describedby={
                            selected ? `tutor-subject-${i}` : undefined
                          }
                          required={fields[subjectFieldKey(i)] === "required"}
                          value={row.subjectId}
                          onChange={(e) =>
                            // Reset the AP-score flag if the new course isn't AP.
                            setRow(i, {
                              subjectId: e.target.value,
                              hasApScore: undefined,
                              apScore: "",
                            })
                          }
                        >
                          <option value="">
                            {t("public.tutorSignup.placeholders.selectCourse")}
                          </option>
                          {courses
                            .filter(
                              (c) =>
                                c.id === row.subjectId ||
                                !usedElsewhere.includes(c.id),
                            )
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {c.level ? ` (${c.level.name})` : ""}
                              </option>
                            ))}
                        </select>
                      </label>
                      {selected?.level && (
                        <span className="badge-slate mb-2">
                          {selected.level.name}
                        </span>
                      )}
                      {/* Native selects cannot wrap a long selected label; keep the complete name readable. */}
                      {selected && (
                        <p
                          id={`tutor-subject-${i}`}
                          className="muted w-full min-w-0 text-xs break-words"
                        >
                          {selected.name}
                        </p>
                      )}
                    </div>

                    {/* Required flags ask for an answer, never require a positive qualification. */}
                    {(readOnly || row.subjectId) && (
                      <div className="flex flex-wrap items-center gap-3">
                        {(["taken", "hasApScore", "selfStudied"] as const).map(
                          (key) => {
                            if (
                              fields[key] === "hidden" ||
                              (key === "hasApScore" && !isAp)
                            )
                              return null;
                            return (
                              <label
                                key={key}
                                className="flex min-h-11 flex-wrap items-center gap-2 text-sm"
                              >
                                <span>
                                  {t(`public.tutorSignup.qual.${key}`)}
                                </span>
                                {fields[key] === "required" ? (
                                  <select
                                    className="select min-h-11 lg:min-h-10"
                                    required
                                    aria-label={t(
                                      `public.tutorSignup.qual.${key}`,
                                    )}
                                    value={
                                      row[key] == null ? "" : String(row[key])
                                    }
                                    onChange={(e) =>
                                      setRow(i, {
                                        [key]:
                                          e.target.value === ""
                                            ? undefined
                                            : e.target.value === "true",
                                      })
                                    }
                                  >
                                    <option value="">
                                      {t("signupFields.answer")}
                                    </option>
                                    <option value="true">
                                      {t("signupFields.yes")}
                                    </option>
                                    <option value="false">
                                      {t("signupFields.no")}
                                    </option>
                                  </select>
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={row[key] ?? false}
                                    onChange={(e) =>
                                      setRow(i, { [key]: e.target.checked })
                                    }
                                  />
                                )}
                              </label>
                            );
                          },
                        )}
                      </div>
                    )}

                    {/* Detail boxes — each appears only when its tick is set. */}
                    {(readOnly || row.subjectId) &&
                      fields.taken !== "hidden" &&
                      fields.grade !== "hidden" &&
                      (readOnly || row.taken) && (
                        <label className="block space-y-1">
                          <span className="label">
                            {t("public.tutorSignup.fields.grade")}{" "}
                            <span className="muted inline-block text-xs">
                              {t(`signupFields.${fields.grade}`)}
                            </span>
                          </span>
                          <input
                            className="input field-auto min-h-11 min-w-32 lg:min-h-10"
                            required={fields.grade === "required"}
                            value={row.grade}
                            onChange={(e) =>
                              setRow(i, { grade: e.target.value })
                            }
                            placeholder={t(
                              "public.tutorSignup.placeholders.grade",
                            )}
                          />
                        </label>
                      )}

                    {(readOnly || row.subjectId) &&
                      isAp &&
                      fields.hasApScore !== "hidden" &&
                      fields.apScore !== "hidden" &&
                      (readOnly || row.hasApScore) && (
                        <label className="block space-y-1">
                          <span className="label">
                            {t("public.tutorSignup.fields.apScore")}{" "}
                            <span className="muted inline-block text-xs">
                              {t(`signupFields.${fields.apScore}`)}
                            </span>
                          </span>
                          <input
                            className="input field-auto min-h-11 min-w-32 lg:min-h-10"
                            required={fields.apScore === "required"}
                            value={row.apScore}
                            onChange={(e) =>
                              setRow(i, { apScore: e.target.value })
                            }
                            placeholder={t(
                              "public.tutorSignup.placeholders.apScore",
                            )}
                          />
                        </label>
                      )}

                    {(readOnly || row.subjectId) &&
                      fields.selfStudied !== "hidden" &&
                      fields.selfStudyNote !== "hidden" &&
                      (readOnly || row.selfStudied) && (
                        <label className="block space-y-1">
                          <span className="label">
                            {t("public.tutorSignup.fields.selfStudyNote")}{" "}
                            <span className="muted inline-block text-xs">
                              {t(`signupFields.${fields.selfStudyNote}`)}
                            </span>
                          </span>
                          <textarea
                            className="textarea w-full"
                            rows={2}
                            required={fields.selfStudyNote === "required"}
                            value={row.selfStudyNote}
                            onChange={(e) =>
                              setRow(i, { selfStudyNote: e.target.value })
                            }
                            placeholder={t(
                              "public.tutorSignup.placeholders.selfStudyNote",
                            )}
                          />
                        </label>
                      )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Policy agreement (gated on reading the policy) */}
          <PolicyAgreement
            key={policy.data?.revision}
            messageKey="public.tutorSignup.agree"
            appTitle={APP_TITLE}
            policy={policy.data}
            checked={agreed}
            onChange={(value) =>
              setAgreedRevision(value ? (policy.data?.revision ?? null) : null)
            }
          />

          {/* Contact details last — who they are and how to reach them. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="label">
                {t("public.tutorSignup.fields.fullName")}
              </span>
              <input
                className="input min-h-11 lg:min-h-10"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="label">
                {t("public.tutorSignup.fields.email")}
              </span>
              <input
                type="email"
                className="input min-h-11 lg:min-h-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
          </div>

          {fields.preferredContact !== "hidden" && (
            <label className="space-y-1">
              <span className="label">
                {t("signupFields.labels.preferredContact")}{" "}
                <span className="muted inline-block text-xs">
                  {t(`signupFields.${fields.preferredContact}`)}
                </span>
              </span>
              <input
                className="input min-h-11 lg:min-h-10"
                value={preferredContact}
                onChange={(e) => setPreferredContact(e.target.value)}
                placeholder={t(
                  "public.tutorSignup.placeholders.preferredContact",
                )}
                required={fields.preferredContact === "required"}
              />
              <span className="muted text-xs">
                {t("public.tutorSignup.help.preferredContact")}
              </span>
            </label>
          )}

          {submit.error && (
            <p role="alert" className="text-sm text-red-600">
              {submit.error.message}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary min-h-11 w-full lg:min-h-10"
            disabled={!canSubmit}
          >
            {submit.isPending
              ? t("public.tutorSignup.submitting")
              : t("public.tutorSignup.submit")}
          </button>
        </fieldset>
      </form>
    </>
  );
}
