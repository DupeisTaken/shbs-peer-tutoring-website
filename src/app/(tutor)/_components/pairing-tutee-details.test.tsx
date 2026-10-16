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
import type { ComponentProps } from "react";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import { PairingTuteeDetails } from "./pairing-tutee-details";

const state = vi.hoisted(() => ({
  request: vi.fn(),
  recall: vi.fn(),
  reject: vi.fn(),
  prepare: vi.fn(),
  cancelTicket: vi.fn(),
  retry: vi.fn(),
  relayPending: false,
  schedulePending: false,
  error: "",
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: { myTuteeRemovalRequests: { invalidate: vi.fn() } },
      studentWorkflow: { tutorRoster: { invalidate: vi.fn() } },
    }),
    tutor: {
      requestTuteeRemoval: {
        useMutation: () => ({
          mutate: state.request,
          isPending: state.relayPending,
          error: state.error ? new Error(state.error) : null,
        }),
      },
      recallTuteeRemoval: {
        useMutation: () => ({ mutate: state.recall, isPending: false }),
      },
    },
    studentWorkflow: {
      rejectSchedule: {
        useMutation: () => ({
          mutate: state.reject,
          mutateAsync: state.reject,
          isPending: state.schedulePending,
        }),
      },
      prepareAction: {
        useMutation: () => ({
          mutateAsync: state.prepare,
          reset: vi.fn(),
        }),
      },
      cancelAction: {
        useMutation: () => ({ mutate: state.cancelTicket }),
      },
    },
  },
}));
const props: ComponentProps<typeof PairingTuteeDetails> = {
  pairingId: "pairing",
  tuteeId: "tutee",
  name: "Learner One",
  subject: "Maths",
  active: true,
  ready: true,
  failed: false,
  onRetry: state.retry,
  row: {
    pairingId: "pairing",
    tuteeId: "tutee",
    managed: false,
    verified: false,
    editedAt: new Date("2026-10-01T00:00:00Z"),
    verificationDueAt: new Date("2026-10-09T00:00:00Z"),
    pending: false,
    slots: [
      {
        id: "slot",
        label: "Sunday",
        dayOfWeek: 7,
        startMin: 900,
        endMin: 960,
        active: true,
        createdAt: new Date(0),
      },
    ],
  },
};
const element = (
  overrides: Partial<typeof props> = {},
  locale = "en",
  second = false,
) => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={locale === "zh" ? zh : en}
  >
    <PairingTuteeDetails {...props} {...overrides} />
    {second && (
      <PairingTuteeDetails
        {...props}
        name="Learner Two"
        tuteeId="second"
        row={props.row ? { ...props.row, tuteeId: "second" } : undefined}
      />
    )}
  </NextIntlClientProvider>
);
const open = (name = "Learner One", details = en.tablePatterns.details) => {
  const trigger = screen.getByRole("button", { name: `${details}: ${name}` });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

it.each(["read failure", "inactive", "pending review"] as const)(
  "rechecks an open schedule confirmation after %s and retains its reason through recovery",
  async (transition) => {
    const view = render(element());
    open();
    fireEvent.click(
      screen.getByRole("button", { name: en.workflow.scheduleReject }),
    );
    await act(async () => undefined);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Retained conflict reason" },
    });
    const changed =
      transition === "read failure"
        ? { failed: true }
        : transition === "inactive"
          ? { active: false }
          : { row: props.row ? { ...props.row, pending: true } : undefined };
    view.rerender(element(changed));
    const confirm = screen.getByRole<HTMLButtonElement>("button", {
      name: en.workflow.confirm,
    });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(state.reject).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Retained conflict reason",
    );
    view.rerender(element());
    fireEvent.click(screen.getByRole("button", { name: en.workflow.confirm }));
    expect(state.reject).toHaveBeenCalledExactlyOnceWith({
      pairingId: "pairing",
      tuteeId: "tutee",
      reason: "Retained conflict reason",
      ticket: "server-ticket",
    });
  },
);

it.each(["read failure", "inactive", "managed"] as const)(
  "does not submit a legacy relay when %s arrives during awaited confirmation",
  async (transition) => {
    const view = render(element());
    open();
    fireEvent.click(
      screen.getByRole("button", { name: en.tutor.pairings.requestRemoval }),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Retained relay reason" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: en.tutor.pairings.removalSubmit }),
    );
    const changed =
      transition === "read failure"
        ? { failed: true }
        : transition === "inactive"
          ? { active: false }
          : { row: props.row ? { ...props.row, managed: true } : undefined };
    view.rerender(element(changed));
    const confirmation = screen.getByRole("dialog", {
      name: en.tutor.pairings.requestRemoval,
    });
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: en.tutor.pairings.removalSubmit,
      }),
    );
    await waitFor(() => expect(confirmation.isConnected).toBe(false));
    expect(state.request).not.toHaveBeenCalled();
    view.rerender(element());
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Retained relay reason",
    );
  },
);

it("does not recall a stale relay after a failed read during confirmation", async () => {
  const pendingRequest = {
    id: "pending-relay",
    pairingId: "pairing",
    tuteeId: "tutee",
    reason: null,
    createdAt: new Date(0),
    eligibleAt: null,
  };
  const view = render(element({ active: false, pendingRequest }));
  open();
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.pairings.removalRecall }),
  );
  view.rerender(element({ active: false, pendingRequest, failed: true }));
  const confirmation = screen.getByRole("dialog", {
    name: en.tutor.pairings.removalRecall,
  });
  fireEvent.click(
    within(confirmation).getByRole("button", {
      name: en.tutor.pairings.removalRecall,
    }),
  );
  await waitFor(() => expect(confirmation.isConnected).toBe(false));
  expect(state.recall).not.toHaveBeenCalled();
  view.rerender(element({ active: false, pendingRequest }));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.tutor.pairings.removalRecall,
    }).disabled,
  ).toBe(false);
});
beforeEach(() => {
  state.prepare.mockResolvedValue({
    id: "server-ticket",
    readyAt: new Date(0),
    serverNow: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.relayPending = false;
  state.schedulePending = false;
  state.error = "";
});

it.each([
  { locale: "en", catalog: en, day: "Sun" },
  { locale: "zh", catalog: zh, day: "周日" },
])(
  "keeps $locale availability and review evidence behind Details without preparing a ticket",
  ({ locale, catalog, day }) => {
    render(element({}, locale));
    expect(screen.queryByText(/15:00/)).toBeNull();
    expect(screen.queryByText(catalog.workflow.unverified)).toBeNull();
    open("Learner One", catalog.tablePatterns.details);
    expect(
      screen.getByRole("dialog", { name: "Learner One · Maths" }),
    ).toBeTruthy();
    expect(
      screen.getByText(`${catalog.workflow.availability}: ${day} 15:00–16:00`),
    ).toBeTruthy();
    expect(screen.getByText(catalog.workflow.unverified)).toBeTruthy();
    expect(screen.getByText(catalog.workflow.edited)).toBeTruthy();
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
  },
);

it("retains separate relay and schedule drafts across Close, nested Cancel and other tutees", async () => {
  render(element({}, "en", true));
  const trigger = open();
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.pairings.requestRemoval }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Relay draft" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.scheduleReject }),
  );
  await act(async () => undefined);
  const review = screen.getByRole("dialog", {
    name: /schedule conflict.*Learner One/,
  });
  fireEvent.change(within(review).getByRole("textbox"), {
    target: { value: "Conflict draft" },
  });
  fireEvent.click(
    within(review).getByRole("button", { name: en.workflow.cancel }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.close }),
  );
  expect(document.activeElement).toBe(trigger);
  open("Learner Two");
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.pairings.requestRemoval }),
  );
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.close }),
  );
  open();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Relay draft",
  );
  const scheduleTrigger = screen.getByRole("button", {
    name: en.workflow.scheduleReject,
  });
  scheduleTrigger.focus();
  fireEvent.click(scheduleTrigger);
  await act(async () => undefined);
  const resumed = screen.getByRole("dialog", {
    name: /schedule conflict.*Learner One/,
  });
  expect(within(resumed).getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Conflict draft",
  );
  fireEvent(resumed, new Event("cancel", { cancelable: true }));
  expect(
    screen.getByRole("dialog", { name: "Learner One · Maths" }),
  ).toBeTruthy();
  expect(document.activeElement).toBe(scheduleTrigger);
  expect(state.request).not.toHaveBeenCalled();
  expect(state.reject).not.toHaveBeenCalled();
});

it("preserves the nested schedule ticket payload and blocks parent dismissal/sibling writes only while pending", async () => {
  const view = render(element());
  open();
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.scheduleReject }),
  );
  await act(async () => undefined);
  expect(state.prepare).toHaveBeenCalledExactlyOnceWith({
    action: "SCHEDULE",
    target: "pairing:tutee",
  });
  const review = screen.getByRole("dialog", {
    name: /schedule conflict.*Learner One/,
  });
  fireEvent.change(within(review).getByRole("textbox"), {
    target: { value: "Existing schedule reason" },
  });
  fireEvent.click(
    within(review).getByRole("button", { name: en.workflow.confirm }),
  );
  expect(state.reject).toHaveBeenCalledExactlyOnceWith({
    pairingId: "pairing",
    tuteeId: "tutee",
    reason: "Existing schedule reason",
    ticket: "server-ticket",
  });
  state.schedulePending = true;
  view.rerender(element());
  const parent = screen.getByRole("dialog", { name: "Learner One · Maths" });
  expect(
    within(parent).getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(true);
  expect(
    within(parent).getByRole<HTMLButtonElement>("button", {
      name: en.tutor.pairings.requestRemoval,
    }).disabled,
  ).toBe(true);
  fireEvent(parent, new Event("cancel", { cancelable: true }));
  expect(parent.isConnected).toBe(true);
  state.schedulePending = false;
  view.rerender(element());
  expect(
    within(parent).getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(false);
});

it("confirms the unchanged legacy relay payload and retains a failed draft", async () => {
  const view = render(element());
  open();
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.pairings.requestRemoval }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "  Relay reason  " },
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.pairings.removalSubmit }),
  );
  const confirm = screen.getByRole("dialog", {
    name: en.tutor.pairings.requestRemoval,
  });
  fireEvent.click(
    within(confirm).getByRole("button", {
      name: en.tutor.pairings.removalSubmit,
    }),
  );
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledExactlyOnceWith({
      pairingId: "pairing",
      tuteeId: "tutee",
      reason: "Relay reason",
    }),
  );
  state.error = "Synthetic failure";
  state.relayPending = true;
  view.rerender(element());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "  Relay reason  ",
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.accountProfile.close,
    }).disabled,
  ).toBe(true);
  state.relayPending = false;
  view.rerender(element());
  expect(screen.getByRole("alert").textContent).toBe("Synthetic failure");
  fireEvent.click(
    screen.getByRole("button", { name: en.accountProfile.close }),
  );
  open();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "  Relay reason  ",
  );
});

it("shows missing availability honestly, keeps managed routing and preserves pending-review restrictions", () => {
  render(
    element({
      row: props.row
        ? { ...props.row, managed: true, slots: [], pending: true }
        : undefined,
    }),
  );
  open();
  expect(screen.getByText(en.tutor.pairings.availabilityMissing)).toBeTruthy();
  expect(screen.getByText(en.workflow.needsReview)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: en.workflow.scheduleReject }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.tutor.pairings.requestRemoval }),
  ).toBeNull();
});

it("retains cached evidence beside read recovery but offers no new write during failure", () => {
  render(element({ failed: true }));
  open();
  expect(screen.getByText(/Sun 15:00/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en.tutor.tasks.retry }));
  expect(state.retry).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: en.workflow.scheduleReject }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.tutor.pairings.requestRemoval }),
  ).toBeNull();
});

it("lets inactive tutors recall an existing relay without opening any new request path", async () => {
  render(
    element({
      active: false,
      pendingRequest: {
        id: "pending-relay",
        pairingId: "pairing",
        tuteeId: "tutee",
        reason: "Original reason",
        createdAt: new Date(0),
        eligibleAt: null,
      },
    }),
  );
  open();
  expect(screen.getByText(en.tutor.pairings.removalPending)).toBeTruthy();
  expect(screen.queryByText(/^Recall window ends:/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.tutor.pairings.requestRemoval }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.workflow.scheduleReject }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.pairings.removalRecall }),
  );
  const confirmation = screen.getByRole("dialog", {
    name: en.tutor.pairings.removalRecall,
  });
  fireEvent.click(
    within(confirmation).getByRole("button", {
      name: en.tutor.pairings.removalRecall,
    }),
  );
  await waitFor(() =>
    expect(state.recall).toHaveBeenCalledExactlyOnceWith({
      requestId: "pending-relay",
    }),
  );
  expect(state.request).not.toHaveBeenCalled();
});
