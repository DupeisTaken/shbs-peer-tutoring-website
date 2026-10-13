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

const state = vi.hoisted(() => ({
  client: null as QueryClient | null,
  read: vi.fn(),
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
});
afterEach(() => {
  cleanup();
  state.client?.clear();
});
const mount = (locale: "en" | "zh" = "en") => {
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
        <TutorWorkloadPreference />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
};
const select = () =>
  screen.getByRole<HTMLSelectElement>("combobox", {
    name: /Preferred maximum/,
  });
const choose = async (value: string) => {
  await screen.findByRole("combobox");
  fireEvent.change(select(), { target: { value } });
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
  "uses an optional bounded native preference control in %s and keeps a sibling draft",
  async (locale) => {
    mount(locale);
    const control = await screen.findByRole<HTMLSelectElement>("combobox");
    expect([...control.options].map((option) => option.value)).toEqual([
      "",
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(
      screen.getByText(locale === "en" ? "Optional" : "选填"),
    ).toBeTruthy();
    fireEvent.change(control, { target: { value: "0" } });
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
  expect(select().value).toBe("4");
  state.read.mockResolvedValue(snapshot({ preferredMaximum: 4, version: 1 }));
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByText("Preference saved.");
  expect(state.save.mock.calls.map((call) => call[0])).toEqual([
    { preferredMaximum: 4, expectedVersion: 0 },
    { preferredMaximum: 4, expectedVersion: 0 },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Clear preference" }));
  expect(select().value).toBe("");
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
  await act(async () => {
    state.client!.setQueryData(
      ["preference"],
      snapshot({ preferredMaximum: 1, count: 3, version: 1 }),
    );
  });
  expect(select().value).toBe("4");
  expect(await screen.findByText(/Preferred maximum: 1/)).toBeTruthy();
  state.read.mockRejectedValueOnce(new Error("Synthetic reload failure"));
  fireEvent.click(
    screen.getByRole("button", { name: "Reload saved preference" }),
  );
  await screen.findByText(/Could not reload/);
  expect(select().value).toBe("4");
  state.read.mockResolvedValue(
    snapshot({ preferredMaximum: 1, count: 3, version: 1 }),
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Retry refresh" }).at(-1)!,
  );
  await waitFor(() => expect(select().value).toBe("1"));
  expect(state.save).not.toHaveBeenCalled();
});
it("never replays an accepted save when synchronization fails, then permits a new versioned save after recovery", async () => {
  mount();
  await choose("0");
  state.read.mockRejectedValueOnce(new Error("Synthetic read failure"));
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByText(/Preference saved, but synchronization failed/);
  expect(select().disabled).toBe(true);
  expect(state.save).toHaveBeenCalledTimes(1);
  state.read.mockResolvedValue(snapshot({ preferredMaximum: 0, version: 1 }));
  fireEvent.click(
    screen.getAllByRole("button", { name: "Retry refresh" }).at(-1)!,
  );
  await waitFor(() => expect(select().disabled).toBe(false));
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
  const form = screen.getByRole("form", { name: "Assigned Session Blocks" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  expect(select().disabled).toBe(true);
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
  await waitFor(() => expect(select().disabled).toBe(true));
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
  await waitFor(() => expect(select().value).toBe("0"));
  expect(select().disabled).toBe(true);
  await act(async () => {
    state.client!.setQueryData(
      ["preference"],
      snapshot({ preferredMaximum: 0, version: 1 }),
    );
  });
  expect(select().value).toBe("0");
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
  expect(screen.queryByRole("combobox")).toBeNull();
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
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(state.client!.getQueryData(["preference"])).toBeUndefined();
  expect(state.save).toHaveBeenCalledTimes(1);
  state.read.mockResolvedValue(snapshot());
  fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
  await screen.findByRole("combobox");
  expect(select().value).toBe("2");
  expect(state.save).toHaveBeenCalledTimes(1);
});
