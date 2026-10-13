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
import { MessageAdmin, MessagePermissions } from "./message-admin";
import { SessionViewProvider } from "./session-view-state";
import { viewStateKey, writeViewState } from "~/lib/session-view-state";
const mocks = vi.hoisted(() => ({
  role: "HEAD",
  review: vi.fn(),
  moderate: vi.fn(),
  save: vi.fn(),
  restrict: vi.fn(),
  reset: vi.fn(),
  opened: false,
  more: false,
  supervision: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    account: { me: { useQuery: () => ({ data: { role: mocks.role } }) } },
    messaging: {
      supervision: {
        useQuery: (input: unknown) => { mocks.supervision(input); return ({
          data: {
            more: mocks.more,
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
        }); },
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
          data: [
            { role: "STUDENT", groups: ["MANAGEMENT"] },
            { role: "TUTOR", groups: ["MANAGEMENT"] },
          ],
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
  window.sessionStorage.clear();
  vi.clearAllMocks();
  mocks.opened = false;
  mocks.more = false;
});
afterEach(cleanup);
const ui = () => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
    <MessageAdmin />
  </NextIntlClientProvider>
);

it("restores visibility and public-list pagination while private message search pages and reasons stay transient", () => {
  const key = viewStateKey("head", "/admin/messages/supervision", "message-supervision.page.v1", "");
  writeViewState(window.sessionStorage, key, 2);
  writeViewState(window.sessionStorage, viewStateKey("head", "/admin/messages/supervision", "message-supervision.visibility.v1", ""), "HIDDEN");
  const tree = () => <SessionViewProvider identity="head" pathname="/admin/messages/supervision" verified>{ui()}</SessionViewProvider>;
  mocks.more = true;
  const page = render(tree());
  expect(mocks.supervision).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, visibility: "HIDDEN", search: "" }));
  fireEvent.change(screen.getByRole("textbox", { name: en.messaging.supervisionSearch }), { target: { value: "Private report text" } });
  fireEvent.change(screen.getByRole("textbox", { name: en.messaging.reason }), { target: { value: "Private moderation reason" } });
  fireEvent.click(screen.getByRole("button", { name: en.messaging.next }));
  expect(mocks.supervision).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: "Private report text" }));
  expect(window.sessionStorage.getItem(key)).toBe("0");
  expect(JSON.stringify(window.sessionStorage)).not.toMatch(/Private report text|Private moderation reason/);
  page.unmount();
  render(tree());
  expect(mocks.supervision).toHaveBeenLastCalledWith(expect.objectContaining({ page: 0, visibility: "HIDDEN", search: "" }));
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: en.messaging.reason }).value).toBe("");
});
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
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MessagePermissions />
    </NextIntlClientProvider>,
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
it("shares role authority copy once while retaining independent role drafts and the user editor notice", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MessagePermissions />
    </NextIntlClientProvider>,
  );
  expect(screen.getAllByText(en.approvals.sensitiveHelp)).toHaveLength(1);
  const student = screen
    .getByRole("heading", { name: en.admin.users.roles.STUDENT })
    .closest("form")!;
  const tutor = screen
    .getByRole("heading", { name: en.admin.users.roles.TUTOR })
    .closest("form")!;
  fireEvent.change(
    within(student).getByRole("textbox", { name: en.messaging.reason }),
    { target: { value: "Student-only draft" } },
  );
  expect(
    within(tutor).getByRole<HTMLInputElement>("textbox", {
      name: en.messaging.reason,
    }).value,
  ).toBe("");
  fireEvent.click(screen.getByRole("button", { name: /Alex · @alex/ }));
  expect(screen.getAllByText(en.approvals.sensitiveHelp)).toHaveLength(2);
  expect(
    within(student).getByRole<HTMLInputElement>("textbox", {
      name: en.messaging.reason,
    }).value,
  ).toBe("Student-only draft");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("retains the review reason on refresh and links to its relocated permission configuration", () => {
  const view = render(ui());
  fireEvent.change(screen.getByRole("textbox", { name: en.messaging.reason }), {
    target: { value: "Retain this audit context" },
  });
  view.rerender(ui());
  expect(
    screen
      .getByRole("link", { name: en.messaging.permissionsDestination })
      .getAttribute("href"),
  ).toBe("/admin/program?panel=people");
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: en.messaging.reason })
      .value,
  ).toBe("Retain this audit context");
});

it("disables significant messaging permission drafts for Coordinators", () => {
  mocks.role = "COORDINATOR";
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MessagePermissions />
    </NextIntlClientProvider>,
  );
  for (const button of screen.getAllByRole<HTMLButtonElement>("button", {
    name: en.messaging.save,
  })) {
    expect(button.closest("fieldset")?.disabled).toBe(true);
    fireEvent.submit(button.closest("form")!);
  }
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.role = "HEAD";
});
