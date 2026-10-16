/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import chinese from "../../../messages/zh.json";
import PatrolPage from "./page";
import type { RouterInputs } from "~/trpc/react";

type PatrolInput = RouterInputs["crew"]["submitPatrol"];

const state = vi.hoisted(() => ({
  hours: 0,
  status: "ACTIVE",
  isPending: false,
  isSuccess: true,
  error: null as { message: string } | null,
  mutate: vi.fn(),
  invalidateConfig: vi.fn(),
  invalidateHistory: vi.fn(),
  readError: ((): Record<
    string,
    { message: string; data?: { code: string } } | undefined
  > => ({}))(),
  cold: false,
  refetch: vi.fn(),
}));
const lifecycle = vi.hoisted(() => ({
  onSuccess: () => Promise.resolve(),
  onSettled: (): void => undefined,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      crew: {
        myStatus: { invalidate: vi.fn() },
        patrolConfig: { invalidate: state.invalidateConfig },
        myPatrols: { invalidate: state.invalidateHistory },
      },
    }),
    crew: {
      myStatus: {
        name: "status",
        useQuery: () => ({
          data: state.cold
            ? undefined
            : { status: state.status, pendingRequest: null },
          error: state.readError.status,
          isSuccess: !state.cold && !state.readError.status,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
      patrolConfig: {
        name: "config",
        useQuery: () => ({
          data: state.cold
            ? undefined
            : {
                rooms: [{ id: "room", name: "Test room" }],
                myHours: 0.5,
                myPatrols: 2,
              },
          error: state.readError.config,
          isSuccess: !state.cold && !state.readError.config,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
      myPatrols: {
        name: "history",
        useQuery: () => ({
          data: state.cold ? undefined : [],
          error: state.readError.history,
          isSuccess: !state.cold && !state.readError.history,
          isFetching: false,
          refetch: state.refetch,
        }),
      },
      requestOptOut: { useMutation: () => ({ mutate: vi.fn() }) },
      recallOptOut: { useMutation: () => ({ mutate: vi.fn() }) },
      requestReentry: { useMutation: () => ({ mutate: vi.fn() }) },
      submitPatrol: {
        useMutation: (options: typeof lifecycle) => {
          Object.assign(lifecycle, options);
          return { ...state, data: { hours: state.hours } };
        },
      },
    },
  },
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (procedure: { name: string }) => [procedure.name],
}));
let queryClient: QueryClient;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  Object.assign(state, {
    hours: 0,
    status: "ACTIVE",
    isPending: false,
    isSuccess: true,
    error: null,
  });
  state.readError = {};
  state.cold = false;
  state.refetch.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  state.mutate.mockReset();
  state.invalidateConfig.mockReset().mockResolvedValue(undefined);
  state.invalidateHistory.mockReset().mockResolvedValue(undefined);
});
const view = (locale: "en" | "zh" = "en") => (
  <QueryClientProvider client={queryClient}>
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "zh" ? chinese : messages}
    >
      <PatrolPage />
    </NextIntlClientProvider>
  </QueryClientProvider>
);
const show = (locale: "en" | "zh" = "en") => render(view(locale));

it("announces that evidence was saved without claiming zero-hour submissions earned credit", () => {
  state.hours = 0;
  show();
  expect(screen.getByRole("status").textContent).toMatch(
    /saved with no additional hours/,
  );
  expect(screen.getByRole("status").textContent).toMatch(/20-minute allowance/);
  expect(
    screen.getByText(/all observations from the last 20 minutes/),
  ).toBeTruthy();
});
it("keeps the ordinary success confirmation for an awarded sweep", () => {
  state.hours = 0.5;
  show();
  expect(screen.getByRole("status").textContent).toBe("Patrol recorded.");
});

it.each([0, 0.5])(
  "localizes the actual %s-hour outcome in Chinese",
  (hours) => {
    state.hours = hours;
    show("zh");
    expect(screen.getByRole("status").textContent).toBe(
      hours === 0
        ? chinese.crew.patrol.recordedWithoutCredit
        : chinese.crew.patrol.submitted,
    );
  },
);

it("disables submission while pending and retains the draft and request key after an error", () => {
  state.isSuccess = false;
  const rendered = show();
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  const note = screen.getByPlaceholderText(
    messages.crew.patrol.notePlaceholder,
  );
  fireEvent.change(note, { target: { value: "Synthetic observation" } });
  fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
  const original = state.mutate.mock.calls[0]?.[0] as unknown;
  expect(original).toMatchObject({
    note: "Synthetic observation",
    observations: [{ roomId: "room", headcount: "ONE" }],
  });
  state.isPending = true;
  rendered.rerender(view());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.crew.patrol.submitting,
    }).disabled,
  ).toBe(true);
  state.isPending = false;
  state.error = { message: "Temporary connection error" };
  lifecycle.onSettled();
  rendered.rerender(view());
  expect(screen.getByRole("alert").textContent).toBe(state.error.message);
  expect((note as HTMLTextAreaElement).value).toBe("Synthetic observation");
  fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
  expect(state.mutate.mock.calls[1]?.[0]).toEqual(original);
});

it("guards rapid/programmatic edits and duplicate submits until the saved draft finishes refreshing", async () => {
  state.isSuccess = false;
  const rendered = show();
  const one = screen.getByRole<HTMLButtonElement>("button", { name: "1" });
  const three = screen.getByRole<HTMLButtonElement>("button", { name: "3" });
  const note = screen.getByPlaceholderText<HTMLTextAreaElement>(
    messages.crew.patrol.notePlaceholder,
  );
  const submit = screen.getByRole("button", { name: /Submit Patrol/ });
  fireEvent.click(one);
  fireEvent.change(note, { target: { value: "Submitted note" } });
  fireEvent.click(submit);
  // Deliberately leave the mocked React mutation state idle for this synchronous event gap.
  fireEvent.click(three);
  fireEvent.change(note, {
    target: { value: "Must not overwrite the in-flight draft" },
  });
  fireEvent.click(submit);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  expect(one.getAttribute("aria-pressed")).toBe("true");
  expect(three.getAttribute("aria-pressed")).toBe("false");
  expect(note.value).toBe("Submitted note");
  state.isPending = true;
  rendered.rerender(view());
  expect(one.disabled).toBe(true);
  expect(three.disabled).toBe(true);
  expect(note.disabled).toBe(true);
  fireEvent.change(note, { target: { value: "Programmatic pending edit" } });
  expect(note.value).toBe("Submitted note");

  let finishRefresh!: () => void;
  state.invalidateConfig.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }),
  );
  let succeeded!: Promise<void>;
  act(() => {
    succeeded = lifecycle.onSuccess();
  });
  // The server has answered, but the ref guard must remain until success processing settles.
  state.isPending = false;
  rendered.rerender(view());
  fireEvent.click(three);
  fireEvent.change(note, { target: { value: "Refresh is still pending" } });
  expect(three.getAttribute("aria-pressed")).toBe("false");
  expect(note.value).toBe("");
  await act(async () => {
    finishRefresh();
    await succeeded;
    lifecycle.onSettled();
  });
  fireEvent.click(three);
  fireEvent.change(note, { target: { value: "Next draft" } });
  expect(three.getAttribute("aria-pressed")).toBe("true");
  expect(note.value).toBe("Next draft");
});

// Model a server commit separately from its lost transport response. The real endpoint version
// of this scenario is also exercised in the bounded browser rehearsal.
function savedRequests() {
  const saved = new Map<
    string,
    { payload: string; result: { id: string; hours: number } }
  >();
  const responses: { id: string; hours: number }[] = [];
  state.mutate.mockImplementation((input: PatrolInput) => {
    const previous = saved.get(input.submissionKey);
    if (previous) {
      expect(JSON.stringify(input)).toBe(previous.payload);
      responses.push(previous.result);
    } else {
      const result = {
        id: `saved-${saved.size + 1}`,
        hours: saved.size === 0 ? 0.5 : 0,
      };
      saved.set(input.submissionKey, {
        payload: JSON.stringify(input),
        result,
      });
      responses.push(result);
    }
  });
  return { saved, responses };
}

it("recovers an unchanged lost-response retry and then submits the next draft with a fresh key", async () => {
  state.isSuccess = false;
  const { saved, responses } = savedRequests();
  const rendered = show();
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  const note = screen.getByPlaceholderText<HTMLTextAreaElement>(
    messages.crew.patrol.notePlaceholder,
  );
  fireEvent.change(note, { target: { value: "Original" } });
  fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
  const original = state.mutate.mock.calls[0]?.[0] as PatrolInput;
  const snapshot = JSON.stringify(original);
  state.error = { message: "Response lost after save" };
  lifecycle.onSettled();
  rendered.rerender(view());
  fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
  expect(state.mutate.mock.calls[1]?.[0]).toEqual(original);
  expect(saved.size).toBe(1);
  expect(responses[1]).toEqual(responses[0]);
  await act(async () => {
    await lifecycle.onSuccess();
    lifecycle.onSettled();
  });
  state.error = null;
  rendered.rerender(view());
  expect(note.value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "3" }));
  fireEvent.change(note, { target: { value: "Next intent" } });
  fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
  expect(
    (state.mutate.mock.calls[2]?.[0] as PatrolInput).submissionKey,
  ).not.toBe(original.submissionKey);
  expect(JSON.stringify(original)).toBe(snapshot);
  expect(saved.size).toBe(2);
  expect(responses[2]?.hours).toBe(0);
});

it.each(["count", "observation time", "note", "note whitespace"])(
  "uses the right retry intent after response loss followed by a %s edit",
  (edit) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T01:00:00Z"));
    state.isSuccess = false;
    const { saved } = savedRequests();
    const rendered = show();
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    const note = screen.getByPlaceholderText(
      messages.crew.patrol.notePlaceholder,
    );
    fireEvent.change(note, { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
    const original = state.mutate.mock.calls[0]?.[0] as PatrolInput;
    const snapshot = JSON.stringify(original);
    state.error = { message: "Response lost after save" };
    lifecycle.onSettled();
    rendered.rerender(view());
    vi.setSystemTime(new Date("2026-10-02T01:01:00Z"));
    if (edit === "count" || edit === "observation time")
      fireEvent.click(
        screen.getByRole("button", { name: edit === "count" ? "3" : "1" }),
      );
    else
      fireEvent.change(note, {
        target: { value: edit === "note" ? "Changed" : " Original " },
      });
    fireEvent.click(screen.getByRole("button", { name: /Submit Patrol/ }));
    const next = state.mutate.mock.calls[1]?.[0] as PatrolInput;
    expect(JSON.stringify(original)).toBe(snapshot);
    if (edit === "note whitespace") {
      expect(next).toEqual(original);
      expect(saved.size).toBe(1);
    } else {
      expect(next.submissionKey).not.toBe(original.submissionKey);
      expect(saved.size).toBe(2);
      if (edit === "note")
        expect(next.observations).toEqual(original.observations);
      else
        expect(next.observations[0]?.observedAt).not.toEqual(
          original.observations[0]?.observedAt,
        );
    }
  },
);

it.each(["INACTIVE", "OPTED_OUT"])(
  "does not offer patrol submission to %s crew",
  (status) => {
    state.status = status;
    show();
    expect(screen.queryByRole("button", { name: /Submit Patrol/ })).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
  },
);

it("does not mistake a failed initial status read for admin access or loaded zero totals", () => {
  state.cold = true;
  state.readError.status = { message: "Offline" };
  show();
  expect(screen.getByRole("alert").textContent).toContain(
    "Could not load Crew status",
  );
  expect(screen.queryByText("0.0 h")).toBeNull();
  expect(screen.queryByText(messages.crew.patrol.noRooms)).toBeNull();
  expect(screen.queryByRole("button", { name: /Submit Patrol/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry Crew status" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});
it("keeps a sweep draft beside a failed refresh and disables dependent writes until recovery", () => {
  state.isSuccess = false;
  const rendered = show();
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  fireEvent.change(screen.getByLabelText(messages.crew.patrol.noteLabel), {
    target: { value: "Retained sweep" },
  });
  state.readError.config = { message: "Offline" };
  rendered.rerender(view());
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.crew.patrol.noteLabel)
      .value,
  ).toBe("Retained sweep");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: /Submit Patrol/ })
      .disabled,
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "1" }).getAttribute("aria-pressed"),
  ).toBe("true");
  state.readError = {};
  rendered.rerender(view());
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: /Submit Patrol/ })
      .disabled,
  ).toBe(false);
});
it("evicts concealed patrol evidence on revocation and does not restore it on a network failure", () => {
  const rendered = show();
  queryClient.setQueryData(["status"], { status: "ACTIVE" });
  queryClient.setQueryData(["config"], { private: true });
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  state.readError.status = { message: "Denied", data: { code: "FORBIDDEN" } };
  rendered.rerender(view());
  expect(screen.queryByText("Test room")).toBeNull();
  expect(queryClient.getQueryData(["status"])).toBeUndefined();
  expect(queryClient.getQueryData(["config"])).toBeUndefined();
  state.readError.status = { message: "Offline" };
  rendered.rerender(view());
  expect(screen.queryByText("Test room")).toBeNull();
  state.readError = {};
  rendered.rerender(view());
  expect(screen.getByText("Test room")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "1" }).getAttribute("aria-pressed"),
  ).toBe("false");
});
it.each(["en", "zh"] as const)(
  "associates persistent note and reason labels in %s",
  (locale) => {
    show(locale);
    const labels = locale === "zh" ? chinese : messages;
    expect(screen.getByLabelText(labels.crew.patrol.noteLabel).tagName).toBe(
      "TEXTAREA",
    );
    fireEvent.click(
      screen.getByRole("button", { name: labels.crew.patrol.optOut.request }),
    );
    expect(
      screen.getByLabelText(labels.crew.patrol.optOut.reasonLabel).tagName,
    ).toBe("TEXTAREA");
  },
);
