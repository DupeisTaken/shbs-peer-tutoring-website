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
    "translationEditor.refreshFailed",
    "admin.crew.originalApplication",
    "admin.crew.originalRequest",
    "actionReview.galleryRevokeScenario",
    "actionReview.galleryRevoke",
    "actionReview.galleryRevoked",
    "actionReview.galleryRestore",
    "admin.announcements.messageLabel",
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
    }
  });
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
    ]);
    // Some rendered h1–h3 labels use action or section keys instead of Title/Heading.
    const sectionHeadings = new Set([
      "admin.tutees.addTutee",
      "courseGroups.import",
      "qualificationRequests.approved",
      "qualificationRequests.history",
      "workflow.current",
      "workflow.assignments",
      "workflow.participation",
      "tuteePortal.needHelp",
      "messaging.rolePermissions",
      "messaging.userOverrides",
      "messaging.inbox",
      "messaging.supervision",
      "workflows.send",
      "workflows.policy",
      "workflows.calendar",
      "workflows.support",
      "workflows.schedule",
      "corrections.patrolHistory",
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
            sectionHeadings.has(path)
          )
        )
          continue;

        // ICU arguments are data, not words to capitalize in the message text.
        const words = [
          ...value
            .replace(/\{[^}]*\}/g, "")
            .matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g),
        ].map(([word]) => word);
        if (
          words.some(
            (word, index) =>
              index > 0 &&
              !minorWords.has(word.toLowerCase()) &&
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
  });
});
