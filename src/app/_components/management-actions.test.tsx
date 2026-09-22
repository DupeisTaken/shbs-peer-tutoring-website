/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import SuperJSON from "superjson";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ManagementActions } from "./management-actions";

const mocks = vi.hoisted(() => ({
  params: "",
  list: vi.fn(),
  cancel: vi.fn(),
  decide: vi.fn(),
  refetch: vi.fn(),
  requesters: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.params),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    approval: {
      list: { useQuery: mocks.list },
      requesters: { useQuery: mocks.requesters },
      decide: {
        useMutation: (options: { onSuccess: () => void }) => ({
          mutate: (value: unknown) => {
            mocks.decide(value);
            options.onSuccess();
          },
        }),
      },
      cancel: {
        useMutation: (options: { onSuccess: () => void }) => ({
          mutate: (value: unknown) => {
            mocks.cancel(value);
            options.onSuccess();
          },
        }),
      },
    },
  },
}));

const row = (state = "PENDING") => ({
  id: "request-1",
  operation: "admin.updateRoom",
  requesterId: "coordinator",
  requesterName: "Alex Coordinator",
  state,
  createdAt: new Date("2026-09-12T00:00:00Z"),
  reviewedAt: state === "PENDING" ? null : new Date("2026-09-13T00:00:00Z"),
  reviewerName: state === "CANCELLED" ? null : "Morgan Admin",
  reviewNote:
    state === "PENDING" || state === "CANCELLED" ? null : "Booking checked.",
  payload: SuperJSON.serialize({ id: "room-1", name: "New room name" }),
  targets: { rooms: [{ record: { id: "room-1", name: "Original room" } }] },
});
function queue(rows = [row()], canReview = false, total = rows.length, headReviewer = false) {
  mocks.list.mockReturnValue({
    data: {
      rows,
      canReview,
      headReviewer,
      total,
      viewerId: canReview && !headReviewer ? "admin" : "coordinator",
      requesters: canReview
        ? [{ id: "coordinator", label: "Alex Coordinator" }]
        : [],
    },
    refetch: mocks.refetch,
  });
}
function view(reviewer = false, locale = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "en" ? en : zh}
    >
      <ManagementActions reviewer={reviewer} />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = "";
  mocks.refetch.mockResolvedValue({});
  queue();
});
afterEach(cleanup);

it("restores linked filters and makes the banner's full-list URL reset older pages", () => {
  mocks.params = "status=REJECTED&page=1";
  queue([row("REJECTED")], false, 30);
  const rendered = render(view());
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: "REJECTED", page: 1 }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Approved" }),
  );
  expect(mocks.replace).toHaveBeenCalledWith(
    "/admin/approvals?status=APPROVED",
    { scroll: false },
  );
  mocks.params = "status=all";
  rendered.rerender(view());
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: undefined, page: 0 }),
  );
});

it("shows coordinator history and proposed/affected records without privileged requester queries", () => {
  render(view());
  expect(
    screen.getByRole("heading", { name: "Management Actions" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "All Statuses" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getAllByText("Original room")).toHaveLength(2);
  expect(screen.getByText("New room name")).toBeTruthy();
  expect(screen.getByText(/Not applied — awaiting/)).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(mocks.requesters).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Withdraw Request" }));
  expect(mocks.cancel).toHaveBeenCalledWith({ id: "request-1" });
  expect(mocks.refetch).toHaveBeenCalled();
});

it("shows reviewer filters and refreshes after a decision", () => {
  queue([row()], true);
  render(view(true));
  expect(
    screen
      .getByRole("button", { name: "Pending Review" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "coordinator" },
  });
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ requesterId: "coordinator", page: 0 }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Checked evidence" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve and Apply" }));
  expect(mocks.decide).toHaveBeenCalledWith({
    id: "request-1",
    approve: true,
    note: "Checked evidence",
  });
  expect(mocks.refetch).toHaveBeenCalled();
});

it("resets pagination/filters for a detail link and returns to the full list", () => {
  queue([row()], true, 26);
  const rendered = render(view(true));
  fireEvent.click(screen.getByRole("button", { name: "Older" }));
  expect(mocks.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1 }),
  );
  mocks.params = "request=request-1";
  rendered.rerender(view(true));
  expect(mocks.list).toHaveBeenLastCalledWith({
    requestId: "request-1",
    page: 0,
    requesterId: undefined,
    state: undefined,
  });
  expect(screen.queryByRole("button", { name: "Older" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "All Requests" }).getAttribute("href"),
  ).toBe("/admin/approvals?status=all");
  mocks.params = "status=all";
  rendered.rerender(view(true));
  expect(
    screen
      .getByRole("button", { name: "All Statuses" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

it.each(["APPROVED", "REJECTED", "CANCELLED"])(
  "shows %s history, including withdrawal time without a reviewer note",
  (state) => {
    queue([row(state)]);
    render(view());
    expect(
      screen.getByText(
        state === "APPROVED"
          ? /Applied when approved/
          : state === "REJECTED"
            ? /Not applied — rejected/
            : /Not applied — withdrawn/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Withdraw Request" }),
    ).toBeNull();
    expect(
      screen.getByText(
        state === "CANCELLED"
          ? /Withdrawn by Alex Coordinator/
          : /Morgan Admin ·/,
      ),
    ).toBeTruthy();
  },
);

it("renders localized loading, error and unavailable detail states", () => {
  mocks.list.mockReturnValue({ isLoading: true });
  const rendered = render(view(false, "zh"));
  expect(screen.getByRole("status").textContent).toBe("正在加载…");
  mocks.list.mockReturnValue({
    error: new Error("Try again"),
    refetch: mocks.refetch,
  });
  rendered.rerender(view(false, "zh"));
  expect(screen.getByRole("alert").textContent).toBe("Try again");
  mocks.params = "request=missing";
  queue([]);
  rendered.rerender(view(false, "zh"));
  expect(screen.getByText(zh.approvals.missingHint)).toBeTruthy();
});

it.each([true, false])("only shows self-review controls for a live Head: %s", (headReviewer) => {
  queue([{ ...row(), requesterId: headReviewer ? "coordinator" : "admin" }], true, 1, headReviewer);
  render(view(true));
  expect(screen.queryByRole("button", { name: "Approve and Apply" }) !== null).toBe(headReviewer);
});
