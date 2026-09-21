"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  signupSettings,
  normalizeTuteeFields,
  missingTuteeFields,
} from "~/lib/signup-fields";
import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { APP_TITLE } from "~/lib/branding";
import { PolicyAgreement } from "~/app/_components/policy-agreement";
import { SigninAccess } from "./signin-access";
import { SurveyResend } from "./survey-resend";

export function SignupForm() {
  const t = useTranslations();
  const locale = useLocale();
  const options = api.tutee.signupOptions.useQuery();
  const policy = api.tutee.surveyPolicy.useQuery({ locale });
  const submit = api.tutee.submitSurvey.useMutation();

  const [englishName, setEnglishName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
  const [firstChoiceId, setFirstChoiceId] = useState("");
  const [secondChoiceId, setSecondChoiceId] = useState("");
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [signatureName, setSignatureName] = useState("");
  const [agreedRevision, setAgreedRevision] = useState<string | null>(null);
  const agreed =
    !!policy.data?.revision && agreedRevision === policy.data.revision;

  const fields = options.data?.fields ?? signupSettings(null).tutee;
  const optionalValues = {
    gradeLevel,
    phone,
    preferredContact,
    secondChoiceId,
    slotIds,
    signatureName,
  };
  const courses = options.data?.subjects ?? [];
  const slots = useMemo(() => options.data?.slots ?? [], [options.data]);

  // Group slots by day of week for a tidy availability picker.
  const slotsByDay = useMemo(() => {
    const map = new Map<number, typeof slots>();
    for (const s of slots) {
      const arr = map.get(s.dayOfWeek) ?? [];
      arr.push(s);
      map.set(s.dayOfWeek, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [slots]);

  const toggleSlot = (id: string) =>
    setSlotIds((cur) =>
      cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id],
    );

  const canSubmit =
    englishName.trim() &&
    email.trim() &&
    policy.data?.revision &&
    missingTuteeFields(normalizeTuteeFields(optionalValues, fields), fields)
      .length === 0 &&
    firstChoiceId &&
    agreed &&
    !submit.isPending;

  if (submit.isSuccess) {
    return (
      <div className="card p-5 text-center sm:p-8">
        <h2 className="text-xl font-semibold text-slate-900">
          {t("survey.savedTitle")}
        </h2>
        <p className="muted mt-2">
          {t("survey.savedBody", { email: email.trim() })}
        </p>
        <p className="muted mt-3 text-sm">{t("survey.duplicate")}</p>
        {!submit.data.emailSent && (
          <p role="alert" className="mt-3 text-amber-800">
            {t("survey.mailFailed")}
          </p>
        )}
        <SigninAccess />
        <SurveyResend initialEmail={email.trim()} />
      </div>
    );
  }

  // Distinguish pending reads and configuration gaps from a usable signup form.
  if (options.isError || policy.isError)
    return (
      <section className="card space-y-4 p-6">
        <p role="alert">{t("survey.loadFailed")}</p>
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
  if (
    !courses.length ||
    (fields.availability === "required" && !slots.length) ||
    !policy.data?.revision
  )
    return (
      <p role="status" className="card p-6">
        {t("public.signup.unavailable")}
      </p>
    );

  return (
    <form
      className="card space-y-6 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit || !policy.data) return;
        submit.mutate(
          normalizeTuteeFields(
            {
              englishName: englishName.trim(),
              email: email.trim(),
              policyRevision: policy.data.revision,
              phone: phone.trim() || undefined,
              preferredContact: preferredContact.trim(),
              gradeLevel: gradeLevel.trim() || undefined,
              firstChoiceId,
              secondChoiceId: secondChoiceId || undefined,
              slotIds,
              signatureName: signatureName.trim(),
              agreed: true as const,
            },
            fields,
          ),
        );
      }}
    >
      {/* Identity */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">{t("public.signup.fields.fullName")}</span>
          <input
            className="input min-h-11 lg:min-h-10"
            value={englishName}
            onChange={(e) => setEnglishName(e.target.value)}
            required
          />
        </label>
        {fields.gradeLevel !== "hidden" && (
          <label className="space-y-1">
            <span className="label">
              {t("public.signup.fields.gradeLevel")}{" "}
              <span className="muted inline-block text-xs">
                {t(`signupFields.${fields.gradeLevel}`)}
              </span>
            </span>
            <input
              className="input min-h-11 lg:min-h-10"
              required={fields.gradeLevel === "required"}
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              placeholder={t("public.signup.placeholders.gradeLevel")}
            />
          </label>
        )}
        <label className="space-y-1">
          <span className="label">{t("survey.emailLabel")}</span>
          <input
            type="email"
            autoComplete="email"
            className="input min-h-11 lg:min-h-10"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
          />
          <span className="muted text-xs">{t("survey.emailHelp")}</span>
        </label>
        {fields.phone !== "hidden" && (
          <label className="space-y-1">
            <span className="label">
              {t("public.signup.fields.phone")}{" "}
              <span className="muted inline-block text-xs">
                {t(`signupFields.${fields.phone}`)}
              </span>
            </span>
            <input
              className="input min-h-11 lg:min-h-10"
              required={fields.phone === "required"}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
        )}
      </div>

      {/* Preferred contact — make it unmistakable how to reach this student. */}
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
            placeholder={t("public.signup.placeholders.preferredContact")}
            required={fields.preferredContact === "required"}
          />
          <span className="muted text-xs">
            {t("public.signup.help.preferredContact")}
          </span>
        </label>
      )}

      {/* Course choices */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">{t("public.signup.fields.firstChoice")}</span>
          <select
            className="select min-h-11 lg:min-h-10"
            value={firstChoiceId}
            onChange={(e) => setFirstChoiceId(e.target.value)}
            required
          >
            <option value="">
              {t("public.signup.placeholders.selectCourse")}
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {fields.secondSubject !== "hidden" && (
          <label className="space-y-1">
            <span className="label">
              {t("signupFields.labels.secondSubject")}{" "}
              <span className="muted inline-block text-xs">
                {t(`signupFields.${fields.secondSubject}`)}
              </span>
            </span>
            <select
              className="select min-h-11 lg:min-h-10"
              required={fields.secondSubject === "required"}
              value={secondChoiceId}
              onChange={(e) => setSecondChoiceId(e.target.value)}
            >
              <option value="">{t("public.signup.options.none")}</option>
              {courses
                .filter((c) => c.id !== firstChoiceId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>

      {/* Availability */}
      {fields.availability !== "hidden" && (
        <fieldset>
          <legend className="label">
            {t("signupFields.labels.availability")}{" "}
            <span className="muted inline-block text-xs">
              {t(`signupFields.${fields.availability}`)}
            </span>
          </legend>
          {slots.length === 0 ? (
            <p className="muted mt-1">{t("public.signup.noSlots")}</p>
          ) : (
            <div className="mt-2 space-y-3">
              {slotsByDay.map(([day, daySlots]) => (
                <div key={day}>
                  <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                    {DAY_NAMES[day]}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {daySlots.map((s) => {
                      const checked = slotIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className={`focus-within:ring-accent-500 inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm transition focus-within:ring-2 ${
                            checked
                              ? "border-accent-500 bg-accent-50 text-accent-700"
                              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => toggleSlot(s.id)}
                          />
                          {s.label}{" "}
                          <span className="text-slate-400">
                            ({minToHm(s.startMin)}–{minToHm(s.endMin)})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      )}

      {/* Policy agreement (gated on reading the policy) + signature */}
      <div className="space-y-4">
        <PolicyAgreement
          key={policy.data.revision}
          messageKey="public.signup.agree"
          appTitle={APP_TITLE}
          policy={policy.data}
          checked={agreed}
          onChange={(value) =>
            setAgreedRevision(value ? (policy.data?.revision ?? null) : null)
          }
        />
        {fields.signatureName !== "hidden" && (
          <label className="block space-y-1">
            <span className="label">
              {t("signupFields.labels.signatureName")}{" "}
              <span className="muted inline-block text-xs">
                {t(`signupFields.${fields.signatureName}`)}
              </span>
            </span>
            <input
              className="input min-h-11 lg:min-h-10"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder={t("public.signup.placeholders.signature")}
              required={fields.signatureName === "required"}
            />
          </label>
        )}
      </div>

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
          ? t("public.signup.submitting")
          : t("public.signup.submit")}
      </button>
    </form>
  );
}
