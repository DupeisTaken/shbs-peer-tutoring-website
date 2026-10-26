"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { tutorDirectoryHref } from "~/lib/tutor-directory-link";
import { ShareCard } from "~/app/(admin)/admin/registration-codes/share-card";
import { useReadOnly } from "./read-only";
import { useSessionAccessDenied } from "./session-view-state";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { InlineNotice, StatePanel } from "./ui/patterns";

/** The button mounts no private read until it opens. The endpoint independently
 * authorizes staff and resolves this exact application's existing invitation. */
export function ApplicationAccountSetupButton({
  applicationId,
  name,
  label,
  disabled = false,
}: {
  applicationId: string;
  name: string;
  label?: string;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const [opening, setOpening] = useState<{
    origin: string;
    time: number;
  } | null>(null);
  if (readOnly) return null;
  return (
    <>
      <button
        type="button"
        className="link inline-flex min-h-11 max-w-full items-center text-sm break-words disabled:text-slate-500 lg:min-h-8"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() =>
          setOpening({ origin: window.location.origin, time: Date.now() })
        }
      >
        {label ?? t("admin.applications.setupAccount")}
      </button>
      {opening && !disabled && (
        <ApplicationAccountSetupDialog
          key={applicationId}
          applicationId={applicationId}
          name={name}
          origin={opening.origin}
          openedAt={opening.time}
          onClose={() => setOpening(null)}
        />
      )}
    </>
  );
}

function ApplicationAccountSetupDialog({
  applicationId,
  name,
  origin,
  openedAt,
  onClose,
}: {
  applicationId: string;
  name: string;
  origin: string;
  openedAt: number;
  onClose: () => void;
}) {
  const t = useTranslations("applicationAccountSetup");
  const all = useTranslations();
  const query = api.admin.applicationAccountSetup.useQuery(
    { applicationId },
    { refetchOnMount: "always", staleTime: 0, gcTime: 0, retry: false },
  );
  const denied = useSessionAccessDenied(query);
  // Browser context is captured by the open event, keeping render deterministic.
  const [clock, setClock] = useState(openedAt);
  const [copyResult, setCopyResult] = useState<{
    invitationId: string;
    status: "copied" | "copyFailed";
  } | null>(null);
  const expiresAt = query.data?.invitation?.expiresAt.getTime();
  useEffect(() => {
    if (expiresAt === undefined || expiresAt <= clock) return;
    // An open share card must stop offering a code when its deadline passes.
    const timeout = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(Math.max(0, expiresAt - Date.now() + 1), 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [expiresAt, clock]);
  const ready = !!query.data && !query.error && !query.isFetching && !denied;
  const expired = expiresAt !== undefined && expiresAt <= clock;
  const state =
    expired && query.data?.state === "active" ? "expired" : query.data?.state;
  const invitation = ready && !expired ? query.data?.invitation : null;
  const refresh = (
    <Button
      size="compact"
      disabled={query.isFetching}
      onClick={() => {
        setCopyResult(null);
        setClock(Date.now());
        void query.refetch();
      }}
    >
      {t("refresh")}
    </Button>
  );
  async function copyCode() {
    if (!invitation) return;
    const now = Date.now();
    if (invitation.expiresAt.getTime() <= now) {
      setClock(now);
      return;
    }
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(invitation.code);
      setCopyResult({ invitationId: invitation.id, status: "copied" });
    } catch {
      setCopyResult({ invitationId: invitation.id, status: "copyFailed" });
    }
  }

  return (
    <Modal
      title={t("title", { name })}
      onClose={onClose}
      footer={
        <>
          {refresh}
          <Button size="compact" data-dialog-autofocus onClick={onClose}>
            {all("common.close")}
          </Button>
        </>
      }
    >
      {denied ? (
        <StatePanel kind="error" title={t("denied")} />
      ) : query.error ? (
        <StatePanel kind="error" title={t("error")} />
      ) : !ready ? (
        <StatePanel kind="loading" title={t("loading")} />
      ) : (
        <div className="space-y-4">
          <InlineNotice
            tone={
              state === "linked"
                ? "success"
                : state === "active"
                  ? "info"
                  : "warning"
            }
          >
            {state && t(state)}
          </InlineNotice>
          {query.data?.account && (
            <dl className="text-sm">
              <dt className="muted">{all("tutorDetails.username")}</dt>
              <dd className="font-medium break-words">
                {query.data.account.username ?? query.data.account.name ?? name}
              </dd>
            </dl>
          )}
          {invitation && (
            <ShareCard
              code={invitation.code}
              expiresAt={invitation.expiresAt}
              registerUrl={`${origin}/register`}
              kind="TUTOR"
              actions={
                <Button size="compact" onClick={() => void copyCode()}>
                  {all("admin.registrationCodes.copy")}
                </Button>
              }
            />
          )}
          {copyResult && invitation?.id === copyResult.invitationId && (
            <p role="status" className="text-sm">
              {t(copyResult.status)}
            </p>
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            {query.data?.tutorId && (
              <Link
                className="link inline-flex min-h-11 items-center lg:min-h-8"
                href={tutorDirectoryHref(query.data.tutorId)}
              >
                {t("openUser")}
              </Link>
            )}
            {state !== "linked" && state !== "notEligible" && (
              <Link
                className="link inline-flex min-h-11 items-center lg:min-h-8"
                href={
                  invitation
                    ? `/admin/registration-codes#registration-code-${invitation.id}`
                    : "/admin/registration-codes"
                }
              >
                {t("openCodes")}
              </Link>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
