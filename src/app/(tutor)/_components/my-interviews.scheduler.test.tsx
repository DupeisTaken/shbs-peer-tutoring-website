// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { MyInterviews } from "./my-interviews";

type ScheduleInput = { applicationId: string; interviewAt: Date | null };
const remote = vi.hoisted(() => ({
  load: vi.fn<() => Promise<unknown[]>>(),
  schedule: vi.fn<(input: ScheduleInput) => Promise<unknown>>(),
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery, useQueryClient } =
    await import("@tanstack/react-query");
  return {
    api: {
      useUtils() {
        const client = useQueryClient();
        return {
          tutor: {
            myInterviews: {
              invalidate: () =>
                client.invalidateQueries({ queryKey: ["scheduler-interviews"] }),
            },
          },
        };
      },
      tutor: {
        myInterviews: {
          useQuery: () =>
            useQuery({
              queryKey: ["scheduler-interviews"],
              queryFn: remote.load,
            }),
        },
        setInterviewTime: {
          // Real mutation settlement/reset notifications catch stale feedback.
          useMutation: (options: Record<string, unknown> = {}) =>
            useMutation({ mutationFn: remote.schedule, ...options }),
        },
        castInterviewVote: {
          useMutation: () => ({
            mutate: vi.fn(),
            reset: vi.fn(),
            isPending: false,
          }),
        },
      },
    },
  };
});

let client: QueryClient;
let recorded: Date | null;
const interview = () => ({
  id: "application",
  name: "Sample Applicant",
  email: "applicant@example.test",
  isHead: true,
  canChair: true,
  isInvalid: false,
  type: "HIGHER_LEVEL",
  status: "INTERVIEW",
  interviewAt: recorded,
  interviewCompletedAt: null,
  interviewDurationMin: null,
  panel: [],
  subjectIntents: [],
  interviewers: [{ tutor: { englishName: "Chair" }, isHead: true }],
  votes: [],
  myVote: null,
  tally: { accepts: 0, rejects: 0 },
  decisionComment: null,
  decidedByTutor: null,
  updatedAt: new Date("2026-11-21T00:00:00Z"),
});
function mount(locale: "en" | "zh" = "en", timeZone = "Asia/Shanghai") {
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        timeZone={timeZone}
        messages={locale === "zh" ? zh : en}
      >
        <MyInterviews />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
async function editor(locale: "en" | "zh" = "en") {
  const messages = locale === "zh" ? zh : en;
  const input = await screen.findByLabelText<HTMLInputElement>(
    messages.tutor.interviews.setTime,
  );
  const scope = within(input.parentElement!);
  return {
    input,
    scope,
    save: () =>
      scope.getByRole<HTMLButtonElement>("button", {
        name: messages.tutor.interviews.setTime,
      }),
    cancel: scope.getByRole<HTMLButtonElement>("button", {
      name: messages.common.cancel,
    }),
    saved: messages.tutor.interviews.saved,
  };
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  vi.clearAllMocks();
  recorded = new Date("2026-11-22T06:10:00Z");
  remote.load.mockImplementation(async () => [interview()]);
  remote.schedule.mockImplementation(async (input) => {
    recorded = input.interviewAt;
    return {};
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it.each(["en", "zh"] as const)(
  "clears the %s saved receipt on a new draft, saves only explicitly and cancels to the latest recorded time",
  async (locale) => {
    mount(locale);
    const { input, scope, save, cancel, saved } = await editor(locale);
    fireEvent.change(input, { target: { value: "2026-11-22T14:40" } });
    fireEvent.click(save());
    await scope.findByText(saved);
    expect(remote.schedule).toHaveBeenCalledTimes(1);
    expect(remote.schedule.mock.calls[0]?.[0]).toEqual({
      applicationId: "application",
      interviewAt: new Date("2026-11-22T06:40:00Z"),
    });

    // An unrelated field has its own draft; only changing the schedule resets it.
    fireEvent.change(
      screen.getByLabelText(
        (locale === "zh" ? zh : en).tutor.interviews.voteCommentPlaceholder,
      ),
      { target: { value: "Independent vote draft" } },
    );
    expect(scope.getByText(saved)).toBeTruthy();
    fireEvent.change(input, { target: { value: "2026-11-22T14:50" } });
    await waitFor(() => expect(scope.queryByText(saved)).toBeNull());
    expect(input.value).toBe("2026-11-22T14:50");
    expect(remote.schedule).toHaveBeenCalledTimes(1);
    expect(recorded).toEqual(new Date("2026-11-22T06:40:00Z"));

    // A newer read must leave the local draft alone until explicit Cancel.
    recorded = new Date("2026-11-22T06:45:00Z");
    await act(async () => {
      await client.refetchQueries({ queryKey: ["scheduler-interviews"] });
    });
    expect(input.value).toBe("2026-11-22T14:50");
    fireEvent.click(save());
    await scope.findByText(saved);
    expect(remote.schedule).toHaveBeenCalledTimes(2);
    expect(remote.schedule.mock.calls[1]?.[0]).toEqual({
      applicationId: "application",
      interviewAt: new Date("2026-11-22T06:50:00Z"),
    });
    fireEvent.change(input, { target: { value: "2026-11-22T15:00" } });
    fireEvent.click(cancel);
    await waitFor(() => expect(scope.queryByText(saved)).toBeNull());
    expect(input.value).toBe("2026-11-22T14:50");
    expect(remote.schedule).toHaveBeenCalledTimes(2);
  },
);

it("clears a settled server error only when the scheduling draft changes, without retrying", async () => {
  remote.schedule.mockRejectedValue(new Error("Synthetic scheduling failure"));
  mount();
  const { input, scope, save } = await editor();
  fireEvent.change(input, { target: { value: "2026-11-22T14:40" } });
  fireEvent.click(save());
  await scope.findByText("Synthetic scheduling failure");
  expect(input.value).toBe("2026-11-22T14:40");
  fireEvent.change(
    screen.getByLabelText(en.tutor.interviews.voteCommentPlaceholder),
    { target: { value: "Independent vote draft" } },
  );
  expect(scope.getByRole("alert").textContent).toBe(
    "Synthetic scheduling failure",
  );
  fireEvent.change(input, { target: { value: "2026-11-22T14:50" } });
  await waitFor(() => expect(scope.queryByRole("alert")).toBeNull());
  expect(input.value).toBe("2026-11-22T14:50");
  expect(remote.schedule).toHaveBeenCalledTimes(1);
  expect(recorded).toEqual(new Date("2026-11-22T06:10:00Z"));
});

it("clears a prior program-time parse error when the date changes without submitting", async () => {
  mount("en", "America/New_York");
  const { input, scope, save, cancel } = await editor();
  // This native datetime-local value is valid text but falls in a real DST gap.
  fireEvent.change(input, { target: { value: "2027-03-14T02:30" } });
  fireEvent.click(save());
  expect(scope.getByRole("alert").textContent).toContain("does not exist");
  expect(remote.schedule).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "2027-03-14T03:30" } });
  expect(scope.queryByRole("alert")).toBeNull();
  expect(input.value).toBe("2027-03-14T03:30");
  expect(remote.schedule).not.toHaveBeenCalled();
  fireEvent.click(cancel);
  expect(input.value).toBe("2026-11-22T01:10");
  expect(remote.schedule).not.toHaveBeenCalled();
});

it("keeps the scheduling input, save and cancel disabled until a pending write settles", async () => {
  let finish!: (result: object) => void;
  remote.schedule.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  const { input, scope, save, cancel, saved } = await editor();
  fireEvent.change(input, { target: { value: "2026-11-22T14:40" } });
  fireEvent.click(save());
  await waitFor(() => expect(input.disabled).toBe(true));
  expect(
    scope.getByRole<HTMLButtonElement>("button", {
      name: en.tutor.interviews.saving,
    }).disabled,
  ).toBe(true);
  expect(cancel.disabled).toBe(true);
  fireEvent.click(cancel);
  expect(input.value).toBe("2026-11-22T14:40");
  expect(remote.schedule).toHaveBeenCalledTimes(1);
  await act(async () => finish({}));
  await scope.findByText(saved);
  expect(input.disabled).toBe(false);
  expect(save().disabled).toBe(false);
  expect(cancel.disabled).toBe(false);
});
