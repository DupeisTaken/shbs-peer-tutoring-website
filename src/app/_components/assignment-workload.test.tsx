/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { QualifiedTutorSelect } from "./qualified-tutor-select";
import { AssignmentWorkloadAdvice } from "./assignment-workload";
import { invalidateWorkloads } from "~/lib/workload-cache";

const state = vi.hoisted(() => ({
  client: null as QueryClient | null,
  read: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: () => ["assignment-workload"],
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      admin: {
        assignmentWorkloads: {
          useQuery: (_input: unknown, options: object) =>
            useQuery({
              queryKey: ["assignment-workload"],
              queryFn: state.read,
              ...options,
            }),
        },
        subjects: {
          useQuery: () => ({ data: [{ id: "math", active: true }] }),
        },
        subjectEligibility: {
          useQuery: () => ({ data: [{ tutorId: "a", subjectId: "math" }] }),
        },
      },
    },
  };
});
const workload = (count = 1, preferredMaximum: number | null = 1) => ({
  termId: "term",
  tutors: [
    {
      id: "a",
      count,
      preferredMaximum,
      status: "ACTIVE",
      assignable: true,
      version: 0,
      blocks: count
        ? [
            {
              key: JSON.stringify(["term", 1, 900, 960]),
              pairingIds: ["shared-a", "shared-b"],
            },
          ]
        : [],
    },
    {
      id: "zero",
      count: 0,
      preferredMaximum: null,
      blocks: [],
      status: "ACTIVE",
      assignable: true,
      version: 0,
    },
  ],
});
beforeEach(() => {
  state.read.mockReset().mockResolvedValue(workload());
});
afterEach(() => {
  cleanup();
  state.client?.clear();
});
function mount(value = "a", locale: "en" | "zh" = "en") {
  state.client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={state.client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <QualifiedTutorSelect
          tutors={[
            { id: "a", englishName: "Synthetic Tutor" },
            { id: "zero", englishName: "Zero Tutor" },
          ]}
          label="Choose tutor"
          subjectId="math"
          value={value}
          onChange={() => undefined}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
it.each(["en", "zh"] as const)(
  "shows known zero and advisory proposed-over in %s without disabling assignment",
  async (locale) => {
    mount("a", locale);
    await waitFor(() =>
      expect(
        screen.getByRole("option", {
          name:
            locale === "en"
              ? /Zero Tutor — 0 assigned blocks/
              : /Zero Tutor — 0 个已分配时段/,
        }),
      ).toBeTruthy(),
    );
    expect(
      await screen.findByText(
        locale === "en"
          ? /This change would result in 2 assigned blocks/
          : /此更改将使已分配时段达到 2 个/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(
      false,
    );
  },
);
it("keeps missing tutor, loading and failed reads distinct from known zero", async () => {
  let release!: (value: ReturnType<typeof workload>) => void;
  state.read.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  mount("missing");
  expect(
    screen.queryByRole("option", { name: /0 assigned blocks/ }),
  ).toBeNull();
  expect(
    screen.getAllByText("Loading assigned-block workload…").length,
  ).toBeGreaterThan(0);
  await act(async () => {
    release(workload());
  });
  await waitFor(() =>
    expect(screen.queryByText("Loading assigned-block workload…")).toBeNull(),
  );
  expect(screen.getAllByText("Workload unavailable").length).toBeGreaterThan(0);
  state.read.mockRejectedValue(new Error("Synthetic failure"));
  await act(async () => {
    await state.client!.invalidateQueries({
      queryKey: ["assignment-workload"],
    });
  });
  expect(await screen.findByText(/Could not refresh workload/)).toBeTruthy();
  expect(screen.queryByText(/This change would result/)).toBeNull();
  expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(false);
});
it("warns at the maximum without adding a block when joining an existing confirmed time", async () => {
  state.client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={state.client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <AssignmentWorkloadAdvice
          tutorId="a"
          proposals={[
            {
              block: {
                id: "new",
                termId: "term",
                scheduleConfirmed: true,
                dayOfWeek: 1,
                startMin: 900,
                endMin: 960,
              },
            },
          ]}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Preferred maximum reached/)).toBeTruthy();
  expect(screen.queryByText(/This change would result/)).toBeNull();
});
it("refreshes the shared active selector after assignments and labels cached failures stale", async () => {
  mount();
  await screen.findByText(/This change would result in 2/);
  state.read.mockResolvedValue(workload(2, 3));
  await act(async () => {
    await invalidateWorkloads({
      admin: {
        assignmentWorkloads: {
          invalidate: () =>
            state.client!.invalidateQueries({
              queryKey: ["assignment-workload"],
            }),
        },
      },
    });
  });
  await waitFor(() =>
    expect(
      screen.getByRole("option", {
        name: /Synthetic Tutor — 2 assigned blocks/,
      }),
    ).toBeTruthy(),
  );
  state.read.mockRejectedValue(new Error("Synthetic read failure"));
  await act(async () => {
    await state.client!.invalidateQueries({
      queryKey: ["assignment-workload"],
    });
  });
  await waitFor(() =>
    expect(
      screen.getByRole("option", {
        name: /Last known: 2 assigned blocks; refresh needed/,
      }),
    ).toBeTruthy(),
  );
  state.read.mockResolvedValue(workload(0, 0));
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  await screen.findByText(/This change would result in 1 assigned block/);
  expect(
    screen.getByRole("option", { name: /Synthetic Tutor — 0 assigned blocks/ }),
  ).toBeTruthy();
});
it("does not add a retained older-quarter edit to the current-quarter projection", async () => {
  state.client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={state.client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <AssignmentWorkloadAdvice
          tutorId="a"
          proposals={[
            {
              replacingPairingId: "older-pairing",
              block: {
                id: "older-pairing",
                termId: "older-quarter",
                scheduleConfirmed: true,
                dayOfWeek: 2,
                startMin: 900,
                endMin: 960,
              },
            },
          ]}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Preferred maximum reached/)).toBeTruthy();
  expect(screen.queryByText(/This change would result/)).toBeNull();
});
it.each(["OPTED_OUT", "ACTIVE"])(
  "does not invent projected blocks for a retained ineligible %s tutor",
  async (status) => {
    const data = workload(0, 0);
    Object.assign(data.tutors[0]!, { status, assignable: false });
    state.read.mockResolvedValue(data);
    state.client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={state.client}>
        <NextIntlClientProvider locale="en" messages={en}>
          <AssignmentWorkloadAdvice
            tutorId="a"
            proposals={[
              {
                replacingPairingId: "retained-inactive-pairing",
                block: {
                  id: "retained-inactive-pairing",
                  termId: "term",
                  scheduleConfirmed: true,
                  dayOfWeek: 2,
                  startMin: 900,
                  endMin: 960,
                },
              },
            ]}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/0 assigned blocks/)).toBeTruthy();
    expect(await screen.findByText(/Preferred maximum reached/)).toBeTruthy();
    expect(screen.queryByText(/This change would result/)).toBeNull();
  },
);
it("conceals cached private preferences on denial, evicts once per reader, and recovers through an explicit read", async () => {
  mount();
  await screen.findByText(/This change would result/);
  state.read.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await state.client!.invalidateQueries({
      queryKey: ["assignment-workload"],
    });
  });
  expect(
    await screen.findByText(
      "You no longer have access to this workload preference.",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: /Preferred maximum:/ }),
  ).toBeNull();
  expect(state.client!.getQueryData(["assignment-workload"])).toBeUndefined();
  const reads = state.read.mock.calls.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(state.read).toHaveBeenCalledTimes(reads);
  state.read.mockResolvedValue(workload());
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  await screen.findByText(/This change would result/);
});
