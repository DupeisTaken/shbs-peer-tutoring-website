// @vitest-environment jsdom
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
import messages from "../../../messages/en.json";
import { LegacyContinuation } from "./legacy-continuation";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  join: vi.fn(),
  recover: vi.fn(),
  mine: vi.fn(),
  me: vi.fn(),
  agenda: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["continuation"] }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      studentWorkflow: {
        mine: { invalidate: mocks.mine },
        continuationReceipt: { fetch: mocks.recover },
      },
      student: { me: { invalidate: mocks.me } },
      sessionPlanning: { agenda: { invalidate: mocks.agenda } },
    }),
    studentWorkflow: {
      continuationStatus: { useQuery: mocks.query },
      joinContinuation: { useMutation: () => ({ mutateAsync: mocks.join }) },
    },
  },
}));
// PolicyAgreement's read-to-end behavior has its own integration tests. This
// fixture isolates the feature's exact-revision consent and pending boundaries.
vi.mock("~/app/_components/policy-agreement", () => ({
  PolicyAgreement: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <label>
      Accept current policy
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  ),
}));

const serverNow = new Date("2026-10-30T08:00:00.000Z");
const candidate = (id: string, subject: string) => ({
  sourcePairingId: id,
  subjectId: subject.toLowerCase(),
  subject,
  tutorName: `${subject} Tutor`,
  dayOfWeek: 1,
  startMin: 900,
  endMin: 945,
  state: "available",
  reason: null as string | null,
  requested: false,
});
const initial = () => ({
  status: "eligible",
  hasFreshRequest: false,
  serverNow,
  targetTermId: "q2",
  targetTermName: "2026–27 Q2",
  sourceTermId: "q1",
  sourceTermName: "2026–27 Q1",
  timeZone: "Asia/Shanghai",
  openedAt: serverNow,
  expiresAt: new Date(+serverNow + 60 * 60_000),
  revision: "v1",
  minimumSubjects: 1,
  currentRequest: null as {
    id: string;
    version: number;
    subjectIds: string[];
  } | null,
  prerequisites: { fieldsRequired: [] as string[] },
  policy: {
    revision: "policy-1",
    title: "Tutee policy",
    body: "Current rules",
  },
  candidates: [
    candidate("math-pair", "Math"),
    candidate("physics-pair", "Physics"),
  ],
});
let data: ReturnType<typeof initial>;
let queryError: null | { message: string; data?: { code: string } };
const receipt = {
  requestId: "request-q2",
  version: 1,
  results: [
    {
      sourcePairingId: "math-pair",
      subject: "Math",
      tutorName: "Math Tutor",
      state: "assigned",
      reason: null,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  data = initial();
  queryError = null;
  mocks.query.mockImplementation(() => ({
    data,
    error: queryError,
    isSuccess: !queryError,
    isFetching: false,
    refetch: mocks.refetch,
  }));
  mocks.refetch.mockImplementation(async () => ({ data }));
  mocks.join.mockResolvedValue(receipt);
  mocks.recover.mockResolvedValue(null);
  mocks.mine.mockResolvedValue(undefined);
  mocks.me.mockResolvedValue(undefined);
  mocks.agenda.mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={cache}>
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <LegacyContinuation />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const rendered = render(tree());
  return { ...rendered, refresh: () => rendered.rerender(tree()) };
}
function reviewMath() {
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Math with Math Tutor" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review selected pairings" }),
  );
}
function agree() {
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Accept current policy" }),
  );
  fireEvent.change(screen.getByLabelText("Your full name (signature)"), {
    target: { value: "Synthetic Student" },
  });
}

it("reviews individually selected pairings without enrolling on selection or Cancel", () => {
  mount();
  reviewMath();
  expect(screen.getByRole("dialog").textContent).toContain("Math Tutor");
  expect(screen.getByRole("dialog").textContent).not.toContain("Physics Tutor");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.join).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Select Math with Math Tutor",
    }).checked,
  ).toBe(true);
});

it("requires current policy agreement and a signature before Join", () => {
  mount();
  reviewMath();
  const button = screen.getByRole("button", { name: "Join selected pairings" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Accept current policy" }),
  );
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Your full name (signature)"), {
    target: { value: "Synthetic Student" },
  });
  expect(button.hasAttribute("disabled")).toBe(false);
});

it("admits one write, freezes the review, and reports mixed assignment outcomes", async () => {
  let resolve!: (value: typeof receipt) => void;
  mocks.join.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mount();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Physics with Physics Tutor" }),
  );
  reviewMath();
  agree();
  const button = screen.getByRole("button", { name: "Join selected pairings" });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(mocks.join).toHaveBeenCalledTimes(1);
  expect(
    screen.getByLabelText("Your full name (signature)").matches(":disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"),
  ).toBe(true);
  await act(async () =>
    resolve({
      ...receipt,
      results: [
        ...receipt.results,
        {
          sourcePairingId: "physics-pair",
          subject: "Physics",
          tutorName: "Physics Tutor",
          state: "queued",
          reason: null,
        },
      ],
    }),
  );
  expect(screen.getByText("Your signup request has been filed.")).toBeTruthy();
  expect(screen.getByText(/Request filed; awaiting assignment/)).toBeTruthy();
  expect(mocks.join.mock.calls[0]?.[0]).toMatchObject({
    sourcePairingIds: ["math-pair", "physics-pair"],
    policyRevision: "policy-1",
    agreed: true,
    signatureName: "Synthetic Student",
  });
});

it("recovers a committed lost response without replaying Join", async () => {
  mocks.join.mockRejectedValue(new Error("Response lost"));
  mocks.recover.mockResolvedValue(receipt);
  mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  await screen.findByText(/The submission result could not be confirmed/);
  const posted = mocks.join.mock.calls[0]?.[0] as { clientKey: string };
  const key = posted.clientKey;
  fireEvent.click(screen.getByRole("button", { name: "Check request result" }));
  await screen.findByText("Your signup request has been filed.");
  expect(mocks.recover).toHaveBeenCalledWith({ clientKey: key });
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it("keeps receipt recovery available when a later poll has no eligible source period", async () => {
  mocks.join.mockRejectedValue(new Error("Response lost"));
  mocks.recover.mockResolvedValue(receipt);
  const view = mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  await screen.findByText(/The submission result could not be confirmed/);
  const posted = mocks.join.mock.calls[0]?.[0] as { clientKey: string };
  data = {
    ...data,
    status: "unavailable",
    candidates: [],
    revision: "new-period",
  };
  view.refresh();
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check request result" }));
  await screen.findByText("Your signup request has been filed.");
  expect(mocks.recover).toHaveBeenCalledWith({ clientKey: posted.clientKey });
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it("hides an unavailable empty continuation panel when no review or attempt needs recovery", () => {
  data = { ...data, status: "unavailable", candidates: [] };
  mount();
  expect(
    screen.queryByRole("heading", { name: messages.legacyContinuation.title }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Check request result" }),
  ).toBeNull();
});

it("hides the continuation shortcut after a confirmed ordinary request even with prior pairings", () => {
  data.hasFreshRequest = true;
  mount();
  expect(screen.queryByText(/Math Tutor/)).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it("discards an open review when confirmed ordinary intake supersedes it", () => {
  const view = mount();
  reviewMath();
  agree();
  data = { ...data, hasFreshRequest: true, revision: "ordinary-request" };
  view.refresh();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/Math Tutor/)).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  queryError = { message: "Network unavailable" };
  view.refresh();
  expect(screen.queryByRole("button")).toBeNull();
  expect(mocks.join).not.toHaveBeenCalled();
});

it("keeps only read-only receipt recovery when a confirmed ordinary request arrives during Join", async () => {
  let resolve!: (value: typeof receipt) => void;
  mocks.join.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  data = { ...data, hasFreshRequest: true, revision: "ordinary-request" };
  view.refresh();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Check request result" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(async () => resolve(receipt));
  expect(screen.getByText("Your signup request has been filed.")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Review selected pairings" }),
  ).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it("recovers a lost reply after ordinary confirmation without restoring the shortcut", async () => {
  mocks.join.mockRejectedValue(new Error("Response lost"));
  mocks.recover.mockResolvedValue(receipt);
  const view = mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  await screen.findByText(/The submission result could not be confirmed/);
  data = { ...data, hasFreshRequest: true, revision: "ordinary-request" };
  view.refresh();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/Math Tutor/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check request result" }));
  await screen.findByText("Your signup request has been filed.");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Review selected pairings" }),
  ).toBeNull();
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it("removes held recovery after a confirmed ordinary request when no receipt exists", async () => {
  mocks.join.mockRejectedValue(new Error("Rejected"));
  const view = mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  await screen.findByText(/The submission result could not be confirmed/);
  data = { ...data, hasFreshRequest: true, revision: "ordinary-request" };
  view.refresh();
  fireEvent.click(screen.getByRole("button", { name: "Check request result" }));
  await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  expect(screen.queryByText(/Math Tutor/)).toBeNull();
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it("retains a rejected draft and allows a fresh attempt only after checking receipt absence", async () => {
  mocks.join.mockRejectedValue(new Error("Rejected"));
  mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  await screen.findByText(/The submission result could not be confirmed/);
  expect(
    screen.queryByRole("button", { name: "Join selected pairings" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check request result" }));
  await screen.findByText(/No accepted submission was found/);
  expect(
    screen.getByLabelText<HTMLInputElement>("Your full name (signature)").value,
  ).toBe("Synthetic Student");
  expect(mocks.join).toHaveBeenCalledTimes(1);
  expect(
    screen
      .getByRole("button", { name: "Join selected pairings" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("recovers only reads after a saved request fails to refresh", async () => {
  mocks.mine.mockRejectedValueOnce(new Error("Read failed"));
  mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  await screen.findByText(
    /Your request was saved, but the latest schedule could not be loaded/,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByText(/Your request was saved, but/)).toBeNull(),
  );
  expect(mocks.join).toHaveBeenCalledTimes(1);
  expect(mocks.recover).not.toHaveBeenCalled();
  expect(mocks.mine).toHaveBeenCalledTimes(2);
});

it("retains selected rows on background failure and conceals them after authoritative denial", async () => {
  const view = mount();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Math with Math Tutor" }),
  );
  queryError = { message: "Network unavailable" };
  view.refresh();
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Select Math with Math Tutor",
    }).checked,
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Review selected pairings" })
      .hasAttribute("disabled"),
  ).toBe(true);
  queryError = { message: "Access revoked", data: { code: "FORBIDDEN" } };
  view.refresh();
  expect(screen.queryByText("Math · Math Tutor")).toBeNull();
  expect(
    screen.getByText("You no longer have access to these pairings."),
  ).toBeTruthy();
  queryError = { message: "Network unavailable" };
  view.refresh();
  expect(
    screen.queryByRole("checkbox", { name: "Select Math with Math Tutor" }),
  ).toBeNull();
  expect(mocks.join).not.toHaveBeenCalled();
});

it("counts existing request subjects toward the two-subject limit", () => {
  data.currentRequest = {
    id: "request",
    version: 2,
    subjectIds: ["chemistry"],
  };
  mount();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Math with Math Tutor" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Physics with Physics Tutor" }),
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "at most two distinct subjects",
  );
  expect(
    screen
      .getByRole("button", { name: "Review selected pairings" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("allows new queued demand but disables previously requested and released rows", () => {
  data.candidates[0] = {
    ...data.candidates[0]!,
    state: "queued",
    reason: "tutorUnavailable",
  };
  data.candidates[1] = {
    ...data.candidates[1]!,
    state: "released",
    requested: true,
    reason: "released",
  };
  mount();
  expect(
    screen
      .getByRole("checkbox", { name: "Select Math with Math Tutor" })
      .matches(":disabled"),
  ).toBe(false);
  expect(
    screen
      .getByRole("checkbox", { name: "Select Physics with Physics Tutor" })
      .matches(":disabled"),
  ).toBe(true);
  expect(
    screen.getByText("The previous tutor is not currently available."),
  ).toBeTruthy();
});

it("requires a new review when the server revision changes", () => {
  const view = mount();
  reviewMath();
  agree();
  data = { ...data, revision: "v2" };
  view.refresh();
  expect(screen.getByText(/These details changed/)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Join selected pairings" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Review selected pairings" }),
  );
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Accept current policy",
    }).checked,
  ).toBe(false);
});

it("disables an open review at the exact server-anchored hour boundary", () => {
  vi.useFakeTimers();
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  mount();
  reviewMath();
  agree();
  monotonic = 60 * 60_000;
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(
    screen
      .getByRole("button", { name: "Join selected pairings" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  expect(mocks.join).not.toHaveBeenCalled();
});

it("offers the normal signup fallback when required details need review", () => {
  data.prerequisites.fieldsRequired = ["preferredContact"];
  mount();
  expect(
    screen
      .getByRole("link", { name: "Review required details" })
      .getAttribute("href"),
  ).toBe("/tutee");
  expect(
    screen
      .getByRole("checkbox", { name: "Select Math with Math Tutor" })
      .matches(":disabled"),
  ).toBe(true);
});

it.each([
  {
    required: ["emailVerification"],
    existing: false,
    destination: "/onboarding/email",
  },
  {
    required: ["emailVerification", "phone"],
    existing: true,
    destination: "/onboarding/email",
  },
  {
    required: ["phone"],
    existing: true,
    destination: "/student?view=requests#current-request",
  },
  {
    required: ["requestReview"],
    existing: false,
    destination: "/student?view=requests#current-request",
  },
])(
  "routes prerequisite recovery to $destination for $required",
  ({ required, existing, destination }) => {
    data.prerequisites.fieldsRequired = required;
    if (existing)
      data.currentRequest = { id: "request", version: 2, subjectIds: ["math"] };
    mount();
    expect(
      screen
        .getByRole("link", { name: "Review required details" })
        .getAttribute("href"),
    ).toBe(destination);
  },
);

it("keeps receipt recovery reachable if access returns after denial during Join", async () => {
  let resolve!: (value: typeof receipt) => void;
  mocks.join.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mocks.recover.mockResolvedValue(receipt);
  const view = mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  queryError = { message: "Access revoked", data: { code: "FORBIDDEN" } };
  view.refresh();
  await act(async () => resolve(receipt));
  expect(screen.queryByText("Your signup request has been filed.")).toBeNull();
  queryError = null;
  view.refresh();
  fireEvent.click(screen.getByRole("button", { name: "Check request result" }));
  await screen.findByText("Your signup request has been filed.");
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it("explains dated-session duration only when the historical weekly duration differs", () => {
  data.candidates[0]!.endMin = 960;
  mount();
  reviewMath();
  expect(
    screen.getByText(/Dated lessons follow the current 45-minute timetable/),
  ).toBeTruthy();
});

it("disables an unmapped historical subject without counting it toward the subject limit", () => {
  data.candidates[0] = {
    ...data.candidates[0]!,
    subjectId: "",
    reason: "subjectUnavailable",
  };
  mount();
  expect(
    screen
      .getByRole("checkbox", { name: "Select Math with Math Tutor" })
      .matches(":disabled"),
  ).toBe(true);
  expect(screen.queryByText(/Choose at most two distinct subjects/)).toBeNull();
  expect(
    screen
      .getByRole("checkbox", { name: "Select Physics with Physics Tutor" })
      .matches(":disabled"),
  ).toBe(false);
});

it("conceals cached pairing details immediately when Join denies access", async () => {
  mocks.join.mockRejectedValue({ data: { code: "FORBIDDEN" } });
  mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  await screen.findByText("You no longer have access to these pairings.");
  expect(screen.queryByText(/Math Tutor/)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows a later release from the current request without rewriting or replaying its receipt", async () => {
  const view = mount();
  reviewMath();
  agree();
  fireEvent.click(
    screen.getByRole("button", { name: "Join selected pairings" }),
  );
  await screen.findByText("Your signup request has been filed.");
  data = {
    ...data,
    currentRequest: {
      id: receipt.requestId,
      version: receipt.version,
      subjectIds: ["math"],
    },
    candidates: data.candidates.map((row) =>
      row.sourcePairingId === "math-pair"
        ? {
            ...row,
            requested: true,
            state: "released",
            reason: "tutorUnavailable",
          }
        : row,
    ),
  };
  view.refresh();
  expect(screen.queryByText(/— Assigned/)).toBeNull();
  expect(
    screen.getByText(/Assignment released; request retained/),
  ).toBeTruthy();
  expect(receipt.results[0]?.state).toBe("assigned");
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it("requires the configured two subjects and counts subjects on the current request", () => {
  data.minimumSubjects = 2;
  const view = mount();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select Math with Math Tutor" }),
  );
  expect(
    screen
      .getByRole("button", { name: "Review selected pairings" })
      .hasAttribute("disabled"),
  ).toBe(true);
  data = {
    ...data,
    currentRequest: { id: "request", version: 1, subjectIds: ["physics"] },
  };
  view.refresh();
  expect(
    screen
      .getByRole("button", { name: "Review selected pairings" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(mocks.join).not.toHaveBeenCalled();
});

it("offers the full form when eligible prior pairings cannot meet the configured subject minimum", () => {
  data.minimumSubjects = 2;
  data.candidates = [data.candidates[0]!];
  mount();
  expect(
    screen
      .getByRole("link", { name: "Review required details" })
      .getAttribute("href"),
  ).toBe("/tutee");
  expect(
    screen.getByText(/This signup requires two distinct subjects/),
  ).toBeTruthy();
});
