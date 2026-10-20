"use client";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import {
  REGISTRATION_KINDS,
  isManagementCode,
  registrationKindLabel,
  type RegistrationKind,
} from "~/lib/registration-kind";
import { EmailDetails } from "~/app/_components/email-details";

import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { ShareCard } from "./share-card";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { Button } from "~/app/_components/ui/button";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { queuedApprovalId } from "~/lib/approval-outcome";

/**
 * Registration codes: issue single-use five-digit security keys for new tutors and track their
 * status. Active codes remain re-viewable from their expandable cards until they expire, are used,
 * or are revoked.
 * Head issues directly; Admin also issues Tutor/Crew codes directly. Other eligible
 * issuance and non-Head revocation actions require Head review. VIEWER is read-only.
 */
export default function RegistrationCodesPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const codes = api.admin.registrationCodes.useQuery(undefined, {
    enabled: !denied,
  });
  const identity = api.account.me.useQuery(undefined, { enabled: !denied });
  const codesDenied =
    codes.error?.data?.code === "FORBIDDEN" ||
    codes.error?.data?.code === "UNAUTHORIZED";
  const identityDenied =
    identity.error?.data?.code === "FORBIDDEN" ||
    identity.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (codesDenied || identityDenied) {
      setDenied(true);
      if (codesDenied)
        queryClient.removeQueries({
          queryKey: getQueryKey(
            api.admin.registrationCodes,
            undefined,
            "query",
          ),
        });
      if (identityDenied)
        queryClient.removeQueries({
          queryKey: getQueryKey(api.account.me, undefined, "query"),
        });
    } else if (
      codes.isSuccess &&
      identity.isSuccess &&
      !codes.isFetching &&
      !identity.isFetching
    )
      setDenied(false);
  }, [
    codesDenied,
    identityDenied,
    codes.isSuccess,
    identity.isSuccess,
    codes.isFetching,
    identity.isFetching,
    queryClient,
  ]);
  const readBlocked =
    codes.data === undefined ||
    !identity.data ||
    !!codes.error ||
    !!identity.error;
  const section = t(
    codes.error || codes.data === undefined
      ? "admin.registrationCodes.title"
      : "account.title",
  );
  const retry = () => {
    if (codes.error || codes.data === undefined || denied) void codes.refetch();
    if (identity.error || !identity.data || denied) void identity.refetch();
  };
  const role = identity.data?.role;
  useSessionPageScroll({
    id: "registration-codes-v1",
    ready:
      codes.data !== undefined &&
      !!identity.data &&
      !denied &&
      !codesDenied &&
      !identityDenied,
    enabled: !denied && !codesDenied && !identityDenied,
  });
  const isHead = role === "HEAD";
  const canSubmitManagement = isHead || role === "ADMIN";
  const kinds = REGISTRATION_KINDS.filter(
    (value) =>
      canSubmitManagement || (value !== "ADMIN" && value !== "COORDINATOR"),
  );

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<RegistrationKind>("TUTOR");
  // Match issuance authority for the selected kind without broadening revocation.
  const canIssueDirectly =
    isHead || (role === "ADMIN" && !isManagementCode(kind));
  const [issued, setIssued] = useState<{
    code: string;
    label: string | null;
    email: string | null;
    expiresAt: Date;
    kind: RegistrationKind;
  } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const revealedCode = useRef("");
  // Contextual interview links reveal only a record returned by this authorized read.
  // Handle arrival after loading and same-page hash changes without reopening a
  // card the user deliberately collapsed on a later background refresh.
  useEffect(() => {
    if (denied || codesDenied || identityDenied || readBlocked) return;
    let frame: number | undefined;
    const reveal = () => {
      const hash = window.location.hash;
      if (hash === revealedCode.current) return;
      const code = codes.data?.find(
        (row) => `#registration-code-${row.id}` === hash,
      );
      if (!code) return;
      revealedCode.current = hash;
      setExpandedId(code.id);
      frame = requestAnimationFrame(() =>
        focusVisibleContext(
          document.getElementById(`registration-code-${code.id}`),
        ),
      );
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      window.removeEventListener("hashchange", reveal);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [codes.data, denied, codesDenied, identityDenied, readBlocked]);
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
  if (denied || codesDenied || identityDenied)
    return (
      <div className="space-y-6">
        <h1 className="page-title">{t("admin.registrationCodes.title")}</h1>
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", { section })}
          action={
            <Button
              size="compact"
              disabled={codes.isFetching || identity.isFetching}
              onClick={retry}
            >
              {t("managementRecovery.retry", { section })}
            </Button>
          }
        />
      </div>
    );

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

      <QueryFeedback
        hasData={codes.data !== undefined && !!identity.data}
        loading={codes.data === undefined || !identity.data}
        error={!!codes.error || !!identity.error}
        retrying={codes.isFetching || identity.isFetching}
        loadingTitle={t("managementRecovery.loading", { section })}
        errorTitle={t(
          codes.data !== undefined && identity.data
            ? "managementRecovery.refreshFailed"
            : "managementRecovery.loadFailed",
          { section },
        )}
        retryLabel={t("managementRecovery.retry", { section })}
        onRetry={retry}
      />

      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              readBlocked ||
              !role ||
              issue.isPending ||
              !kinds.includes(kind)
            )
              return;
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
            <label className="label" htmlFor={`${fieldId}-kind`}>
              {t("admin.registrationCodes.kindField")}
            </label>
            <select
              id={`${fieldId}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as RegistrationKind)}
              className="select field-auto-bounded min-h-11 [--field-min-width:8rem] lg:min-h-10"
            >
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.registrationCodes.${registrationKindLabel[value]}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="max-w-full min-w-0">
            <label className="label" htmlFor={`${fieldId}-label`}>
              {t("admin.registrationCodes.labelField")}
            </label>
            <input
              id={`${fieldId}-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("admin.registrationCodes.labelPlaceholder")}
              className="input field-auto-bounded min-h-11 [--field-min-width:11rem] lg:min-h-10"
            />
          </div>
          <div className="max-w-full min-w-0">
            <label className="label" htmlFor={`${fieldId}-email`}>
              {t("admin.registrationCodes.emailField")}
            </label>
            <input
              id={`${fieldId}-email`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder={t("admin.registrationCodes.emailPlaceholder")}
              className="input field-auto-bounded min-h-11 [--field-min-width:13rem] lg:min-h-10"
            />
          </div>
          <button
            className="btn-primary min-h-11 lg:min-h-10"
            disabled={
              readBlocked || issue.isPending || !role || !kinds.includes(kind)
            }
          >
            {canIssueDirectly
              ? t("admin.registrationCodes.issue")
              : t("approvals.requestHead")}
          </button>
        </form>
      )}
      {issue.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {t("approvals.queuedBody")}
        </InlineNotice>
      )}
      {issue.error && !issue.error.data?.approvalId && (
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Center the identity block on the chevron, then center badges
                    on the name line. Inline baselines drift when the trigger is taller. */}
                <div className="flex max-w-full min-w-0 items-center gap-2">
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
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium [overflow-wrap:anywhere] text-slate-900">
                      <span className="min-w-0">
                        {c.label ?? c.tutorName ?? "—"}
                      </span>
                      <span className={statusBadge(c.status)}>
                        {t(`admin.registrationCodes.status.${c.status}`)}
                      </span>
                      <span className="badge-slate">
                        {t(
                          `admin.registrationCodes.${registrationKindLabel[c.kind]}`,
                        )}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex w-full min-w-0 flex-wrap items-center gap-3 lg:w-auto lg:justify-end">
                  {/* Issuer account + bound email, to the left of the expiry. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-500">
                    <span>{t("admin.registrationCodes.colIssuedBy")}:</span>
                    {c.issuedByEmail ? (
                      <EmailDetails
                        contactOnly
                        triggerLabel={c.issuedByName ?? "—"}
                        email={c.issuedByEmail}
                        name={c.issuedByName ?? "—"}
                      />
                    ) : (
                      <span>{c.issuedByName ?? "—"}</span>
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
                                c.tutorName ??
                                c.email ??
                                `${t(`admin.registrationCodes.${registrationKindLabel[c.kind]}`)} · ${c.id}`}{" "}
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
                      disabled={readBlocked || review.blocked(c.id)}
                    >
                      {t("admin.registrationCodes.revoke")}
                    </button>
                  )}
                </div>
              </div>

              <div
                id={`registration-code-${c.id}`}
                tabIndex={-1}
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
                      <p className="font-mono text-2xl font-bold tracking-[0.3em] text-green-800 line-through">
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
        {!codes.error && codes.data?.length === 0 && (
          <p className="muted py-4 text-center">
            {t("admin.registrationCodes.empty")}
          </p>
        )}
      </div>
    </div>
  );
}
