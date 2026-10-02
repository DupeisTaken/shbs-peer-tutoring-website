// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  cleanup,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { DepartureBanner, SchoolDeparturePanel } from "./school-departure";
import { ProfileDialog } from "./profile-dialog";

const fixture = vi.hoisted(() => ({
  data: {
    departure: { reason: "TRANSFERRED", revision: 2, observerRevoked: false },
    access: { canReadManagement: true },
    role: "STUDENT",
    events: [],
  },
  save: vi.fn(),
  request: vi.fn(),
  pending: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./management-actions", () => ({
  ManagementActions: () => <div>My requests</div>,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ invalidate: vi.fn() }),
    departure: {
      state: { useQuery: () => ({ data: fixture.data }) },
      setState: { useMutation: () => ({ mutate: fixture.save }) },
      request: {
        useMutation: () => ({
          mutate: fixture.request,
          isPending: fixture.pending,
        }),
      },
    },
  },
}));
const show = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  cleanup();
  fixture.save.mockClear();
  fixture.request.mockClear();
  fixture.pending = false;
  fixture.data.access.canReadManagement = true;
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});

it("keeps the parent editor and reason when cancelling the nested departure review", () => {
  const parentClose = vi.fn();
  show(
    <ProfileDialog title="Parent account" onClose={parentClose}>
      <SchoolDeparturePanel />
    </ProfileDialog>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Reason for review" }), {
    target: { value: "Moving to another school" },
  });
  const opener = screen.getByRole("button", { name: "Request change" });
  opener.focus();
  fireEvent.click(opener);
  const child = screen
    .getAllByRole("dialog")
    .find(
      (item) =>
        item.getAttribute("aria-labelledby") !==
        screen
          .getByRole("dialog", { name: "Parent account" })
          .getAttribute("aria-labelledby"),
    )!;
  fireEvent(child, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(parentClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Reason for review",
    }).value,
  ).toBe("Moving to another school");
  expect(document.activeElement).toBe(opener);
});

it("locks both review dismissal and parent draft controls during a departure request", () => {
  const parentClose = vi.fn();
  const content = (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ProfileDialog title="Parent account" onClose={parentClose}>
        <SchoolDeparturePanel />
      </ProfileDialog>
    </NextIntlClientProvider>
  );
  const view = render(content);
  fireEvent.change(screen.getByRole("textbox", { name: "Reason for review" }), {
    target: { value: "Moving away" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request change" }));
  fixture.pending = true;
  // Use a new element tree to propagate the independently owned mutation state.
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ProfileDialog title="Parent account" onClose={parentClose}>
        <SchoolDeparturePanel />
      </ProfileDialog>
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Reason for review",
    }).disabled,
  ).toBe(true);
  for (const dialog of screen.getAllByRole("dialog")) {
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close" })
        .disabled,
    ).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  }
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
  expect(fixture.request).not.toHaveBeenCalled();
  expect(parentClose).not.toHaveBeenCalled();
});

it("links transferred students to the viewer portal and preserves the history explanation", () => {
  show(<DepartureBanner />);
  expect(
    screen
      .getByRole("link", { name: "Enter viewer portal" })
      .getAttribute("href"),
  ).toBe("/admin");
  expect(screen.getByText(/records remain available/)).toBeTruthy();
});
it("withholds the link after observer access is revoked", () => {
  fixture.data.access.canReadManagement = false;
  show(<DepartureBanner />);
  expect(screen.queryByRole("link")).toBeNull();
});
it("requires a reason and consequence review before requesting a departure", () => {
  show(<SchoolDeparturePanel />);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Request change",
    }).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Reason for review" }), {
    target: { value: "Moving to a new school" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request change" }));
  expect(fixture.request).not.toHaveBeenCalled();
  expect(screen.getByText(/Current assignments are detached/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
  expect(fixture.request).toHaveBeenCalledWith({
    action: "TRANSFERRED",
    expectedRevision: 2,
    explanation: "Moving to a new school",
  });
  expect(
    screen.queryByRole("option", { name: "Restore viewer access" }),
  ).toBeNull();
});
