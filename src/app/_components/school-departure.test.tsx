// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";
import { DepartureBanner, SchoolDeparturePanel } from "./school-departure";
import { ProfileDialog } from "./profile-dialog";

const fixture = vi.hoisted(() => ({
  data: {
    retired: false,
    departure: { reason: "TRANSFERRED", revision: 2, observerRevoked: false },
    access: { canReadManagement: true },
    role: "STUDENT",
    events: [],
  },
  save: vi.fn(),
  request: vi.fn(),
  refetch: vi.fn(),
  pending: false,
  callbacks: undefined as
    | undefined
    | {
        onSuccess: () => Promise<void>;
        onSettled: () => void;
      },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./management-actions", () => ({
  ManagementActions: () => <div>My requests</div>,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ invalidate: vi.fn() }),
    departure: {
      state: {
        _def: () => ({ path: ["departure", "state"] }),
        useQuery: () => ({
          data: fixture.data,
          error: null,
          isLoading: false,
          isFetching: false,
          isSuccess: true,
          dataUpdatedAt: 1,
          errorUpdatedAt: 0,
          refetch: fixture.refetch,
        }),
      },
      setState: {
        useMutation: () => ({
          mutate: fixture.save,
          reset: vi.fn(),
          isPending: false,
        }),
      },
      request: {
        useMutation: (callbacks: typeof fixture.callbacks) => {
          fixture.callbacks = callbacks;
          return {
            mutate: fixture.request,
            isPending: fixture.pending,
            reset: vi.fn(),
          };
        },
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
  fixture.refetch
    .mockReset()
    .mockImplementation(async () => ({ data: fixture.data, isSuccess: true }));
  fixture.callbacks = undefined;
  fixture.pending = false;
  fixture.data.access.canReadManagement = true;
  fixture.data.departure.revision = 2;
  fixture.data.retired = false;
  fixture.data.role = "STUDENT";
  fixture.data.departure.reason = "TRANSFERRED";
  fixture.data.departure.observerRevoked = false;
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

it.each(["en", "zh"] as const)(
  "offers only factual RETURN for a retired original to staff in %s",
  (locale) => {
    fixture.data.retired = true;
    fixture.data.role = "HEAD";
    fixture.data.departure.observerRevoked = true;
    const copy = locale === "en" ? messages : zhMessages;
    render(
      <NextIntlClientProvider locale={locale} messages={copy}>
        <SchoolDeparturePanel userId="retired-original" />
      </NextIntlClientProvider>,
    );
    const select = screen.getByRole<HTMLSelectElement>("combobox");
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      "RETURN",
    ]);
    expect(select.value).toBe("RETURN");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Verified factual return; keep login retired" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: copy.schoolDeparture.review }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: copy.schoolDeparture.confirm }),
    );
    expect(fixture.save).toHaveBeenCalledWith({
      userId: "retired-original",
      action: "RETURN",
      expectedRevision: 2,
      explanation: "Verified factual return; keep login retired",
    });
    expect(fixture.request).not.toHaveBeenCalled();
  },
);

it.each(["COORDINATOR", "STUDENT"])(
  "does not let %s submit a retired-source return",
  (role) => {
    fixture.data.retired = true;
    fixture.data.role = role;
    show(<SchoolDeparturePanel userId="retired-original" />);
    expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(true);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").disabled).toBe(
      true,
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.schoolDeparture.request,
      }).disabled,
    ).toBe(true);
    expect(fixture.save).not.toHaveBeenCalled();
  },
);

it("keeps a returned retired source read-only instead of offering another capability change", () => {
  fixture.data.retired = true;
  fixture.data.role = "ADMIN";
  fixture.data.departure.reason = "";
  show(<SchoolDeparturePanel userId="retired-original" />);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.schoolDeparture.review,
    }).disabled,
  ).toBe(true);
  expect(
    Array.from(
      screen.getByRole<HTMLSelectElement>("combobox").options,
      (option) => option.value,
    ),
  ).toEqual(["RETURN"]);
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

it("keeps a completed review mounted while its write is pending, then clears the reason and adopts the refreshed revision", async () => {
  const content = () => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ProfileDialog title="Parent account" onClose={vi.fn()}>
        <SchoolDeparturePanel />
      </ProfileDialog>
    </NextIntlClientProvider>
  );
  const view = render(content());
  const reason = () =>
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Reason for review",
    });
  fireEvent.change(reason(), { target: { value: "Moving to a new school" } });
  fireEvent.click(screen.getByRole("button", { name: "Request change" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
  fixture.pending = true;
  view.rerender(content());
  fixture.data.departure.revision = 3;
  await act(async () => {
    await fixture.callbacks!.onSuccess();
  });
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  expect(reason().value).toBe("Moving to a new school");
  fixture.pending = false;
  act(() => {
    fixture.callbacks!.onSettled();
  });
  view.rerender(content());
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(reason().value).toBe("");
  fireEvent.change(reason(), { target: { value: "Another reviewed change" } });
  fireEvent.click(screen.getByRole("button", { name: "Request change" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
  expect(fixture.request).toHaveBeenLastCalledWith({
    action: "TRANSFERRED",
    expectedRevision: 3,
    explanation: "Another reviewed change",
  });
});

it("gives another departure target a fresh reason and review", () => {
  const content = (userId: string) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <SchoolDeparturePanel userId={userId} />
    </NextIntlClientProvider>
  );
  const view = render(content("first"));
  fireEvent.change(screen.getByRole("textbox", { name: "Reason for review" }), {
    target: { value: "First person's reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request change" }));
  view.rerender(content("second"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Reason for review",
    }).value,
  ).toBe("");
  expect(fixture.save).not.toHaveBeenCalled();
});
