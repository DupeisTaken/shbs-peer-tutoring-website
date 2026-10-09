"use client";
import Link from "next/link";
import { useRef } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { SignupError } from "~/app/_components/signup-error";
import { InvitationRedemption } from "../register/invitation-redemption";
import { SurveyResend } from "./survey-resend";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { InlineNotice } from "~/app/_components/ui/patterns";

/** Link inspection never consumes intake. The explicit mailbox-confirmation action issues
 * an invitation; credentials and access are reviewed in the shared redemption flow. */
export function StudentRegistration({
  token,
  signedInEmail = null,
}: {
  token: string;
  signedInEmail?: string | null;
}) {
  const format = useFormatter();
  const t = useTranslations("survey");
  const w = useTranslations("workflow");
  const signup = useTranslations("public.signup");
  const invitation = useTranslations("accountInvitation");
  const admitted = useRef(false);
  const request = api.tutee.inspectSurvey.useQuery(
    { token },
    { enabled: !!token, retry: false, refetchOnWindowFocus: false },
  );
  const complete = api.accountInvitation.fromSurvey.useMutation({
    onSettled: () => {
      admitted.current = false;
    },
  });
  if (complete.data)
    return (
      <InvitationRedemption
        invitationId={complete.data.invitationId}
        signedIn={Boolean(signedInEmail)}
        focusOnMount
      />
    );
  if (
    request.error &&
    !request.data &&
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
  if (!token || (request.error && !request.data))
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
      {request.error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void request.refetch()}
            >
              {t("retry")}
            </button>
          }
        >
          {t("loadFailed")}
        </InlineNotice>
      )}
      <h2 className="section-title">{invitation("verifyTuteeTitle")}</h2>
      <p className="muted">{invitation("verifyTuteeHelp")}</p>
      {info.verificationDueAt && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {w("deadline", {
            time: format.dateTime(new Date(info.verificationDueAt), {
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
            time: format.dateTime(new Date(info.submittedAt), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (complete.isPending || request.error || admitted.current) return;
          admitted.current = true;
          complete.mutate({ token });
        }}
      >
        <fieldset
          disabled={complete.isPending || Boolean(request.error)}
          aria-busy={complete.isPending}
          className="space-y-4"
        >
          <button className="btn-primary" type="submit">
            {invitation("sendInvitation")}
          </button>
        </fieldset>
        {complete.error && (
          <p role="alert" className="mt-3 text-red-700">
            <SignupError error={complete.error} />
          </p>
        )}
      </form>
    </section>
  );
}
