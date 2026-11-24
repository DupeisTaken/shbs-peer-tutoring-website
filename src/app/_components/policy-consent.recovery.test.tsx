/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
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
import { PolicyConsent } from "./policy-consent";

const sampleDocuments = [
  {
    locale: "en",
    title: "Tutor policy",
    body: "## Published rules\nEnglish policy.",
    version: "v2",
  },
  {
    locale: "zh",
    title: "朋辈导师守则",
    body: "## 已发布的规则\n中文守则。",
    version: "v2",
  },
];

const state = vi.hoisted(() => ({
  policyFn: vi.fn<(input: { slug: string }) => Promise<unknown>>(),
  acceptMutate: vi.fn(),
  acceptMutateAsync: vi.fn(),
  acceptOpts: undefined as
    | undefined
    | {
        onSuccess?: (
          result: unknown,
          variables: { revision: string },
        ) => unknown;
      },
  prepareAction: vi.fn(),
}));

let queryClient: QueryClient;

vi.mock("./timed-action-dialog", () => ({
  TimedActionDialog: ({
    title,
    onCancel,
    onConfirm,
  }: {
    title: string;
    onCancel: () => void;
    onConfirm: (ticket: string) => void;
  }) => {
    useEffect(() => {
      state.prepareAction();
    }, []);
    return (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={() => onConfirm("ticket-1")}>
          Confirm ticket
        </button>
        <button type="button" onClick={onCancel}>
          Cancel dialog
        </button>
      </div>
    );
  },
}));

vi.mock("~/trpc/react", () => ({
  api: {
    student: {
      policy: {
        useQuery: (input: { slug: string }, options?: { enabled?: boolean }) =>
          useQuery({
            queryKey: [["student", "policy"], { input, type: "query" }],
            queryFn: () => state.policyFn(input),
            enabled: options?.enabled !== false,
          }),
      },
      acceptPolicy: {
        useMutation: (opts: typeof state.acceptOpts) => {
          state.acceptOpts = opts;
          return {
            mutate: state.acceptMutate,
            mutateAsync: state.acceptMutateAsync,
            isPending: false,
            error: null,
          };
        },
      },
    },
  },
}));

function renderConsent(
  slug: "tutor-policy" | "tutee-policy" = "tutor-policy",
  locale: "en" | "zh" = "en",
  children?: React.ReactNode,
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="UTC"
      >
        <PolicyConsent slug={slug}>{children}</PolicyConsent>
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
  state.policyFn.mockResolvedValue({
    accepted: false,
    revision: "v2",
    documents: sampleDocuments,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("exposes read-only Refresh on initial policy failure and null response without calling acceptPolicy or preparing a ticket (#646)", async () => {
  state.policyFn.mockRejectedValueOnce(new Error("Policy service down"));
  renderConsent("tutor-policy", "en", <p>Acceptance-gated dashboard</p>);

  await waitFor(() =>
    expect(screen.getByText(en.workflow.policyLoadError)).toBeTruthy(),
  );
  expect(screen.getByText("Policy service down")).toBeTruthy();
  expect(screen.queryByText("Acceptance-gated dashboard")).toBeNull();

  // Refresh returns null -> still shows read-only Refresh recovery.
  state.policyFn.mockResolvedValueOnce(null);
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.policyRefresh }),
  );
  await waitFor(() => expect(state.policyFn).toHaveBeenCalledTimes(2));
  expect(screen.getByText(en.workflow.policyLoadError)).toBeTruthy();
  expect(screen.queryByText("Acceptance-gated dashboard")).toBeNull();

  // Refresh succeeds -> displays policy form without calling acceptPolicy or preparing action tickets.
  state.policyFn.mockResolvedValueOnce({
    accepted: false,
    revision: "v2",
    documents: sampleDocuments,
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.policyRefresh }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(en.workflows.signature)).toBeTruthy(),
  );
  expect(state.acceptMutate).not.toHaveBeenCalled();
  expect(state.acceptMutateAsync).not.toHaveBeenCalled();
  expect(state.prepareAction).not.toHaveBeenCalled();
});

it("preserves typed signature across cached read errors, retires open timed confirmation, and conceals acceptance-gated children (#646)", async () => {
  renderConsent("tutee-policy", "en", <p>Acceptance-gated dashboard</p>);
  await waitFor(() =>
    expect(screen.getByLabelText(en.workflows.signature)).toBeTruthy(),
  );

  fireEvent.change(screen.getByLabelText(en.workflows.signature), {
    target: { value: "Sam Student" },
  });
  fireEvent.click(screen.getByRole("button", { name: en.workflows.accept }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(state.prepareAction).toHaveBeenCalledTimes(1);

  // Subsequent read failure retires the timed confirmation dialog and conceals children.
  state.policyFn.mockRejectedValueOnce(new Error("Transient read error"));
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: [["student", "policy"]] });
  });
  await waitFor(() =>
    expect(screen.getByText(en.workflow.policyLoadError)).toBeTruthy(),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Acceptance-gated dashboard")).toBeNull();

  // Read-only Refresh recovers the form WITH the typed signature preserved and WITHOUT preparing a replacement ticket.
  state.policyFn.mockResolvedValueOnce({
    accepted: false,
    revision: "v2",
    documents: sampleDocuments,
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.policyRefresh }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLInputElement>(en.workflows.signature).value,
    ).toBe("Sam Student"),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.prepareAction).toHaveBeenCalledTimes(1);
});

it("conceals cached policy content on FORBIDDEN denial and recovers only after a fresh read (#646)", async () => {
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  state.policyFn.mockResolvedValueOnce({
    accepted: true,
    revision: "v2",
    documents: sampleDocuments,
  });
  renderConsent("tutor-policy", "zh", <p>Signed-in tutor area</p>);
  await waitFor(() =>
    expect(screen.getByText("Signed-in tutor area")).toBeTruthy(),
  );

  now = Date.UTC(2026, 10, 9, 12, 0);
  state.policyFn.mockRejectedValueOnce(
    Object.assign(new Error("Forbidden"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: [["student", "policy"]] });
  });
  await waitFor(() =>
    expect(screen.getByText(zh.workflow.policyLoadError)).toBeTruthy(),
  );
  expect(screen.queryByText("Signed-in tutor area")).toBeNull();

  // Transport error keeps denial latched.
  state.policyFn.mockRejectedValueOnce(new Error("Offline"));
  fireEvent.click(
    screen.getByRole("button", { name: zh.workflow.policyRefresh }),
  );
  await waitFor(() => expect(state.policyFn).toHaveBeenCalledTimes(3));
  expect(screen.queryByText("Signed-in tutor area")).toBeNull();

  // Fresh authorized read under backward clock skew recovers.
  now = Date.UTC(2026, 10, 9, 11, 50);
  state.policyFn.mockResolvedValueOnce({
    accepted: true,
    revision: "v2",
    documents: sampleDocuments,
  });
  fireEvent.click(
    screen.getByRole("button", { name: zh.workflow.policyRefresh }),
  );
  await waitFor(() =>
    expect(screen.getByText("Signed-in tutor area")).toBeTruthy(),
  );
});

it("does not replay acceptPolicy when post-accept refresh fails and user clicks Refresh (#646)", async () => {
  renderConsent("tutor-policy");
  await waitFor(() =>
    expect(screen.getByLabelText(en.workflows.signature)).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText(en.workflows.signature), {
    target: { value: "Taylor Tutor" },
  });

  // Accept succeeds, then the immediate refetch fails.
  state.policyFn.mockRejectedValueOnce(new Error("Refresh timeout"));
  state.acceptMutate.mockImplementationOnce((vars: { revision: string }) => {
    void state.acceptOpts?.onSuccess?.({ ok: true }, vars);
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.workflows.accept }));
  });
  await waitFor(() =>
    expect(screen.getByText(en.workflow.policyLoadError)).toBeTruthy(),
  );
  expect(state.acceptMutate).toHaveBeenCalledTimes(1);

  // Refresh reads accepted status without replaying acceptPolicy.
  state.policyFn.mockResolvedValueOnce({
    accepted: true,
    revision: "v2",
    documents: sampleDocuments,
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.policyRefresh }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "current policy" })).toBeTruthy(),
  );
  expect(state.acceptMutate).toHaveBeenCalledTimes(1);
});
