"use client";
import { FilterToolbar, InlineNotice, SettingRow } from "./ui/patterns";
import { Button, ChoiceButton } from "./ui/button";
import { SectionTabs } from "./ui/section-tabs";
import { SchoolCalendar } from "./school-calendar";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useDialog } from "./confirm-dialog";
import { Pager } from "./student-portal";

export function StudentSupport() {
  const [panel, setPanel] = useState<"feedback" | "appeals" | "calendar">(
    "feedback",
  );
  const programFormat = useFormatter();
  const t = useTranslations("workflows");
  const recovery = useTranslations("participantRecovery");
  const approvals = useTranslations("approvals");
  const [feedbackPage, setFeedbackPage] = useState(0);
  const [appealPage, setAppealPage] = useState(0);
  const [appealState, setAppealState] = useState<"PENDING" | "RESOLVED">(
    "PENDING",
  );
  const me = api.account.me.useQuery();
  const staff =
    me.data && ["HEAD", "ADMIN", "COORDINATOR"].includes(me.data.role);
  const setting = api.student.feedbackSettings.useQuery();
  const feedback = api.student.feedbackList.useQuery(
    { page: feedbackPage },
    { enabled: !!staff || setting.data === true },
  );
  const appeals = api.student.appeals.useQuery(
    { page: appealPage, state: appealState },
    { enabled: !!staff },
  );
  const save = api.student.setFeedbackSettings.useMutation({
    onSuccess: () => setting.refetch(),
  });
  const decide = api.student.decideAppeal.useMutation({
    onSuccess: () => {
      setAppealPage(0);
      void appeals.refetch();
    },
  });
  const { promptText, dialog } = useDialog();
  return (
    <div className="space-y-6">
      {dialog}
      <SupportPanels
        staff={!!staff}
        label={t("support")}
        value={staff ? panel : "feedback"}
        onChange={setPanel}
        items={(staff
          ? (["feedback", "appeals", "calendar"] as const)
          : (["feedback"] as const)
        ).map((value) => ({
          value,
          label: t(value === "appeals" ? "staffAppeals" : value),
        }))}
      >
        {/* Independent lists and pending decisions stay mounted across staff panels. */}
        <div hidden={!!staff && panel !== "feedback"} className="space-y-6">
          {staff && (
            <section className="card space-y-4 p-6">
              <SettingRow
                label={t("shareFeedback")}
                description={t("sharingHelp")}
                control={
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={setting.data ?? false}
                      disabled={
                        save.isPending ||
                        !setting.isSuccess ||
                        !!me.error ||
                        !["HEAD", "ADMIN"].includes(me.data?.role ?? "")
                      }
                      onChange={(e) => {
                        if (
                          !me.error &&
                          ["HEAD", "ADMIN"].includes(me.data?.role ?? "")
                        )
                          save.mutate({ share: e.target.checked });
                      }}
                    />
                    {me.data?.role === "ADMIN"
                      ? approvals("requestChange", {
                          setting: t("shareFeedback"),
                        })
                      : t("shareFeedback")}
                  </label>
                }
              />
              <nav
                aria-label={t("support")}
                className="flex flex-wrap gap-4 text-sm"
              >
                <Link href="/messages" className="link">
                  {t("messages")}
                </Link>
                <Link
                  href="/admin/applications#interview-records"
                  className="link"
                >
                  {t("qualified")}
                </Link>
                <Link href="/localization?view=review" className="link">
                  {t("reviewDrafts")}
                </Link>
              </nav>
            </section>
          )}
          {staff && (
            <p className="muted text-sm">{approvals("sensitiveHelp")}</p>
          )}
          {save.error?.data?.approvalId && (
            <InlineNotice tone="warning" announcement="status">
              {approvals("queuedBody")}
            </InlineNotice>
          )}
          <section className="card space-y-4 p-6">
            <h2 className="section-title">{t("feedback")}</h2>

            {/* A missing or failed sharing read, even with cached data, is not a privacy promise. */}
            {setting.error ? (
              <InlineNotice
                tone="warning"
                announcement="alert"
                action={
                  <Button
                    size="compact"
                    disabled={setting.isFetching}
                    onClick={() => void setting.refetch()}
                  >
                    {recovery("retry")}
                  </Button>
                }
              >
                {t("feedbackVisibilityUnavailable")}
              </InlineNotice>
            ) : typeof setting.data !== "boolean" ? (
              <p role="status" className="muted text-sm">
                {t("feedbackVisibilityLoading")}
              </p>
            ) : !staff && !setting.data ? (
              <p className="muted">{t("privateFeedback")}</p>
            ) : null}
            {feedback.data?.length === 0 && (
              <p className="muted">{t("empty")}</p>
            )}
            {feedback.data?.map((f) => (
              <article
                className="rounded-lg border border-slate-200 p-4"
                key={f.id}
              >
                <p className="font-medium">
                  {f.studentName} · {f.subject} · {f.rating}/5
                </p>
                <p className="mt-2 whitespace-pre-wrap">{f.body}</p>
                <p className="muted mt-2 text-xs">
                  {programFormat.dateTime(f.updatedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </article>
            ))}
            <Pager
              label={t("feedback")}
              page={feedbackPage}
              setPage={setFeedbackPage}
              more={feedback.data?.length === 20}
            />
          </section>
        </div>
        <div hidden={panel !== "appeals"}>
          {staff && (
            <section className="card space-y-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-title">{t("staffAppeals")}</h2>
                <FilterToolbar label={t("appealFilter")}>
                  {(["PENDING", "RESOLVED"] as const).map((state) => (
                    <ChoiceButton
                      key={state}
                      selected={appealState === state}
                      onClick={() => {
                        setAppealState(state);
                        setAppealPage(0);
                      }}
                    >
                      {t(
                        state === "PENDING"
                          ? "pendingAppeals"
                          : "resolvedAppeals",
                      )}
                    </ChoiceButton>
                  ))}
                </FilterToolbar>
              </div>
              {appeals.data?.rows.length === 0 && (
                <p className="muted">{t("empty")}</p>
              )}
              {appeals.data?.rows.map((a) => (
                <article
                  key={a.id}
                  className="space-y-3 rounded-lg border border-slate-200 p-4"
                >
                  <p className="font-medium">
                    {a.studentName} ·{" "}
                    {t(
                      a.state === "PENDING"
                        ? "pendingAppeals"
                        : "resolvedAppeals",
                    )}
                  </p>
                  <p>{a.cardReason}</p>
                  <p>{a.body}</p>
                  {a.decision && <p className="muted">{a.decision}</p>}
                  {a.state === "PENDING" && (
                    <div className="flex gap-3">
                      {[true, false].map((overturn) => (
                        <button
                          key={String(overturn)}
                          className="btn-secondary"
                          disabled={decide.isPending}
                          onClick={async () => {
                            const reason = await promptText({
                              title: t("decision"),
                              reasonLabel: t("body"),
                              confirmLabel: t("submit"),
                              cancelLabel: t("cancel"),
                              required: true,
                            });
                            if (reason)
                              decide.mutate({
                                id: a.id,
                                overturn,
                                reason,
                                expectedUpdatedAt: a.updatedAt,
                              });
                          }}
                        >
                          {t(overturn ? "uphold" : "reject")}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              <Pager
                label={t("staffAppeals")}
                page={appealPage}
                setPage={setAppealPage}
                more={
                  appeals.data
                    ? (appealPage + 1) * 20 < appeals.data.total
                    : false
                }
              />
            </section>
          )}
        </div>
        <div hidden={panel !== "calendar"}>{staff && <SchoolCalendar />}</div>
      </SupportPanels>
      {/* Cross-panel write/read feedback remains visible even when its panel is hidden. */}
      {decide.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {approvals("queuedBody")}
        </InlineNotice>
      )}
      {((save.error?.data?.approvalId ? null : save.error) ??
        feedback.error ??
        appeals.error ??
        (decide.error?.data?.approvalId ? null : decide.error)) && (
        <p role="alert" className="text-red-700">
          {
            (
              (save.error?.data?.approvalId ? null : save.error) ??
              feedback.error ??
              appeals.error ??
              (decide.error?.data?.approvalId ? null : decide.error)
            )?.message
          }
        </p>
      )}
    </div>
  );
}

/** A feedback-only participant has no alternate panel to navigate. */
function SupportPanels({
  staff,
  children,
  ...tabs
}: {
  staff: boolean;
  children: ReactNode;
  label: string;
  value: "feedback" | "appeals" | "calendar";
  onChange: (value: "feedback" | "appeals" | "calendar") => void;
  items: { value: "feedback" | "appeals" | "calendar"; label: string }[];
}) {
  return staff ? (
    <SectionTabs {...tabs}>{children}</SectionTabs>
  ) : (
    <>{children}</>
  );
}
