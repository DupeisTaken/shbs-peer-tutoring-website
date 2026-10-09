"use client";
import {
  REGISTRATION_KINDS,
  registrationKindLabel,
  type RegistrationKind,
} from "~/lib/registration-kind";
import { EmailDetails } from "~/app/_components/email-details";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { ShareCard } from "./share-card";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";
import { Button } from "~/app/_components/ui/button";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { queuedApprovalId } from "~/lib/approval-outcome";

/**
 * Registration codes: issue single-use 6-digit security keys for new tutors and track their
 * status. Active codes remain re-viewable from their expandable cards until they expire, are used,
 * or are revoked.
 * Admins + coordinators can issue/revoke; VIEWER is read-only (and never sees codes).
 */
export default function RegistrationCodesPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const codes = api.admin.registrationCodes.useQuery();

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<RegistrationKind>("TUTOR");
  const [issued, setIssued] = useState<{
    code: string;
    label: string | null;
    email: string | null;
    expiresAt: Date;
    kind: RegistrationKind;
  } | null>(null);
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
        kind: data.kind,
        label: label.trim() || email.trim() || null,
        email: email.trim() || null,
        expiresAt: data.expiresAt,
      });
      setEmail("");
      setLabel("");
      await invalidate();
    },
  });
  const revoke = api.admin.revokeRegistrationCode.useMutation({
    onSuccess: (_data, { id }) => {
      // Stop sharing a freshly issued card when its record is revoked here.
      if (codes.data?.some((c) => c.id === id && c.code === issued?.code)) {
        setIssued(null);
      }
    },
  });
  const review = useActionReview();

  const statusBadge = (status: string) =>
    status === "active"
      ? "badge-green"
      : status === "used"
        ? "badge-slate"
        : "badge-amber";

  return (
    <div className="space-y-6">
      {!readOnly && review.dialog}
      <div>
        <h1 className="page-title">{t("admin.registrationCodes.title")}</h1>
        <p className="muted mt-1">{t("admin.registrationCodes.help")}</p>
        <p className="muted mt-2 text-sm">
          {t("admin.registrationCodes.managementHelp")}
        </p>
      </div>

      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            issue.mutate({
              email: email.trim() || undefined,
              label: label.trim() || undefined,
              kind,
            });
          }}
        >
          {/* Bound each flex item as well as its content-sized control; otherwise
              a long draft gives the wrapper an overflowing intrinsic width. */}
          <div className="max-w-full min-w-0">
            <label className="label" htmlFor="invite-kind">
              {t("admin.registrationCodes.kindField")}
            </label>
            <select
              id="invite-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as RegistrationKind)}
              className="select field-auto-bounded min-h-11 [--field-min-width:8rem] lg:min-h-10"
            >
              {REGISTRATION_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.registrationCodes.${registrationKindLabel[value]}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="max-w-full min-w-0">
            <label className="label">
              {t("admin.registrationCodes.labelField")}
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("admin.registrationCodes.labelPlaceholder")}
              className="input field-auto-bounded min-h-11 [--field-min-width:11rem] lg:min-h-10"
            />
          </div>
          <div className="max-w-full min-w-0">
            <label className="label">
              {t("admin.registrationCodes.emailField")}
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder={t("admin.registrationCodes.emailPlaceholder")}
              className="input field-auto-bounded min-h-11 [--field-min-width:13rem] lg:min-h-10"
            />
          </div>
          <button
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={issue.isPending}
          >
            {t("admin.registrationCodes.issue")}
          </button>
        </form>
      )}
      {issue.error && (
        <p className="text-sm text-red-600">{issue.error.message}</p>
      )}

      {/* Just issued — show the screenshot-ready panel immediately. */}
      {issued && !readOnly && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">
            {t("admin.registrationCodes.issuedTitle", {
              who: issued.label ?? "—",
            })}
          </p>
          <ShareCard
            key={issued.code}
            code={issued.code}
            kind={issued.kind}
            expiresAt={issued.expiresAt}
            registerUrl={registerUrl}
            actions={
              <>
                <Button
                  size="compact"
                  onClick={() => navigator.clipboard?.writeText(issued.code)}
                >
                  {t("admin.registrationCodes.copy")}
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => setIssued(null)}
                >
                  {t("common.dismiss")}
                </Button>
              </>
            }
          />
        </div>
      )}

      <div className="space-y-2">
        {(codes.data ?? []).map((c) => {
          const open = expandedId === c.id;
          return (
            <div key={c.id} className="rounded-lg border border-slate-200 p-4">
              {/* Both groups may shrink and wrap: long labels must never push record actions offscreen. */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex max-w-full min-w-0 items-start gap-2">
                  <Button
                    variant="ghost"
                    size="compact"
                    className="shrink-0 px-2 text-slate-500 hover:text-slate-700"
                    aria-expanded={open}
                    aria-controls={`registration-code-${c.id}`}
                    aria-label={`${
                      open
                        ? t("admin.registrationCodes.collapse")
                        : t("admin.registrationCodes.expand")
                    }: ${c.label ?? c.tutorName ?? "—"}`}
                    onClick={() => setExpandedId(open ? null : c.id)}
                  >
                    <DisclosureIcon open={open} />
                  </Button>
                  <div className="min-w-0">
                    <p className="font-medium [overflow-wrap:anywhere] text-slate-900">
                      {c.label ?? c.tutorName ?? "—"}
                      <span className={`${statusBadge(c.status)} ml-2`}>
                        {t(`admin.registrationCodes.status.${c.status}`)}
                      </span>
                      <span className="badge-slate ml-2">
                        {t(
                          `admin.registrationCodes.${registrationKindLabel[c.kind]}`,
                        )}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex w-full min-w-0 flex-wrap items-center gap-3 lg:w-auto lg:justify-end">
                  {/* Issuer account + bound email, to the left of the expiry. */}
                  <div className="min-w-0 text-xs leading-tight [overflow-wrap:anywhere] text-slate-500 lg:text-right">
                    <p>
                      {t("admin.registrationCodes.colIssuedBy")}:{" "}
                      {c.issuedByName ?? "—"}
                    </p>
                    {c.issuedByEmail && (
                      <EmailDetails
                        contactOnly
                        email={c.issuedByEmail}
                        name={c.issuedByName ?? "—"}
                      />
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {t("admin.registrationCodes.expiresOn", {
                      date: programFormat.dateTime(new Date(c.expiresAt), {
                        dateStyle: "medium",
                      }),
                    })}
                  </p>
                  {!readOnly && c.status === "active" && c.code && (
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => navigator.clipboard?.writeText(c.code!)}
                    >
                      {t("admin.registrationCodes.copy")}
                    </button>
                  )}
                  {!readOnly && c.status === "active" && (
                    <button
                      className="btn-danger btn-sm"
                      onClick={() =>
                        review.open({
                          key: c.id,
                          title: t("actionReview.revokeTitle"),
                          description: t("actionReview.revokeHelp"),
                          confirmLabel: t("admin.registrationCodes.revoke"),
                          details: (
                            <p>
                              {c.label ??
                                c.email ??
                                t(
                                  `admin.registrationCodes.${registrationKindLabel[c.kind]}`,
                                )}{" "}
                              ·{" "}
                              {programFormat.dateTime(new Date(c.expiresAt), {
                                dateStyle: "medium",
                              })}
                            </p>
                          ),
                          commit: () => revoke.mutateAsync({ id: c.id }),
                          refresh: () =>
                            invalidateAndReport(utils.admin.registrationCodes),
                          approvalId: queuedApprovalId,
                        })
                      }
                      disabled={review.blocked(c.id)}
                    >
                      {t("admin.registrationCodes.revoke")}
                    </button>
                  )}
                </div>
              </div>

              <div
                id={`registration-code-${c.id}`}
                hidden={!open}
                className="mt-3 space-y-3 border-t border-slate-100 pt-3"
              >
                {open &&
                  (c.code && c.status === "active" ? (
                    <ShareCard
                      key={c.code}
                      code={c.code}
                      kind={c.kind}
                      expiresAt={c.expiresAt}
                      registerUrl={registerUrl}
                    />
                  ) : c.code ? (
                    // Used / expired: the code is no longer shareable.
                    <div>
                      <p className="label">
                        {t("admin.registrationCodes.codeLabel")}
                      </p>
                      <p className="font-mono text-2xl font-bold tracking-[0.3em] text-slate-400 line-through">
                        {c.code}
                      </p>
                      <p className="muted text-xs">
                        {t("admin.registrationCodes.invalidNote")}
                      </p>
                    </div>
                  ) : (
                    <p className="muted text-sm">
                      {t("admin.registrationCodes.noCode")}
                    </p>
                  ))}
              </div>
            </div>
          );
        })}
        {(codes.data?.length ?? 0) === 0 && (
          <p className="muted py-4 text-center">
            {t("admin.registrationCodes.empty")}
          </p>
        )}
      </div>
    </div>
  );
}
