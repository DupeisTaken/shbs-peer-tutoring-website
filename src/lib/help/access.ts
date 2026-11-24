import { portalAccess } from "~/lib/portal-access";
import { translationAccess } from "~/lib/translation-access";
import type { HelpAudience } from "./types";

export type HelpAccessAccount = {
  role: string;
  suspendedAt?: Date | null;
  mergedIntoId?: string | null;
  tutorAccessRevoked?: boolean;
  tutor?: { status: string } | null;
  crewStatus?: string | null;
  canTranslate?: boolean | null;
  schoolDeparture?: {
    reason: string | null;
    observerRevoked: boolean;
    tutorDerived: boolean;
  } | null;
};

export type HelpAccess = {
  audiences: HelpAudience[];
  /** Audiences this visitor or account may download as PDF handbooks. */
  downloadableAudiences: HelpAudience[];
  /** Staff handbook distribution page (/admin/help) remains staff-only. */
  canDownload: boolean;
};

const ALL_AUDIENCES: readonly HelpAudience[] = [
  "public",
  "account",
  "student",
  "tutor",
  "crew",
  "observer",
  "staff",
  "admin",
  "head",
  "translator",
];

/** Guidance follows current capabilities, not a stale session role. Memberships
 * stay independent: management does not imply a tutor or crew assignment. Everyone
 * may download PDF handbooks for their authorized audiences; staff may also
 * distribute participant training handbooks while keeping admin/Head gated. */
export function helpAccess(
  account: HelpAccessAccount | null,
  crewEnabled = true,
): HelpAccess {
  const audiences: HelpAudience[] = ["public"];
  if (!account || account.mergedIntoId)
    return {
      audiences,
      downloadableAudiences: [...audiences],
      canDownload: false,
    };
  audiences.push("account");
  // Recovery guidance remains readable while the account's workspaces are suspended.
  if (account.suspendedAt)
    return {
      audiences,
      downloadableAudiences: [...audiences],
      canDownload: false,
    };

  const access = portalAccess(account);
  const staff = ["HEAD", "ADMIN", "COORDINATOR"].includes(account.role);
  if (access.canParticipate || (access.departed && account.role !== "VIEWER"))
    audiences.push("student");
  const elevated = staff || account.role === "VIEWER";
  if (
    !account.tutorAccessRevoked &&
    account.tutor &&
    (!elevated || account.tutor.status !== "ARCHIVED")
  )
    audiences.push("tutor");
  if (crewEnabled && (account.crewStatus != null || account.role === "CREW"))
    audiences.push("crew");
  if (access.canReadManagement) audiences.push("observer");
  if (staff) audiences.push("staff");
  if (account.role === "ADMIN" || account.role === "HEAD")
    audiences.push("admin");
  if (account.role === "HEAD") audiences.push("head");
  if (translationAccess(account).enter) audiences.push("translator");

  const downloadableAudiences = staff
    ? ALL_AUDIENCES.filter(
        (audience) =>
          (audience !== "admin" && audience !== "head") ||
          audiences.includes(audience),
      )
    : [...audiences];

  return { audiences, downloadableAudiences, canDownload: staff };
}
