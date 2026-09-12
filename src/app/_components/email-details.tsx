"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { api } from "~/trpc/react";

type EmailDetailsProps = {
  email: string | null | undefined;
  name: string;
  verifiedAt?: Date | null;
  userId?: string | null;
  tutorId?: string | null;
  canSendSetup?: boolean;
  linked?: boolean;
  contactOnly?: boolean;
};

/** Long addresses live in an accessible detail dialog, never in a roster's width calculation. */
export function EmailDetails(props: EmailDetailsProps) {
  const t = useTranslations("accountProfile");
  const [open, setOpen] = useState(false);
  if (!props.email)
    return <span className="muted text-xs">{t("noEmail")}</span>;
  return (
    <>
      <button
        type="button"
        className="link text-xs whitespace-nowrap"
        onClick={() => setOpen(true)}
      >
        {t("showEmail")}
      </button>
      {open && (
        <ProfileDialog
          title={t("emailTitle", { name: props.name })}
          onClose={() => setOpen(false)}
        >
          <EmailContent {...props} email={props.email} />
        </ProfileDialog>
      )}
    </>
  );
}

/** Mutation observers only exist while a dialog is open, even on a long roster. */
function EmailContent({
  email,
  verifiedAt,
  userId,
  tutorId,
  canSendSetup = false,
  linked = false,
  contactOnly = false,
}: EmailDetailsProps & { email: string }) {
  const t = useTranslations("accountProfile");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const verify = api.admin.sendAccountVerification.useMutation();
  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-base [overflow-wrap:anywhere] select-all">
        {email}
      </p>
      <p className="muted text-sm">
        {contactOnly
          ? t("contactAddress")
          : verifiedAt
            ? t("verified")
            : linked
              ? t("unverified")
              : t("setupRequired")}
      </p>
      <p className="muted text-sm">
        {linked ? t("emailProtected") : t("unlinkedEmail")}
      </p>
      {!contactOnly && !linked && tutorId && (
        <p className="muted text-sm">
          <Link href="/admin/users" className="link">
            {t("inviteInUsers")}
          </Link>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            try {
              if (!navigator.clipboard)
                throw new Error("Clipboard unavailable");
              await navigator.clipboard.writeText(email);
              setCopyState("copied");
            } catch {
              setCopyState("error");
            }
          }}
        >
          {t("copyEmail")}
        </button>
        {!contactOnly && canSendSetup && userId && !verifiedAt && (
          <button
            type="button"
            className="btn-primary"
            disabled={verify.isPending}
            onClick={() => verify.mutate({ userId })}
          >
            {t("sendVerification")}
          </button>
        )}
      </div>
      {copyState !== "idle" && (
        <p role="status" className="text-sm">
          {t(copyState === "copied" ? "copied" : "copyError")}
        </p>
      )}
      {verify.isSuccess && (
        <p role="status" className="text-sm">
          {verify.data.emailed ? t("sent") : t("deliveryUnavailable")}
        </p>
      )}
      {verify.error && (
        <p role="alert" className="text-sm text-red-600">
          {verify.error.message}
        </p>
      )}
    </div>
  );
}
