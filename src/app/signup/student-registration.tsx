"use client";
import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { SigninAccess } from "./signin-access";
import { SurveyResend } from "./survey-resend";
import { switchToStudentSignin } from "~/app/_actions/auth";
import { DAY_NAMES, minToHm } from "~/lib/time";

/** Inspect the emailed token without consuming it; account creation requires an explicit submit. */
export function StudentRegistration({
  token,
  signedInEmail = null,
}: {
  token: string;
  signedInEmail?: string | null;
}) {
  const programFormat = useFormatter();
  const t = useTranslations("survey");
  const w = useTranslations("workflow");
  const signup = useTranslations("public.signup");
  const [password, setPassword] = useState("");
  const request = api.tutee.inspectSurvey.useQuery(
    { token },
    { enabled: !!token, retry: false, refetchOnWindowFocus: false },
  );
  const complete = api.tutee.confirmSurvey.useMutation();
  if (complete.isSuccess)
    return (
      <section className="card space-y-4 p-6">
        <h2 className="section-title">{t("confirmedTitle")}</h2>
        <p>{t("confirmedBody")}</p>
        {request.data?.period && (
          <p className="badge-slate w-fit">
            {signup(request.data.period.kind, {
              period: request.data.period.label,
            })}
          </p>
        )}
        {signedInEmail &&
        signedInEmail.toLowerCase() !== request.data?.email ? (
          <form
            action={switchToStudentSignin}
            className="space-y-3 rounded-lg bg-amber-50 p-4"
          >
            <p>{t("differentAccount", { email: signedInEmail })}</p>
            <button className="btn-primary">{t("switchAccount")}</button>
          </form>
        ) : signedInEmail ? (
          <Link href="/student" className="btn-primary">
            {t("portal")}
          </Link>
        ) : null}
        <SigninAccess />
      </section>
    );
  if (
    request.error &&
    !["BAD_REQUEST", "NOT_FOUND"].includes(request.error.data?.code ?? "")
  )
    return (
      <section className="card space-y-4 p-6">
        <p role="alert">{t("loadFailed")}</p>
        <button className="btn-primary" onClick={() => void request.refetch()}>
          {t("retry")}
        </button>
      </section>
    );
  if (!token || request.error)
    return (
      <section className="card space-y-4 p-6">
        <p role="alert">{t("invalidLink")}</p>
        <Link href="/signin" className="link">
          {t("signIn")}
        </Link>
        <SurveyResend />
        <p className="muted text-sm">{w("expiredHelp")}</p>
        <Link href="/signup" className="link">
          {w("newRequest")}
        </Link>
      </section>
    );
  if (!request.data)
    return (
      <p role="status" className="muted">
        {t("loading")}
      </p>
    );
  const info = request.data;
  return (
    <section className="card space-y-5 p-6">
      <h2 className="section-title">
        {t(info.needsAccount ? "newAccount" : "existingAccount")}
      </h2>
      <p className="muted">
        {t(info.needsAccount ? "newAccountHelp" : "existingHelp")}
      </p>
      {info.verificationDueAt && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {w("deadline", {
            time: programFormat.dateTime(new Date(info.verificationDueAt), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
      )}
      <div className="rounded-lg bg-slate-50 p-4 break-words">
        {info.period && (
          <p className="badge-slate mb-2">
            {signup(info.period.kind, { period: info.period.label })}
          </p>
        )}
        <p className="font-semibold">{info.name}</p>
        <p>{info.email}</p>
        <p className="muted">{info.subjects.join(", ")}</p>
        <p className="muted">
          {t("contactReview", { contact: info.preferredContact })}
        </p>
        <ul className="muted mt-2 space-y-1">
          {info.slots.map((slot) => (
            <li key={slot.id}>
              {DAY_NAMES[slot.dayOfWeek]} · {minToHm(slot.startMin)}–
              {minToHm(slot.endMin)}
              {slot.label ? ` · ${slot.label}` : ""}
            </li>
          ))}
        </ul>
        <p className="muted mt-2 text-sm">{t("reviewHelp")}</p>
        <p className="muted mt-2">
          {t("submitted", {
            time: programFormat.dateTime(new Date(info.submittedAt), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          complete.mutate({
            token,
            ...(info.needsAccount ? { password } : {}),
          });
        }}
      >
        {info.needsAccount && (
          <label className="block space-y-1">
            <span className="label">{t("password")}</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <button className="btn-primary" disabled={complete.isPending}>
          {t(info.needsAccount ? "create" : "confirm")}
        </button>
        {complete.error && (
          <p role="alert" className="text-red-700">
            {complete.error.message}
          </p>
        )}
      </form>
    </section>
  );
}
