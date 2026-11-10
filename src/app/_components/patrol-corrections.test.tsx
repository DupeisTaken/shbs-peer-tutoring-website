/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { installSessionReadReceipts } from "~/lib/session-read-receipts";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { PatrolCorrections } from "./patrol-corrections";

const { mutate, row, state } = vi.hoisted(() => ({
  mutate: vi.fn().mockRejectedValue(new Error("Synthetic rejected correction")),
  state: {
    loaded: true,
    count: 1,
    error: null as null | { message: string; data?: { code?: string } },
    refetch: vi.fn(),
    input: ((): unknown => undefined)(),
  },
  row: {
    id: "synthetic-patrol",
    createdAt: new Date("2026-11-01T06:30:00Z"),
    updatedAt: new Date("2026-11-01T06:30:00Z"),
    hours: 0.5,
    note: null,
    crewUser: { name: "Synthetic crew" },
    observations: [
      {
        id: "observation",
        roomId: "room",
        room: { name: "Synthetic room" },
        headcount: "ONE",
        observedAt: new Date("2026-11-01T06:30:00Z"),
      },
    ],
  },
}));
vi.mock("~/trpc/react", () => {
  const rooms = [{ id: "room", name: "Synthetic room" }];
  let rows: (typeof row)[] = [];
  let count = -1;
  return {
    api: {
      useUtils: () => ({}),
      admin: {
        rooms: {
          _def: () => ({ path: ["admin", "rooms"] }),
          useQuery: () => ({ data: rooms }),
        },
      },
      corrections: {
        patrolById: { _def: () => ({ path: ["corrections", "patrolById"] }) },
        patrols: {
          _def: () => ({ path: ["corrections", "patrols"] }),
          useQuery: (input: unknown) => {
            state.input = input;
            if (count !== state.count) {
              count = state.count;
              rows = Array.from({ length: state.count }, (_, index) =>
                index === 0 ? row : { ...row, id: `synthetic-patrol-${index}` },
              );
            }
            return {
              data: state.loaded ? rows : undefined,
              error: state.error,
              isSuccess: state.loaded && !state.error,
              isFetching: false,
              refetch: state.refetch,
            };
          },
        },
        correctPatrol: {
          useMutation: () => ({
            mutateAsync: mutate,
            reset: vi.fn(),
            isPending: false,
          }),
        },
      },
    },
  };
});
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  installSessionReadReceipts(client);
});
function render(ui: ReactNode) {
  return renderDom(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
afterEach(() => {
  cleanup();
  client.clear();
  state.loaded = true;
  state.count = 1;
  state.error = null;
  vi.clearAllMocks();
});

it.each([
  ["ZERO", "0"],
  ["ONE", "1"],
  ["TWO", "2"],
  ["THREE", "3"],
  ["FOUR_PLUS", "4+"],
])(
  "renders stored %s headcount as %s without exposing its enum",
  (bucket, label) => {
    const original = row.observations[0]!.headcount;
    row.observations[0]!.headcount = bucket;
    render(
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <PatrolCorrections />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(`Synthetic room: ${label}`)).toBeTruthy();
    expect(screen.queryByText(`Synthetic room: ${bucket}`)).toBeNull();
    row.observations[0]!.headcount = original;
  },
);

it("labels a stored repeated-hour instant correctly and updates the offset when editing its date", async () => {
  const { container } = render(
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="America/New_York"
    >
      <PatrolCorrections />
    </NextIntlClientProvider>,
  );
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const input = screen.getByLabelText<HTMLInputElement>(/EST \(GMT-05:00\)/);
  expect(input.value).toBe("2026-11-01T01:30");
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });
  expect(mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      observations: [
        expect.objectContaining({
          observedAt: new Date("2026-11-01T06:30:00Z"),
        }),
      ],
    }),
  );
  fireEvent.change(input, { target: { value: "2026-07-15T09:00" } });
  expect(screen.getByLabelText(/EDT \(GMT-04:00\)/)).toBe(input);
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });
  expect(mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      observations: [
        expect.objectContaining({
          observedAt: new Date("2026-07-15T13:00:00Z"),
        }),
      ],
    }),
  );
});

it("reports patrol read/page readiness without sharing opaque cursors, evidence or editor drafts", () => {
  const onViewReadState = vi.fn();
  state.loaded = false;
  const show = () => (
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="Asia/Shanghai"
    >
      <PatrolCorrections onViewReadState={onViewReadState} />
    </NextIntlClientProvider>
  );
  const view = render(show());
  expect(onViewReadState).toHaveBeenLastCalledWith({
    ready: false,
    denied: false,
    page: 0,
  });
  state.loaded = true;
  state.count = 50;
  view.rerender(show());
  expect(onViewReadState).toHaveBeenLastCalledWith({
    ready: true,
    denied: false,
    page: 0,
  });
  fireEvent.click(
    screen.getByRole("button", { name: messages.corrections.older }),
  );
  expect(state.input).toEqual({ cursor: "synthetic-patrol-49" });
  expect(onViewReadState).toHaveBeenLastCalledWith({
    ready: true,
    denied: false,
    page: 1,
  });
  expect(JSON.stringify(onViewReadState.mock.calls)).not.toContain(
    "synthetic-patrol",
  );
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(show());
  expect(onViewReadState).toHaveBeenLastCalledWith({
    ready: false,
    denied: true,
    page: 1,
  });
  expect(screen.queryByText(/Synthetic crew/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  state.error = { message: "Network failure" };
  view.rerender(show());
  expect(screen.queryByText(/Synthetic crew/)).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
});
