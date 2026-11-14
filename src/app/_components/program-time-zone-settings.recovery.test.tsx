/** @vitest-environment jsdom */
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
import messages from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const fixture = vi.hoisted(() => ({
  failRead: false,
  missing: false,
  failure: null as Error | null,
  failedReads: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => ({
        program: {
          timeZoneSettings: { invalidate: vi.fn() },
          nextRecruitment: { invalidate: vi.fn() },
        },
      }),
      program: {
        timeZoneSettings: {
          useQuery: () =>
            useQuery({
              queryKey: ["audit-timezone-settings"],
              queryFn: async () => {
                if (fixture.failRead) {
                  fixture.failedReads();
                  throw (
                    fixture.failure ??
                    new Error("Synthetic timezone settings unavailable")
                  );
                }
                if (fixture.missing) return null;
                return {
                  timeZone: "Asia/Shanghai",
                  canEdit: true,
                  canApply: true,
                  timeZoneOptions: ["UTC", "Asia/Shanghai"],
                };
              },
              retry: false,
            }),
        },
        setTimeZone: {
          useMutation: () => ({
            mutate: fixture.mutate,
            isPending: false,
            error: null,
          }),
        },
      },
    },
  };
});
import { ProgramTimeZoneSettings } from "./program-time-zone-settings";

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.failRead = false;
  fixture.missing = false;
  fixture.failure = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
const messagesByLocale = { en: messages, zh };
const show = (locale: keyof typeof messagesByLocale = "en") =>
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={messagesByLocale[locale]}
      >
        <ProgramTimeZoneSettings />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

it.each(["en", "zh"] as const)(
  "identifies an initial timezone read failure in %s and recovers without changing the setting",
  async (locale) => {
    const localizedMessages = messagesByLocale[locale];
    fixture.failRead = true;
    fixture.failure = new Error("Service unavailable");
    show(locale);
    const panel = await screen.findByRole("alert");
    expect(
      within(panel).getByRole("heading", {
        level: 2,
        name: localizedMessages.programTimeZone.title,
      }),
    ).toBeTruthy();
    expect(within(panel).getByText("Service unavailable")).toBeTruthy();
    expect(
      within(panel).queryByRole("heading", { name: "Service unavailable" }),
    ).toBeNull();
    expect(fixture.failedReads).toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
    const retry = screen.getByRole("button", {
      name: localizedMessages.uiPatterns.retry,
    });
    fixture.failRead = false;
    fireEvent.click(retry);
    await screen.findByRole("combobox");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fixture.mutate).not.toHaveBeenCalled();
  },
);

it("a cached timezone read failure retains settings and offers read-only Retry", async () => {
  show();
  await screen.findByRole("combobox");
  fixture.failRead = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["audit-timezone-settings"] });
  });
  await screen.findByRole("alert");
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe(
    "Asia/Shanghai",
  );
  fixture.failRead = false;
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("keeps the independent timezone selection through ordinary read-only recovery", async () => {
  show();
  const select = await screen.findByRole("combobox");
  fireEvent.change(select, { target: { value: "UTC" } });
  fixture.failRead = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["audit-timezone-settings"] });
  });
  await screen.findByRole("alert");
  fixture.failRead = false;
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("UTC");
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("conceals denied cached settings through null and transport responses until a fresh authorized read", async () => {
  show();
  await screen.findByRole("combobox");
  fixture.failRead = true;
  fixture.failure = Object.assign(
    new Error("Synthetic timezone access denied"),
    { data: { code: "FORBIDDEN" } },
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["audit-timezone-settings"] });
  });
  await screen.findByText("Synthetic timezone access denied");
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: messages.programTimeZone.title,
    }),
  ).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  fixture.failRead = false;
  fixture.missing = true;
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  await screen.findByText(messages.uiPatterns.loadFailed);
  expect(screen.queryByRole("combobox")).toBeNull();
  fixture.missing = false;
  fixture.failRead = true;
  fixture.failure = new Error("Synthetic later transport failure");
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  await screen.findByText("Synthetic later transport failure");
  expect(screen.queryByRole("combobox")).toBeNull();
  fixture.failRead = false;
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  await screen.findByRole("combobox");
  expect(fixture.mutate).not.toHaveBeenCalled();
});

it("offers read-only recovery for a null settings response", async () => {
  fixture.missing = true;
  show();
  const panel = await screen.findByRole("alert");
  expect(
    within(panel).getByRole("heading", {
      level: 2,
      name: messages.programTimeZone.title,
    }),
  ).toBeTruthy();
  expect(within(panel).getByText(messages.uiPatterns.loadFailed)).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  fixture.missing = false;
  fireEvent.click(
    screen.getByRole("button", { name: messages.uiPatterns.retry }),
  );
  await screen.findByRole("combobox");
  expect(fixture.mutate).not.toHaveBeenCalled();
});
