// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
import type { ConfirmationTicket } from "~/lib/confirmation-timing";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const fixture = vi.hoisted(() => ({
  failure: null as Error | null,
  missing: false,
  accepted: false,
  revision: "synthetic-policy-revision-v2",
  version: "v2",
  chineseBody: "已发布的中文政策。",
  pendingRead: null as Promise<void> | null,
  reads: vi.fn(),
  accept: vi.fn(),
  prepare:
    vi.fn<
      (input: { action: string; target: string }) => Promise<ConfirmationTicket>
    >(),
  cancelTicket: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      student: {
        policy: {
          useQuery: ({ slug }: { slug: string }) =>
            useQuery({
              queryKey: ["policy-recovery", slug],
              queryFn: async () => {
                fixture.reads();
                await fixture.pendingRead;
                if (fixture.failure) throw fixture.failure;
                if (fixture.missing) return null;
                return {
                  accepted: fixture.accepted,
                  revision: fixture.revision,
                  documents: [
                    {
                      locale: "en",
                      title: "Synthetic policy",
                      body: "Published English policy.",
                      version: fixture.version,
                    },
                    {
                      locale: "zh",
                      title: "示例政策",
                      body: fixture.chineseBody,
                      version: fixture.version,
                    },
                  ],
                };
              },
              retry: false,
            }),
        },
        acceptPolicy: {
          useMutation: (options: { onSuccess: () => unknown }) =>
            useMutation({
              mutationFn: async (input: {
                slug: "tutor-policy" | "tutee-policy";
                revision: string;
                signature: string;
                ticket?: string;
              }) => {
                await fixture.accept(input);
              },
              onSuccess: options.onSuccess,
            }),
        },
      },
      studentWorkflow: {
        prepareAction: {
          useMutation: () => ({ mutateAsync: fixture.prepare }),
        },
        cancelAction: {
          useMutation: () => ({ mutate: fixture.cancelTicket }),
        },
      },
    },
  };
});
import { PolicyConsent } from "./policy-consent";

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.failure = null;
  fixture.missing = false;
  fixture.accepted = false;
  fixture.revision = "synthetic-policy-revision-v2";
  fixture.version = "v2";
  fixture.chineseBody = "已发布的中文政策。";
  fixture.pendingRead = null;
  fixture.accept.mockResolvedValue(undefined);
  fixture.prepare.mockImplementation(async () =>
    policyTicket(
      `synthetic-policy-ticket-${fixture.prepare.mock.calls.length}`,
    ),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
const subject = (
  slug: "tutor-policy" | "tutee-policy" = "tutor-policy",
  locale = "en",
  children?: React.ReactNode,
) => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "zh" ? zh : en}
    >
      <PolicyConsent slug={slug}>{children}</PolicyConsent>
    </NextIntlClientProvider>
  </QueryClientProvider>
);
const policyTicket = (id: string): ConfirmationTicket => ({
  id,
  serverNow: new Date(),
  readyAt: new Date(Date.now() + 5_000),
  expiresAt: new Date(Date.now() + 30 * 60_000),
});

it.each(["tutor-policy", "tutee-policy"] as const)(
  "an initially unavailable %s offers local read-only Retry without consent or action preparation",
  async (slug) => {
    // Preserve the original initial-read regression at the actual consent caller.
    fixture.failure = new Error("Synthetic initial policy read failed");
    render(subject(slug));
    await screen.findByRole("alert");
    const reads = fixture.reads.mock.calls.length;
    fixture.failure = null;
    fireEvent.click(
      screen.getByRole("button", { name: en.workflow.policyRefresh }),
    );
    await screen.findByRole("textbox", { name: en.workflows.signature });
    expect(fixture.reads.mock.calls.length).toBe(reads + 1);
    expect(fixture.accept).not.toHaveBeenCalled();
    expect(fixture.prepare).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("retains the signature across a cached failure and locale change, then explicitly accepts the recovered revision", async () => {
  const view = render(subject());
  fireEvent.change(
    await screen.findByRole("textbox", { name: en.workflows.signature }),
    { target: { value: "Synthetic signer" } },
  );
  fixture.failure = new Error("Synthetic cached policy read failed");
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["policy-recovery"] });
  });
  await screen.findByRole("alert");
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(subject("tutor-policy", "zh"));
  fixture.failure = null;
  fixture.revision = "synthetic-policy-revision-v3";
  fixture.version = "v3";
  fixture.chineseBody = "更新后的中文政策。";
  fireEvent.click(
    screen.getByRole("button", { name: zh.workflow.policyRefresh }),
  );
  const signature = await screen.findByRole<HTMLInputElement>("textbox", {
    name: zh.workflows.signature,
  });
  expect(signature.value).toBe("Synthetic signer");
  expect(screen.getByText("更新后的中文政策。")).toBeTruthy();
  expect(fixture.accept).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled();
  fireEvent.submit(signature.closest("form")!);
  await waitFor(() => {
    expect(fixture.accept).toHaveBeenCalledExactlyOnceWith({
      slug: "tutor-policy",
      revision: "synthetic-policy-revision-v3",
      signature: "Synthetic signer",
    });
  });
});

it("does not expose cached accepted-only children during read failure and restores them through reads", async () => {
  fixture.accepted = true;
  render(subject("tutor-policy", "en", <p>Accepted-only participation</p>));
  await screen.findByText("Accepted-only participation");
  fixture.failure = new Error("Synthetic accepted policy refresh failed");
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["policy-recovery"] });
  });
  await screen.findByRole("alert");
  expect(screen.queryByText("Accepted-only participation")).toBeNull();
  fixture.failure = null;
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.policyRefresh }),
  );
  await screen.findByText("Accepted-only participation");
  expect(fixture.accept).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled();
});

it("recovers a null policy result rather than leaving an indefinite loading message", async () => {
  fixture.missing = true;
  render(subject());
  await screen.findByRole("alert");
  expect(screen.queryByRole("textbox")).toBeNull();
  fixture.missing = false;
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.policyRefresh }),
  );
  await screen.findByRole("textbox");
  expect(fixture.accept).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled();
});

it("disables local Refresh during a cached recovery read without exposing stale participation", async () => {
  fixture.accepted = true;
  render(subject("tutor-policy", "en", <p>Accepted-only participation</p>));
  await screen.findByText("Accepted-only participation");
  fixture.failure = new Error("Synthetic cached policy read failed");
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["policy-recovery"] });
  });
  const refresh = await screen.findByRole<HTMLButtonElement>("button", {
    name: en.workflow.policyRefresh,
  });
  let releaseRead!: () => void;
  fixture.pendingRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  fixture.failure = null;
  const reads = fixture.reads.mock.calls.length;
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh.disabled).toBe(true));
  fireEvent.click(refresh);
  expect(fixture.reads.mock.calls.length).toBe(reads + 1);
  expect(screen.queryByText("Accepted-only participation")).toBeNull();
  expect(fixture.accept).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled();
  releaseRead();
  await screen.findByText("Accepted-only participation");
});

it("keeps denied policy reads explicit and hides acceptance until an authorized read succeeds", async () => {
  fixture.failure = Object.assign(new Error("Synthetic policy access denied"), {
    data: { code: "FORBIDDEN" },
  });
  render(subject());
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Synthetic policy access denied",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.workflows.accept }),
  ).toBeNull();
  fixture.failure = null;
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.policyRefresh }),
  );
  await screen.findByRole("textbox");
  expect(fixture.accept).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled();
});

it("recovers failed synchronization after an accepted signature through reads without submitting again", async () => {
  fixture.accept.mockImplementationOnce(async () => {
    fixture.accepted = true;
    fixture.failure = new Error("Synthetic post-acceptance read failed");
  });
  render(subject("tutor-policy", "en", <p>Accepted-only participation</p>));
  const signature = await screen.findByRole("textbox", {
    name: en.workflows.signature,
  });
  fireEvent.change(signature, { target: { value: "Synthetic signer" } });
  fireEvent.submit(signature.closest("form")!);
  await screen.findByRole("alert");
  expect(fixture.accept).toHaveBeenCalledExactlyOnceWith({
    slug: "tutor-policy",
    revision: "synthetic-policy-revision-v2",
    signature: "Synthetic signer",
  });
  expect(screen.queryByText("Accepted-only participation")).toBeNull();
  fixture.failure = null;
  fireEvent.click(
    screen.getByRole("button", { name: en.workflow.policyRefresh }),
  );
  await screen.findByText("Accepted-only participation");
  expect(fixture.accept).toHaveBeenCalledOnce();
  expect(fixture.prepare).not.toHaveBeenCalled();
});

it.each(["failed", "missing"] as const)(
  "keeps the reader open and conceals accepted content through a %s cached read and local recovery",
  async (result) => {
    fixture.accepted = true;
    render(subject());
    fireEvent.click(
      await screen.findByRole("button", { name: "current policy" }),
    );
    await screen.findByText("Published English policy.");
    const originalReader = screen.getByRole("dialog");
    if (result === "failed")
      fixture.failure = new Error("Synthetic open-reader refresh failed");
    else fixture.missing = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["policy-recovery"] });
    });
    await screen.findByRole("alert");
    const reader = screen.getByRole("dialog");
    expect(reader).toBe(originalReader);
    expect(within(reader).getByRole("alert").textContent).toBe(
      en.workflow.policyLoadError,
    );
    expect(screen.queryByText("Published English policy.")).toBeNull();
    expect(screen.queryByRole("button", { name: "current policy" })).toBeNull();
    fixture.failure = null;
    fixture.missing = false;
    fireEvent.click(
      within(reader).getByRole("button", { name: en.workflow.policyRefresh }),
    );
    const restoredReader = await screen.findByRole("dialog", {
      name: "Synthetic policy",
    });
    expect(restoredReader).toBe(originalReader);
    expect(
      within(restoredReader).getByText("Published English policy."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "current policy" })).toBeTruthy();
    expect(fixture.accept).not.toHaveBeenCalled();
    expect(fixture.prepare).not.toHaveBeenCalled();
  },
);

it.each([
  { result: "failed", preparation: "ready" },
  { result: "missing", preparation: "ready" },
  { result: "failed", preparation: "pending" },
  { result: "missing", preparation: "pending" },
] as const)(
  "retires $preparation tutee confirmation after a $result read; Refresh prepares nothing until explicit resubmission",
  async ({ result, preparation }) => {
    let finishPreparation!: (ticket: ConfirmationTicket) => void;
    if (preparation === "pending")
      fixture.prepare.mockReturnValueOnce(
        new Promise<ConfirmationTicket>((resolve) => {
          finishPreparation = resolve;
        }),
      );
    render(subject("tutee-policy"));
    const signature = await screen.findByRole("textbox", {
      name: en.workflows.signature,
    });
    fireEvent.change(signature, { target: { value: "Synthetic signer" } });
    fireEvent.submit(signature.closest("form")!);
    await waitFor(() =>
      expect(fixture.prepare).toHaveBeenCalledExactlyOnceWith({
        action: "POLICY",
        target: "synthetic-policy-revision-v2",
      }),
    );
    if (preparation === "ready")
      await screen.findByRole("button", { name: "Confirm in 5s" });
    if (result === "failed")
      fixture.failure = new Error("Synthetic tutee confirmation read failed");
    else fixture.missing = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["policy-recovery"] });
    });
    await screen.findByRole("alert");
    expect(screen.queryByRole("dialog")).toBeNull();
    if (preparation === "pending")
      await act(async () => {
        finishPreparation(policyTicket("synthetic-policy-ticket-1"));
      });
    await waitFor(() =>
      expect(fixture.cancelTicket).toHaveBeenCalledExactlyOnceWith({
        ticket: "synthetic-policy-ticket-1",
      }),
    );
    fixture.failure = null;
    fixture.missing = false;
    fireEvent.click(
      screen.getByRole("button", { name: en.workflow.policyRefresh }),
    );
    const restoredSignature = await screen.findByRole<HTMLInputElement>(
      "textbox",
      { name: en.workflows.signature },
    );
    expect(restoredSignature.value).toBe("Synthetic signer");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.prepare).toHaveBeenCalledOnce();
    expect(fixture.cancelTicket).toHaveBeenCalledOnce();
    expect(fixture.accept).not.toHaveBeenCalled();
    fireEvent.submit(restoredSignature.closest("form")!);
    await waitFor(() => expect(fixture.prepare).toHaveBeenCalledTimes(2));
    expect(fixture.prepare).toHaveBeenLastCalledWith({
      action: "POLICY",
      target: "synthetic-policy-revision-v2",
    });
    expect(fixture.accept).not.toHaveBeenCalled();
  },
);
