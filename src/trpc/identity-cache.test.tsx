/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import messages from "../../messages/en.json";
import { TRPCReactProvider } from "./react";
import { retryQuery } from "./query-client";
import { sessionIdentity } from "~/lib/session-identity";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/approvals" }));
vi.mock("~/app/_components/approval-notice", () => ({
  ApprovalNotice: () => null,
}));
vi.mock("~/app/_components/save-notifications", () => ({
  NotificationViewport: ({ children }: { children: React.ReactNode }) =>
    children,
  SaveNotifications: () => null,
}));
afterEach(cleanup);

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
  for (const code of ["FORBIDDEN", "UNAUTHORIZED"]) {
    const error = TRPCClientError.from({
      error: { message: code, code: -32001, data: { code } },
    });
    expect(retryQuery(0, error)).toBe(false);
  }
  expect(retryQuery(0, new Error("Network disconnected"))).toBe(true);
  expect(retryQuery(2, new Error("Still disconnected"))).toBe(false);
});
