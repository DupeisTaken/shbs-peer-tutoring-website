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
import { WorkloadAssignmentConfirmation } from "./assignment-workload";
import { invalidateWorkloads } from "~/lib/workload-cache";

const state = vi.hoisted(() => ({
  client: null as QueryClient | null,
  read: vi.fn(),
  prepare: vi.fn(),
  cancelTicket: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: () => ["assignment-workload"],
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      assignment: {
        prepare: {
          useMutation: () => ({
            mutateAsync: state.prepare,
          }),
        },
        cancel: { useMutation: () => ({ mutate: state.cancelTicket }) },
      },
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
  state.prepare.mockReset().mockResolvedValue({ ticket: null, mismatches: [] });
  state.confirm.mockReset();
  state.cancel.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
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
  "keeps native labels compact in %s without an inline warning",
  async (locale) => {
    mount("a", locale);
    expect(
      await screen.findByRole("option", { name: "Synthetic Tutor (1/1)" }),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: "Zero Tutor (0)" })).toBeTruthy();
    expect(screen.queryByText(/This assignment|此分配/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(
      false,
    );
  },
);
it("preserves explicit zero and does not substitute the default for unset", async () => {
  state.read.mockResolvedValue(workload(2, 0));
  mount();
  expect(
    await screen.findByRole("option", { name: "Synthetic Tutor (2/0)" }),
  ).toBeTruthy();
  state.read.mockResolvedValue(workload(2, null));
  await act(async () => {
    await state.client!.invalidateQueries({
      queryKey: ["assignment-workload"],
    });
  });
  expect(
    await screen.findByRole("option", { name: "Synthetic Tutor (2)" }),
  ).toBeTruthy();
});
it("shows unknown during loading and failure, then refreshes the compact option", async () => {
  let release!: (data: ReturnType<typeof workload>) => void;
  state.read.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  mount();
  expect(
    screen.getByRole("option", { name: "Synthetic Tutor (?)" }),
  ).toBeTruthy();
  await act(async () => release(workload()));
  await screen.findByRole("option", { name: "Synthetic Tutor (1/1)" });
  state.read.mockRejectedValue(new Error("Read failed"));
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
  expect(await screen.findByText(/Could not refresh workload/)).toBeTruthy();
  expect(
    screen.getByRole("option", { name: "Synthetic Tutor (?)" }),
  ).toBeTruthy();
  expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(false);
  state.read.mockResolvedValue(workload(0, 0));
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  expect(
    await screen.findByRole("option", { name: "Synthetic Tutor (0/0)" }),
  ).toBeTruthy();
});
it("conceals and evicts private preference on denial, then recovers explicitly", async () => {
  mount();
  await screen.findByRole("option", { name: "Synthetic Tutor (1/1)" });
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
    screen.queryByRole("option", { name: "Synthetic Tutor (1/1)" }),
  ).toBeNull();
  expect(state.client!.getQueryData(["assignment-workload"])).toBeUndefined();
  state.read.mockResolvedValue(workload());
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  expect(
    await screen.findByRole("option", { name: "Synthetic Tutor (1/1)" }),
  ).toBeTruthy();
});
const review = (
  proposals?: import("~/lib/tutor-workload").WorkloadProposal[],
) => {
  state.client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={state.client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkloadAssignmentConfirmation
          operation="admin.createPairing"
          payload={{ tutorId: "a" }}
          tutorId="a"
          proposals={proposals}
          onConfirm={state.confirm}
          onCancel={state.cancel}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
};
it("requires explicit Continue above preference, with Cancel and no extra countdown", async () => {
  review();
  expect(
    await screen.findByText(/This assignment would result in 2 sessions/),
  ).toBeTruthy();
  expect(state.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(state.cancel).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(state.confirm).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(state.confirm).toHaveBeenCalledOnce();
});
it.each([null, 2, 4])(
  "continues normally when preference is %s and not exceeded",
  async (preference) => {
    state.read.mockResolvedValue(workload(1, preference));
    review();
    await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  },
);
it.each(["term", "old-quarter"])(
  "does not add a block for a shared-time or old-quarter edit (%s)",
  async (termId) => {
    review([
      {
        replacingPairingId: termId === "term" ? "shared-a" : "old-pairing",
        block: {
          id: "new",
          termId,
          scheduleConfirmed: true,
          dayOfWeek: 1,
          startMin: 900,
          endMin: 960,
        },
      },
    ]);
    await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
    expect(screen.queryByText(/above the tutor/)).toBeNull();
  },
);
it("waits for a held workload read before choosing the fast path", async () => {
  let release!: (data: ReturnType<typeof workload>) => void;
  state.read.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  review();
  await act(async () => {
    await Promise.resolve();
  });
  expect(state.confirm).not.toHaveBeenCalled();
  await act(async () => release(workload()));
  expect(await screen.findByRole("button", { name: "Continue" })).toBeTruthy();
  expect(state.confirm).not.toHaveBeenCalled();
});
it("does not turn a failed advisory read into a new assignment permission", async () => {
  state.read.mockRejectedValue(new Error("Unavailable"));
  review();
  await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
});
it("keeps ineligible retained tutors from acquiring invented projected load", async () => {
  const data = workload(0, 0);
  data.tutors[0]!.assignable = false;
  state.read.mockResolvedValue(data);
  review();
  await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
});
