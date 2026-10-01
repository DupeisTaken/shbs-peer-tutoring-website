"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "./ui/button";
import { useDialogPending } from "./ui/modal";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { api } from "~/trpc/react";
import { useReadOnly } from "./read-only";
import { AcceptanceRecords } from "./acceptance-records";
import { AcademicDetails } from "./academic-profile";
import type { AcademicSummary } from "~/lib/academics";

type EmailDetailsProps = {
  email: string | null | undefined;
  name: string;
  verifiedAt?: Date | null;
  userId?: string | null;
  tutorId?: string | null;
  canSendSetup?: boolean;
  linked?: boolean;
  contactOnly?: boolean;
  showPolicyHistory?: boolean;
  /** Optional identity metadata shares the on-demand dialog instead of widening summary cells. */
  details?: ReactNode;
  academic?: AcademicSummary;
  triggerClassName?: string;
};

/** Long addresses live in an accessible detail dialog, never in a roster's width calculation. */
export function EmailDetails(props: EmailDetailsProps) {
  const t = useTranslations("accountProfile");
  const [open, setOpen] = useState(false);
  const readOnly = useReadOnly();
  // Masked API values mean private, not missing; observers must not infer account setup needs.
  if (readOnly)
    return <span className="muted text-xs">{t("privateEmail")}</span>;
  if (!props.email && !props.showPolicyHistory)
    return <span className="muted text-xs">{t("noEmail")}</span>;
  return (
    <>
      <button
        type="button"
        className={`table-action-link ${props.triggerClassName ?? ""}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t(props.showPolicyHistory ? "showDetails" : "showEmail")}
      </button>
      {open && (
        <ProfileDialog
          title={t(props.showPolicyHistory ? "detailsTitle" : "emailTitle", {
            name: props.name,
          })}
          onClose={() => setOpen(false)}
        >
          {props.details}
          {props.showPolicyHistory && props.academic && (
            <section className="mb-5 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <AcademicSectionTitle />
              <AcademicDetails academic={props.academic} />
            </section>
          )}
          {props.email ? (
            <EmailContent {...props} email={props.email} />
          ) : (
            <p className="muted">{t("noEmail")}</p>
          )}
          {props.showPolicyHistory && props.userId && (
            <AcceptanceRecords key={props.userId} userId={props.userId} />
          )}
          {props.showPolicyHistory && !props.userId && (
            <p className="muted mt-4 text-sm">{t("noAccountHistory")}</p>
          )}
        </ProfileDialog>
      )}
    </>
  );
}

function AcademicSectionTitle() {
  const t = useTranslations("academics");
  return <h3 className="font-semibold">{t("title")}</h3>;
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
  const history = useTranslations("tuteeHistory");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const verify = api.admin.sendAccountVerification.useMutation();
  const busy = useDialogPending(verify.isPending);
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
              : history("noAccount")}
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
        <Button
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
        </Button>
        {!contactOnly && canSendSetup && userId && !verifiedAt && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => verify.mutate({ userId })}
          >
            {t("sendVerification")}
          </Button>
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
