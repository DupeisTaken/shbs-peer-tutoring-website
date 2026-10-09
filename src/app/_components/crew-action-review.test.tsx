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
import en from "../../../messages/en.json";
import CrewPage from "../(admin)/admin/crew/page";
import { ReadOnlyProvider } from "./read-only";

const state = vi.hoisted(() => ({
  status: "ACTIVE",
  empty: [],
  commit: vi.fn(),
  refresh: vi.fn<(name: string) => Promise<void>>(),
  error: null as Error | null,
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
          useQuery: () => ({
            data:
              name === "crewRoster"
                ? [
                    {
                      id: "member-1",
                      name: "Synthetic crew member",
                      status: state.status,
                      crewOnly: true,
                      tutor: null,
                      patrols: 2,
                      hours: 1,
                    },
                  ]
                : name === "crewApplications"
                  ? [
                      {
                        id: "app-1",
                        name: "Synthetic applicant",
                        email: "applicant@example.test",
                      },
                    ]
                  : name === "crewRequests"
                    ? [
                        {
                          id: "request-1",
                          member: "Synthetic requester",
                          kind: "OPT_OUT",
                          approvable: true,
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
beforeEach(() => {
  state.status = "ACTIVE";
  state.error = null;
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
const show = (readOnly = false) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <ReadOnlyProvider value={readOnly}>
        <CrewPage />
      </ReadOnlyProvider>
    </NextIntlClientProvider>,
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
it.each(cases)(
  "reviews %s without writing on Cancel and retains a rejected action",
  async (label, operation, input, name) => {
    state.error = new Error("Synthetic crew rejection");
    show();
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
