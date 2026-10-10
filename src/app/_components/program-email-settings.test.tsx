/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { ProgramEmailSettings } from "./program-email-settings";

type ChannelState = "READY" | "UNAVAILABLE" | "UNCONFIGURED" | "LOCAL";
const mock = vi.hoisted(() => ({
  settings: undefined as
    | undefined
    | {
        enabled: boolean;
        secondaryEmailBindingEnabled: boolean;
        canEdit: boolean;
        canApply?: boolean;
        deliveryAvailable: boolean;
        failed: number;
      },
  settingsError: null as Error | null,
  status: undefined as
    | undefined
    | {
        channels: {
          category: "SECURITY" | "PROGRAM";
          state: ChannelState;
          checkedAt: Date;
        }[];
        retrying: number;
        failed: number;
      },
  statusError: null as Error | null,
  fetching: false,
  pending: false,
  saveError: null as { message: string; data?: { approvalId?: string } } | null,
  refetch: vi.fn(),
  settingsRefetch: vi.fn(),
  mutate: vi.fn(),
  binding: vi.fn(),
  query: vi.fn(),
  resend: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      program: { emailNotificationSettings: { invalidate: vi.fn() } },
      account: { emailSettings: { invalidate: vi.fn() } },
    }),
    program: {
      resendStuckEmails: {
        useMutation: () => ({ mutateAsync: mock.resend, isPending: false }),
      },
      emailNotificationSettings: {
        useQuery: () => ({
          data: mock.settings,
          error: mock.settingsError,
          isFetching: false,
          refetch: mock.settingsRefetch,
        }),
      },
      emailDeliveryStatus: {
        useQuery: (...args: unknown[]) => {
          mock.query(...args);
          return {
            data: mock.status,
            error: mock.statusError,
            isFetching: mock.fetching,
            refetch: mock.refetch,
          };
        },
      },
      setEmailNotifications: {
        useMutation: () => ({ mutate: mock.mutate, isPending: mock.pending, error: mock.saveError }),
      },
      setSecondaryEmailBinding: {
        useMutation: () => ({ mutate: mock.binding, isPending: mock.pending }),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.settings = {
    enabled: false,
    secondaryEmailBindingEnabled: true,
    canEdit: true,
    deliveryAvailable: true,
    failed: 0,
  };
  mock.settingsError = null;
  mock.status = {
    channels: [
      {
        category: "SECURITY",
        state: "READY",
        checkedAt: new Date("2026-10-09T03:00:00Z"),
      },
      {
        category: "PROGRAM",
        state: "READY",
        checkedAt: new Date("2026-10-09T03:00:00Z"),
      },
    ],
    retrying: 0,
    failed: 0,
  };
  mock.statusError = null;
  mock.fetching = false;
  mock.pending = false;
  mock.saveError = null;
  mock.refetch.mockImplementation(() =>
    Promise.resolve({ isSuccess: true, data: mock.status }),
  );
  mock.resend.mockResolvedValue({ queued: 1 });
});
afterEach(cleanup);
function content(chinese = false) {
  return (
    <NextIntlClientProvider
      locale={chinese ? "zh" : "en"}
      messages={chinese ? zh : en}
      timeZone="Asia/Shanghai"
    >
      <input aria-label="Other program draft" defaultValue="Unchanged draft" />
      <ProgramEmailSettings />
    </NextIntlClientProvider>
  );
}

// Diagnostics and operational retry survive the governance merge: an Admin's
// setting request stays unapplied and must not appear as a failed save.
it.each([false, true])("retains mail diagnostics and direct retry alongside a pending Admin setting request (Chinese=%s)", (chinese) => {
  mock.settings!.canApply = false;
  mock.status!.failed = 1;
  mock.saveError = { message: "Approval queued", data: { approvalId: "email-request" } };
  render(content(chinese));
  const messages = chinese ? zh : en;
  expect(screen.getByText(messages.approvals.queuedBody)).toBeTruthy();
  expect(screen.getByText(messages.programEmail.channel.SECURITY)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: messages.programEmail.resendStuck }).disabled).toBe(false);
  expect(screen.getByRole("checkbox", { name: messages.approvals.requestChange.replace("{setting}", messages.programEmail.enable) })).toBeTruthy();
  expect(screen.queryByText("Approval queued")).toBeNull();
  expect(screen.queryByText(messages.programEmail.saved)).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Other program draft" }).value).toBe("Unchanged draft");
});

it.each([false, true])(
  "warns for a broken security sender even when optional mail is disabled (Chinese=%s)",
  (chinese) => {
    mock.status!.channels[0]!.state = "UNAVAILABLE";
    render(content(chinese));
    const messages = (chinese ? zh : en).programEmail;
    expect(screen.getByText(messages.transport.UNAVAILABLE)).toBeTruthy();
    expect(screen.getByText(messages.channel.SECURITY)).toBeTruthy();
    expect(screen.getByText(messages.deliveryHelp)).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: messages.enable })
        .checked,
    ).toBe(false);
  },
);

it.each(["UNCONFIGURED", "LOCAL"] as const)(
  "distinguishes %s from a successful SMTP check",
  (state) => {
    mock.status!.channels.forEach((channel) => {
      channel.state = state;
    });
    render(content());
    expect(screen.getAllByText(en.programEmail.transport[state])).toHaveLength(
      2,
    );
    expect(screen.queryByText(en.programEmail.transport.READY)).toBeNull();
  },
);

it("shows retrying and exhausted deliveries separately even when SMTP authentication passes", () => {
  mock.status!.retrying = 3;
  mock.status!.failed = 2;
  render(content());
  expect(
    screen.getByText(en.programEmail.retrying.replace("{count}", "3")),
  ).toBeTruthy();
  expect(
    screen.getByText(en.programEmail.failed.replace("{count}", "2")),
  ).toBeTruthy();
  expect(screen.getAllByText(en.programEmail.transport.READY)).toHaveLength(2);
});

it("loads diagnostics with bounded foreground polling and no automatic retry storm", () => {
  mock.status = undefined;
  mock.fetching = true;
  render(content());
  expect(screen.getByRole("status").textContent).toContain(
    en.programEmail.checking,
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.programEmail.checking,
    }).disabled,
  ).toBe(true);
  expect(mock.query).toHaveBeenCalledWith(undefined, {
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
});

it.each([false, true])(
  "initial diagnostic failure is unknown and recoverable (Chinese=%s)",
  (chinese) => {
    mock.status = undefined;
    mock.statusError = new Error("private transport detail");
    render(content(chinese));
    const messages = (chinese ? zh : en).programEmail;
    expect(screen.getByRole("alert").textContent).toBe(messages.statusFailed);
    expect(screen.queryByText(messages.checking)).toBeNull();
    expect(screen.queryByText("private transport detail")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: messages.refreshStatus }),
    );
    expect(mock.refetch).toHaveBeenCalledOnce();
  },
);

it("keeps cached results and unrelated drafts visible during failure, then recovers without a write", async () => {
  const view = render(content());
  fireEvent.change(screen.getByLabelText("Other program draft"), {
    target: { value: "Keep edited draft" },
  });
  mock.statusError = new Error("network unavailable");
  view.rerender(content());
  expect(screen.getByRole("alert").textContent).toBe(
    en.programEmail.statusStale,
  );
  expect(screen.getAllByText(en.programEmail.transport.READY)).toHaveLength(2);
  fireEvent.click(
    screen.getByRole("button", { name: en.programEmail.refreshStatus }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  mock.statusError = null;
  view.rerender(content());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Keep edited draft",
  );
  expect(mock.mutate).not.toHaveBeenCalled();
  expect(mock.binding).not.toHaveBeenCalled();
});

it("admits one refresh before React disables its button", async () => {
  let resolve!: (value: object) => void;
  mock.refetch.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(content());
  const button = screen.getByRole("button", {
    name: en.programEmail.refreshStatus,
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.refetch).toHaveBeenCalledOnce();
  await act(async () => {
    resolve({ isSuccess: true, data: mock.status });
  });
  fireEvent.click(button);
  expect(mock.refetch).toHaveBeenCalledTimes(2);
});

it("leaves a coordinator's diagnostic reads available without exposing setting writes", () => {
  mock.settings!.canEdit = false;
  render(content());
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.programEmail.refreshStatus }),
  );
  expect(mock.refetch).toHaveBeenCalledOnce();
  expect(mock.mutate).not.toHaveBeenCalled();
  expect(mock.binding).not.toHaveBeenCalled();
});

it("does not mount diagnostics before an authorized settings result and recovers settings errors", () => {
  mock.settings = undefined;
  mock.settingsError = new Error("FORBIDDEN");
  render(content());
  expect(mock.query).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain(
    en.programEmail.settingsFailed,
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.programEmail.retrySettings }),
  );
  expect(mock.settingsRefetch).toHaveBeenCalledOnce();
});

it("preserves toggle payloads and freezes cached controls after a failed settings read", () => {
  const view = render(content());
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.programEmail.enable }),
  );
  expect(mock.mutate).toHaveBeenCalledWith({
    enabled: true,
    expectedEnabled: false,
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.programEmail.bindingEnable }),
  );
  expect(mock.binding).toHaveBeenCalledWith({
    enabled: false,
    expectedEnabled: true,
  });
  mock.settingsError = new Error("stale settings");
  view.rerender(content());
  for (const control of screen.getAllByRole<HTMLInputElement>("checkbox"))
    expect(control.disabled).toBe(true);
  expect(
    within(screen.getByRole("alert")).getByRole("button", {
      name: en.programEmail.retrySettings,
    }),
  ).toBeTruthy();
});

it.each([false, true])(
  "queues an explicit batch and reports queued, not delivered (Chinese=%s)",
  async (chinese) => {
    mock.status!.failed = 4;
    mock.resend.mockResolvedValue({ queued: 4 });
    render(content(chinese));
    const messages = (chinese ? zh : en).programEmail;
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Preserve this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.resendStuck }));
    await waitFor(() =>
      expect(
        screen.getByText(messages.resendQueued.replace("{count}", "4")),
      ).toBeTruthy(),
    );
    expect(mock.resend).toHaveBeenCalledExactlyOnceWith();
    expect(mock.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
      "Preserve this draft",
    );
    expect(mock.mutate).not.toHaveBeenCalled();
    expect(mock.binding).not.toHaveBeenCalled();
  },
);

it("holds admission through the write and status synchronization", async () => {
  mock.status!.failed = 2;
  let finishWrite!: (value: { queued: number }) => void;
  let finishRead!: (value: object) => void;
  mock.resend.mockReturnValue(
    new Promise((resolve) => {
      finishWrite = resolve;
    }),
  );
  mock.refetch.mockReturnValue(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  render(content());
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: en.programEmail.resendStuck,
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mock.resend).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(true);
  await act(async () => {
    finishWrite({ queued: 2 });
  });
  expect(button.disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.programEmail.refreshStatus,
    }).disabled,
  ).toBe(true);
  await act(async () => {
    finishRead({ isSuccess: true, data: mock.status });
  });
  expect(button.disabled).toBe(false);
  expect(mock.resend).toHaveBeenCalledOnce();
});

it.each(["result", "throw"])(
  "keeps accepted batch locked after %s read failure; recovery never replays it",
  async (failure) => {
    mock.status!.failed = 1;
    if (failure === "throw")
      mock.refetch.mockRejectedValueOnce(new Error("network failed"));
    else
      mock.refetch.mockResolvedValueOnce({
        isSuccess: false,
        data: mock.status,
        error: new Error("network failed"),
      });
    render(content());
    fireEvent.click(
      screen.getByRole("button", { name: en.programEmail.resendStuck }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(en.programEmail.resendRefreshFailed),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(en.programEmail.resendQueued.replace("{count}", "1")),
    ).toBeTruthy();
    expect(screen.queryByText(en.programEmail.resendFailed)).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.programEmail.resendStuck,
      }).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: en.programEmail.resendStuck }),
    );
    expect(mock.resend).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: en.programEmail.refreshStatus }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(en.programEmail.resendRefreshFailed),
      ).toBeNull(),
    );
    expect(mock.resend).toHaveBeenCalledOnce();
    expect(mock.refetch).toHaveBeenCalledTimes(2);
    // Another batch is deliberate and possible only after the successful read.
    fireEvent.click(
      screen.getByRole("button", { name: en.programEmail.resendStuck }),
    );
    await waitFor(() => expect(mock.resend).toHaveBeenCalledTimes(2));
  },
);

it("reports zero eligible emails without claiming a send", async () => {
  mock.status!.retrying = 2;
  mock.resend.mockResolvedValue({ queued: 0 });
  render(content());
  fireEvent.click(
    screen.getByRole("button", { name: en.programEmail.resendStuck }),
  );
  await waitFor(() =>
    expect(screen.getByText(en.programEmail.resendNone)).toBeTruthy(),
  );
  expect(mock.refetch).toHaveBeenCalledOnce();
});

it("allows retry after a rejected write without treating it as accepted", async () => {
  mock.status!.failed = 1;
  mock.resend.mockRejectedValueOnce(new Error("internal database detail"));
  render(content());
  fireEvent.click(
    screen.getByRole("button", { name: en.programEmail.resendStuck }),
  );
  await waitFor(() =>
    expect(screen.getByText(en.programEmail.resendFailed)).toBeTruthy(),
  );
  expect(mock.refetch).not.toHaveBeenCalled();
  expect(screen.queryByText("internal database detail")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.programEmail.resendStuck }),
  );
  await waitFor(() =>
    expect(
      screen.getByText(en.programEmail.resendQueued.replace("{count}", "1")),
    ).toBeTruthy(),
  );
  expect(mock.resend).toHaveBeenCalledTimes(2);
});

it("hides resend for read-only staff and disables it without trustworthy queue/settings data", () => {
  mock.settings!.canEdit = false;
  const view = render(content());
  expect(
    screen.queryByRole("button", { name: en.programEmail.resendStuck }),
  ).toBeNull();
  mock.settings!.canEdit = true;
  view.rerender(content());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.programEmail.resendStuck,
    }).disabled,
  ).toBe(true);
  mock.status!.failed = 1;
  mock.settingsError = new Error("settings read failed");
  view.rerender(content());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.programEmail.resendStuck,
    }).disabled,
  ).toBe(true);
  mock.settingsError = null;
  mock.statusError = new Error("status read failed");
  view.rerender(content());
  fireEvent.click(
    screen.getByRole("button", { name: en.programEmail.resendStuck }),
  );
  expect(mock.resend).not.toHaveBeenCalled();
});
