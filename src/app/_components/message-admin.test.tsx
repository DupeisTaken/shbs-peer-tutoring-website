// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { MessageAdmin } from "./message-admin";
const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  moderate: vi.fn(),
  save: vi.fn(),
  restrict: vi.fn(),
  reset: vi.fn(),
  opened: false,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    messaging: {
      supervision: {
        useQuery: () => ({
          data: {
            more: false,
            rows: [
              {
                id: "m1",
                senderId: "a",
                recipientId: "b",
                sender: { name: "Sender", username: "sender" },
                recipient: { name: "Recipient", username: "recipient" },
                createdAt: new Date("2026-09-13T01:00:00Z"),
                hiddenAt: null,
              },
            ],
          },
          refetch: vi.fn(),
        }),
      },
      review: {
        useMutation: () => ({
          mutate: mocks.review,
          reset: mocks.reset,
          data: mocks.opened
            ? { id: "m1", body: "Original evidence", history: [] }
            : null,
        }),
      },
      moderate: { useMutation: () => ({ mutate: mocks.moderate }) },
      settings: {
        useQuery: () => ({
          data: [{ role: "STUDENT", groups: ["MANAGEMENT"] }],
          refetch: vi.fn(),
        }),
      },
      permissionUsers: {
        useQuery: () => ({
          data: {
            people: [
              { id: "a", name: "Alex", username: "alex", role: "STUDENT" },
            ],
            more: false,
          },
        }),
      },
      userPermission: {
        useQuery: () => ({
          data: { source: "ROLE", groups: ["MANAGEMENT"], restricted: false },
          refetch: vi.fn(),
        }),
      },
      setPermission: { useMutation: () => ({ mutate: mocks.save }) },
      restrict: { useMutation: () => ({ mutate: mocks.restrict }) },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.opened = false;
});
afterEach(cleanup);
const ui = () => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
    <MessageAdmin />
  </NextIntlClientProvider>
);
it("requires a reason to inspect content and sends moderation as a separate audited action", () => {
  const rendered = render(ui());
  expect(screen.queryByText("Original evidence")).toBeNull();
  const review = screen.getByRole<HTMLButtonElement>("button", {
    name: en.messaging.openReview,
  });
  expect(review.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: en.messaging.reason }), {
    target: { value: "Review a reported concern" },
  });
  fireEvent.click(review);
  expect(mocks.review).toHaveBeenCalledWith({
    id: "m1",
    reason: "Review a reported concern",
  });
  mocks.opened = true;
  rendered.rerender(ui());
  expect(screen.getByText("Original evidence")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.messaging.hide }));
  expect(mocks.moderate).toHaveBeenCalledWith({
    id: "m1",
    hide: true,
    reason: "Review a reported concern",
  });
});
it("shows effective user permissions, saves an empty override, and explicitly restores inheritance", () => {
  render(ui());
  fireEvent.click(
    screen.getByRole("button", { name: en.messaging.permissions }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Alex · @alex/ }));
  expect(
    screen.getByText("Effective permission source: role policy"),
  ).toBeTruthy();
  const form = screen
    .getByRole("heading", { name: en.messaging.effectivePermission })
    .closest("form")!;
  fireEvent.click(
    within(form).getByRole("checkbox", {
      name: en.messaging.groups.MANAGEMENT,
    }),
  );
  fireEvent.change(
    within(form).getByRole("textbox", { name: en.messaging.reason }),
    { target: { value: "Limit new contacts temporarily" } },
  );
  fireEvent.click(
    within(form).getByRole("button", { name: en.messaging.save }),
  );
  expect(mocks.save).toHaveBeenLastCalledWith({
    target: { type: "USER", userId: "a" },
    groups: [],
    reason: "Limit new contacts temporarily",
  });
  fireEvent.click(
    within(form).getByRole("button", { name: en.messaging.inherit }),
  );
  expect(mocks.save).toHaveBeenLastCalledWith({
    target: { type: "USER", userId: "a" },
    groups: null,
    reason: "Limit new contacts temporarily",
  });
});
