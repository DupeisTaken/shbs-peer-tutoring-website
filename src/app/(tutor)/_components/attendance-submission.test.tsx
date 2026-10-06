/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttendanceForm } from "./attendance-form";
import { MergeProvider } from "./merge-context";

type Request = {
  input: Record<string, unknown>;
  resolve: () => void;
  reject: (error: Error) => void;
};
const transport = vi.hoisted(() => ({
  requests: [] as Request[],
  totals: vi.fn<() => Promise<void>>(),
  sessions: vi.fn<() => Promise<void>>(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: transport.refresh }),
}));
vi.mock("next-intl", () => ({
  useTimeZone: () => "Asia/Shanghai",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));

// Exercise the real form resolver, merge context and mutation lifecycle. Only
// transport is controlled, so a held response does not depend on manual flags.
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => ({
        tutor: {
          myMonthlyTotal: { fetch: transport.totals },
          mySessions: { invalidate: transport.sessions },
        },
      }),
      program: { features: { useQuery: () => ({ data: {} }) } },
      tutor: {
        myPairings: {
          useQuery: () => ({
            data: [
              {
                id: "pairing",
                subject: "Synthetic subject",
                scheduleConfirmed: true,
                dayOfWeek: 1,
                startMin: 900,
                endMin: 960,
                room: null,
                tutees: [],
              },
            ],
          }),
        },
        myTuteeDiscipline: { useQuery: () => ({ data: [] }) },
        rooms: { useQuery: () => ({ data: [] }) },
        schedule: { useQuery: () => ({ data: { pairings: [], blocks: [] } }) },
        submitAttendance: {
          useMutation(options: {
            onSuccess: () => Promise<void>;
            onError: () => void;
          }) {
            return useMutation({
              mutationFn: (input: Record<string, unknown>) =>
                new Promise<void>((resolve, reject) => {
                  transport.requests.push({ input, resolve, reject });
                }),
              ...options,
            });
          },
        },
      },
    },
  };
});

let client: QueryClient;
beforeEach(() => {
  transport.requests = [];
  transport.totals.mockReset().mockResolvedValue(undefined);
  transport.sessions.mockReset().mockResolvedValue(undefined);
  transport.refresh.mockClear();
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function show() {
  render(
    <QueryClientProvider client={client}>
      <MergeProvider>
        <AttendanceForm />
      </MergeProvider>
    </QueryClientProvider>,
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
    target: { value: "pairing" },
  });
  fireEvent.change(screen.getByLabelText("tutor.attendance.comments"), {
    target: { value: "Synthetic attendance draft" },
  });
  for (const field of [
    "Preparedness",
    "Participation",
    "Understanding",
    "Behavior",
    "Progress",
  ]) {
    fireEvent.click(
      screen.getByRole("radio", {
        name: `tutor.attendance.rating.rating${field}: 3 · tutor.attendance.likert.3`,
      }),
    );
  }
}
async function submit(times = 1) {
  const form = screen
    .getByLabelText("tutor.attendance.comments")
    .closest("form")!;
  await act(async () => {
    // Dispatch in the same turn, before async validation or React can disable
    // the form. Direct submission also checks admission during saved/pending UI.
    for (let attempt = 0; attempt < times; attempt++) fireEvent.submit(form);
  });
}

it("admits one same-turn submission, retains a rejected draft and permits its retry", async () => {
  show();
  fill();
  await submit(2);
  await waitFor(() => expect(transport.requests).toHaveLength(1));
  const request = transport.requests[0]!;
  await submit();
  expect(transport.requests).toHaveLength(1);
  await act(async () => {
    request.reject(new Error("Synthetic write failure"));
  });
  await screen.findByRole("alert");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("tutor.attendance.comments")
      .value,
  ).toBe("Synthetic attendance draft");
  await submit();
  await waitFor(() => expect(transport.requests).toHaveLength(2));
  expect(transport.requests[1]!.input).toEqual(request.input);
  await act(async () => {
    transport.requests[1]!.resolve();
  });
  await screen.findByRole("status");
});

it("keeps acceptance locked through failed refresh and read-only retry until an explicit new entry", async () => {
  let failTotals!: (error: Error) => void;
  transport.totals.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        failTotals = reject;
      }),
  );
  show();
  fill();
  await submit();
  await waitFor(() => expect(transport.requests).toHaveLength(1));
  await act(async () => {
    transport.requests[0]!.resolve();
  });
  await waitFor(() => expect(transport.totals).toHaveBeenCalledOnce());
  await submit();
  expect(transport.requests).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "tutor.attendance.submitAnother" }),
  ).toBeNull();
  await act(async () => {
    failTotals(new Error("Synthetic refresh failure"));
  });
  await screen.findByRole("status");
  expect(screen.getByRole("alert").textContent).toContain(
    "tutor.tasks.savedRefreshError",
  );
  await submit();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "tutor.tasks.retry" }));
  });
  expect(transport.requests).toHaveLength(1);
  expect(transport.totals).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "tutor.attendance.submitAnother" }),
  );
  fill();
  await submit();
  await waitFor(() => expect(transport.requests).toHaveLength(2));
  await act(async () => {
    transport.requests[1]!.resolve();
  });
  await screen.findByRole("status");
});

it("leaves a locally invalid draft editable without consuming submission admission", async () => {
  show();
  fill();
  fireEvent.change(screen.getByLabelText("tutor.attendance.tutorStatus"), {
    target: { value: "TUTOR_ABSENT" },
  });
  await submit();
  expect(transport.requests).toHaveLength(0);
  expect(screen.getByRole("alert").textContent).toContain(
    "tutor.attendance.errors.absenceReason",
  );
  fireEvent.change(screen.getByLabelText("tutor.attendance.tutorAbsentReason"), {
    target: { value: "Synthetic absence reason" },
  });
  await submit();
  await waitFor(() => expect(transport.requests).toHaveLength(1));
  await act(async () => {
    transport.requests[0]!.resolve();
  });
  await screen.findByRole("status");
});
