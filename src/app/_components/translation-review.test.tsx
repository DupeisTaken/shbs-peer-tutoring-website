// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TranslationReviewPageTarget } from "~/lib/page-title-reference";
import { TRANSLATION_PAGE_MISSING } from "~/lib/translation-review-errors";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const mocks = vi.hoisted(() => ({
  me: { role: "TUTOR", canTranslate: true },
  locale: null as "en" | "zh" | null,
  draft: {
    id: "draft",
    operation: "localization.setString",
    state: "PENDING",
    payload: {},
    pageTarget: null as TranslationReviewPageTarget | null,
    createdAt: new Date("2026-09-19"),
    updatedAt: new Date("2026-09-19"),
    needsResubmission: false,
  },
  mutate: vi.fn(),
  query: vi.fn(),
  error: null as null | { message: string },
  decisionError: null as null | { message: string },
  pending: false,
  onError: undefined as
    | undefined
    | ((
        error: { message?: string; data?: { approvalId?: string } },
        input: { id: string },
      ) => void),
}));
vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, string>) => {
      if (!mocks.locale) return key;
      const messages = mocks.locale === "zh" ? zh : en;
      let value: unknown = messages;
      for (const part of `${namespace}.${key}`.split("."))
        value = (value as Record<string, unknown>)[part];
      return Object.entries(values ?? {}).reduce(
        (text, [name, replacement]) => text.replace(`{${name}}`, replacement),
        String(value),
      );
    },
  useFormatter: () => ({ dateTime: () => "19 Sep 2026" }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: { me: { useQuery: () => ({ data: mocks.me }) } },
    translationReview: {
      list: {
        useQuery: (input: unknown) => {
          mocks.query(input);
          return { data: [mocks.draft], error: mocks.error };
        },
      },
      decide: {
        useMutation: (options: { onError: typeof mocks.onError }) => {
          mocks.onError = options.onError;
          return {
            mutate: mocks.mutate,
            isPending: mocks.pending,
            error: mocks.decisionError,
            variables: { id: "draft" },
          };
        },
      },
    },
    useUtils: () => ({
      translationReview: { list: { invalidate: vi.fn() } },
      localization: { strings: { invalidate: vi.fn() } },
      home: { invalidate: vi.fn() },
    }),
  },
}));
vi.mock("./student-portal", () => ({ Pager: () => null }));
import { TranslationReview } from "./translation-review";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mutate.mockReset();
  mocks.me = { role: "TUTOR", canTranslate: true };
  mocks.locale = null;
  mocks.draft.operation = "localization.setString";
  mocks.draft.state = "PENDING";
  mocks.draft.payload = {
    locale: "en",
    key: "common.save",
    value: "Synthetic translation",
  };
  mocks.draft.pageTarget = null;
  mocks.draft.needsResubmission = false;
  mocks.error = null;
  mocks.decisionError = null;
  mocks.pending = false;
});
it.each(["ADMIN", "HEAD"])(
  "allows %s review without granting editing",
  (role) => {
    mocks.me = { role, canTranslate: false };
    render(<TranslationReview />);
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", { name: "approve" }),
    );
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "draft",
      approve: true,
      expectedUpdatedAt: mocks.draft.updatedAt,
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "rejectDraft" }),
    ).toBeTruthy();
  },
);
it("offers Coordinators a request, never a publish/reject control, and links the queued outcome", () => {
  mocks.me = { role: "COORDINATOR", canTranslate: false };
  mocks.mutate.mockImplementation((input: { id: string }) =>
    mocks.onError?.({ data: { approvalId: "request-1" } }, input),
  );
  render(<TranslationReview />);
  expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "rejectDraft" })).toBeNull();
  fireEvent.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "requestApproval" }),
  );
  expect(screen.getByRole("status").textContent).toContain("requested");
  expect(
    screen.getByRole("link", { name: "viewRequest" }).getAttribute("href"),
  ).toBe("/admin/approvals?request=request-1");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "requestApproval",
    }).disabled,
  ).toBe(true);
});
it("shows assigned translators their draft without management actions", () => {
  render(<TranslationReview />);
  expect(screen.getByText("Synthetic translation")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "requestApproval" })).toBeNull();
});
it("keeps legacy evidence visible and blocks publication until resubmission", () => {
  mocks.me = { role: "ADMIN", canTranslate: false };
  mocks.draft.needsResubmission = true;
  render(<TranslationReview />);
  expect(screen.getByText("resubmit")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "approve" }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "rejectDraft" })
      .disabled,
  ).toBe(false);
});
it("filters historical drafts through the server and presents failed requests", () => {
  mocks.error = { message: "Review unavailable" };
  render(<TranslationReview />);
  fireEvent.change(screen.getByLabelText("filter"), {
    target: { value: "REJECTED" },
  });
  expect(mocks.query).toHaveBeenLastCalledWith({ page: 0, state: "REJECTED" });
  expect(screen.getByRole("alert").textContent).toBe("Review unavailable");
});

it("keeps failed publication feedback inside the affected draft", () => {
  mocks.me = { role: "ADMIN", canTranslate: false };
  mocks.decisionError = {
    message: "Destination changed; submit a fresh draft",
  };
  render(<TranslationReview />);
  expect(screen.getByRole("alert").closest("article")?.textContent).toContain(
    "Synthetic translation",
  );
});

it.each(["en", "zh"] as const)(
  "%s separates saved page identity from the proposed title without adding navigation rights",
  (locale) => {
    mocks.locale = locale;
    mocks.me = { role: "ADMIN", canTranslate: false };
    mocks.draft.operation = "home.setPageTitle";
    mocks.draft.payload = {
      id: "page-reference",
      locale: "zh",
      value: "完全不同的提议标题\n",
    };
    mocks.draft.pageTarget = {
      id: "page-reference",
      state: "current",
      title: { value: "Saved English page title", locale: "en" },
      address: "/p/saved-page",
    };
    render(<TranslationReview />);
    const labels = (locale === "zh" ? zh : en).translationEditor.pageTarget;
    expect(screen.getByText(labels.current)).toBeTruthy();
    expect(screen.getByText(labels.currentHelp)).toBeTruthy();
    expect(screen.getByText("Saved English page title")).toBeTruthy();
    expect(
      screen.getByText("Saved English page title").getAttribute("lang"),
    ).toBe("en");
    expect(
      screen.getByText(labels.fallbackLanguage.replace("{locale}", "en")),
    ).toBeTruthy();
    expect(screen.getByText("/p/saved-page")).toBeTruthy();
    expect(screen.getAllByText("page-reference")).toHaveLength(1);
    expect(screen.getByText("完全不同的提议标题")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: (locale === "zh" ? zh : en).workflows.approve,
      }),
    );
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "draft",
      approve: true,
      expectedUpdatedAt: mocks.draft.updatedAt,
    });
  },
);

it.each(["APPROVED", "REJECTED"])(
  "shows missing current targets alongside retained %s proposals",
  (state) => {
    mocks.locale = "en";
    mocks.me = { role: "ADMIN", canTranslate: false };
    mocks.draft.operation = "home.setPageTitle";
    mocks.draft.state = state;
    mocks.draft.payload = {
      id: "deleted-page",
      locale: "zh",
      value: "Retained proposal",
    };
    mocks.draft.pageTarget = {
      id: "deleted-page",
      state: "missing",
      title: null,
      address: null,
    };
    render(<TranslationReview />);
    expect(
      screen.getByText(en.translationEditor.pageTarget.missing),
    ).toBeTruthy();
    expect(screen.getByText("Retained proposal")).toBeTruthy();
    expect(screen.getByText("deleted-page")).toBeTruthy();
    expect(
      screen.queryByText(en.translationEditor.pageTarget.address),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: en.workflows.approve }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: en.workflows.rejectDraft }),
    ).toBeNull();
  },
);

it("keeps untitled current pages identifiable and legacy proposals blocked", () => {
  mocks.locale = "zh";
  mocks.me = { role: "COORDINATOR", canTranslate: false };
  mocks.draft.operation = "home.setPageTitle";
  mocks.draft.payload = {
    id: "untitled-page",
    locale: "zh",
    value: "提议标题",
  };
  mocks.draft.pageTarget = {
    id: "untitled-page",
    state: "current",
    title: null,
    address: "/p/untitled-page",
  };
  mocks.draft.needsResubmission = true;
  render(<TranslationReview />);
  expect(
    screen.getByText(zh.translationEditor.pageTarget.untitled),
  ).toBeTruthy();
  expect(screen.getByText("/p/untitled-page")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: zh.translationEditor.requestApproval,
    }).disabled,
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: zh.workflows.approve }),
  ).toBeNull();
});

it.each([
  ["en", "ADMIN"],
  ["zh", "ADMIN"],
  ["en", "HEAD"],
  ["zh", "HEAD"],
  ["en", "COORDINATOR"],
  ["zh", "COORDINATOR"],
] as const)(
  "%s gives %s recovery for a known deleted page without sending publication",
  (locale, role) => {
    const catalog = locale === "zh" ? zh : en;
    mocks.locale = locale;
    mocks.me = { role, canTranslate: false };
    mocks.draft.operation = "home.setPageTitle";
    mocks.draft.payload = {
      id: "deleted-page",
      locale: "zh",
      value: "Retained proposal",
    };
    mocks.draft.pageTarget = {
      id: "deleted-page",
      state: "missing",
      title: null,
      address: null,
    };
    render(<TranslationReview />);
    expect(
      screen.getByText(catalog.translationEditor.pageTarget.missingRecovery),
    ).toBeTruthy();
    const publish = screen.getByRole<HTMLButtonElement>("button", {
      name:
        role === "COORDINATOR"
          ? catalog.translationEditor.requestApproval
          : catalog.workflows.approve,
    });
    expect(publish.disabled).toBe(true);
    fireEvent.click(publish);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Retained proposal")).toBeTruthy();
    expect(screen.getByText("deleted-page")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    if (role === "COORDINATOR") {
      expect(
        screen.queryByRole("button", { name: catalog.workflows.rejectDraft }),
      ).toBeNull();
    } else {
      const reject = screen.getByRole<HTMLButtonElement>("button", {
        name: catalog.workflows.rejectDraft,
      });
      expect(reject.disabled).toBe(false);
      fireEvent.click(reject);
      expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({
        id: "draft",
        approve: false,
        expectedUpdatedAt: mocks.draft.updatedAt,
      });
    }
  },
);

it.each([
  ["en", "ADMIN"],
  ["zh", "ADMIN"],
  ["en", "COORDINATOR"],
  ["zh", "COORDINATOR"],
] as const)(
  "%s retains %s deletion recovery after the cached current-page read",
  (locale, role) => {
    const catalog = locale === "zh" ? zh : en;
    mocks.locale = locale;
    mocks.me = { role, canTranslate: false };
    mocks.draft.operation = "home.setPageTitle";
    mocks.draft.pageTarget = {
      id: "deleted-page",
      state: "current",
      title: { value: "Former saved title", locale: "en" },
      address: "/p/former-address",
    };
    mocks.mutate.mockImplementation((input: { id: string }) => {
      mocks.decisionError = { message: TRANSLATION_PAGE_MISSING };
      mocks.onError?.(mocks.decisionError, input);
    });
    const mounted = render(<TranslationReview />);
    const action =
      role === "COORDINATOR"
        ? catalog.translationEditor.requestApproval
        : catalog.workflows.approve;
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).toBe(
      catalog.translationEditor.pageTarget.missingRecovery,
    );
    expect(screen.queryByText(TRANSLATION_PAGE_MISSING)).toBeNull();
    expect(screen.queryByText("Former saved title")).toBeNull();
    expect(screen.queryByText("/p/former-address")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: action,
      }).disabled,
    ).toBe(true);
    if (role === "ADMIN")
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: catalog.workflows.rejectDraft,
        }).disabled,
      ).toBe(false);
    else
      expect(
        screen.queryByRole("button", { name: catalog.workflows.rejectDraft }),
      ).toBeNull();
    // Another decision can clear the mutation error without forgetting this deletion.
    mocks.decisionError = null;
    mounted.rerender(<TranslationReview />);
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(
      screen.getByText(catalog.translationEditor.pageTarget.missingRecovery),
    ).toBeTruthy();
  },
);

it("keeps current pages with no saved title eligible for a Coordinator request", () => {
  mocks.me = { role: "COORDINATOR", canTranslate: false };
  mocks.draft.operation = "home.setPageTitle";
  mocks.draft.pageTarget = {
    id: "untitled-page",
    state: "current",
    title: null,
    address: "/p/untitled-page",
  };
  render(<TranslationReview />);
  expect(screen.getByText("pageTarget.untitled")).toBeTruthy();
  const request = screen.getByRole<HTMLButtonElement>("button", {
    name: "requestApproval",
  });
  expect(request.disabled).toBe(false);
  fireEvent.click(request);
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({
    id: "draft",
    approve: true,
    expectedUpdatedAt: mocks.draft.updatedAt,
  });
});
