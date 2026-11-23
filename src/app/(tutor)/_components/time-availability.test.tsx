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
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { TimeAvailability } from "./time-availability";

const state = vi.hoisted(() => ({
  client: null as QueryClient | null,
  availabilityRead: vi.fn(),
  availabilitySave: vi.fn(),
  workloadRead: vi.fn(),
  workloadSave: vi.fn(),
}));

vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["preference"] }));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useMutation } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => ({
        tutor: {
          workloadPreference: {
            fetch: () =>
              state.client!.fetchQuery({
                queryKey: ["preference"],
                queryFn: state.workloadRead,
                staleTime: 0,
              }),
          },
        },
      }),
      tutor: {
        myAvailability: {
          useQuery: () =>
            useQuery({
              queryKey: ["availability"],
              queryFn: state.availabilityRead,
            }),
        },
        setAvailability: {
          useMutation: (options: object) =>
            useMutation({ mutationFn: state.availabilitySave, ...options }),
        },
        workloadPreference: {
          useQuery: (_input: unknown, options: object) =>
            useQuery({
              queryKey: ["preference"],
              queryFn: state.workloadRead,
              ...options,
            }),
        },
        setWorkloadPreference: {
          useMutation: (options: object) =>
            useMutation({ mutationFn: state.workloadSave, ...options }),
        },
      },
    },
  };
});

const workloadSnapshot = (changes: object = {}) => ({
  id: "tutor",
  status: "ACTIVE",
  count: 1,
  blocks: [],
  preferredMaximum: 2,
  version: 0,
  canEdit: true,
  ...changes,
});

const defer = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  state.availabilityRead.mockReset().mockResolvedValue({
    slots: [
      {
        id: "early",
        label: "Early",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    ],
    selectedSlotIds: [],
  });
  state.availabilitySave.mockReset().mockResolvedValue({ ok: true });
  state.workloadRead.mockReset().mockResolvedValue(workloadSnapshot());
  state.workloadSave.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  state.client?.clear();
});

function mount(
  locale: "en" | "zh" = "en",
  active = true,
  wrapInParent = false,
) {
  state.client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const body = <TimeAvailability active={active} />;
  return render(
    <QueryClientProvider client={state.client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
        timeZone="Asia/Shanghai"
      >
        {wrapInParent ? (
          <ProfileDialog title="Parent" onClose={vi.fn()}>
            {body}
          </ProfileDialog>
        ) : (
          body
        )}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

it.each(["en", "zh"] as const)(
  "loads only on open in %s, retains drafts across close/reopen, and restores focus to the trigger",
  async (locale) => {
    const labels = locale === "en" ? en : zh;
    mount(locale);
    expect(state.availabilityRead).not.toHaveBeenCalled();
    expect(state.workloadRead).not.toHaveBeenCalled();

    const opener = screen.getByRole("button", {
      name: labels.dashboard.availability.edit,
    });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", {
      name: labels.dashboard.availability.title,
    });
    const early = await within(dialog).findByRole<HTMLButtonElement>("button", {
      name: /Early/,
    });
    const prefFour = await within(dialog).findByRole<HTMLButtonElement>(
      "button",
      { name: "4" },
    );

    fireEvent.click(early);
    fireEvent.click(prefFour);
    expect(early.getAttribute("aria-pressed")).toBe("true");
    expect(prefFour.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: labels.accountProfile.close,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /Early/ })).toBeNull();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    const reopened = screen.getByRole("dialog", {
      name: labels.dashboard.availability.title,
    });
    expect(
      within(reopened)
        .getByRole("button", { name: /Early/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(reopened)
        .getByRole("button", { name: "4" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent(
      reopened,
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  },
);

it("blocks dialog dismissal during either form's pending write while keeping the sibling form editable", async () => {
  mount("en");
  fireEvent.click(
    screen.getByRole("button", { name: en.dashboard.availability.edit }),
  );
  const dialog = screen.getByRole("dialog", {
    name: en.dashboard.availability.title,
  });
  const early = await within(dialog).findByRole<HTMLButtonElement>("button", {
    name: /Early/,
  });
  const prefFour = await within(dialog).findByRole<HTMLButtonElement>(
    "button",
    { name: "4" },
  );
  const close = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: en.accountProfile.close,
  });

  // Pending availability save blocks Close/Escape, but workload preference stays usable.
  const pendingAvailability = defer<{ ok: boolean }>();
  state.availabilitySave.mockReturnValueOnce(pendingAvailability.promise);
  fireEvent.click(early);
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.tutor.availability.save }),
  );
  await waitFor(() => expect(close.disabled).toBe(true));
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(prefFour.disabled).toBe(false);
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);

  // Start a sibling workload save while availability is still pending.
  const pendingWorkload = defer<{ ok: boolean }>();
  state.workloadSave.mockReturnValueOnce(pendingWorkload.promise);
  fireEvent.click(prefFour);
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.tutorWorkload.save }),
  );
  await waitFor(() => expect(state.workloadSave).toHaveBeenCalledTimes(1));

  // Resolving only availability keeps dialog busy until workload settles too.
  state.availabilityRead.mockResolvedValue({
    slots: [
      { id: "early", label: "Early", dayOfWeek: 1, startMin: 900, endMin: 960 },
    ],
    selectedSlotIds: ["early"],
  });
  await act(async () => pendingAvailability.resolve({ ok: true }));
  expect(close.disabled).toBe(true);
  expect(dialog.getAttribute("aria-busy")).toBe("true");

  state.workloadRead.mockResolvedValue(
    workloadSnapshot({ preferredMaximum: 4, version: 1 }),
  );
  await act(async () => pendingWorkload.resolve({ ok: true }));
  await waitFor(() => expect(close.disabled).toBe(false));
  expect(dialog.getAttribute("aria-busy")).toBe("false");
});

it("allows idle Close after a saved-but-refresh-failed availability write and keeps recovery on reopen", async () => {
  mount("en");
  const opener = screen.getByRole("button", {
    name: en.dashboard.availability.edit,
  });
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", {
    name: en.dashboard.availability.title,
  });
  const early = await within(dialog).findByRole<HTMLButtonElement>("button", {
    name: /Early/,
  });
  fireEvent.click(early);
  state.availabilityRead.mockRejectedValueOnce(new Error("Refresh failed"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.tutor.availability.save }),
  );
  await within(dialog).findByText(en.tutor.availability.refreshFailed);

  const close = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: en.accountProfile.close,
  });
  expect(close.disabled).toBe(false);
  fireEvent.click(close);
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(opener);
  const reopened = screen.getByRole("dialog", {
    name: en.dashboard.availability.title,
  });
  expect(
    within(reopened).getByText(en.tutor.availability.refreshFailed),
  ).toBeTruthy();
  expect(
    within(reopened).getByRole<HTMLButtonElement>("button", { name: /Early/ })
      .disabled,
  ).toBe(true);
  expect(state.availabilitySave).toHaveBeenCalledTimes(1);
});

it("renders read-only workload summary without an edit button for inactive tutors", async () => {
  state.workloadRead.mockResolvedValue(
    workloadSnapshot({ status: "OPTED_OUT", canEdit: false }),
  );
  mount("en", false);
  expect(
    screen.queryByRole("button", { name: en.dashboard.availability.edit }),
  ).toBeNull();
  await screen.findByText(en.tutorWorkload.inactive);
  expect(state.availabilityRead).not.toHaveBeenCalled();
});

it("propagates busy state to a parent dialog without latching either dialog", async () => {
  mount("en", true, true);
  const parent = screen.getByRole("dialog", { name: "Parent" });
  fireEvent.click(
    within(parent).getByRole("button", {
      name: en.dashboard.availability.edit,
    }),
  );
  const child = screen.getByRole("dialog", {
    name: en.dashboard.availability.title,
  });
  const early = await within(child).findByRole("button", { name: /Early/ });
  const pending = defer<{ ok: boolean }>();
  state.availabilitySave.mockReturnValueOnce(pending.promise);
  fireEvent.click(early);
  fireEvent.click(
    within(child).getByRole("button", { name: en.tutor.availability.save }),
  );
  await waitFor(() => expect(parent.getAttribute("aria-busy")).toBe("true"));
  expect(child.getAttribute("aria-busy")).toBe("true");
  await act(async () => pending.resolve({ ok: true }));
  await waitFor(() => expect(parent.getAttribute("aria-busy")).toBe("false"));
  expect(child.getAttribute("aria-busy")).toBe("false");
  fireEvent.click(
    within(child).getByRole("button", { name: en.accountProfile.close }),
  );
  expect(
    screen.queryByRole("dialog", { name: en.dashboard.availability.title }),
  ).toBeNull();
});
