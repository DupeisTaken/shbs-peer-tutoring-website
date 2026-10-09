"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Modal } from "~/app/_components/ui/modal";
import { Button } from "~/app/_components/ui/button";
import { SignupError } from "~/app/_components/signup-error";
import { rememberInvitation } from "./actions";

export type InvitationReceiptData = {
  invitationId: string;
  code?: string;
  proof?: string;
  email?: string;
};

/** Both public applications finish here. Closing the popup retains its receipt;
 * optional email failure never forces the applicant to repeat verification. */
export function InvitationReceipt({
  invitation,
}: {
  invitation: InvitationReceiptData;
}) {
  const t = useTranslations("accountInvitation");
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
      <h2 className="section-title">{t("receiptTitle")}</h2>
      <p className="muted text-sm">{t("receiptHelp")}</p>
      <Button ref={reopen} onClick={() => setOpen(true)}>
        {t("showCode")}
      </Button>
      {open && (
        <Modal
          title={t("receiptTitle")}
          description={t("receiptHelp")}
          onClose={closeReceipt}
          busy={send.isPending || !ready}
          footer={
            <>
              {ready && !send.isPending ? (
                <Link className="btn-primary w-full text-center" href={href}>
                  {t("continueSignup")}
                </Link>
              ) : (
                <Button disabled className="w-full">
                  {t("continueSignup")}
                </Button>
              )}
              <Button variant="secondary" onClick={closeReceipt}>
                {t("close")}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center">
              <p className="mb-2 text-sm text-slate-500">{t("code")}</p>
              <p className="font-mono text-2xl font-semibold tracking-[0.16em] break-all text-slate-900">
                {invitation.code}
              </p>
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
