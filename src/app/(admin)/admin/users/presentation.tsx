"use client";

import { useTranslations } from "next-intl";
import {
  membershipBadges,
  type AccountMembership,
} from "~/lib/account-membership";

/** Local presentation only: colors distinguish authority from participation without
 * changing the existing summary membership predicate or implying active status. */
export function MembershipBadges({
  membership,
  full = false,
}: {
  membership: AccountMembership;
  full?: boolean;
}) {
  const t = useTranslations();
  const badges = membershipBadges(membership);
  if (full && membership.tutor && membership.tutee) badges.push("STUDENT");
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.length ? (
        badges.map((badge) => (
          <span
            key={badge}
            className={`badge ${
              ["HEAD", "ADMIN", "COORDINATOR"].includes(badge)
                ? "bg-indigo-100 text-indigo-900"
                : ["TUTOR", "STUDENT", "CREW"].includes(badge)
                  ? "bg-teal-100 text-teal-900"
                  : badge === "TRANSLATOR"
                    ? "bg-amber-100 text-amber-900"
                    : "bg-slate-100 text-slate-800"
            }`}
          >
            {badge === "TRANSLATOR"
              ? t("membership.translator")
              : t(`admin.users.roles.${badge}`)}
          </span>
        ))
      ) : (
        <span className="muted">{t("userMultiFilters.noRole")}</span>
      )}
    </div>
  );
}

export function LoginSetup({
  account,
  suspended = false,
}: {
  account: string;
  suspended?: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap gap-1.5">
      <span
        className={
          account === "registered"
            ? "badge bg-green-100 text-green-900"
            : account === "none"
              ? "badge-slate"
              : "badge bg-amber-100 text-amber-900"
        }
      >
        {t(`usersDirectory.setup.${account}`)}
      </span>
      {account === "invited" && (
        <span className="badge-slate">{t("usersDirectory.setup.none")}</span>
      )}
      {suspended && (
        <span className="badge-red">{t("admin.users.suspended")}</span>
      )}
    </div>
  );
}
