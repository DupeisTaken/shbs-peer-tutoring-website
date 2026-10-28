/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { SchoolCalendar } from "./school-calendar";

type Day = {
  date: string;
  isSchoolDay: boolean;
  timetableWeekday: number | null;
  note: string;
  active: boolean;
  version: number;
  scheduleRevision: number;
  updatedAt: Date;
};
const state = vi.hoisted(() => ({
  days: [] as Day[],
  role: "HEAD",
  pending: false,
  queryError: null as null | { message: string; data?: { code?: string } },
  save: vi.fn(),
  reset: vi.fn(),
  invalidate: vi.fn(),
  publicInvalidate: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      student: { calendar: { invalidate: state.invalidate } },
      program: { schoolCalendar: { invalidate: state.publicInvalidate } },
    }),
    account: {
      me: {
        useQuery: () => ({
          data: { role: state.role },
          error: null,
          isSuccess: true,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
    },
    student: {
      calendar: {
        useQuery: () => ({
          data: state.days,
          error: state.queryError,
          isSuccess: !state.queryError,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
      setCalendarDay: {
        useMutation: () => ({
          mutateAsync: state.save,
          isPending: state.pending,
        }),
      },
      resetCalendarDay: {
        useMutation: () => ({ mutateAsync: state.reset, isPending: false }),
      },
    },
  },
}));
const row = (patch: Partial<Day> = {}): Day => ({
  date: "2026-11-01",
  isSchoolDay: true,
  timetableWeekday: 1,
  note: "Synthetic staff note",
  active: true,
  version: 3,
  scheduleRevision: 2,
  updatedAt: new Date("2026-10-29T00:00:00Z"),
  ...patch,
});
beforeEach(() => {
  vi.resetAllMocks();
  state.days = [row()];
  state.role = "HEAD";
  state.pending = false;
  state.queryError = null;
  state.save.mockResolvedValue({});
  state.reset.mockResolvedValue({});
  state.invalidate.mockResolvedValue(undefined);
  state.publicInvalidate.mockResolvedValue(undefined);
  state.refetch.mockImplementation(async () => ({
    isSuccess: true,
    data: state.days,
  }));
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
afterEach(cleanup);
const tree = (locale: "en" | "zh" = "en") => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "en" ? en : zh}
  >
    <SchoolCalendar />
  </NextIntlClientProvider>
);
const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const edit = () =>
  fireEvent.click(screen.getByRole("button", { name: en.schoolCalendar.edit }));
const submit = async () =>
  act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.schoolCalendar.save }),
    );
  });

it.each(["en", "zh"] as const)(
  "distinguishes the actual date from the mapped timetable in %s",
  (locale) => {
    render(tree(locale));
    const t = (locale === "en" ? en : zh).schoolCalendar;
    expect(screen.getByText(t.noticeDistinction)).toBeTruthy();
    expect(document.querySelector('time[datetime="2026-11-01"]')).toBeTruthy();
    expect(
      screen.getByText(
        locale === "en" ? "Follows Mon timetable" : "采用周一课表",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.edit }));
    expect(field(t.date).disabled).toBe(true);
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: t.timetable })
        .value,
    ).toBe("1");
    expect(
      screen
        .getByRole("combobox", { name: t.timetable })
        .getAttribute("aria-describedby"),
    ).toBe("school-calendar-weekday-help");
  },
);

it("saves no-school status without a contradictory weekday and preserves the captured version", async () => {
  render(tree());
  edit();
  fireEvent.change(
    screen.getByRole("combobox", { name: en.schoolCalendar.schoolStatus }),
    { target: { value: "closed" } },
  );
  expect(
    screen.queryByRole("combobox", { name: en.schoolCalendar.timetable }),
  ).toBeNull();
  await submit();
  expect(state.save).toHaveBeenCalledWith({
    date: "2026-11-01",
    isSchoolDay: false,
    timetableWeekday: null,
    note: "Synthetic staff note",
    expectedVersion: 3,
  });
  expect(state.publicInvalidate).toHaveBeenCalledTimes(1);
});

it("recreates a reset date using its tombstone version", async () => {
  state.days = [row({ active: false, version: 7 })];
  render(tree());
  expect(
    screen.queryByRole("button", { name: en.schoolCalendar.edit }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.schoolCalendar.add }));
  fireEvent.change(field(en.schoolCalendar.date), {
    target: { value: "2026-11-01" },
  });
  await submit();
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 7, timetableWeekday: null }),
  );
});

it("retains the submitted draft and admits one same-tick save while pending", async () => {
  let finish!: (value: unknown) => void;
  state.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(tree());
  edit();
  fireEvent.change(field(en.schoolCalendar.note), {
    target: { value: "Changed draft" },
  });
  const form = field(en.schoolCalendar.note).closest("form")!;
  await act(async () => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(field(en.schoolCalendar.note).closest("fieldset")?.disabled).toBe(
    true,
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(true);
  await act(async () => {
    finish({});
  });
  expect(field(en.schoolCalendar.note).value).toBe("Changed draft");
});

it("retains a failed write draft and only adopts a new version through explicit reload", async () => {
  state.save.mockRejectedValueOnce(
    Object.assign(new Error("Calendar changed"), {
      data: { code: "CONFLICT" },
    }),
  );
  const view = render(tree());
  edit();
  fireEvent.change(field(en.schoolCalendar.note), {
    target: { value: "Unsaved draft" },
  });
  await submit();
  expect(field(en.schoolCalendar.note).value).toBe("Unsaved draft");
  state.days = [row({ note: "Fresh source", version: 4 })];
  view.rerender(tree());
  expect(field(en.schoolCalendar.note).value).toBe("Unsaved draft");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolCalendar.save,
    }).disabled,
  ).toBe(true);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.schoolCalendar.reload }),
    );
  });
  expect(field(en.schoolCalendar.note).value).toBe("Fresh source");
  await submit();
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedVersion: 4 }),
  );
});

it("keeps accepted saves locked and recovers a refresh failure through reads only", async () => {
  state.invalidate.mockRejectedValueOnce(new Error("Offline"));
  render(tree());
  edit();
  await submit();
  expect(screen.getByText(en.schoolCalendar.refreshFailed)).toBeTruthy();
  expect(field(en.schoolCalendar.note).closest("fieldset")?.disabled).toBe(
    true,
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.schoolCalendar.refresh }),
    );
  });
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.invalidate).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(en.schoolCalendar.refreshFailed)).toBeNull();
});

it("reports an Admin proposal as queued and does not resubmit it", async () => {
  state.role = "ADMIN";
  state.save.mockRejectedValueOnce({
    data: { approvalId: "synthetic-proposal" },
  });
  render(tree());
  edit();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.approvals.requestHead }),
    );
  });
  expect(screen.getByText(en.approvals.queuedBody)).toBeTruthy();
  expect(screen.queryByText(en.schoolCalendar.saved)).toBeNull();
  expect(field(en.schoolCalendar.note).closest("fieldset")?.disabled).toBe(
    true,
  );
  expect(state.save).toHaveBeenCalledTimes(1);
});

it("reviews reset with the current version before writing", async () => {
  render(tree());
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.reset }),
  );
  expect(state.reset).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.schoolCalendar.reset }),
    );
  });
  expect(state.reset).toHaveBeenCalledWith({
    date: "2026-11-01",
    expectedVersion: 3,
  });
});

it("conceals denied cached records through transport errors and disables edits during failures", () => {
  const view = render(tree());
  state.queryError = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(tree());
  expect(
    screen.queryByRole("button", { name: en.schoolCalendar.edit }),
  ).toBeNull();
  expect(screen.queryByText("Synthetic staff note")).toBeNull();
  state.queryError = { message: "Offline" };
  view.rerender(tree());
  expect(document.querySelector('time[datetime="2026-11-01"]')).toBeNull();
  state.queryError = null;
  view.rerender(tree());
  expect(
    screen.getByRole("button", { name: en.schoolCalendar.edit }),
  ).toBeTruthy();
  state.queryError = { message: "Offline" };
  view.rerender(tree());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolCalendar.edit,
    }).disabled,
  ).toBe(true);
});

it("keeps non-editing staff read-only", () => {
  state.role = "COORDINATOR";
  render(tree());
  expect(
    screen.queryByRole("button", { name: en.schoolCalendar.add }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.schoolCalendar.edit }),
  ).toBeNull();
  expect(
    screen.getByRole("button", {
      name: `${en.schoolCalendar.details}: ${en.schoolCalendar.title} · 2026-11-01`,
    }),
  ).toBeTruthy();
});

it("cancels a reset without writing", () => {
  render(tree());
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.reset }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.actionReview.cancel,
    }),
  );
  expect(state.reset).not.toHaveBeenCalled();
});
it("keeps accepted-save read recovery after closing its editor", async () => {
  state.invalidate.mockRejectedValueOnce(new Error("Offline"));
  render(tree());
  edit();
  await submit();
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.close }),
  );
  expect(screen.getByText(en.schoolCalendar.refreshFailed)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolCalendar.edit,
    }).disabled,
  ).toBe(true);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.schoolCalendar.refresh }),
    );
  });
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.invalidate).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(en.schoolCalendar.refreshFailed)).toBeNull();
  // A stale cached version cannot restart the accepted operation after recovery.
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolCalendar.edit,
    }).disabled,
  ).toBe(true);
});
it("retains an ordinary rejected write draft for another deliberate attempt", async () => {
  state.save.mockRejectedValueOnce(new Error("Temporary failure"));
  render(tree());
  edit();
  fireEvent.change(field(en.schoolCalendar.note), {
    target: { value: "Retained text" },
  });
  await submit();
  expect(field(en.schoolCalendar.note).value).toBe("Retained text");
  expect(screen.getByText("Temporary failure")).toBeTruthy();
  await submit();
  expect(state.save).toHaveBeenCalledTimes(2);
});

it("does not repeat an accepted new-date proposal after its editor closes", async () => {
  state.days = [];
  state.role = "ADMIN";
  state.save.mockRejectedValueOnce({
    data: { approvalId: "synthetic-proposal" },
  });
  render(tree());
  fireEvent.click(screen.getByRole("button", { name: en.schoolCalendar.add }));
  fireEvent.change(field(en.schoolCalendar.date), {
    target: { value: "2026-11-01" },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.approvals.requestHead }),
    );
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.close }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.schoolCalendar.add }));
  fireEvent.change(field(en.schoolCalendar.date), {
    target: { value: "2026-11-01" },
  });
  expect(screen.getByText(en.schoolCalendar.alreadySubmitted)).toBeTruthy();
  await act(async () => {
    fireEvent.submit(field(en.schoolCalendar.date).closest("form")!);
  });
  expect(state.save).toHaveBeenCalledTimes(1);
});
