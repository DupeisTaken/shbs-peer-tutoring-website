import { getFormatter, getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import {
  aliyunQuotaResetTime,
  DAILY_FREE_EMAIL_LIMIT,
  getAliyunEmailQuota,
} from "~/server/email/aliyun-quota";

export async function EmailQuotaCard() {
  // The dashboard also serves Coordinators and read-only observers. The quota is operational data.
  const session = await auth();
  if (!session?.user) return null;
  const account = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  if (
    !account ||
    account.suspendedAt ||
    account.mergedIntoId ||
    account.recoveryVoidedAt ||
    (account.role !== "HEAD" && account.role !== "ADMIN")
  )
    return null;

  const [quota, t, format] = await Promise.all([
    getAliyunEmailQuota(),
    getTranslations("admin.dashboard.emailQuota"),
    getFormatter(),
  ]);
  const resetTime = aliyunQuotaResetTime();
  return (
    <section
      className="card p-4 text-center sm:p-5 sm:text-left"
      aria-labelledby="email-quota-title"
    >
      <h2 id="email-quota-title" className="section-title">
        {t("title")}
      </h2>
      {quota ? (
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div>
            {quota.dailyRemaining === null ? (
              <p className="text-sm text-slate-600">{t("dailyUnavailable")}</p>
            ) : (
              <p className="flex flex-wrap items-baseline justify-center gap-x-2 sm:justify-start">
                <span className="text-2xl font-bold text-slate-900 tabular-nums">
                  {t("dailyCount", {
                    remaining: quota.dailyRemaining,
                    limit: DAILY_FREE_EMAIL_LIMIT,
                  })}
                </span>
                <span className="text-sm text-slate-600">{t("dailyFree")}</span>
              </p>
            )}
          </div>
          <div className="space-y-1 text-sm text-slate-600 sm:text-right">
            <p>
              {quota.balanceRemaining === null
                ? t("balanceUnavailable")
                : t("balance", { count: quota.balanceRemaining })}
            </p>
            <p>
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
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">{t("unavailable")}</p>
      )}
    </section>
  );
}
