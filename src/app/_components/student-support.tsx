"use client";
import { FilterToolbar, InlineNotice, SettingRow } from "./ui/patterns";
import { Button, ChoiceButton } from "./ui/button";
import { SectionTabs } from "./ui/section-tabs";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useDialog } from "./confirm-dialog";
import { Pager } from "./student-portal";
import {
  useSessionPageScroll,
  useSessionViewState,
} from "./session-view-state";
import { viewEnum, viewPage } from "~/lib/session-view-state";

export function StudentSupport({ viewScope = "" }: { viewScope?: string }) {
  const [deniedViews, setDeniedViews] = useState({
    feedback: false,
    appeals: false,
  });
  const programFormat = useFormatter();
  const t = useTranslations("workflows");
  const recovery = useTranslations("participantRecovery");
  const approvals = useTranslations("approvals");
  const me = api.account.me.useQuery();
  const accountDenied =
    me.error?.data?.code === "FORBIDDEN" ||
    me.error?.data?.code === "UNAUTHORIZED";
  const staff =
    !accountDenied &&
    me.data &&
    ["HEAD", "ADMIN", "COORDINATOR"].includes(me.data.role);
  const setting = api.student.feedbackSettings.useQuery();
  const [panel, setPanel] = useSessionViewState<"feedback" | "appeals">({
    id: "support-panel-v1",
    scope: viewScope,
    initialState: "feedback",
    parse: viewEnum(me.data && !staff ? ["feedback"] : ["feedback", "appeals"]),
    enabled: !accountDenied && !deniedViews.appeals,
  });
  const [feedbackPage, setFeedbackPage] = useSessionViewState({
    id: "support-feedback-page-v1",
    scope: viewScope,
    initialState: 0,
    parse: viewPage,
    enabled:
      !accountDenied &&
      !deniedViews.feedback &&
      !(!staff && setting.data === false),
  });
  const [appealPage, setAppealPage] = useSessionViewState({
    id: "support-appeal-page-v1",
    scope: viewScope,
    initialState: 0,
    parse: viewPage,
    enabled: !accountDenied && !deniedViews.appeals && !(me.data && !staff),
  });
  const [appealState, setAppealState] = useSessionViewState<
    "PENDING" | "RESOLVED"
  >({
    id: "support-appeal-filter-v1",
    scope: viewScope,
    initialState: "PENDING",
    parse: viewEnum(["PENDING", "RESOLVED"]),
    enabled: !accountDenied && !deniedViews.appeals && !(me.data && !staff),
  });
  const feedback = api.student.feedbackList.useQuery(
    { page: feedbackPage },
    { enabled: !!staff || setting.data === true },
  );
  const appeals = api.student.appeals.useQuery(
    { page: appealPage, state: appealState },
    { enabled: !!staff },
  );
  const feedbackDenied =
    feedback.error?.data?.code === "FORBIDDEN" ||
    feedback.error?.data?.code === "UNAUTHORIZED";
  const appealsDenied =
    appeals.error?.data?.code === "FORBIDDEN" ||
    appeals.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    setDeniedViews((current) =>
      current.feedback === feedbackDenied && current.appeals === appealsDenied
        ? current
        : { feedback: feedbackDenied, appeals: appealsDenied },
    );
  }, [feedbackDenied, appealsDenied]);
  const canReadFeedback =
    !accountDenied &&
    !feedbackDenied &&
    (!!staff || (!setting.error && setting.data === true));
  useSessionPageScroll({
    id: "student-support-v1",
    scope: `${viewScope}:${staff ? panel : "feedback"}:${feedbackPage}:${appealPage}:${appealState}`,
    ready: staff && panel === "appeals" ? !!appeals.data : !!feedback.data,
    enabled:
      !accountDenied &&
      (staff && panel === "appeals" ? !appealsDenied : canReadFeedback),
  });
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
          ? (["feedback", "appeals"] as const)
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
                  <label className="flex min-h-11 items-center gap-3 lg:min-h-10">
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
            {canReadFeedback && feedback.data?.length === 0 && (
              <p className="muted">{t("empty")}</p>
            )}
            {canReadFeedback &&
              feedback.data?.map((f) => (
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
              {!appealsDenied && appeals.data?.rows.length === 0 && (
                <p className="muted">{t("empty")}</p>
              )}
              {!appealsDenied &&
                appeals.data?.rows.map((a) => (
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
      </SupportPanels>
      {staff && (
        <Link
          className="link inline-flex min-h-11 items-center lg:min-h-8"
          href="/admin/program"
        >
          {t("calendarDestination")}
        </Link>
      )}
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
  value: "feedback" | "appeals";
  onChange: (value: "feedback" | "appeals") => void;
  items: { value: "feedback" | "appeals"; label: string }[];
}) {
  return staff ? (
    <SectionTabs {...tabs}>{children}</SectionTabs>
  ) : (
    <>{children}</>
  );
}
