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
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import messages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { installSessionReadReceipts } from "~/lib/session-read-receipts";
import { settleRefreshes } from "~/lib/settle-refreshes";
import {
  DepartureBanner,
  SchoolDepartureAction,
  SchoolDeparturePanel,
} from "./school-departure";
import { ProfileDialog } from "./profile-dialog";

const fixture = vi.hoisted(() => ({
  data: {
    retired: false,
    departure: { reason: "TRANSFERRED", revision: 2, observerRevoked: false },
    access: { canReadManagement: true },
    role: "STUDENT",
    events: [] as Array<{ id: string; action: string; explanation: string }>,
  },
  save: vi.fn(),
  request: vi.fn(),
  saveReset: vi.fn(),
  requestReset: vi.fn(),
  invalidate: vi.fn(),
  pending: false,
  savePending: false,
  readError: null as null | { message: string; data?: { code: string } },
  saveError: null as null | { message: string; data?: { code?: string; approvalId?: string } },
  requestError: null as null | { message: string; data?: { code?: string } },
  refetch: vi.fn(),
  useStateQuery: undefined as
    | undefined
    | ((input: { userId?: string }) => unknown),
  saveCallbacks: undefined as
    | undefined
    | {
        onSuccess: () => Promise<void>;
        onError?: (error: { message: string; data?: { code?: string; approvalId?: string } }) => void;
        onSettled: () => void;
      },
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
    useUtils: () => ({ invalidate: fixture.invalidate }),
    departure: {
      state: {
        useQuery: (input: { userId?: string }) =>
          fixture.useStateQuery
            ? fixture.useStateQuery(input)
            : {
                data: fixture.data,
                error: fixture.readError,
                isSuccess: !fixture.readError && !!fixture.data,
                isFetching: false,
                refetch: fixture.refetch,
              },
      },
      setState: {
        useMutation: (callbacks: typeof fixture.saveCallbacks) => {
          fixture.saveCallbacks = callbacks;
          return {
            mutate: fixture.save,
            isPending: fixture.savePending,
            error: fixture.saveError,
            reset: fixture.saveReset,
          };
        },
      },
      request: {
        useMutation: (callbacks: typeof fixture.callbacks) => {
          fixture.callbacks = callbacks;
          return {
            mutate: fixture.request,
            isPending: fixture.pending,
            error: fixture.requestError,
            reset: fixture.requestReset,
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
  fixture.saveReset.mockReset();
  fixture.requestReset.mockReset();
  fixture.invalidate.mockReset().mockResolvedValue(undefined);
  fixture.pending = false;
  fixture.savePending = false;
  fixture.readError = null;
  fixture.useStateQuery = undefined;
  fixture.saveError = null;
  fixture.requestError = null;
  fixture.refetch.mockReset().mockImplementation(async () => ({
    isSuccess: true,
    data: fixture.data,
  }));
  fixture.data.access.canReadManagement = true;
  fixture.data.departure.revision = 2;
  fixture.data.retired = false;
  fixture.data.role = "STUDENT";
  fixture.data.departure.reason = "TRANSFERRED";
  fixture.data.departure.observerRevoked = false;
  fixture.data.events = [];
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

it.each(["en", "zh"] as const)(
  "opens a transfer request from the academic action without writing in %s",
  (locale) => {
    fixture.data.departure.reason = "";
    const copy = locale === "en" ? messages : zhMessages;
    show(
      <NextIntlClientProvider locale={locale} messages={copy}>
        <SchoolDepartureAction />
      </NextIntlClientProvider>,
    );
    const opener = screen.getByRole("button", {
      name: copy.schoolDeparture.reportTransfer,
    });
    expect(opener.className).toContain("btn-danger");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(opener);
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe(
      "TRANSFERRED",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: copy.schoolDeparture.reason }),
      { target: { value: "Moving schools" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: copy.schoolDeparture.request }),
    );
    expect(fixture.request).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: copy.schoolDeparture.confirm }),
    );
    expect(fixture.request).toHaveBeenCalledWith({
      action: "TRANSFERRED",
      explanation: "Moving schools",
      expectedRevision: 2,
    });
    expect(fixture.save).not.toHaveBeenCalled();
  },
);

it("keeps departure history and a return request reachable after confirmed departure", () => {
  show(<SchoolDepartureAction />);
  fireEvent.click(
    screen.getByRole("button", { name: messages.schoolDeparture.title }),
  );
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("RETURN");
  expect(screen.getByText(messages.schoolDeparture.requests)).toBeTruthy();
  expect(fixture.request).not.toHaveBeenCalled();
});

it("does not expose the self-report action to a Viewer", () => {
  fixture.data.role = "VIEWER";
  show(<SchoolDepartureAction />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("retains a transfer draft during a failed background read and recovers without submitting", async () => {
  fixture.data.departure.reason = "";
  const node = () => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <SchoolDepartureAction />
    </NextIntlClientProvider>
  );
  const view = render(node());
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.schoolDeparture.reportTransfer,
    }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Retained transfer reason" },
  });
  fixture.readError = { message: "Connection interrupted" };
  view.rerender(node());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Retained transfer reason",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.schoolDeparture.request,
    }).disabled,
  ).toBe(true);
  expect(fixture.request).not.toHaveBeenCalled();
  fixture.refetch.mockImplementation(async () => {
    fixture.readError = null;
    return { isSuccess: true, data: fixture.data };
  });
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: messages.participantRecovery.retry }),
    ),
  );
  view.rerender(node());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Retained transfer reason",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.schoolDeparture.request,
    }).disabled,
  ).toBe(false);
  expect(fixture.request).not.toHaveBeenCalled();
});

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
  expect(screen.getByText(messages.schoolDeparture.consequences)).toBeTruthy();
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

it.each(["en", "zh"] as const)(
  "provides explicit version-aware Reload after CONFLICT while keeping the reason draft in %s",
  async (locale) => {
    const copy = locale === "en" ? messages : zhMessages;
    fixture.data.role = "HEAD";
    fixture.data.departure.revision = 2;
    const content = () => (
      <NextIntlClientProvider locale={locale} messages={copy}>
        <SchoolDeparturePanel userId="target-user" />
      </NextIntlClientProvider>
    );
    const view = render(content());
    const reason = () =>
      screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: copy.schoolDeparture.reason,
      });
    // Preserve PR #746's full-width stacked field layout.
    expect(reason().closest(".grid")?.className).toBe("grid gap-3");
    fireEvent.change(reason(), { target: { value: "Confirmed transfer note" } });
    fireEvent.click(
      screen.getByRole("button", { name: copy.schoolDeparture.review }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: copy.schoolDeparture.confirm }),
    );
    expect(fixture.save).toHaveBeenCalledWith({
      userId: "target-user",
      action: "TRANSFERRED",
      expectedRevision: 2,
      explanation: "Confirmed transfer note",
    });
    fixture.saveError = {
      message: "Departure changed. Reload and review the current record.",
      data: { code: "CONFLICT" },
    };
    act(() => {
      fixture.saveCallbacks!.onSettled();
    });
    view.rerender(content());
    expect(screen.getByText(copy.schoolDeparture.reloadHelp)).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: copy.schoolDeparture.confirm,
      }).disabled,
    ).toBe(true);
    // Failed reload retains the draft and conflict state.
    fixture.refetch.mockRejectedValueOnce(new Error("temporary read outage"));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: copy.schoolDeparture.reload }),
      );
    });
    expect(screen.getByText(copy.schoolDeparture.readFailed)).toBeTruthy();
    expect(reason().value).toBe("Confirmed transfer note");
    // Successful reload adopts revision 5, keeps draft, closes stale confirmation.
    fixture.data.departure.revision = 5;
    fixture.saveReset.mockImplementation(() => {
      fixture.saveError = null;
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: copy.schoolDeparture.reload }),
      );
    });
    view.rerender(content());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reason().value).toBe("Confirmed transfer note");
    fireEvent.click(
      screen.getByRole("button", { name: copy.schoolDeparture.review }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: copy.schoolDeparture.confirm }),
    );
    expect(fixture.save).toHaveBeenLastCalledWith({
      userId: "target-user",
      action: "TRANSFERRED",
      expectedRevision: 5,
      explanation: "Confirmed transfer note",
    });
  },
);

it("recovers accepted saves and queued proposals with read-only Retry refresh without replaying writes", async () => {
  fixture.data.role = "HEAD";
  fixture.data.departure.revision = 2;
  const content = () => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <SchoolDeparturePanel userId="target-user" />
    </NextIntlClientProvider>
  );
  const view = render(content());
  fireEvent.change(
    screen.getByRole("textbox", { name: messages.schoolDeparture.reason }),
    { target: { value: "Graduating early" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.schoolDeparture.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.schoolDeparture.confirm }),
  );
  expect(fixture.save).toHaveBeenCalledTimes(1);
  fixture.invalidate.mockRejectedValueOnce(new Error("refresh failed"));
  await act(async () => {
    await fixture.saveCallbacks!.onSuccess();
    fixture.saveCallbacks!.onSettled();
  });
  view.rerender(content());
  expect(screen.getByText(messages.schoolDeparture.saved)).toBeTruthy();
  expect(screen.getByText(messages.schoolDeparture.refreshFailed)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.schoolDeparture.confirm,
    }).disabled,
  ).toBe(true);
  // Closing the confirmation keeps read-only Retry refresh available inline.
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(messages.schoolDeparture.refreshFailed)).toBeTruthy();
  fixture.data.departure.revision = 3;
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: messages.schoolDeparture.retryRefresh }),
    );
  });
  view.rerender(content());
  expect(fixture.save).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: messages.schoolDeparture.reason,
    }).value,
  ).toBe("");
});

it("conceals cached departure evidence on authoritative denial until retry succeeds", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  installSessionReadReceipts(client);
  fixture.data.events = [
    { id: "ev1", action: "TRANSFERRED", explanation: "Private departure reason" },
  ];
  const remote = vi
    .fn<() => Promise<typeof fixture.data>>()
    .mockResolvedValueOnce(fixture.data)
    .mockRejectedValueOnce(
      Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
    )
    .mockRejectedValueOnce(new Error("Network down"))
    .mockResolvedValue(fixture.data);
  const useLiveState = (input: { userId?: string }) =>
    useQuery({
      queryKey: [["departure", "state"], { input, type: "query" }],
      queryFn: () => remote(),
      retry: false,
    });
  fixture.useStateQuery = useLiveState;
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <SchoolDeparturePanel userId="target-user" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Private departure reason")).toBeTruthy();

  await act(async () => {
    await client.refetchQueries({ queryKey: [["departure", "state"]] });
  });
  expect(screen.queryByText("Private departure reason")).toBeNull();
  expect(screen.getByText(messages.schoolDeparture.accessDenied)).toBeTruthy();

  // Subsequent transport failure retains denial concealment.
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: messages.participantRecovery.retry }),
    );
  });
  expect(screen.queryByText("Private departure reason")).toBeNull();
  expect(screen.getByText(messages.schoolDeparture.accessDenied)).toBeTruthy();

  // A fresh post-denial authorized read releases concealment.
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: messages.participantRecovery.retry }),
    );
  });
  expect(await screen.findByText("Private departure reason")).toBeTruthy();
  client.clear();
});

it("reports active query GET failures through invalidateAndReport + settleRefreshes on a real QueryClient", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const okCalls = vi.fn().mockResolvedValue({ ok: true });
  const failingCalls = vi
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockRejectedValueOnce(new Error("variant GET failed"));
  await client.fetchQuery({ queryKey: ["departure", "ok"], queryFn: okCalls });
  await client.fetchQuery({
    queryKey: ["departure", "fail"],
    queryFn: failingCalls,
  });
  // Re-fetch both queries via invalidateQueries wrapped in invalidateAndReport.
  const target = {
    invalidate: (
      _input?: undefined,
      filters?: {
        predicate?: (query: {
          state: { errorUpdateCount: number; error: unknown };
        }) => boolean;
      },
      options?: { throwOnError?: boolean },
    ) =>
      client.invalidateQueries(
        {
          queryKey: ["departure"],
          refetchType: "all",
          predicate: filters?.predicate,
        },
        options,
      ),
  };
  await expect(
    settleRefreshes([() => invalidateAndReport(target)]),
  ).rejects.toThrow("variant GET failed");
  client.clear();
});
