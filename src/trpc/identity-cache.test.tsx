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
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import messages from "../../messages/en.json";
import { TRPCReactProvider } from "./react";
import { retryQuery } from "./query-client";
import { sessionIdentity } from "~/lib/session-identity";

const route = vi.hoisted(() => ({ pathname: "/admin/approvals" }));
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () =>
      useSyncExternalStore(
        (callback) => {
          window.addEventListener("test-route", callback);
          return () => window.removeEventListener("test-route", callback);
        },
        () => route.pathname,
      ),
  };
});
function navigate(pathname: string) {
  route.pathname = pathname;
  fireEvent(window, new Event("test-route"));
}
vi.mock("~/app/_components/approval-notice", () => ({
  ApprovalNotice: () => null,
}));
vi.mock("~/app/_components/save-notifications", () => ({
  NotificationViewport: ({ children }: { children: React.ReactNode }) =>
    children,
  SaveNotifications: () => null,
}));
beforeEach(() => {
  route.pathname = "/admin/approvals";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Probe() {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ["private"],
    queryFn: () => "network",
    enabled: false,
  });
  return (
    <>
      <p>{data.data ?? "No previous data"}</p>
      <button
        onClick={() =>
          client.setQueryData(["private"], "Previous account private rows")
        }
      >
        Cache
      </button>
    </>
  );
}
function view(id: string, role: string) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <TRPCReactProvider
        identity={sessionIdentity({ user: { id }, role, tutorId: null })}
      >
        <Probe />
      </TRPCReactProvider>
    </NextIntlClientProvider>
  );
}
it("replaces identity-dependent queries on account changes and same-account role changes", async () => {
  const rendered = render(view("head", "HEAD"));
  fireEvent.click(screen.getByRole("button", { name: "Cache" }));
  await screen.findByText("Previous account private rows");
  rendered.rerender(view("coordinator", "COORDINATOR"));
  expect(screen.getByText("No previous data")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cache" }));
  await screen.findByText("Previous account private rows");
  rendered.rerender(view("coordinator", "ADMIN"));
  expect(screen.getByText("No previous data")).toBeTruthy();
});

it("does not retry forbidden/unauthenticated calls, but permits bounded transient recovery", () => {
  for (const code of ["FORBIDDEN", "UNAUTHORIZED", "PRECONDITION_FAILED"]) {
    const error = TRPCClientError.from({
      error: { message: code, code: -32001, data: { code } },
    });
    expect(retryQuery(0, error)).toBe(false);
  }
  expect(retryQuery(0, new Error("Network disconnected"))).toBe(true);
  expect(retryQuery(2, new Error("Still disconnected"))).toBe(false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const identity = "synthetic-head";
const response = (value = identity) =>
  ({ ok: true, json: async () => ({ identity: value }) }) as Response;
function backgroundView(
  queryFn: () => Promise<string>,
  capture: (client: QueryClient) => void,
  staleTime = 0,
) {
  function Background() {
    const client = useQueryClient();
    capture(client);
    const query = useQuery({
      queryKey: ["background"],
      queryFn,
      staleTime,
      initialData: "Cached rows",
      retryDelay: 1,
    });
    return (
      <>
        <p>{query.data}</p>
        <input aria-label="Draft" defaultValue="Initial draft" />
      </>
    );
  }
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <TRPCReactProvider identity={identity}>
        <Background />
      </TRPCReactProvider>
    </NextIntlClientProvider>
  );
}
function contentVisible() {
  const field = screen.getByRole("textbox", { name: "Draft", hidden: true });
  return (
    field.closest("[style]")?.getAttribute("style") === "display: contents;"
  );
}
it("restores mounted edits as soon as identity is verified, while an unrelated query stays pending", async () => {
  const session = deferred<Response>();
  const slow = deferred<string>();
  const fetcher = vi.fn().mockReturnValue(session.promise);
  vi.stubGlobal("fetch", fetcher);
  const query = vi.fn().mockReturnValue(slow.promise);
  const ui = backgroundView(query, () => undefined);
  render(ui);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Unsaved edit" },
  });
  navigate("/admin/policies");
  expect(contentVisible()).toBe(false);
  expect(screen.getByRole("status").textContent).toBe(messages.common.loading);
  await act(async () => session.resolve(response()));
  expect(contentVisible()).toBe(true);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe(
    "Unsaved edit",
  );
  expect(query).toHaveBeenCalledTimes(1);
  await act(async () => slow.resolve("Updated rows"));
  await screen.findByText("Updated rows");
});
it("shares checks across rapid routes, focus and visibility and never aborts the restoring request", async () => {
  const session = deferred<Response>();
  const fetcher = vi.fn().mockReturnValue(session.promise);
  vi.stubGlobal("fetch", fetcher);
  const ui = backgroundView(
    async () => "Fresh rows",
    () => undefined,
    Infinity,
  );
  render(ui);
  fireEvent(window, new Event("focus"));
  navigate("/admin/policies");
  navigate("/admin/activity");
  fireEvent(document, new Event("visibilitychange"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((fetcher.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(
    false,
  );
  await act(async () => session.resolve(response()));
  expect(contentVisible()).toBe(true);
});
it("does not refetch fresh data on navigation or focus", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  const query = vi.fn().mockResolvedValue("Refetched");
  const ui = backgroundView(query, () => undefined, Infinity);
  render(ui);
  await act(async () => {
    fireEvent(window, new Event("focus"));
  });
  expect(query).not.toHaveBeenCalled();
  expect(contentVisible()).toBe(true);
});
it.each(["precondition", "transient"])(
  "does not wait for %s query failures and applies the appropriate retry budget",
  async (kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    const failure =
      kind === "precondition"
        ? TRPCClientError.from({
            error: {
              message: "Missing publication",
              code: -32012,
              data: { code: "PRECONDITION_FAILED" },
            },
          })
        : new Error("Temporary network error");
    const pending = deferred<string>();
    const query = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValue(failure);
    render(backgroundView(query, () => undefined));
    await act(async () => {
      fireEvent(window, new Event("focus"));
    });
    expect(contentVisible()).toBe(true);
    await act(async () => pending.reject(failure));
    await waitFor(() =>
      expect(query).toHaveBeenCalledTimes(kind === "precondition" ? 1 : 3),
    );
    expect(contentVisible()).toBe(true);
  },
);
it.each([
  "other-account",
  "same-account-new-role",
  "anonymous",
  "failed",
  "malformed",
])(
  "discards private cache and keeps it hidden on %s verification",
  async (result) => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    let client!: QueryClient;
    render(
      backgroundView(
        async () => "Private rows",
        (value) => {
          client = value;
        },
        Infinity,
      ),
    );
    fireEvent(window, new Event("focus"));
    await act(async () => {
      if (result === "failed") pending.reject(new Error("Session unavailable"));
      else if (result === "malformed")
        pending.resolve({
          ok: true,
          json: async () => ({ identity: 42 }),
        } as Response);
      else pending.resolve(response(result));
    });
    expect(client.getQueryData(["background"])).toBeUndefined();
    expect(contentVisible()).toBe(false);
  },
);
it("aborts unmounted identity checks and ignores late responses", async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn().mockReturnValue(pending.promise);
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    backgroundView(
      async () => "Old rows",
      () => undefined,
    ),
  );
  fireEvent(window, new Event("focus"));
  view.unmount();
  expect((fetcher.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
  render(
    backgroundView(
      async () => "New rows",
      () => undefined,
      Infinity,
    ),
  );
  await act(async () => pending.resolve(response("other-account")));
  expect(contentVisible()).toBe(true);
});
