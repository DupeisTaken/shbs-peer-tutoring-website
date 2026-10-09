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
import messages from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import type { RouterOutputs } from "~/trpc/react";
import { UserDetails } from "./user-details";
import { LoginSetup, MembershipBadges } from "./presentation";

const fixture = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: { admin: { accountDetails: { useQuery: fixture.query } } },
}));
vi.mock("~/app/_components/email-details", () => ({
  EmailContent: () => <div>Email and verification controls</div>,
}));
vi.mock("~/app/_components/acceptance-records", () => ({
  AcceptanceRecords: ({ userId }: { userId: string }) => (
    <div>Policy evidence: {userId}</div>
  ),
}));
vi.mock("~/app/_components/tutor-details", () => ({
  TutorDetailsButton: () => <button>Tutor details</button>,
}));
vi.mock("~/app/_components/tutee-history", () => ({
  TuteeHistoryDialog: () => <div role="dialog">Tutee evidence</div>,
}));

const academic = {
  status: "REPORTED" as const,
  gradeLevel: 10,
  rawGrade: "10",
  schoolYear: "24-25",
  confirmedAt: null,
  expectedGraduationYear: 2027,
  needsConfirmation: false,
};
const membership = {
  rank: "ADMIN" as const,
  tutor: true,
  tutee: true,
  translator: true,
  crew: true,
  viewer: false,
};
const profile = {
  id: "tutor",
  name: "Synthetic Tutor",
  username: "synthetic",
  kind: "TUTOR" as const,
  status: "PENDING" as const,
  direct: true,
  historical: false,
  academic,
  retainedOwner: null,
};
const data = {
  membership,
  crewStatus: "INACTIVE",
  tutorAccessRevoked: false,
  mustChangePassword: false,
  suspendedAt: new Date("2026-01-01"),
  suspendedReason: "Synthetic restriction",
  attached: [profile],
  retained: [1, 2].map((n) => ({
    ...profile,
    id: `archive-${n}`,
    name: `Archive ${n}`,
    direct: false,
    historical: true,
    status: "ARCHIVED",
  })),
};
const row = {
  userId: "login",
  tutorId: "tutor",
  name: "Synthetic Person",
  email: "synthetic@example.test",
  account: "registered",
  academic: {
    ...academic,
    gradeLevel: 12,
    expectedGraduationYear: 2029,
    schoolYear: "28-29",
  },
} as RouterOutputs["admin"]["accounts"]["rows"][number];
const mount = (
  element = <UserDetails row={row} />,
  locale: "en" | "zh" = "en",
) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? messages : zh}
    >
      {element}
    </NextIntlClientProvider>,
  );
const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "User details: Synthetic Person" }),
  );
beforeEach(() => {
  fixture.query.mockReset();
  fixture.query.mockReturnValue({
    data,
    refetch: fixture.refetch,
    isFetching: false,
  });
  fixture.refetch.mockClear();
});
afterEach(cleanup);

it("mounts detail reads on demand and separates all four dimensions with both memberships", () => {
  mount();
  expect(fixture.query).not.toHaveBeenCalled();
  open();
  expect(fixture.query).toHaveBeenCalledWith({ userId: "login" });
  for (const title of [
    "Login",
    "Permissions and memberships",
    "Attached participant profiles",
    "Historical records",
  ])
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  const roles = screen.getByRole("region", {
    name: "Permissions and memberships",
  });
  for (const badge of [
    "Admin",
    "Tutor",
    "Tutee",
    "Translator",
    messages.admin.users.roles.CREW,
  ])
    expect(within(roles).getByText(badge)).toBeTruthy();
  expect(screen.getByText("Setup complete")).toBeTruthy();
  expect(screen.getByText("Suspended")).toBeTruthy();
  expect(screen.getByText("Crew lifecycle: Inactive")).toBeTruthy();
  expect(screen.getByText("Archive 1")).toBeTruthy();
  expect(screen.getByText("Archive 2")).toBeTruthy();
  expect(screen.getByText("Policy evidence: login")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /link historical/i })).toBeNull();
});

it("keeps archive academics independent from the current account and uses nested details", () => {
  mount();
  open();
  const archive = screen.getByText("Archive 1").closest("tr")!;
  fireEvent.click(
    within(archive).getByRole("button", { name: /Academic Details/ }),
  );
  const nested = screen.getByRole("dialog", { name: "Archive 1" });
  expect(within(nested).getByText("Grade 10")).toBeTruthy();
  expect(within(nested).getByText(/2027/)).toBeTruthy();
  expect(within(nested).queryByText(/2029/)).toBeNull();
  // jsdom does not synthesize a native cancel event from Escape; the real browser
  // rehearsal separately verifies the key and exact opener restoration.
  fireEvent(nested, new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

it("distinguishes accountless records with retained owners from ownerless records", () => {
  fixture.query.mockReturnValue({
    data: {
      ...data,
      membership: null,
      suspendedAt: null,
      retained: [],
      attached: [
        {
          ...profile,
          direct: false,
          retainedOwner: {
            id: "owner",
            name: "Retained Person",
            username: "retained",
          },
        },
      ],
    },
  });
  mount(
    <UserDetails
      row={{ ...row, userId: null, account: "invited" } as typeof row}
    />,
  );
  open();
  expect(fixture.query).toHaveBeenCalledWith({ tutorId: "tutor" });
  expect(screen.getByText("Invitation pending")).toBeTruthy();
  expect(screen.getByText("No direct login attached")).toBeTruthy();
  expect(
    screen.getByText("Retained historical owner: Retained Person"),
  ).toBeTruthy();
  expect(screen.queryByText("Policy evidence: login")).toBeNull();
});

it("retains cached details on a refresh failure and retries the read", () => {
  fixture.query.mockReturnValue({
    data,
    error: new Error("Read failed"),
    refetch: fixture.refetch,
    isFetching: false,
  });
  mount();
  open();
  expect(screen.getByText("Archive 1")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  expect(fixture.refetch).toHaveBeenCalledOnce();
});

it("distinguishes initial loading from initial failure", () => {
  fixture.query.mockReturnValue({ data: undefined, error: null });
  mount();
  open();
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByText("Archive 1")).toBeNull();
  cleanup();
  fixture.query.mockReturnValue({
    data: undefined,
    error: new Error("Read failed"),
    refetch: fixture.refetch,
  });
  mount();
  open();
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Login" })).toBeNull();
});

it("does not mount private details for a read-only observer", () => {
  mount(
    <ReadOnlyProvider value>
      <UserDetails row={row} />
    </ReadOnlyProvider>,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(fixture.query).not.toHaveBeenCalled();
});

it("keeps summary Tutor suppression and distinct badge families without lifecycle assumptions", () => {
  mount(<MembershipBadges membership={membership} />);
  expect(screen.queryByText("Tutee")).toBeNull();
  expect(screen.getByText("Admin").className).toContain("indigo");
  expect(screen.getByText("Tutor").className).toContain("teal");
  expect(screen.getByText("Translator").className).toContain("amber");
  cleanup();
  mount(
    <MembershipBadges
      membership={{
        ...membership,
        rank: "NONE",
        tutor: false,
        tutee: false,
        translator: false,
        crew: false,
        viewer: true,
      }}
    />,
  );
  expect(screen.getByText("Viewer").className).toContain("slate");
});

it.each(["registered", "setup", "invited", "none"])(
  "translates %s independently of suspension",
  (account) => {
    mount(<LoginSetup account={account} suspended />, "zh");
    expect(
      screen.getByText(
        zh.usersDirectory.setup[
          account as keyof typeof zh.usersDirectory.setup
        ],
      ),
    ).toBeTruthy();
    expect(screen.getByText(zh.admin.users.suspended)).toBeTruthy();
  },
);
