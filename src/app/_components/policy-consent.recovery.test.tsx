// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const fixture = vi.hoisted(() => ({
  failure: null as Error | null,
  missing: false,
  accepted: false,
  reads: vi.fn(),
  accept: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    api: {
      student: {
        policy: {
          useQuery: ({ slug }: { slug: string }) =>
            useQuery({
              queryKey: ["policy-recovery", slug],
              queryFn: async () => {
                fixture.reads();
                if (fixture.failure) throw fixture.failure;
                if (fixture.missing) return null;
                return {
                  accepted: fixture.accepted,
                  revision: "synthetic-policy-revision-v2",
                  documents: [
                    {
                      locale: "en",
                      title: "Synthetic policy",
                      body: "Published English policy.",
                      version: "v2",
                    },
                    {
                      locale: "zh",
                      title: "示例政策",
                      body: "已发布的中文政策。",
                      version: "v2",
                    },
                  ],
                };
              },
              retry: false,
            }),
        },
        acceptPolicy: {
          useMutation: () => ({
            mutate: fixture.accept,
            mutateAsync: fixture.accept,
            isPending: false,
          }),
        },
      },
      studentWorkflow: {
        prepareAction: {
          useMutation: () => ({ mutateAsync: fixture.prepare }),
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

it("retains the signature across a cached failure and locale change without accepting or preparing a ticket", async () => {
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
  fireEvent.click(
    screen.getByRole("button", { name: zh.workflow.policyRefresh }),
  );
  const signature = await screen.findByRole<HTMLInputElement>("textbox", {
    name: zh.workflows.signature,
  });
  expect(signature.value).toBe("Synthetic signer");
  expect(screen.getByText("已发布的中文政策。")).toBeTruthy();
  expect(fixture.accept).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled();
  fireEvent.submit(signature.closest("form")!);
  expect(fixture.accept).toHaveBeenCalledExactlyOnceWith({
    slug: "tutor-policy",
    revision: "synthetic-policy-revision-v2",
    signature: "Synthetic signer",
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
