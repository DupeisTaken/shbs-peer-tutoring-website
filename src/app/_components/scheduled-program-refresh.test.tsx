// @vitest-environment jsdom
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
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import {
  ScheduledProgramRefresh,
  ScheduledRefreshEditor,
} from "./scheduled-program-refresh";
import type { NextRecruitmentSettingsData } from "./next-recruitment-settings";

type Props = ComponentProps<typeof ScheduledRefreshEditor>;
type Schedule = NonNullable<Props["data"]["schedule"]>;
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  cancel: vi.fn(),
  scheduleFetch: vi.fn(),
  nextFetch: vi.fn(),
  currentFetch: vi.fn(),
  cancelRead: vi.fn(),
  approvalFetch: vi.fn(),
  scheduleQuery: vi.fn(),
  nextQuery: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        refreshSchedule: {
          fetch: mocks.scheduleFetch,
          cancel: mocks.cancelRead,
        },
        currentPeriod: { fetch: mocks.currentFetch, cancel: mocks.cancelRead },
      },
      program: {
        nextRecruitment: { fetch: mocks.nextFetch, cancel: mocks.cancelRead },
      },
      approval: {
        list: { fetch: mocks.approvalFetch, cancel: mocks.cancelRead },
      },
    }),
    admin: {
      refreshSchedule: { useQuery: mocks.scheduleQuery },
      scheduleRefresh: { useMutation: () => ({ mutateAsync: mocks.save }) },
      cancelRefresh: { useMutation: () => ({ mutateAsync: mocks.cancel }) },
    },
    program: { nextRecruitment: { useQuery: mocks.nextQuery } },
  },
}));

const target = {
  sourceTermId: "source",
  sourceSchoolYear: "26-27",
  sourceQuarter: "Q1",
  destinationSchoolYear: "26-27",
  destinationQuarter: "Q2",
  semesterMode: false,
  modeRevision: 1,
} as const;
const period = {
  termId: "source",
  schoolYear: "26-27",
  quarter: "Q1",
  name: "26-27 Q1",
  next: {
    name: "26-27 Q2",
    crossesSemester: false,
    crossesYear: false,
    graduates: false,
    semester: "S1",
  },
} as Props["period"];
function next(): NextRecruitmentSettingsData {
  return {
    target,
    currentName: "26-27 Q1",
    nextName: "26-27 Q2",
    timeZone: "Asia/Shanghai",
    preparations: { tutor: null, tutee: null },
    canEdit: true,
    canApply: true,
    refreshEvidence: {
      target,
      timeZone: "Asia/Shanghai",
      preparations: { tutor: null, tutee: null },
      destination: null,
    },
  };
}
function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "schedule",
    version: 1,
    state: "SCHEDULED",
    executeAt: new Date("2026-11-01T01:00:00Z"),
    timeZone: "Asia/Shanghai",
    ...target,
    blockedReason: null,
    completedAt: null,
    ...overrides,
  } as Schedule;
}
const data = (row: Schedule | null = null): Props["data"] => ({
  schedule: row,
  activeSourceTermId: "source",
  serverNow: new Date("2026-10-30T01:00:00Z"),
  canEdit: true,
  canApply: true,
});
function tree(overrides: Partial<Props> = {}, locale: "en" | "zh" = "en") {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
      timeZone="Asia/Shanghai"
    >
      <ScheduledRefreshEditor
        period={period}
        canEdit
        canApply
        data={data()}
        next={next()}
        readFailed={false}
        retry={<button>Retry read</button>}
        {...overrides}
      />
    </NextIntlClientProvider>
  );
}
function open(locale: "en" | "zh" = "en") {
  const text = (locale === "en" ? en : zh).scheduledRefresh;
  fireEvent.change(screen.getByLabelText(text.timeLabel), {
    target: { value: "2026-11-01T09:00" },
  });
  fireEvent.change(screen.getByLabelText(text.confirmLabel), {
    target: { value: "REFRESH" },
  });
  const button = screen.getByRole("button", { name: text.review });
  button.focus();
  fireEvent.click(button);
  return { dialog: screen.getByRole("dialog"), button };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue(schedule());
  mocks.cancel.mockResolvedValue(schedule({ version: 2, state: "CANCELLED" }));
  mocks.scheduleFetch.mockResolvedValue(data(schedule()));
  mocks.nextFetch.mockResolvedValue(next());
  mocks.currentFetch.mockResolvedValue(period);
  mocks.cancelRead.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

it("retains the completed prior-source receipt after polling observes the new active period", async () => {
  let current = data(schedule());
  let historical = current;
  mocks.scheduleQuery.mockImplementation((input?: { id?: string }) => ({
    data: input?.id ? historical : current,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }));
  mocks.nextQuery.mockReturnValue({
    data: next(),
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  });
  const renderPage = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <ScheduledProgramRefresh period={period} canEdit canApply />
    </NextIntlClientProvider>
  );
  const view = render(renderPage());
  await waitFor(() =>
    expect(mocks.scheduleQuery).toHaveBeenCalledWith(
      { id: "schedule" },
      expect.objectContaining({ enabled: true }),
    ),
  );
  current = { ...data(), activeSourceTermId: "destination" };
  historical = {
    ...data(schedule({ state: "COMPLETED", version: 2 })),
    activeSourceTermId: "destination",
  };
  view.rerender(renderPage());
  expect(screen.getByText(en.scheduledRefresh.states.COMPLETED)).toBeTruthy();
  expect(screen.getByText(en.scheduledRefresh.none)).toBeTruthy();
  expect(screen.getByText(en.scheduledRefresh.changed)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.scheduledRefresh.edit,
    }).disabled,
  ).toBe(true);
  // Only explicit successful reload adopts Q2 and offers a new schedule. The
  // completed Q1 receipt remains status evidence, never Q2's edit/version source.
  const preparation = next();
  preparation.target = { ...preparation.target, sourceTermId: "destination" };
  mocks.scheduleFetch.mockResolvedValue(current);
  mocks.nextFetch.mockResolvedValue(preparation);
  mocks.currentFetch.mockResolvedValue({
    ...period,
    termId: "destination",
    quarter: "Q2",
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.scheduledRefresh.reload }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLInputElement>(en.scheduledRefresh.timeLabel)
        .value,
    ).toBe(""),
  );
  expect(screen.getByText(en.scheduledRefresh.states.COMPLETED)).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it.each(["en", "zh"] as const)(
  "reviews date, target, timezone and consequences in %s without writing before confirmation",
  async (locale) => {
    render(tree({}, locale));
    const text = (locale === "en" ? en : zh).scheduledRefresh;
    const { dialog } = open(locale);
    expect(within(dialog).getByText("26-27 Q2")).toBeTruthy();
    expect(within(dialog).getByText("Asia/Shanghai")).toBeTruthy();
    expect(within(dialog).getByText(text.catchUp)).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: text.save }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        confirm: "REFRESH",
        expectedTermId: "source",
        expectedPreparation: next().refreshEvidence,
        executeAt: new Date("2026-11-01T01:00:00Z"),
        expectedScheduleVersion: 0,
      }),
    );
    await within(dialog).findByText(text.saved);
  },
);

it("cancels review without a write and restores its exact opener", () => {
  render(tree());
  const { dialog, button } = open();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.actionReview.cancel }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("retains the draft through background changes and prevents stale review submission", async () => {
  const view = render(tree());
  const { dialog } = open();
  const changed = next();
  changed.refreshEvidence.timeZone = "UTC";
  view.rerender(tree({ next: changed }));
  expect(
    screen.getByLabelText<HTMLInputElement>(en.scheduledRefresh.timeLabel)
      .value,
  ).toBe("2026-11-01T09:00");
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.scheduledRefresh.save }),
  );
  await within(dialog).findByText(
    en.scheduledRefresh.errors.SCHEDULED_REFRESH_CHANGED,
  );
  expect(mocks.save).not.toHaveBeenCalled();
});

it("keeps a rejected-write draft and prevents writes after a failed latest read", async () => {
  mocks.save.mockRejectedValueOnce(new Error("SCHEDULED_REFRESH_CHANGED"));
  const view = render(tree());
  const { dialog } = open();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.scheduledRefresh.save }),
  );
  await within(dialog).findByText(
    en.scheduledRefresh.errors.SCHEDULED_REFRESH_CHANGED,
  );
  expect(
    screen.getByLabelText<HTMLInputElement>(en.scheduledRefresh.timeLabel)
      .value,
  ).toBe("2026-11-01T09:00");
  view.rerender(tree({ readFailed: true }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.scheduledRefresh.save }),
  );
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it("recovers an accepted write using reads only after closing its failed-sync dialog", async () => {
  mocks.scheduleFetch.mockRejectedValueOnce(new Error("unavailable"));
  render(tree());
  const { dialog } = open();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.scheduledRefresh.save }),
  );
  await within(dialog).findByText(en.actionReview.refreshFailed);
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.actionReview.close }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.actionReview.retry }));
  await screen.findByText(en.scheduledRefresh.saved);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.scheduleFetch).toHaveBeenCalledWith(
    { id: "schedule" },
    { staleTime: 0 },
  );
});

it("admits only one pending mutation and blocks review dismissal", async () => {
  let resolve!: (value: Schedule) => void;
  mocks.save.mockReturnValue(
    new Promise<Schedule>((done) => {
      resolve = done;
    }),
  );
  render(tree());
  const { dialog } = open();
  const button = within(dialog).getByRole("button", {
    name: en.scheduledRefresh.save,
  });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () => resolve(schedule()));
});

it("shows an Admin proposal as pending and keeps its draft until approval is terminal", async () => {
  mocks.save.mockRejectedValue({ data: { approvalId: "proposal" } });
  mocks.approvalFetch.mockResolvedValue({
    rows: [{ id: "proposal", state: "PENDING" }],
  });
  render(tree({ canApply: false, data: { ...data(), canApply: false } }));
  const { dialog } = open();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.approvals.requestHead }),
  );
  await within(dialog).findByText(en.actionReview.queued);
  expect(mocks.scheduleFetch).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.actionReview.close }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.scheduledRefresh.checkApproval }),
  );
  await waitFor(() => expect(mocks.approvalFetch).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.scheduledRefresh.checkApproval,
      }).disabled,
    ).toBe(false),
  );
  expect(
    screen.getByLabelText<HTMLInputElement>(en.scheduledRefresh.timeLabel)
      .value,
  ).toBe("2026-11-01T09:00");
  expect(mocks.scheduleFetch).not.toHaveBeenCalled();
  mocks.approvalFetch.mockResolvedValue({
    rows: [{ id: "proposal", state: "REJECTED" }],
  });
  mocks.scheduleFetch.mockResolvedValue(data());
  fireEvent.click(
    screen.getByRole("button", { name: en.scheduledRefresh.checkApproval }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.scheduledRefresh.pendingApproval)).toBeNull(),
  );
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it("cancels the exact schedule version even when preparation evidence has drifted", async () => {
  const value = data(schedule());
  const view = render(tree({ data: value }));
  const changed = next();
  changed.refreshEvidence.timeZone = "UTC";
  view.rerender(tree({ data: value, next: changed }));
  fireEvent.click(
    screen.getByRole("button", { name: en.scheduledRefresh.cancelSchedule }),
  );
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByText(en.scheduledRefresh.cancelEffect),
  ).toBeTruthy();
  mocks.scheduleFetch.mockResolvedValue(
    data(schedule({ version: 2, state: "CANCELLED" })),
  );
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: en.scheduledRefresh.cancelSchedule,
    }),
  );
  await waitFor(() =>
    expect(mocks.cancel).toHaveBeenCalledWith({
      id: "schedule",
      expectedVersion: 1,
    }),
  );
  expect(mocks.save).not.toHaveBeenCalled();
});

it("revokes private review when edit permission is lost", () => {
  const view = render(tree());
  open();
  view.rerender(tree({ canEdit: false }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByLabelText(en.scheduledRefresh.timeLabel)).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("rejects a past program time without opening a review", () => {
  render(tree());
  fireEvent.change(screen.getByLabelText(en.scheduledRefresh.timeLabel), {
    target: { value: "2026-10-01T09:00" },
  });
  fireEvent.change(screen.getByLabelText(en.scheduledRefresh.confirmLabel), {
    target: { value: "REFRESH" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.scheduledRefresh.review }),
  );
  expect(
    screen.getByText(en.scheduledRefresh.errors.SCHEDULED_REFRESH_TIME_INVALID),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("rejects a repeated daylight-saving hour in the program timezone", () => {
  const value = next();
  value.timeZone = "America/New_York";
  value.refreshEvidence.timeZone = value.timeZone;
  render(tree({ next: value }));
  fireEvent.change(screen.getByLabelText(en.scheduledRefresh.timeLabel), {
    target: { value: "2026-11-01T01:30" },
  });
  fireEvent.change(screen.getByLabelText(en.scheduledRefresh.confirmLabel), {
    target: { value: "REFRESH" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.scheduledRefresh.review }),
  );
  expect(
    screen.getByText(en.scheduledRefresh.errors.SCHEDULED_REFRESH_TIME_INVALID),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("reschedules the captured version without changing the existing schedule before confirmation", async () => {
  render(tree({ data: data(schedule({ version: 4 })) }));
  fireEvent.click(
    screen.getByRole("button", { name: en.scheduledRefresh.edit }),
  );
  const { dialog } = open();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.scheduledRefresh.save }),
  );
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ expectedScheduleVersion: 4 }),
    ),
  );
});

it("recovers a schedule that completed before its confirmation read without resubmission", async () => {
  const current = { ...period, termId: "destination", quarter: "Q2" as const };
  const preparation = next();
  preparation.target = { ...preparation.target, sourceTermId: "destination" };
  const activated = vi.fn();
  mocks.scheduleFetch.mockImplementation((input?: { id?: string }) =>
    Promise.resolve(
      input?.id
        ? data(schedule({ version: 2, state: "COMPLETED" }))
        : { ...data(), activeSourceTermId: "destination" },
    ),
  );
  mocks.nextFetch.mockResolvedValue(preparation);
  mocks.currentFetch.mockResolvedValue(current);
  render(tree({ onActivated: activated }));
  const { dialog } = open();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.scheduledRefresh.save }),
  );
  await waitFor(() => expect(activated).toHaveBeenCalledWith(current));
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
