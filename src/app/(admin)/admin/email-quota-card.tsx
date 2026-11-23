import { getFormatter, getTranslations } from "next-intl/server";
import { cache } from "react";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import {
  aliyunQuotaResetTime,
  DAILY_FREE_EMAIL_LIMIT,
  getAliyunEmailQuota,
} from "~/server/email/aliyun-quota";

// Warn when at most 20% of the daily cap or one full day of free balance remains.
const DAILY_LOW_THRESHOLD = DAILY_FREE_EMAIL_LIMIT / 5;
const BALANCE_LOW_THRESHOLD = DAILY_FREE_EMAIL_LIMIT;

// Share the live role check between the fallback and the card for this request.
export const canViewEmailQuota = cache(async (): Promise<boolean> => {
  const session = await auth();
  if (!session?.user) return false;
  const account = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  return Boolean(
    account &&
    !account.suspendedAt &&
    !account.mergedIntoId &&
    !account.recoveryVoidedAt &&
    (account.role === "HEAD" || account.role === "ADMIN"),
  );
});

/**
 * Reserves the card's vertical footprint for authorized Admin/Head accounts while the
 * Direct Mail summary streams in, preventing a late layout shift above Recent Submissions.
 */
export function EmailQuotaCardSkeleton({
  title,
  loadingLabel,
}: {
  title: string;
  loadingLabel: string;
}) {
  return (
    <section
      className="card p-4 text-left sm:p-5"
      aria-labelledby="email-quota-loading-title"
      aria-busy="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="email-quota-loading-title" className="section-title">
          {title}
        </h2>
        <span role="status" className="sr-only">
          {loadingLabel}
        </span>
      </div>
      <div
        className="mt-3 grid gap-4 sm:mt-3.5 sm:grid-cols-12 sm:gap-6"
        aria-hidden="true"
      >
        <div className="min-w-0 sm:col-span-7">
          <div className="h-3.5 w-28 max-w-full rounded bg-slate-200 motion-safe:animate-pulse" />
          <div className="mt-2 h-8 w-44 max-w-full rounded bg-slate-200 motion-safe:animate-pulse" />
          <div className="mt-2.5 h-2 w-full rounded-full bg-slate-100" />
          <div className="mt-2 h-3.5 w-48 max-w-full rounded bg-slate-100 motion-safe:animate-pulse" />
        </div>
        <div className="min-w-0 border-t border-slate-100 pt-3.5 sm:col-span-5 sm:border-t-0 sm:border-l sm:border-slate-200 sm:pt-0 sm:pl-6">
          <div className="h-3.5 w-32 max-w-full rounded bg-slate-200 motion-safe:animate-pulse" />
          <div className="mt-2 h-8 w-36 max-w-full rounded bg-slate-200 motion-safe:animate-pulse" />
          <div className="mt-2 h-3.5 w-52 max-w-full rounded bg-slate-100 motion-safe:animate-pulse" />
        </div>
      </div>
    </section>
  );
}

export async function EmailQuotaCard() {
  // The dashboard also serves Coordinators and read-only observers. The quota is operational data.
  if (!(await canViewEmailQuota())) return null;

  const [quota, t, format] = await Promise.all([
    getAliyunEmailQuota(),
    getTranslations("admin.dashboard.emailQuota"),
    getFormatter(),
  ]);
  const resetTime = aliyunQuotaResetTime();

  const balanceExhausted = quota !== null && quota.balanceRemaining === 0;
  const dailyExhausted =
    quota !== null && !balanceExhausted && quota.dailyRemaining === 0;
  const dailyLow =
    quota !== null &&
    quota.dailyRemaining !== null &&
    quota.dailyRemaining > 0 &&
    quota.dailyRemaining <= DAILY_LOW_THRESHOLD;
  const balanceLow =
    quota !== null &&
    quota.balanceRemaining !== null &&
    quota.balanceRemaining > 0 &&
    quota.balanceRemaining <= BALANCE_LOW_THRESHOLD;

  const statusBadge =
    quota === null
      ? {
          label: t("statusUnavailable"),
          className: "badge bg-amber-100 text-amber-800",
        }
      : balanceExhausted
        ? {
            label: t("statusBalanceExhausted"),
            className: "badge-red",
          }
        : dailyExhausted
          ? {
              label: t("statusDailyExhausted"),
              className: "badge bg-amber-100 text-amber-800",
            }
          : dailyLow || balanceLow
            ? {
                label: t("statusLow"),
                className: "badge bg-amber-100 text-amber-800",
              }
            : null;

  const cardRing = balanceExhausted
    ? "ring-2 ring-red-200"
    : dailyExhausted || dailyLow || balanceLow
      ? "ring-2 ring-amber-300"
      : "";

  const dailyPct =
    ((quota?.dailyRemaining ?? 0) / DAILY_FREE_EMAIL_LIMIT) * 100;

  return (
    <section
      className={`card p-4 text-left sm:p-5 ${cardRing}`}
      aria-labelledby="email-quota-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="email-quota-title" className="section-title">
          {t("title")}
        </h2>
        {statusBadge && (
          <span className={statusBadge.className}>{statusBadge.label}</span>
        )}
      </div>

      {quota ? (
        <dl className="mt-3 grid gap-4 sm:mt-3.5 sm:grid-cols-12 sm:gap-6">
          <div className="min-w-0 sm:col-span-7">
            <dt className="text-xs font-semibold tracking-[0.06em] text-slate-600 uppercase">
              {t("dailyLabel")}
            </dt>
            <dd className="mt-1">
              {quota.dailyRemaining === null ? (
                <>
                  <p className="text-lg font-semibold text-slate-700">
                    {t("statusUnavailable")}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {t("dailyUnavailable")}
                  </p>
                </>
              ) : (
                <>
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span
                      className={`text-3xl font-bold tracking-tight tabular-nums ${
                        balanceExhausted
                          ? "text-red-700"
                          : dailyExhausted
                            ? "text-amber-800"
                            : "text-slate-900"
                      }`}
                    >
                      {t("dailyCount", {
                        remaining: quota.dailyRemaining,
                        limit: DAILY_FREE_EMAIL_LIMIT,
                      })}
                    </span>{" "}
                    <span className="text-sm text-slate-600">
                      {t("dailyFree")}
                    </span>
                  </p>
                  <div
                    className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100"
                    aria-hidden="true"
                  >
                    {dailyPct > 0 && (
                      <div
                        className={`h-full rounded-full ${
                          dailyLow ? "bg-amber-400" : "bg-emerald-500"
                        }`}
                        style={{ width: `${dailyPct}%` }}
                      />
                    )}
                  </div>
                </>
              )}
              <p className="mt-2 text-xs text-slate-600">
                {resetTime
                  ? t("resetsAt", {
                      time: format.dateTime(resetTime, {
                        timeZone: "Asia/Shanghai",
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                        timeZoneName: "short",
                      }),
                    })
                  : t("resetUnknown")}
              </p>
            </dd>
          </div>

          <div className="min-w-0 border-t border-slate-100 pt-3.5 sm:col-span-5 sm:border-t-0 sm:border-l sm:border-slate-200 sm:pt-0 sm:pl-6">
            <dt className="text-xs font-semibold tracking-[0.06em] text-slate-600 uppercase">
              {t("balanceLabel")}
            </dt>
            <dd className="mt-1">
              {quota.balanceRemaining === null ? (
                <>
                  <p className="text-lg font-semibold text-slate-700">
                    {t("statusUnavailable")}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {t("balanceUnavailable")}
                  </p>
                </>
              ) : (
                <>
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span
                      className={`text-2xl font-bold tracking-tight tabular-nums ${
                        balanceExhausted
                          ? "text-red-700"
                          : balanceLow
                            ? "text-amber-800"
                            : "text-slate-900"
                      }`}
                    >
                      {format.number(quota.balanceRemaining)}
                    </span>{" "}
                    <span className="text-sm text-slate-600">
                      {t("balanceUnit", { count: quota.balanceRemaining })}
                    </span>
                  </p>
                  <p
                    className={`mt-2 text-xs ${
                      balanceExhausted
                        ? "font-medium text-red-700"
                        : "text-slate-600"
                    }`}
                  >
                    {balanceExhausted
                      ? t("balanceExhaustedHint")
                      : t("balanceHint")}
                  </p>
                </>
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="mt-2 space-y-1">
          <p className="text-sm font-medium text-slate-700">
            {t("unavailable")}
          </p>
          <p className="text-xs text-slate-600">{t("unavailableHelp")}</p>
        </div>
      )}
    </section>
  );
}
