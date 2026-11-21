import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpArticles, helpAudienceTitles, helpAudiences } from "./catalogue";
import {
  getHelpScreenshot,
  getStepCallouts,
  getStepCaptureViews,
  helpCaptureInfo,
  helpScreenshots,
  stepForCaptureView,
} from "./screenshots";
import type { HelpText } from "./types";
import { validateHelpCallouts } from "~/app/help/screenshot-annotations";

function requireBilingual(value: HelpText, context: string) {
  for (const locale of ["en", "zh"] as const) {
    expect(typeof value[locale], `${context}.${locale}`).toBe("string");
    expect(value[locale].trim().length, `${context}.${locale}`).toBeGreaterThan(
      1,
    );
  }
}

function pathname(route: string) {
  return new URL(route, "https://help.invalid").pathname;
}

describe("maintained help catalogue completeness", () => {
  it("has unique stable slugs and instructions for every defined audience", () => {
    const slugs = helpArticles.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const article of helpArticles) {
      expect(article.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(helpAudiences).toContain(article.audience);
    }
    for (const audience of helpAudiences) {
      requireBilingual(helpAudienceTitles[audience], `audience.${audience}`);
      expect(
        helpArticles.some((article) => article.audience === audience),
        audience,
      ).toBe(true);
    }
  });

  it.each(helpArticles.map((article) => [article.slug, article] as const))(
    "%s contains bilingual directions, recovery and inspectable sources",
    (_slug, article) => {
      requireBilingual(article.title, `${article.slug}.title`);
      requireBilingual(article.summary, `${article.slug}.summary`);
      requireBilingual(article.expected, `${article.slug}.expected`);
      expect(article.route, article.slug).toMatch(/^\/(?!\/)/);
      if (article.externalAction) {
        requireBilingual(
          article.externalAction.label,
          `${article.slug}.externalAction`,
        );
        const action = new URL(article.externalAction.href);
        expect(action.protocol).toBe("https:");
        expect(action.username || action.password || action.hash).toBe("");
      }
      expect(article.prerequisites.length, article.slug).toBeGreaterThan(0);
      expect(article.steps.length, article.slug).toBeGreaterThanOrEqual(3);
      expect(article.explanation.length, article.slug).toBeGreaterThan(0);
      expect(article.troubleshooting.length, article.slug).toBeGreaterThan(0);
      expect(article.sources.length, article.slug).toBeGreaterThan(0);
      expect(article.covers.length, article.slug).toBeGreaterThan(0);
      for (const [index, value] of article.prerequisites.entries()) {
        requireBilingual(value, `${article.slug}.prerequisites.${index}`);
      }
      for (const [index, step] of article.steps.entries()) {
        requireBilingual(step.title, `${article.slug}.steps.${index}.title`);
        requireBilingual(step.body, `${article.slug}.steps.${index}.body`);
        if (step.focus)
          requireBilingual(step.focus, `${article.slug}.steps.${index}.focus`);
      }
      for (const [index, value] of article.explanation.entries()) {
        requireBilingual(value, `${article.slug}.explanation.${index}`);
      }
      for (const [index, item] of article.troubleshooting.entries()) {
        requireBilingual(
          item.problem,
          `${article.slug}.troubleshooting.${index}.problem`,
        );
        requireBilingual(
          item.solution,
          `${article.slug}.troubleshooting.${index}.solution`,
        );
      }
      for (const source of article.sources) {
        expect(source, article.slug).toMatch(/^(?:src|docs)\//);
        expect(source, article.slug).not.toContain("..");
        expect(
          existsSync(join(process.cwd(), source)),
          `${article.slug}: ${source}`,
        ).toBe(true);
      }
      for (const related of article.related ?? []) {
        expect(related, article.slug).not.toBe(article.slug);
        expect(
          helpArticles.some((candidate) => candidate.slug === related),
          `${article.slug}: ${related}`,
        ).toBe(true);
      }
    },
  );

  it("covers production management navigation or an explicit shared-workflow alias", () => {
    // These real navigation entries deliberately reuse another maintained guide.
    // Keeping the alias list explicit makes a new module fail until its help exists.
    const aliases: Record<string, string[]> = {
      "/admin/activity": ["manage-daily-work"],
      "/admin/messages": ["send-private-messages"],
      "/admin/account": [
        "account-profile",
        "account-academics",
        "account-security",
        "account-emails",
      ],
      "/admin/interviews": ["manage-interview-panels"],
    };
    const navigation = readFileSync("src/app/_components/admin-nav.tsx", "utf8")
      .split("export const NAV_SECTIONS")[1]!
      .split("function makeVisible")[0]!;
    const destinations = new Set([
      ...[...navigation.matchAll(/href:\s*"([^"\n]+)"/g)].map((match) =>
        pathname(match[1]!),
      ),
      // The account shortcut lives in the shared header, and interviews is a retained redirect.
      "/admin/account",
      "/admin/interviews",
    ]);
    expect(destinations.size).toBeGreaterThan(30);
    for (const destination of destinations) {
      const exactGuide = helpArticles.some(
        (article) => pathname(article.route) === destination,
      );
      const aliasGuides = aliases[destination];
      expect(exactGuide || !!aliasGuides?.length, destination).toBe(true);
      for (const slug of aliasGuides ?? []) {
        expect(
          helpArticles.some((article) => article.slug === slug),
          `${destination}: ${slug}`,
        ).toBe(true);
      }
    }
  });

  it("keeps every walkthrough visual and prevents public links to management screenshots", () => {
    for (const article of helpArticles) {
      const steps = article.steps.filter((step) => step.screenshot);
      expect(steps.length, article.slug).toBeGreaterThan(0);
      for (const step of steps) {
        for (const { id, view } of getStepCaptureViews(step)) {
          expect(id, article.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
          const screenshot = getHelpScreenshot(id);
          expect(screenshot, `${article.slug}: ${id}`).toBeDefined();
          const callouts = getStepCallouts(
            stepForCaptureView(step, view),
            screenshot!,
          );
          expect(
            !!step.focus || callouts.length > 0,
            `${article.slug}: screenshot direction`,
          ).toBe(true);
          // Field labels can be a complete single character, such as 名 or 姓.
          // Use the rendering schema; guide prose retains its stricter check.
          expect(
            () => validateHelpCallouts(callouts),
            `${id}: callouts`,
          ).not.toThrow();
          if (article.audience === "public") {
            expect(id, article.slug).not.toMatch(/^admin-/);
            // Public onboarding explains the resulting participant workspace too.
            // Keep those synthetic examples explicit; management screens remain
            // outside the public guide asset allowlist.
            const publicOutcomeRoles: Record<string, string[]> = {
              "use-help-catalogue-step-1": ["STUDENT"],
              "request-tutoring-step-4": ["STUDENT"],
              "register-viewer-step-3": ["VIEWER"],
              "sign-in-recover-step-4": ["SUSPENDED"],
              "accept-invitation-step-4": [
                "STUDENT",
                "TUTOR",
                "CREW",
                "VIEWER",
              ],
            };
            const allowedRoles = [
              "GUEST",
              "PUBLIC",
              ...(article.slug === "use-school-report-link"
                ? ["SCHOOL_RECIPIENT"]
                : []),
              ...(publicOutcomeRoles[id.replace(/-view-\d+$/, "")] ?? []),
            ];
            // Capture receipts retain the camera's original role spelling.
            for (const locale of ["en", "zh"] as const) {
              const role = getHelpScreenshot(id, locale)?.role.toUpperCase();
              expect(
                allowedRoles,
                `${article.slug}: ${id} (${locale}) role`,
              ).toContain(role);
            }
          }
        }
      }
    }
  });

  it("binds screenshot records to real asset bytes and an explicit source revision", () => {
    expect(helpCaptureInfo.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(helpCaptureInfo.releaseRef.trim().length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(helpCaptureInfo.capturedAt))).toBe(true);
    const keys = helpScreenshots.map((shot) => `${shot.id}:${shot.locale}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const shot of helpScreenshots) {
      expect(shot.file).toMatch(/^[a-z0-9-]+\.(en|zh)\.jpg$/);
      expect(shot.file.endsWith(`.${shot.locale}.jpg`), shot.id).toBe(true);
      expect(shot.route, shot.id).toMatch(/^\/(?!\/)/);
      expect(shot.role.trim().length, shot.id).toBeGreaterThan(0);
      expect(shot.viewport.width, shot.id).toBeGreaterThan(0);
      expect(shot.viewport.height, shot.id).toBeGreaterThan(0);
      expect(Number.isFinite(Date.parse(shot.capturedAt)), shot.id).toBe(true);
      const bytes = readFileSync(join("docs/guides/help/assets", shot.file));
      expect(createHash("sha256").update(bytes).digest("hex"), shot.id).toBe(
        shot.sha256,
      );
    }
  });
});
