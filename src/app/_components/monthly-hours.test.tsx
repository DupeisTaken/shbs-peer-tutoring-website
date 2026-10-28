/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { MonthlyHoursPanel } from "./monthly-hours-panel";
import { MonthlyHoursReport } from "./monthly-hours-report";
import { ReadOnlyProvider } from "./read-only";

const remote = vi.hoisted(() => ({
  settings: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  generate: vi.fn(),
  report: vi.fn(),
  csv: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => [["monthlyHours"]] }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const read = (name: "settings" | "preview" | "report") => ({
    useQuery: (input: unknown, options: { enabled?: boolean } = {}) =>
      useQuery({
        queryKey: [["monthlyHours", name], { input, type: "query" }],
        queryFn: () => remote[name](input) as Promise<unknown>,
        ...options,
      }),
  });
  return {
    api: {
      useUtils: () => ({ monthlyHours: { csv: { fetch: remote.csv } } }),
      monthlyHours: {
        settings: read("settings"),
        preview: read("preview"),
        report: read("report"),
        save: { useMutation: () => ({ mutateAsync: remote.save }) },
        generate: { useMutation: () => ({ mutateAsync: remote.generate }) },
        retry: { useMutation: () => ({ mutateAsync: remote.retry }) },
      },
    },
  };
});
let client: QueryClient;
const timestamp = new Date("2026-09-03T01:00:00Z");
const config = {
  enabled: true,
  recipientUserIds: ["head"],
  dayOfMonth: 3,
  localTime: "09:00",
  timeZone: "Asia/Shanghai",
  version: 1,
  firstReportMonth: "2026-08",
  nextDueAt: timestamp,
};
const rows = [
  {
    tutorId: "one",
    englishName: "Same Name",
    active: true,
    sessions: 1,
    adjustmentCount: 0,
    earned: 0,
    extras: 0,
    punishments: 0,
    total: 0,
  },
  {
    tutorId: "two",
    englishName: "Same Name",
    active: false,
    sessions: 0,
    adjustmentCount: 1,
    earned: 0,
    extras: 0,
    punishments: 2,
    total: -2,
  },
];
const totals = {
  tutors: 2,
  sessions: 1,
  earned: 0,
  extras: 0,
  punishments: 2,
  total: -2,
};
const recipients = [
  {
    userId: "head",
    name: "Synthetic Head",
    role: "HEAD",
    email: "head@example.test",
    status: "QUEUED",
    reason: null,
  },
];
const summary = {
  id: "report-one",
  month: "2026-08",
  revision: 1,
  generatedAt: timestamp,
  dueAt: timestamp,
  timeZone: "Asia/Shanghai",
  configVersion: 1,
  reason: null,
  status: "FAILED",
  deliveryCounts: {
    queued: 0,
    retrying: 0,
    sending: 0,
    sent: 0,
    failed: 1,
    skipped: 0,
    blocked: 0,
  },
};
const settings = () => ({
  config: { ...config, recipientUserIds: [...config.recipientUserIds] },
  staff: [
    {
      userId: "head",
      name: "Synthetic Head",
      role: "HEAD",
      emailInfo: true,
      addresses: [{ email: "head@example.test", primary: true }],
      eligible: true,
      reason: null,
    },
  ],
  programTimeZone: "Asia/Shanghai",
  serviceHoursEnabled: true,
  optionalEmailEnabled: true,
  transportAvailable: true,
  canEdit: true,
  canApply: true,
  canGenerate: true,
  recentReports: [summary],
  lastGenerationError: null,
});
const preview = () => ({
  month: "2026-08",
  generatedAt: timestamp,
  timeZone: "Asia/Shanghai",
  configVersion: 1,
  latestRevision: 0,
  contentHash: "a".repeat(64),
  rows,
  totals,
  recipients,
});
const report = () => ({
  ...summary,
  contentHash: "a".repeat(64),
  rows,
  totals,
  intendedRecipients: recipients,
  deliveries: [
    {
      id: "delivery",
      userId: "head",
      recipient: "head@example.test",
      status: "PENDING",
      attempts: 2,
      lastError: "diagnostic",
      completedAt: null,
      availableAt: timestamp,
    },
  ],
});
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  vi.clearAllMocks();
  remote.settings.mockResolvedValue(settings());
  remote.preview.mockResolvedValue(preview());
  remote.report.mockResolvedValue(report());
  remote.csv.mockResolvedValue({
    filename: "stored-report.csv",
    content: "stored report contents",
  });
  remote.save.mockResolvedValue({ config: { ...config, version: 2 } });
  remote.generate.mockResolvedValue({
    reportId: "report-two",
    revision: 1,
    queued: 1,
    blocked: 0,
    skipped: 0,
  });
  remote.retry.mockResolvedValue({ queued: 1 });
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
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function show(
  element = <MonthlyHoursPanel />,
  readOnly = false,
  locale: "en" | "zh" = "en",
) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        timeZone="Asia/Shanghai"
        messages={locale === "zh" ? zh : en}
      >
        <ReadOnlyProvider value={readOnly}>{element}</ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
async function openPanel() {
  await screen.findByText(
    new RegExp(`${en.monthlyHours.title} · ${en.monthlyHours.enabled}`),
  );
  const details = document.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByLabelText(en.monthlyHours.enable);
}
async function previewReport() {
  fireEvent.change(screen.getByLabelText(en.monthlyHours.reportMonth), {
    target: { value: "2026-08" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.preview }),
  );
  await screen.findByRole("table", { name: en.monthlyHours.snapshot });
}
async function refreshSettings() {
  await act(async () => {
    await client.refetchQueries({ queryKey: [["monthlyHours", "settings"]] });
  });
}

it("waits for both UTC accounting and schedule-local month closure at the calendar boundary", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // In UTC+14 the local date is already November, but October's UTC bucket
  // still accepts records. September remains the last eligible report month.
  vi.setSystemTime(new Date("2026-10-31T10:30:00Z"));
  remote.settings.mockResolvedValue({
    ...settings(),
    config: { ...config, timeZone: "Pacific/Kiritimati" },
  });
  const view = render(show());
  await openPanel();
  const picker = screen.getByLabelText<HTMLInputElement>(
    en.monthlyHours.reportMonth,
  );
  expect(picker.value).toBe("2026-09");
  expect(picker.max).toBe("2026-09");
  fireEvent.change(picker, { target: { value: "2026-10" } });
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.monthlyHours.preview,
    }).disabled,
  ).toBe(true);
  view.unmount();
  vi.setSystemTime(new Date("2026-11-01T00:01:00Z"));
  render(show());
  await openPanel();
  expect(
    screen.getByLabelText<HTMLInputElement>(en.monthlyHours.reportMonth).value,
  ).toBe("2026-10");
});

it("keeps the roster panel collapsed, reports status, and excludes viewers from all monthly reads", async () => {
  const view = render(show());
  const summaryLabel = await screen.findByText(
    new RegExp(`${en.monthlyHours.title} · ${en.monthlyHours.enabled}`),
  );
  expect(summaryLabel.textContent).toContain(
    en.monthlyHours.selectedStaffCount.replace("{count}", "1"),
  );
  expect(summaryLabel.textContent).toContain(
    en.monthlyHours.lastOutcome.replace(
      "{status}",
      en.monthlyHours.status.FAILED,
    ),
  );
  expect(summaryLabel.textContent).toContain(en.monthlyHours.attention);
  expect(document.querySelector("details")!.open).toBe(false);
  expect(screen.queryByLabelText(en.monthlyHours.enable)).toBeNull();
  expect(remote.preview).not.toHaveBeenCalled();
  view.unmount();
  vi.clearAllMocks();
  render(show(<MonthlyHoursPanel />, true));
  expect(screen.queryByText(new RegExp(en.monthlyHours.title))).toBeNull();
  expect(remote.settings).not.toHaveBeenCalled();
});

it("previews complete zero/negative/same-name records without writes, and invalidates preview after an edit", async () => {
  render(show());
  await openPanel();
  await previewReport();
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getAllByText(/Same Name/)).toHaveLength(2);
  expect(within(table).getByText("-2")).toBeTruthy();
  expect(remote.generate).not.toHaveBeenCalled();
  expect(remote.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(en.monthlyHours.day), {
    target: { value: "4" },
  });
  expect(screen.queryByRole("table")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.monthlyHours.preview,
    }).disabled,
  ).toBe(true);
});

it("retains rejected drafts, detects changed versions and reloads only on an explicit read", async () => {
  render(show());
  await openPanel();
  fireEvent.change(screen.getByLabelText(en.monthlyHours.day), {
    target: { value: "4" },
  });
  remote.save.mockRejectedValue(new Error("Conflict"));
  fireEvent.click(screen.getByRole("button", { name: en.monthlyHours.save }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.monthlyHours.save,
    }),
  );
  await screen.findByText(en.monthlyHours.writeFailed);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.actionReview.cancel,
    }),
  );
  expect(
    screen.getByLabelText<HTMLInputElement>(en.monthlyHours.day).value,
  ).toBe("4");
  remote.settings.mockResolvedValue({
    ...settings(),
    config: { ...config, version: 2, dayOfMonth: 5 },
  });
  await refreshSettings();
  expect(
    client.getQueryData([
      ["monthlyHours", "settings"],
      { input: undefined, type: "query" },
    ]),
  ).toMatchObject({ config: { version: 2 } });
  expect(
    screen.getByLabelText<HTMLInputElement>(en.monthlyHours.day).value,
  ).toBe("4");
  await screen.findByText(en.monthlyHours.stale);
  fireEvent.click(screen.getByRole("button", { name: en.monthlyHours.reload }));
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLInputElement>(en.monthlyHours.day).value,
    ).toBe("5"),
  );
  expect(remote.save).toHaveBeenCalledTimes(1);
});

it("requires a revision reason, admits one confirmed generation and recovers failed synchronization with reads only", async () => {
  remote.preview.mockResolvedValue({ ...preview(), latestRevision: 1 });
  render(show());
  await openPanel();
  await previewReport();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.monthlyHours.generateRevision,
    }).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText(en.monthlyHours.revisionReason), {
    target: { value: "Corrected stored credit" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.generateRevision }),
  );
  remote.settings.mockRejectedValue(new Error("Offline"));
  const confirm = within(screen.getByRole("dialog")).getByRole("button", {
    name: en.monthlyHours.confirmGenerate,
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await screen.findByText(en.actionReview.refreshFailed);
  expect(remote.generate).toHaveBeenCalledTimes(1);
  expect(remote.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      month: "2026-08",
      expectedVersion: 1,
      expectedLatestRevision: 1,
      reason: "Corrected stored credit",
      expectedContentHash: "a".repeat(64),
    }),
  );
  const generateCall = remote.generate.mock.calls[0]?.[0] as
    { requestId?: unknown } | undefined;
  expect(typeof generateCall?.requestId).toBe("string");
  remote.settings.mockResolvedValue(settings());
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.actionReview.retry,
    }),
  );
  await screen.findByText(en.monthlyHours.generated);
  expect(remote.generate).toHaveBeenCalledTimes(1);
});

it("submits Coordinator settings as a proposal and offers no generation or delivery retry", async () => {
  remote.settings.mockResolvedValue({
    ...settings(),
    canApply: false,
    canGenerate: false,
  });
  remote.save.mockRejectedValue({ data: { approvalId: "proposal" } });
  render(show());
  await openPanel();
  fireEvent.change(screen.getByLabelText(en.monthlyHours.day), {
    target: { value: "4" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.requestSave }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.monthlyHours.requestSave,
    }),
  );
  await screen.findByText(en.actionReview.queued);
  expect(
    screen.queryByRole("button", { name: en.monthlyHours.retryDelivery }),
  ).toBeNull();
  expect(remote.generate).not.toHaveBeenCalled();
});

it("shows fractional and negative stored credit consistently in preview and generation review", async () => {
  const fractional = {
    ...rows[0]!,
    earned: 1 / 60,
    total: -1 / 60,
    punishments: 2 / 60,
  };
  remote.preview.mockResolvedValue({
    ...preview(),
    rows: [fractional],
    totals: {
      ...totals,
      tutors: 1,
      earned: 1 / 60,
      punishments: 2 / 60,
      total: -1 / 60,
    },
  });
  render(show());
  await openPanel();
  await previewReport();
  const table = screen.getByRole("table");
  expect(within(table).getByText("0.0167")).toBeTruthy();
  expect(within(table).getByText("-0.0167")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.generate }),
  );
  expect(screen.getByRole("dialog").textContent).toContain("-0.0167");
  expect(remote.generate).not.toHaveBeenCalled();
});

it("allows another deliberate retry after fresh failed status while admitting only one in-flight attempt", async () => {
  let finish: (value: { queued: number }) => void = () => undefined;
  remote.retry.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(show());
  await openPanel();
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.retryDelivery }),
  );
  const confirm = within(screen.getByRole("dialog")).getByRole("button", {
    name: en.monthlyHours.retryDelivery,
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(remote.retry).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ queued: 1 });
  });
  await screen.findByText(en.monthlyHours.retryQueued);
  // The status read now reports a subsequent failed attempt of the same report.
  expect(remote.settings).toHaveBeenCalledTimes(2);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.actionReview.close,
    }),
  );
  const again = screen.getByRole<HTMLButtonElement>("button", {
    name: en.monthlyHours.retryDelivery,
  });
  expect(again.disabled).toBe(false);
  fireEvent.click(again);
  const second = within(screen.getByRole("dialog")).getByRole("button", {
    name: en.monthlyHours.retryDelivery,
  });
  fireEvent.click(second);
  fireEvent.click(second);
  await waitFor(() => expect(remote.retry).toHaveBeenCalledTimes(2));
  expect(remote.generate).not.toHaveBeenCalled();
});

it("disables preview when the module is off and retries blocked receipts through a distinct confirmed action", async () => {
  remote.settings.mockResolvedValue({
    ...settings(),
    serviceHoursEnabled: false,
    recentReports: [
      {
        ...summary,
        status: "BLOCKED",
        deliveryCounts: { ...summary.deliveryCounts, failed: 0, blocked: 1 },
      },
    ],
  });
  render(show());
  await openPanel();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.monthlyHours.preview,
    }).disabled,
  ).toBe(true);
  expect(remote.preview).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.retryDelivery }),
  );
  expect(remote.retry).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.monthlyHours.retryDelivery,
    }),
  );
  await screen.findByText(en.monthlyHours.retryQueued);
  expect(remote.retry).toHaveBeenCalledWith({ id: "report-one" });
  expect(remote.generate).not.toHaveBeenCalled();
});

it("discards a late preview response after a schedule edit and renders every selected verified mailbox", async () => {
  let finish: (value: ReturnType<typeof preview>) => void = () => undefined;
  remote.preview.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(show());
  await openPanel();
  fireEvent.change(screen.getByLabelText(en.monthlyHours.reportMonth), {
    target: { value: "2026-08" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.preview }),
  );
  await waitFor(() => expect(remote.preview).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText(en.monthlyHours.day), {
    target: { value: "4" },
  });
  await act(async () => {
    finish({
      ...preview(),
      recipients: [
        ...recipients,
        { ...recipients[0]!, email: "second@example.test" },
      ],
    });
  });
  expect(screen.queryByRole("table")).toBeNull();
  // A fresh authorized immutable reader preserves both mailbox receipts for one account.
  remote.report.mockResolvedValue({
    ...report(),
    intendedRecipients: [
      ...recipients,
      { ...recipients[0]!, email: "second@example.test" },
    ],
  });
  render(show(<MonthlyHoursReport id="report-one" />));
  await screen.findByText(/second@example.test/);
});

it("conceals cached settings, preview and review after authoritative denial, including a failed retry", async () => {
  render(show());
  await openPanel();
  await previewReport();
  remote.settings.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await refreshSettings();
  await screen.findByText(en.monthlyHours.denied);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByLabelText(en.monthlyHours.day)).toBeNull();
  remote.settings.mockRejectedValue(new Error("Offline"));
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.retryRead }),
  );
  await waitFor(() => expect(remote.settings).toHaveBeenCalledTimes(3));
  expect(screen.queryByText("Synthetic Head")).toBeNull();
});

it.each(["en", "zh"] as const)(
  "reads a protected immutable report with translated retry status and exports its stored CSV (%s)",
  async (locale) => {
    const copy = locale === "zh" ? zh.monthlyHours : en.monthlyHours;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:monthly"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(show(<MonthlyHoursReport id="report-one" />, false, locale));
    await screen.findByRole("table", { name: copy.snapshot });
    expect(
      screen.getByRole("columnheader", { name: copy.sessionRows }),
    ).toBeTruthy();
    expect(screen.getByText(copy.accountingHelp)).toBeTruthy();
    expect(screen.getByText(copy.immutableHelp)).toBeTruthy();
    expect(screen.getByText(copy.status.RETRYING)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.downloadCsv }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(remote.csv).toHaveBeenCalledWith(
      { id: "report-one" },
      { staleTime: 0 },
    );
    expect(remote.generate).not.toHaveBeenCalled();
  },
);

it("does not download a late CSV after report access is revoked", async () => {
  const createCsvUrl = vi.fn(() => "blob:monthly");
  let finish: (value: { filename: string; content: string }) => void = () =>
    undefined;
  remote.csv.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createCsvUrl,
  });
  render(show(<MonthlyHoursReport id="report-one" />));
  await screen.findByRole("table");
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.downloadCsv }),
  );
  remote.report.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: [["monthlyHours", "report"]] });
  });
  await screen.findByText(en.monthlyHours.denied);
  await act(async () => {
    finish({ filename: "private.csv", content: "private" });
  });
  expect(createCsvUrl).not.toHaveBeenCalled();
  expect(screen.queryByRole("table")).toBeNull();
});
