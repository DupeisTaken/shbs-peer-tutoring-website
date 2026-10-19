/** @vitest-environment jsdom */
import { useState, type ComponentProps } from "react";
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
import { RoomOrderEditor as InlineRoomOrderEditor } from "./room-order-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn<(value: unknown) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  refetch: vi.fn(),
  fetch: vi.fn(),
  refresh: vi.fn(),
  error: null as Error | null,
  version: 7,
  canApply: true,
  canEdit: true,
  reason: "Original notice",
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
            endDate: "2026-10-12",
            reason: mocks.reason,
            active: true,
            version: 4,
          },
        ],
        canEdit: mocks.canEdit,
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
  mocks.canEdit = true;
  mocks.reason = "Original notice";
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
function RoomOrderEditor(
  props: Omit<ComponentProps<typeof InlineRoomOrderEditor>, "children">,
) {
  return (
    <InlineRoomOrderEditor {...props}>
      {(room, controls) => (
        <article aria-label={room.name}>
          <h2>{room.name}</h2>
          <div>{controls}</div>
          <input aria-label={`${room.name} room draft`} defaultValue="" />
        </article>
      )}
    </InlineRoomOrderEditor>
  );
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
    endDate: "2026-10-12",
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
  show(<RoomOrderEditor rooms={rooms} canEdit canApply onRefresh={refresh} />);
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
it("reorders the existing keyed rooms without a dialog, retains detail drafts, and excludes duplicate pending writes", async () => {
  const rooms = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];
  const pending = deferred();
  mocks.save.mockReturnValueOnce(pending.promise);
  show(
    <RoomOrderEditor
      rooms={rooms}
      canEdit
      canApply
      onRefresh={async () => rooms}
    />,
  );
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("button", { name: en.roomOrder.open })).toBeNull();
  const detailDraft = screen.getByRole<HTMLInputElement>("textbox", {
    name: "Alpha room draft",
  });
  fireEvent.change(detailDraft, {
    target: { value: "Unrelated unsaved detail" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: en.roomOrder.moveDownName.replace("{name}", "Alpha"),
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen
      .getAllByRole("article")
      .map((node) => node.getAttribute("aria-label")),
  ).toEqual(["Beta", "Alpha"]);
  expect(screen.getByRole("textbox", { name: "Alpha room draft" })).toBe(
    detailDraft,
  );
  expect(detailDraft.value).toBe("Unrelated unsaved detail");
  expect(document.activeElement).toBe(
    screen.getByRole("button", {
      name: en.roomOrder.moveUpName.replace("{name}", "Alpha"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.save }));
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.saving }));
  expect(mocks.save).toHaveBeenCalledWith({
    ids: ["b", "a"],
    expectedIds: ["a", "b"],
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.roomOrder.reload,
    }).disabled,
  ).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => pending.resolve({}));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: en.roomOrder.reload,
      }).disabled,
    ).toBe(false),
  );
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("keeps room order non-editable for observers and labels Admin edits as proposals", () => {
  const rooms = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];
  const view = show(
    <RoomOrderEditor
      rooms={rooms}
      canEdit={false}
      onRefresh={async () => rooms}
    />,
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.roomOrder.moveDownName.replace("{name}", "Alpha"),
    }).disabled,
  ).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <RoomOrderEditor
        rooms={rooms}
        canEdit
        canApply={false}
        onRefresh={async () => rooms}
      />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole("button", { name: en.roomOrder.request }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: en.roomOrder.save })).toBeNull();
});
it("shows a changed current catalog once and adopts its order only after an explicit successful Reload", async () => {
  const rooms = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];
  const latest = [...rooms, { id: "c", name: "Gamma" }];
  const refresh = vi
    .fn<() => Promise<typeof rooms>>()
    .mockRejectedValueOnce(new Error("Read unavailable"))
    .mockResolvedValue(latest);
  const view = show(
    <RoomOrderEditor rooms={rooms} canEdit canApply onRefresh={refresh} />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: en.roomOrder.moveDownName.replace("{name}", "Alpha"),
    }),
  );
  view.rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <RoomOrderEditor rooms={latest} canEdit canApply onRefresh={refresh} />
    </NextIntlClientProvider>,
  );
  expect(
    screen
      .getAllByRole("article")
      .map((node) => node.getAttribute("aria-label")),
  ).toEqual(["Beta", "Alpha", "Gamma"]);
  expect(screen.getByText(en.roomOrder.catalogChanged)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: en.roomOrder.save })
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.reload }));
  await screen.findByText(en.roomOrder.loadFailed);
  expect(screen.getAllByRole("article")[0]?.getAttribute("aria-label")).toBe(
    "Beta",
  );
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.reload }));
  await waitFor(() =>
    expect(screen.queryByText(en.roomOrder.catalogChanged)).toBeNull(),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: en.roomOrder.moveDownName.replace("{name}", "Alpha"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.save }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith({
      ids: ["b", "a", "c"],
      expectedIds: ["a", "b", "c"],
    }),
  );
});
it("keeps an accepted Admin order proposal read-only through refresh without repeating the request", async () => {
  const rooms = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];
  mocks.save.mockRejectedValueOnce(
    Object.assign(new Error("Queued"), {
      data: { approvalId: "order-request" },
    }),
  );
  const refresh = vi.fn(async () => rooms);
  show(
    <RoomOrderEditor
      rooms={rooms}
      canEdit
      canApply={false}
      onRefresh={refresh}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: en.roomOrder.moveDownName.replace("{name}", "Alpha"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.request }));
  await screen.findByText(en.approvals.queuedBody);
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.request }));
  fireEvent.click(screen.getByRole("button", { name: en.roomOrder.reload }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.roomOrder.request,
    }).disabled,
  ).toBe(true);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps long calendar reasons in a full readonly Details reader without granting edits", () => {
  mocks.canEdit = false;
  mocks.reason = "完整的原始通知理由。".repeat(30);
  show(<ProgramCalendarSettings />);
  expect(screen.queryByText(mocks.reason)).toBeNull();
  expect(
    screen
      .getByText(mocks.reason.slice(0, 80) + "…")
      .classList.contains("line-clamp-2"),
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: en.programCalendar.edit }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(en.programCalendar.details),
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(mocks.reason),
  ).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
});
