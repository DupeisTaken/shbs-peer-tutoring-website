/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en.json";
import type { RouterOutputs } from "~/trpc/react";
import { UserDetails } from "./user-details";

type Detail = RouterOutputs["admin"]["accountDetails"];
const remote = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      admin: {
        accountDetails: {
          useQuery(
            input: unknown,
            options?: { refetchOnMount?: "always" | boolean },
          ) {
            return useQuery<Detail>({
              queryKey: ["admin.accountDetails", input],
              queryFn: () => remote.load() as Promise<Detail>,
              ...options,
            });
          },
        },
      },
    },
  };
});
vi.mock("~/app/_components/email-details", () => ({
  EmailContent: () => <p>Email details</p>,
}));
vi.mock("~/app/_components/acceptance-records", () => ({
  AcceptanceRecords: () => <p>Policy evidence</p>,
}));
vi.mock("~/app/_components/tutor-details", () => ({
  TutorDetailsButton: () => <button>Tutor details</button>,
}));
vi.mock("~/app/_components/tutee-history", () => ({
  TuteeHistoryDialog: () => null,
}));

const academic = {
  status: "REPORTED" as const,
  gradeLevel: 11,
  rawGrade: null,
  schoolYear: "26-27",
  confirmedAt: null,
  expectedGraduationYear: 2028,
  needsConfirmation: false,
};
const initial: Detail = {
  membership: {
    rank: "ADMIN",
    tutor: true,
    tutee: true,
    translator: false,
    crew: false,
    viewer: false,
  },
  crewStatus: null,
  tutorAccessRevoked: false,
  mustChangePassword: false,
  suspendedAt: null,
  suspendedReason: null,
  attached: [
    {
      id: "profile",
      name: "Original profile",
      username: "synthetic",
      kind: "TUTOR",
      status: "ACTIVE",
      direct: true,
      historical: false,
      academic,
      retainedOwner: null,
    },
  ],
  retained: [],
};
const updated: Detail = {
  ...initial,
  membership: { ...initial.membership!, rank: "NONE", tutor: false },
  tutorAccessRevoked: true,
  suspendedAt: new Date("2026-10-09T00:00:00Z"),
  suspendedReason: "Reviewed restriction",
  attached: [{ ...initial.attached[0]!, name: "Updated profile" }],
  retained: [
    {
      ...initial.attached[0]!,
      id: "archive",
      name: "Linked archive",
      direct: false,
      historical: true,
      status: "ARCHIVED",
    },
  ],
};
const row = {
  userId: "login",
  tutorId: "profile",
  name: "Synthetic Person",
  account: "registered",
  academic,
} as RouterOutputs["admin"]["accounts"]["rows"][number];
let client: QueryClient;
let server: Detail;

/** Model another editor's save boundary with a real mutation/cache. Like existing
 * editors it refreshes the list, without knowing this new on-demand query key. */
function IndependentEditor() {
  const save = useMutation({
    mutationFn: async () => {
      await remote.save();
      server = updated;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin.accounts"] }),
  });
  return (
    <>
      <button onClick={() => save.mutate()}>Save reviewed change</button>
      {save.isSuccess && <p>Change saved</p>}
      <UserDetails row={row} />
    </>
  );
}
function mount() {
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <IndependentEditor />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "User details: Synthetic Person" }),
  );
const close = () =>
  fireEvent.click(
    screen.getByRole("dialog").querySelector<HTMLButtonElement>("button")!,
  );
beforeEach(() => {
  server = initial;
  remote.load.mockReset();
  remote.load.mockImplementation(async () => server);
  remote.save.mockReset();
  remote.save.mockResolvedValue(undefined);
  // Match the production freshness window: reopening well inside 30 seconds must
  // still load the changed authority/ownership rather than trust a fresh cache.
  client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false },
      mutations: { retry: false },
    },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it("rechecks membership, suspension, identity and linked archives immediately after another editor saves", async () => {
  mount();
  open();
  await screen.findByText("Original profile");
  expect(remote.load).toHaveBeenCalledTimes(1);
  close();
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed change" }));
  await screen.findByText("Change saved");
  // The previous value is still a fresh cache entry until the dialog mounts again.
  expect(
    client.getQueryData(["admin.accountDetails", { userId: "login" }]),
  ).toEqual(initial);
  open();
  await screen.findByText("Updated profile");
  expect(remote.load).toHaveBeenCalledTimes(2);
  const memberships = screen.getByRole("region", {
    name: "Permissions and memberships",
  });
  expect(within(memberships).queryByText("Admin")).toBeNull();
  expect(within(memberships).queryByText("Tutor")).toBeNull();
  expect(within(memberships).getByText("Tutee")).toBeTruthy();
  expect(screen.getByText("Suspended")).toBeTruthy();
  expect(screen.getByText("Linked archive")).toBeTruthy();
});

it("keeps cached details on reopen failure and retries only the read", async () => {
  mount();
  open();
  await screen.findByText("Original profile");
  close();
  remote.load.mockRejectedValueOnce(new Error("Temporary detail failure"));
  open();
  await screen.findByRole("alert");
  expect(screen.getByText("Original profile")).toBeTruthy();
  server = updated;
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  await screen.findByText("Updated profile");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(remote.load).toHaveBeenCalledTimes(3);
  expect(remote.save).not.toHaveBeenCalled();
});
