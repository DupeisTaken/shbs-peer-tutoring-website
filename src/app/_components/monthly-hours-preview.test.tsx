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
import type { RouterOutputs } from "~/trpc/react";
import {
  MonthlyHoursPreview,
  ProgramMonthlyHoursPreview,
} from "./monthly-hours-preview";
import { ProgramEmailSettings } from "./program-email-settings";
import { ReadOnlyProvider } from "./read-only";

const remote = vi.hoisted(() => ({
  settings: vi.fn(),
  preview: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => [["monthlyHours"]] }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const read = (name: "settings" | "preview") => ({
    useQuery: (
      input: unknown,
      options: { enabled?: boolean; retry?: boolean; staleTime?: number },
    ) =>
      useQuery({
        queryKey: [["monthlyHours", name], { input, type: "query" }],
        queryFn: () => remote[name](input) as Promise<unknown>,
        ...options,
      }),
  });
  const mutation = {
    useMutation: () => ({
      mutate: remote.write,
      mutateAsync: remote.write,
      isPending: false,
    }),
  };
  return {
    api: {
      useUtils: () => ({
        program: { emailNotificationSettings: { invalidate: vi.fn() } },
        account: { emailSettings: { invalidate: vi.fn() } },
      }),
      monthlyHours: { settings: read("settings"), preview: read("preview") },
      program: {
        emailNotificationSettings: {
          useQuery: () => ({
            data: {
              enabled: false,
              secondaryEmailBindingEnabled: true,
              canEdit: true,
              canApply: true,
              deliveryAvailable: false,
            },
            error: null,
          }),
        },
        emailDeliveryStatus: {
          useQuery: () => ({
            data: { channels: [], retrying: 0, failed: 0 },
            error: null,
            isFetching: false,
            refetch: vi.fn(),
          }),
        },
        setEmailNotifications: mutation,
        setSecondaryEmailBinding: mutation,
        resendStuckEmails: mutation,
      },
    },
  };
});
type Preview = RouterOutputs["monthlyHours"]["preview"];
const maliciousName = '<img src=x onerror="throw 1">';
const settings = {
  config: {
    enabled: false,
    recipientUserIds: [],
    dayOfMonth: 3,
    localTime: "09:00",
    timeZone: "Asia/Shanghai",
    version: 2,
    firstReportMonth: null,
    nextDueAt: null,
  },
  staff: [],
  programTimeZone: "Asia/Shanghai",
  serviceHoursEnabled: true,
  optionalEmailEnabled: false,
  transportAvailable: false,
  canEdit: true,
  canApply: true,
  canGenerate: true,
  recentReports: [],
  lastGenerationError: null,
};
function sample(month = "2026-08"): Preview {
  return {
    month,
    generatedAt: new Date("2026-09-03T01:00:00Z"),
    timeZone: "Asia/Shanghai",
    configVersion: 2,
    latestRevision: 1,
    contentHash: "a".repeat(64),
    rows: [
      {
        tutorId: "tutor",
        englishName: maliciousName,
        active: false,
        sessions: 1,
        adjustmentCount: 1,
        earned: 1 / 60,
        extras: 0,
        punishments: 2 / 60,
        total: -1 / 60,
      },
    ],
    totals: {
      tutors: 1,
      sessions: 1,
      earned: 1 / 60,
      extras: 0,
      punishments: 2 / 60,
      total: -1 / 60,
    },
    recipients: [],
    email: {
      subject: `Synthetic report ${month}`,
      html: '<!doctype html><html><body><p>&lt;img src=x onerror=&quot;throw 1&quot;&gt;</p><a href="#report-preview">Report</a><a href="#unsubscribe-preview">Unsubscribe</a></body></html>',
      text: `Synthetic report ${month}\n${maliciousName}\n-0.0167`,
    },
  };
}
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  vi.clearAllMocks();
  remote.settings.mockResolvedValue(settings);
  remote.preview.mockImplementation((input: { month: string }) =>
    Promise.resolve(sample(input.month)),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
});
function show(
  element = <ProgramMonthlyHoursPreview />,
  locale: "en" | "zh" = "en",
  readOnly = false,
) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="Asia/Shanghai"
      >
        <ReadOnlyProvider value={readOnly}>{element}</ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
async function openPreview(locale: "en" | "zh" = "en") {
  const copy = locale === "zh" ? zh.monthlyHours : en.monthlyHours;
  const summary = screen.getByText(copy.emailPreviewsTitle);
  const details = summary.closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByLabelText(copy.reportMonth);
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: copy.preview })
        .disabled,
    ).toBe(false),
  );
}
async function loadPreview(month = "2026-08", locale: "en" | "zh" = "en") {
  const copy = locale === "zh" ? zh.monthlyHours : en.monthlyHours;
  fireEvent.change(screen.getByLabelText(copy.reportMonth), {
    target: { value: month },
  });
  fireEvent.click(screen.getByRole("button", { name: copy.preview }));
  await screen.findByRole("table", { name: copy.snapshot });
}

it.each(["en", "zh"] as const)(
  "provides manual report/HTML/text tabs with an isolated exact renderer and no writes (%s)",
  (locale) => {
    const copy = locale === "zh" ? zh.monthlyHours : en.monthlyHours;
    const data = sample();
    const view = render(show(<MonthlyHoursPreview preview={data} />, locale));
    expect(screen.getByText(copy.previewDraft)).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("-0.0167")).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
    const reportTab = screen.getByRole("tab", { name: copy.adminReportTab });
    reportTab.focus();
    fireEvent.keyDown(reportTab, { key: "ArrowRight" });
    const htmlTab = screen.getByRole("tab", { name: copy.emailHtmlTab });
    expect(document.activeElement).toBe(htmlTab);
    expect(reportTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(htmlTab);
    const frame = screen.getByTitle<HTMLIFrameElement>(
      copy.emailFrameTitle.replace("{month}", data.month),
    );
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("srcdoc")).toBe(data.email.html);
    const parsed = new DOMParser().parseFromString(
      frame.getAttribute("srcdoc")!,
      "text/html",
    );
    expect(parsed.querySelector("img")).toBeNull();
    expect(
      [...parsed.querySelectorAll("a")].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["#report-preview", "#unsubscribe-preview"]);
    fireEvent.click(screen.getByRole("tab", { name: copy.plainTextTab }));
    expect(view.container.querySelector("pre")!.textContent).toBe(
      data.email.text,
    );
    expect(view.container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: copy.generate })).toBeNull();
    expect(remote.write).not.toHaveBeenCalled();
  },
);

it("loads the actual Communication email-settings preview only after opening and explicit Preview", async () => {
  render(show(<ProgramEmailSettings />));
  expect(screen.getByText(en.monthlyHours.emailPreviewsTitle)).toBeTruthy();
  expect(remote.settings).not.toHaveBeenCalled();
  await openPreview();
  expect(remote.preview).not.toHaveBeenCalled();
  await loadPreview();
  expect(remote.preview).toHaveBeenCalledWith({ month: "2026-08" });
  expect(
    screen.getByRole("tab", { name: en.monthlyHours.emailHtmlTab }),
  ).toBeTruthy();
  expect(remote.write).not.toHaveBeenCalled();
});

it("does not mount queries for read-only viewers and labels an unavailable feature", async () => {
  const view = render(show(<ProgramMonthlyHoursPreview />, "en", true));
  expect(screen.queryByText(en.monthlyHours.emailPreviewsTitle)).toBeNull();
  expect(remote.settings).not.toHaveBeenCalled();
  view.unmount();
  remote.settings.mockResolvedValue({
    ...settings,
    serviceHoursEnabled: false,
  });
  render(show());
  const details = screen
    .getByText(en.monthlyHours.emailPreviewsTitle)
    .closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByText(en.monthlyHours.previewFeatureOff);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.monthlyHours.preview,
    }).disabled,
  ).toBe(true);
  expect(remote.preview).not.toHaveBeenCalled();
});

it("hides late responses for another month and keeps an explicitly cleared month empty", async () => {
  let complete: (value: Preview) => void = () => undefined;
  remote.preview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(show());
  await openPreview();
  fireEvent.change(screen.getByLabelText(en.monthlyHours.reportMonth), {
    target: { value: "2026-08" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.preview }),
  );
  await waitFor(() => expect(remote.preview).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText(en.monthlyHours.reportMonth), {
    target: { value: "2026-07" },
  });
  await act(async () => {
    complete(sample("2026-08"));
  });
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.preview }),
  );
  await screen.findByRole("table");
  expect(remote.preview).toHaveBeenLastCalledWith({ month: "2026-07" });
  fireEvent.change(screen.getByLabelText(en.monthlyHours.reportMonth), {
    target: { value: "" },
  });
  expect(
    screen.getByLabelText<HTMLInputElement>(en.monthlyHours.reportMonth).value,
  ).toBe("");
  expect(screen.queryByRole("table")).toBeNull();
  expect(remote.write).not.toHaveBeenCalled();
});

it("retains permitted content on a refresh error and retries only the preview read", async () => {
  render(show());
  await openPreview();
  await loadPreview();
  fireEvent.click(
    screen.getByRole("tab", { name: en.monthlyHours.emailHtmlTab }),
  );
  remote.preview.mockRejectedValue(new Error("Offline"));
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.preview }),
  );
  await screen.findByText(en.monthlyHours.previewRefreshFailed);
  expect(
    screen.getByTitle(
      en.monthlyHours.emailFrameTitle.replace("{month}", "2026-08"),
    ),
  ).toBeTruthy();
  remote.preview.mockResolvedValue(sample());
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.retryRead }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.monthlyHours.previewRefreshFailed)).toBeNull(),
  );
  expect(remote.write).not.toHaveBeenCalled();
});

it("clears every preview representation on denial and cannot revive a late response or failed retry", async () => {
  render(show());
  await openPreview();
  await loadPreview();
  fireEvent.click(
    screen.getByRole("tab", { name: en.monthlyHours.emailHtmlTab }),
  );
  let complete: (value: Preview) => void = () => undefined;
  remote.preview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.preview }),
  );
  await waitFor(() => expect(remote.preview).toHaveBeenCalledTimes(2));
  remote.settings.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: [["monthlyHours", "settings"]] });
  });
  await screen.findByText(en.monthlyHours.denied);
  await act(async () => {
    complete(sample());
  });
  expect(
    screen.queryByTitle(
      en.monthlyHours.emailFrameTitle.replace("{month}", "2026-08"),
    ),
  ).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  remote.settings.mockRejectedValue(new Error("Offline"));
  fireEvent.click(
    screen.getByRole("button", { name: en.monthlyHours.retryRead }),
  );
  await waitFor(() => expect(remote.settings).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("tab")).toBeNull();
  expect(remote.write).not.toHaveBeenCalled();
});
