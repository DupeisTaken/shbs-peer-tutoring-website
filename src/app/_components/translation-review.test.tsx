// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  me: { role: "TUTOR", canTranslate: true },
  draft: {
    id: "draft",
    operation: "localization.setString",
    state: "PENDING",
    payload: {
      locale: "en",
      key: "common.save",
      value: "Synthetic translation",
    },
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
        error: { data: { approvalId: string } },
        input: { id: string },
      ) => void),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  mocks.me = { role: "TUTOR", canTranslate: true };
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
