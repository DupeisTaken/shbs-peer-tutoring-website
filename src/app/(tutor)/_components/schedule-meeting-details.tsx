"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { ProfileDialog } from "~/app/_components/profile-dialog";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { api } from "~/trpc/react";
import {
  TutorMeetingBrowser,
  useTutorMeetingController,
} from "./tutor-meetings";

/** Keep this owner mounted beside Schedule. Both selected appointments and the
 * full source browser use one retained excuse/cancel controller and draft map. */
export function ScheduleMeetingDetails({
  meetingId,
  showAll = false,
  enabled = true,
  onClose,
}: {
  meetingId: string | null;
  showAll?: boolean;
  /** Conceal private DOM and pause reads without discarding an existing owner. */
  enabled?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const controller = useTutorMeetingController();
  const detail = api.personalSchedule.meetingDetail.useQuery(
    { meetingId: meetingId ?? "" },
    { enabled: enabled && !!meetingId && !showAll },
  );
  const denied = useSessionAccessDenied(detail);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const missing = detail.error?.data?.code === "NOT_FOUND";
  // Removal/ineligibility is authoritative for this record only. Later network
  // errors cannot revive its cached reason; another meeting has its own latch.
  useEffect(() => {
    if (!enabled || !meetingId || showAll) return;
    const recovered =
      detail.isSuccess && !detail.isFetching && detail.data?.id === meetingId;
    if (!missing && !recovered) return;
    setRemovedIds((previous) => {
      if (previous.has(meetingId) === missing) return previous;
      const next = new Set(previous);
      if (missing) next.add(meetingId);
      else next.delete(meetingId);
      return next;
    });
  }, [
    meetingId,
    enabled,
    showAll,
    missing,
    detail.isSuccess,
    detail.isFetching,
    detail.data?.id,
  ]);
  const removed = !!meetingId && (missing || removedIds.has(meetingId));
  const hideDetail = denied || removed;
  // Existing source-period reads also serve inactive tutors' history elsewhere.
  // This Schedule entry first rechecks its stricter live active/module guard.
  const browserAccess = api.personalSchedule.meetings.useQuery(undefined, {
    enabled: enabled && showAll,
  });
  const browserDenied = useSessionAccessDenied(browserAccess);
  const open = enabled && (!!meetingId || showAll);

  // The controller lives outside the modal, preserving independent drafts and
  // read-only recovery through Close/reopen and selected/full-source switches.
  return !open ? null : (
    <ProfileDialog
      title={t("tutor.meetings.title")}
      pending={controller.pending}
      onClose={() => {
        if (controller.canClose()) onClose();
      }}
    >
      {showAll && (
        <div className="space-y-4">
          <QueryFeedback
            hasData={!browserDenied && browserAccess.data !== undefined}
            loading={browserAccess.isLoading}
            error={!!browserAccess.error || browserDenied}
            retrying={browserAccess.isFetching}
            loadingTitle={t("tutor.tasks.loading")}
            errorTitle={t(
              browserDenied ? "meetingPeriods.denied" : "uiPatterns.loadFailed",
            )}
            retryLabel={t("tutor.tasks.retry")}
            onRetry={() => void browserAccess.refetch()}
          />
          {!browserDenied && browserAccess.data && (
            <TutorMeetingBrowser
              controller={controller}
              readable={!browserAccess.error && !browserAccess.isLoading}
              embedded
            />
          )}
        </div>
      )}
      {meetingId && !showAll && (
        <div className="space-y-4">
          <QueryFeedback
            hasData={!hideDetail && detail.data !== undefined}
            loading={detail.isLoading}
            error={!!detail.error || hideDetail}
            retrying={detail.isFetching}
            loadingTitle={t("tutor.tasks.loading")}
            errorTitle={t(
              hideDetail ? "meetingPeriods.denied" : "uiPatterns.loadFailed",
            )}
            retryLabel={t("tutor.tasks.retry")}
            onRetry={() => void detail.refetch()}
          />
          {!hideDetail &&
            detail.data &&
            controller.render(
              [detail.data],
              false,
              !detail.error && !detail.isLoading,
            )}
          {!hideDetail && controller.feedback}
        </div>
      )}
    </ProfileDialog>
  );
}
