"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Public "apply to be crew" form. Creates a PENDING CrewApplication for an admin to review (no
 * login is created — like /signup & /tutor-signup). On accept, the admin issues a crew code.
 */
export function CrewSignupForm() {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [grade, setGrade] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");

  const apply = api.crew.submitApplication.useMutation();

  if (apply.isSuccess) {
    return (
      <div className="card p-6 text-center">
        <p className="text-lg font-semibold text-slate-900">{t("public.crewSignup.doneTitle")}</p>
        <p className="muted mt-2">{t("public.crewSignup.doneBody")}</p>
      </div>
    );
  }

  const valid = name.trim().length > 0 && /^[^@\s]+@[^@\s]+$/.test(email.trim());

  return (
    <form
      className="card space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        apply.mutate({
          name: name.trim(),
          email: email.trim(),
          gradeLevel: grade.trim() ? Number(grade) : null,
          preferredContact: contact.trim() || undefined,
          message: message.trim() || undefined,
        });
      }}
    >
      <div>
        <label className="label" htmlFor="crew-name">
          {t("public.crewSignup.fields.fullName")}
        </label>
        <input id="crew-name" value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
      </div>
      <div>
        <label className="label" htmlFor="crew-email">
          {t("public.crewSignup.fields.email")}
        </label>
        <input
          id="crew-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input w-full"
        />
      </div>
      <div>
        <label className="label" htmlFor="crew-grade">
          {t("public.crewSignup.fields.grade")}
        </label>
        <input
          id="crew-grade"
          type="number"
          min={6}
          max={12}
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="input w-full"
        />
      </div>
      <div>
        <label className="label" htmlFor="crew-contact">
          {t("public.crewSignup.fields.contact")}
        </label>
        <input
          id="crew-contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          className="input w-full"
        />
      </div>
      <div>
        <label className="label" htmlFor="crew-message">
          {t("public.crewSignup.fields.message")}
        </label>
        <textarea
          id="crew-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="textarea w-full"
        />
      </div>
      {apply.error && <p className="text-sm text-red-600">{apply.error.message}</p>}
      <button className="btn-primary w-full" disabled={!valid || apply.isPending}>
        {apply.isPending ? t("public.crewSignup.submitting") : t("public.crewSignup.submit")}
      </button>
    </form>
  );
}
