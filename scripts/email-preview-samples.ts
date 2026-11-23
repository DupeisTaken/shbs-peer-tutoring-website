/** Offline fixtures for the production copy builders. Never load DB or transport. */
import {
  codeEmailCopy,
  historyInvitationEmailCopy,
  invitationEmailCopy,
  invitationVerificationEmailCopy,
  signupAppealEmailCopy,
  tutoringSignupEmailCopy,
} from "../src/server/email/direct-email-copy";
import { notificationEmailContent } from "../src/server/email/notification-copy";
import { sessionPlanningNoticeCopy } from "../src/server/session-planning-notice-copy";
import { requestNoticeEmailCopy } from "../src/server/email/request-notice-copy";
import {
  historyInvitationScope,
  invitationPurpose,
} from "../src/server/email/required-notice-details";
import {
  schoolHoursEmailCopy,
  type SchoolHoursPublicReport,
} from "../src/server/school-hours-email";
import { emailText, type EmailLocale } from "../src/lib/email-locale";
import type { EmailPresentation } from "../src/server/email/template";

export type EmailPreviewSample = {
  name: string;
  subject: string;
  text: string;
  presentation?: EmailPresentation;
  html?: string;
};

export const previewOrigin = "https://tutoring.example.edu";
const deadline = {
  at: new Date("2026-11-10T16:30:00.000Z"),
  timeZone: "Asia/Shanghai",
};
const invitationUrl = `${previewOrigin}/register?code=A2B3C`;
const historyUrl = `${previewOrigin}/history/claim?token=${"synthetic".repeat(10)}`;

/** 80 min posts as 1.3 h with 2 min retained; another 4 min releases 0.1 h.
 * Blair carries 80 min of debt, offsets 40 min, then earns 50 min: 0.1 h posts
 * and 4 min remains. All examples use synthetic school accounts only. */
export function schoolReportPreview(revision = 1): SchoolHoursPublicReport {
  const rawAlex = revision === 1 ? 80 / 60 : revision === 2 ? 4 / 60 : 5 / 60;
  const postedAlex = revision === 1 ? 1.3 : revision === 2 ? 0.1 : 0;
  const rows: SchoolHoursPublicReport["rows"] = [
    {
      exportName: 'Alex "A" Chen (陈安)',
      schoolAccountKey: "school-A",
      tutoringChange: rawAlex,
      crewChange: 0,
      hoursToAdd: postedAlex,
      monthAmount: revision === 1 ? 1.3 : 1.4,
      previousEditionAmount: revision === 1 ? null : revision === 2 ? 1.3 : 1.4,
      previousMonthAmount: 6,
      monthComparison: revision === 1 ? -4.7 : -4.6,
      unchanged: false,
      carryInHours: revision === 2 ? "0.0333333333333333" : "0",
      carryOutHours:
        revision === 1
          ? "0.0333333333333333"
          : revision === 2
            ? "0"
            : "0.0833333333333333",
      priorEditions:
        revision > 2
          ? [
              { revision: 1, monthAmount: 1.3, correctionToCurrent: 0.1 },
              { revision: 2, monthAmount: 1.4, correctionToCurrent: 0 },
            ]
          : [],
    },
    {
      exportName: "Blair Example",
      schoolAccountKey: "school-B",
      tutoringChange:
        revision === 1 ? -80 / 60 : revision === 2 ? 40 / 60 : 50 / 60,
      crewChange: 0,
      hoursToAdd: revision < 3 ? 0 : 0.1,
      monthAmount: revision < 3 ? 0 : 0.1,
      previousEditionAmount: revision === 1 ? null : 0,
      previousMonthAmount: null,
      monthComparison: null,
      unchanged: revision === 2,
      carryInHours:
        revision === 1
          ? "0"
          : revision === 2
            ? "-1.3333333333333333"
            : "-0.6666666666666667",
      carryOutHours:
        revision === 1
          ? "-1.3333333333333333"
          : revision === 2
            ? "-0.6666666666666667"
            : "0.0666666666666666",
      priorEditions:
        revision > 2
          ? [
              { revision: 1, monthAmount: 0, correctionToCurrent: 0.1 },
              { revision: 2, monthAmount: 0, correctionToCurrent: 0.1 },
            ]
          : [],
    },
    {
      exportName: "Casey Example",
      schoolAccountKey: "school-C",
      tutoringChange: revision === 1 ? 2 : 0,
      crewChange: 0,
      hoursToAdd: revision === 1 ? 2 : 0,
      monthAmount: 2,
      previousEditionAmount: revision === 1 ? null : 2,
      previousMonthAmount: null,
      monthComparison: null,
      unchanged: revision > 1,
      carryInHours: "0",
      carryOutHours: "0",
    },
  ];
  return {
    month: "2026-10",
    revision,
    generatedAt: "2026-10-31T04:00:00.000Z",
    timeZone: "Asia/Shanghai",
    includeStatistics: true,
    postingPolicy: "TENTH_HOUR_CARRY_NONNEGATIVE",
    rows,
    totals: {
      people: rows.length,
      tutoringChange: rows.reduce((total, row) => total + row.tutoringChange, 0),
      crewChange: 0,
      hoursToAdd: rows.reduce((total, row) => total + row.hoursToAdd, 0),
      monthAmount: rows.reduce((total, row) => total + row.monthAmount, 0),
    },
  };
}

export function emailPreviewSamples(
  locale: EmailLocale = "en",
): EmailPreviewSample[] {
  const link = `${previewOrigin}/signin?callbackUrl=%2Fstudent`;
  const unsubscribeUrl = `${previewOrigin}/unsubscribe?token=${"synthetic".repeat(12)}`;
  const samples: EmailPreviewSample[] = [
    {
      name: "code",
      ...codeEmailCopy({
        locale,
        preview: emailText(locale, {
          en: "Enter this 4-digit code within 10 minutes to finish signing in.",
          zh: "请在 10 分钟内输入 4 位验证码以完成登录。",
        }),
        subject: emailText(locale, {
          en: "Your sign-in code",
          zh: "你的登录验证码",
        }),
        code: "0012",
        eyebrow: emailText(locale, { en: "SIGN IN", zh: "登录验证" }),
        body: emailText(locale, {
          en: "Enter this 4-digit code on the website to finish signing in. It expires in 10 minutes.\n\nDidn't just try to sign in? Change your password right away or contact the program team.",
          zh: "请在网站输入此 4 位验证码以完成登录，10 分钟内有效。\n\n如果刚才不是你在尝试登录，请立即修改密码或联系项目团队。",
        }),
      }),
    },
    {
      name: "invitation-verification",
      ...invitationVerificationEmailCopy({
        locale,
        code: "0012",
        purpose: invitationPurpose("TUTOR"),
        deadline,
        url: invitationUrl,
      }),
    },
    {
      name: "invitation",
      ...invitationEmailCopy({
        locale,
        code: "A2B3C",
        purpose: invitationPurpose("TUTOR"),
        deadline,
        url: `${previewOrigin}/register?code=A2B3C`,
      }),
    },
    {
      name: "admin-invitation",
      ...invitationEmailCopy({
        locale,
        code: "K7M2P",
        purpose: invitationPurpose("ADMIN"),
        deadline,
        url: `${previewOrigin}/register?code=K7M2P`,
      }),
    },
    {
      name: "signup",
      ...tutoringSignupEmailCopy({
        locale,
        code: "0012",
        deadline,
        url: `${previewOrigin}/tutee/account?token=${"synthetic".repeat(12)}`,
      }),
    },
    {
      name: "history",
      ...historyInvitationEmailCopy({
        locale,
        scope: historyInvitationScope([
          { kind: "TUTOR" },
          { kind: "TUTOR" },
          { kind: "TUTEE" },
        ]),
        url: historyUrl,
        exact: true,
      }),
    },
    {
      name: "program",
      ...notificationEmailContent({
        locale,
        event: "program_update",
        context: {},
        createdAt: new Date("2026-11-09T08:30:00Z"),
        timeZone: "Asia/Shanghai",
        category: "info",
        link,
        unsubscribeUrl,
      }),
    },
    {
      name: "program-required",
      ...notificationEmailContent({
        locale,
        event: "program_update",
        context: {},
        createdAt: new Date("2026-11-09T08:30:00Z"),
        timeZone: "Asia/Shanghai",
        category: "info",
        link,
        unsubscribeUrl,
        requiredByProgram: true,
      }),
    },
  ];
  for (const [event, obsolete] of [
    ["proposed", false],
    ["response_autoaccepted", false],
    ["deadline_missed", false],
    ["schedule_updated", true],
  ] as const) {
    const copy = sessionPlanningNoticeCopy(
      event,
      {
        subjectLabel: "Mathematics / 数学",
        roomLabel: "Learning Center / 学习中心",
        online: false,
        stage: "B",
        isActionable: event === "proposed",
        startsAt: "2026-11-10T08:00:00.000Z",
        endsAt: "2026-11-10T08:45:00.000Z",
        originalStartsAt: "2026-11-09T08:00:00.000Z",
        timeZone: "Asia/Shanghai",
      },
      obsolete,
      locale,
    );
    samples.push({
      name: `session-${event}${obsolete ? "-obsolete" : ""}`,
      ...copy,
      presentation: {
        ...copy.presentation,
        action: {
          ...copy.presentation.action,
          url: `${previewOrigin}/signin?callbackUrl=%2Fstudent%23schedule`,
        },
      },
    });
  }
  for (const revision of [1, 2, 3])
    samples.push({
      name: `school-r${revision}`,
      ...schoolHoursEmailCopy({
        locale,
        iconUrl: `${previewOrigin}/icon.png`,
        report: schoolReportPreview(revision),
        reportUrl: `${previewOrigin}/school-report/synthetic`,
      }),
    });
  samples.push({
    name: "school-reminder",
    ...schoolHoursEmailCopy({
      locale,
      iconUrl: `${previewOrigin}/icon.png`,
      reminder: true,
      report: schoolReportPreview(1),
      reportUrl: `${previewOrigin}/school-report/synthetic`,
    }),
  });
  samples.push({
    name: "announcement",
    ...notificationEmailContent({
      locale,
      event: "announcement_published",
      context: {
        emailDetail: {
          en: "Announcement “Midterm Room Changes” was published. Open it to read the announcement.",
          zh: "公告《期中考试教室调整》已发布。请打开查看。",
        },
      },
      createdAt: new Date("2026-11-09T08:30:00Z"),
      timeZone: "Asia/Shanghai",
      category: "info",
      link: `${previewOrigin}/signin?callbackUrl=%2Fdashboard`,
      unsubscribeUrl,
    }),
  });
  samples.push({
    name: "admin-review",
    ...notificationEmailContent({
      locale,
      event: "tutor_application_pending",
      context: {
        emailDetail: {
          en: "Jordan Li submitted a tutor application.",
          zh: "Jordan Li 提交了辅导伙伴申请。",
        },
      },
      createdAt: new Date("2026-11-09T08:30:00Z"),
      timeZone: "Asia/Shanghai",
      category: "review",
      link: `${previewOrigin}/signin?callbackUrl=%2Fadmin%2Fapplications`,
      unsubscribeUrl,
    }),
  });
  for (const verified of [false, true])
    samples.push({
      name: `request-${verified ? "verified" : "unverified"}`,
      ...requestNoticeEmailCopy(
        {
          id: "synthetic",
          createdAt: new Date("2026-11-09T08:30:00Z"),
          requestKind: "survey",
          requestInvalid: true,
          requestSubmittedAt: new Date("2026-11-08T16:30:00Z"),
          requestTimeZone: "Asia/Shanghai",
          requestReason:
            "Please clarify your selected subject. / 请确认所选科目。",
        },
        verified,
        `${previewOrigin}/request-appeal?token=synthetic`,
        locale,
      ),
    });
  for (const kind of [
    "INVALID_FLAGGED",
    "APPEAL_ACCEPTED",
    "APPEAL_REJECTED",
  ] as const)
    samples.push({
      name: `appeal-${kind.toLowerCase().replaceAll("_", "-")}`,
      ...signupAppealEmailCopy({
        locale,
        kind,
        appealUrl: `${previewOrigin}/request-appeal?token=synthetic`,
      }),
    });
  samples.push({
    name: "security",
    ...notificationEmailContent({
      locale,
      event: "security_changed",
      context: { changedFields: ["password"] },
      createdAt: new Date("2026-11-09T08:30:00Z"),
      timeZone: "Asia/Shanghai",
      category: "security",
      link: `${previewOrigin}/signin?callbackUrl=%2Fmy-account`,
    }),
  });
  return samples.map((sample) => ({
    ...sample,
    name: `${sample.name}-${locale}`,
  }));
}
