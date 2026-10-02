/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { academicSummary } from "~/lib/academics";
import type { RouterOutputs } from "~/trpc/react";
import { TuteeHistoryDialog, TuteeHistoryLinkForm } from "./tutee-history";
import { Modal } from "./ui/modal";
import { HistoryClaim } from "../history/claim/history-claim";
const mock = vi.hoisted(() => ({
  preview: vi.fn(),
  link: vi.fn(),
  invite: vi.fn(),
  claim: vi.fn(),
  cancel: vi.fn(),
  details: null as RouterOutputs["tuteeHistory"]["myDetails"] | null,
  invitation: null as null | {
    email: string;
    expiresAt: Date;
    revision: string;
  },
  success: undefined as undefined | (() => Promise<void>),
  invalidate: vi.fn(async () => undefined),
  pending: false,
  staffDetails:
    vi.fn<(input: unknown, options: unknown) => { data: unknown }>(),
  ownDetails: vi.fn<(input: unknown, options: unknown) => { data: unknown }>(),
}));
vi.mock("./profile-dialog", () => ({
  ProfileDialog: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        tutees: { invalidate: mock.invalidate },
        tuteeStats: { invalidate: mock.invalidate },
        pairings: { invalidate: mock.invalidate },
        accounts: { invalidate: mock.invalidate },
      },
      student: { invalidate: mock.invalidate },
      tuteeHistory: {
        invalidate: mock.invalidate,
        preview: { fetch: mock.preview },
      },
    }),
    tuteeHistory: {
      details: {
        useQuery: (input: unknown, options: unknown) =>
          mock.staffDetails(input, options),
      },
      myDetails: {
        useQuery: (input: unknown, options: unknown) =>
          mock.ownDetails(input, options),
      },
      invitationStatus: {
        useQuery: () => ({ data: mock.invitation, refetch: mock.invalidate }),
      },
      cancelInvitation: { useMutation: () => ({ mutate: mock.cancel }) },
      candidates: {
        useQuery: () => ({
          data: [
            {
              id: "account",
              name: "Alex Verified",
              email: "alex@example.test",
            },
          ],
        }),
      },
      link: {
        useMutation: (options: { onSuccess: () => Promise<void> }) => {
          mock.success = options.onSuccess;
          return { mutate: mock.link, isPending: mock.pending };
        },
      },
      invite: { useMutation: () => ({ mutate: mock.invite }) },
      inspectClaim: {
        useQuery: () => ({ data: { name: "Alex Historical", sessions: 6 } }),
      },
      claim: { useMutation: () => ({ mutate: mock.claim }) },
    },
  },
}));
const row = {
  id: "record",
  englishName: "Alex Historical",
  updatedAt: new Date("2024-10-01"),
  user: null,
  owner: null,
} as unknown as RouterOutputs["admin"]["tutees"][number];
const mount = (head = false) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TuteeHistoryLinkForm
        row={row}
        isHead={head}
        onLinked={() => undefined}
      />
    </NextIntlClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mock.pending = false;
  const details = {
    data: {
      record: {
        id: "record",
        name: "Alex Historical",
        gradeLevel: "Grade 9",
        academicallyGraduated: false,
      },
      term: { name: "2024 Autumn" },
      owner: null,
      count: 1,
      sessions: [
        {
          status: "PRESENT",
          session: {
            id: "session",
            date: new Date("2024-10-01"),
            schoolYear: "24-25",
            quarter: "Q1",
            pairing: { subject: "Mathematics" },
            tutor: { englishName: "Taylor Tutor" },
          },
        },
      ],
    },
  };
  mock.details = null;
  mock.staffDetails.mockImplementation(() =>
    mock.details ? { data: mock.details } : details,
  );
  mock.ownDetails.mockImplementation(() =>
    mock.details ? { data: mock.details } : details,
  );
  mock.invitation = null;
  mock.preview.mockResolvedValue({
    fingerprint: "a".repeat(64),
    record: { name: "Alex Historical", sessions: 6 },
    account: { name: "Alex Verified", email: "alex@example.test" },
    conflict: false,
    currentConflict: false,
  });
});

it("shows invitation delivery metadata and cancels the exact displayed grant without losing the identity draft", () => {
  mock.invitation = {
    email: "alumni@example.test",
    expiresAt: new Date("2026-10-09T00:00:00Z"),
    revision: "b".repeat(64),
  };
  mount();
  const evidence = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: en.tuteeHistory.evidence,
  });
  fireEvent.change(evidence, {
    target: { value: "Reviewed identity evidence stays in this draft" },
  });
  expect(screen.getByText(/alumni@example.test/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.cancelInvitation }),
  );
  expect(mock.cancel).toHaveBeenCalledWith({
    tuteeId: "record",
    revision: "b".repeat(64),
  });
  expect(evidence.value).toBe("Reviewed identity evidence stays in this draft");
  expect(mock.invite).not.toHaveBeenCalled();
});
afterEach(cleanup);

it.each([false, true])(
  "provides a named keyboard-scrollable read-only history region (personal=%s)",
  (personal) => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={en}
        timeZone="Asia/Shanghai"
      >
        <TuteeHistoryDialog
          tuteeId="record"
          personal={personal}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    const region = screen.getByRole("region", {
      name: en.tuteeHistory.details,
    });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.textContent).toContain("Mathematics");
    expect(region.textContent).toContain("24-25");
    expect(screen.getByText(en.tuteeHistory.scrollHint)).toBeTruthy();
    expect(mock.staffDetails).toHaveBeenCalledWith(
      { tuteeId: "record", page: 0 },
      { enabled: !personal },
    );
    expect(mock.ownDetails).toHaveBeenCalledWith(
      { tuteeId: "record", page: 0 },
      { enabled: personal },
    );
  },
);

it("registers historical writes with the parent dialog and locks the whole historical form", () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  const close = vi.fn();
  const contents = () => (
    <NextIntlClientProvider locale="en" messages={en}>
      <Modal title="Profile" onClose={close} footer={null}>
        <TuteeHistoryLinkForm row={row} isHead={false} onLinked={vi.fn()} />
      </Modal>
    </NextIntlClientProvider>
  );
  const view = render(contents());
  const evidence = screen.getByRole("textbox", {
    name: en.tuteeHistory.evidence,
  });
  fireEvent.change(evidence, {
    target: { value: "Verified archive evidence" },
  });
  mock.pending = true;
  view.rerender(contents());
  expect(
    screen.getByRole("dialog", { name: "Profile" }).getAttribute("aria-busy"),
  ).toBe("true");
  expect(evidence.closest("fieldset")?.disabled).toBe(true);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(close).not.toHaveBeenCalled();
  for (const form of document.querySelectorAll("form")) fireEvent.submit(form);
  expect(mock.invite).not.toHaveBeenCalled();
  mock.pending = false;
  view.rerender(contents());
  expect(evidence.closest("fieldset")?.disabled).toBe(false);
  expect((evidence as HTMLTextAreaElement).value).toBe(
    "Verified archive evidence",
  );
});
it.each(["en", "zh"])(
  "does not imply current-grade confirmation is required for personal history (%s)",
  (locale) => {
    const messages = locale === "zh" ? zh : en;
    mock.details = {
      record: {
        id: "past",
        name: "Alex",
        gradeLevel: "9",
        academicallyGraduated: false,
        updatedAt: new Date(),
        alternativeNames: null,
      },
      owner: {
        id: "owner",
        name: "Alex",
        username: null,
        emailVerified: true,
        academic: academicSummary(null),
      },
      term: null,
      count: 0,
      sessions: [],
      page: 0,
    };
    const content = (personal: boolean) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <TuteeHistoryDialog
          tuteeId="past"
          personal={personal}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    const view = render(content(true));
    expect(
      screen.getByText(messages.tuteeHistory.currentAcademicsOptional),
    ).toBeTruthy();
    expect(screen.queryByText(messages.academics.needsConfirmation)).toBeNull();
    // Staff still sees the unresolved profile; the personal-view copy changes no evidence.
    view.rerender(content(false));
    expect(screen.getByText(messages.academics.needsConfirmation)).toBeTruthy();
    expect(mock.details.owner?.academic.needsConfirmation).toBe(true);
  },
);
async function review() {
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "account" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review Link" }));
  await screen.findByRole("checkbox", {
    name: en.tuteeHistory.confirmIdentity,
  });
}
it("requires a concrete preview, identity acknowledgement and staff evidence, then discards preview on reselection", async () => {
  mount();
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  await review();
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Confirm Link",
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.tuteeHistory.confirmIdentity }),
  );
  expect(button.disabled).toBe(true);
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.evidence }),
    { target: { value: "Checked school archive and verified participant" } },
  );
  fireEvent.click(button);
  expect(mock.link).toHaveBeenCalledWith({
    tuteeId: "record",
    userId: "account",
    fingerprint: "a".repeat(64),
    reason: "Checked school archive and verified participant",
  });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
});
it("blocks an Admin from resolving a retained-owner conflict", async () => {
  mock.preview.mockResolvedValue({
    fingerprint: "a".repeat(64),
    record: { name: "Alex Historical", sessions: 6 },
    account: { name: "Alex Verified" },
    conflict: true,
    currentConflict: false,
  });
  mount();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "account" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review Link" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      en.tuteeHistory.HISTORY_HEAD_REQUIRED,
    ),
  );
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  expect(mock.link).not.toHaveBeenCalled();
});
it("does not claim a historical record on page load or before explicit confirmation", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <HistoryClaim token={"a".repeat(64)} />
    </NextIntlClientProvider>,
  );
  expect(mock.claim).not.toHaveBeenCalled();
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Link My History",
  });
  expect(button.disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.tuteeHistory.claimConfirm }),
  );
  fireEvent.click(button);
  expect(mock.claim).toHaveBeenCalledWith({ token: "a".repeat(64) });
});
it("provides the Head password action for a retained-owner correction", async () => {
  mock.preview.mockResolvedValue({
    fingerprint: "a".repeat(64),
    record: { name: "Alex Historical", sessions: 6 },
    account: { name: "Alex Verified" },
    conflict: true,
    currentConflict: false,
  });
  mount(true);
  await review();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.evidence }),
    {
      target: {
        value: "Verified correction against the original school archive",
      },
    },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.tuteeHistory.confirmIdentity }),
  );
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "Confirm Link",
  });
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(en.tuteeHistory.password), {
    target: { value: "Synthetic-password!" },
  });
  fireEvent.click(button);
  expect(mock.link).toHaveBeenCalledWith(
    expect.objectContaining({
      confirmPassword: "Synthetic-password!",
      userId: "account",
    }),
  );
});
it("sends an exact-record invitation from the website with staff evidence", () => {
  mount();
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.evidence }),
    {
      target: {
        value: "Verified identity and email against the school archive",
      },
    },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: en.tuteeHistory.email }),
    { target: { value: "new@example.test" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.tuteeHistory.sendInvitation }),
  );
  expect(mock.invite).toHaveBeenCalledWith({
    tuteeId: "record",
    email: "new@example.test",
    expectedUpdatedAt: row.updatedAt,
    reason: "Verified identity and email against the school archive",
  });
});

it("clears a completed ownership preview and refreshes dependent views while remaining mounted", async () => {
  mount();
  await review();
  expect(screen.getByRole("button", { name: "Confirm Link" })).toBeTruthy();
  await act(async () => {
    await mock.success!();
  });
  expect(mock.invalidate).toHaveBeenCalledTimes(6);
  expect(screen.queryByRole("button", { name: "Confirm Link" })).toBeNull();
  expect(screen.getByRole("button", { name: "Review Link" })).toBeTruthy();
});
