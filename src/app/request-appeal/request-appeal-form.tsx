"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "~/app/_components/ui/button";
import {
  FormActions,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";

type Ready = {
  status: "ready";
  kind: "tutor" | "tutee";
  recordedTime: string | null;
  timeZone: string;
  appealStatus: "PENDING" | "DECLINED" | "CLEARED" | null;
};
type State =
  Ready | { status: "loading" } | { status: "error" } | { status: "invalid" };
function readResult(value: unknown): Ready | { status: "invalid" } | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.status === "invalid") return { status: "invalid" };
  if (
    data.status !== "ready" ||
    !(data.kind === "tutor" || data.kind === "tutee") ||
    typeof data.timeZone !== "string" ||
    !(data.recordedTime === null || typeof data.recordedTime === "string") ||
    !(
      data.appealStatus === null ||
      data.appealStatus === "PENDING" ||
      data.appealStatus === "DECLINED" ||
      data.appealStatus === "CLEARED"
    )
  )
    return null;
  if (
    typeof data.recordedTime === "string" &&
    !Number.isFinite(Date.parse(data.recordedTime))
  )
    return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: data.timeZone }).format(
      new Date(),
    );
  } catch {
    return null;
  }
  return data as Ready;
}
/** The capability owns its draft. It grants only this appeal; late requests from
 * an earlier link cannot overwrite the next link's text or accepted receipt. */
export function RequestAppealForm({ token }: { token?: string }) {
  return <RequestAppealDraft key={token ?? "missing"} token={token} />;
}
function RequestAppealDraft({ token }: { token?: string }) {
  const t = useTranslations("requestAppeal"),
    locale = useLocale();
  const [state, setState] = useState<State>({
    status: token ? "loading" : "invalid",
  });
  const [body, setBody] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(false);
  const [accepted, setAccepted] = useState(false),
    [readFailed, setReadFailed] = useState(false);
  const [alreadyRecorded, setAlreadyRecorded] = useState(false);
  const admitted = useRef(false),
    acceptedReceipt = useRef(false),
    write = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/request-appeal?token=${encodeURIComponent(token)}`,
          {
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          },
        );
        const data = readResult(await response.json());
        if (!data || (!response.ok && data.status !== "invalid"))
          throw new Error("Unavailable");
        if (controller.signal.aborted) return;
        setState(data);
        setReadFailed(false);
        if (data.status === "ready" && data.appealStatus) {
          if (!acceptedReceipt.current) setAlreadyRecorded(true);
          acceptedReceipt.current = true;
          setAccepted(true);
        }
      } catch {
        if (controller.signal.aborted) return;
        // A failed read never unlocks an accepted write or discards the draft.
        if (acceptedReceipt.current) setReadFailed(true);
        else setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [token, attempt]);
  useEffect(() => () => write.current?.abort(), []);
  async function submit() {
    if (
      !token ||
      admitted.current ||
      acceptedReceipt.current ||
      state.status !== "ready" ||
      body.trim().length < 10 ||
      body.trim().length > 2000
    )
      return;
    admitted.current = true;
    setPending(true);
    setError(false);
    const controller = new AbortController();
    write.current = controller;
    try {
      const response = await fetch("/api/request-appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body: JSON.stringify({ token, body: body.trim() }),
      });
      const result: unknown = await response.json();
      if (controller.signal.aborted) return;
      const status =
        result && typeof result === "object" && "status" in result
          ? result.status
          : null;
      if (status === "invalid") setState({ status: "invalid" });
      else if (
        response.ok &&
        (status === "submitted" || status === "already-submitted")
      ) {
        setAlreadyRecorded(status === "already-submitted");
        acceptedReceipt.current = true;
        setAccepted(true);
        setAttempt((value) => value + 1);
      } else throw new Error("Unavailable");
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        admitted.current = false;
        write.current = null;
        setPending(false);
      }
    }
  }
  if (state.status === "loading")
    return <StatePanel kind="loading" title={t("loading")} />;
  if (state.status === "invalid")
    return (
      <StatePanel kind="empty" title={t("invalid")}>
        {t("invalidHelp")}
      </StatePanel>
    );
  if (state.status === "error")
    return (
      <StatePanel
        kind="error"
        title={t("error")}
        action={
          <Button onClick={() => setAttempt((value) => value + 1)}>
            {t("retry")}
          </Button>
        }
      />
    );
  const time = state.recordedTime
    ? `${new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: state.timeZone }).format(new Date(state.recordedTime))} (${state.timeZone})`
    : t("unknownTime");
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="font-semibold text-slate-900">{t(state.kind)}</p>
        <p className="mt-1 text-sm text-slate-600">
          {t("submittedTime", { time })}
        </p>
      </div>
      {accepted && (
        <InlineNotice announcement="status">
          <p className="font-semibold">{t("submitted")}</p>
          <p className="mt-1">{t("submittedHelp")}</p>
          {alreadyRecorded && <p className="mt-2">{t("existing")}</p>}
        </InlineNotice>
      )}
      {/* A receipt confirms submission; only the separate review outcome conveys approval. */}
      {accepted && state.appealStatus && (
        <InlineNotice
          tone={
            state.appealStatus === "DECLINED"
              ? "warning"
              : state.appealStatus === "CLEARED"
                ? "success"
                : "info"
          }
          announcement="status"
        >
          <p className="font-medium">
            {t(
              state.appealStatus === "DECLINED"
                ? "statusDeclined"
                : state.appealStatus === "CLEARED"
                  ? "statusCleared"
                  : "statusPending",
            )}
          </p>
        </InlineNotice>
      )}
      {readFailed && (
        <InlineNotice
          tone="warning"
          action={
            <Button onClick={() => setAttempt((value) => value + 1)}>
              {t("retry")}
            </Button>
          }
        >
          {t("readFailed")}
        </InlineNotice>
      )}
      {!accepted && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={pending} aria-busy={pending} className="min-w-0">
            <label
              className="block text-sm font-medium"
              htmlFor="request-appeal-body"
            >
              {t("body")}
            </label>
            <textarea
              id="request-appeal-body"
              className="input mt-2 min-h-40 w-full"
              required
              minLength={10}
              maxLength={2000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              aria-describedby="request-appeal-help"
            />
            <p id="request-appeal-help" className="mt-2 text-sm text-slate-600">
              {t("bodyHelp")}
            </p>
          </fieldset>
          {error && (
            <InlineNotice tone="error" announcement="alert">
              {t("failed")}
            </InlineNotice>
          )}
          <FormActions>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || body.trim().length < 10}
            >
              {t(pending ? "pending" : "submit")}
            </Button>
          </FormActions>
        </form>
      )}
    </div>
  );
}
