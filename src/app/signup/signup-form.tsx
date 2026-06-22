"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { APP_TITLE } from "~/lib/branding";
import { PolicyAgreement } from "~/app/_components/policy-agreement";

export function SignupForm() {
  const t = useTranslations();
  const locale = useLocale();
  const options = api.tutee.signupOptions.useQuery();
  const policy = api.tutee.policy.useQuery({ locale });
  const submit = api.tutee.requestSignup.useMutation();

  const [englishName, setEnglishName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
  const [firstChoiceId, setFirstChoiceId] = useState("");
  const [secondChoiceId, setSecondChoiceId] = useState("");
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [signatureName, setSignatureName] = useState("");
  const [agreed, setAgreed] = useState(false);

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
    preferredContact.trim() &&
    firstChoiceId &&
    slotIds.length > 0 &&
    signatureName.trim() &&
    agreed &&
    !submit.isPending;

  if (submit.isSuccess) {
    return (
      <div className="card p-8 text-center">
        <h2 className="text-xl font-semibold text-slate-900">{t("public.signup.successTitle")}</h2>
        <p className="muted mt-2">
          {t("public.signup.successBody", { name: englishName.trim() })}
        </p>
      </div>
    );
  }

  return (
    <form
      className="card space-y-6 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        submit.mutate({
          englishName: englishName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          preferredContact: preferredContact.trim(),
          gradeLevel: gradeLevel.trim() || undefined,
          firstChoiceId,
          secondChoiceId: secondChoiceId || undefined,
          slotIds,
          signatureName: signatureName.trim(),
          agreed: true,
        });
      }}
    >
      {/* Identity */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">{t("public.signup.fields.fullName")}</span>
          <input
            className="input"
            value={englishName}
            onChange={(e) => setEnglishName(e.target.value)}
            required
          />
        </label>
        <label className="space-y-1">
          <span className="label">{t("public.signup.fields.gradeLevel")}</span>
          <input
            className="input"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            placeholder={t("public.signup.placeholders.gradeLevel")}
          />
        </label>
        <label className="space-y-1">
          <span className="label">{t("public.signup.fields.email")}</span>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="label">{t("public.signup.fields.phone")}</span>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      </div>

      {/* Preferred contact — make it unmistakable how to reach this student. */}
      <label className="space-y-1">
        <span className="label">{t("public.signup.fields.preferredContact")}</span>
        <input
          className="input"
          value={preferredContact}
          onChange={(e) => setPreferredContact(e.target.value)}
          placeholder={t("public.signup.placeholders.preferredContact")}
          required
        />
        <span className="muted text-xs">
          {t("public.signup.help.preferredContact")}
        </span>
      </label>

      {/* Course choices */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">{t("public.signup.fields.firstChoice")}</span>
          <select
            className="select"
            value={firstChoiceId}
            onChange={(e) => setFirstChoiceId(e.target.value)}
            required
          >
            <option value="">{t("public.signup.placeholders.selectCourse")}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label">{t("public.signup.fields.secondChoice")}</span>
          <select
            className="select"
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
      </div>

      {/* Availability */}
      <fieldset>
        <legend className="label">{t("public.signup.fields.availability")}</legend>
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
                        className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition ${
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

      {/* Policy agreement (gated on reading the policy) + signature */}
      <div className="space-y-4">
        <PolicyAgreement
          messageKey="public.signup.agree"
          appTitle={APP_TITLE}
          policy={policy.data}
          checked={agreed}
          onChange={setAgreed}
        />
        <label className="block space-y-1">
          <span className="label">{t("public.signup.fields.signature")}</span>
          <input
            className="input"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder={t("public.signup.placeholders.signature")}
            required
          />
        </label>
      </div>

      {submit.error && (
        <p role="alert" className="text-sm text-red-600">
          {submit.error.message}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
        {submit.isPending ? t("public.signup.submitting") : t("public.signup.submit")}
      </button>
    </form>
  );
}
