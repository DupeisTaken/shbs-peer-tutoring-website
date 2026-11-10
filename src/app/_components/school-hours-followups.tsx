"use client";

import { useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { parseProgramDateTime } from "~/lib/program-time";
import { useActionReview } from "./ui/action-review";
import { Button } from "./ui/button";
import { FormActions, InlineNotice } from "./ui/patterns";

type Followup = {
  batchId: string;
  scheduledFor: Date;
  deliveries: {
    id: string;
    recipient: string;
    status: string;
    attempts: number;
    lastError: string | null;
    availableAt: Date;
  }[];
};
type Props = {
  id: string;
  timeZone: string;
  linkVersion: number;
  recipients: string[];
  followups: Followup[];
  canManage: boolean;
  canSchedule?: boolean;
  refresh: () => Promise<void>;
};
const cancellable = (status: string) =>
  ["PENDING", "BLOCKED", "FAILED"].includes(status);
const deliveryStatuses = [
  "PENDING",
  "SENDING",
  "SENT",
  "FAILED",
  "BLOCKED",
  "SKIPPED",
  "CANCELLED",
  "UNCERTAIN",
] as const;

/** Follow-ups own a separate mail receipt; they never create another report or
 * advance the school's hours ledger. Accepted writes recover through reads only. */
export function SchoolHoursFollowups({
  id,
  timeZone,
  linkVersion,
  recipients,
  followups,
  canManage,
  canSchedule = true,
  refresh,
}: Props) {
  const t = useTranslations("schoolHoursFollowup");
  const format = useFormatter();
  const fieldId = useId();
  const review = useActionReview();
  const schedule = api.schoolHours.scheduleFollowup.useMutation();
  const cancel = api.schoolHours.cancelFollowup.useMutation();
  const [localTime, setLocalTime] = useState("");
  const [invalidTime, setInvalidTime] = useState(false);
  const intent = useRef<{
    value: string;
    version: number;
    requestId: string;
  } | null>(null);
  const disabled = !canManage || review.blocked("followups");
  const date = (value: Date) =>
    format.dateTime(value, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    });
  const recipientsList = (emails: string[]) => (
    <ul className="space-y-1 text-sm [overflow-wrap:anywhere]">
      {emails.map((email) => (
        <li key={email}>{email}</li>
      ))}
    </ul>
  );

  function openSchedule() {
    if (disabled || !canSchedule || !recipients.length) return;
    let scheduledFor: Date;
    try {
      scheduledFor = parseProgramDateTime(localTime, timeZone);
      if (scheduledFor.getTime() <= Date.now()) throw new Error("Past time");
    } catch {
      setInvalidTime(true);
      return;
    }
    setInvalidTime(false);
    // An unchanged rejected/uncertain request retains its idempotency key even
    // after closing the review. A changed draft is a distinct scheduling intent.
    if (
      intent.current?.value !== localTime ||
      intent.current.version !== linkVersion
    ) {
      intent.current = {
        value: localTime,
        version: linkVersion,
        requestId: crypto.randomUUID(),
      };
    }
    const captured = intent.current;
    review.open({
      key: `school-followup:${captured.requestId}`,
      title: t("reviewTitle"),
      description: t("reviewHelp", { date: date(scheduledFor), timeZone }),
      confirmLabel: t("schedule"),
      confirmVariant: "primary",
      successMessage: t("scheduled"),
      details: (
        <div className="space-y-3">
          <p className="text-sm font-semibold">{t("recipients")}</p>
          {recipientsList(recipients)}
          <p className="text-sm">{t("sameReport")}</p>
        </div>
      ),
      commit: async () => {
        const result = await schedule.mutateAsync({
          id,
          requestId: captured.requestId,
          localTime: captured.value,
          expectedLinkVersion: captured.version,
        });
        intent.current = null;
        setLocalTime("");
        return result;
      },
      refresh,
      renderError: () => t("writeFailed"),
    });
  }

  return (
    <section
      className="card min-w-0 space-y-4 p-4 sm:p-5"
      aria-label={t("title")}
    >
      <h2 className="section-title">{t("title")}</h2>
      <p className="muted text-sm">{t("help")}</p>
      <p className="text-sm">{t("sameReport")}</p>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("recipients")}</h3>
        {recipients.length ? (
          recipientsList(recipients)
        ) : (
          <p className="muted text-sm">{t("noRecipients")}</p>
        )}
      </div>
      {canManage && canSchedule && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            openSchedule();
          }}
        >
          <fieldset
            disabled={disabled}
            aria-busy={review.busy}
            className="min-w-0 space-y-3"
          >
            <div className="max-w-md space-y-1">
              <label className="label" htmlFor={fieldId}>
                {t("sendAt")}
              </label>
              <input
                id={fieldId}
                type="datetime-local"
                required
                value={localTime}
                className="input min-h-11 w-full min-w-0 lg:min-h-10"
                aria-invalid={invalidTime || undefined}
                aria-describedby={`${fieldId}-help${invalidTime ? ` ${fieldId}-error` : ""}`}
                onChange={(event) => {
                  setLocalTime(event.target.value);
                  setInvalidTime(false);
                }}
              />
              <p id={`${fieldId}-help`} className="muted text-sm">
                {t("timeHelp", { timeZone })}
              </p>
            </div>
            {invalidTime && (
              <div id={`${fieldId}-error`}>
                <InlineNotice tone="error" announcement="alert">
                  {t("invalidTime")}
                </InlineNotice>
              </div>
            )}
            <FormActions>
              <Button
                type="submit"
                variant="primary"
                size="compact"
                disabled={!localTime || !recipients.length}
              >
                {t("reviewSchedule")}
              </Button>
            </FormActions>
          </fieldset>
        </form>
      )}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("history")}</h3>
        {!followups.length && <p className="muted text-sm">{t("empty")}</p>}
        {followups.map((followup) => (
          <div
            key={followup.batchId}
            className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">
                {t("scheduledTime", {
                  date: date(followup.scheduledFor),
                  timeZone,
                })}
              </p>
              {canManage &&
                followup.deliveries.some((delivery) =>
                  cancellable(delivery.status),
                ) && (
                  <Button
                    size="compact"
                    variant="danger"
                    disabled={
                      disabled ||
                      followup.deliveries.some(
                        (delivery) => delivery.status === "SENDING",
                      ) ||
                      review.blocked(
                        `school-followup-cancel:${followup.batchId}`,
                      )
                    }
                    onClick={() =>
                      review.open({
                        key: `school-followup-cancel:${followup.batchId}`,
                        title: t("cancelTitle"),
                        description: t("cancelHelp", {
                          date: date(followup.scheduledFor),
                          timeZone,
                        }),
                        confirmLabel: t("cancel"),
                        successMessage: t("cancelled"),
                        details: recipientsList(
                          followup.deliveries
                            .filter((delivery) => cancellable(delivery.status))
                            .map((delivery) => delivery.recipient),
                        ),
                        commit: () =>
                          cancel.mutateAsync({ id, batchId: followup.batchId }),
                        refresh,
                        renderError: () => t("cancelFailed"),
                      })
                    }
                  >
                    {t("cancel")}
                  </Button>
                )}
            </div>
            <ul className="space-y-2 text-sm">
              {followup.deliveries.map((delivery) => (
                <li
                  key={delivery.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {delivery.recipient}
                  </span>
                  <span className="text-slate-700">
                    {t(
                      `status.${deliveryStatuses.find((status) => status === delivery.status) ?? "UNKNOWN"}`,
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {followup.deliveries.some((delivery) =>
              ["BLOCKED", "FAILED"].includes(delivery.status),
            ) && <p className="text-sm text-amber-900">{t("deliveryHelp")}</p>}
          </div>
        ))}
      </div>
      {review.dialog}
    </section>
  );
}
