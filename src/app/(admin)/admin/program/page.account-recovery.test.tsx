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
import {
  QueryClientProvider,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppRouter } from "~/server/api/root";
import en from "../../../../../messages/en.json";

const fixture = vi.hoisted(() => ({
  readAccount: vi.fn<() => Promise<unknown>>(),
  readPeriod: vi.fn<() => Promise<unknown>>(),
  readPolicy: vi.fn<() => Promise<unknown>>(),
  readNext: vi.fn<() => Promise<unknown>>(),
  readSchedule: vi.fn<() => Promise<unknown>>(),
  writePolicy: vi.fn<(input: unknown) => Promise<unknown>>(),
  writeRefresh: vi.fn<(input: unknown) => Promise<unknown>>(),
  requests: [] as { path: string; type: string; input: unknown }[],
  query: "panel=people",
  privateChild: vi.fn(() => null),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(fixture.query),
  useRouter: () => ({ replace: fixture.replace, refresh: fixture.refresh }),
}));
// Keep the actual hooks, cache keys and utilities without mounting the global
// identity poller. No production server or database module enters this fixture.
vi.mock("~/trpc/react", async () => {
  const { createTRPCReact } = await import("@trpc/react-query");
  return { api: createTRPCReact<AppRouter>() };
});
// These independent editors own separate behavior tests. The parent page,
// SectionTabs, session denial hook and profile draft owner remain real here.
vi.mock("~/app/_components/program-captcha-settings", () => ({
  ProgramCaptchaSettings: fixture.privateChild,
}));
vi.mock("~/app/_components/program-email-settings", () => ({
  ProgramEmailSettings: fixture.privateChild,
}));
vi.mock("~/app/_components/program-time-zone-settings", () => ({
  ProgramTimeZoneSettings: fixture.privateChild,
}));
vi.mock("~/app/_components/recruitment-settings", () => ({
  RecruitmentSettings: () => null,
}));
vi.mock("~/app/_components/program-public-qr-links", () => ({
  ProgramPublicQrLinks: () => null,
}));
vi.mock("~/app/_components/next-recruitment-settings", () => ({
  NextRecruitmentSettings: fixture.privateChild,
  NextRecruitmentError: ({ message }: { message: string }) => message,
}));
vi.mock("~/app/_components/school-calendar", () => ({
  SchoolCalendar: fixture.privateChild,
}));
vi.mock("~/app/_components/program-calendar", () => ({
  ProgramCalendarSettings: fixture.privateChild,
}));
vi.mock("~/app/_components/program-name-settings", () => ({
  ProgramNameSettings: fixture.privateChild,
}));
vi.mock("~/app/_components/message-admin", () => ({
  MessagePermissions: fixture.privateChild,
}));
vi.mock("~/app/_components/program-feature-settings", () => ({
  FeatureToggles: fixture.privateChild,
}));

import { api } from "~/trpc/react";
import { createQueryClient } from "~/trpc/query-client";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import ProgramPage from "./program-settings";

const account = { id: "synthetic-head", role: "HEAD" };
const policy = {
  requireLatinNames: true,
  requireLatinLegalNames: false,
  usePreferredNames: true,
  showAlternateNames: false,
  offeredGrades: [9, 10, 11, 12],
  canEdit: true,
  canApply: true,
};
const period = {
  termId: "synthetic-term",
  name: "Synthetic current term",
  semester: 1,
  schoolYear: "26-27",
  quarter: "Q1",
  canEdit: true,
  canApply: true,
  recruitment: { tutor: {}, tutee: {} },
  next: { name: "Synthetic next term", semester: 1 },
};
const target = {
  sourceTermId: period.termId,
  sourceSchoolYear: "26-27",
  sourceQuarter: "Q1",
  destinationSchoolYear: "26-27",
  destinationQuarter: "Q2",
  semesterMode: false,
  modeRevision: 0,
};
const nextRecruitment = {
  target,
  currentName: period.name,
  nextName: period.next.name,
  timeZone: "Asia/Shanghai",
  preparations: { tutor: null, tutee: null },
  canEdit: true,
  canApply: true,
  refreshEvidence: {
    target,
    timeZone: "Asia/Shanghai",
    preparations: { tutor: null, tutee: null },
    destination: null,
  },
};
const refreshSchedule = {
  schedule: null,
  activeSourceTermId: period.termId,
  serverNow: new Date("2026-10-30T01:00:00Z"),
  canEdit: true,
  canApply: true,
};

function readError(
  code: "INTERNAL_SERVER_ERROR" | "FORBIDDEN" | "UNAUTHORIZED",
  message = `Synthetic ${code} account read`,
) {
  return TRPCClientError.from<AppRouter>({
    error: {
      message,
      code:
        code === "INTERNAL_SERVER_ERROR"
          ? -32603
          : code === "FORBIDDEN"
            ? -32003
            : -32001,
      data: {
        code,
        httpStatus:
          code === "INTERNAL_SERVER_ERROR"
            ? 500
            : code === "FORBIDDEN"
              ? 403
              : 401,
      },
    },
  });
}

// This allowlist is the entire fake transport. Writes are captured only;
// unexpected operations fail without network or persistence.
function transport(): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        let subscribed = true;
        fixture.requests.push({
          path: op.path,
          type: op.type,
          input: op.input,
        });
        void Promise.resolve()
          .then<unknown>(() => {
            if (op.type === "query" && op.path === "account.me")
              return fixture.readAccount();
            if (op.type === "query" && op.path === "admin.currentPeriod")
              return fixture.readPeriod();
            if (
              op.type === "query" &&
              op.path === "program.profilePolicySettings"
            )
              return fixture.readPolicy();
            if (op.type === "query" && op.path === "program.nextRecruitment")
              return fixture.readNext();
            if (op.type === "query" && op.path === "admin.refreshSchedule")
              return fixture.readSchedule();
            if (
              op.type === "mutation" &&
              op.path === "program.setProfilePolicy"
            )
              return fixture.writePolicy(op.input);
            if (op.type === "mutation" && op.path === "admin.refresh")
              return fixture.writeRefresh(op.input);
            throw new Error(
              `Unexpected fixture operation: ${op.type} ${op.path}`,
            );
          })
          .then(
            (data) => {
              if (!subscribed) return;
              observer.next({ result: { data } });
              observer.complete();
            },
            (cause: unknown) => {
              if (subscribed)
                observer.error(
                  TRPCClientError.from<AppRouter>(
                    cause instanceof Error
                      ? cause
                      : new Error("Synthetic read failure"),
                  ),
                );
            },
          );
        return () => {
          subscribed = false;
        };
      });
}

let client: QueryClient;
let expectedWrites: number;
let expectedRefreshWrites: number;
beforeEach(() => {
  fixture.requests = [];
  fixture.query = "panel=people";
  fixture.privateChild.mockClear();
  fixture.readAccount.mockReset().mockResolvedValue(account);
  fixture.readPeriod.mockReset().mockResolvedValue(period);
  fixture.readPolicy.mockReset().mockResolvedValue(policy);
  fixture.readNext.mockReset().mockResolvedValue(nextRecruitment);
  fixture.readSchedule.mockReset().mockResolvedValue(refreshSchedule);
  fixture.writePolicy
    .mockReset()
    .mockRejectedValue(new Error("Synthetic rejected policy save"));
  fixture.writeRefresh
    .mockReset()
    .mockRejectedValue(new Error("Synthetic rejected refresh"));
  fixture.replace.mockReset();
  fixture.refresh.mockReset();
  expectedWrites = 0;
  expectedRefreshWrites = 0;
  sessionStorage.clear();
  window.history.replaceState(null, "", "/admin/program?panel=people");
  client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: Infinity,
      gcTime: Infinity,
    },
    mutations: { ...defaults.mutations, retry: false, gcTime: Infinity },
  });
});

afterEach(() => {
  cleanup();
  expect(fixture.writePolicy).toHaveBeenCalledTimes(expectedWrites);
  expect(fixture.writeRefresh).toHaveBeenCalledTimes(expectedRefreshWrites);
  expect(
    fixture.requests.filter(
      (request) =>
        !(
          request.type === "query" &&
          [
            "account.me",
            "admin.currentPeriod",
            "admin.refreshSchedule",
            "program.profilePolicySettings",
            "program.nextRecruitment",
          ].includes(request.path)
        ) &&
        !(
          request.type === "mutation" &&
          ["program.setProfilePolicy", "admin.refresh"].includes(request.path)
        ),
    ),
  ).toEqual([]);
  client.clear();
  vi.restoreAllMocks();
});

// A sibling observer establishes committed query phases without assuming that
// the parent either retains or removes private children during those phases.
function QueryStateProbe() {
  const account = api.account.me.useQuery();
  const period = api.admin.currentPeriod.useQuery();
  return (
    <>
      <output data-testid="account-query-state">
        {`${account.status}/${account.error?.data?.code ?? "none"}/${account.fetchStatus}`}
      </output>
      <output data-testid="account-query-error">
        {account.error?.message ?? "none"}
      </output>
      <output data-testid="period-query-state">
        {`${period.status}/${period.error?.data?.code ?? "none"}/${period.fetchStatus}`}
      </output>
    </>
  );
}

async function waitForPhase(
  query: "account" | "period",
  status: "success" | "error",
  code = "none",
) {
  await waitFor(() =>
    expect(screen.getByTestId(`${query}-query-state`).textContent).toBe(
      `${status}/${code}/idle`,
    ),
  );
}

function show() {
  window.history.replaceState(
    null,
    "",
    `/admin/program${fixture.query ? `?${fixture.query}` : ""}`,
  );
  const trpc = api.createClient({ links: [transport()] });
  const tree = (readOnly = false) => (
    <QueryClientProvider client={client}>
      <api.Provider client={trpc} queryClient={client}>
        <QueryStateProbe />
        <NextIntlClientProvider
          locale="en"
          timeZone="Asia/Shanghai"
          messages={en}
        >
          <SessionViewProvider
            identity="synthetic-head"
            pathname="/admin/program"
            verified
          >
            <ReadOnlyProvider value={readOnly}>
              <ProgramPage />
            </ReadOnlyProvider>
          </SessionViewProvider>
        </NextIntlClientProvider>
      </api.Provider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { setReadOnly: (value: boolean) => view.rerender(tree(value)) };
}

function preferred(hidden = false) {
  if (hidden)
    return screen.queryByLabelText<HTMLInputElement>(
      en.profilePolicy.usePreferredNames,
      { selector: 'input[type="checkbox"]' },
    );
  return screen.queryByRole<HTMLInputElement>("checkbox", {
    name: en.profilePolicy.usePreferredNames,
  });
}

async function stageDraft() {
  const view = show();
  const field = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: en.profilePolicy.usePreferredNames,
  });
  await waitForPhase("account", "success");
  await waitForPhase("period", "success");
  expect(field.checked).toBe(true);
  fireEvent.click(field);
  expect(field.checked).toBe(false);
  return { field, ...view };
}

async function refreshRead(key: QueryKey) {
  let rejected: unknown;
  await act(async () => {
    try {
      await client.refetchQueries(
        { queryKey: key, exact: true },
        { throwOnError: true },
      );
    } catch (cause) {
      rejected = cause;
    }
  });
  return rejected;
}

function accountKey() {
  return getQueryKey(api.account.me, undefined, "query");
}
function periodKey() {
  return getQueryKey(api.admin.currentPeriod, undefined, "query");
}
function policyKey() {
  return getQueryKey(api.program.profilePolicySettings, undefined, "query");
}
function profileForm(field: HTMLInputElement) {
  const form = field.closest("form");
  expect(form).not.toBeNull();
  return form!;
}
function assertBlocked(field: HTMLInputElement) {
  expect(field.matches(":disabled")).toBe(true);
  // Submit directly as well: a disabled control alone is not write admission.
  fireEvent.submit(profileForm(field));
  expect(fixture.writePolicy).not.toHaveBeenCalled();
}

it("retains the actual profile draft through a hidden-panel round trip", async () => {
  const { field } = await stageDraft();
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.period }),
  );
  expect(preferred()).toBeNull();
  expect(preferred(true)).toBe(field);
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.people }),
  );
  expect(preferred()).toBe(field);
  expect(field.checked).toBe(false);
});

it.each([false, true])(
  "retains the profile owner and blocks writes during cached account error (hidden=%s)",
  async (hidden) => {
    const { field } = await stageDraft();
    if (hidden)
      fireEvent.click(
        screen.getByRole("tab", { name: en.admin.program.panels.period }),
      );
    const failure = readError("INTERNAL_SERVER_ERROR");
    fixture.readAccount.mockRejectedValueOnce(failure);
    expect(await refreshRead(accountKey())).toBe(failure);
    await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
    expect(client.getQueryData(accountKey())).toEqual(account);
    expect(client.getQueryState(policyKey())?.status).toBe("success");
    expect(preferred(true)).toBe(field);
    expect(field.checked).toBe(false);
    assertBlocked(field);

    fireEvent.click(
      screen.getByRole("button", {
        name: en.managementRecovery.retry.replace(
          "{section}",
          en.admin.program.panels[hidden ? "period" : "people"],
        ),
      }),
    );
    await waitForPhase("account", "success");
    if (hidden)
      fireEvent.click(
        screen.getByRole("tab", { name: en.admin.program.panels.people }),
      );
    expect(preferred()).toBe(field);
    expect(field.checked).toBe(false);
    expect(field.matches(":disabled")).toBe(false);
    expect(fixture.readPeriod).toHaveBeenCalledTimes(1);
    expect(fixture.readPolicy).toHaveBeenCalledTimes(1);
    expectedWrites = 1;
    fireEvent.submit(profileForm(field));
    await waitFor(() =>
      expect(fixture.writePolicy).toHaveBeenCalledWith({
        requireLatinNames: true,
        requireLatinLegalNames: false,
        usePreferredNames: false,
        showAlternateNames: false,
        offeredGrades: [9, 10, 11, 12],
        expectedPolicy: {
          requireLatinNames: true,
          requireLatinLegalNames: false,
          usePreferredNames: true,
          showAlternateNames: false,
          offeredGrades: [9, 10, 11, 12],
        },
      }),
    );
    await screen.findByText("Synthetic rejected policy save");
  },
);

it("keeps the child's own read failure blocked after the account read recovers", async () => {
  const { field } = await stageDraft();
  fixture.readPolicy.mockRejectedValueOnce(
    new Error("Synthetic policy read failure"),
  );
  expect(await refreshRead(policyKey())).toBeInstanceOf(Error);
  await screen.findByRole("heading", { name: en.profilePolicy.loadFailed });
  expect(preferred()).toBe(field);
  expect(field.checked).toBe(false);
  assertBlocked(field);
  fixture.readAccount.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  await refreshRead(accountKey());
  await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
  await refreshRead(accountKey());
  await waitForPhase("account", "success");
  expect(preferred()).toBe(field);
  assertBlocked(field);

  // A successful background read can unblock this owner, but cannot rebase its
  // draft or expected version to a different remotely saved policy.
  fixture.readPolicy.mockResolvedValue({ ...policy, offeredGrades: [12] });
  await refreshRead(policyKey());
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: en.profilePolicy.loadFailed }),
    ).toBeNull(),
  );
  expect(preferred()).toBe(field);
  expect(field.checked).toBe(false);
  expect(field.matches(":disabled")).toBe(false);
  expectedWrites = 1;
  fireEvent.submit(profileForm(field));
  await waitFor(() => expect(fixture.writePolicy).toHaveBeenCalledTimes(1));
  expect(fixture.writePolicy.mock.calls[0]?.[0]).toMatchObject({
    offeredGrades: [9, 10, 11, 12],
    expectedPolicy: {
      offeredGrades: [9, 10, 11, 12],
    },
  });
  await screen.findByText("Synthetic rejected policy save");
});

it("does not block an independent profile save on an ordinary period read failure", async () => {
  const { field } = await stageDraft();
  fixture.readPeriod.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  await refreshRead(periodKey());
  await waitForPhase("period", "error", "INTERNAL_SERVER_ERROR");
  expect(preferred()).toBe(field);
  expect(field.checked).toBe(false);
  expect(field.matches(":disabled")).toBe(false);
  expectedWrites = 1;
  fireEvent.submit(profileForm(field));
  await waitFor(() => expect(fixture.writePolicy).toHaveBeenCalledTimes(1));
  await screen.findByText("Synthetic rejected policy save");
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.period }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: en.managementRecovery.retry.replace(
        "{section}",
        en.admin.program.currentPeriod,
      ),
    }),
  );
  await waitForPhase("period", "success");
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.people }),
  );
  expect(preferred()).toBe(field);
  expect(field.checked).toBe(false);
});

it.each(
  (["account", "period"] as const).flatMap((prerequisite) =>
    (["FORBIDDEN", "UNAUTHORIZED"] as const).map((code) => ({
      prerequisite,
      code,
    })),
  ),
)(
  "conceals private drafts after $prerequisite $code and latches denial through an ordinary failure",
  async ({ prerequisite, code }) => {
    const { field } = await stageDraft();
    const failingRead =
      prerequisite === "account" ? fixture.readAccount : fixture.readPeriod;
    const key = prerequisite === "account" ? accountKey() : periodKey();
    failingRead.mockRejectedValueOnce(readError(code));
    await refreshRead(key);
    await waitForPhase(prerequisite, "error", code);
    expect(client.getQueryData(accountKey())).toEqual(account);
    expect(field.isConnected).toBe(false);
    expect(preferred(true)).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();

    failingRead.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
    await refreshRead(key);
    await waitForPhase(prerequisite, "error", "INTERNAL_SERVER_ERROR");
    expect(preferred(true)).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(fixture.readPolicy).toHaveBeenCalledTimes(1);

    await refreshRead(key);
    await waitForPhase(prerequisite, "success");
    const recovered = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: en.profilePolicy.usePreferredNames,
    });
    expect(recovered).not.toBe(field);
    expect(recovered.checked).toBe(true);
    // The global identity poller's UNAUTHORIZED clear/reload is deliberately
    // outside this fixture. This verifies the page's own concealment/recovery.
  },
);

it.each([
  { id: "synthetic-other-head", role: "HEAD" },
  { id: "synthetic-head", role: "ADMIN" },
  { id: "synthetic-head", role: "COORDINATOR" },
])(
  "starts a fresh owner for successful account identity/rank $id/$role",
  async (next) => {
    const { field } = await stageDraft();
    fixture.readAccount.mockResolvedValueOnce(next);
    await refreshRead(accountKey());
    await waitForPhase("account", "success");
    await waitFor(() => expect(preferred()).not.toBe(field));
    expect(field.isConnected).toBe(false);
    expect(preferred()?.checked).toBe(true);
  },
);

it("unmounts private owners on a successful lower role and does not restore their drafts", async () => {
  const { field } = await stageDraft();
  fixture.readAccount.mockResolvedValueOnce({ ...account, role: "VIEWER" });
  await refreshRead(accountKey());
  await waitForPhase("account", "success");
  expect(field.isConnected).toBe(false);
  expect(preferred(true)).toBeNull();
  expect(screen.getByText(period.name)).toBeTruthy();
  await refreshRead(accountKey());
  await waitForPhase("account", "success");
  const recovered = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: en.profilePolicy.usePreferredNames,
  });
  expect(recovered).not.toBe(field);
  expect(recovered.checked).toBe(true);
});

it("conceals private owners immediately when the session becomes read-only", async () => {
  const { field, setReadOnly } = await stageDraft();
  setReadOnly(true);
  expect(field.isConnected).toBe(false);
  expect(preferred(true)).toBeNull();
  expect(screen.getByText(period.name)).toBeTruthy();
  setReadOnly(false);
  const recovered = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: en.profilePolicy.usePreferredNames,
  });
  expect(recovered).not.toBe(field);
  expect(recovered.checked).toBe(true);
});

it("never mounts private query children when the initial account read fails", async () => {
  fixture.readAccount.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  show();
  await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
  expect(preferred(true)).toBeNull();
  expect(fixture.readPolicy).not.toHaveBeenCalled();
});

it.each([
  { entry: "bare default URL", query: "" },
  { entry: "explicit panel=period URL", query: "panel=period" },
])(
  "offers initial account recovery in the selected period panel ($entry)",
  async ({ query }) => {
    fixture.query = query;
    const initialFailure = readError(
      "INTERNAL_SERVER_ERROR",
      "Synthetic initial account read failure",
    );
    const retryFailure = readError(
      "INTERNAL_SERVER_ERROR",
      "Synthetic repeated account read failure",
    );
    fixture.readAccount
      .mockRejectedValueOnce(initialFailure)
      .mockRejectedValueOnce(retryFailure);
    show();
    await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
    await waitForPhase("period", "success");
    await waitFor(() =>
      expect(screen.getByTestId("account-query-error").textContent).toBe(
        initialFailure.message,
      ),
    );
    expect(window.location.search).toBe(query ? `?${query}` : "");
    expect(
      screen
        .getByRole("tab", { name: en.admin.program.panels.period })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(client.getQueryData(accountKey())).toBeUndefined();
    const expectPrivateSettingsAbsent = () => {
      expect(preferred(true)).toBeNull();
      expect(screen.queryByLabelText(en.admin.program.confirmLabel)).toBeNull();
      expect(fixture.readPolicy).not.toHaveBeenCalled();
      expect(fixture.readNext).not.toHaveBeenCalled();
      expect(fixture.privateChild).not.toHaveBeenCalled();
      expect(fixture.writePolicy).not.toHaveBeenCalled();
      expect(fixture.writeRefresh).not.toHaveBeenCalled();
    };
    expectPrivateSettingsAbsent();
    expect(screen.getByText(period.name)).toBeTruthy();
    expect(fixture.readAccount).toHaveBeenCalledTimes(1);
    expect(fixture.readPeriod).toHaveBeenCalledTimes(1);
    const initialErrorCount = client.getQueryState(accountKey())!.errorUpdateCount;
    expect(initialErrorCount).toBeGreaterThan(0);

    const retryLabel = en.managementRecovery.retry.replace(
      "{section}",
      en.admin.program.panels.period,
    );
    // The independent probes above establish the committed ordinary failure.
    // This first recovery assertion exposes the missing visible default-panel
    // branch without waiting for the desired UI to establish the failure.
    const retry = screen.getByRole<HTMLButtonElement>("button", {
      name: retryLabel,
    });
    expect(retry.disabled).toBe(false);
    expect(retry.type).toBe("button");
    expect(retry.closest("form")).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(fixture.readAccount).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const state = client.getQueryState(accountKey());
      expect(state?.errorUpdateCount).toBe(initialErrorCount + 1);
      expect(state?.fetchStatus).toBe("idle");
    });
    await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
    // Repeated failures have distinct synthetic messages, so an old committed
    // error/idle phase cannot satisfy the failed-Retry synchronization.
    await waitFor(() =>
      expect(screen.getByTestId("account-query-error").textContent).toBe(
        retryFailure.message,
      ),
    );
    expectPrivateSettingsAbsent();
    expect(screen.getByText(period.name)).toBeTruthy();
    expect(fixture.readPeriod).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: retryLabel }));
    await waitForPhase("account", "success");
    await screen.findByLabelText(en.profilePolicy.usePreferredNames, {
      selector: 'input[type="checkbox"]',
    });
    await waitFor(() => expect(fixture.readNext).toHaveBeenCalledTimes(1));
    expect(fixture.privateChild).toHaveBeenCalled();
    expect(screen.getByLabelText(en.admin.program.confirmLabel)).toBeTruthy();
    expect(screen.queryByRole("button", { name: retryLabel })).toBeNull();
    expect(fixture.readAccount).toHaveBeenCalledTimes(3);
    expect(fixture.readPeriod).toHaveBeenCalledTimes(1);
    expect(fixture.readPolicy).toHaveBeenCalledTimes(1);
    expect(fixture.writePolicy).not.toHaveBeenCalled();
    expect(fixture.writeRefresh).not.toHaveBeenCalled();
  },
);

it("retains the profile's pending mutation and rejected-write feedback through account failures", async () => {
  const { field } = await stageDraft();
  let rejectSave!: (cause: Error) => void;
  fixture.writePolicy.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectSave = reject;
      }),
  );
  expectedWrites = 1;
  fireEvent.submit(profileForm(field));
  await waitFor(() => expect(fixture.writePolicy).toHaveBeenCalledTimes(1));
  await screen.findByRole("button", { name: en.profilePolicy.saving });
  fixture.readAccount.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  await refreshRead(accountKey());
  await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
  expect(preferred()).toBe(field);
  expect(field.checked).toBe(false);
  fireEvent.submit(profileForm(field));
  await refreshRead(accountKey());
  await waitForPhase("account", "success");
  expect(
    screen.getByRole("button", { name: en.profilePolicy.saving }),
  ).toBeTruthy();
  expect(field.matches(":disabled")).toBe(true);
  fireEvent.submit(profileForm(field));
  await act(async () =>
    rejectSave(new Error("Synthetic retained write rejection")),
  );
  await screen.findByText("Synthetic retained write rejection");
  fixture.readAccount.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  await refreshRead(accountKey());
  await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
  await refreshRead(accountKey());
  await waitForPhase("account", "success");
  expect(preferred()).toBe(field);
  expect(field.checked).toBe(false);
  expect(screen.getByText("Synthetic retained write rejection")).toBeTruthy();
});

it("retains accepted-save feedback through account recovery without another write", async () => {
  const { field } = await stageDraft();
  fixture.writePolicy.mockResolvedValueOnce({
    ...policy,
    usePreferredNames: false,
  });
  expectedWrites = 1;
  fireEvent.submit(profileForm(field));
  await screen.findByText(en.profilePolicy.saved);
  await waitForPhase("account", "success");
  fixture.readAccount.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  await refreshRead(accountKey());
  await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
  expect(preferred()).toBe(field);
  expect(field.checked).toBe(false);
  expect(screen.getByText(en.profilePolicy.saved)).toBeTruthy();
  fireEvent.submit(profileForm(field));
  await refreshRead(accountKey());
  await waitForPhase("account", "success");
  expect(preferred()).toBe(field);
  expect(screen.getByText(en.profilePolicy.saved)).toBeTruthy();
});

it.each(["account", "period"] as const)(
  "retains an open actual refresh review and blocks its captured Confirm during %s recovery",
  async (prerequisite) => {
    const { field } = await stageDraft();
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.program.panels.period }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: en.scheduledRefresh.modeImmediate,
      }),
    );
    const confirmation = await screen.findByLabelText<HTMLInputElement>(
      en.admin.program.confirmLabel,
    );
    const confirmLabel = en.admin.program.refreshButton.replace(
      "{name}",
      nextRecruitment.nextName,
    );
    fireEvent.change(confirmation, { target: { value: "REFRESH" } });
    fireEvent.click(screen.getByRole("button", { name: confirmLabel }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: confirmLabel });

    const failingRead =
      prerequisite === "account" ? fixture.readAccount : fixture.readPeriod;
    const key = prerequisite === "account" ? accountKey() : periodKey();
    failingRead.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
    await refreshRead(key);
    await waitForPhase(prerequisite, "error", "INTERNAL_SERVER_ERROR");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(confirmation.value).toBe("REFRESH");
    expect(confirmation.matches(":disabled")).toBe(true);
    expect(preferred(true)).toBe(field);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain(
        en.nextRecruitment.loadFailed,
      ),
    );
    expect(fixture.writeRefresh).not.toHaveBeenCalled();

    // A background prerequisite recovery can complete while the review is open.
    // Do not simulate clicking behind a native modal to obtain that recovery.
    await refreshRead(key);
    await waitForPhase(prerequisite, "success");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(confirmation.value).toBe("REFRESH");
    expect(field.checked).toBe(false);
    expectedRefreshWrites = 1;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(fixture.writeRefresh).toHaveBeenCalledWith({
        confirm: "REFRESH",
        expectedTermId: period.termId,
        expectedPreparation: nextRecruitment.refreshEvidence,
      }),
    );
    await within(dialog).findByText("Synthetic rejected refresh");
  },
);

it("retains an accepted refresh receipt through account failure and retries synchronization without replaying the write", async () => {
  const { field } = await stageDraft();
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.program.panels.period }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: en.scheduledRefresh.modeImmediate,
    }),
  );
  const confirmation = await screen.findByLabelText<HTMLInputElement>(
    en.admin.program.confirmLabel,
  );
  const confirmLabel = en.admin.program.refreshButton.replace(
    "{name}",
    nextRecruitment.nextName,
  );
  fireEvent.change(confirmation, { target: { value: "REFRESH" } });
  fireEvent.click(screen.getByRole("button", { name: confirmLabel }));
  const dialog = screen.getByRole("dialog");
  fixture.writeRefresh.mockResolvedValueOnce({
    name: nextRecruitment.nextName,
    archivedTutees: 0,
    graduatedTutors: 0,
    agedTutors: 0,
    pendingTutors: 0,
  });
  fixture.readPeriod.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  expectedRefreshWrites = 1;
  fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));
  await within(dialog).findByText(en.actionReview.refreshFailed);
  await waitForPhase("period", "error", "INTERNAL_SERVER_ERROR");
  expect(fixture.writeRefresh).toHaveBeenCalledTimes(1);
  expect(
    within(dialog).queryByRole("button", { name: confirmLabel }),
  ).toBeNull();

  fixture.readAccount.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  await refreshRead(accountKey());
  await waitForPhase("account", "error", "INTERNAL_SERVER_ERROR");
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByText(en.actionReview.refreshFailed)).toBeTruthy();
  await refreshRead(accountKey());
  await waitForPhase("account", "success");
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(preferred(true)).toBe(field);
  expect(field.checked).toBe(false);

  fixture.readPeriod.mockRejectedValueOnce(readError("INTERNAL_SERVER_ERROR"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.actionReview.retry }),
  );
  await within(dialog).findByText(en.actionReview.refreshFailed);
  await waitForPhase("period", "error", "INTERNAL_SERVER_ERROR");
  expect(fixture.writeRefresh).toHaveBeenCalledTimes(1);

  const activated = {
    ...period,
    termId: "synthetic-next-term",
    name: period.next.name,
    quarter: "Q2",
    next: { name: "Synthetic third term", semester: 2 },
  };
  fixture.readPeriod.mockResolvedValue(activated);
  fixture.readNext.mockResolvedValue({
    ...nextRecruitment,
    target: { ...target, sourceTermId: activated.termId },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.actionReview.retry }),
  );
  await within(dialog).findByText(en.actionReview.applied);
  await waitForPhase("period", "success");
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(
    within(dialog).queryByRole("button", { name: en.actionReview.retry }),
  ).toBeNull();
  expect(confirmation.value).toBe("");
  expect(preferred(true)).toBe(field);
  expect(field.checked).toBe(false);
  expect(fixture.writeRefresh).toHaveBeenCalledTimes(1);
});
