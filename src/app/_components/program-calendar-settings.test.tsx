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
import { ProgramCalendarSettings } from "./program-calendar";

type Day = {
  date: string;
  endDate: string;
  reason: string;
  active: boolean;
  version: number;
  schedulingEffect?: "NOTICE" | "PAUSE_REGULAR";
};
type SchoolDay = {
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
  schoolDays: [] as SchoolDay[],
  role: "HEAD",
  canEdit: true,
  canApply: true,
  pending: false,
  queryError: null as null | { message: string; data?: { code?: string } },
  schoolQueryError: null as null | { message: string; data?: { code?: string } },
  mutationError: null as null | {
    data: { code?: string; approvalId?: string };
  },
  save: vi.fn(),
  remove: vi.fn(),
  saveHoliday: vi.fn(),
  updateHoliday: vi.fn(),
  resetHoliday: vi.fn(),
  invalidate: vi.fn(),
  schoolInvalidate: vi.fn(),
  publicSchoolInvalidate: vi.fn(),
  refetch: vi.fn(),
  schoolRefetch: vi.fn(),
  preview: vi.fn(),
  sessionInvalidate: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      program: {
        calendarSettings: { invalidate: state.invalidate },
        calendar: { invalidate: state.invalidate },
        schoolCalendar: { invalidate: state.publicSchoolInvalidate },
        calendarImpact: { fetch: state.preview },
      },
      student: {
        calendar: { invalidate: state.schoolInvalidate },
      },
      sessionPlanning: { invalidate: state.sessionInvalidate },
    }),
    account: {
      me: {
        useQuery: () => ({
          data: { role: state.role },
          error: null,
          isSuccess: true,
          isFetching: false,
          refetch: state.schoolRefetch,
        }),
      },
    },
    program: {
      calendarSettings: {
        useQuery: () => ({
          data: {
            days: state.days,
            canEdit: state.canEdit,
            canApply: state.canApply,
          },
          error: state.queryError,
          refetch: state.refetch,
        }),
      },
      setCalendarDay: {
        useMutation: () => ({
          mutateAsync: state.save,
          isPending: state.pending,
          error: state.mutationError,
        }),
      },
      removeCalendarDay: { useMutation: () => ({ mutateAsync: state.remove }) },
    },
    student: {
      calendar: {
        useQuery: () => ({
          data: state.schoolDays,
          error: state.schoolQueryError,
          isSuccess: !state.schoolQueryError,
          isFetching: false,
          refetch: state.schoolRefetch,
        }),
      },
      setCalendarHoliday: {
        useMutation: () => ({
          mutateAsync: state.saveHoliday,
          isPending: state.pending,
        }),
      },
      updateCalendarHoliday: {
        useMutation: () => ({
          mutateAsync: state.updateHoliday,
          isPending: state.pending,
        }),
      },
      resetCalendarHoliday: {
        useMutation: () => ({
          mutateAsync: state.resetHoliday,
          isPending: false,
        }),
      },
    },
  },
}));

const schoolRow = (patch: Partial<SchoolDay> = {}): SchoolDay => ({
  date: "2026-11-26",
  isSchoolDay: false,
  timetableWeekday: null,
  note: "Thanksgiving holiday",
  active: true,
  version: 2,
  scheduleRevision: 1,
  updatedAt: new Date("2026-10-29T00:00:00Z"),
  ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  state.days = [
    {
      date: "2026-12-28",
      endDate: "2027-01-04",
      reason: "Winter break",
      active: true,
      version: 3,
    },
  ];
  state.schoolDays = [];
  state.role = "HEAD";
  state.canEdit = true;
  state.canApply = true;
  state.pending = false;
  state.queryError = null;
  state.schoolQueryError = null;
  state.mutationError = null;
  state.save.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  state.saveHoliday.mockResolvedValue([]);
  state.updateHoliday.mockResolvedValue([]);
  state.resetHoliday.mockResolvedValue([]);
  state.preview.mockResolvedValue({
    scope: "publishedFutureParticipants",
    pauseCount: 4,
    retainedExceptionCount: 2,
    confirmationCount: 1,
    restorationCount: 3,
  });
  state.invalidate.mockResolvedValue(undefined);
  state.schoolInvalidate.mockResolvedValue(undefined);
  state.publicSchoolInvalidate.mockResolvedValue(undefined);
  state.sessionInvalidate.mockResolvedValue(undefined);
  state.schoolRefetch.mockImplementation(async () => ({
    isSuccess: true,
    data: state.schoolDays,
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
    <ProgramCalendarSettings />
  </NextIntlClientProvider>
);
const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const edit = () =>
  fireEvent.click(
    screen.getByRole("button", { name: en.programCalendar.edit }),
  );
const submit = async () => {
  await act(async () => {
    fireEvent.click(
      screen.queryByRole("button", { name: en.programCalendar.save }) ??
        screen.getByRole("button", { name: en.programCalendar.reviewImpact }),
    );
  });
};

it.each(["en", "zh"] as const)(
  "displays ranges and edits inclusive endpoints in %s",
  async (locale) => {
    render(tree(locale));
    const copy = (locale === "en" ? en : zh).programCalendar;
    expect(screen.getByText("2026-12-28")).toBeTruthy();
    expect(screen.getByText("2027-01-04")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.edit }));
    expect(field(copy.startDate).disabled).toBe(true);
    expect(field(copy.endDate).min).toBe("2026-12-28");
    expect(field(copy.endDate).required).toBe(true);
    fireEvent.change(field(copy.endDate), { target: { value: "2027-01-05" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.save }));
    });
    expect(state.save).toHaveBeenCalledWith({
      date: "2026-12-28",
      endDate: "2027-01-05",
      reason: "Winter break",
      schedulingEffect: "NOTICE",
      expectedVersion: 3,
    });
  },
);

it("defaults a new pause to one day, rejects invalid dates and reviews before saving", async () => {
  render(tree());
  fireEvent.click(screen.getByRole("button", { name: en.programCalendar.add }));
  fireEvent.change(field(en.programCalendar.startDate), {
    target: { value: "2027-02-03" },
  });
  expect(field(en.programCalendar.endDate).value).toBe("2027-02-03");
  fireEvent.change(field(en.programCalendar.reason), {
    target: { value: "School event" },
  });
  fireEvent.change(field(en.programCalendar.endDate), {
    target: { value: "2027-02-02" },
  });
  await submit();
  expect(field(en.programCalendar.endDate).validity.rangeUnderflow).toBe(true);
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.change(field(en.programCalendar.endDate), {
    target: { value: "" },
  });
  await submit();
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.change(field(en.programCalendar.endDate), {
    target: { value: "2027-02-03" },
  });
  await submit();
  expect(state.save).not.toHaveBeenCalled();
  expect(state.preview).toHaveBeenCalledExactlyOnceWith({
    date: "2027-02-03", endDate: "2027-02-03", schedulingEffect: "PAUSE_REGULAR", expectedVersion: 0,
  }, { staleTime: 0 });
  await submit();
  expect(state.save).toHaveBeenCalledWith({
    date: "2027-02-03",
    endDate: "2027-02-03",
    reason: "School event",
    schedulingEffect: "PAUSE_REGULAR",
    expectedVersion: 0,
  });
});

it("retains the range draft and original version through failed writes and background refreshes", async () => {
  state.save.mockRejectedValueOnce(new Error("Conflict"));
  const view = render(tree());
  edit();
  fireEvent.change(field(en.programCalendar.endDate), {
    target: { value: "2027-01-08" },
  });
  await submit();
  expect(screen.getByRole("alert").textContent).toContain("Conflict");
  state.queryError = new Error("Offline");
  view.rerender(tree());
  expect(field(en.programCalendar.endDate).matches(":disabled")).toBe(true);
  state.queryError = null;
  state.days = [{ ...state.days[0]!, version: 4, endDate: "2027-01-06" }];
  view.rerender(tree());
  expect(field(en.programCalendar.endDate).value).toBe("2027-01-08");
  await submit();
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ endDate: "2027-01-08", expectedVersion: 3 }),
  );
});

it("replaces a conflicted range only after an explicit successful reload", async () => {
  state.mutationError = { data: { code: "CONFLICT" } };
  state.refetch
    .mockResolvedValueOnce({ isSuccess: false, error: new Error("Offline") })
    .mockResolvedValueOnce({
      isSuccess: true,
      data: {
        days: [{ ...state.days[0]!, endDate: "2027-01-10", version: 4 }],
      },
    });
  render(tree());
  edit();
  fireEvent.change(field(en.programCalendar.endDate), {
    target: { value: "2027-01-08" },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.programCalendar.reload }),
    );
  });
  expect(field(en.programCalendar.endDate).value).toBe("2027-01-08");
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.programCalendar.reload }),
    );
  });
  expect(field(en.programCalendar.endDate).value).toBe("2027-01-10");
  await submit();
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 4, endDate: "2027-01-10" }),
  );
});

it("recovers an accepted range write by read only after synchronization fails", async () => {
  state.invalidate.mockRejectedValue(new Error("Offline"));
  render(tree());
  edit();
  await submit();
  expect(screen.getByRole("alert").textContent).toContain(
    en.programCalendar.refreshFailed,
  );
  expect(field(en.programCalendar.endDate).matches(":disabled")).toBe(true);
  state.invalidate.mockResolvedValue(undefined);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.programCalendar.refresh }),
    );
  });
  expect(state.save).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("blocks duplicate submissions and dismissal while the range write is pending", async () => {
  let settle!: () => void;
  state.save.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  const view = render(tree());
  edit();
  const form = field(en.programCalendar.endDate).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(state.save).toHaveBeenCalledOnce();
  state.pending = true;
  view.rerender(tree());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(true);
  expect(field(en.programCalendar.endDate).matches(":disabled")).toBe(true);
  state.pending = false;
  await act(async () => {
    settle();
  });
});

it("keeps viewers read-only and disables an open draft if edit permission is revoked", () => {
  state.canEdit = false;
  const view = render(tree());
  expect(
    screen.queryByRole("button", { name: en.programCalendar.add }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.programCalendar.edit }),
  ).toBeNull();
  state.canEdit = true;
  view.rerender(tree());
  edit();
  state.canEdit = false;
  view.rerender(tree());
  expect(field(en.programCalendar.endDate).matches(":disabled")).toBe(true);
});

it("requests approval for administrators with the full range and freezes an accepted proposal", async () => {
  state.canApply = false;
  state.save.mockRejectedValue({ data: { approvalId: "approval-1" } });
  render(tree());
  edit();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.approvals.requestAdmin }),
    );
  });
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      date: "2026-12-28",
      endDate: "2027-01-04",
      expectedVersion: 3,
    }),
  );
  expect(field(en.programCalendar.endDate).matches(":disabled")).toBe(true);
});

const effect = () => screen.getByRole<HTMLSelectElement>("combobox");
const reviewImpact = async (locale: "en" | "zh" = "en") => {
  const copy = (locale === "en" ? en : zh).programCalendar;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: copy.reviewImpact }));
  });
};

it.each(["en", "zh"] as const)("preselects existing pauses and requires review for new no-tutoring ranges in %s", (locale) => {
  state.days[0]!.schedulingEffect = "PAUSE_REGULAR";
  const copy = (locale === "en" ? en : zh).programCalendar;
  render(tree(locale));
  fireEvent.click(screen.getByRole("button", { name: copy.edit }));
  expect(effect().value).toBe("PAUSE_REGULAR");
  expect(screen.getByRole("button", { name: copy.reviewImpact })).toBeTruthy();
  expect(screen.queryByRole("button", { name: copy.save })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: (locale === "en" ? en : zh).accountProfile.close }));
  fireEvent.click(screen.getByRole("button", { name: copy.add }));
  expect(effect().value).toBe("PAUSE_REGULAR");
  expect(screen.getByRole("button", { name: copy.reviewImpact })).toBeTruthy();
  expect(screen.queryByRole("button", { name: copy.save })).toBeNull();
  expect(state.preview).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
});

it.each(["en", "zh"] as const)("reviews a read-only impact snapshot before applying a pause in %s", async (locale) => {
  const copy = (locale === "en" ? en : zh).programCalendar;
  render(tree(locale));
  fireEvent.click(screen.getByRole("button", { name: copy.edit }));
  fireEvent.change(effect(), { target: { value: "PAUSE_REGULAR" } });
  await reviewImpact(locale);
  expect(state.preview).toHaveBeenCalledWith({
    date: "2026-12-28", endDate: "2027-01-04", schedulingEffect: "PAUSE_REGULAR", expectedVersion: 3,
  }, { staleTime: 0 });
  expect(screen.getByText(copy.impactScope)).toBeTruthy();
  for (const [key, count] of [["impactPause", 4], ["impactRetain", 2], ["impactConfirm", 1], ["impactRestore", 3]] as const)
    expect(screen.getByText(copy[key].replace("{count}", String(count)))).toBeTruthy();
  expect(state.save).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.invalidate).not.toHaveBeenCalled();
  expect(state.sessionInvalidate).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.save })); });
  expect(state.save).toHaveBeenCalledExactlyOnceWith({
    date: "2026-12-28", endDate: "2027-01-04", reason: "Winter break", schedulingEffect: "PAUSE_REGULAR", expectedVersion: 3,
  });
  expect(state.sessionInvalidate).toHaveBeenCalledOnce();
});

it.each([
  ["en", "transport"], ["zh", "transport"], ["en", "internal"], ["zh", "internal"],
] as const)("localizes a failed preview and retains the editable draft/version for retry (%s, %s)", async (locale, failureKind) => {
  const copy = (locale === "en" ? en : zh).programCalendar;
  const raw = failureKind === "transport" ? "signal is aborted without reason" : "PRIVATE INTERNAL ERROR";
  state.preview.mockRejectedValueOnce(failureKind === "transport" ? new Error(raw) : { message: raw, data: { code: "INTERNAL_SERVER_ERROR" } });
  const view = render(tree(locale));
  fireEvent.click(screen.getByRole("button", { name: copy.edit }));
  fireEvent.change(effect(), { target: { value: "PAUSE_REGULAR" } });
  fireEvent.change(field(copy.endDate), { target: { value: "2027-01-08" } });
  fireEvent.change(field(copy.reason), { target: { value: "Retained synthetic draft" } });
  await reviewImpact(locale);
  expect(screen.getByRole("alert").textContent).toContain(copy.impactFailed);
  expect(screen.getByRole("alert").textContent).not.toContain(raw);
  expect(field(copy.endDate).value).toBe("2027-01-08");
  expect(field(copy.reason).value).toBe("Retained synthetic draft");
  expect(field(copy.endDate).matches(":disabled")).toBe(false);
  expect(effect().value).toBe("PAUSE_REGULAR");
  expect(state.save).not.toHaveBeenCalled();
  state.days = [{ ...state.days[0]!, version: 4, endDate: "2027-01-06" }];
  view.rerender(tree(locale));
  await reviewImpact(locale);
  expect(state.preview).toHaveBeenLastCalledWith(expect.objectContaining({ endDate: "2027-01-08", expectedVersion: 3 }), { staleTime: 0 });
  expect(field(copy.reason).value).toBe("Retained synthetic draft");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});

it.each(["en", "zh"] as const)("reloads an impact-read conflict only by an explicit successful read and adopts the fresh version (%s)", async (locale) => {
  const copy = (locale === "en" ? en : zh).programCalendar;
  state.days[0]!.schedulingEffect = "PAUSE_REGULAR";
  state.preview.mockRejectedValueOnce({ message: "PRIVATE STALE DETAILS", data: { code: "CONFLICT" } });
  const fresh = { ...state.days[0]!, endDate: "2027-01-10", reason: "Fresh synthetic notice", version: 4 };
  state.refetch.mockResolvedValueOnce({ isSuccess: false, error: new Error("signal is aborted without reason") })
    .mockResolvedValueOnce({ isSuccess: true, data: { days: [fresh] } });
  render(tree(locale));
  fireEvent.click(screen.getByRole("button", { name: copy.edit }));
  fireEvent.change(field(copy.endDate), { target: { value: "2027-01-08" } });
  fireEvent.change(field(copy.reason), { target: { value: "Draft before explicit reload" } });
  await reviewImpact(locale);
  expect(screen.getByRole("alert").textContent).toContain(copy.impactConflict);
  expect(screen.getByRole("alert").textContent).not.toContain("PRIVATE STALE DETAILS");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: copy.reviewImpact }).disabled).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.reload })); });
  expect(field(copy.endDate).value).toBe("2027-01-08");
  expect(field(copy.reason).value).toBe("Draft before explicit reload");
  expect(screen.getByRole("alert").textContent).toContain(copy.impactConflict);
  expect(state.save).not.toHaveBeenCalled();
  expect(state.preview).toHaveBeenCalledOnce();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.reload })); });
  expect(field(copy.endDate).value).toBe(fresh.endDate);
  expect(field(copy.reason).value).toBe(fresh.reason);
  expect(screen.queryByRole("alert")).toBeNull();
  await reviewImpact(locale);
  expect(state.preview).toHaveBeenLastCalledWith(expect.objectContaining({ endDate: fresh.endDate, expectedVersion: 4 }), { staleTime: 0 });
  expect(state.save).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.save })); });
  expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expectedVersion: 4, endDate: fresh.endDate, reason: fresh.reason }));
  expect(state.remove).not.toHaveBeenCalled();
});

it.each(["endDate", "reason", "effect"] as const)("requires a new review after the reviewed %s changes", async (changed) => {
  state.days[0]!.schedulingEffect = "PAUSE_REGULAR";
  render(tree());
  edit();
  await reviewImpact();
  if (changed === "endDate") fireEvent.change(field(en.programCalendar.endDate), { target: { value: "2027-01-08" } });
  if (changed === "reason") fireEvent.change(field(en.programCalendar.reason), { target: { value: "Updated optional arrangements" } });
  if (changed === "effect") fireEvent.change(effect(), { target: { value: "NOTICE" } });
  expect(screen.queryByText(en.programCalendar.impactScope)).toBeNull();
  expect(screen.queryByRole("button", { name: en.programCalendar.save })).toBeNull();
  await reviewImpact();
  expect(state.preview).toHaveBeenCalledTimes(2);
  expect(state.save).not.toHaveBeenCalled();
  await submit();
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ schedulingEffect: changed === "effect" ? "NOTICE" : "PAUSE_REGULAR" }));
});

it("freezes an in-flight impact read and ignores duplicate review submissions", async () => {
  let finish!: (value: { pauseCount: number; retainedExceptionCount: number; confirmationCount: number; restorationCount: number }) => void;
  state.preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(tree());
  edit();
  fireEvent.change(effect(), { target: { value: "PAUSE_REGULAR" } });
  const form = field(en.programCalendar.endDate).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(state.preview).toHaveBeenCalledOnce();
  expect(field(en.programCalendar.endDate).matches(":disabled")).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: en.accountProfile.close }).disabled).toBe(true);
  await act(async () => { finish({ pauseCount: 1, retainedExceptionCount: 0, confirmationCount: 0, restorationCount: 0 }); });
  expect(state.save).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: en.programCalendar.save }).disabled).toBe(false);
});

it("queues a reviewed pause without claiming that it was applied", async () => {
  state.canApply = false;
  state.save.mockRejectedValueOnce({ data: { approvalId: "pause-approval" } });
  render(tree());
  edit();
  fireEvent.change(effect(), { target: { value: "PAUSE_REGULAR" } });
  await reviewImpact();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.approvals.requestAdmin })); });
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ schedulingEffect: "PAUSE_REGULAR", expectedVersion: 3 }));
  expect(field(en.programCalendar.endDate).matches(":disabled")).toBe(true);
  expect(screen.queryByText(en.programCalendar.saved)).toBeNull();
  expect(state.invalidate).not.toHaveBeenCalled();
  expect(state.sessionInvalidate).not.toHaveBeenCalled();
});

it("reviews restoration before removing a pause and commits only from the named confirmation", async () => {
  state.days[0]!.schedulingEffect = "PAUSE_REGULAR";
  render(tree());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.programCalendar.remove })); });
  expect(state.preview).toHaveBeenCalledWith({ date: "2026-12-28", endDate: "2027-01-04", expectedVersion: 3, remove: true }, { staleTime: 0 });
  expect(state.remove).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(en.programCalendar.removePauseHelp)).toBeTruthy();
  expect(within(dialog).getByText(en.programCalendar.impactRestore.replace("{count}", "3"))).toBeTruthy();
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: en.programCalendar.remove })); });
  expect(state.remove).toHaveBeenCalledExactlyOnceWith({ date: "2026-12-28", expectedVersion: 3 });
  expect(state.sessionInvalidate).toHaveBeenCalledOnce();
});

it.each([
  ["en", "transport"], ["zh", "transport"], ["en", "conflict"], ["zh", "conflict"],
] as const)("recovers a failed removal preview by read only and keeps failed-refresh errors visible (%s, %s)", async (locale, failureKind) => {
  const copy = (locale === "en" ? en : zh).programCalendar;
  state.days[0]!.schedulingEffect = "PAUSE_REGULAR";
  state.preview.mockRejectedValueOnce(failureKind === "conflict"
    ? { message: "PRIVATE STALE REMOVAL", data: { code: "CONFLICT" } }
    : new Error("signal is aborted without reason"));
  state.refetch.mockRejectedValueOnce(new Error("PRIVATE REFRESH DETAIL"))
    .mockResolvedValueOnce({ isSuccess: false, error: new Error("Offline") })
    .mockImplementationOnce(async () => {
      state.days = [{ ...state.days[0]!, version: 4 }];
      return { isSuccess: true, data: { days: state.days } };
    });
  render(tree(locale));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.remove })); });
  const expected = failureKind === "conflict" ? copy.impactConflict : copy.impactFailed;
  expect(screen.getByRole("alert").textContent).toContain(expected);
  expect(screen.getByRole("alert").textContent).not.toMatch(/PRIVATE|signal is aborted/);
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.refresh })); });
    expect(screen.getByRole("alert").textContent).toContain(expected);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.preview).toHaveBeenCalledOnce();
  }
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.refresh })); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
  expect(state.preview).toHaveBeenCalledOnce();
  expect(state.invalidate).not.toHaveBeenCalled();
  expect(state.sessionInvalidate).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: copy.remove })); });
  expect(state.preview).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 4, remove: true }), { staleTime: 0 });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(state.remove).not.toHaveBeenCalled();
});

it("does not obtain a policy review after edit permission is revoked", () => {
  state.days[0]!.schedulingEffect = "PAUSE_REGULAR";
  const view = render(tree());
  edit();
  state.canEdit = false;
  view.rerender(tree());
  fireEvent.submit(field(en.programCalendar.endDate).closest("form")!);
  expect(state.preview).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
});

it.each(["en", "zh"] as const)(
  "preserves an explicit notice-only choice for a new range in %s",
  async (locale) => {
    const copy = (locale === "en" ? en : zh).programCalendar;
    render(tree(locale));
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    fireEvent.change(field(copy.startDate), {
      target: { value: "2027-02-03" },
    });
    fireEvent.change(field(copy.reason), {
      target: { value: "Synthetic information only" },
    });
    fireEvent.change(effect(), { target: { value: "NOTICE" } });
    expect(
      screen.queryByRole("button", { name: copy.reviewImpact }),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.save }));
    });
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.save).toHaveBeenCalledExactlyOnceWith({
      date: "2027-02-03",
      endDate: "2027-02-03",
      reason: "Synthetic information only",
      schedulingEffect: "NOTICE",
      expectedVersion: 0,
    });
  },
);

const openAddHoliday = () => {
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.addHoliday }),
  );
  fireEvent.change(field(en.schoolCalendar.from), {
    target: { value: "2026-11-26" },
  });
  fireEvent.change(field(en.schoolCalendar.to), {
    target: { value: "2026-11-28" },
  });
  fireEvent.change(field(en.schoolCalendar.note), {
    target: { value: "Thanksgiving holiday" },
  });
};
const submitHoliday = async () =>
  act(async () => {
    fireEvent.submit(field(en.schoolCalendar.note).closest("form")!);
  });

it.each(["en", "zh"] as const)(
  "groups contiguous school holidays alongside tutoring pauses in %s without showing weekday overrides",
  (locale) => {
    state.schoolDays = [
      schoolRow({ date: "2026-11-25", isSchoolDay: true, timetableWeekday: 5, note: "Friday timetable" }),
      schoolRow({ date: "2026-11-26", note: "Thanksgiving" }),
      schoolRow({ date: "2026-11-27", note: "Thanksgiving" }),
      schoolRow({ date: "2026-11-28", note: "Staff training" }),
    ];
    state.days = [
      {
        date: "2026-12-01",
        endDate: "2026-12-02",
        reason: "Exam week pause",
        active: true,
        version: 1,
        schedulingEffect: "PAUSE_REGULAR",
      },
    ];
    render(tree(locale));
    const copy = locale === "en" ? en : zh;
    expect(screen.getByText(copy.programCalendar.combinedTitle)).toBeTruthy();
    expect(screen.getByText("2026-11-26")).toBeTruthy();
    expect(screen.getByText("2026-11-27")).toBeTruthy();
    expect(screen.queryByText("2026-11-25")).toBeNull();
    expect(screen.getAllByText(copy.programCalendar.holidayEffect)).toHaveLength(2);
    expect(screen.getByText(copy.programCalendar.pauseEffectTable)).toBeTruthy();
    expect(screen.getByText(locale === "en" ? "2 days" : "2天")).toBeTruthy();
    expect(screen.getByText(locale === "en" ? "1 day" : "1天")).toBeTruthy();
  },
);

it("submits a new holiday range with captured absence, active and tombstone versions and previews replacements", async () => {
  state.days = [];
  state.schoolDays = [
    schoolRow({ date: "2026-11-27", isSchoolDay: true, timetableWeekday: 1, version: 4 }),
    schoolRow({ date: "2026-11-28", active: false, version: 7 }),
  ];
  render(tree());
  openAddHoliday();
  expect(
    screen.getByText(en.schoolCalendar.holidayReplaces.replace("{count}", "1")),
  ).toBeTruthy();
  await submitHoliday();
  expect(state.saveHoliday).toHaveBeenCalledWith({
    from: "2026-11-26",
    to: "2026-11-28",
    note: "Thanksgiving holiday",
    expectedVersions: [
      { date: "2026-11-26", version: 0 },
      { date: "2026-11-27", version: 4 },
      { date: "2026-11-28", version: 7 },
    ],
  });
  expect(screen.getByText(en.schoolCalendar.saved)).toBeTruthy();
});

it("mass-edits a grouped holiday (dates and note), previews resets and replacements, and submits union versions", async () => {
  state.days = [];
  state.schoolDays = [
    schoolRow({ date: "2026-11-26", version: 2, note: "Thanksgiving" }),
    schoolRow({ date: "2026-11-27", version: 3, note: "Thanksgiving" }),
    schoolRow({ date: "2026-11-28", isSchoolDay: true, timetableWeekday: 1, version: 5, note: "Make-up" }),
  ];
  render(tree());
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.edit }),
  );
  expect(field(en.schoolCalendar.from).value).toBe("2026-11-26");
  expect(field(en.schoolCalendar.to).value).toBe("2026-11-27");
  expect(field(en.schoolCalendar.note).value).toBe("Thanksgiving");
  // Shift range to 2026-11-27..2026-11-28: resets Nov 26, replaces Nov 28 make-up day.
  fireEvent.change(field(en.schoolCalendar.from), {
    target: { value: "2026-11-27" },
  });
  fireEvent.change(field(en.schoolCalendar.to), {
    target: { value: "2026-11-28" },
  });
  fireEvent.change(field(en.schoolCalendar.note), {
    target: { value: "Shifted Thanksgiving" },
  });
  expect(
    screen.getByText(en.schoolCalendar.holidayResets.replace("{count}", "1")),
  ).toBeTruthy();
  expect(
    screen.getByText(en.schoolCalendar.holidayReplaces.replace("{count}", "1")),
  ).toBeTruthy();
  await submitHoliday();
  expect(state.updateHoliday).toHaveBeenCalledWith({
    originalFrom: "2026-11-26",
    originalTo: "2026-11-27",
    from: "2026-11-27",
    to: "2026-11-28",
    note: "Shifted Thanksgiving",
    expectedVersions: [
      { date: "2026-11-26", version: 2 },
      { date: "2026-11-27", version: 3 },
      { date: "2026-11-28", version: 5 },
    ],
  });
  expect(state.saveHoliday).not.toHaveBeenCalled();
  expect(screen.getByText(en.schoolCalendar.saved)).toBeTruthy();
});

it("mass-resets a grouped holiday behind review confirmation and supports Coordinator proposals", async () => {
  state.days = [];
  state.schoolDays = [
    schoolRow({ date: "2026-11-26", version: 2, note: "Thanksgiving" }),
    schoolRow({ date: "2026-11-27", version: 3, note: "Thanksgiving" }),
  ];
  render(tree());
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.reset }),
  );
  expect(state.resetHoliday).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: en.schoolCalendar.reset }),
    );
  });
  expect(state.resetHoliday).toHaveBeenCalledWith({
    from: "2026-11-26",
    to: "2026-11-27",
    expectedVersions: [
      { date: "2026-11-26", version: 2 },
      { date: "2026-11-27", version: 3 },
    ],
  });
});

it("preserves holiday edit drafts on conflict, adopts fresh versions on reload, and blocks submit if externally removed", async () => {
  state.days = [];
  state.schoolDays = [
    schoolRow({ date: "2026-11-26", version: 2, note: "Thanksgiving" }),
    schoolRow({ date: "2026-11-27", version: 3, note: "Thanksgiving" }),
  ];
  state.updateHoliday.mockRejectedValueOnce(
    Object.assign(new Error("Range changed"), { data: { code: "CONFLICT" } }),
  );
  render(tree());
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.edit }),
  );
  fireEvent.change(field(en.schoolCalendar.note), {
    target: { value: "Edited draft" },
  });
  await submitHoliday();
  expect(field(en.schoolCalendar.note).value).toBe("Edited draft");
  // Reload while original holiday still exists with newer version -> keeps draft & adopts version.
  state.schoolDays = [
    schoolRow({ date: "2026-11-26", version: 4, note: "Thanksgiving" }),
    schoolRow({ date: "2026-11-27", version: 3, note: "Thanksgiving" }),
  ];
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.schoolCalendar.reloadHoliday }),
    );
  });
  expect(field(en.schoolCalendar.note).value).toBe("Edited draft");
  state.updateHoliday.mockRejectedValueOnce(
    Object.assign(new Error("Removed elsewhere"), { data: { code: "CONFLICT" } }),
  );
  await submitHoliday();
  expect(state.updateHoliday).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedVersions: [
        { date: "2026-11-26", version: 4 },
        { date: "2026-11-27", version: 3 },
      ],
    }),
  );
  // Reload after holiday was externally reset -> warns & disables submit.
  state.schoolDays = [
    schoolRow({ date: "2026-11-26", active: false, version: 5 }),
    schoolRow({ date: "2026-11-27", version: 3 }),
  ];
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.schoolCalendar.reloadHoliday }),
    );
  });
  expect(
    screen.getByText(en.schoolCalendar.holidayChangedExternally),
  ).toBeTruthy();
  expect(field(en.schoolCalendar.note).closest("fieldset")?.disabled).toBe(true);
});

it("recovers accepted holiday refresh failures by reads only and queues Coordinator holiday edits", async () => {
  state.days = [];
  state.schoolDays = [
    schoolRow({ date: "2026-11-26", version: 2, note: "Thanksgiving" }),
  ];
  state.schoolInvalidate.mockRejectedValueOnce(new Error("Offline"));
  render(tree());
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.edit }),
  );
  await submitHoliday();
  expect(screen.getByText(en.schoolCalendar.refreshFailed)).toBeTruthy();
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.schoolCalendar.refresh }),
    );
  });
  expect(state.updateHoliday).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(en.schoolCalendar.refreshFailed)).toBeNull();
});

it("keeps queued Coordinator holiday edits protected and isolates denied school-calendar access from tutoring notices", async () => {
  state.role = "COORDINATOR";
  state.schoolDays = [
    schoolRow({ date: "2026-11-26", version: 2, note: "Thanksgiving" }),
  ];
  state.updateHoliday.mockRejectedValueOnce({
    data: { approvalId: "holiday-edit-approval" },
  });
  const view = render(tree());
  fireEvent.click(
    screen.getByRole("button", { name: en.schoolCalendar.edit }),
  );
  await submitHoliday();
  expect(screen.getByText(en.approvals.queuedBody)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.close }),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.schoolCalendar.edit,
    }).disabled,
  ).toBe(true);

  // Authoritative denial on school calendar conceals holidays while keeping tutoring notices usable.
  state.schoolQueryError = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(tree());
  expect(screen.queryByText("2026-11-26")).toBeNull();
  expect(screen.getByText("2026-12-28")).toBeTruthy();
});
