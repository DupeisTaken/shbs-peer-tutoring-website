"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { getQueryKey } from "@trpc/react-query";
import type { QueryKey } from "@tanstack/react-query";
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
import { PersonPartition } from "~/app/_components/person-partition";
import { PersonHistoryCorrection } from "~/app/_components/person-history-correction";
import { PersonParticipationTransfer } from "~/app/_components/person-participation-transfer";
import { HistoricalRecordInvitation } from "~/app/_components/historical-record-invitation";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import { useDialogBusy } from "~/app/_components/ui/modal";

type DirectoryRow = RouterOutputs["admin"]["accounts"]["rows"][number];
type AccountRow = { [Key in keyof DirectoryRow]: DirectoryRow[Key] };
type Profile = RouterOutputs["admin"]["accountDetails"]["attached"][number];

type DetailsOpening = {
  row: AccountRow;
  onOpenChange?: (open: boolean) => void;
};
const DetailsHost = createContext<((opening: DetailsOpening) => void) | null>(null);

/** The route owns the captured opening, independently of filtered directory rows.
 * Keep admitted writes and their receipt/recovery mounted across read boundaries;
 * live denial still conceals private children and prevents further admission. */
export function UserDetailsHost({
  children,
  accessDenied = false,
  unavailable = false,
  onOpenChange,
  returnFocusFallback,
  onRetryAccess,
  retryingAccess = false,
  directoryRows,
  directoryReady = false,
}: {
  children: ReactNode;
  accessDenied?: boolean;
  unavailable?: boolean;
  onOpenChange?: (open: boolean) => void;
  returnFocusFallback?: () => HTMLElement | null;
  onRetryAccess?: () => void;
  retryingAccess?: boolean;
  directoryRows?: readonly AccountRow[];
  directoryReady?: boolean;
}) {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const [opening, setOpening] = useState<DetailsOpening | null>(null);
  // Keep denial across closing/reopening so a cached success cannot briefly
  // expose private details before the mandatory fresh read completes.
  const [detailsAccessLost, setDetailsAccessLost] = useState(false);
  const denied = readOnly || accessDenied || detailsAccessLost;
  const currentRow = opening?.row.userId
    ? directoryRows?.find((row) => row.userId === opening.row.userId)
    : undefined;
  const [display, setDisplay] = useState<{
    opening: DetailsOpening;
    row: AccountRow;
    signature: string;
  } | null>(null);
  // Only display data follows an authoritative same-account refresh. The query
  // target and admitted operation continue to use the captured opening below.
  const signature = currentRow && directoryReady && !denied
    ? JSON.stringify(currentRow)
    : undefined;
  if (opening && currentRow && signature !== undefined &&
    (display?.opening !== opening || display.signature !== signature))
    setDisplay({ opening, row: currentRow, signature });
  const displayRow = currentRow && display?.opening === opening
    ? display.row
    : opening?.row;
  // An already-open reader/editor owns focus even if browser history selects a
  // different source behind it. Deliberate Close releases the retained opening.
  useEffect(() => {
    if (!opening) return;
    onOpenChange?.(true);
    opening.onOpenChange?.(true);
    return () => {
      onOpenChange?.(false);
      opening.onOpenChange?.(false);
    };
  }, [opening, onOpenChange]);
  return (
    <DetailsHost.Provider
      value={(next) => {
        if (!readOnly && !accessDenied)
          setOpening((current) => current ?? next);
      }}
    >
      {children}
      {opening && (
        <ProfileDialog
          title={
            denied
              ? t("admin.users.title")
              : t("accountProfile.detailsTitle", {
                  name: participantNameLabel(
                    displayRow?.name,
                    displayRow?.username,
                    t("participantNames.unnamed"),
                  ),
                })
          }
          onClose={() => {
            setOpening(null);
            setDisplay(null);
          }}
          size="wide"
          returnFocusFallback={returnFocusFallback}
        >
          <UserDetailContent
            row={opening.row}
            displayRow={displayRow ?? opening.row}
            accessLost={detailsAccessLost}
            onAccessLostChange={setDetailsAccessLost}
            accessDenied={readOnly || accessDenied}
            unavailable={unavailable}
            onRetryAccess={onRetryAccess}
            retryingAccess={retryingAccess}
            directoryReady={directoryReady}
          />
        </ProfileDialog>
      )}
    </DetailsHost.Provider>
  );
}

/** Rows only launch the route-owned reader; removing an opener cannot cancel it. */
export function UserDetails(props: DetailsOpening) {
  const t = useTranslations();
  const open = useContext(DetailsHost);
  const readOnly = useReadOnly();
  if (readOnly) return null;
  if (!open)
    return (
      <UserDetailsHost>
        <UserDetails {...props} />
      </UserDetailsHost>
    );
  const displayName = participantNameLabel(
    props.row.name,
    props.row.username,
    t("participantNames.unnamed"),
  );
  return (
    <TableAction
      aria-haspopup="dialog"
      aria-label={`${t("accountProfile.showDetails")}: ${displayName}`}
      onClick={() => open(props)}
    >
      {t("accountProfile.showDetails")}
    </TableAction>
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
function UserDetailContent({
  row,
  displayRow,
  accessLost,
  onAccessLostChange,
  accessDenied,
  unavailable,
  onRetryAccess,
  retryingAccess,
  directoryReady,
}: {
  row: AccountRow;
  displayRow: AccountRow;
  accessLost: boolean;
  onAccessLostChange: (lost: boolean) => void;
  accessDenied: boolean;
  unavailable: boolean;
  onRetryAccess?: () => void;
  retryingAccess: boolean;
  directoryReady: boolean;
}) {
  const t = useTranslations();
  const busy = useDialogBusy();
  const target = row.userId
    ? { userId: row.userId }
    : row.tutorId ? { tutorId: row.tutorId } : { tuteeId: row.tuteeId! };
  const query = api.admin.accountDetails.useQuery(target, { refetchOnMount: "always" });
  const data = query.data;
  // A refresh may remove or regroup the original source. Keep the opening's
  // controller identity until deliberate Close; only matching fresh groups update it.
  const [openingGroup, setOpeningGroup] = useState(data?.group ?? null);
  if (!openingGroup && data?.group) setOpeningGroup(data.group);
  const group = data?.group?.id === openingGroup?.id ? data?.group : openingGroup;
  const readDenied =
    query.error?.data?.code === "FORBIDDEN" ||
    query.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (readDenied) onAccessLostChange(true);
    else if (query.isSuccess && !query.isFetching && !query.error) onAccessLostChange(false);
  }, [readDenied, query.isSuccess, query.isFetching, query.error, onAccessLostChange]);
  const denied = accessDenied || readDenied || accessLost;
  const readUnavailable = unavailable || !!query.error || query.isFetching;
  const groupMismatch = !!group && data?.group?.id !== group.id;
  const exactRetryScope = groupMismatch && directoryReady && query.isSuccess &&
    !readUnavailable && !denied
    ? {
        reads: [
          getQueryKey(api.admin.accounts, undefined, "query"),
          getQueryKey(api.admin.accountDetails, target, "query"),
        ],
      }
    : undefined;
  return (
    <div className="space-y-5">
      {accessDenied && (
        // This denial-only read cannot replace the captured operation. Keep it
        // reachable during unknown-outcome recovery so restored authority can
        // be verified without dismissal, a page reload or mutation replay.
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", {
            section: t("admin.users.title"),
          })}
          action={onRetryAccess && (
            <Button disabled={retryingAccess} onClick={onRetryAccess}>
              {t("managementRecovery.retry", { section: t("admin.users.title") })}
            </Button>
          )}
        />
      )}
      {query.error && (
        <StatePanel
          kind="error"
          title={t("uiPatterns.loadFailed")}
          action={
            <Button
              size="compact"
              disabled={query.isFetching || busy}
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
      {group && (
        <CombinedPersonDetails
          group={group}
          unavailable={
            readUnavailable || groupMismatch
          }
          accessDenied={denied}
          exactRetryScope={exactRetryScope}
        />
      )}
      {!denied && data && (
        <>
          <DetailSection title={t("usersDirectory.login")}>
            <LoginSetup account={displayRow.account} suspended={!!data.suspendedAt} />
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
            {displayRow.affiliation && (
              <p>
                {t("usersDirectory.affiliation")}: {displayRow.affiliation}
              </p>
            )}
            {displayRow.alternativeNames && (
              <p>
                {t("accountProfile.alternativeNames")}: {displayRow.alternativeNames}
              </p>
            )}
            {displayRow.email ? (
              <EmailContent
                email={displayRow.email}
                name={participantNameLabel(
                  displayRow.name,
                  displayRow.username,
                  t("participantNames.unnamed"),
                )}
                userId={row.userId}
                tutorId={row.tutorId}
                verifiedAt={displayRow.emailVerifiedAt}
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
                <AcademicDetails academic={displayRow.academic} />
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
  exactRetryScope,
}: {
  group: NonNullable<RouterOutputs["admin"]["accountDetails"]["group"]>;
  unavailable?: boolean;
  accessDenied?: boolean;
  exactRetryScope?: { reads: readonly QueryKey[] };
}) {
  const t = useTranslations();
  const busy = useDialogBusy();
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
  const canPartition = group.users.length + group.tutors.length + group.tutees.length > 1;
  const [hadPartition, setHadPartition] = useState(canPartition);
  const needsReview = hadReview || group.resolutionState === "REVIEW_REQUIRED";
  const invitationEligible = group.resolutionState === "GROUPED" && (group.tutors.length > 0 || group.tutees.length > 1);
  const [hadInvitation, setHadInvitation] = useState(invitationEligible);
  // Retain each controller after its first eligible read: accepted operations
  // may still need read recovery after the directory changes eligibility.
  if (canEdit && !wasEditable) setWasEditable(true);
  if (canPartition && !hadPartition) setHadPartition(true);
  if (group.resolutionState === "REVIEW_REQUIRED" && !hadReview) setHadReview(true);
  if (invitationEligible && !hadInvitation) setHadInvitation(true);
  const nextDirectoryAccessLost =
    directoryDenied ||
    (directoryAccessLost &&
      !(directory.isSuccess && !directory.isFetching && !directory.error));
  if (directoryAccessLost !== nextDirectoryAccessLost)
    setDirectoryAccessLost(nextDirectoryAccessLost);
  const denied = accessDenied || nextDirectoryAccessLost;
  const editorDenied = denied || (!!directory.data && !canEdit);
  const controlsUnavailable = unavailable || !!directory.error || directory.isFetching;
  const login = group.users.find((user) => user.id === editing);
  // The controller stays mounted when successful retirement leaves one live
  // source. Its receipt/read recovery must outlive the directory's row count.
  const displayGroup = canEdit || wasEditable || canPartition || hadPartition || needsReview ||
    group.tutors.some((source) => ["ARCHIVED", "GRADUATED", "TRANSFERRED"].includes(source.status));
  if (!displayGroup) return null;
  return (
    <DetailSection title={t("usersDirectory.combinedPerson")}>
      <p className="muted">{t("usersDirectory.combinedPersonHelp")}</p>
      {directory.error && <StatePanel kind="error" title={t("uiPatterns.loadFailed")}
        action={<Button disabled={directory.isFetching || busy} onClick={() => void directory.refetch()}>{t("uiPatterns.retry")}</Button>} />}
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
      {(canEdit || wasEditable) && hadPartition && <DisclosureSection title={t("personPartition.title")} lifetime="retained">
        <PersonPartition personId={group.id} sources={[
          ...group.users.map((source) => ({ ref: { kind: "USER" as const, id: source.id }, name: source.name ?? source.email })),
          ...group.tutors.map((source) => ({ ref: { kind: "TUTOR" as const, id: source.id }, name: source.englishName })),
          ...group.tutees.map((source) => ({ ref: { kind: "TUTEE" as const, id: source.id }, name: source.englishName })),
        ]} unavailable={controlsUnavailable} accessDenied={editorDenied} />
      </DisclosureSection>}
      {(canEdit || wasEditable) && <DisclosureSection title={t("personHistoryCorrection.title")} lifetime="retained">
        <PersonHistoryCorrection personId={group.id} unavailable={controlsUnavailable} accessDenied={editorDenied} />
      </DisclosureSection>}
      {(canEdit || wasEditable) && <DisclosureSection title={t("personParticipationTransfer.title")} lifetime="retained">
        <PersonParticipationTransfer personId={group.id} unavailable={controlsUnavailable} accessDenied={editorDenied}
          exactRetryScope={exactRetryScope && directory.isSuccess && !directory.error && !directory.isFetching && !editorDenied ? exactRetryScope : undefined} />
      </DisclosureSection>}
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
      {/* Opening a nested reader while outcome recovery is pending would inherit
          the busy state and strand its Close above the recovery controls. */}
      <fieldset disabled={busy || controlsUnavailable} className="min-w-0 space-y-3">
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
      </fieldset>
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
  const busy = useDialogBusy();
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
      <fieldset disabled={busy} className="min-w-0">
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
      </fieldset>
      {tuteeId && (
        <TuteeHistoryDialog
          tuteeId={tuteeId}
          onClose={() => setTuteeId(null)}
        />
      )}
    </>
  );
}
