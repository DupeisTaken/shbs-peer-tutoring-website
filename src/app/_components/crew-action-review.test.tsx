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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import CrewPage from "../(admin)/admin/crew/page";
import { ReadOnlyProvider } from "./read-only";

const state = vi.hoisted(() => ({
  status: "ACTIVE",
  patrols: 2,
  hours: 1,
  requestKind: "OPT_OUT",
  empty: [],
  commit: vi.fn(),
  refresh: vi.fn<(name: string) => Promise<void>>(),
  error: null as Error | null,
  readError: null as null | { scope: string; code?: string },
  coldRead: "",
  refetch: vi.fn(),
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (procedure: { name: string }) => [procedure.name],
}));
vi.mock("./patrol-corrections", () => ({ PatrolCorrections: () => null }));
vi.mock("./email-details", () => ({ EmailDetails: () => null }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: new Proxy(
        {},
        {
          get: (_target, name) => ({
            invalidate: () => state.refresh(String(name)),
          }),
        },
      ),
    }),
    admin: new Proxy(
      {},
      {
        get: (_target, name) => ({
          name: String(name),
          useQuery: () => ({
            error:
              state.readError?.scope === name
                ? {
                    message: "Synthetic read failure",
                    data: { code: state.readError.code },
                  }
                : null,
            isSuccess:
              state.readError?.scope !== name && state.coldRead !== name,
            isFetching: false,
            refetch: state.refetch,
            data:
              state.coldRead === name
                ? undefined
                : name === "crewRoster"
                  ? [
                      {
                        id: "member-1",
                        name: "Synthetic crew member",
                        status: state.status,
                        crewOnly: true,
                        tutor: null,
                        patrols: state.patrols,
                        hours: state.hours,
                      },
                    ]
                  : name === "crewApplications"
                    ? [
                        {
                          id: "app-1",
                          name: "Synthetic applicant",
                          email: "applicant@example.test",
                          message:
                            "Original application.\n\n" +
                            "Full application evidence. ".repeat(30),
                        },
                      ]
                    : name === "crewRequests"
                      ? [
                          {
                            id: "request-1",
                            member: "Synthetic requester",
                            kind: state.requestKind,
                            approvable: true,
                            reason:
                              "Original request.\n\n" +
                              "Full request evidence. ".repeat(30),
                          },
                        ]
                      : state.empty,
          }),
          useMutation: (options?: {
            onSuccess?: (data: unknown, input: unknown) => unknown;
          }) => ({
            mutate: vi.fn(),
            isPending: false,
            mutateAsync: async (input: unknown) => {
              state.commit(String(name), input);
              if (state.error) throw state.error;
              await options?.onSuccess?.({ code: "synthetic-code" }, input);
              return {};
            },
          }),
        }),
      },
    ),
  },
}));
let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  state.status = "ACTIVE";
  state.patrols = 2;
  state.hours = 1;
  state.requestKind = "OPT_OUT";
  state.error = null;
  state.readError = null;
  state.coldRead = "";
  vi.resetAllMocks();
  state.refresh.mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(cleanup);
const show = (readOnly = false, locale = "en") =>
  render(<CrewPage />, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider
          locale={locale}
          messages={locale === "zh" ? zh : en}
          timeZone="UTC"
        >
          <ReadOnlyProvider value={readOnly}>{children}</ReadOnlyProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>
    ),
  });

it.each(["en", "zh"])(
  "shows known zero crew totals in the %s roster",
  (locale) => {
    state.patrols = 0;
    state.hours = 0;
    show(true, locale);
    fireEvent.click(
      screen.getByRole("tab", {
        name: (locale === "zh" ? zh : en).admin.crew.panels.roster,
      }),
    );
    const row = screen.getByText("Synthetic crew member").closest("tr")!;
    expect(within(row).getByRole("cell", { name: "0" })).toBeTruthy();
    expect(within(row).getByRole("cell", { name: "0.0 h" })).toBeTruthy();
  },
);
const cases = [
  [
    en.admin.crew.softRemove,
    "setCrewStatus",
    { userId: "member-1", status: "INACTIVE" },
    "Synthetic crew member",
  ],
  [
    en.admin.crew.delete,
    "deleteCrewMember",
    { userId: "member-1" },
    "Synthetic crew member",
  ],
  [
    en.admin.crew.accept,
    "decideCrewApplication",
    { applicationId: "app-1", action: "ACCEPT" },
    "Synthetic applicant",
  ],
  [
    en.admin.crew.reject,
    "decideCrewApplication",
    { applicationId: "app-1", action: "REJECT" },
    "Synthetic applicant",
  ],
  [
    en.admin.crew.approve,
    "decideCrewRequest",
    { requestId: "request-1", action: "APPROVE" },
    "Synthetic requester",
  ],
  [
    en.admin.crew.deny,
    "decideCrewRequest",
    { requestId: "request-1", action: "DENY" },
    "Synthetic requester",
  ],
] as const;

it("keeps full application/request evidence readable before a decision, including for read-only viewers", () => {
  show(true);
  for (const [kind, name, text] of [
    ["application", "Synthetic applicant", "Full application evidence."],
    ["request", "Synthetic requester", "Full request evidence."],
  ] as const) {
    fireEvent.click(
      screen.getByRole("button", {
        name: `View details: Original ${kind} · ${name}`,
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent?.split(text)).toHaveLength(31);
    expect(
      within(dialog).getByRole("button", { name: "Close" }).parentElement
        ?.className,
    ).toContain("sticky");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  }
  expect(state.commit).not.toHaveBeenCalled();
});

it("places complete original evidence inside the existing consequential review", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: en.admin.crew.accept }));
  expect(
    screen.getByRole("dialog").textContent?.split("Full application evidence."),
  ).toHaveLength(31);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: en.admin.crew.approve }));
  expect(
    screen.getByRole("dialog").textContent?.split("Full request evidence."),
  ).toHaveLength(31);
  expect(state.commit).not.toHaveBeenCalled();
});

it("distinguishes one failed initial queue from loaded empty and keeps sibling queues usable", () => {
  state.coldRead = "crewApplications";
  state.readError = { scope: "crewApplications" };
  show();
  expect(screen.queryByText(en.admin.crew.applicationsEmpty)).toBeNull();
  expect(screen.getByText("Synthetic requester")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${en.admin.crew.applicationsHeading}`,
    }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(state.commit).not.toHaveBeenCalled();
});

it("revokes only the affected review and keeps denied evidence concealed until successful recovery", () => {
  const view = show();
  queryClient.setQueryData(["crewApplications"], [{ message: "Private" }]);
  fireEvent.click(screen.getByRole("button", { name: en.admin.crew.accept }));
  state.readError = { scope: "crewRoster" };
  view.rerender(<CrewPage />);
  expect(screen.getByRole("dialog").textContent).toContain(
    "Full application evidence.",
  );
  state.readError = { scope: "crewApplications", code: "FORBIDDEN" };
  view.rerender(<CrewPage />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(queryClient.getQueryData(["crewApplications"])).toBeUndefined();
  state.readError = { scope: "crewApplications" };
  view.rerender(<CrewPage />);
  expect(
    screen.queryByRole("button", { name: en.admin.crew.accept }),
  ).toBeNull();
  state.readError = null;
  view.rerender(<CrewPage />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.admin.crew.accept }));
  expect(screen.getByRole("dialog").textContent).toContain(
    "Full application evidence.",
  );
  expect(state.commit).not.toHaveBeenCalled();
});
it.each(cases)(
  "reviews %s without writing on Cancel and retains a rejected action",
  async (label, operation, input, name) => {
    state.error = new Error("Synthetic crew rejection");
    show();
    if (operation === "setCrewStatus" || operation === "deleteCrewMember")
      fireEvent.click(
        screen.getByRole("tab", { name: en.admin.crew.panels.roster }),
      );
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("dialog").textContent).toContain(name);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: label === en.admin.crew.delete ? en.common.delete : label,
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Synthetic crew rejection",
    );
    expect(state.commit).toHaveBeenCalledExactlyOnceWith(operation, input);
    expect(state.refresh).not.toHaveBeenCalled();
  },
);
it("holds every refresh after accepted crew activation and retries only reads", async () => {
  state.status = "INACTIVE";
  let resolve!: () => void;
  state.refresh.mockImplementation((name: string) =>
    name === "crewSummary"
      ? new Promise<void>((done) => {
          resolve = done;
        })
      : Promise.reject(new Error("Read failed")),
  );
  show();
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.crew.panels.roster }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.admin.crew.enable }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.admin.crew.enable,
    }),
  );
  await waitFor(() => expect(state.refresh).toHaveBeenCalledTimes(5));
  expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  await act(async () => resolve());
  expect(screen.getByRole("status").textContent).toContain(
    "could not be refreshed",
  );
  state.refresh.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      en.actionReview.applied,
    ),
  );
  expect(state.commit).toHaveBeenCalledExactlyOnceWith("setCrewStatus", {
    userId: "member-1",
    status: "ACTIVE",
  });
});
it("withholds consequential actions from a viewer", () => {
  show(true);
  for (const [label] of cases)
    expect(screen.queryByRole("button", { name: label })).toBeNull();
});

it.each(["en", "zh"])(
  "keeps the crew reentry academic guard localized in %s",
  async (locale) => {
    const messages = locale === "zh" ? zh : en;
    state.requestKind = "REENTRY";
    state.error = new Error("ACADEMIC_CONFIRMATION_REQUIRED");
    show(false, locale);
    fireEvent.click(
      screen.getByRole("button", { name: messages.admin.crew.approve }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: messages.admin.crew.approve,
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      messages.academics.confirmationRequired,
    );
    expect(screen.getByRole("dialog").textContent).not.toContain(
      "ACADEMIC_CONFIRMATION_REQUIRED",
    );
    expect(state.refresh).not.toHaveBeenCalled();
  },
);
