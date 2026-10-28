/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
};
const state = vi.hoisted(() => ({
  days: [] as Day[],
  canEdit: true,
  canApply: true,
  pending: false,
  queryError: null as Error | null,
  mutationError: null as null | {
    data: { code?: string; approvalId?: string };
  },
  save: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      program: {
        calendarSettings: { invalidate: state.invalidate },
        calendar: { invalidate: state.invalidate },
      },
    }),
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
  },
}));

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
  state.canEdit = true;
  state.canApply = true;
  state.pending = false;
  state.queryError = null;
  state.mutationError = null;
  state.save.mockResolvedValue({});
  state.invalidate.mockResolvedValue(undefined);
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
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}>
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
      screen.getByRole("button", { name: en.programCalendar.save }),
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
      expectedVersion: 3,
    });
  },
);

it("defaults a new notice to one day and blocks a reversed or missing end date", async () => {
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
  expect(state.save).toHaveBeenCalledWith({
    date: "2027-02-03",
    endDate: "2027-02-03",
    reason: "School event",
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
