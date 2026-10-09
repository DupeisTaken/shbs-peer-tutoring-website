/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
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
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import TuteesPage from "./page";

const mocks = vi.hoisted(() => ({ create: vi.fn(), invalidate: vi.fn() }));
vi.mock("~/lib/tutee-cache", () => ({
  invalidateTuteeViews: mocks.invalidate,
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  const empty = { useQuery: () => ({ data: [] }) };
  return {
    api: {
      useUtils: () => ({}),
      // Creation tests run as Head; identity is also used by roster profile guards.
      account: { me: { useQuery: () => ({ data: { role: "HEAD" } }) } },
      program: {
        profilePolicy: {
          useQuery: () => ({ data: { offeredGrades: [9, 12] } }),
        },
      },
      tuteeHistory: { permissions: { useQuery: () => ({ data: {} }) } },
      admin: {
        tutees: empty,
        tutors: empty,
        pairings: empty,
        subjects: {
          useQuery: () => ({
            data: [
              { id: "math", name: "Math" },
              { id: "english", name: "English" },
            ],
          }),
        },
        tuteeStats: { useQuery: () => ({ data: {} }) },
        // Exercise the real mutation observer, including reset and async callback
        // ordering, so stale success cannot be hidden by a hand-updated mock.
        createTutee: {
          useMutation: (options: { onSuccess: () => Promise<void> }) =>
            useMutation({ mutationFn: mocks.create, ...options, retry: false }),
        },
        deleteTutee: { useMutation: () => ({ mutate: vi.fn() }) },
      },
    },
  };
});

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.resetAllMocks();
});

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount(locale: "en" | "zh" = "en") {
  const messages = locale === "en" ? en : zh;
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="Asia/Shanghai"
      >
        <TuteesPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-controls="add-tutee-form"]',
  )!;
  const panel = document.querySelector<HTMLElement>("#add-tutee-form")!;
  const form = panel.querySelector("form")!;
  const first = panel.querySelector<HTMLInputElement>('[name="firstName"]')!;
  const footer = panel.querySelector<HTMLButtonElement>(
    'button[type="button"]',
  )!;
  const submit = panel.querySelector<HTMLButtonElement>(
    'button:not([type="button"])',
  )!;
  return { messages, trigger, panel, form, first, footer, submit };
}

it.each(["en", "zh"] as const)(
  "confirms only new saves across repeated drafts and both hide actions (%s)",
  async (locale) => {
    mocks.create.mockResolvedValue({ id: "saved" });
    const { messages, trigger, panel, first, footer, submit } = mount(locale);
    for (const hide of [footer, trigger]) {
      fireEvent.click(trigger);
      fireEvent.change(first, { target: { value: "Saved" } });
      fireEvent.click(submit);
      await waitFor(() =>
        expect(
          screen.getByText(messages.admin.tutees.addSaved).getAttribute("role"),
        ).toBe("status"),
      );
      expect(panel.hidden).toBe(true);
      expect(document.activeElement).toBe(trigger);
      fireEvent.click(trigger);
      expect(first.value).toBe("");
      expect(screen.queryByText(messages.admin.tutees.addSaved)).toBeNull();
      fireEvent.change(first, { target: { value: "Unsaved" } });
      fireEvent.click(hide);
      expect(panel.hidden).toBe(true);
      expect(screen.queryByText(messages.admin.tutees.addSaved)).toBeNull();
      fireEvent.click(trigger);
      expect(first.value).toBe("Unsaved");
      fireEvent.click(hide);
    }
    expect(mocks.create).toHaveBeenCalledTimes(2);
  },
);

it("freezes every draft control, blocks hiding and duplicate submission, then restores focus after settlement", async () => {
  const request = deferred();
  const invalidation = deferred();
  mocks.create.mockReturnValue(request.promise);
  mocks.invalidate.mockReturnValue(invalidation.promise);
  const { messages, trigger, panel, form, first, footer } = mount();
  fireEvent.click(trigger);
  fireEvent.change(first, { target: { value: "Snapshot" } });
  // Dispatch in one batch: the guard must work before isPending renders.
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.click(trigger);
    fireEvent.click(footer);
  });
  await waitFor(() => expect(form.getAttribute("aria-busy")).toBe("true"));
  expect(panel.hidden).toBe(false);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0]![0]).toMatchObject({
    firstName: "Snapshot",
  });
  for (const control of panel.querySelectorAll("input, select, button"))
    expect(control.matches(":disabled")).toBe(true);
  expect(trigger.disabled).toBe(true);
  fireEvent.submit(form);
  fireEvent.click(trigger);
  fireEvent.click(footer);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(panel.hidden).toBe(false);
  await act(async () => request.resolve({ id: "saved" }));
  expect(trigger.disabled).toBe(true);
  expect(panel.hidden).toBe(false);
  await act(async () => invalidation.resolve());
  await waitFor(() =>
    expect(screen.getByText(messages.admin.tutees.addSaved)).toBeTruthy(),
  );
  expect(trigger.disabled).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it("retains all failed fields and errors through hiding, allows corrections, and confirms a successful retry", async () => {
  const request = deferred();
  mocks.create
    .mockReturnValueOnce(request.promise)
    .mockResolvedValue({ id: "retry" });
  const { messages, trigger, panel, first, submit, footer } = mount();
  fireEvent.click(trigger);
  const names = ["Original", "Learner", "Nickname", "示例"];
  const inputs = [...panel.querySelectorAll<HTMLInputElement>("input")];
  inputs.forEach((input, index) =>
    fireEvent.change(input, { target: { value: names[index] } }),
  );
  const choices = ["9", "math", "english"];
  const selects = [...panel.querySelectorAll("select")];
  selects.forEach((select, index) =>
    fireEvent.change(select, { target: { value: choices[index] } }),
  );
  fireEvent.click(submit);
  await waitFor(() => expect(trigger.disabled).toBe(true));
  await act(async () => request.reject(new Error("Save failed; retry")));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Save failed; retry"),
  );
  expect(panel.hidden).toBe(false);
  expect(inputs.map((input) => input.value)).toEqual(names);
  expect(selects.map((select) => select.value)).toEqual(choices);
  for (const control of [...inputs, ...selects, footer, submit, trigger])
    expect(control.matches(":disabled")).toBe(false);
  for (const hide of [footer, trigger]) {
    fireEvent.click(hide);
    expect(screen.queryByText(messages.admin.tutees.addSaved)).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("alert").textContent).toBe("Save failed; retry");
    expect(first.value).toBe("Original");
  }
  fireEvent.change(first, { target: { value: "Corrected" } });
  fireEvent.click(submit);
  await waitFor(() =>
    expect(screen.getByText(messages.admin.tutees.addSaved)).toBeTruthy(),
  );
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls[1]![0]).toMatchObject({
    firstName: "Corrected",
    lastName: "Learner",
    preferredName: "Nickname",
    alternativeNames: "示例",
    gradeLevel: "9",
    firstChoiceId: "math",
    secondChoiceId: "english",
  });
  expect(document.activeElement).toBe(trigger);
});

it("retains native required validation and permits a first-name-only submission", async () => {
  mocks.create.mockResolvedValue({ id: "minimal" });
  const { messages, trigger, form, first, submit } = mount();
  fireEvent.click(trigger);
  expect(first.required).toBe(true);
  expect(form.checkValidity()).toBe(false);
  fireEvent.click(submit);
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.change(first, { target: { value: "Minimal" } });
  expect(form.checkValidity()).toBe(true);
  fireEvent.click(submit);
  await waitFor(() =>
    expect(screen.getByText(messages.admin.tutees.addSaved)).toBeTruthy(),
  );
  expect(mocks.create.mock.calls[0]![0]).toMatchObject({
    firstName: "Minimal",
    gradeLevel: undefined,
    firstChoiceId: undefined,
    secondChoiceId: undefined,
  });
});
