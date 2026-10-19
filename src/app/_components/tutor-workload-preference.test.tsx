/** @vitest-environment jsdom */
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
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { TutorWorkloadPreference } from "./tutor-workload-preference";
import { AvailabilityEditor } from "../(tutor)/_components/availability-editor";
import { DisclosureSection } from "./ui/disclosure-section";

const state = vi.hoisted(() => ({
  client: null as QueryClient | null,
  read: vi.fn(),
  availabilityRead: vi.fn(),
  availabilitySave: vi.fn(),
  save: vi.fn<
    (input: {
      preferredMaximum: number | null;
      expectedVersion: number;
    }) => Promise<{ ok: boolean }>
  >(),
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
                queryFn: state.read,
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
              queryFn: state.read,
              ...options,
            }),
        },
        setWorkloadPreference: {
          useMutation: (options: object) =>
            useMutation({ mutationFn: state.save, ...options }),
        },
      },
    },
  };
});
const snapshot = (changes: object = {}) => ({
  id: "tutor",
  status: "ACTIVE",
  count: 2,
  blocks: [],
  preferredMaximum: 2,
  version: 0,
  canEdit: true,
  ...changes,
});
beforeEach(() => {
  state.read.mockReset().mockResolvedValue(snapshot());
  state.save.mockReset().mockResolvedValue({ ok: true });
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
});
afterEach(() => {
  cleanup();
  state.client?.clear();
});
const mount = (locale: "en" | "zh" = "en", integrated = false) => {
  state.client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={state.client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : zh}
      >
        <input
          aria-label="Independent profile draft"
          defaultValue="Retained name"
        />
        {integrated ? (
          <DisclosureSection
            title="Edit My Time Availability"
            lifetime="retained"
          >
            <AvailabilityEditor />
            <TutorWorkloadPreference embedded />
          </DisclosureSection>
        ) : (
          <TutorWorkloadPreference />
        )}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
};
const choice = (value: number) =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: String(value),
  });
const selectedValue = () =>
  screen
    .queryAllByRole("button", { pressed: true })
    .find((button) => /^[0-4]$/.test(button.textContent ?? ""))?.textContent ??
  "";
const choose = async (value: string) => {
  await screen.findByRole("group", { name: "Preferred session choices" });
  fireEvent.click(choice(Number(value)));
};
const defer = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

it.each(["en", "zh"] as const)(
  "uses accessible optional bounded preference choices in %s and keeps a sibling draft",
  async (locale) => {
    mount(locale);
    await screen.findByRole("group", {
      name: locale === "en" ? "Preferred session choices" : "期望辅导次数选择",
    });
    expect(
      [0, 1, 2, 3, 4].map((value) =>
        choice(value).getAttribute("aria-pressed"),
      ),
    ).toEqual(["false", "false", "true", "false", "false"]);
    expect(
      screen.getByText(locale === "en" ? "Optional" : "选填"),
    ).toBeTruthy();
    fireEvent.click(choice(0));
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Independent profile draft",
      }).value,
    ).toBe("Retained name");
  },
);
it("retains a failed-save draft and original version on retry, clearing only through an explicit save", async () => {
  state.save.mockRejectedValueOnce(new Error("Synthetic write failure"));
  mount();
  await choose("4");
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByText(/Could not save the preference/);
  expect(selectedValue()).toBe("4");
  state.read.mockResolvedValue(snapshot({ preferredMaximum: 4, version: 1 }));
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByText("Preference saved.");
  expect(state.save.mock.calls.map((call) => call[0])).toEqual([
    { preferredMaximum: 4, expectedVersion: 0 },
    { preferredMaximum: 4, expectedVersion: 0 },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Clear preference" }));
  expect(selectedValue()).toBe("");
  expect(state.save).toHaveBeenCalledTimes(2);
  state.read.mockResolvedValue(
    snapshot({ preferredMaximum: null, version: 2 }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await waitFor(() =>
    expect(state.save.mock.calls[2]?.[0]).toEqual({
      preferredMaximum: null,
      expectedVersion: 1,
    }),
  );
});
it("keeps dirty draft/version during background changes, shows current saved summary, and reloads only after a successful fresh read", async () => {
  mount();
  await choose("4");
  expect(selectedValue()).toBe("4");
  await act(async () => {
    state.client!.setQueryData(
      ["preference"],
      snapshot({ preferredMaximum: 1, count: 3, version: 1 }),
    );
  });
  expect(await screen.findByText(/Preferred sessions: 1/)).toBeTruthy();
  expect(selectedValue()).toBe("4");
  state.read.mockRejectedValueOnce(new Error("Synthetic reload failure"));
  fireEvent.click(
    screen.getByRole("button", { name: "Reload saved preference" }),
  );
  await screen.findByText(/Could not reload/);
  expect(selectedValue()).toBe("4");
  state.read.mockResolvedValue(
    snapshot({ preferredMaximum: 1, count: 3, version: 1 }),
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Retry refresh" }).at(-1)!,
  );
  await waitFor(() => expect(selectedValue()).toBe("1"));
  expect(state.save).not.toHaveBeenCalled();
});
it("never replays an accepted save when synchronization fails, then permits a new versioned save after recovery", async () => {
  mount();
  await choose("0");
  state.read.mockRejectedValueOnce(new Error("Synthetic read failure"));
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByText(/Preference saved, but synchronization failed/);
  expect(choice(0).disabled).toBe(true);
  expect(state.save).toHaveBeenCalledTimes(1);
  state.read.mockResolvedValue(snapshot({ preferredMaximum: 0, version: 1 }));
  fireEvent.click(
    screen.getAllByRole("button", { name: "Retry refresh" }).at(-1)!,
  );
  await waitFor(() => expect(choice(0).disabled).toBe(false));
  expect(state.save).toHaveBeenCalledTimes(1);
  await choose("1");
  state.read.mockResolvedValue(snapshot({ preferredMaximum: 1, version: 2 }));
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await waitFor(() =>
    expect(state.save.mock.calls[1]?.[0]).toEqual({
      preferredMaximum: 1,
      expectedVersion: 1,
    }),
  );
});
it("freezes only its form during a pending save and admits one same-turn submit", async () => {
  const held = defer<{ ok: boolean }>();
  state.save.mockReturnValue(held.promise);
  mount();
  await choose("3");
  const form = screen.getByRole("form", { name: "Preferred Sessions" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  expect(choice(0).disabled).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", {
      name: "Independent profile draft",
    }).disabled,
  ).toBe(false);
  state.read.mockResolvedValue(snapshot({ preferredMaximum: 3, version: 1 }));
  await act(async () => {
    held.resolve({ ok: true });
  });
});
it("blocks fresh read-only authority even with a dirty active snapshot and never restores an old draft after inactivity", async () => {
  mount();
  await choose("4");
  await act(async () => {
    state.client!.setQueryData(["preference"], snapshot({ canEdit: false }));
  });
  await waitFor(() => expect(choice(0).disabled).toBe(true));
  expect(screen.getByText(/read-only access/)).toBeTruthy();
  await act(async () => {
    state.client!.setQueryData(
      ["preference"],
      snapshot({
        status: "OPTED_OUT",
        canEdit: false,
        preferredMaximum: 0,
        version: 1,
        count: 0,
      }),
    );
  });
  await waitFor(() => expect(selectedValue()).toBe("0"));
  expect(choice(0).disabled).toBe(true);
  await act(async () => {
    state.client!.setQueryData(
      ["preference"],
      snapshot({ preferredMaximum: 0, version: 1 }),
    );
  });
  expect(selectedValue()).toBe("0");
  expect(state.save).not.toHaveBeenCalled();
});
it("conceals and evicts revoked preference reads without an automatic retry loop", async () => {
  mount();
  await choose("4");
  state.read.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await state.client!.invalidateQueries({ queryKey: ["preference"] });
  });
  await screen.findByText(
    "You no longer have access to this workload preference.",
  );
  expect(
    screen.queryByRole("group", { name: "Preferred session choices" }),
  ).toBeNull();
  expect(state.client!.getQueryData(["preference"])).toBeUndefined();
  const reads = state.read.mock.calls.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(state.read).toHaveBeenCalledTimes(reads);
});
it("treats a freshly denied write as revoked authority and restores only after an explicit successful read", async () => {
  mount();
  await choose("4");
  state.save.mockRejectedValue(
    Object.assign(new Error("Denied write"), { data: { code: "FORBIDDEN" } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByText(
    "You no longer have access to this workload preference.",
  );
  expect(
    screen.queryByRole("group", { name: "Preferred session choices" }),
  ).toBeNull();
  expect(state.client!.getQueryData(["preference"])).toBeUndefined();
  expect(state.save).toHaveBeenCalledTimes(1);
  state.read.mockResolvedValue(snapshot());
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  await screen.findByRole("group", { name: "Preferred session choices" });
  expect(selectedValue()).toBe("4");
  expect(state.save).toHaveBeenCalledTimes(1);
});
it.each([
  { status: "ACTIVE", canEdit: true, expectedDraft: "4" },
  { status: "ACTIVE", canEdit: false, expectedDraft: "4" },
  { status: "OPTED_OUT", canEdit: false, expectedDraft: "0" },
])(
  "recovers denied authority into $status/$canEdit without silently reviving or replacing an active draft",
  async ({ status, canEdit, expectedDraft }) => {
    mount();
    await choose("4");
    state.save.mockRejectedValueOnce(
      Object.assign(new Error("Denied write"), { data: { code: "FORBIDDEN" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
    await screen.findByText(
      "You no longer have access to this workload preference.",
    );
    state.read.mockResolvedValue(
      snapshot({ status, canEdit, preferredMaximum: 0, version: 1 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await screen.findByRole("group", { name: "Preferred session choices" });
    expect(selectedValue()).toBe(expectedDraft);
    expect(choice(0).disabled).toBe(!canEdit);
    expect(await screen.findByText(/Preferred sessions: 0/)).toBeTruthy();
    expect(state.save).toHaveBeenCalledTimes(1);
    if (status === "ACTIVE") {
      expect(
        await screen.findByText(
          /saved preference or participation state changed/,
        ),
      ).toBeTruthy();
      if (!canEdit) {
        // Fresh authority can also restore editing without replacing the draft
        // or silently adopting the server's newer preference version.
        await act(async () => {
          state.client!.setQueryData(
            ["preference"],
            snapshot({ preferredMaximum: 0, version: 1, canEdit: true }),
          );
        });
        await waitFor(() => expect(choice(0).disabled).toBe(false));
        expect(selectedValue()).toBe("4");
      }
      if (canEdit) {
        // A new read must not silently adopt version1; an explicit Reload does.
        state.save.mockRejectedValueOnce(
          Object.assign(new Error("Stale version"), {
            data: { code: "CONFLICT" },
          }),
        );
        fireEvent.click(
          screen.getByRole("button", { name: "Save preference" }),
        );
        await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
        expect(state.save.mock.calls.at(-1)?.[0]).toEqual({
          preferredMaximum: 4,
          expectedVersion: 0,
        });
        await screen.findByText(
          /saved preference or participation state changed/,
        );
        expect(selectedValue()).toBe("4");
        fireEvent.click(
          screen.getByRole("button", { name: "Reload saved preference" }),
        );
        await waitFor(() => expect(selectedValue()).toBe("0"));
        await choose("4");
        state.read.mockResolvedValue(
          snapshot({ preferredMaximum: 4, version: 2 }),
        );
        fireEvent.click(
          screen.getByRole("button", { name: "Save preference" }),
        );
        await waitFor(() => expect(state.save).toHaveBeenCalledTimes(3));
        expect(state.save.mock.calls.at(-1)?.[0]).toEqual({
          preferredMaximum: 4,
          expectedVersion: 1,
        });
      }
    } else
      expect(
        screen.queryByText(/saved preference or participation state changed/),
      ).toBeNull();
  },
);

it.each([1, null])(
  "hydrates saved %s without silently replacing an unset preference",
  async (preferredMaximum) => {
    state.read.mockResolvedValue(snapshot({ preferredMaximum }));
    mount();
    await screen.findByRole("group", { name: "Preferred session choices" });
    await waitFor(() =>
      expect(selectedValue()).toBe(preferredMaximum === null ? "" : "1"),
    );
    expect(state.save).not.toHaveBeenCalled();
    expect([0, 1, 2, 3, 4].map((value) => choice(value).textContent)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
  },
);

it("retains independent availability and preference drafts through collapse, saves, pending writes and preference reload", async () => {
  mount("en", true);
  const disclosure = screen
    .getByText("Edit My Time Availability")
    .closest("details")!;
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  const early = await screen.findByRole<HTMLButtonElement>("button", {
    name: /Early/,
  });
  fireEvent.click(early);
  await choose("4");
  disclosure.open = false;
  fireEvent(disclosure, new Event("toggle"));
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  expect(early.getAttribute("aria-pressed")).toBe("true");
  expect(selectedValue()).toBe("4");
  const pending = defer<{ ok: boolean }>();
  state.availabilitySave.mockReturnValueOnce(pending.promise);
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.availability.save }),
  );
  await waitFor(() => expect(state.availabilitySave).toHaveBeenCalledTimes(1));
  expect(choice(4).disabled).toBe(false);
  state.save.mockRejectedValueOnce(
    Object.assign(new Error("Conflict"), { data: { code: "CONFLICT" } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByText(/saved preference or participation state changed/);
  expect(early.getAttribute("aria-pressed")).toBe("true");
  state.read.mockResolvedValue(snapshot({ preferredMaximum: 1, version: 1 }));
  fireEvent.click(
    screen.getByRole("button", { name: "Reload saved preference" }),
  );
  await waitFor(() => expect(selectedValue()).toBe("1"));
  expect(early.getAttribute("aria-pressed")).toBe("true");
  state.availabilityRead.mockResolvedValue({
    slots: [
      { id: "early", label: "Early", dayOfWeek: 1, startMin: 900, endMin: 960 },
    ],
    selectedSlotIds: ["early"],
  });
  await act(async () => pending.resolve({ ok: true }));
  await screen.findByText(en.tutor.availability.saved);
  expect(selectedValue()).toBe("1");
  expect(state.save.mock.calls[0]?.[0]).toEqual({
    preferredMaximum: 4,
    expectedVersion: 0,
  });
  expect(state.availabilitySave.mock.calls[0]?.[0]).toEqual({
    slotIds: ["early"],
  });
});

it.each(["empty", "unavailable"])(
  "keeps the embedded preference usable with an %s catalog",
  async (catalog) => {
    if (catalog === "empty")
      state.availabilityRead.mockResolvedValue({
        slots: [],
        selectedSlotIds: [],
      });
    else
      state.availabilityRead.mockRejectedValue(
        new Error("Catalog unavailable"),
      );
    mount("en", true);
    const disclosure = screen
      .getByText("Edit My Time Availability")
      .closest("details")!;
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
    await choose("0");
    state.read.mockResolvedValue(snapshot({ preferredMaximum: 0, version: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
    await screen.findByText("Preference saved.");
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.save.mock.calls[0]?.[0]).toEqual({
      preferredMaximum: 0,
      expectedVersion: 0,
    });
    expect(state.availabilitySave).not.toHaveBeenCalled();
  },
);
