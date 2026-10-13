/** @vitest-environment jsdom */
import { useState } from "react";
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
import en from "../../../messages/en.json";
import {
  DEFAULT_NAME_FIELDS,
  nameFieldPolicies,
} from "~/lib/name-field-policy";
import { ProgramCalendarSettings } from "./program-calendar";
import { ProgramNameSettings } from "./program-name-settings";
import { RoomOrderEditor } from "./room-order-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn<(value: unknown) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  refetch: vi.fn(),
  fetch: vi.fn(),
  refresh: vi.fn(),
  error: null as Error | null,
  version: 7,
  canApply: true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("~/trpc/react", () => {
  const policy = () => ({
    version: mocks.version,
    policies: nameFieldPolicies({}),
    canEdit: true,
    canApply: mocks.canApply,
  });
  const useMutation = () => {
    const [isPending, setPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    return {
      isPending,
      error,
      reset: () => setError(null),
      mutateAsync: async (input: unknown) => {
        setPending(true);
        setError(null);
        try {
          return await mocks.save(input);
        } catch (failure) {
          setError(failure as Error);
          throw failure;
        } finally {
          setPending(false);
        }
      },
    };
  };
  const calendarSettings = {
    useQuery: () => ({
      data: {
        days: [
          {
            date: "2026-10-12",
            reason: "Original notice",
            active: true,
            version: 4,
          },
        ],
        canEdit: true,
        canApply: mocks.canApply,
      },
      error: mocks.error,
      refetch: mocks.refetch,
    }),
  };
  return {
    api: {
      useUtils: () => ({
        invalidate: mocks.invalidate,
        program: {
          calendarSettings: { invalidate: mocks.invalidate },
          calendar: { invalidate: mocks.invalidate },
          nameFieldSettings: { fetch: mocks.fetch },
        },
      }),
      program: {
        calendarSettings,
        setCalendarDay: { useMutation },
        removeCalendarDay: { useMutation },
        nameFieldSettings: {
          useQuery: () => ({
            data: policy(),
            error: mocks.error,
            refetch: mocks.refetch,
          }),
        },
        setNameFields: { useMutation },
      },
      admin: { reorderRooms: { useMutation } },
    },
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.error = null;
  mocks.version = 7;
  mocks.canApply = true;
  mocks.save.mockResolvedValue({});
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue({
    version: 8,
    policies: nameFieldPolicies({}),
  });
  mocks.refetch.mockResolvedValue({
    isSuccess: true,
    data: { version: 8, policies: nameFieldPolicies({}) },
  });
});
afterEach(cleanup);
function show(child: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {child}
    </NextIntlClientProvider>,
  );
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function calendarEdit() {
  fireEvent.click(
    screen.getByRole("button", { name: en.programCalendar.edit }),
  );
  return screen.getByRole("dialog");
}

it("keeps a calendar draft/version across failed writes and blocks same-tick duplicates and dismissal during a write", async () => {
  const pending = deferred();
  mocks.save
    .mockRejectedValueOnce(new Error("Write unavailable"))
    .mockReturnValueOnce(pending.promise);
  show(<ProgramCalendarSettings />);
  const dialog = calendarEdit();
  fireEvent.change(within(dialog).getByLabelText(en.programCalendar.reason), {
    target: { value: "Unsaved reason" },
  });
  const form = dialog.querySelector("form")!;
  fireEvent.submit(form);
  await screen.findByText("Write unavailable");
  expect(
    within(dialog).getByLabelText<HTMLTextAreaElement>(
      en.programCalendar.reason,
    ).value,
  ).toBe("Unsaved reason");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenLastCalledWith({
    date: "2026-10-12",
    reason: "Unsaved reason",
    expectedVersion: 4,
  });
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(true);
  fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () => pending.resolve({}));
  await screen.findByText(en.programCalendar.saved);
});
it("recovers an accepted calendar write through reads only and locks a queued proposal", async () => {
  mocks.invalidate.mockRejectedValueOnce(new Error("Refresh unavailable"));
  show(<ProgramCalendarSettings />);
  const dialog = calendarEdit();
  fireEvent.submit(dialog.querySelector("form")!);
  await screen.findByText(en.programCalendar.refreshFailed);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  fireEvent.submit(dialog.querySelector("form")!);
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.programCalendar.refresh }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.programCalendar.refreshFailed)).toBeNull(),
  );
  expect(mocks.save).toHaveBeenCalledTimes(1);
  cleanup();
  mocks.save.mockRejectedValue(
    Object.assign(new Error("Queued"), { data: { approvalId: "request-1" } }),
  );
  show(<ProgramCalendarSettings />);
  const queued = calendarEdit();
  fireEvent.submit(queued.querySelector("form")!);
  await screen.findByText(en.approvals.queuedBody);
  expect(queued.querySelector("fieldset")!.disabled).toBe(true);
  fireEvent.submit(queued.querySelector("form")!);
  expect(mocks.save).toHaveBeenCalledTimes(2);
});
it("retains a name-policy draft on conflict and adopts a new version only after explicit successful Reload", async () => {
  mocks.save.mockRejectedValue(
    Object.assign(new Error("Policy changed"), { data: { code: "CONFLICT" } }),
  );
  const view = show(<ProgramNameSettings />);
  fireEvent.click(
    screen.getAllByRole("button", { name: en.nameFields.configure })[0]!,
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(en.personName.lastName), {
    target: { value: "required" },
  });
  fireEvent.submit(dialog.querySelector("form")!);
  await screen.findByText("Policy changed");
  mocks.version = 20;
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProgramNameSettings />
    </NextIntlClientProvider>,
  );
  expect(
    within(dialog).getByLabelText<HTMLSelectElement>(en.personName.lastName)
      .value,
  ).toBe("required");
  fireEvent.submit(dialog.querySelector("form")!);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save).toHaveBeenLastCalledWith({
    accountType: "STUDENT",
    states: { ...DEFAULT_NAME_FIELDS, lastName: "required" },
    expectedVersion: 7,
  });
  mocks.refetch.mockResolvedValueOnce({
    isSuccess: false,
    error: new Error("Read unavailable"),
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.nameFields.reload }),
  );
  await screen.findByText(en.nameFields.loadFailed);
  expect(
    within(dialog).getByLabelText<HTMLSelectElement>(en.personName.lastName)
      .value,
  ).toBe("required");
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.nameFields.reload }),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByLabelText<HTMLSelectElement>(
        en.personName.lastName,
      ).value,
    ).toBe("optional"),
  );
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
  expect(mocks.save).toHaveBeenLastCalledWith({
    accountType: "STUDENT",
    states: DEFAULT_NAME_FIELDS,
    expectedVersion: 8,
  });
});
it("does not replay accepted name-policy saves after synchronization fails", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("Read failed"));
  show(<ProgramNameSettings />);
  fireEvent.click(
    screen.getAllByRole("button", { name: en.nameFields.configure })[0]!,
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.submit(dialog.querySelector("form")!);
  await screen.findByText(en.nameFields.refreshFailed);
  fireEvent.submit(dialog.querySelector("form")!);
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.nameFields.refresh }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.nameFields.refreshFailed)).toBeNull(),
  );
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("keeps reordered room drafts on write failures and recovers accepted order through reads only", async () => {
  const rooms = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];
  const refresh = vi
    .fn<() => Promise<typeof rooms>>()
    .mockRejectedValueOnce(new Error("Read unavailable"))
    .mockResolvedValue([rooms[1]!, rooms[0]!]);
  mocks.save
    .mockRejectedValueOnce(new Error("Write unavailable"))
    .mockResolvedValue({});
  show(<RoomOrderEditor rooms={rooms} canEdit onRefresh={refresh} />);
  fireEvent.click(
    screen.getByRole("button", {
      name: en.roomOrder.moveDownName.replace("{name}", "Alpha"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.save }));
  await screen.findByText("Write unavailable");
  expect(mocks.save).toHaveBeenLastCalledWith({
    ids: ["b", "a"],
    expectedIds: ["a", "b"],
  });
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.save }));
  await screen.findByText(en.roomOrder.refreshFailed);
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.refresh }));
  await waitFor(() =>
    expect(screen.queryByText(en.roomOrder.refreshFailed)).toBeNull(),
  );
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(2);
});
