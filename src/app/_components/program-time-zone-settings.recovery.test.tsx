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
import {
  QueryClientProvider,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { createQueryClient } from "~/trpc/query-client";
import { ProgramTimeZoneSettings } from "./program-time-zone-settings";

const state = vi.hoisted(() => ({
  settingsFn: vi.fn<() => Promise<unknown>>(),
  setTimeZoneMutate: vi.fn(),
  setTimeZoneOpts: undefined as undefined | { onSuccess?: () => Promise<void> },
  invalidateSettings: vi.fn(async () => undefined),
  invalidateRecruitment: vi.fn(async () => undefined),
  routerRefresh: vi.fn(),
}));

let queryClient: QueryClient;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.routerRefresh }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      program: {
        timeZoneSettings: { invalidate: state.invalidateSettings },
        nextRecruitment: { invalidate: state.invalidateRecruitment },
      },
    }),
    program: {
      timeZoneSettings: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          useQuery({
            queryKey: [["program", "timeZoneSettings"], { type: "query" }],
            queryFn: () => state.settingsFn(),
            enabled: options?.enabled !== false,
          }),
      },
      setTimeZone: {
        useMutation: (opts: typeof state.setTimeZoneOpts) => {
          state.setTimeZoneOpts = opts;
          return {
            mutate: state.setTimeZoneMutate,
            isPending: false,
            error: null,
          };
        },
      },
    },
  },
}));

const sampleSettings = {
  timeZone: "Asia/Shanghai",
  canEdit: true,
  canApply: true,
  timeZoneOptions: ["UTC", "Asia/Shanghai", "America/New_York"],
};

function renderZone(locale: "en" | "zh" = "en") {
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="UTC"
      >
        <ProgramTimeZoneSettings />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: 30_000,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  vi.clearAllMocks();
  state.settingsFn.mockResolvedValue(sampleSettings);
  state.invalidateSettings.mockResolvedValue(undefined);
  state.invalidateRecruitment.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  ["en", en.programTimeZone.title, en.uiPatterns.retry],
  ["zh", zh.programTimeZone.title, zh.uiPatterns.retry],
] as const)(
  "preserves the translated Program Time Zone heading with generic initial read error as subordinate detail and read-only Retry (%s) (#648)",
  async (locale, heading, retryLabel) => {
    state.settingsFn.mockRejectedValueOnce(new Error("Request failed"));
    renderZone(locale);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy(),
    );
    expect(screen.getByText("Request failed")).toBeTruthy();

    // Retry is read-only: never invokes setTimeZone.
    state.settingsFn.mockResolvedValueOnce(sampleSettings);
    fireEvent.click(screen.getByRole("button", { name: retryLabel }));
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    expect(state.setTimeZoneMutate).not.toHaveBeenCalled();
  },
);

it("retains selection draft and blocks writes on cached refresh failure, and conceals on FORBIDDEN denial (#648)", async () => {
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  renderZone("en");
  await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());

  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "America/New_York" },
  });
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe(
    "America/New_York",
  );

  // Cached refresh fails with ordinary error -> keeps draft and disables editing.
  state.settingsFn.mockRejectedValueOnce(new Error("Temporary outage"));
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [["program", "timeZoneSettings"]],
    });
  });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Temporary outage"),
  );
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe(
    "America/New_York",
  );
  expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(true);

  // Authoritative denial conceals cached settings and keeps heading + Retry.
  now = Date.UTC(2026, 10, 9, 12, 0);
  state.settingsFn.mockRejectedValueOnce(
    Object.assign(new Error("Forbidden"), { data: { code: "FORBIDDEN" } }),
  );
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(
    screen.getByRole("heading", { name: en.programTimeZone.title }),
  ).toBeTruthy();

  // Recovery under backward clock skew restores settings.
  now = Date.UTC(2026, 10, 9, 11, 50);
  state.settingsFn.mockResolvedValueOnce(sampleSettings);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
});

it("offers read-only refresh recovery after an accepted save whose invalidation fails without replaying setTimeZone (#648)", async () => {
  renderZone("en");
  await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());

  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "America/New_York" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: en.programTimeZone.confirm }),
  );

  state.invalidateSettings.mockRejectedValueOnce(new Error("Refresh failed"));
  state.setTimeZoneMutate.mockImplementationOnce(() => {
    void state.setTimeZoneOpts?.onSuccess?.();
  });

  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.programTimeZone.save }),
    );
  });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      en.managementRecovery.refreshFailed.replace(
        "{section}",
        en.programTimeZone.title,
      ),
    ),
  );
  expect(state.setTimeZoneMutate).toHaveBeenCalledTimes(1);

  // Clicking Retry refreshes settings without replaying setTimeZone.
  state.invalidateSettings.mockResolvedValueOnce(undefined);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  });
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(state.setTimeZoneMutate).toHaveBeenCalledTimes(1);
  expect(state.routerRefresh).toHaveBeenCalledTimes(1);
});
