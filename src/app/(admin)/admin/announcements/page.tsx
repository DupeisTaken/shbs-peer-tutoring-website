"use client";
import { ProfileDialog } from "~/app/_components/profile-dialog";

import { useTranslations, useFormatter } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { StatePanel } from "~/app/_components/ui/patterns";
import { Button } from "~/app/_components/ui/button";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { queuedApprovalId } from "~/lib/approval-outcome";
import {
  defaultAnnouncementAudience,
  selectAnnouncementRecipients,
} from "~/lib/announcement-recipients";
import { RecipientPicker } from "./recipient-picker";

type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  active: boolean;
  audienceRestricted: boolean;
  recipientTutorIds: string[];
  createdAt: Date;
  createdBy: { name: string | null } | null;
  _count: { acks: number };
};

function AnnouncementCard({
  a,
  onChanged,
  readOnly,
  review,
}: {
  a: Announcement;
  onChanged: () => void;
  readOnly: boolean;
  review: ReturnType<typeof useActionReview>;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const utils = api.useUtils();
  const [title, setTitle] = useState(a.title);
  const [body, setBody] = useState(a.body);
  const fieldId = useId();
  const update = api.admin.updateAnnouncement.useMutation({
    onSuccess: onChanged,
  });
  const del = api.admin.deleteAnnouncement.useMutation();

  const dirty = title !== a.title || body !== a.body;

  return (
    <div className={`card space-y-3 p-4 ${a.active ? "" : "bg-slate-50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {readOnly ? (
          <span className="flex-1 font-semibold text-slate-900">{a.title}</span>
        ) : (
          <label className="min-w-0 flex-1" htmlFor={`${fieldId}-title`}>
            <span className="label">
              {t("admin.announcements.new.titlePlaceholder")}
            </span>
            <input
              id={`${fieldId}-title`}
              className="input w-full font-semibold"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        {a.pinned && (
          <span className="badge-slate">
            {t("admin.announcements.badge.pinned")}
          </span>
        )}
        <span className={a.active ? "badge-green" : "badge-slate"}>
          {a.active
            ? t("admin.announcements.badge.active")
            : t("admin.announcements.badge.inactive")}
        </span>
      </div>
      {readOnly ? (
        <p className="whitespace-pre-wrap text-slate-700">{a.body}</p>
      ) : (
        <label className="block" htmlFor={`${fieldId}-body`}>
          <span className="label">{t("admin.announcements.messageLabel")}</span>
          <textarea
            id={`${fieldId}-body`}
            className="textarea w-full"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && (
          <button
            className="btn-primary btn-sm"
            disabled={
              !dirty || !title.trim() || !body.trim() || update.isPending
            }
            onClick={() =>
              update.mutate({
                id: a.id,
                title: title.trim(),
                body: body.trim(),
              })
            }
          >
            {t("admin.announcements.card.save")}
          </button>
        )}
        {!readOnly && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => update.mutate({ id: a.id, pinned: !a.pinned })}
          >
            {a.pinned
              ? t("admin.announcements.card.unpin")
              : t("admin.announcements.card.pin")}
          </button>
        )}
        {!readOnly && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => update.mutate({ id: a.id, active: !a.active })}
          >
            {a.active
              ? t("admin.announcements.card.deactivate")
              : t("admin.announcements.card.reactivate")}
          </button>
        )}
        <span className="muted text-xs">
          {t("admin.announcements.card.dismissed", { count: a._count.acks })} ·{" "}
          {format.dateTime(new Date(a.createdAt), {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
          {a.createdBy?.name ? ` · ${a.createdBy.name}` : ""}
        </span>
        {!readOnly && (
          <button
            className="link-danger ml-auto text-sm"
            disabled={review.blocked(a.id) || update.isPending}
            onClick={() =>
              review.open({
                key: a.id,
                title: t("admin.announcements.card.confirmDelete"),
                description: t("actionReview.announcementHelp"),
                details: <p>{a.title}</p>,
                confirmLabel: t("common.delete"),
                commit: () => del.mutateAsync({ id: a.id }),
                refresh: () => invalidateAndReport(utils.admin.announcements),
                approvalId: queuedApprovalId,
              })
            }
          >
            {t("admin.announcements.card.delete")}
          </button>
        )}
      </div>
      <p className="muted text-xs">
        {a.audienceRestricted
          ? t("admin.announcements.recipients.frozenCount", {
              count: a.recipientTutorIds.length,
            })
          : t("admin.announcements.recipients.legacy")}
      </p>
      {update.error && (
        <p role="alert" className="text-sm text-red-700">
          {update.error.message}
        </p>
      )}
    </div>
  );
}

export default function AnnouncementsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  // The list owns review lifetime so removing a card cannot dismiss a pending
  // refresh or its read-only recovery.
  const review = useActionReview();
  const utils = api.useUtils();
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState({
    announcements: false,
    candidates: false,
  });
  const announcements = api.admin.announcements.useQuery(undefined, {
    enabled: !denied.announcements,
  });
  const candidates = api.admin.announcementCandidates.useQuery(undefined, {
    enabled: !readOnly && !denied.candidates,
  });
  const announcementAccessDenied =
    announcements.error?.data?.code === "FORBIDDEN" ||
    announcements.error?.data?.code === "UNAUTHORIZED";
  const candidateAccessDenied =
    candidates.error?.data?.code === "FORBIDDEN" ||
    candidates.error?.data?.code === "UNAUTHORIZED";
  const announcementsHidden = denied.announcements || announcementAccessDenied;
  const candidatesHidden = denied.candidates || candidateAccessDenied;
  const revokeReview = review.revoke;
  useEffect(() => {
    if (announcementAccessDenied) {
      setDenied((previous) => ({ ...previous, announcements: true }));
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.announcements, undefined, "query"),
        exact: true,
      });
      revokeReview();
    } else if (announcements.isSuccess && !announcements.isFetching)
      setDenied((previous) =>
        previous.announcements
          ? { ...previous, announcements: false }
          : previous,
      );
  }, [
    announcementAccessDenied,
    announcements.isSuccess,
    announcements.isFetching,
    queryClient,
    revokeReview,
  ]);
  useEffect(() => {
    if (candidateAccessDenied) {
      setDenied((previous) => ({ ...previous, candidates: true }));
      queryClient.removeQueries({
        queryKey: getQueryKey(
          api.admin.announcementCandidates,
          undefined,
          "query",
        ),
        exact: true,
      });
    } else if (candidates.isSuccess && !candidates.isFetching)
      setDenied((previous) =>
        previous.candidates ? { ...previous, candidates: false } : previous,
      );
  }, [
    candidateAccessDenied,
    candidates.isSuccess,
    candidates.isFetching,
    queryClient,
  ]);
  const [createOpen, setCreateOpen] = useState(false);
  const [audience, setAudience] = useState(defaultAnnouncementAudience);
  const recipientCount = selectAnnouncementRecipients(
    candidatesHidden ? [] : (candidates.data ?? []),
    audience,
  ).length;
  const invalidate = () => utils.admin.announcements.invalidate();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const create = api.admin.createAnnouncement.useMutation({
    onSuccess: async () => {
      setCreateOpen(false);
      setTitle("");
      setBody("");
      setPinned(false);
      setAudience(defaultAnnouncementAudience());
      await invalidate();
    },
  });

  return (
    <div className="space-y-6">
      {!readOnly && !announcementsHidden && review.dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("admin.announcements.title")}</h1>
        {!readOnly && !announcementsHidden && (
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => setCreateOpen(true)}
          >
            {t("admin.announcements.create")}
          </Button>
        )}
        <p className="muted mt-1 basis-full">
          {t("admin.announcements.subtitle")}
        </p>
      </div>

      {!readOnly && !announcementsHidden && createOpen && (
        <ProfileDialog
          title={t("admin.announcements.new.title")}
          size="wide"
          pending={create.isPending}
          onClose={() => setCreateOpen(false)}
        >
          <section className="space-y-3">
            <label className="block" htmlFor={`${fieldId}-title`}>
              <span className="label">
                {t("admin.announcements.new.titlePlaceholder")}
              </span>
              <input
                id={`${fieldId}-title`}
                className="input w-full"
                placeholder={t("admin.announcements.new.titlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="block" htmlFor={`${fieldId}-body`}>
              <span className="label">
                {t("admin.announcements.messageLabel")}
              </span>
              <textarea
                id={`${fieldId}-body`}
                className="textarea w-full"
                rows={3}
                placeholder={t("admin.announcements.new.messagePlaceholder")}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            {candidatesHidden ? (
              <StatePanel
                kind="denied"
                title={t("managementRecovery.denied", {
                  section: t("admin.announcements.recipients.button"),
                })}
                action={
                  <Button
                    disabled={candidates.isFetching}
                    onClick={() => void candidates.refetch()}
                  >
                    {t("managementRecovery.retry", {
                      section: t("admin.announcements.recipients.button"),
                    })}
                  </Button>
                }
              />
            ) : (
              <QueryFeedback
                hasData={candidates.data !== undefined}
                loading={candidates.data === undefined}
                error={!!candidates.error}
                retrying={candidates.isFetching}
                loadingTitle={t("managementRecovery.loading", {
                  section: t("admin.announcements.recipients.button"),
                })}
                errorTitle={t(
                  candidates.data === undefined
                    ? "managementRecovery.loadFailed"
                    : "managementRecovery.refreshFailed",
                  { section: t("admin.announcements.recipients.button") },
                )}
                retryLabel={t("managementRecovery.retry", {
                  section: t("admin.announcements.recipients.button"),
                })}
                onRetry={() => void candidates.refetch()}
              />
            )}
            {!candidatesHidden && candidates.data !== undefined && (
              <RecipientPicker
                candidates={candidates.data ?? []}
                audience={audience}
                onChange={setAudience}
                loading={candidates.isLoading}
              />
            )}
            {create.error && (
              <p role="alert" className="text-sm text-red-700">
                {create.error.message}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                />
                {t("admin.announcements.new.pinLabel")}
              </label>
              <button
                className="btn-primary btn-sm"
                disabled={
                  !title.trim() ||
                  !body.trim() ||
                  create.isPending ||
                  !recipientCount ||
                  candidates.isLoading ||
                  candidates.isError ||
                  candidatesHidden
                }
                onClick={() =>
                  create.mutate({
                    title: title.trim(),
                    body: body.trim(),
                    pinned,
                    audience,
                  })
                }
              >
                {create.isPending
                  ? t("admin.announcements.new.posting")
                  : t("admin.announcements.new.broadcast")}
              </button>
            </div>
          </section>
        </ProfileDialog>
      )}

      <div className="space-y-3">
        {announcementsHidden ? (
          <StatePanel
            kind="denied"
            title={t("managementRecovery.denied", {
              section: t("admin.announcements.title"),
            })}
            action={
              <Button
                disabled={announcements.isFetching}
                onClick={() => void announcements.refetch()}
              >
                {t("managementRecovery.retry", {
                  section: t("admin.announcements.title"),
                })}
              </Button>
            }
          />
        ) : (
          <QueryFeedback
            hasData={announcements.data !== undefined}
            loading={announcements.data === undefined}
            error={!!announcements.error}
            retrying={announcements.isFetching}
            loadingTitle={t("managementRecovery.loading", {
              section: t("admin.announcements.title"),
            })}
            errorTitle={t(
              announcements.data === undefined
                ? "managementRecovery.loadFailed"
                : "managementRecovery.refreshFailed",
              { section: t("admin.announcements.title") },
            )}
            retryLabel={t("managementRecovery.retry", {
              section: t("admin.announcements.title"),
            })}
            onRetry={() => void announcements.refetch()}
          />
        )}
        {(announcementsHidden ? [] : (announcements.data ?? [])).map((a) => (
          <AnnouncementCard
            key={a.id}
            a={a}
            onChanged={invalidate}
            readOnly={readOnly}
            review={review}
          />
        ))}
        {announcements.data?.length === 0 &&
          !announcements.error &&
          !announcementsHidden && (
            <p className="muted">{t("admin.announcements.empty")}</p>
          )}
      </div>
    </div>
  );
}
