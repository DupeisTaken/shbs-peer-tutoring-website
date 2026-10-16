"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "~/app/_components/ui/button";
import { FieldRequirement } from "~/app/_components/field-requirement";
import {
  FormActions,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

type Review = RouterOutputs["studentWorkflow"]["inspectSignupAppeal"];

/** Email proof starts in a fragment, is removed from visible history and lives
 * only in memory. Every inspection is a read-only POST, never a proof-bearing GET. */
export function SignupAppeal({ token = "" }: { token?: string }) {
  const t = useTranslations("signupAppeal");
  const [capability, setCapability] = useState(token);
  const [initialized, setInitialized] = useState(!!token);
  const validToken = /^[a-f0-9]{64}$/.test(capability);
  const inspector = api.studentWorkflow.inspectSignupAppeal.useMutation();
  const { mutateAsync: inspect } = inspector;
  const [record, setRecord] = useState<Review | null>(null);
  const [readFailure, setReadFailure] = useState<Error | null>(null);
  const readSequence = useRef(0);
  const activeCapability = useRef(capability);
  const mutation = api.studentWorkflow.appealSignup.useMutation();
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const admitted = useRef(false);
  const attempt = useRef<{ reason: string; clientKey: string } | null>(null);
  useEffect(() => {
    if (token) return;
    const takeFragment = () => {
      const proof =
        new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      if (!proof && initialized) return;
      activeCapability.current = proof;
      setCapability(proof);
      setInitialized(true);
      setRecord(null);
      setAccepted(false);
      setReason("");
      attempt.current = null;
      if (proof)
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + window.location.search,
        );
    };
    // External browser URL changes must be adopted after hydration, never during SSR.
    takeFragment();
    window.addEventListener("hashchange", takeFragment);
    return () => window.removeEventListener("hashchange", takeFragment);
  }, [token, initialized]);
  const read = useCallback(
    async (proof: string) => {
      const sequence = ++readSequence.current;
      try {
        const fresh = await inspect({ token: proof });
        if (
          sequence === readSequence.current &&
          activeCapability.current === proof
        ) {
          setRecord(fresh);
          setReadFailure(null);
          setRevoked(false);
        }
        return { data: fresh, error: undefined };
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error("Read failed");
        if (
          sequence === readSequence.current &&
          activeCapability.current === proof
        ) {
          const code =
            typeof error === "object" && error !== null && "data" in error
              ? (error.data as { code?: string } | null)?.code
              : undefined;
          if (
            code &&
            ["BAD_REQUEST", "NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"].includes(
              code,
            )
          ) {
            setRevoked(true);
            setRecord(null);
          }
          setReadFailure(failure);
        }
        return { data: undefined, error: failure };
      }
    },
    [inspect],
  );
  useEffect(() => {
    if (initialized && validToken) void read(capability);
    return () => {
      readSequence.current++;
    };
  }, [initialized, validToken, capability, read]);
  if (initialized && (!validToken || revoked))
    return <StatePanel kind="denied" title={t("invalid")} />;
  const feedback = (
    <QueryFeedback
      hasData={!!record}
      loading={!record}
      error={!!readFailure}
      retrying={inspector.isPending}
      loadingTitle={t("loading")}
      errorTitle={t("loadFailed")}
      retryLabel={t("retry")}
      onRetry={() => void read(capability)}
    />
  );
  if (!record) return feedback;
  const source = record;
  const state = source.appeal?.state;
  const submit = async () => {
    if (
      admitted.current ||
      accepted ||
      !source.canAppeal ||
      readFailure ||
      !reason.trim()
    )
      return;
    admitted.current = true;
    setWorking(true);
    setFailure(null);
    attempt.current ??= {
      reason: reason.trim(),
      clientKey: crypto.randomUUID(),
    };
    const proof = capability;
    try {
      await mutation.mutateAsync({ token: proof, ...attempt.current });
      if (activeCapability.current !== proof) return;
      setAccepted(true);
      // Refresh failures recover with a read, never by resubmitting an accepted appeal.
      const fresh = await read(capability);
      if (fresh.error) setFailure(t("loadFailed"));
    } catch (error) {
      if (activeCapability.current === proof)
        setFailure(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };
  return (
    <section className="card space-y-5 p-6">
      {feedback}
      {state && (
        <InlineNotice
          tone={state === "REJECTED" ? "warning" : "info"}
          announcement="status"
        >
          {t(
            state === "PENDING"
              ? "pending"
              : state === "ACCEPTED"
                ? "accepted"
                : "rejected",
          )}
        </InlineNotice>
      )}
      {source.appeal && (
        <blockquote className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm break-words whitespace-pre-wrap">
          {source.appeal.reason}
        </blockquote>
      )}
      {accepted && (
        <InlineNotice
          tone="success"
          announcement="status"
          action={
            readFailure ? (
              <Button onClick={() => void read(capability)}>
                {t("retry")}
              </Button>
            ) : undefined
          }
        >
          {t("submitted")}
        </InlineNotice>
      )}
      {failure && (
        <InlineNotice tone="error" announcement="alert">
          {failure}
        </InlineNotice>
      )}
      {!source.canAppeal && !source.appeal && (
        <InlineNotice>{t("closed")}</InlineNotice>
      )}
      {source.canAppeal && state !== "PENDING" && !accepted && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset
            disabled={working || mutation.isPending || !!readFailure}
            className="space-y-4"
            aria-busy={working || mutation.isPending}
          >
            <label className="block space-y-1">
              <span className="label">
                {t("reason")}
                <FieldRequirement state="required" />
              </span>
              <textarea
                className="input min-h-32"
                rows={5}
                required
                maxLength={2000}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  attempt.current = null;
                }}
              />
            </label>
            <FormActions>
              <Button type="submit" variant="primary" disabled={!reason.trim()}>
                {t(working ? "submitting" : "submit")}
              </Button>
            </FormActions>
          </fieldset>
        </form>
      )}
    </section>
  );
}
