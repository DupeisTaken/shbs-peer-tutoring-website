"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ProfileDialog } from "./profile-dialog";
import { useDialogPending } from "./ui/modal";
import { Button } from "./ui/button";
import { ChangeReview } from "./ui/patterns";
import { DisclosureSection } from "./ui/disclosure-section";
const ManagementActions = dynamic(() =>
  import("./management-actions").then((module) => module.ManagementActions),
);

/** The personal dashboard remains the home for history; observation is a separate workspace. */
export function DepartureBanner() {
  const t = useTranslations("schoolDeparture");
  const state = api.departure.state.useQuery({});
  if (!state.data?.departure?.reason) return null;
  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50 p-5 sm:p-6">
      <p className="text-xs font-semibold tracking-wider text-teal-700 uppercase">
        {t("eyebrow")}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-slate-900">
        {t(
          state.data.departure.reason === "TRANSFERRED"
            ? "transferred"
            : "graduated",
        )}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-700">
        {t("historyHelp")}
      </p>
      {state.data.access.canReadManagement && (
        <Link href="/admin" className="btn-primary mt-4 min-h-11 lg:min-h-10">
          {t("enter")}
        </Link>
      )}
    </section>
  );
}

/** One editor serves self-service proposals and management decisions. A confirmation shows
 * assignment consequences; the API rechecks the revision rather than trusting this preview. */
export function SchoolDeparturePanel({ userId }: { userId?: string }) {
  const t = useTranslations("schoolDeparture");
  const state = api.departure.state.useQuery({ userId });
  const [action, setAction] = useState<
    "GRADUATED" | "TRANSFERRED" | "RETURN" | "REVOKE" | "RESTORE"
  >("TRANSFERRED");
  const [explanation, setExplanation] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [expectedRevision, setExpectedRevision] = useState<number | null>(null);
  // The reason and its original revision stay together through failed writes/refetches.
  if (expectedRevision === null && state.data)
    setExpectedRevision(state.data.departure?.revision ?? 0);
  const submitting = useRef(false);
  const [completion, setCompletion] = useState<{
    clearDraft: boolean;
    requested: boolean;
  } | null>(null);
  const router = useRouter();
  const utils = api.useUtils();
  const success = async () => {
    await utils.invalidate();
    router.refresh();
    setCompletion({
      clearDraft: true,
      requested: !(userId && state.data?.role === "HEAD"),
    });
  };
  const settled = () => {
    submitting.current = false;
  };
  const save = api.departure.setState.useMutation({
    onSettled: settled,
    onSuccess: success,
    onError: (error) => {
      if (error.data?.approvalId) {
        setCompletion({ clearDraft: false, requested: true });
      }
    },
  });
  const request = api.departure.request.useMutation({
    onSuccess: success,
    onSettled: settled,
  });
  const error =
    (save.error?.data?.approvalId ? null : save.error) ??
    request.error ??
    state.error;
  const ownPending = save.isPending || request.isPending;
  const busy = useDialogPending(ownPending);
  // Keep the nested review mounted through callbacks/refresh and any registered sibling write.
  // Never register the inherited aggregate back into the parent context.
  useEffect(() => {
    if (!completion || busy) return;
    setConfirming(false);
    if (completion.clearDraft) {
      setExplanation("");
      setExpectedRevision(null);
    }
    setOutcome(t(completion.requested ? "requested" : "saved"));
    setCompletion(null);
  }, [completion, busy, t]);
  const departed = !!state.data?.departure?.reason;
  const submit = () => {
    if (
      busy ||
      submitting.current ||
      completion ||
      !confirming ||
      expectedRevision === null ||
      !explanation.trim()
    )
      return;
    submitting.current = true;
    const input = {
      action,
      explanation,
      expectedRevision,
    };
    if (userId) save.mutate({ ...input, userId });
    else request.mutate(input);
  };
  if (!userId && state.data?.role === "VIEWER") return null;
  return (
    <section className="mt-5 space-y-4 border-t border-slate-200 pt-5">
      <h3 className="section-title">{t("title")}</h3>
      <p className="muted text-sm">{t("help")}</p>
      {state.data && (
        <p className="text-sm font-medium">
          {t("current")}:{" "}
          {departed
            ? t(
                state.data.departure?.reason === "TRANSFERRED"
                  ? "transferred"
                  : "graduated",
              )
            : t("enrolled")}
          {state.data.departure?.observerRevoked ? " · " + t("revoked") : ""}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">{t("change")}</span>
          <select
            className="select min-h-11 w-full lg:min-h-10"
            value={action}
            disabled={busy}
            onChange={(e) => setAction(e.target.value as typeof action)}
          >
            <option value="TRANSFERRED">{t("transferred")}</option>
            <option value="GRADUATED">{t("graduated")}</option>
            {departed && <option value="RETURN">{t("return")}</option>}
            {departed && userId && (
              <>
                <option value="REVOKE">{t("revoke")}</option>
                <option value="RESTORE">{t("restore")}</option>
              </>
            )}
          </select>
        </label>
        <label className="block">
          <span className="label">{t("reason")}</span>
          <textarea
            className="textarea w-full"
            rows={2}
            maxLength={1000}
            value={explanation}
            disabled={busy}
            onChange={(e) => setExplanation(e.target.value)}
          />
        </label>
      </div>
      <Button
        disabled={!state.data || !explanation.trim() || busy}
        onClick={() => {
          if (
            !busy &&
            !submitting.current &&
            !completion &&
            state.data &&
            explanation.trim()
          )
            setConfirming(true);
        }}
      >
        {t(userId && state.data?.role === "HEAD" ? "review" : "request")}
      </Button>
      {outcome && (
        <p role="status" className="text-sm text-teal-800">
          {outcome}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error.message}
        </p>
      )}
      {confirming && (
        <ProfileDialog
          title={t("review")}
          pending={ownPending}
          onClose={() => setConfirming(false)}
        >
          <ChangeReview
            title={t(
              action === "TRANSFERRED"
                ? "transferred"
                : action === "GRADUATED"
                  ? "graduated"
                  : action === "RETURN"
                    ? "return"
                    : action === "REVOKE"
                      ? "revoke"
                      : "restore",
            )}
            evidence={<p className="text-sm">{explanation}</p>}
            consequences={
              <>
                <p className="text-sm">
                  {t(
                    action === "RETURN"
                      ? "returnHelp"
                      : action === "REVOKE" || action === "RESTORE"
                        ? "accessHelp"
                        : "consequences",
                  )}
                </p>
                <p className="rounded-lg bg-slate-50 p-3 text-sm">
                  {t("retained")}
                </p>
              </>
            }
            actions={
              <Button variant="primary" disabled={busy} onClick={submit}>
                {t("confirm")}
              </Button>
            }
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error.message}
            </p>
          )}
        </ProfileDialog>
      )}
      {!userId && (
        <DisclosureSection title={t("requests")} lifetime="lazy">
          <ManagementActions reviewer={false} />
        </DisclosureSection>
      )}
      {!!state.data?.events.length && (
        <DisclosureSection title={t("history")} lifetime="mounted">
          <ol className="space-y-2 text-sm">
            {state.data.events.map((event) => (
              <li key={event.id} className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">
                  {t(
                    event.action === "TRANSFERRED"
                      ? "transferred"
                      : event.action === "GRADUATED"
                        ? "graduated"
                        : event.action === "RETURN"
                          ? "return"
                          : event.action === "REVOKE"
                            ? "revoke"
                            : "restore",
                  )}
                </span>
                <p className="muted mt-1">{event.explanation}</p>
              </li>
            ))}
          </ol>
        </DisclosureSection>
      )}
    </section>
  );
}
