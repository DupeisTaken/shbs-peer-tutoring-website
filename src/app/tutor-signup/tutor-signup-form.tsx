"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { APP_TITLE } from "~/lib/branding";
import { PolicyAgreement } from "~/app/_components/policy-agreement";

type CourseRow = {
  subjectId: string;
  taken: boolean;
  grade: string;
  hasApScore: boolean;
  apScore: string;
  selfStudied: boolean;
  selfStudyNote: string;
};

const emptyRow: CourseRow = {
  subjectId: "",
  taken: false,
  grade: "",
  hasApScore: false,
  apScore: "",
  selfStudied: false,
  selfStudyNote: "",
};

export function TutorSignupForm() {
  const t = useTranslations();
  const locale = useLocale();
  const options = api.application.options.useQuery();
  const policy = api.application.policy.useQuery({ locale });
  const submit = api.application.submit.useMutation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
  const [rows, setRows] = useState<CourseRow[]>([{ ...emptyRow }]);
  const [agreed, setAgreed] = useState(false);

  const courses = options.data ?? [];

  const setRow = (i: number, patch: Partial<CourseRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => (rs.length < 3 ? [...rs, { ...emptyRow }] : rs));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const chosen = rows.map((r) => r.subjectId).filter(Boolean);
  const canSubmit =
    name.trim() &&
    email.trim() &&
    preferredContact.trim() &&
    chosen.length >= 1 &&
    new Set(chosen).size === chosen.length &&
    agreed &&
    !submit.isPending;

  if (submit.isSuccess) {
    return (
      <div className="card p-8 text-center">
        <h2 className="text-xl font-semibold text-slate-900">{t("public.tutorSignup.successTitle")}</h2>
        <p className="muted mt-2">
          {t("public.tutorSignup.successBody", { name: name.trim(), email: email.trim() })}
        </p>
      </div>
    );
  }

  return (
    <form
      className="card space-y-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        submit.mutate({
          name: name.trim(),
          email: email.trim(),
          preferredContact: preferredContact.trim(),
          subjects: rows
            .filter((r) => r.subjectId)
            .map((r) => ({
              subjectId: r.subjectId,
              taken: r.taken,
              grade: r.taken ? r.grade.trim() || undefined : undefined,
              hasApScore: r.hasApScore,
              apScore: r.hasApScore ? r.apScore.trim() || undefined : undefined,
              selfStudied: r.selfStudied,
              selfStudyNote: r.selfStudied ? r.selfStudyNote.trim() || undefined : undefined,
            })),
        });
      }}
    >
      <div>
        <p className="label">{t("public.tutorSignup.fields.courses")}</p>
        <p className="muted mb-2">
          {t("public.tutorSignup.coursesHelp")}
        </p>
        <div className="space-y-3">
          {rows.map((row, i) => {
            const usedElsewhere = rows
              .filter((_, idx) => idx !== i)
              .map((r) => r.subjectId);
            const selected = courses.find((c) => c.id === row.subjectId);
            const isAp = selected?.level?.apScored ?? false;
            return (
              <div
                key={i}
                className="space-y-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1">
                    <span className="label">{t("public.tutorSignup.fields.course")}</span>
                    <select
                      className="select w-48"
                      value={row.subjectId}
                      onChange={(e) =>
                        // Reset the AP-score flag if the new course isn't AP.
                        setRow(i, { subjectId: e.target.value, hasApScore: false, apScore: "" })
                      }
                    >
                      <option value="">{t("public.tutorSignup.placeholders.selectCourse")}</option>
                      {courses
                        .filter((c) => c.id === row.subjectId || !usedElsewhere.includes(c.id))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.level ? ` (${c.level.name})` : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  {selected?.level && (
                    <span className="badge-slate mb-2">{selected.level.name}</span>
                  )}
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="link-danger mb-2 ml-auto text-sm"
                      onClick={() => removeRow(i)}
                    >
                      {t("public.tutorSignup.remove")}
                    </button>
                  )}
                </div>

                {/* Qualification ticks — all checkboxes grouped together. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.taken}
                      onChange={(e) => setRow(i, { taken: e.target.checked })}
                    />
                    {t("public.tutorSignup.qual.taken")}
                  </label>
                  {isAp && (
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={row.hasApScore}
                        onChange={(e) => setRow(i, { hasApScore: e.target.checked })}
                      />
                      {t("public.tutorSignup.qual.hasApScore")}
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.selfStudied}
                      onChange={(e) => setRow(i, { selfStudied: e.target.checked })}
                    />
                    {t("public.tutorSignup.qual.selfStudied")}
                  </label>
                </div>

                {/* Detail boxes — each appears only when its tick is set. */}
                {row.taken && (
                  <label className="block space-y-1">
                    <span className="label">{t("public.tutorSignup.fields.grade")}</span>
                    <input
                      className="input w-32"
                      value={row.grade}
                      onChange={(e) => setRow(i, { grade: e.target.value })}
                      placeholder={t("public.tutorSignup.placeholders.grade")}
                    />
                  </label>
                )}

                {isAp && row.hasApScore && (
                  <label className="block space-y-1">
                    <span className="label">{t("public.tutorSignup.fields.apScore")}</span>
                    <input
                      className="input w-32"
                      value={row.apScore}
                      onChange={(e) => setRow(i, { apScore: e.target.value })}
                      placeholder={t("public.tutorSignup.placeholders.apScore")}
                    />
                  </label>
                )}

                {row.selfStudied && (
                  <label className="block space-y-1">
                    <span className="label">{t("public.tutorSignup.fields.selfStudyNote")}</span>
                    <textarea
                      className="textarea w-full"
                      rows={2}
                      value={row.selfStudyNote}
                      onChange={(e) => setRow(i, { selfStudyNote: e.target.value })}
                      placeholder={t("public.tutorSignup.placeholders.selfStudyNote")}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
        {rows.length < 3 && (
          <button type="button" className="link mt-2 text-sm" onClick={addRow}>
            {t("public.tutorSignup.addCourse")}
          </button>
        )}
      </div>

      {/* Policy agreement (gated on reading the policy) */}
      <PolicyAgreement
        messageKey="public.tutorSignup.agree"
        appTitle={APP_TITLE}
        policy={policy.data}
        checked={agreed}
        onChange={setAgreed}
      />

      {/* Contact details last — who they are and how to reach them. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">{t("public.tutorSignup.fields.fullName")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="space-y-1">
          <span className="label">{t("public.tutorSignup.fields.email")}</span>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
      </div>

      <label className="space-y-1">
        <span className="label">{t("public.tutorSignup.fields.preferredContact")}</span>
        <input
          className="input"
          value={preferredContact}
          onChange={(e) => setPreferredContact(e.target.value)}
          placeholder={t("public.tutorSignup.placeholders.preferredContact")}
          required
        />
        <span className="muted text-xs">
          {t("public.tutorSignup.help.preferredContact")}
        </span>
      </label>

      {submit.error && (
        <p role="alert" className="text-sm text-red-600">
          {submit.error.message}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
        {submit.isPending ? t("public.tutorSignup.submitting") : t("public.tutorSignup.submit")}
      </button>
    </form>
  );
}
