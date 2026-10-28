"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ProfileDialog } from "./profile-dialog";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { InlineNotice } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";

/** The bearer URL is displayed only for this opening, never stored in navigation state. */
export function SessionCalendarSubscription() {
  const t = useTranslations("sessionPlanning");
  const id = useId();
  const [open, setOpen] = useState(false);
  const status = api.sessionPlanning.calendarStatus.useQuery(undefined, {
    enabled: open,
  });
  const rotate = api.sessionPlanning.rotateCalendar.useMutation();
  const revoke = api.sessionPlanning.revokeCalendar.useMutation();
  const [url, setUrl] = useState<string | null>(null);
  const [review, setReview] = useState<"rotate" | "revoke" | null>(null);
  const [working, setWorking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admission = useRef(false);
  async function refresh() {
    try {
      await status.refetch({ throwOnError: true });
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    }
  }
  async function commit() {
    if (admission.current || !review || refreshFailed || status.error) return;
    admission.current = true;
    setWorking(true);
    setError(null);
    try {
      if (review === "rotate") {
        const result = await rotate.mutateAsync();
        setUrl(result.url);
      } else {
        await revoke.mutateAsync();
        setUrl(null);
      }
      setSaved(true);
      setReview(null);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("loadFailed"));
    } finally {
      admission.current = false;
      setWorking(false);
    }
  }
  return (
    <>
      <Button size="compact" onClick={() => setOpen(true)}>
        {t("calendarSubscription")}
      </Button>
      {open && (
        <ProfileDialog
          title={t("calendarSubscription")}
          pending={working}
          onClose={() => {
            if (!admission.current) {
              setOpen(false);
              setUrl(null);
              setReview(null);
            }
          }}
        >
          <div className="space-y-4">
            <p>{t("calendarHelp")}</p>
            <p className="text-sm text-amber-900">{t("calendarPrivate")}</p>
            <QueryFeedback
              hasData={!!status.data}
              loading={!status.data && !status.error}
              error={!!status.error}
              retrying={status.isFetching}
              loadingTitle={t("load")}
              errorTitle={t("loadFailed")}
              retryLabel={t("retry")}
              onRetry={() => void refresh()}
            />
            {error && (
              <InlineNotice tone="error" announcement="alert">
                {error}
              </InlineNotice>
            )}
            {saved && (
              <InlineNotice tone="success" announcement="status">
                {t("calendarSaved")}
              </InlineNotice>
            )}
            {refreshFailed && (
              <InlineNotice
                tone="warning"
                action={
                  <Button disabled={working} onClick={() => void refresh()}>
                    {t("retry")}
                  </Button>
                }
              >
                {t("savedRefreshFailed")}
              </InlineNotice>
            )}
            {url && (
              <label className="block space-y-1">
                <span id={`${id}-url-label`} className="label">
                  {t("calendarUrl")}
                </span>
                <input
                  readOnly
                  aria-labelledby={`${id}-url-label`}
                  aria-describedby={`${id}-url-help`}
                  value={url}
                  className="input"
                  onFocus={(event) => event.target.select()}
                />
                <span id={`${id}-url-help`} className="muted block text-sm">
                  {t("calendarCopyHelp")}
                </span>
              </label>
            )}
            {status.data && !status.error && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={working || refreshFailed || !status.data.available}
                  onClick={() => setReview("rotate")}
                >
                  {t(status.data.active ? "calendarRotate" : "calendarCreate")}
                </Button>
                {status.data.active && (
                  <Button
                    disabled={working || refreshFailed}
                    onClick={() => setReview("revoke")}
                  >
                    {t("calendarRevoke")}
                  </Button>
                )}
              </div>
            )}
            {status.data && !status.data.available && (
              <p className="muted text-sm">{t("calendarUnavailable")}</p>
            )}
          </div>
          {review && (
            <Modal
              title={t(
                review === "rotate" ? "calendarRotate" : "calendarRevoke",
              )}
              busy={working}
              onClose={() => {
                if (!working) setReview(null);
              }}
              footer={
                <>
                  <Button disabled={working} onClick={() => setReview(null)}>
                    {t("cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={working || !!status.error || refreshFailed}
                    onClick={() => void commit()}
                  >
                    {t(
                      review === "rotate" ? "calendarCreate" : "calendarRevoke",
                    )}
                  </Button>
                </>
              }
            >
              <p>
                {t(
                  review === "rotate"
                    ? "calendarRotateHelp"
                    : "calendarRevokeHelp",
                )}
              </p>
              {error && (
                <p role="alert" className="mt-3 text-red-700">
                  {error}
                </p>
              )}
            </Modal>
          )}
        </ProfileDialog>
      )}
    </>
  );
}
