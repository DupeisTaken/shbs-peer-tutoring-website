/** @vitest-environment jsdom */
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
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppRouter } from "~/server/api/root";
import type {
  SessionOverview,
  SupplementalScheduleEvent,
} from "~/app/_components/session-agenda";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";

type Vote = { applicationId: string; accept: boolean; comment?: string };
const fixture = vi.hoisted(() => {
  const votes: Record<string, Vote> = {};
  return {
    votes,
    readOwn: vi.fn<() => Promise<unknown>>(),
    readSummary: vi.fn<() => Promise<unknown>>(),
    readEvents: vi.fn<() => Promise<unknown>>(),
    write: vi.fn<(input: Vote) => Promise<{ ok: true }>>(),
    requests: [] as { type: string; path: string; input: unknown }[],
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("~/trpc/react", async () => {
  const { createTRPCReact } = await import("@trpc/react-query");
  return { api: createTRPCReact<AppRouter>() };
});
// Keep TutorSchedule's real summary/infinite hooks, cards, retained detail and
// VoteForm. Only the unrelated tutoring-session agenda is a rendering boundary.
vi.mock("~/app/_components/session-agenda", () => ({
  SessionAgenda: ({
    supplementalEvents,
    renderOverview,
    pagination,
  }: {
    supplementalEvents: SupplementalScheduleEvent[];
    renderOverview: (overview: SessionOverview) => React.ReactNode;
    pagination: React.ReactNode;
  }) => (
    <>
      <div data-testid="overview">
        {renderOverview({
          items: [],
          canAddExtra: false,
          extraSourceUnavailable: false,
          openExtra: () => undefined,
        })}
      </div>
      {supplementalEvents.map((event) => (
        <div key={event.id}>{event.content}</div>
      ))}
      {pagination}
    </>
  ),
}));
import { api } from "~/trpc/react";
import { MyInterviews } from "./my-interviews";
import { TutorSchedule } from "./tutor-schedule";

const ids = ["target", "sibling"] as const;
const names = { target: "Synthetic Additional", sibling: "Synthetic Higher" };
const now = new Date("2026-11-15T08:00:00Z");
const interviewAt = new Date("2026-11-14T07:00:00Z");
function ownRows() {
  return ids.map((id) => {
    const vote = fixture.votes[id];
    return {
      id,
      name: names[id],
      email: `${id}@example.test`,
      type: id === "target" ? "ADDITIONAL_SUBJECT" : "HIGHER_LEVEL",
      status: "INTERVIEW",
      isHead: false,
      canChair: false,
      isInvalid: false,
      interviewAt,
      interviewCompletedAt: interviewAt,
      interviewDurationMin: 45,
      myAwardedHours: 0.75,
      subjectIntents: [{ subject: { name: "Mathematics" } }],
      panel: [{ tutorId: "actor", name: "Panelist", isHead: false }],
      interviewers: [{ tutor: { englishName: "Panelist" }, isHead: false }],
      votes: vote
        ? [{ ...vote, tutorId: "actor", tutor: { englishName: "Panelist" } }]
        : [],
      myVote: vote
        ? { accept: vote.accept, comment: vote.comment ?? null }
        : null,
      tally: {
        accepts: Number(vote?.accept === true),
        rejects: Number(vote?.accept === false),
      },
      updatedAt: now,
    };
  });
}
function scheduleRows() {
  const appointments = ids.map((id) => ({
    id,
    name: names[id],
    subjects: ["Mathematics"],
    interviewAt,
    sortAt: interviewAt,
    startsAt: interviewAt,
    isHead: false,
    canChair: false,
    status: "INTERVIEW",
    ownVoteRecorded: !!fixture.votes[id],
    completionState: "completed",
  }));
  return {
    appointments,
    tasks: [],
    actionableTasks: appointments
      .filter((row) => !row.ownVoteRecorded)
      .map((row) => ({ ...row, action: "vote" })),
    openCount: 2,
    pageInfo: { nextCursor: null },
    window: { start: "2026-11-09", end: "2026-11-23" },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function transport(): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        let subscribed = true;
        fixture.requests.push({
          type: op.type,
          path: op.path,
          input: op.input,
        });
        void Promise.resolve()
          .then<unknown>(() => {
            if (op.type === "query" && op.path === "tutor.myInterviews")
              return fixture.readOwn();
            if (
              op.type === "query" &&
              op.path === "personalSchedule.interviews"
            ) {
              return op.input &&
                (op.input as { includeSummary?: boolean }).includeSummary ===
                  false
                ? fixture.readEvents()
                : fixture.readSummary();
            }
            if (op.type === "mutation" && op.path === "tutor.castInterviewVote")
              return fixture.write(op.input as Vote);
            throw new Error(`Unexpected test transport: ${op.type} ${op.path}`);
          })
          .then(
            (data) => {
              if (!subscribed) return;
              observer.next({ result: { data } });
              observer.complete();
            },
            (error: unknown) => {
              if (subscribed)
                observer.error(
                  TRPCClientError.from<AppRouter>(
                    error instanceof Error
                      ? error
                      : new Error("Synthetic read failed"),
                  ),
                );
            },
          );
        return () => {
          subscribed = false;
        };
      });
}
let queryClient: QueryClient;
beforeEach(() => {
  fixture.votes = {};
  fixture.requests = [];
  fixture.readOwn.mockReset().mockImplementation(async () => ownRows());
  fixture.readSummary
    .mockReset()
    .mockImplementation(async () => scheduleRows());
  fixture.readEvents.mockReset().mockImplementation(async () => scheduleRows());
  fixture.write.mockReset().mockImplementation(async (input) => {
    fixture.votes[input.applicationId] = input;
    return { ok: true };
  });
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});
function show(messages = en, source = false) {
  const client = api.createClient({ links: [transport()] });
  return render(
    <QueryClientProvider client={queryClient}>
      <api.Provider client={client} queryClient={queryClient}>
        <NextIntlClientProvider
          locale={messages === zh ? "zh" : "en"}
          timeZone="Asia/Shanghai"
          messages={messages}
        >
          {source && <MyInterviews />}
          <TutorSchedule
            active
            interviewsEnabled
            meetingsEnabled={false}
            compact
            now={now}
          />
        </NextIntlClientProvider>
      </api.Provider>
    </QueryClientProvider>,
  );
}
function card(id: (typeof ids)[number]) {
  return document.getElementById(`interview-${id}`)!;
}
async function ready() {
  await waitFor(() => expect(card("target")).toBeTruthy());
  expect(fixture.readSummary).toHaveBeenCalledOnce();
  expect(fixture.readEvents).toHaveBeenCalledOnce();
}
async function open(messages = en) {
  fireEvent.click(
    within(card("target")).getByRole("button", {
      name: messages.unifiedSchedule.openInterview,
    }),
  );
  return screen.findByRole("dialog", { name: names.target });
}
function accept(scope: HTMLElement, messages = en) {
  return within(scope).getByRole<HTMLButtonElement>("button", {
    name: `👍 ${messages.tutor.interviews.accept}`,
  });
}
function mutationState() {
  return queryClient.getMutationCache().getAll().at(-1)?.state;
}
function assertSynchronized(messages = en) {
  const overview = within(screen.getByTestId("overview"));
  expect(overview.queryByText(names.target)).toBeNull();
  expect(overview.getByText(names.sibling)).toBeTruthy();
  expect(
    within(card("target")).queryByText(messages.agendaEvents.voteNeeded),
  ).toBeNull();
  expect(
    within(card("target")).getByText(messages.agendaEvents.voteRecorded),
  ).toBeTruthy();
  expect(
    within(card("sibling")).getByText(messages.agendaEvents.voteNeeded),
  ).toBeTruthy();
}

it.each([
  { locale: "en", messages: en },
  { locale: "zh", messages: zh },
])(
  "synchronizes both Schedule variants after one accepted detail vote ($locale)",
  async ({ messages }) => {
    show(messages);
    await ready();
    const dialog = await open(messages);
    fireEvent.click(accept(dialog, messages));
    await waitFor(() => expect(mutationState()?.status).toBe("success"));
    expect(
      within(dialog).getByText(messages.tutor.interviews.saved),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: messages.accountProfile.close,
      }),
    );
    assertSynchronized(messages);
    expect(fixture.write).toHaveBeenCalledExactlyOnceWith({
      applicationId: "target",
      accept: true,
    });
    expect(fixture.readOwn).toHaveBeenCalledTimes(2);
    expect(fixture.readSummary).toHaveBeenCalledTimes(2);
    expect(fixture.readEvents).toHaveBeenCalledTimes(2);
  },
);

it("uses the same refresh boundary from the MyInterviews source and permits a deliberate revision", async () => {
  show(en, true);
  await ready();
  const source = document.querySelector<HTMLElement>(
    '[data-interview-id="target"]',
  )!;
  fireEvent.click(accept(source));
  await waitFor(() => expect(mutationState()?.status).toBe("success"));
  assertSynchronized();
  fireEvent.change(
    within(source).getByLabelText(en.tutor.interviews.voteCommentPlaceholder),
    { target: { value: "Deliberate revised judgment" } },
  );
  fireEvent.click(
    within(source).getByRole("button", {
      name: `👎 ${en.tutor.interviews.reject}`,
    }),
  );
  await waitFor(() => expect(fixture.write).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mutationState()?.status).toBe("success"));
  expect(fixture.votes.target).toEqual({
    applicationId: "target",
    accept: false,
    comment: "Deliberate revised judgment",
  });
  assertSynchronized();
});

it.each(["own", "summary", "events"] as const)(
  "keeps an accepted vote after a failed %s read and recovers with reads only",
  async (failed) => {
    show();
    await ready();
    const dialog = await open();
    const reader =
      failed === "own"
        ? fixture.readOwn
        : failed === "summary"
          ? fixture.readSummary
          : fixture.readEvents;
    reader.mockRejectedValueOnce(new Error("Synthetic read offline"));
    fireEvent.click(accept(dialog));
    await waitFor(() => expect(mutationState()?.status).toBe("success"));
    expect(mutationState()?.error).toBeNull();
    expect(within(dialog).getByText(en.tutor.interviews.saved)).toBeTruthy();
    expect(
      within(dialog).getByText(en.tutor.interviews.voteRefreshFailed),
    ).toBeTruthy();
    expect(accept(dialog).disabled).toBe(true);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en.tutor.interviews.voteRefresh,
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog).queryByText(en.tutor.interviews.voteRefreshFailed),
      ).toBeNull(),
    );
    assertSynchronized();
    expect(fixture.write).toHaveBeenCalledOnce();
    expect(
      fixture.requests.filter((request) => request.type === "mutation"),
    ).toHaveLength(1);
  },
);

it("holds the vote owner until another matching Schedule read settles after a failure", async () => {
  show();
  await ready();
  const dialog = await open();
  const events = deferred<unknown>();
  fixture.readSummary.mockRejectedValueOnce(new Error("Summary offline"));
  fixture.readEvents.mockImplementationOnce(() => events.promise);
  fireEvent.click(accept(dialog));
  await waitFor(() => expect(fixture.readEvents).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      within(dialog).getByText(en.tutor.interviews.voteSyncing),
    ).toBeTruthy(),
  );
  expect(mutationState()?.status).toBe("pending");
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(true);
  expect(
    within(dialog).queryByRole("button", {
      name: en.tutor.interviews.voteRefresh,
    }),
  ).toBeNull();
  await act(async () => events.resolve(scheduleRows()));
  await waitFor(() => expect(mutationState()?.status).toBe("success"));
  expect(
    within(dialog).getByText(en.tutor.interviews.voteRefreshFailed),
  ).toBeTruthy();
  expect(fixture.write).toHaveBeenCalledOnce();
});

it("retains accepted read recovery across Close and reopening without casting again", async () => {
  show();
  await ready();
  let dialog = await open();
  fixture.readSummary.mockRejectedValueOnce(new Error("Summary offline"));
  fireEvent.click(accept(dialog));
  await waitFor(() => expect(mutationState()?.status).toBe("success"));
  expect(
    within(dialog).getByText(en.tutor.interviews.voteRefreshFailed),
  ).toBeTruthy();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.accountProfile.close }),
  );
  expect(screen.queryByRole("dialog", { name: names.target })).toBeNull();
  dialog = await open();
  expect(within(dialog).getByText(en.tutor.interviews.saved)).toBeTruthy();
  expect(
    within(dialog).getByText(en.tutor.interviews.voteRefreshFailed),
  ).toBeTruthy();
  expect(accept(dialog).disabled).toBe(true);

  fixture.readSummary.mockRejectedValueOnce(new Error("Still offline"));
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: en.tutor.interviews.voteRefresh,
    }),
  );
  await waitFor(() => expect(fixture.readSummary).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: en.tutor.interviews.voteRefresh,
      }).disabled,
    ).toBe(false),
  );
  expect(
    within(dialog).getByText(en.tutor.interviews.voteRefreshFailed),
  ).toBeTruthy();
  expect(accept(dialog).disabled).toBe(true);
  expect(fixture.write).toHaveBeenCalledOnce();

  fireEvent.click(
    within(dialog).getByRole("button", {
      name: en.tutor.interviews.voteRefresh,
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByText(en.tutor.interviews.voteRefreshFailed),
    ).toBeNull(),
  );
  assertSynchronized();
  expect(accept(dialog).disabled).toBe(false);
  expect(
    fixture.requests.filter((request) => request.type === "mutation"),
  ).toHaveLength(1);
});

it("retains the comment and missing-vote prompts when the mutation is rejected", async () => {
  show();
  await ready();
  const dialog = await open();
  const input = within(dialog).getByLabelText<HTMLInputElement>(
    en.tutor.interviews.voteCommentPlaceholder,
  );
  fireEvent.change(input, { target: { value: "Retain failed vote draft" } });
  fixture.write.mockRejectedValueOnce(new Error("Synthetic vote rejected"));
  fireEvent.click(accept(dialog));
  await waitFor(() => expect(mutationState()?.status).toBe("error"));
  expect(within(dialog).getByText("Synthetic vote rejected")).toBeTruthy();
  expect(input.value).toBe("Retain failed vote draft");
  expect(within(dialog).queryByText(en.tutor.interviews.saved)).toBeNull();
  expect(
    within(dialog).queryByRole("button", {
      name: en.tutor.interviews.voteRefresh,
    }),
  ).toBeNull();
  expect(
    within(card("target")).getByText(en.agendaEvents.voteNeeded),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId("overview")).getByText(names.target),
  ).toBeTruthy();
  expect(fixture.readOwn).toHaveBeenCalledOnce();
  expect(fixture.readSummary).toHaveBeenCalledOnce();
  expect(fixture.readEvents).toHaveBeenCalledOnce();
});

it("lets a chair cast their member vote from the Schedule event while synchronizing the separate chair workspace", async () => {
  fixture.readOwn.mockImplementation(async () =>
    ownRows().map((row) =>
      row.id === "target"
        ? { ...row, type: "INITIAL", isHead: true, canChair: true }
        : row,
    ),
  );
  fixture.readSummary.mockImplementation(async () => {
    const base = scheduleRows();
    return {
      ...base,
      appointments: base.appointments.map((row) =>
        row.id === "target" ? { ...row, isHead: true, canChair: true } : row,
      ),
      actionableTasks: base.actionableTasks.map((row) =>
        row.id === "target" ? { ...row, isHead: true, canChair: true } : row,
      ),
    };
  });
  fixture.readEvents.mockImplementation(async () => {
    const base = scheduleRows();
    return {
      ...base,
      appointments: base.appointments.map((row) =>
        row.id === "target" ? { ...row, isHead: true, canChair: true } : row,
      ),
    };
  });
  const client = api.createClient({ links: [transport()] });
  render(
    <QueryClientProvider client={queryClient}>
      <api.Provider client={client} queryClient={queryClient}>
        <NextIntlClientProvider
          locale="en"
          timeZone="Asia/Shanghai"
          messages={en}
        >
          <div data-testid="chair-tab">
            <MyInterviews audience="chair" />
          </div>
          <TutorSchedule
            active
            interviewsEnabled
            meetingsEnabled={false}
            compact
            now={now}
          />
        </NextIntlClientProvider>
      </api.Provider>
    </QueryClientProvider>,
  );
  await ready();
  const chairTab = within(screen.getByTestId("chair-tab"));
  expect(
    chairTab.queryByLabelText(en.tutor.interviews.voteCommentPlaceholder),
  ).toBeNull();
  expect(
    chairTab
      .getByRole("link", { name: en.tutor.interviews.voteInSchedule })
      .getAttribute("href"),
  ).toBe("#interview-target");
  // Cast vote from the calendar event card in Schedule.
  const dialog = await open();
  fireEvent.click(accept(dialog));
  await waitFor(() => expect(mutationState()?.status).toBe("success"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.accountProfile.close }),
  );
  assertSynchronized();
  expect(
    chairTab.getByRole("link", {
      name: en.tutor.interviews.updateVoteInSchedule,
    }),
  ).toBeTruthy();
  expect(
    chairTab.getByText(
      en.tutor.interviews.yourVote.replace(
        "{vote}",
        en.tutor.interviews.voteAccept,
      ),
    ),
  ).toBeTruthy();
});
