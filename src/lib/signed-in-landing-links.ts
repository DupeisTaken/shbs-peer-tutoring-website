import { portalAccess } from "~/lib/portal-access";
import { shortSignupHref } from "~/lib/public-signup-links";
import { translationAccess } from "~/lib/translation-access";

export type SignedInLandingAccount = {
  role: string;
  suspendedAt?: Date | null;
  mergedIntoId?: string | null;
  studentId?: string | null;
  tuteeMember?: boolean;
  crewStatus?: string | null;
  tutorId?: string | null;
  tutorAccessRevoked?: boolean;
  canTranslate?: boolean;
  schoolDeparture?: {
    reason: string | null;
    observerRevoked: boolean;
    tutorDerived: boolean;
  } | null;
  tutor?: { status: string } | null;
};

export type SignedInLandingLinkLabels = {
  enterTutor: string;
  enterTutee: string;
  enterCrew: string;
  enterAdmin: string;
  enterOverview: string;
  enterTranslations: string;
};

export type SignedInLinkTarget = {
  href: string;
  label: string;
};

/**
 * Serializable replacement map keyed by canonical short public paths
 * (`/tutee`, `/tutor`, `/crew`, `/viewer`, `/signin`).
 */
export type SignedInLinkMap = {
  byPath: Partial<Record<string, SignedInLinkTarget>>;
};

/**
 * Server-authoritative resolver that maps public signup/join links on Program Home
 * and published custom pages to direct workspace entry links whenever the signed-in
 * account already holds that role/capability.
 *
 * Security & role-preservation invariants:
 * - Never grants or suggests a workspace the account is not authorized to enter.
 * - Pure tutors/staff who are not yet tutee members keep the `/tutee` signup link so
 *   they can still request tutoring; accounts with tutee membership, student linkage,
 *   or departed-student history receive "Enter Tutee Page" -> `/student`.
 * - Invitation redemption (`/register`) is intentionally left unchanged because
 *   signed-in users use it to add new access to an existing account.
 */
export function resolveSignedInLandingLinks({
  account,
  crewEnabled,
  labels,
}: {
  account: SignedInLandingAccount | null | undefined;
  crewEnabled: boolean;
  labels: SignedInLandingLinkLabels;
}): SignedInLinkMap {
  if (!account || account.suspendedAt || account.mergedIntoId) {
    return { byPath: {} };
  }

  const access = portalAccess(account);
  const staff = ["HEAD", "ADMIN", "COORDINATOR"].includes(account.role);
  const elevatedOrViewer = staff || account.role === "VIEWER";
  const canTutor =
    !account.tutorAccessRevoked &&
    !!(account.tutor ?? account.tutorId) &&
    (!elevatedOrViewer || account.tutor?.status !== "ARCHIVED");
  const hasTutee =
    account.role !== "VIEWER" &&
    (Boolean(account.tuteeMember) || Boolean(account.studentId) || access.departed);
  const canCrew =
    crewEnabled &&
    (account.crewStatus === "ACTIVE" || account.role === "CREW");
  const canTranslate = translationAccess(account).enter;

  const byPath: Partial<Record<string, SignedInLinkTarget>> = {};

  if (canTutor) {
    byPath["/tutor"] = { href: "/dashboard", label: labels.enterTutor };
  }
  if (hasTutee) {
    byPath["/tutee"] = { href: "/student", label: labels.enterTutee };
  }
  if (canCrew) {
    byPath["/crew"] = { href: "/patrol", label: labels.enterCrew };
  }
  if (access.canReadManagement) {
    byPath["/viewer"] = {
      href: "/admin",
      label: access.managementReadOnly
        ? labels.enterOverview
        : labels.enterAdmin,
    };
  }

  // Replace generic `/signin` CTAs with the signed-in user's primary workspace.
  const primary: SignedInLinkTarget | null = staff
    ? { href: "/admin", label: labels.enterAdmin }
    : access.canReadManagement
      ? { href: "/admin", label: labels.enterOverview }
      : canTutor
        ? { href: "/dashboard", label: labels.enterTutor }
        : hasTutee
          ? { href: "/student", label: labels.enterTutee }
          : canCrew
            ? { href: "/patrol", label: labels.enterCrew }
            : canTranslate
              ? { href: "/localization", label: labels.enterTranslations }
              : null;
  if (primary) {
    byPath["/signin"] = primary;
  }

  return { byPath };
}

/** Resolve a localized replacement for a public link href when the signed-in account already holds the role. */
export function resolveSignedInLink(
  href: string,
  map?: SignedInLinkMap | null,
): SignedInLinkTarget | null {
  if (!map || !href.startsWith("/") || href.startsWith("//")) return null;
  const normalized = shortSignupHref(href);
  const split = normalized.search(/[?#]/);
  const path = split < 0 ? normalized : normalized.slice(0, split);
  return map.byPath[path] ?? null;
}

/** Standard localized label bundle from next-intl's root translator. */
export function signedInLandingLinkLabels(
  t: (key: string) => string,
): SignedInLandingLinkLabels {
  return {
    enterTutor: t("components.userMenu.enterTutor"),
    enterTutee: t("components.userMenu.enterTutee"),
    enterCrew: t("components.userMenu.enterCrew"),
    enterAdmin: t("components.userMenu.enterAdmin"),
    enterOverview: t("components.userMenu.enterOverview"),
    enterTranslations: t("components.userMenu.enterTranslations"),
  };
}
