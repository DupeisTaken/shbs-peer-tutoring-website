"use client";
import { CodeDisplay } from "~/app/_components/ui/code-field";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Modal } from "~/app/_components/ui/modal";
import { Button } from "~/app/_components/ui/button";
import { SignupError } from "~/app/_components/signup-error";
import { rememberInvitation } from "./actions";
import { SignupProgress } from "../signup/signup-progress";

export type InvitationReceiptData = {
  invitationId: string;
  code?: string;
  proof?: string;
  email?: string;
};

/** Mailbox verification issues a receipt here; account review still follows. Closing retains it;
 * optional email failure never forces the applicant to repeat verification. */
export function InvitationReceipt({
  invitation,
  tuteeSignup = false,
}: {
  invitation: InvitationReceiptData;
  tuteeSignup?: boolean;
}) {
  const t = useTranslations("accountInvitation");
  const survey = useTranslations("survey");
  const title = tuteeSignup ? survey("reviewTitle") : t("receiptTitle");
  const help = tuteeSignup ? survey("reviewHelp") : t("receiptHelp");
  const continueLabel = tuteeSignup
    ? survey("stepReview")
    : t("continueSignup");
  const [open, setOpen] = useState(true);
  const reopen = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(!invitation.proof);
  const [copied, setCopied] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const sending = useRef(false);
  const send = api.accountInvitation.email.useMutation({
    onSettled: () => {
      sending.current = false;
    },
  });
  useEffect(() => {
    let active = true;
    if (!invitation.proof) return;
    void rememberInvitation({
      invitationId: invitation.invitationId,
      proof: invitation.proof,
    })
      .catch(() => {
        if (active) setHandoffFailed(true);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [invitation.invitationId, invitation.proof]);
  const href = `/register?invitation=${encodeURIComponent(invitation.invitationId)}${invitation.code ? `&code=${encodeURIComponent(invitation.code)}` : ""}`;
  const closeReceipt = () => {
    setOpen(false);
    requestAnimationFrame(() => reopen.current?.focus());
  };
  return (
    <section className="space-y-4 text-center">
      {tuteeSignup ? (
        <SignupProgress current={2} title={title} />
      ) : (
        <h2 className="section-title">{title}</h2>
      )}
      <p className="muted text-sm">{help}</p>
      {/* Closing a receipt must leave the actual next step reachable, not only its code. */}
      {!open &&
        tuteeSignup &&
        (ready && !send.isPending ? (
          <Link className="btn-primary w-full text-center" href={href}>
            {continueLabel}
          </Link>
        ) : (
          <Button disabled className="w-full">
            {continueLabel}
          </Button>
        ))}
      <Button ref={reopen} onClick={() => setOpen(true)}>
        {t("showCode")}
      </Button>
      {open && (
        <Modal
          title={title}
          description={help}
          onClose={closeReceipt}
          busy={send.isPending || !ready}
          footer={
            <>
              {ready && !send.isPending ? (
                <Link className="btn-primary w-full text-center" href={href}>
                  {continueLabel}
                </Link>
              ) : (
                <Button disabled className="w-full">
                  {continueLabel}
                </Button>
              )}
              <Button variant="secondary" onClick={closeReceipt}>
                {t("close")}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div
              data-code-purpose="invitation"
              className="code-surface rounded-xl border border-slate-200 px-4 py-6 text-center"
            >
              <CodeDisplay code={invitation.code ?? ""} />
              <p className="mt-3 text-sm break-all text-slate-600">
                {invitation.email}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(invitation.code ?? "")
                    .then(
                      () => setCopied(true),
                      () => setCopied(false),
                    );
                }}
              >
                {t(copied ? "copied" : "copyCode")}
              </Button>
              <Button
                variant="secondary"
                disabled={!invitation.proof || send.isPending || send.isSuccess}
                onClick={() => {
                  if (
                    invitation.proof &&
                    !sending.current &&
                    !send.isPending &&
                    !send.isSuccess
                  ) {
                    sending.current = true;
                    send.mutate({
                      invitationId: invitation.invitationId,
                      proof: invitation.proof,
                    });
                  }
                }}
              >
                {t(send.isSuccess ? "emailed" : "emailCode")}
              </Button>
            </div>
            {send.isSuccess && (
              <p role="status" className="text-sm text-slate-600">
                {t("emailSent")}
              </p>
            )}
            {send.error && (
              <p role="alert" className="text-sm text-red-700">
                <SignupError error={send.error} />
              </p>
            )}
            {handoffFailed && (
              <p role="status" className="text-sm text-slate-600">
                {t("handoffRecovery")}
              </p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
