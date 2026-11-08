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
  schoolHoursEmailCopy,
  type SchoolHoursPublicReport,
} from "../src/server/school-hours-email";
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

export function schoolReportPreview(revision = 1): SchoolHoursPublicReport {
  const alexMonth = revision === 1 ? 7 : revision === 2 ? 7.5 : 7.75;
  const alexChange = revision === 1 ? 7 : revision === 2 ? 0.5 : 0.25;
  const blairMonth = -revision / 60;
  const blairPrevious = revision === 1 ? null : -(revision - 1) / 60;
  const blairChange = blairMonth - (blairPrevious ?? 0);
  return {
    month: "2026-10",
    revision,
    generatedAt: "2026-10-31T04:00:00.000Z",
    timeZone: "Asia/Shanghai",
    includeStatistics: true,
    rows: [
      {
        exportName: 'Alex "A" Chen (陈安)',
        schoolAccountKey: "school-A",
        tutoringChange: alexChange - (revision === 1 ? 1 : 0),
        crewChange: revision === 1 ? 1 : 0,
        hoursToAdd: alexChange,
        monthAmount: alexMonth,
        previousEditionAmount: revision === 1 ? null : revision === 2 ? 7 : 7.5,
        previousMonthAmount: 6,
        monthComparison: alexMonth - 6,
        unchanged: false,
        priorEditions:
          revision > 2
            ? [
                { revision: 1, monthAmount: 7, correctionToCurrent: 0.75 },
                { revision: 2, monthAmount: 7.5, correctionToCurrent: 0.25 },
              ]
            : [],
      },
      {
        exportName: "Blair Example / 示例",
        schoolAccountKey: "school-B",
        tutoringChange: blairChange,
        crewChange: 0,
        hoursToAdd: blairChange,
        monthAmount: blairMonth,
        previousEditionAmount: blairPrevious,
        previousMonthAmount: null,
        monthComparison: null,
        unchanged: false,
      },
      {
        exportName: "Casey Example / 示例",
        schoolAccountKey: "school-C",
        tutoringChange: revision === 1 ? 2 : 0,
        crewChange: 0,
        hoursToAdd: revision === 1 ? 2 : 0,
        monthAmount: 2,
        previousEditionAmount: revision === 1 ? null : 2,
        previousMonthAmount: null,
        monthComparison: null,
        unchanged: revision > 1,
      },
    ],
    totals: {
      people: 3,
      tutoringChange:
        alexChange -
        (revision === 1 ? 1 : 0) +
        blairChange +
        (revision === 1 ? 2 : 0),
      crewChange: revision === 1 ? 1 : 0,
      hoursToAdd: alexChange + blairChange + (revision === 1 ? 2 : 0),
      monthAmount: alexMonth + blairMonth + 2,
    },
  };
}

export function emailPreviewSamples(): EmailPreviewSample[] {
  const link = `${previewOrigin}/signin?callbackUrl=%2Fstudent`;
  const unsubscribeUrl = `${previewOrigin}/unsubscribe?token=${"synthetic".repeat(12)}`;
  const samples: EmailPreviewSample[] = [
    {
      name: "code",
      ...codeEmailCopy({
        subject: "Your sign-in code / 登录验证码",
        code: "0012",
        eyebrow: "SIGN IN / 登录",
        body: "Enter this code to sign in. It expires in 10 minutes.\n输入此验证码以登录，10 分钟内有效。\n\nIf you did not try to sign in, change your password or contact the program team.\n如非本人尝试登录，请更改密码或联系项目团队。",
      }),
    },
    {
      name: "invitation-verification",
      ...invitationVerificationEmailCopy({
        code: "0012",
        purpose: { en: "tutor access", zh: "导师身份" },
        deadline,
        url: invitationUrl,
      }),
    },
    ...["A2B3C", "012345ABCDEF"].map((code) => ({
      name: code.length === 5 ? "invitation" : "legacy-invitation",
      ...invitationEmailCopy({
        code,
        purpose: { en: "tutor access", zh: "导师身份" },
        deadline,
        url: `${previewOrigin}/register?code=${code}`,
      }),
    })),
    {
      name: "signup",
      ...tutoringSignupEmailCopy({
        code: "0012",
        deadline,
        url: `${previewOrigin}/tutee/account?token=${"synthetic".repeat(12)}`,
      }),
    },
    {
      name: "legacy-signup",
      ...tutoringSignupEmailCopy({
        code: "0012",
        legacy: true,
        verificationDue: {
          ...deadline,
          at: new Date("2026-11-12T16:30:00.000Z"),
        },
        url: `${previewOrigin}/tutee/account?token=${"synthetic".repeat(12)}`,
      }),
    },
    {
      name: "history",
      ...historyInvitationEmailCopy({
        scope: {
          en: "Review two historical tutor profiles and one tutee profile.",
          zh: "请核对两份历史导师档案和一份学习伙伴档案。",
        },
        url: historyUrl,
        exact: true,
      }),
    },
    {
      name: "program",
      ...notificationEmailContent({
        event: "program_update",
        context: {},
        createdAt: new Date("2026-11-09T08:30:00Z"),
        timeZone: "Asia/Shanghai",
        category: "info",
        link,
        unsubscribeUrl,
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
        report: schoolReportPreview(revision),
        reportUrl: `${previewOrigin}/school-report/synthetic`,
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
        kind,
        appealUrl: `${previewOrigin}/request-appeal?token=synthetic`,
      }),
    });
  samples.push({
    name: "security",
    ...notificationEmailContent({
      event: "security_changed",
      context: { changedFields: ["password"] },
      createdAt: new Date("2026-11-09T08:30:00Z"),
      timeZone: "Asia/Shanghai",
      category: "security",
      link: `${previewOrigin}/signin?callbackUrl=%2Fmy-account`,
    }),
  });
  return samples;
}
