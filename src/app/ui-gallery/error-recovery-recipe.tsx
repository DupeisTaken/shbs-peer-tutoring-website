"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/app/_components/ui/button";
import {
  FormActions,
  InlineNotice,
  StatePanel,
} from "~/app/_components/ui/patterns";
import {
  formatClientError,
  type ClientErrorLike,
  type KnownErrorCode,
} from "~/lib/client-error-message";

type ErrorScenario = KnownErrorCode | "NETWORK" | "GENERIC";

const SCENARIO_ERRORS: Record<ErrorScenario, ClientErrorLike> = {
  UNAUTHORIZED: { data: { code: "UNAUTHORIZED" }, message: "UNAUTHORIZED" },
  FORBIDDEN: { data: { code: "FORBIDDEN" }, message: "FORBIDDEN" },
  NOT_FOUND: { data: { code: "NOT_FOUND" }, message: "NOT_FOUND" },
  CONFLICT: { data: { code: "CONFLICT" }, message: "CONFLICT" },
  TOO_MANY_REQUESTS: {
    data: { code: "TOO_MANY_REQUESTS" },
    message: "TOO_MANY_REQUESTS",
  },
  TIMEOUT: { data: { code: "TIMEOUT" }, message: "TIMEOUT" },
  PRECONDITION_FAILED: {
    data: { code: "PRECONDITION_FAILED" },
    message: "PRECONDITION_FAILED",
  },
  BAD_REQUEST: { data: { code: "BAD_REQUEST" }, message: "BAD_REQUEST" },
  INTERNAL_SERVER_ERROR: {
    data: { code: "INTERNAL_SERVER_ERROR" },
    message: "PrismaClientKnownRequestError: raw internals",
  },
  NETWORK: { message: "TypeError: Failed to fetch" },
  GENERIC: { message: "Unexpected internal stack detail" },
};

const SCENARIOS = Object.keys(SCENARIO_ERRORS) as ErrorScenario[];

const copy = {
  en: {
    eyebrow: "Resilience · localized recovery",
    title: "Route error boundary and localized error mapping",
    help: "RouteError composes StatePanel and FormActions with explicit retry and safe home navigation. formatClientError maps tRPC and network failures into plain-language recovery copy without exposing server internals.",
    scenarioLabel: "Simulated client error",
    retryCount: "Local retries",
    routeHeading: "Route error boundary preview (src/app/error.tsx)",
    recovered: "Route recovered in this synthetic example.",
    triggerRouteError: "Simulate route error",
    labels: {
      UNAUTHORIZED: "UNAUTHORIZED (signed out)",
      FORBIDDEN: "FORBIDDEN (no permission)",
      NOT_FOUND: "NOT_FOUND (missing record)",
      CONFLICT: "CONFLICT (stale version)",
      TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS (rate limit)",
      TIMEOUT: "TIMEOUT (request timed out)",
      PRECONDITION_FAILED: "PRECONDITION_FAILED (missing prerequisite)",
      BAD_REQUEST: "BAD_REQUEST (invalid input)",
      INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR (server failure)",
      NETWORK: "Network failure (Failed to fetch)",
      GENERIC: "Unknown error (fallback copy)",
    },
  },
  zh: {
    eyebrow: "容错 · 本地化恢复",
    title: "路由错误边界与本地化错误映射",
    help: "RouteError 组合 StatePanel 与 FormActions，提供明确的重试与返回主页操作。formatClientError 将 tRPC 与网络异常映射为简明的本地化提示，避免暴露服务端内部信息。",
    scenarioLabel: "模拟客户端错误",
    retryCount: "本地重试次数",
    routeHeading: "路由错误边界示例（src/app/error.tsx）",
    recovered: "已在本示例中恢复路由显示。",
    triggerRouteError: "模拟路由错误",
    labels: {
      UNAUTHORIZED: "UNAUTHORIZED（需重新登录）",
      FORBIDDEN: "FORBIDDEN（无权限）",
      NOT_FOUND: "NOT_FOUND（记录不存在）",
      CONFLICT: "CONFLICT（版本冲突）",
      TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS（请求过多）",
      TIMEOUT: "TIMEOUT（请求超时）",
      PRECONDITION_FAILED: "PRECONDITION_FAILED（缺少前提条件）",
      BAD_REQUEST: "BAD_REQUEST（输入有误）",
      INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR（服务端错误）",
      NETWORK: "网络异常（Failed to fetch）",
      GENERIC: "未知错误（兜底提示）",
    },
  },
} as const;

/** Synthetic error-recovery showcase: exercises formatClientError and the
 * RouteError layout without throwing into a live error boundary or hitting APIs. */
export function ErrorRecoveryRecipe({ locale }: { locale: "en" | "zh" }) {
  const t = useTranslations();
  const c = copy[locale];
  const [scenario, setScenario] = useState<ErrorScenario>("CONFLICT");
  const [announced, setAnnounced] = useState(false);
  const [retries, setRetries] = useState(0);
  const [routeState, setRouteState] = useState<"idle" | "error" | "recovered">(
    "idle",
  );

  const mappedMessage = formatClientError(SCENARIO_ERRORS[scenario], t);

  return (
    <section
      id="error-recovery-recipe"
      className="card min-w-0 space-y-5 p-5 sm:p-6"
    >
      <header className="space-y-2 border-b border-slate-100 pb-4">
        <p className="eyebrow">{c.eyebrow}</p>
        <h2 className="section-title">{c.title}</h2>
        <p className="text-sm leading-6 wrap-break-word text-slate-600">
          {c.help}
        </p>
        <code className="block text-xs break-words text-slate-500">
          formatClientError · InlineNotice · StatePanel · FormActions · .eyebrow
        </code>
      </header>

      <div className="space-y-3">
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{c.scenarioLabel}</span>
          <select
            className="select control-compact field-auto-bounded [--field-min-width:14rem] lg:min-h-8 lg:py-1"
            value={scenario}
            onChange={(event) => {
              setScenario(event.target.value as ErrorScenario);
              setAnnounced(true);
            }}
          >
            {SCENARIOS.map((key) => (
              <option key={key} value={key}>
                {c.labels[key]}
              </option>
            ))}
          </select>
        </label>

        <InlineNotice
          tone="error"
          announcement={announced ? "alert" : undefined}
          action={
            <Button
              size="compact"
              onClick={() => {
                setAnnounced(true);
                setRetries((value) => value + 1);
              }}
            >
              {t("uiPatterns.retry")}
            </Button>
          }
        >
          {mappedMessage}
        </InlineNotice>
        <p className="text-xs text-slate-500">
          {c.retryCount}: {retries}
        </p>
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-4">
        <p className="eyebrow">{c.routeHeading}</p>
        {routeState === "error" ? (
          <StatePanel kind="error" title={t("pageRecovery.errorTitle")}>
            <p>{t("pageRecovery.errorBody")}</p>
            <FormActions>
              <Button
                variant="primary"
                onClick={() => setRouteState("recovered")}
              >
                {t("uiPatterns.retry")}
              </Button>
              <Link href="/" className="btn-secondary control-standard">
                {t("workflows.home")}
              </Link>
            </FormActions>
          </StatePanel>
        ) : (
          <div className="space-y-3">
            <Button size="compact" onClick={() => setRouteState("error")}>
              {c.triggerRouteError}
            </Button>
            {routeState === "recovered" && (
              <InlineNotice tone="success" announcement="status">
                {c.recovered}
              </InlineNotice>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
