"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  TableDetails,
  TableAction,
  SummaryTable,
  TableActions,
} from "~/app/_components/ui/summary-table";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { AcademicDetails } from "~/app/_components/academic-profile";
import { AcceptanceRecords } from "~/app/_components/acceptance-records";
import { EmailContent } from "~/app/_components/email-details";
import { TutorDetailsButton } from "~/app/_components/tutor-details";
import { TuteeHistoryDialog } from "~/app/_components/tutee-history";
import { useReadOnly } from "~/app/_components/read-only";
import { LoginSetup, MembershipBadges } from "./presentation";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { participantNameLabel } from "~/app/_components/participant-name";

type AccountRow = RouterOutputs["admin"]["accounts"]["rows"][number];
type Profile = RouterOutputs["admin"]["accountDetails"]["attached"][number];

export function UserDetails({ row }: { row: AccountRow }) {
  const t = useTranslations();
  const displayName = participantNameLabel(
    row.name,
    row.username,
    t("participantNames.unnamed"),
  );
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  if (readOnly) return null;
  return (
    <>
      <TableAction
        aria-haspopup="dialog"
        aria-label={`${t("accountProfile.showDetails")}: ${displayName}`}
        onClick={() => setOpen(true)}
      >
        {t("accountProfile.showDetails")}
      </TableAction>
      {open && (
        <ProfileDialog
          title={t("accountProfile.detailsTitle", { name: displayName })}
          onClose={() => setOpen(false)}
          size="wide"
        >
          <UserDetailContent row={row} />
        </ProfileDialog>
      )}
    </>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="space-y-3 border-b border-slate-200 pb-5 last:border-0"
    >
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

/** Mount only after staff open the row. Every opening rechecks the server because
 * membership, moderation and historical-link editors have independent save scopes.
 * Keep the last successful read during refresh/recovery; never replay a write. */
function UserDetailContent({ row }: { row: AccountRow }) {
  const t = useTranslations();
  const query = api.admin.accountDetails.useQuery(
    row.userId ? { userId: row.userId } : { tutorId: row.tutorId! },
    { refetchOnMount: "always" },
  );
  const data = query.data;
  return (
    <div className="space-y-5">
      {query.error && (
        <StatePanel
          kind="error"
          title={t("uiPatterns.loadFailed")}
          action={
            <Button
              size="compact"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        />
      )}
      {!data && !query.error && (
        <StatePanel kind="loading" title={t("common.loading")} />
      )}
      {data && query.isFetching && (
        <p role="status" className="muted text-sm">
          {t("common.loading")}
        </p>
      )}
      {data && (
        <>
          <DetailSection title={t("usersDirectory.login")}>
            <LoginSetup account={row.account} suspended={!!data.suspendedAt} />
            <p className="muted">
              {t(
                row.userId
                  ? "usersDirectory.setupMeaning"
                  : "usersDirectory.noDirectMeaning",
              )}
            </p>
            {data.mustChangePassword && (
              <p>{t("usersDirectory.passwordRequired")}</p>
            )}
            {data.suspendedAt && (
              <p className="text-red-800">
                {t("usersDirectory.restricted")}
                {data.suspendedReason ? ` ${data.suspendedReason}` : ""}
              </p>
            )}
            {row.affiliation && (
              <p>
                {t("usersDirectory.affiliation")}: {row.affiliation}
              </p>
            )}
            {row.alternativeNames && (
              <p>
                {t("accountProfile.alternativeNames")}: {row.alternativeNames}
              </p>
            )}
            {row.email ? (
              <EmailContent
                email={row.email}
                name={participantNameLabel(
                  row.name,
                  row.username,
                  t("participantNames.unnamed"),
                )}
                userId={row.userId}
                tutorId={row.tutorId}
                verifiedAt={row.emailVerifiedAt}
                linked={!!row.userId}
                canSendSetup={!!row.userId}
              />
            ) : (
              <p>{t("accountProfile.noEmail")}</p>
            )}
            {row.userId && (
              <p className="muted">{t("usersDirectory.recovery")}</p>
            )}
          </DetailSection>
          <DetailSection title={t("usersDirectory.memberships")}>
            {data.membership ? (
              <MembershipBadges membership={data.membership} full />
            ) : (
              <p>{t("usersDirectory.rosterMembership")}</p>
            )}
            <p className="muted">{t("usersDirectory.membershipMeaning")}</p>
            {data.crewStatus && (
              <p>
                {t("usersDirectory.crewLifecycle", {
                  status: t(`usersDirectory.status.${data.crewStatus}`),
                })}
              </p>
            )}
            {data.tutorAccessRevoked && (
              <p className="text-amber-900">
                {t("tutorDetails.accessRevoked")}
              </p>
            )}
            {row.userId && <AcceptanceRecords userId={row.userId} />}
          </DetailSection>
          <DetailSection title={t("usersDirectory.attached")}>
            <p className="muted">
              {t(
                row.userId
                  ? "usersDirectory.attachmentMeaning"
                  : "usersDirectory.rosterMeaning",
              )}
            </p>
            {!row.userId &&
              data.attached.map(
                (profile) =>
                  profile.retainedOwner && (
                    <p key={profile.id}>
                      {t("usersDirectory.retainedBy", {
                        name: participantNameLabel(
                          profile.retainedOwner.name,
                          profile.retainedOwner.username,
                          t("participantNames.unnamed"),
                        ),
                      })}
                    </p>
                  ),
              )}
            {row.userId && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 font-medium">
                  {t("usersDirectory.currentAcademics")}
                </p>
                <AcademicDetails academic={row.academic} />
              </div>
            )}
            <ProfileRecords profiles={data.attached} />
          </DetailSection>
          <DetailSection title={t("usersDirectory.historical")}>
            <p className="muted">{t("usersDirectory.historyMeaning")}</p>
            <ProfileRecords profiles={data.retained} />
          </DetailSection>
        </>
      )}
    </div>
  );
}

function ProfileRecords({ profiles }: { profiles: Profile[] }) {
  const t = useTranslations();
  // Historical attachment names are recorded evidence; normalize only current profile labels.
  const profileName = (profile: Profile) =>
    profile.historical
      ? profile.name
      : participantNameLabel(
          profile.name,
          profile.username,
          t("participantNames.unnamed"),
        );
  const [tuteeId, setTuteeId] = useState<string | null>(null);
  if (!profiles.length)
    return <p className="muted">{t("usersDirectory.noProfiles")}</p>;
  return (
    <>
      <SummaryTable sortable label={t("usersDirectory.profileRecords")}>
        <thead>
          <tr>
            <th>{t("admin.users.columns.user")}</th>
            <th>{t("usersDirectory.lifecycle")}</th>
            <th className="table-actions-heading">
              {t("tablePatterns.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <tr key={`${profile.kind}:${profile.id}`}>
              <td data-sort-value={profileName(profile)}>
                <p className="font-medium">{profileName(profile)}</p>
                <p className="muted text-xs">
                  {t(
                    profile.kind === "TUTOR"
                      ? "admin.users.roles.TUTOR"
                      : "admin.users.roles.STUDENT",
                  )}
                </p>
                {profile.username && (
                  <p className="muted text-xs">@{profile.username}</p>
                )}
              </td>
              <td>{t(`usersDirectory.status.${profile.status}`)}</td>
              <TableActions>
                <TableDetails
                  label={t("academics.title")}
                  title={profileName(profile)}
                >
                  <p className="muted">
                    {t(
                      profile.historical
                        ? "usersDirectory.originalAcademics"
                        : "usersDirectory.currentAcademics",
                    )}
                  </p>
                  <AcademicDetails academic={profile.academic} />
                  {profile.retainedOwner && (
                    <p>
                      {t("usersDirectory.retainedBy", {
                        name: participantNameLabel(
                          profile.retainedOwner.name,
                          profile.retainedOwner.username,
                          t("participantNames.unnamed"),
                        ),
                      })}
                    </p>
                  )}
                </TableDetails>
                {profile.kind === "TUTOR" ? (
                  <TutorDetailsButton
                    tutorId={profile.id}
                    name={profileName(profile)}
                    username={profile.historical ? undefined : profile.username}
                  />
                ) : (
                  <TableAction onClick={() => setTuteeId(profile.id)}>
                    {t("tuteeHistory.details")}
                  </TableAction>
                )}
              </TableActions>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
      {tuteeId && (
        <TuteeHistoryDialog
          tuteeId={tuteeId}
          onClose={() => setTuteeId(null)}
        />
      )}
    </>
  );
}
