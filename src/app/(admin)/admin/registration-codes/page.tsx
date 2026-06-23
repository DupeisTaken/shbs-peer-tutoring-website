"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { APP_TITLE } from "~/lib/branding";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";

/** A quiet numbered step marker — ties the steps to the real registration sequence. */
function StepNum({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-700">
      {n}
    </span>
  );
}

/**
 * A self-contained "invite pass" for a new tutor — designed so an admin can screenshot it and send
 * everything the recruit needs in one image: where to go, the code, which email to use, and how
 * long it's valid. The dashed code chip is the hero; everything else stays quiet. Reused for a
 * freshly-issued code and each expanded card.
 */
function ShareCard({
  code,
  email,
  expiresAt,
  registerUrl,
}: {
  code: string;
  email: string | null;
  expiresAt: Date;
  registerUrl: string;
}) {
  const t = useTranslations();
  return (
    <div className="max-w-md overflow-hidden rounded-xl border border-accent-200 bg-white shadow-sm">
      {/* Welcome band — themed to match the rest of the app (accent tokens). */}
      <div className="bg-accent-600 px-5 py-3.5">
        <p className="text-base font-bold text-white">
          {t("admin.registrationCodes.share.heading", { appTitle: APP_TITLE })}
        </p>
      </div>

      {/* The registration sequence (a genuine ordered process → numbered). */}
      <ol className="space-y-4 px-5 py-4">
        <li className="flex gap-3">
          <StepNum n={1} />
          <p className="pt-0.5 text-sm text-slate-700">
            <span className="font-medium text-slate-900">
              {t("admin.registrationCodes.share.goTo")}
            </span>{" "}
            <span className="font-mono break-all text-accent-700">{registerUrl}</span>
          </p>
        </li>
        <li className="flex gap-3">
          <StepNum n={2} />
          <div className="pt-0.5">
            <p className="text-sm font-medium text-slate-900">
              {t("admin.registrationCodes.share.enterCode")}
            </p>
            {/* Signature: the code as a tear-off ticket chip. */}
            <div className="mt-2 inline-block rounded-lg border-2 border-dashed border-green-300 bg-green-50 px-5 py-2.5 font-mono text-3xl font-bold tracking-[0.3em] text-green-800">
              {code}
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <StepNum n={3} />
          <p className="pt-0.5 text-sm text-slate-700">
            <span className="font-medium text-slate-900">
              {t("admin.registrationCodes.share.verifyEmail")}
            </span>
            {email && (
              <span className="ml-1 font-mono text-slate-500">
                {t("admin.registrationCodes.share.useEmail", { email })}
              </span>
            )}
          </p>
        </li>
        <li className="flex gap-3">
          <StepNum n={4} />
          <p className="pt-0.5 text-sm font-medium text-slate-900">
            {t("admin.registrationCodes.share.setup")}
          </p>
        </li>
      </ol>

      {/* Validity footer — quiet, factual. */}
      <div className="border-t border-accent-100 bg-accent-50/60 px-5 py-2.5">
        <p className="text-xs font-medium text-accent-700">
          {t("admin.registrationCodes.share.validity", {
            date: new Date(expiresAt).toLocaleDateString(),
          })}
        </p>
      </div>
    </div>
  );
}

/**
 * Registration codes: issue single-use 6-digit security keys for new tutors and track their
 * status. Each code is an expandable card whose body is a screenshot-ready setup panel (ShareCard).
 * Admins + coordinators can issue/revoke; VIEWER is read-only (and never sees codes).
 */
export default function RegistrationCodesPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const codes = api.admin.registrationCodes.useQuery();

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<
    { code: string; label: string | null; email: string | null; expiresAt: Date } | null
  >(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Site origin (client-only) for the full /register URL shown to tutors.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const registerUrl = `${origin}/register`;

  const invalidate = () => utils.admin.registrationCodes.invalidate();
  const issue = api.admin.issueRegistrationCode.useMutation({
    onSuccess: async (data) => {
      setIssued({
        code: data.code,
        label: label.trim() || email.trim() || null,
        email: email.trim() || null,
        expiresAt: data.expiresAt,
      });
      setEmail("");
      setLabel("");
      await invalidate();
    },
  });
  const revoke = api.admin.revokeRegistrationCode.useMutation({ onSuccess: invalidate });

  const statusBadge = (status: string) =>
    status === "active" ? "badge-green" : status === "used" ? "badge-slate" : "badge-amber";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.registrationCodes.title")}</h1>
        <p className="muted mt-1">{t("admin.registrationCodes.help")}</p>
      </div>

      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            issue.mutate({
              email: email.trim() || undefined,
              label: label.trim() || undefined,
            });
          }}
        >
          <div>
            <label className="label">{t("admin.registrationCodes.labelField")}</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("admin.registrationCodes.labelPlaceholder")}
              className="input field-auto min-w-44"
            />
          </div>
          <div>
            <label className="label">{t("admin.registrationCodes.emailField")}</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder={t("admin.registrationCodes.emailPlaceholder")}
              className="input field-auto min-w-52"
            />
          </div>
          <button className="btn-primary" disabled={issue.isPending}>
            {t("admin.registrationCodes.issue")}
          </button>
        </form>
      )}
      {issue.error && <p className="text-sm text-red-600">{issue.error.message}</p>}

      {/* Just issued — show the screenshot-ready panel immediately. */}
      {issued && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">
            {t("admin.registrationCodes.issuedTitle", { who: issued.label ?? "—" })}
          </p>
          <ShareCard
            code={issued.code}
            email={issued.email}
            expiresAt={issued.expiresAt}
            registerUrl={registerUrl}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => navigator.clipboard?.writeText(issued.code)}
            >
              {t("admin.registrationCodes.copy")}
            </button>
            <button type="button" className="link text-sm" onClick={() => setIssued(null)}>
              {t("common.dismiss")}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {(codes.data ?? []).map((c) => {
          const open = expandedId === c.id;
          return (
            <div key={c.id} className="rounded-lg border border-slate-200 p-4">
              {/* Header: disclosure + label + status; expiry + revoke on the right (always shown). */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <button
                    type="button"
                    className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700"
                    aria-label={
                      open
                        ? t("admin.registrationCodes.collapse")
                        : t("admin.registrationCodes.expand")
                    }
                    onClick={() => setExpandedId(open ? null : c.id)}
                  >
                    <DisclosureIcon open={open} />
                  </button>
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-slate-900">
                      {c.label ?? c.tutorName ?? "—"}
                      <span className={`${statusBadge(c.status)} ml-2`}>
                        {t(`admin.registrationCodes.status.${c.status}`)}
                      </span>
                    </p>
                    {!open && (
                      <p className="muted text-xs">
                        {c.email ?? t("admin.registrationCodes.noEmail")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <p className="muted text-xs">
                    {t("admin.registrationCodes.expiresOn", {
                      date: new Date(c.expiresAt).toLocaleDateString(),
                    })}
                  </p>
                  {!readOnly && c.status === "active" && (
                    <button
                      className="btn-danger btn-sm"
                      onClick={() => revoke.mutate({ id: c.id })}
                      disabled={revoke.isPending}
                    >
                      {t("admin.registrationCodes.revoke")}
                    </button>
                  )}
                </div>
              </div>

              {open && (
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  {c.code && c.status === "active" ? (
                    <>
                      <ShareCard
                        code={c.code}
                        email={c.email}
                        expiresAt={c.expiresAt}
                        registerUrl={registerUrl}
                      />
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => navigator.clipboard?.writeText(c.code!)}
                      >
                        {t("admin.registrationCodes.copy")}
                      </button>
                    </>
                  ) : c.code ? (
                    // Used / expired: the code is no longer shareable.
                    <div>
                      <p className="label">{t("admin.registrationCodes.codeLabel")}</p>
                      <p className="font-mono text-2xl font-bold tracking-[0.3em] text-slate-400 line-through">
                        {c.code}
                      </p>
                      <p className="muted text-xs">{t("admin.registrationCodes.invalidNote")}</p>
                    </div>
                  ) : (
                    <p className="muted text-sm">{t("admin.registrationCodes.noCode")}</p>
                  )}
                  <p className="muted text-xs">
                    {t("admin.registrationCodes.colIssuedBy")}: {c.issuedByName ?? "—"}
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {(codes.data?.length ?? 0) === 0 && (
          <p className="muted py-4 text-center">{t("admin.registrationCodes.empty")}</p>
        )}
      </div>
    </div>
  );
}
