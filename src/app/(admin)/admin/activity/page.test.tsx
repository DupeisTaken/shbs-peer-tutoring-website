// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cleanup, render, screen, within } from "@testing-library/react";
import { parse } from "postcss";
import { compile } from "tailwindcss";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  summaryError: false,
  meError: false,
  featuresLoading: false,
  featuresError: false,
  disabledFeatureError: false,
  pendingRequests: 0,
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => "Asia/Shanghai",
  useFormatter: () => ({ dateTime: (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", ...options }).format(date) }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    account: {
      me: {
        useQuery: () =>
          state.meError
            ? { data: undefined, isLoading: false, error: new Error("account") }
            : { data: { role: "ADMIN" }, isLoading: false, error: null },
      },
    },
    admin: {
      activitySummary: {
        useQuery: () =>
          state.summaryError
            ? { data: undefined, isLoading: false, error: new Error("summary") }
            : {
                data: {
                  linkedTuteeIds: [],
                  intakeRows: [],
                  unverified: state.pendingRequests,
                  matching: 0,
                  studentReviews: 0,
                  studentAppeals: 0,
                  accountAppeals: 0,
                  translationDrafts: 0,
                  approvalRequests: 0,
                },
                isLoading: false,
                error: null,
              },
      },
      tutees: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      tutorApplications: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      disciplinaryCards: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: state.disabledFeatureError
            ? new Error("disabled discipline")
            : null,
        }),
      },
      sessions: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      tutorRequests: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      tuteeRemovalRequests: {
        useQuery: () => ({
          data: { pendingOptOuts: [] },
          isLoading: false,
          error: null,
        }),
      },
      sessionFlags: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: state.disabledFeatureError ? new Error("disabled crew") : null,
        }),
      },
      crewApplications: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: state.disabledFeatureError ? new Error("disabled crew") : null,
        }),
      },
      crewRequests: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: state.disabledFeatureError ? new Error("disabled crew") : null,
        }),
      },
    },
    program: {
      features: {
        useQuery: () => {
          if (state.featuresLoading)
            return { data: undefined, isLoading: true, error: null };
          if (state.featuresError)
            return {
              data: undefined,
              isLoading: false,
              error: new Error("features"),
            };
          return {
            data: { DISCIPLINE: false, CREW: false },
            isLoading: false,
            error: null,
          };
        },
      },
    },
  },
}));

import ActivityPage from "./page";

afterEach(() => {
  cleanup();
  state.summaryError = false;
  state.meError = false;
  state.featuresLoading = false;
  state.featuresError = false;
  state.disabledFeatureError = false;
  state.pendingRequests = 0;
});

it("does not claim all clear when the activity summary fails", () => {
  state.summaryError = true;
  render(<ActivityPage />);

  expect(screen.getByRole("alert").textContent).toContain(
    "admin.activity.hero.incompleteData",
  );
  expect(screen.queryByText("admin.activity.hero.allClear")).toBeNull();
  expect(screen.getByText("—")).toBeTruthy();
});

it.each([
  ["loading", true, false],
  ["error", false, true],
] as const)(
  "does not claim all clear while feature configuration is %s",
  (_stateName, featuresLoading, featuresError) => {
    state.featuresLoading = featuresLoading;
    state.featuresError = featuresError;
    render(<ActivityPage />);

    expect(screen.queryByText("admin.activity.hero.allClear")).toBeNull();
    if (featuresError) {
      expect(screen.getByRole("alert").textContent).toContain(
        "admin.activity.hero.incompleteData",
      );
    } else {
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("—")).toBeTruthy();
    }
  },
);

it("shows all clear for successful empty data even when disabled queues error", () => {
  state.disabledFeatureError = true;
  render(<ActivityPage />);

  expect(screen.getByText("admin.activity.hero.allClear")).toBeTruthy();
  expect(screen.getByText("0", { selector: "p" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("bounds the populated mobile hero grid without changing desktop columns or queue links", async () => {
  state.pendingRequests = 30;
  render(<ActivityPage />);
  const hero = screen.getByText("admin.activity.hero.title").closest("section")!;
  expect(within(hero).getByText("30", { selector: "p" })).toBeTruthy();
  expect(
    within(hero)
      .getByText("workflow.unverified")
      .closest("a")
      ?.getAttribute("href"),
  ).toBe("/admin/requests");

  // Compile classes from the rendered populated card. A zero-minimum track
  // allows the existing chart to fit; clipping the card would conceal the bug.
  // Real EN/ZH 390px/200% geometry remains a separate browser check.
  const require = createRequire(import.meta.url);
  const theme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
  const compiler = await compile(`${theme}\n@tailwind utilities;`);
  const output = parse(compiler.build([...hero.classList]));
  const columns: Record<string, string> = {};
  output.walkRules((rule) => {
    rule.walkDecls("grid-template-columns", (declaration) => {
      columns[rule.selector] = declaration.value;
    });
  });
  expect(columns[".grid-cols-1"]).toBe("repeat(1, minmax(0, 1fr))");
  expect(columns[".lg\\:grid-cols-5"]).toBe("repeat(5, minmax(0, 1fr))");
  const desktopMedia: string[] = [];
  output.walkRules(".lg\\:grid-cols-5", (rule) => {
    rule.walkAtRules("media", (media) => {
      desktopMedia.push(media.params);
    });
  });
  expect(desktopMedia).toContain("(width >= 64rem)");
  expect(hero.className).not.toMatch(/\boverflow-(hidden|clip)\b/);
});
