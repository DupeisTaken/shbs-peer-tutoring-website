"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";

/**
 * Registration codes: issue single-use 6-digit security keys for new tutors and track their
 * status. The plaintext code is shown ONCE on issue (it's never stored) — copy it then hand it
 * out. Admins + coordinators can issue/revoke; VIEWER is read-only.
 */
export default function RegistrationCodesPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const codes = api.admin.registrationCodes.useQuery();

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<{ code: string; label: string | null } | null>(null);
  // Which row's code popup is open (the plaintext code is revealed on demand).
  const [revealedId, setRevealedId] = useState<string | null>(null);

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

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.registrationCodes.colFor")}</th>
              <th>{t("admin.registrationCodes.colEmail")}</th>
              <th>{t("admin.registrationCodes.colIssuedBy")}</th>
              <th>{t("admin.registrationCodes.colExpires")}</th>
              <th>{t("admin.registrationCodes.colStatus")}</th>
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {(codes.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.label ?? c.tutorName ?? "—"}</td>
                <td className="text-slate-600">{c.email ?? "—"}</td>
                <td className="text-slate-600">{c.issuedByName ?? "—"}</td>
                <td className="text-slate-600">{new Date(c.expiresAt).toLocaleDateString()}</td>
                <td>
                  <span className={statusBadge(c.status)}>
                    {t(`admin.registrationCodes.status.${c.status}`)}
                  </span>
                </td>
                {!readOnly && (
                  <td>
                    <div className="flex items-center gap-3">
                      {c.code && (
                        <div className="relative inline-block">
                          <button
                            className="link text-sm"
                            onClick={() =>
                              setRevealedId(revealedId === c.id ? null : c.id)
                            }
                          >
                            {revealedId === c.id
                              ? t("admin.registrationCodes.hideCode")
                              : t("admin.registrationCodes.showCode")}
                          </button>
                          {revealedId === c.id && (
                            <div className="absolute right-0 z-10 mt-1 rounded-lg border border-slate-200 bg-white p-3 text-center shadow-lg">
                              <p className="font-mono text-2xl font-bold tracking-[0.3em] whitespace-nowrap text-slate-900">
                                {c.code}
                              </p>
                              <button
                                type="button"
                                className="link mt-1 text-xs"
                                onClick={() => navigator.clipboard?.writeText(c.code!)}
                              >
                                {t("admin.registrationCodes.copy")}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {c.status === "active" && (
                        <button
                          className="link text-sm text-red-600"
                          onClick={() => revoke.mutate({ id: c.id })}
                          disabled={revoke.isPending}
                        >
                          {t("admin.registrationCodes.revoke")}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {(codes.data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="muted py-4 text-center">
                  {t("admin.registrationCodes.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
