"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/app/_components/ui/button";
import {
  FormSection,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { PublicFormRoute } from "~/app/_components/public-form-page";

type Category = "messages" | "info";
type Scope = "category" | "all";
type State =
  | { status: "loading" | "error" | "invalid" }
  | { status: "ready" | "already-unsubscribed"; category: Category }
  | { status: "unsubscribed"; scope: Scope; category: Category };

function readResult(
  value: unknown,
):
  | { status: "invalid" }
  | { status: "ready" | "already-unsubscribed"; category: Category }
  | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.status === "invalid") return { status: "invalid" };
  if (
    (data.status === "ready" || data.status === "already-unsubscribed") &&
    (data.category === "messages" || data.category === "info")
  )
    return { status: data.status, category: data.category };
  return null;
}

/** A new capability owns a new draft. A late request from an old URL must never
 * change the next account's screen or submit its previous scope selection. */
export function UnsubscribeForm({ token }: { token?: string }) {
  return <UnsubscribeDraft key={token ?? "missing"} token={token} />;
}

function UnsubscribeDraft({ token }: { token?: string }) {
  const t = useTranslations("unsubscribe");
  const [state, setState] = useState<State>({
    status: token ? "loading" : "invalid",
  });
  const [scope, setScope] = useState<Scope>("category");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const write = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    // Link scanners and page loads only inspect the capability. Preference writes
    // belong exclusively to the explicit, guarded form submission below.
    void (async () => {
      try {
        const response = await fetch(
          `/api/email/unsubscribe?token=${encodeURIComponent(token)}`,
          {
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          },
        );
        const result = readResult(await response.json());
        if (!result || (!response.ok && result.status !== "invalid"))
          throw new Error("Unavailable");
        if (!controller.signal.aborted) setState(result);
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [token, attempt]);

  useEffect(() => () => write.current?.abort(), []);

  async function submit() {
    if (
      !token ||
      write.current ||
      (state.status !== "ready" && state.status !== "already-unsubscribed") ||
      (state.status === "already-unsubscribed" && scope === "category")
    )
      return;
    // The ref excludes duplicate submissions in the same event turn, before the
    // fieldset's pending state has rendered. Rejection keeps the chosen scope.
    const controller = new AbortController();
    write.current = controller;
    setPending(true);
    setSaveError(false);
    try {
      const response = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body: JSON.stringify({ token, scope }),
      });
      const result: unknown = await response.json();
      if (controller.signal.aborted) return;
      const status =
        result && typeof result === "object" && "status" in result
          ? result.status
          : null;
      if (status === "invalid") setState({ status: "invalid" });
      else if (response.ok && status === "unsubscribed") {
        setState({ status: "unsubscribed", scope, category: state.category });
      } else throw new Error("Unavailable");
    } catch {
      if (!controller.signal.aborted) setSaveError(true);
    } finally {
      if (!controller.signal.aborted) {
        write.current = null;
        setPending(false);
      }
    }
  }

  if (state.status === "loading")
    return <StatePanel kind="loading" title={t("loading")} />;
  if (state.status === "error")
    return (
      <StatePanel
        kind="error"
        title={t("loadErrorTitle")}
        action={
          <Button
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            {t("retry")}
          </Button>
        }
      >
        {t("loadErrorHelp")}
      </StatePanel>
    );
  if (state.status === "invalid")
    return (
      <StatePanel kind="empty" title={t("invalidTitle")}>
        {t("invalidHelp")}
      </StatePanel>
    );
  if (state.status === "unsubscribed")
    return (
      <div className="space-y-6">
        <div role="status" className="space-y-3">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-[#0D59E6]"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="m5 12 4 4L19 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {t("successTitle")}
          </h2>
          <p className="text-sm leading-6 text-slate-600">
            {state.scope === "all"
              ? t("successAll")
              : t("successCategory", { category: t(state.category) })}
          </p>
        </div>
        <SafetyNote />
        <PublicFormRoute href="/" label={t("home")} />
      </div>
    );

  // All non-form states returned above; this explicit check also keeps the
  // category-narrowing contract clear when new remote states are introduced.
  if (state.status !== "ready" && state.status !== "already-unsubscribed")
    return null;
  const already = state.status === "already-unsubscribed";
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {already && (
        <InlineNotice tone="success" announcement="status">
          {t("already", { category: t(state.category) })}
        </InlineNotice>
      )}
      <FormSection
        title={t("choiceTitle")}
        description={t("choiceHelp")}
        busy={pending}
        actions={
          <Button
            type="submit"
            variant="primary"
            disabled={already && scope === "category"}
            className="w-full"
          >
            {pending
              ? t("saving")
              : t(scope === "all" ? "confirmAll" : "confirmCategory")}
          </Button>
        }
      >
        <div className="space-y-3">
          {(["category", "all"] as const).map((value) => (
            <label
              key={value}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${scope === value ? "border-accent-500 bg-accent-50" : "border-slate-200 bg-white"} ${already && value === "category" ? "cursor-default" : "hover:border-accent-500"}`}
            >
              <input
                type="radio"
                name="scope"
                value={value}
                checked={scope === value}
                disabled={already && value === "category"}
                onChange={() => setScope(value)}
                className="accent-accent-700 mt-1 h-4 w-4 shrink-0"
                aria-describedby={`scope-${value}-help`}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">
                  {value === "category" ? t(state.category) : t("all")}
                </span>
                <span
                  id={`scope-${value}-help`}
                  className="mt-1 block text-sm leading-6 text-slate-600"
                >
                  {value === "category"
                    ? t(`${state.category}Help`)
                    : t("allHelp")}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-sm leading-6 text-slate-600">{t("accountWide")}</p>
        <SafetyNote />
        {saveError && (
          <InlineNotice tone="error" announcement="alert">
            {t("saveError")}
          </InlineNotice>
        )}
      </FormSection>
    </form>
  );
}

function SafetyNote() {
  const t = useTranslations("unsubscribe");
  return (
    <div className="border-l-2 border-[#0D59E6] pl-4 text-sm leading-6 text-slate-600">
      <p className="font-semibold text-slate-900">{t("securityTitle")}</p>
      <p>{t("securityHelp")}</p>
    </div>
  );
}
