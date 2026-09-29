"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { ProfileDialog } from "./profile-dialog";
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
  const [showRequests, setShowRequests] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const router = useRouter();
  const utils = api.useUtils();
  const success = async () => {
    setConfirming(false);
    setExplanation("");
    setOutcome(
      t(userId && state.data?.role === "HEAD" ? "saved" : "requested"),
    );
    await utils.invalidate();
    router.refresh();
  };
  const save = api.departure.setState.useMutation({
    onSuccess: success,
    onError: (error) => {
      if (error.data?.approvalId) {
        setConfirming(false);
        setOutcome(t("requested"));
      }
    },
  });
  const request = api.departure.request.useMutation({ onSuccess: success });
  const error =
    (save.error?.data?.approvalId ? null : save.error) ??
    request.error ??
    state.error;
  const busy = save.isPending || request.isPending;
  const departed = !!state.data?.departure?.reason;
  const submit = () => {
    const input = {
      action,
      explanation,
      expectedRevision: state.data?.departure?.revision ?? 0,
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
      <button
        className="btn-secondary min-h-11 lg:min-h-10"
        disabled={!state.data || !explanation.trim() || busy}
        onClick={() => setConfirming(true)}
      >
        {t(userId && state.data?.role === "HEAD" ? "review" : "request")}
      </button>
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
        <ProfileDialog title={t("review")} onClose={() => setConfirming(false)}>
          <div className="space-y-4">
            <p className="font-semibold">
              {t(
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
            </p>
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
            <p className="text-sm">{explanation}</p>
            <button
              className="btn-primary min-h-11 lg:min-h-10"
              disabled={busy}
              onClick={submit}
            >
              {t("confirm")}
            </button>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error.message}
              </p>
            )}
          </div>
        </ProfileDialog>
      )}
      {!userId && (
        <details
          onToggle={(event) => setShowRequests(event.currentTarget.open)}
        >
          <summary className="cursor-pointer py-3 text-sm font-medium">
            {t("requests")}
          </summary>
          {showRequests && <ManagementActions reviewer={false} />}
        </details>
      )}
      {!!state.data?.events.length && (
        <details>
          <summary className="cursor-pointer py-3 text-sm font-medium">
            {t("history")}
          </summary>
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
        </details>
      )}
    </section>
  );
}
