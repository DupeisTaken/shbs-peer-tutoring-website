"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { AccountProfileEditor } from "~/app/_components/account-profile-editor";
import { accountMembership } from "~/lib/account-membership";
import { CombineRecords } from "~/app/_components/combine-records";
import { HistoricalRecordInvitation } from "~/app/_components/historical-record-invitation";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";

type DirectoryRow = RouterOutputs["admin"]["accounts"]["rows"][number];
type AccountRow = { [Key in keyof DirectoryRow]: DirectoryRow[Key] };
type Profile = RouterOutputs["admin"]["accountDetails"]["attached"][number];

export function UserDetails({
  row,
  onOpenChange,
}: {
  row: AccountRow;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations();
  const displayName = participantNameLabel(
    row.name,
    row.username,
    t("participantNames.unnamed"),
  );
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  // Keep denial across closing/reopening so a cached success cannot briefly
  // expose private details before the mandatory fresh read completes.
  const [detailsAccessLost, setDetailsAccessLost] = useState(false);
  // An already-open reader/editor owns focus even if browser history selects a
  // different source behind it. Closing or access-driven unmount releases it.
  useEffect(() => {
    if (!open) return;
    onOpenChange?.(true);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);
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
          <UserDetailContent row={row} accessLost={detailsAccessLost} onAccessLostChange={setDetailsAccessLost} />
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
function UserDetailContent({ row, accessLost, onAccessLostChange }: {
  row: AccountRow;
  accessLost: boolean;
  onAccessLostChange: (lost: boolean) => void;
}) {
  const t = useTranslations();
  const query = api.admin.accountDetails.useQuery(
    row.userId
      ? { userId: row.userId }
      : row.tutorId
        ? { tutorId: row.tutorId }
        : { tuteeId: row.tuteeId! },
    { refetchOnMount: "always" },
  );
  const data = query.data;
  const readDenied =
    query.error?.data?.code === "FORBIDDEN" ||
    query.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (readDenied) onAccessLostChange(true);
    else if (query.isSuccess && !query.isFetching && !query.error) onAccessLostChange(false);
  }, [readDenied, query.isSuccess, query.isFetching, query.error, onAccessLostChange]);
  const denied = readDenied || accessLost;
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
      {!denied && data && query.isFetching && (
        <p role="status" className="muted text-sm">
          {t("common.loading")}
        </p>
      )}
      {data?.group && <CombinedPersonDetails group={data.group}
        unavailable={!!query.error || query.isFetching}
        accessDenied={denied} />}
      {!denied && data && (
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

/** Group details keep every live profile reachable without treating directory
 * consolidation as shared login access or replacing original participation. */
function CombinedPersonDetails({
  group,
  unavailable = false,
  accessDenied = false,
}: {
  group: NonNullable<RouterOutputs["admin"]["accountDetails"]["group"]>;
  unavailable?: boolean;
  accessDenied?: boolean;
}) {
  const t = useTranslations();
  const directory = api.admin.accounts.useQuery();
  const canEdit = ["HEAD", "ADMIN"].includes(directory.data?.caller.role ?? "");
  const canEditProfiles = ["HEAD", "ADMIN", "COORDINATOR"].includes(directory.data?.caller.role ?? "");
  const [wasEditable, setWasEditable] = useState(canEdit);
  const [directoryAccessLost, setDirectoryAccessLost] = useState(false);
  const directoryDenied = ["FORBIDDEN", "UNAUTHORIZED"].includes(directory.error?.data?.code ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [student, setStudent] = useState<string | null>(null);
  // Preserve the accepted review and its read recovery when the directory changes.
  const [hadReview, setHadReview] = useState(group.resolutionState === "REVIEW_REQUIRED");
  const needsReview = hadReview || group.resolutionState === "REVIEW_REQUIRED";
  const invitationEligible = group.resolutionState === "GROUPED" && (group.tutors.length > 0 || group.tutees.length > 1);
  const [hadInvitation, setHadInvitation] = useState(invitationEligible);
  useEffect(() => {
    if (canEdit) setWasEditable(true);
    if (group.resolutionState === "REVIEW_REQUIRED") setHadReview(true);
    if (invitationEligible) setHadInvitation(true);
  }, [canEdit, group.resolutionState, invitationEligible]);
  useEffect(() => {
    if (directoryDenied) setDirectoryAccessLost(true);
    else if (directory.isSuccess && !directory.isFetching && !directory.error) setDirectoryAccessLost(false);
  }, [directoryDenied, directory.isSuccess, directory.isFetching, directory.error]);
  const denied = accessDenied || directoryDenied || directoryAccessLost;
  const editorDenied = denied || (!!directory.data && !canEdit);
  const controlsUnavailable = unavailable || !!directory.error || directory.isFetching;
  const login = group.users.find((user) => user.id === editing);
  // The controller stays mounted when successful retirement leaves one live
  // source. Its receipt/read recovery must outlive the directory's row count.
  const displayGroup = group.users.length + group.tutors.length + group.tutees.length > 1 || needsReview ||
    group.tutors.some((source) => ["ARCHIVED", "GRADUATED", "TRANSFERRED"].includes(source.status));
  if (!displayGroup) return null;
  return (
    <DetailSection title={t("usersDirectory.combinedPerson")}>
      <p className="muted">{t("usersDirectory.combinedPersonHelp")}</p>
      {directory.error && <StatePanel kind="error" title={t("uiPatterns.loadFailed")}
        action={<Button disabled={directory.isFetching} onClick={() => void directory.refetch()}>{t("uiPatterns.retry")}</Button>} />}
      {!denied && group.resolutionState === "REVIEW_REQUIRED" && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">
          {t("usersDirectory.participationReviewRequired")}
        </p>
      )}
      {(canEdit || wasEditable) && needsReview && <CombineRecords
        reviewPersonId={group.id}
        canApply={["HEAD", "ADMIN"].includes(directory.data?.caller.role ?? "")}
        unavailable={controlsUnavailable}
        accessDenied={editorDenied}
      />}
      {(canEdit || wasEditable) && (invitationEligible || hadInvitation) && (
        <DisclosureSection title={t("combineRecords.historySetup")} lifetime="retained">
          <HistoricalRecordInvitation
            sources={[
              ...group.tutors.map((source) => ({ kind: "TUTOR" as const, id: source.id })),
              ...group.tutees.map((source) => ({ kind: "TUTEE" as const, id: source.id })),
            ]}
            unavailable={controlsUnavailable || !invitationEligible}
            accessDenied={editorDenied}
          />
        </DisclosureSection>
      )}
      {!denied && <>
      {!!group.users.length && (
        <SummaryTable label={t("usersDirectory.groupLogins")}>
          <thead>
            <tr>
              <th>{t("usersDirectory.groupLogins")}</th>
              <th>{t("tablePatterns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {group.users.map((user) => (
              <tr key={user.id}>
                <td>
                  <p className="font-medium">{user.name ?? user.email}</p>
                  <p className="muted text-xs break-all">{user.email}</p>
                </td>
                <TableActions>
                  {canEditProfiles && (
                    <TableAction disabled={controlsUnavailable} onClick={() => setEditing(user.id)}>
                      {t("accountProfile.editProfile")}
                    </TableAction>
                  )}
                </TableActions>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      )}
      <SummaryTable label={t("usersDirectory.groupRecords")}>
        <thead>
          <tr>
            <th>{t("usersDirectory.groupRecords")}</th>
            <th>{t("usersDirectory.lifecycle")}</th>
            <th>{t("tablePatterns.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {group.tutors.map((tutor) => (
            <tr key={`tutor:${tutor.id}`}>
              <td>
                <p className="font-medium">{tutor.englishName}</p>
                <p className="muted text-xs break-all">
                  {t("admin.users.roles.TUTOR")} · {tutor.id}
                </p>
              </td>
              <td>{t(`usersDirectory.status.${tutor.status}`)}</td>
              <TableActions>
                <TutorDetailsButton
                  tutorId={tutor.id}
                  name={tutor.englishName}
                />
              </TableActions>
            </tr>
          ))}
          {group.tutees.map((tutee) => (
            <tr key={`tutee:${tutee.id}`}>
              <td>
                <p className="font-medium">{tutee.englishName}</p>
                <p className="muted text-xs break-all">
                  {t("admin.users.roles.STUDENT")} · {tutee.id}
                </p>
              </td>
              <td>{t(`usersDirectory.status.${tutee.status}`)}</td>
              <TableActions>
                <TableAction onClick={() => setStudent(tutee.id)}>
                  {t("tuteeHistory.details")}
                </TableAction>
              </TableActions>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
      {canEditProfiles && login && (
        <AccountProfileEditor
          profile={{
            ...login,
            userId: login.id,
            name: login.name ?? login.email,
          }}
          membership={accountMembership({
            ...login,
            tutorStatus: login.tutor?.status,
          })}
          isHead={directory.data?.caller.role === "HEAD"}
          canApply={["HEAD", "ADMIN"].includes(directory.data?.caller.role ?? "")}
          canPropose={directory.data?.caller.role === "COORDINATOR"}
          onClose={() => setEditing(null)}
        />
      )}
      {student && (
        <TuteeHistoryDialog
          tuteeId={student}
          onClose={() => setStudent(null)}
        />
      )}
      </>}
    </DetailSection>
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
