/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { PersonalTuteeHistory } from "./personal-history";
import { PersonalTutorHistory } from "./personal-tutor-history";
import { TuteeHistoryContent } from "~/app/_components/tutee-history";

const state = vi.hoisted(() => ({
  tutees: vi.fn(),
  tutors: vi.fn(),
  details: vi.fn(),
  tuteeDetails: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    tuteeHistory: {
      myRecords: { useQuery: state.tutees },
      myTutorRecords: { useQuery: state.tutors },
      myTutorDetails: { useQuery: state.details },
      myDetails: { useQuery: state.tuteeDetails },
      details: { useQuery: state.tuteeDetails },
    },
  },
}));
vi.mock("~/app/_components/profile-dialog", () => ({
  ProfileDialog: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

const records = [
  {
    id: "archive-one",
    englishName: "Same Name",
    periods: ["24-25 Q1"],
    sessionCount: 3,
    meetingCount: 1,
    amendmentCount: 0,
    storedSessionHours: 1.5,
  },
  {
    id: "archive-two",
    englishName: "Same Name",
    periods: ["25-26 Q2"],
    sessionCount: 7,
    meetingCount: 0,
    amendmentCount: 1,
    storedSessionHours: 3.5,
  },
];
function detailData(record = records[0]!) {
  return {
    record: { id: record.id, englishName: record.englishName },
    periods: record.periods,
    firstSessionDate: null as Date | null,
    lastSessionDate: null as Date | null,
    counts: {
      sessions: record.sessionCount,
      meetings: record.meetingCount,
      amendments: record.amendmentCount,
    },
    sessions: [],
    meetings: [],
    amendments: [],
    sessionMore: false,
    meetingMore: false,
    amendmentMore: false,
  };
}
const wrap = (locale: "en" | "zh", children: ReactNode) => (
  <NextIntlClientProvider
    locale={locale}
    messages={locale === "en" ? en : zh}
    timeZone="America/New_York"
  >
    {children}
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  state.tutees.mockReturnValue({ data: [], refetch: state.retry });
  state.tutors.mockReturnValue({ data: records, refetch: state.retry });
  state.details.mockImplementation(({ tutorId }: { tutorId: string }) => ({
    data: detailData(records.find((record) => record.id === tutorId)),
    refetch: state.retry,
  }));
  state.tuteeDetails.mockReturnValue({ data: undefined, refetch: state.retry });
});

it.each(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"])(
  "conceals cached personal lists and closes selected tutor evidence after %s",
  (code) => {
    const tuteeRows = [
      {
        id: "private-enrollment",
        englishName: "Private student",
        term: null,
        _count: { sessions: 2 },
      },
    ];
    state.tutees.mockReturnValue({
      data: tuteeRows,
      isSuccess: true,
      refetch: state.retry,
    });
    const content = () =>
      wrap(
        "en",
        <>
          <PersonalTuteeHistory />
          <PersonalTutorHistory />
        </>,
      );
    const view = render(content());
    fireEvent.click(
      screen.getByRole("button", { name: /View History.*archive-one/ }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    const error = { data: { code }, message: "Unavailable" };
    state.tutors.mockReturnValue({
      data: records,
      error,
      isSuccess: false,
      refetch: state.retry,
    });
    state.tutees.mockReturnValue({
      data: tuteeRows,
      error,
      isSuccess: false,
      refetch: state.retry,
    });
    view.rerender(content());
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Private student")).toBeNull();
    // A transport failure after a denial cannot revive the stale successful snapshot.
    state.tutors.mockReturnValue({
      data: records,
      error: new Error("Network failure"),
      refetch: state.retry,
    });
    view.rerender(content());
    expect(screen.queryByText("Same Name")).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: en.uiPatterns.retry })[1]!,
    );
    state.tutors.mockReturnValue({
      data: records,
      isSuccess: true,
      isFetching: false,
      refetch: state.retry,
    });
    view.rerender(content());
    expect(screen.getAllByText("Same Name")).toHaveLength(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("conceals denied tutor detail identity and evidence until a successful explicit read", () => {
  const cached = {
    ...detailData(),
    sessions: [],
    meetings: [],
    amendments: [],
    sessionMore: false,
    meetingMore: false,
    amendmentMore: false,
  };
  state.details.mockReturnValue({
    data: cached,
    isSuccess: true,
    refetch: state.retry,
  });
  const view = render(wrap("en", <PersonalTutorHistory />));
  fireEvent.click(
    screen.getByRole("button", { name: /View History.*archive-one/ }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(/archive-one/),
  ).toBeTruthy();
  state.details.mockReturnValue({
    data: cached,
    error: { data: { code: "NOT_FOUND" } },
    refetch: state.retry,
  });
  view.rerender(wrap("en", <PersonalTutorHistory />));
  const dialog = screen.getByRole("dialog", {
    name: en.tuteeHistory.tutorHistory,
  });
  expect(within(dialog).queryByText(/archive-one/)).toBeNull();
  expect(within(dialog).queryByText(en.tuteeHistory.noSessions)).toBeNull();
  state.details.mockReturnValue({
    data: cached,
    error: new Error("Network failure"),
    refetch: state.retry,
  });
  view.rerender(wrap("en", <PersonalTutorHistory />));
  expect(within(dialog).queryByText(/archive-one/)).toBeNull();
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.uiPatterns.retry }),
  );
  state.details.mockReturnValue({
    data: cached,
    isSuccess: true,
    isFetching: false,
    refetch: state.retry,
  });
  view.rerender(wrap("en", <PersonalTutorHistory />));
  expect(
    within(screen.getByRole("dialog")).getByText(/archive-one/),
  ).toBeTruthy();
});

it("retains tutee details for transport failures but hides them after an ownership denial", () => {
  const data = {
    record: {
      id: "private-tutee",
      name: "Private enrollment",
      gradeLevel: "G9",
      academicallyGraduated: false,
    },
    term: null,
    owner: null,
    count: 0,
    sessions: [],
  };
  state.tuteeDetails.mockReturnValue({
    data,
    error: new Error("Network failure"),
    refetch: state.retry,
  });
  const content = () =>
    wrap("en", <TuteeHistoryContent tuteeId="private-tutee" personal />);
  const view = render(content());
  expect(screen.getByText("Private enrollment")).toBeTruthy();
  state.tuteeDetails.mockReturnValue({
    data,
    error: { data: { code: "FORBIDDEN" } },
    refetch: state.retry,
  });
  view.rerender(content());
  expect(screen.queryByText("Private enrollment")).toBeNull();
  expect(screen.queryByText(/private-tutee/)).toBeNull();
  state.tuteeDetails.mockReturnValue({
    data,
    error: new Error("Network failure"),
    refetch: state.retry,
  });
  view.rerender(content());
  expect(screen.queryByText("Private enrollment")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  state.tuteeDetails.mockReturnValue({
    data,
    isSuccess: true,
    isFetching: false,
    refetch: state.retry,
  });
  view.rerender(content());
  expect(screen.getByText("Private enrollment")).toBeTruthy();
});

it.each(["en", "zh"] as const)(
  "distinguishes same-period archives with %s UTC calendar date ranges",
  (locale) => {
    const first = new Date("2024-10-01T00:00:00Z");
    const last = new Date("2024-10-15T00:00:00Z");
    state.details.mockReturnValue({
      data: { ...detailData(), firstSessionDate: first, lastSessionDate: last },
      refetch: state.retry,
    });
    state.tutors.mockReturnValue({
      data: [
        { ...records[0], firstSessionDate: first, lastSessionDate: last },
        {
          ...records[1],
          periods: records[0]!.periods,
          firstSessionDate: null,
          lastSessionDate: null,
        },
      ],
      refetch: state.retry,
    });
    const copy = (locale === "en" ? en : zh).tuteeHistory;
    render(wrap(locale, <PersonalTutorHistory />));
    const day = (date: Date) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date);
    const expected = copy.recordedDateRange
      .replace("{first}", day(first))
      .replace("{last}", day(last));
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.getByText(copy.recordedDatesUnknown)).toBeTruthy();
    const actions = screen.getAllByRole("button", {
      name: new RegExp(copy.details),
    });
    expect(actions[0]!.getAttribute("aria-label")).not.toBe(
      actions[1]!.getAttribute("aria-label"),
    );
    fireEvent.click(actions[0]!);
    expect(within(screen.getByRole("dialog")).getByText(expected)).toBeTruthy();
  },
);
afterEach(cleanup);

it.each(["tutor", "tutee"] as const)(
  "closes selected %s evidence only after a complete successful ownership list excludes it",
  (kind) => {
    const list = kind === "tutor" ? state.tutors : state.tutees;
    const rows =
      kind === "tutor"
        ? records
        : records.map((record) => ({
            id: record.id,
            englishName: record.englishName,
            term: null,
            _count: { sessions: record.sessionCount },
          }));
    const snapshot = {
      data: rows,
      isSuccess: true,
      isFetching: false,
      refetch: state.retry,
    };
    list.mockReturnValue(snapshot);
    // Detail transport fails independently, leaving the previously authorized cache.
    state.details.mockReturnValue({
      data: { ...detailData(), meetingMore: true },
      error: new Error("Detail offline"),
      refetch: state.retry,
    });
    state.tuteeDetails.mockReturnValue({
      data: {
        record: {
          id: "archive-one",
          name: "Private enrollment",
          gradeLevel: "G9",
          academicallyGraduated: false,
        },
        term: null,
        owner: null,
        count: 0,
        sessions: [],
      },
      error: new Error("Detail offline"),
      refetch: state.retry,
    });
    const content = () =>
      wrap(
        "en",
        kind === "tutor" ? <PersonalTutorHistory /> : <PersonalTuteeHistory />,
      );
    const view = render(content());
    fireEvent.click(
      screen.getByRole("button", { name: /View History.*archive-one/ }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    if (kind === "tutor")
      fireEvent.click(
        within(
          screen.getByRole("navigation", { name: en.tuteeHistory.meetings }),
        ).getByRole("button", { name: en.workflows.next }),
      );
    list.mockReturnValue({
      ...snapshot,
      data: rows.slice(1),
      isFetching: true,
    });
    view.rerender(content());
    expect(screen.getByRole("dialog")).toBeTruthy();
    list.mockReturnValue({
      ...snapshot,
      isSuccess: false,
      error: new Error("List offline"),
    });
    view.rerender(content());
    expect(screen.getByRole("dialog")).toBeTruthy();
    if (kind === "tutor")
      expect(state.details).toHaveBeenLastCalledWith(
        { tutorId: "archive-one", page: 0, meetingPage: 1, amendmentPage: 0 },
        { refetchOnMount: "always" },
      );
    list.mockReturnValue({ ...snapshot, data: rows.slice(1) });
    view.rerender(content());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: /View History.*archive-two/ }),
    ).toBeTruthy();
    list.mockReturnValue(snapshot);
    view.rerender(content());
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it.each(["en", "zh"] as const)(
  "scopes %s empty history and distinguishes same-name records without renaming them",
  (locale) => {
    const copy = (locale === "en" ? en : zh).tuteeHistory;
    render(
      wrap(
        locale,
        <>
          <PersonalTuteeHistory />
          <PersonalTutorHistory />
        </>,
      ),
    );
    expect(
      screen.getByRole("heading", { name: copy.tuteeHistory }),
    ).toBeTruthy();
    expect(screen.getByText(copy.noTuteeHistory)).toBeTruthy();
    expect(screen.queryByText(copy.noHistory)).toBeNull();
    expect(screen.queryByText(copy.noTutorHistory)).toBeNull();
    expect(screen.getAllByText("Same Name")).toHaveLength(2);
    expect(screen.getByText("24-25 Q1")).toBeTruthy();
    expect(screen.getByText("25-26 Q2")).toBeTruthy();
    expect(state.details).not.toHaveBeenCalled();
    const rows = within(
      screen.getByRole("table", { name: copy.tutorHistory }),
    ).getAllByRole("row");
    fireEvent.click(
      within(rows[2]!).getByRole("button", {
        name: new RegExp(`${copy.details}.*archive-two`),
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Same Name" });
    expect(within(dialog).getByText(/archive-two/)).toBeTruthy();
    expect(within(dialog).getByText(copy.noSessions)).toBeTruthy();
    expect(within(dialog).getByText(copy.noMeetings)).toBeTruthy();
    expect(within(dialog).getByText(copy.noAmendments)).toBeTruthy();
  },
);

it("retries failed reads while retaining cached summaries and selected tutor context", () => {
  state.tutors.mockReturnValue({
    data: records,
    error: new Error("Read failed"),
    refetch: state.retry,
  });
  state.details.mockReturnValue({
    error: new Error("Read failed"),
    refetch: state.retry,
  });
  render(wrap("en", <PersonalTutorHistory />));
  expect(screen.getAllByText("Same Name")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  expect(state.retry).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getAllByRole("button", {
      name: new RegExp(en.tuteeHistory.details),
    })[0]!,
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.uiPatterns.retry,
    }),
  );
  expect(state.retry).toHaveBeenCalledTimes(2);
  expect(
    within(screen.getByRole("dialog")).getByText(/archive-one/),
  ).toBeTruthy();
});

it("advances meeting evidence without changing the session or amendment cursor", () => {
  state.details.mockReturnValue({
    data: {
      ...detailData(),
      sessions: [],
      meetings: [],
      amendments: [],
      sessionMore: true,
      meetingMore: true,
      amendmentMore: false,
    },
    refetch: state.retry,
  });
  render(wrap("en", <PersonalTutorHistory />));
  fireEvent.click(
    screen.getAllByRole("button", {
      name: new RegExp(en.tuteeHistory.details),
    })[0]!,
  );
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: en.tuteeHistory.meetings }),
    ).getByRole("button", { name: en.workflows.next }),
  );
  expect(state.details).toHaveBeenLastCalledWith(
    { tutorId: "archive-one", page: 0, meetingPage: 1, amendmentPage: 0 },
    { refetchOnMount: "always" },
  );
});

it("replaces the selected summary with freshly read detail identity, totals and dates", () => {
  state.details.mockReturnValue({
    data: undefined,
    isLoading: true,
    refetch: state.retry,
  });
  const view = render(wrap("en", <PersonalTutorHistory />));
  fireEvent.click(
    screen.getByRole("button", { name: /View History.*archive-one/ }),
  );
  expect(screen.getByRole("dialog", { name: "Same Name" })).toBeTruthy();
  const date = new Date("2026-10-21T00:00:00Z");
  const latest = {
    ...detailData(),
    record: { id: "archive-one", englishName: "Updated original name" },
    periods: ["26-27 Q2"],
    firstSessionDate: date,
    lastSessionDate: date,
    counts: { sessions: 11, meetings: 2, amendments: 4 },
  };
  state.details.mockReturnValue({
    data: latest,
    isSuccess: true,
    refetch: state.retry,
  });
  view.rerender(wrap("en", <PersonalTutorHistory />));
  const dialog = screen.getByRole("dialog", { name: "Updated original name" });
  expect(within(dialog).getByText("26-27 Q2")).toBeTruthy();
  expect(within(dialog).queryByText("24-25 Q1")).toBeNull();
  expect(
    within(dialog).getByText(
      "11 sessions · 2 meeting records · 4 hour amendments",
    ),
  ).toBeTruthy();
  expect(
    within(dialog).getByText("Session dates: Oct 21, 2026 – Oct 21, 2026"),
  ).toBeTruthy();
  state.details.mockReturnValue({
    data: latest,
    error: new Error("Network failure"),
    refetch: state.retry,
  });
  view.rerender(wrap("en", <PersonalTutorHistory />));
  expect(
    screen.getByRole("dialog", { name: "Updated original name" }),
  ).toBeTruthy();
  expect(
    within(dialog).getByText(
      "11 sessions · 2 meeting records · 4 hour amendments",
    ),
  ).toBeTruthy();
});

it("shows recorded tutee enrollment periods without substituting a current grade", () => {
  state.tutees.mockReturnValue({
    data: [
      {
        id: "tutee-record",
        englishName: "Past Student",
        gradeLevel: "G12",
        term: { name: "2024 Autumn" },
        _count: { sessions: 4 },
      },
    ],
    refetch: state.retry,
  });
  render(wrap("en", <PersonalTuteeHistory />));
  expect(screen.getByText("2024 Autumn")).toBeTruthy();
  expect(screen.queryByText("G12")).toBeNull();
  expect(
    screen.getByRole("table", { name: en.tuteeHistory.tuteeHistory }),
  ).toBeTruthy();
});
