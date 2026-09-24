/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import RoomsPage from "./page";

const mocks = vi.hoisted(() => ({
  role: "ADMIN",
  pending: false,
  loading: false,
  queryError: null as { message: string } | null,
  writeError: null as { message: string; data?: { approvalId: string } } | null,
  calls: [] as { operation: string; input: unknown }[],
  invalidate: vi.fn(async () => undefined),
  refetch: vi.fn(),
}));

vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => mocks.role === "VIEWER",
}));
vi.mock("~/trpc/react", () => {
  const mutation = (operation: string) => ({
    useMutation: (options: {
      onSuccess: () => Promise<unknown>;
      onError: (error: NonNullable<typeof mocks.writeError>) => void;
    }) => ({
      isPending: mocks.pending,
      mutate: (input: unknown) => {
        mocks.calls.push({ operation, input });
        if (mocks.writeError) options.onError(mocks.writeError);
        else void options.onSuccess();
      },
    }),
  });
  return {
    api: {
      useUtils: () => ({ admin: { rooms: { invalidate: mocks.invalidate } } }),
      account: {
        me: {
          useQuery: () => ({
            data: { role: mocks.role },
            isLoading: false,
            error: null,
            refetch: mocks.refetch,
          }),
        },
      },
      admin: {
        rooms: {
          useQuery: () => ({
            data: mocks.loading
              ? undefined
              : [
                  {
                    id: "room",
                    name: "Science room",
                    unavailabilities: [
                      {
                        id: "block",
                        dayOfWeek: 1,
                        startMin: 1380,
                        endMin: 1440,
                        reason: "Weekly maintenance",
                      },
                    ],
                  },
                ],
            isLoading: mocks.loading,
            error: mocks.queryError,
            refetch: mocks.refetch,
          }),
        },
        createRoom: mutation("createRoom"),
        updateRoom: mutation("updateRoom"),
        deleteRoom: mutation("deleteRoom"),
        createRoomUnavailability: mutation("createBlock"),
        updateRoomUnavailability: mutation("editBlock"),
        deleteRoomUnavailability: mutation("removeBlock"),
      },
    },
  };
});

beforeEach(() => {
  mocks.role = "ADMIN";
  mocks.pending = false;
  mocks.loading = false;
  mocks.queryError = null;
  mocks.writeError = null;
  mocks.calls = [];
  vi.clearAllMocks();
});
afterEach(cleanup);
const show = () =>
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <RoomsPage />
    </NextIntlClientProvider>,
  );
const expand = () =>
  fireEvent.click(
    screen.getByRole("button", {
      name: /Manage blocked periods|View blocked periods/,
    }),
  );

it("makes block controls discoverable and exposes accessible expanded state", () => {
  show();
  expect(screen.getByText("1 blocked period")).toBeTruthy();
  const toggle = screen.getByRole("button", { name: "Manage blocked periods" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expand();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(
    document.getElementById(toggle.getAttribute("aria-controls")!),
  ).toBeTruthy();
  expect(screen.getByText("Weekly maintenance")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Edit period: Monday 23:00" }),
  ).toBeTruthy();
});

it("edits an existing midnight-ending block without losing fields", async () => {
  show();
  expand();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit period: Monday 23:00" }),
  );
  expect(screen.getByRole("combobox", { name: "Day" })).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("End time").value).toBe(
    "24:00",
  );
  fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Start time"), {
    target: { value: "22:00" },
  });
  fireEvent.change(screen.getByLabelText("Reason (optional)"), {
    target: { value: "  New maintenance time  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save blocked period" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Changes saved"),
  );
  expect(mocks.calls).toEqual([
    {
      operation: "editBlock",
      input: {
        id: "block",
        dayOfWeek: 2,
        startMin: 1320,
        endMin: 1440,
        reason: "New maintenance time",
      },
    },
  ]);
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  expect(screen.queryByRole("form", { name: "Edit period" })).toBeNull();
});

it("retains an invalid or conflicting draft and only sends a valid corrected range", () => {
  mocks.writeError = {
    message: "This time overlaps another blocked period for the room.",
  };
  show();
  expand();
  fireEvent.click(screen.getByRole("button", { name: "Add blocked period" }));
  fireEvent.change(screen.getByLabelText("End time"), {
    target: { value: "11:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save blocked period" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "end after the start",
  );
  expect(mocks.calls).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("End time"), {
    target: { value: "13:00" },
  });
  fireEvent.change(screen.getByLabelText("Reason (optional)"), {
    target: { value: "Keep my draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save blocked period" }));
  expect(screen.getByRole("alert").textContent).toContain("overlaps");
  expect(
    screen.getByLabelText<HTMLInputElement>("Reason (optional)").value,
  ).toBe("Keep my draft");
  expect(mocks.calls).toEqual([
    {
      operation: "createBlock",
      input: {
        roomId: "room",
        dayOfWeek: 1,
        startMin: 720,
        endMin: 780,
        reason: "Keep my draft",
      },
    },
  ]);
});

it("confirms removal and surfaces a failed removal while retaining the block", () => {
  mocks.writeError = {
    message: "This blocked period no longer exists. Refresh the room list.",
  };
  show();
  expand();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Period: Monday 23:00" }),
  );
  expect(mocks.calls).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  expect(mocks.calls).toEqual([
    { operation: "removeBlock", input: { id: "block" } },
  ]);
  expect(screen.getByRole("alert").textContent).toContain(
    "Refresh the room list",
  );
  expect(screen.getByText("Weekly maintenance")).toBeTruthy();
});

it("labels coordinator requests and shows the review link without reporting a live save", () => {
  mocks.role = "COORDINATOR";
  mocks.writeError = { message: "Queued", data: { approvalId: "request-67" } };
  show();
  expand();
  expect(
    screen.getByRole("button", { name: "Request new block" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Request edit: Monday 23:00" }),
  );
  fireEvent.change(screen.getByLabelText("Reason (optional)"), {
    target: { value: "Proposed reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  expect(screen.getByRole("status").textContent).toContain(
    "Live room availability has not changed",
  );
  expect(
    screen.getByRole("link", { name: "View request" }).getAttribute("href"),
  ).toBe("/admin/approvals?request=request-67");
  expect(screen.getByText("Weekly maintenance")).toBeTruthy();
  expect(mocks.invalidate).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("allows viewers to inspect periods without write controls", () => {
  mocks.role = "VIEWER";
  show();
  expand();
  expect(screen.getByText("Weekly maintenance")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /Add|Edit|Remove|Request/ }),
  ).toBeNull();
  expect(screen.queryByLabelText("New room name")).toBeNull();
});

it("shows loading and retry feedback and disables writes while a mutation is pending", () => {
  mocks.loading = true;
  const view = show();
  expect(screen.getByRole("status").textContent).toContain("Loading rooms");
  mocks.loading = false;
  mocks.queryError = { message: "Cannot load rooms" };
  mocks.pending = true;
  view.rerender(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      <RoomsPage />
    </NextIntlClientProvider>,
  );
  expect(screen.getByRole("alert").textContent).toContain("Cannot load rooms");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.refetch).toHaveBeenCalled();
  expand();
  expect(
    screen
      .getByRole("button", { name: "Add blocked period" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Edit period: Monday 23:00" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
