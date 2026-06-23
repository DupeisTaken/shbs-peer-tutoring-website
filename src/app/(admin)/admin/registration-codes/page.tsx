"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";

/**
 * Registration codes: issue single-use 6-digit security keys for new tutors and track their
 * status. Each code is an expandable card; expanding it reveals the plaintext code (re-viewable on
 * demand). Admins + coordinators can issue/revoke; VIEWER is read-only (and never sees codes).
 */
export default function RegistrationCodesPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const codes = api.admin.registrationCodes.useQuery();

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<{ code: string; label: string | null } | null>(null);
  // Which code card is expanded (reveals the plaintext code inline).
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const invalidate = () => utils.admin.registrationCodes.invalidate();
  const issue = api.admin.issueRegistrationCode.useMutation({
    onSuccess: async (data) => {
      setIssued({ code: data.code, label: label.trim() || email.trim() || null });
      setEmail("");
      setLabel("");
      await invalidate();
    },
  });
  const revoke = api.admin.revokeRegistrationCode.useMutation({ onSuccess: invalidate });

  const statusBadge = (status: string) =>
    status === "active"
      ? "badge-green"
      : status === "used"
        ? "badge-slate"
        : "badge-amber";

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

      {issued && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-800">
            {t("admin.registrationCodes.issuedTitle", { who: issued.label ?? "—" })}
          </p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-green-900">
            {issued.code}
          </p>
          <p className="muted mt-1 text-xs">{t("admin.registrationCodes.issuedHint")}</p>
        </div>
      )}

      <div className="space-y-2">
        {(codes.data ?? []).map((c) => {
          const open = expandedId === c.id;
          return (
            <div key={c.id} className="rounded-lg border border-slate-200 p-4">
              {/* Header row: disclosure toggle + label + status; expires summary on the right. */}
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
                  {/* Revoke stays reachable whether the card is collapsed or expanded. */}
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
                  {/* The code itself (VIEWER never receives it): green frame strictly around the
                      centered code text; Copy sits outside the frame. */}
                  {c.code ? (
                    <div className="space-y-2">
                      {/* Green frame: "Code" label above the centered digits. Copy sits outside. */}
                      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center">
                        <p className="text-xs font-medium tracking-wide text-green-800 uppercase">
                          {t("admin.registrationCodes.codeLabel")}
                        </p>
                        <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-green-900">
                          {c.code}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => navigator.clipboard?.writeText(c.code!)}
                      >
                        {t("admin.registrationCodes.copy")}
                      </button>
                      {c.status !== "active" && (
                        <p className="muted text-xs">
                          {t("admin.registrationCodes.invalidNote")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="muted text-sm">{t("admin.registrationCodes.noCode")}</p>
                  )}

                  {/* Details */}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="muted text-xs">{t("admin.registrationCodes.colEmail")}</dt>
                      <dd className="text-slate-700">{c.email ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="muted text-xs">{t("admin.registrationCodes.colIssuedBy")}</dt>
                      <dd className="text-slate-700">{c.issuedByName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="muted text-xs">{t("admin.registrationCodes.colExpires")}</dt>
                      <dd className="text-slate-700">
                        {new Date(c.expiresAt).toLocaleString()}
                      </dd>
                    </div>
                  </dl>
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
