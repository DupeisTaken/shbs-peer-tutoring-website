// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  summaryError: false,
  meError: false,
  featuresLoading: false,
  featuresError: false,
  disabledFeatureError: false,
}));

vi.mock("next-intl", () => ({
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
                  unverified: 0,
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
