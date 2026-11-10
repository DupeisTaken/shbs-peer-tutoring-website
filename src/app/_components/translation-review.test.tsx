// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { StaticTranslationQueryFixture } from "~/test/translation-query-bindings";

const mocks = vi.hoisted(() => ({
  queries: undefined as StaticTranslationQueryFixture | undefined,
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
  invalidate: vi.fn(),
  originFetch: vi.fn(),
  refetch: vi.fn(),
  onSuccess: undefined as
    | undefined
    | ((result: { ok: true }, input: { id: string }) => Promise<void>),
  onSettled: undefined as undefined | (() => void),
  onError: undefined as
    | undefined
    | ((
        error: { data: { approvalId: string } },
        input: { id: string },
      ) => void | Promise<void>),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "19 Sep 2026" }),
}));
vi.mock("~/trpc/react", async () => {
  const { createStaticTranslationQueryFixture } =
    await import("~/test/translation-query-bindings");
  const queries = createStaticTranslationQueryFixture();
  mocks.queries = queries;
  const review = queries.read(
    "translationReview.list",
    () => ({ data: [mocks.draft], error: mocks.error }),
    ["PENDING", "APPROVED", "REJECTED", undefined].map((state) => ({
      page: 0,
      state,
    })),
    mocks.refetch,
  );
  return {
    api: {
      account: {
        me: queries.read(
          "account.me",
          () => ({ data: mocks.me }),
          [undefined],
          mocks.refetch,
        ),
      },
      translationReview: {
        list: {
          ...review,
          useQuery: (input: unknown) => {
            mocks.query(input);
            return review.useQuery(input);
          },
        },
        decide: {
          useMutation: (options: {
            onError: typeof mocks.onError;
            onSuccess: typeof mocks.onSuccess;
            onSettled: typeof mocks.onSettled;
          }) => {
            mocks.onError = options.onError;
            mocks.onSuccess = options.onSuccess;
            mocks.onSettled = options.onSettled;
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
        translationReview: {
          list: { invalidate: mocks.invalidate, fetch: mocks.originFetch },
        },
        localization: { strings: { invalidate: mocks.invalidate } },
        home: { invalidate: mocks.invalidate },
      }),
    },
  };
});
vi.mock("./student-portal", () => ({ Pager: () => null }));
import { TranslationReview } from "./translation-review";

afterEach(() => {
  cleanup();
  mocks.queries!.client.clear();
});
function render(ui: ReactNode) {
  mocks.queries!.prepare();
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={mocks.queries!.client}>
      {children}
    </QueryClientProvider>
  );
  const view = rtlRender(wrap(ui));
  return {
    ...view,
    rerender: (next: ReactNode) => {
      act(() => {
        mocks.queries!.prepare();
        view.rerender(wrap(next));
      });
    },
  };
}
beforeEach(() => {
  mocks.queries!.reset();
  vi.clearAllMocks();
  mocks.me = { role: "TUTOR", canTranslate: true };
  mocks.draft.needsResubmission = false;
  mocks.error = null;
  mocks.decisionError = null;
  mocks.pending = false;
  mocks.mutate.mockReset();
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.originFetch.mockResolvedValue([]);
  mocks.refetch.mockResolvedValue(undefined);
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
it("offers Coordinators a request, never a publish/reject control, and links the queued outcome", async () => {
  mocks.me = { role: "COORDINATOR", canTranslate: false };
  let settlement: Promise<void> | undefined;
  mocks.mutate.mockImplementation((input: { id: string }) => {
    settlement = Promise.resolve(
      mocks.onError?.({ data: { approvalId: "request-1" } }, input),
    ).finally(() => mocks.onSettled?.());
  });
  render(<TranslationReview />);
  expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "rejectDraft" })).toBeNull();
  await act(async () => {
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "requestApproval",
      }),
    );
    await settlement;
  });
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

it("admits only one same-turn decision for a draft", () => {
  mocks.me = { role: "ADMIN", canTranslate: false };
  render(<TranslationReview />);
  fireEvent.click(screen.getByRole("button", { name: "approve" }));
  fireEvent.click(screen.getByRole("button", { name: "rejectDraft" }));
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
});

it("keeps an accepted decision blocked and recovers failed synchronization with reads only", async () => {
  mocks.me = { role: "ADMIN", canTranslate: false };
  mocks.invalidate.mockRejectedValue(
    new Error("Synthetic accepted review refresh failed"),
  );
  render(<TranslationReview />);
  fireEvent.click(screen.getByRole("button", { name: "approve" }));
  await act(async () => {
    await mocks.onSuccess!({ ok: true }, { id: "draft" });
    mocks.onSettled!();
  });
  expect(screen.getByText("acceptedRefreshFailed")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "approve" }).disabled,
  ).toBe(true);
  expect(mocks.originFetch).toHaveBeenCalledWith(
    { page: 0, state: "PENDING" },
    { staleTime: 0 },
  );
  fireEvent.change(screen.getByLabelText("filter"), {
    target: { value: "ALL" },
  });
  mocks.invalidate.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(mocks.originFetch).toHaveBeenLastCalledWith(
    { page: 0, state: "PENDING" },
    { staleTime: 0 },
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "approve" }).disabled,
  ).toBe(true);
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
});

it("retains permitted cached history and offers read-only retry when a background read fails", async () => {
  mocks.error = { message: "Synthetic unavailable review" };
  render(<TranslationReview />);
  expect(screen.getByText("Synthetic translation")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "retryRead" }));
  await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2));
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("conceals denied cached evidence through later transport errors and manual success until a fresh read", async () => {
  mocks.error = Object.assign(new Error("Denied review"), {
    data: { code: "FORBIDDEN" },
  });
  const { rerender } = render(<TranslationReview />);
  expect(screen.queryByText("Synthetic translation")).toBeNull();
  expect(screen.getByText("noAccess")).toBeTruthy();
  mocks.error = { message: "Later transport failure" };
  rerender(<TranslationReview />);
  expect(screen.queryByText("Synthetic translation")).toBeNull();
  mocks.error = null;
  rerender(<TranslationReview />);
  expect(screen.queryByText("Synthetic translation")).toBeNull();
  await act(async () => {
    await mocks.queries!.refresh("translationReview.list", {
      page: 0,
      state: "PENDING",
    });
  });
  await waitFor(() =>
    expect(screen.getByText("Synthetic translation")).toBeTruthy(),
  );
});
