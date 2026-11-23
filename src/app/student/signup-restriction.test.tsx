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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  StudentSignupAction,
  StudentSignupRestrictionFeedback,
  StudentSignupRestrictionProvider,
  useStudentSignupRestriction,
} from "./signup-restriction";

const mocks = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      studentWorkflow: {
        signupRestriction: {
          _def: () => ({ path: ["studentWorkflow", "signupRestriction"] }),
          useQuery(input: unknown, options: object) {
            return useQuery({
              queryKey: [
                ["studentWorkflow", "signupRestriction"],
                { input, type: "query" },
              ],
              queryFn: () =>
                mocks.read(input) as Promise<{
                  intakeTermId: string | null;
                  blocked: boolean;
                  canOpenWorkspace: boolean;
                }>,
              ...options,
            });
          },
        },
      },
    },
  };
});
let client: QueryClient;
const initial = (blocked = false, intakeTermId = "current") => ({
  blocked,
  intakeTermId,
  canOpenWorkspace: true,
});
const snapshot = "a0000000-0000-4000-8000-000000000001";
const nextSnapshot = "a0000000-0000-4000-8000-000000000002";
function Consumer() {
  const state = useStudentSignupRestriction()!;
  return (
    <>
      <input
        aria-label="Retained request draft"
        defaultValue="Retained reason"
      />
      <button onClick={() => void state.refreshAfterSourceRead()}>
        Refresh requests
      </button>
      {state.blocked ? (
        <p>Restricted period</p>
      ) : state.ready ? (
        <p>Eligible period</p>
      ) : null}
    </>
  );
}
const view = (blocked = false, key = snapshot, term = "current") => (
  <QueryClientProvider client={client}>
    <StudentSignupRestrictionProvider
      initialRestriction={initial(blocked, term)}
      snapshotKey={key}
    >
      <StudentSignupAction initiallyBlocked={blocked} departed={false} />
      <StudentSignupRestrictionFeedback />
      <Consumer />
    </StudentSignupRestrictionProvider>
  </QueryClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  mocks.read.mockResolvedValue(initial());
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("seeds one shared read without another initial fetch and refreshes both consumers", async () => {
  render(view());
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "requestTutor" })).toBeTruthy();
  mocks.read.mockResolvedValue(initial(true));
  fireEvent.click(screen.getByRole("button", { name: "Refresh requests" }));
  await screen.findByText("Restricted period");
  expect(screen.queryByRole("link", { name: "requestTutor" })).toBeNull();
  expect(mocks.read).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "keeps a newer server snapshot authoritative over the older %s cache",
  (oldBlocked) => {
    client.setQueryData(
      [
        ["studentWorkflow", "signupRestriction"],
        {
          input: { displayedTermId: "current", snapshotKey: snapshot },
          type: "query",
        },
      ],
      initial(oldBlocked),
    );
    const mounted = render(view(!oldBlocked, nextSnapshot));
    expect(!!screen.queryByRole("link", { name: "requestTutor" })).toBe(
      oldBlocked,
    );
    const draft = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Retained request draft",
    });
    fireEvent.change(draft, { target: { value: "Changed reason" } });
    mounted.rerender(view(oldBlocked, "a0000000-0000-4000-8000-000000000003"));
    expect(!!screen.queryByRole("link", { name: "requestTutor" })).toBe(
      !oldBlocked,
    );
    expect(screen.getByDisplayValue("Changed reason")).toBe(draft);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it("follows an older in-flight read with a read after refreshed source rows", async () => {
  let finish!: (value: ReturnType<typeof initial>) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(view());
  let older!: Promise<void>;
  act(() => {
    older = client.refetchQueries({
      queryKey: [["studentWorkflow", "signupRestriction"]],
    });
  });
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  mocks.read.mockResolvedValue(initial(true));
  fireEvent.click(screen.getByRole("button", { name: "Refresh requests" }));
  expect(screen.queryByRole("link", { name: "requestTutor" })).toBeNull();
  await act(async () => {
    finish(initial());
    await older;
  });
  await screen.findByText("Restricted period");
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("link", { name: "requestTutor" })).toBeNull();
});

it.each([false, true])(
  "retains mounted panels and the independently known SSR block (%s) on read error",
  async (blocked) => {
    render(view(blocked));
    const draft = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Retained request draft",
    });
    mocks.read.mockRejectedValueOnce(
      new Error("Synthetic restriction unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh requests" }));
    await screen.findByText("refreshFailed");
    expect(screen.queryByRole("link", { name: "requestTutor" })).toBeNull();
    expect(!!screen.queryByText("Restricted period")).toBe(blocked);
    expect(screen.getByDisplayValue("Retained reason")).toBe(draft);
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await screen.findByText("Eligible period");
    expect(screen.getByRole("link", { name: "requestTutor" })).toBeTruthy();
  },
);

it("holds signup entries during an actual rollover and refreshes the route only once", async () => {
  const mounted = render(view());
  mocks.read.mockResolvedValue(initial(false, "next"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh requests" }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(screen.queryByRole("link", { name: "requestTutor" })).toBeNull();
  mounted.rerender(view(false, nextSnapshot, "next"));
  expect(screen.getByRole("link", { name: "requestTutor" })).toBeTruthy();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
