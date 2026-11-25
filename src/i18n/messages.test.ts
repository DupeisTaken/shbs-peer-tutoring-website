import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import de from "../../messages/de.json";
import el from "../../messages/el.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import zh from "../../messages/zh.json";
import { LOCALES, type Locale } from "./config";
import { TutorStatus } from "../../generated/prisma";

const bundledMessages = {
  en,
  zh,
  es,
  ja,
  ko,
  el,
  de,
  fr,
} satisfies Record<
  Locale,
  { common: { language: string }; landing: { nav: { menu: string } } }
>;

it.each(LOCALES)("uses an unbracketed Edited badge label in %s", (locale) => {
  // Management, tutor and student badges share this catalog key (#444).
  const label = bundledMessages[locale].workflow.edited;
  expect(label.trim()).not.toBe("");
  expect(label).not.toContain("[");
  expect(label).not.toContain("]");
  if (locale === "en") expect(label).toBe("Edited");
  if (locale === "zh") expect(label).toBe("已修改");
});

it("uses the same Program Settings label in navigation and page titles in every bundled locale", () => {
  for (const messages of Object.values(bundledMessages)) {
    expect(messages.admin.nav.links.program).toBe(messages.admin.program.title);
    expect(messages.roomOrder.open.trim()).not.toBe("");
    expect(messages.nameFields.hiddenProfileHelp.trim()).not.toBe("");
    expect(messages.programCalendar.details.trim()).not.toBe("");
  }
});

describe("UI recovery and persistent field labels", () => {
  // Built-in locales do not inherit English. Every newly reachable recovery or
  // label state needs its own message, including states reached only on failure.
  const paths = [
    "public.signupFormLoadFailed",
    "participantRecovery.loading",
    "participantRecovery.loadFailed",
    "participantRecovery.refreshFailed",
    "participantRecovery.accessDenied",
    "participantRecovery.accessDeniedHelp",
    "participantRecovery.retry",
    "managementRecovery.loading",
    "managementRecovery.loadFailed",
    "managementRecovery.refreshFailed",
    "managementRecovery.retry",
    "managementRecovery.denied",
    "saveErrors.staleRecord",
    "corrections.patrolChanged",
    "corrections.patrolRooms",
    "corrections.reloadPatrol",
    "corrections.patrolReloadFailed",
    "corrections.patrolUnavailable",
    "corrections.patrolSaved",
    "corrections.patrolSavedRefreshFailed",
    "corrections.patrolQueuedRefreshFailed",
    "corrections.invalidPatrolTime",
    "corrections.patrolRoomUnavailable",
    "corrections.patrolRoomRequired",
    "courseGroups.retry",
    "courseGroups.loadFailed",
    "courseGroups.refreshFailed",
    "courseGroups.accessDenied",
    "courseGroups.savedRefreshing",
    "courseGroups.savedRefreshFailed",
    "auditFilters.filterOptions",
    "auditFilters.retryReads",
    "auditFilters.loadingReads",
    "auditFilters.loadFailed",
    "auditFilters.refreshFailed",
    "auditFilters.accessDenied",
    "workflows.feedbackVisibilityLoading",
    "workflows.feedbackVisibilityUnavailable",
    "tablePatterns.noRooms",
    "tablePatterns.noSlots",
    "admin.policies.editor.titleLabel",
    "admin.policies.editor.versionLabel",
    "admin.policies.editor.bodyLabel",
    "admin.policies.editor.unsaved",
    "admin.policies.editor.refreshFailed",
    "admin.policies.editor.retryRefresh",
    "admin.users.appeals.review",
    "admin.users.appeals.message",
    "admin.users.appeals.refreshFailed",
    "admin.submissions.monthLabel",
    "admin.meetings.refreshFailed",
    "admin.landing.translation.titleLabel",
    "admin.landing.translation.bodyLabel",
    "admin.landing.addressRefreshFailed",
    "admin.landing.refreshAddress",
    "translationEditor.refreshFailed",
    "translationEditor.pageTarget.missingRecovery",
    "admin.crew.originalApplication",
    "admin.crew.originalRequest",
    "actionReview.galleryRevokeScenario",
    "actionReview.galleryRevoke",
    "actionReview.galleryRevoked",
    "actionReview.galleryRestore",
    "legacySignupDecline.publishedSessionRecords",
    "legacySignupDecline.requestTitle",
    "legacySignupDecline.requestConsequence",
    "legacySignupDecline.requestConfirm",
    "legacySignupDecline.actorLoading",
    "legacySignupDecline.actorLoadFailed",
    "legacySignupDecline.actorRetry",
    "legacySignupDecline.actorUnavailable",
    "legacySignupDecline.actorChanged",
    "legacySignupDecline.actorDenied",
    "admin.announcements.messageLabel",
    "tutor.announcements.dismissedTitle",
    "crew.patrol.statusLabel",
    "crew.patrol.noteLabel",
    "crew.patrol.optOut.reasonLabel",
  ];
  function messageAt(messages: unknown, path: string): unknown {
    let value = messages;
    for (const part of path.split(".")) {
      if (!value || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  }

  it.each(LOCALES)("provides complete recovery copy in %s", (locale) => {
    for (const path of paths) {
      const message = messageAt(bundledMessages[locale], path);
      expect(message, `${locale}: ${path}`).toBeTypeOf("string");
      expect(message, `${locale}: ${path}`).toMatch(/\S/);
      if (path.startsWith("managementRecovery.")) {
        expect(message, `${locale}: contextual section`).toContain("{section}");
      }
      if (path === "tutor.announcements.dismissedTitle") {
        expect(message, `${locale}: dismissed count`).toContain("{count}");
      }
    }
  });
});

it("keeps Coordinator decline requests distinct from direct decisions in every bundled catalog", () => {
  for (const locale of LOCALES) {
    const copy = bundledMessages[locale].legacySignupDecline;
    expect(copy.requestTitle, `${locale}: named request`).toContain("{name}");
    expect(copy.requestTitle, `${locale}: request title`).not.toBe(copy.title);
    expect(copy.requestConfirm, `${locale}: request action`).not.toBe(
      copy.confirm,
    );
    if (locale !== "zh") {
      expect(copy.requestConsequence).toContain("Admin or Head review");
      expect(copy.requestConsequence).toContain(
        "stay unchanged until approval",
      );
      expect(copy.requestConsequence).toContain("permanently closes");
      expect(copy.requestConsequence).toContain("history are retained");
    } else {
      expect(copy.requestConsequence).toContain("管理员或总负责人审核");
      expect(copy.requestConsequence).toContain(
        "获批前，此次报名和当前分配均保持不变",
      );
      expect(copy.requestConsequence).toContain("永久关闭");
      expect(copy.requestConsequence).toContain("历史记录将保留");
    }
  }
});
describe("bundled header translations", () => {
  it("provides every creation-risk gate and gallery message in all bundled locales", () => {
    // Bundled locales have no English fallback: the gate's safeguards and the
    // separate account-setup explanation must remain readable in every locale.
    for (const locale of LOCALES) {
      const copy = bundledMessages[locale].admin.creationRisk;
      for (const key of [
        "warning",
        "acknowledgement",
        "opensOnly",
        "cancel",
        "continue",
        "galleryTitle",
        "galleryHelp",
        "galleryKind",
        "galleryOpen",
        "galleryEditor",
        "galleryDraft",
        "galleryClose",
        "galleryTutor",
        "galleryTutee",
        "galleryPairing",
      ] as const) {
        expect(copy[key], `${locale}: creationRisk.${key}`).toMatch(/\S/);
      }
      for (const kind of ["tutor", "tutee", "pairing"] as const) {
        for (const key of ["title", "normal", "risk"] as const) {
          expect(
            copy[kind][key],
            `${locale}: creationRisk.${kind}.${key}`,
          ).toMatch(/\S/);
        }
      }
    }
  });

  it("provides scoped search, panel and save-boundary copy in all locales", () => {
    for (const locale of LOCALES) {
      const messages = bundledMessages[locale];
      for (const copy of [
        messages.rosterSearch.label,
        messages.rosterSearch.placeholder,
        messages.rosterSearch.clear,
        messages.rosterSearch.noMatches,
        messages.admin.pairings.searchTutees,
        messages.admin.announcements.create,
        messages.admin.adjustments.create,
        messages.tutor.settings.profileSyncFailed,
        ...Object.values(messages.admin.crew.panels),
        ...Object.values(messages.admin.program.panels),
        ...Object.values(messages.saveBoundary),
      ]) {
        expect(copy, `${locale}: required workflow copy`).toMatch(/\S/);
      }
      expect(messages.rosterSearch.results).toContain("{count}");
      expect(messages.rosterSearch.results).toContain("{total}");
      expect(messages.admin.pairings.selectedTutees).toContain("{count}");
      expect(messages.admin.pairings.removeSelected).toContain("{name}");
    }
  });

  it("names actionable work separately from dashboard destinations in every locale", () => {
    for (const locale of LOCALES) {
      const copy = bundledMessages[locale].tutor.tasks;
      for (const key of [
        "attention",
        "navigation",
        "emptyTasks",
        "interviewSection",
        "meetingSection",
        "qualificationSection",
      ] as const) {
        expect(copy[key], `${locale}: ${key}`).toMatch(/\S/);
      }
      expect(copy.unconfirmedCount).toContain("{count}");
      expect(copy.rosterCount).toContain("{count}");
      expect(copy.attention).not.toBe(copy.navigation);
    }
  });

  it("provides named pagination and current-page context in every locale", () => {
    for (const locale of LOCALES) {
      const copy = bundledMessages[locale].workflows;
      expect(copy.pagination, `${locale} pagination name`).toMatch(/\S/);
      expect(copy.page, `${locale} current-page argument`).toContain("{page}");
    }
  });

  it("keeps contextual field and request guidance discoverable in every locale", () => {
    for (const locale of LOCALES) {
      expect(bundledMessages[locale].signupFields.requirementsHelp).toMatch(
        /\S/,
      );
      expect(bundledMessages[locale].workflow.boardGuide).toMatch(/\S/);
      expect(bundledMessages[locale].workflow.sourceGuide).toMatch(/\S/);
    }
  });

  it("provides qualification direct-review and recovery copy in every bundled locale", () => {
    for (const locale of LOCALES) {
      const copy = bundledMessages[locale].qualificationRequests;
      for (const key of [
        "approveWithoutInterview",
        "reviewTitle",
        "reviewHelp",
        "reloadReview",
        "reloadHelp",
        "decisionSaved",
        "decisionRefreshFailed",
      ] as const) {
        expect(copy[key], `${locale}: ${key}`).toMatch(/\S/);
      }
    }
    expect(en.qualificationRequests.approveWithoutInterview).toBe(
      "Approve without Interview",
    );
    expect(en.qualificationRequests.approve).not.toBe(
      en.qualificationRequests.approveWithoutInterview,
    );
  });
  it("labels every persisted tutor status and the combine-account empty state", () => {
    // New historical states must render a readable label rather than a message key.
    for (const locale of LOCALES) {
      const messages = bundledMessages[locale];
      for (const status of Object.values(TutorStatus)) {
        expect(
          messages.admin.tutorStatus[status],
          `${locale}: ${status}`,
        ).toMatch(/\S/);
      }
      expect(
        messages.combineAccounts.noCandidates,
        `${locale}: empty combine list`,
      ).toMatch(/\S/);
    }
  });

  it("limits the viewer banner to permitted management summaries", () => {
    for (const locale of LOCALES) {
      expect(bundledMessages[locale].admin.readOnly.banner, locale).toMatch(
        /\S/,
      );
    }
    // Viewer accounts can still edit their own profile and exchange permitted messages.
    // The banner must describe the management area, not promise every page or ban every write.
    expect(en.admin.readOnly.banner).toContain("management access");
    expect(en.admin.readOnly.banner).toContain("permitted summaries");
    expect(en.admin.readOnly.banner).not.toMatch(
      /everything|can't make changes/,
    );
    expect(zh.admin.readOnly.banner).toContain("管理区域");
    expect(zh.admin.readOnly.banner).toContain("允许浏览");
    expect(zh.admin.readOnly.banner).not.toMatch(/全部内容|无法进行更改/);
  });

  it("keeps every configured locale aligned with the public mobile menu", () => {
    expect(Object.keys(bundledMessages).sort()).toEqual([...LOCALES].sort());

    for (const locale of LOCALES) {
      const messages = bundledMessages[locale];
      expect(messages.landing.nav.menu, `${locale} menu label`).toMatch(/\S/);
      expect(messages.common.language, `${locale} language label`).toMatch(
        /\S/,
      );
      expect(
        messages.workflow.policyScrollHint,
        `${locale} policy reading hint`,
      ).toMatch(/\S/);
    }
  });
});

describe("English heading and navigation capitalization", () => {
  it("capitalizes content words in title-style labels", () => {
    const minorWords = new Set([
      "a",
      "an",
      "and",
      "as",
      "at",
      "but",
      "by",
      "for",
      "from",
      "in",
      "into",
      "nor",
      "of",
      "on",
      "or",
      "over",
      "the",
      "to",
      "via",
      "with",
    ]);
    const errors: string[] = [];
    // These keys contain full sentences even though their names end in Title.
    const proseTitles = new Set([
      "landing.heroTitle",
      "admin.requests.banFlagTitle",
      "survey.savedTitle",
      "survey.reviewTitle",
    ]);
    // Some rendered h1–h4, tab, panel, nav, dialog and disclosure labels use
    // domain keys instead of *Title/*Heading.
    const sectionHeadings = new Set([
      "admin.tutees.addTutee",
      "nextRecruitment.tutor",
      "nextRecruitment.tutee",
      "courseGroups.import",
      "courseGroups.groups",
      "courseGroups.levels",
      "qualificationRequests.approved",
      "qualificationRequests.history",
      "qualificationRequests.submit",
      "workflow.current",
      "workflow.assignments",
      "workflow.participation",
      "workflow.navigation",
      "workflow.boardGuide",
      "workflow.reviewHistory",
      "workflow.sourceGuide",
      "tuteePortal.needHelp",
      "tuteePortal.navigation",
      "tuteePortal.weeklyArrangements",
      "messaging.rolePermissions",
      "messaging.userOverrides",
      "messaging.inbox",
      "messaging.supervision",
      "messaging.auditHistory",
      "messaging.privacyDetails",
      "workflows.send",
      "workflows.policy",
      "workflows.calendar",
      "workflows.support",
      "workflows.schedule",
      "workflows.interviewRecords",
      "corrections.patrolHistory",
      "tutor.workspace.label",
      "tutor.workspace.schedule",
      "tutor.workspace.pairings",
      "tutor.workspace.preferences",
      "tutor.workspace.history",
      "tutor.workspace.chair",
      "tutor.tasks.attention",
      "tutor.tasks.today",
      "tutor.schedulePage.preferences",
      "tutor.schedulePage.rooms",
      "tutor.schedulePage.interviews",
      "unifiedSchedule.agenda",
      "unifiedSchedule.interviewWork",
      "unifiedSchedule.meetingWork",
      "admin.crew.panels.review",
      "admin.crew.panels.roster",
      "admin.crew.panels.patrol",
      "admin.crew.originalApplication",
      "admin.crew.originalRequest",
      "admin.program.panels.period",
      "admin.program.panels.people",
      "admin.program.panels.communication",
      "admin.program.panels.access",
      "admin.program.features.name.CREW",
      "admin.program.features.name.DISCIPLINE",
      "admin.program.features.name.MEETINGS",
      "admin.program.features.name.INTERVIEWS",
      "admin.program.features.name.SERVICE_HOURS",
      "admin.program.features.name.QUARTER_SYSTEM",
      "admin.program.features.name.VIEWER_SIGNUP",
      "admin.program.features.name.EMAIL_2FA",
      "admin.program.features.name.AUTO_ASSIGN_ROOMS",
      "recordInspector.nav",
      "recordInspector.omitted",
      "recordInspector.persisted",
      "recordInspector.recordedEvidence",
      "recordInspector.reference",
      "recordInspector.schema",
      "notificationLocks.deliveryTab",
      "notificationLocks.requiredTab",
      "public.crewSignup.newApplication",
      "public.crewSignup.checkApplication",
      "roomSchedule.combined",
      "roomSchedule.individual",
      "sessionPlanning.week",
      "sessionPlanning.needsAttendance",
      "sessionPlanning.essentialNotices",
      "sessionPlanning.requests",
      "sessionPlanning.scheduleUnavailable",
      "sessionPlanning.suggestions",
      "sessionPlanning.arrangeException",
      "sessionPlanning.calendarSubscription",
      "sessionPlanning.review",
      "helpNav.downloads",
      "signupFields.form",
      "signupFields.requirementsHelp",
      "accountInvitation.addAccess",
      "accountProfile.editProfile",
      "meetingPeriods.outside",
      "meetingPeriods.history",
      "monthlyHours.deliveryHistory",
      "monthlyHours.history",
      "monthlyHours.recipients",
      "monthlyHours.settings",
      "schoolHours.history",
      "schoolHours.recipients",
      "schoolHours.settings",
      "recovery.preview",
      "recovery.receipt",
      "recovery.blockers",
      "recovery.effects",
      "recovery.technicalDetails",
      "recruitment.preview",
      "translationEditor.review",
      "tuteeHistory.tuteeHistory",
      "tuteeHistory.tutorHistory",
      "tuteeHistory.amendments",
      "tuteeHistory.meetings",
      "tuteeHistory.createAccount",
      "tutorDetails.subjects",
      "usersDirectory.attached",
      "usersDirectory.combinedPerson",
      "usersDirectory.historical",
      "usersDirectory.memberships",
      "usersDirectory.rolesParticipation",
      "usersDirectory.pathways",
    ]);

    // Audit all heading/title keys and navigation groups; prose and locale-specific
    // casing follow their own conventions. The supervision key is also an h1.
    function visit(messages: Record<string, unknown>, prefix = "") {
      for (const [key, value] of Object.entries(messages)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          visit(value as Record<string, unknown>, path);
          continue;
        }
        if (
          typeof value !== "string" ||
          proseTitles.has(path) ||
          !(
            /(^|\.)(?:title|heading|[^.]+(?:Title|Heading))$/.test(path) ||
            path.includes(".nav.") ||
            /\.(?:tabs|panels)\.[^.]+$/.test(path) ||
            sectionHeadings.has(path)
          )
        )
          continue;

        // ICU arguments are data, not words to capitalize in the message text.
        // Keep a placeholder token so minor words before trailing {args} are not misread as last words.
        const withPlaceholders = value.replace(/\{[^}]*\}/g, "PLACEHOLDER");
        const words = [
          ...withPlaceholders.matchAll(
            /(?:PLACEHOLDER(?:['’]s)?|[A-Za-z]+(?:['’][A-Za-z]+)?)/g,
          ),
        ].map(([word]) => word);
        if (
          words.some(
            (word, index) =>
              !word.startsWith("PLACEHOLDER") &&
              (index === 0 ||
                index === words.length - 1 ||
                !minorWords.has(word.toLowerCase())) &&
              /^[a-z]/.test(word),
          )
        )
          errors.push(`${path}: ${value}`);
      }
    }

    visit(en);
    expect(errors).toEqual([]);
    expect(en.messaging.supervision).toBe("Message Supervision");
    expect(en.signupFields.title).toBe("Signup Forms");
    expect(en.tutor.workspace.history).toBe("History & Hours");
    expect(en.tutor.workspace.chair).toBe("Interview Chair");
    expect(en.admin.crew.panels.patrol).toBe("Patrol Settings");
    expect(en.recordInspector.nav).toBe("Database Records");
  });
});

describe("copy quality and EN/ZH consistency regressions (#825-#828)", () => {
  it("contains no corrupted mojibake strings and fixes 2FA verifying punctuation", () => {
    function scan(obj: Record<string, unknown>, locale: string, prefix = "") {
      for (const [k, v] of Object.entries(obj)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") {
          expect(v, `${locale}:${p}`).not.toMatch(/\?{2,}|\uFFFD/);
        } else if (v && typeof v === "object" && !Array.isArray(v)) {
          scan(v as Record<string, unknown>, locale, p);
        }
      }
    }
    scan(en, "en");
    scan(zh, "zh");
    expect(en.auth.twoFactor.verifying).toBe("Verifying…");
    expect(zh.auth.twoFactor.title).toBe("验证码");
  });

  it("keeps attendance labels free of raw asterisks and provides new UI keys in every locale", () => {
    for (const locale of LOCALES) {
      const m = bundledMessages[locale];
      expect(m.tutor.attendance.comments).not.toMatch(/\*$/);
      expect(m.tutor.attendance.tutorAbsentReason).not.toMatch(/\*$/);
      expect(m.signupAppeal.action.trim()).not.toBe("");
      expect(m.messaging.privacyDetails.trim()).not.toBe("");
      expect(m.admin.nav.sections.dataRecovery.trim()).not.toBe("");
    }
  });

  it("keeps Chinese register and core vocabulary consistent", () => {
    const zhValues: string[] = [];
    const enValues: string[] = [];
    function collect(obj: Record<string, unknown>, out: string[]) {
      for (const v of Object.values(obj)) {
        if (typeof v === "string") out.push(v);
        else if (v && typeof v === "object" && !Array.isArray(v)) {
          collect(v as Record<string, unknown>, out);
        }
      }
    }
    collect(zh, zhValues);
    collect(en, enValues);
    for (const text of zhValues) {
      expect(text).not.toContain("您");
      expect(text).not.toContain("账户");
      expect(text).not.toContain("载入");
      expect(text).not.toMatch(/\bHEAD\b/);
    }
    for (const text of enValues) {
      expect(text).not.toMatch(/\bHEAD\b/);
    }
  });
});

describe("catalog regressions (#749, #769, #771, #774)", () => {
  it("pluralizes Service Hours hiddenInactive cleanly for singular and plural counts (#769)", () => {
    const tEn = createTranslator({ locale: "en", messages: en });
    expect(tEn("admin.summary.hiddenInactive", { count: 1 })).toBe(
      "1 inactive tutor with records is hidden by the status filter.",
    );
    expect(tEn("admin.summary.hiddenInactive", { count: 2 })).toBe(
      "2 inactive tutors with records are hidden by the status filter.",
    );
    for (const locale of LOCALES) {
      const t = createTranslator({ locale, messages: bundledMessages[locale] });
      expect(t("admin.summary.hiddenInactive", { count: 1 })).toContain("1");
      expect(t("admin.summary.hiddenInactive", { count: 3 })).toContain("3");
    }
  });

  it("clarifies Tutor Status Requests reentry review vs approval effect (#771)", () => {
    expect(en.admin.tutorRequests.help).toContain("one-week cooldown");
    expect(en.admin.tutorRequests.help).toContain("review reentry");
    expect(en.admin.tutorRequests.help).toContain("after approval");
    expect(en.admin.tutorRequests.help).not.toContain("reentry is immediate");
    expect(zh.admin.tutorRequests.help).toContain("一周冷静期");
    expect(zh.admin.tutorRequests.help).toContain("立即审核");
    expect(zh.admin.tutorRequests.help).toContain("审批通过后生效");
    expect(zh.admin.tutorRequests.help).not.toContain("立即生效");
  });

  it("provides distinct first-time calendar creation help and password-code delivery failure copy across all locales (#774, #749)", () => {
    for (const locale of LOCALES) {
      const m = bundledMessages[locale];
      expect(m.sessionPlanning.calendarCreateHelp.trim()).not.toBe("");
      expect(m.sessionPlanning.calendarCreateHelp).not.toBe(
        m.sessionPlanning.calendarRotateHelp,
      );
      expect(m.account.password.deliveryFailed.trim()).not.toBe("");
    }
    expect(zh.account.password.deliveryFailed).not.toMatch(/[A-Za-z]/);
  });
});
