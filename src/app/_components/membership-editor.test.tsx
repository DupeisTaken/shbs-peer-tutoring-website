// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { MembershipEditor } from "./membership-editor";
import type { AccountMembership } from "~/lib/account-membership";

const mocks = vi.hoisted(() => ({ save: vi.fn(), request: vi.fn(), transfer: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ admin: { accounts: { invalidate: vi.fn() } }, account: { me: { invalidate: vi.fn() } } }),
  admin: { setMemberships: { useMutation: () => ({ mutate: mocks.save }) }, transferHead: { useMutation: () => ({ mutate: mocks.transfer }) } },
  account: { requestMemberships: { useMutation: () => ({ mutate: mocks.request }) } },
} }));
const base: AccountMembership = { rank: "NONE", viewer: false, tutor: false, tutee: false, translator: false, crew: false };
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
function show(props: Partial<React.ComponentProps<typeof MembershipEditor>> = {}) {
  return render(<NextIntlClientProvider locale="en" messages={messages}><MembershipEditor userId="account" initial={base} {...props} /></NextIntlClientProvider>);
}
it("submits participant badge requests without a direct grant", () => {
  show({ selfService: true });
  fireEvent.click(screen.getByLabelText("Translator"));
  fireEvent.click(screen.getByRole("button", { name: "Request Head approval" }));
  expect(mocks.request).toHaveBeenCalledWith({ ...base, translator: true });
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Confirm your password")).toBeNull();
});
it("keeps Viewer conflicts visible and blocks submission", () => {
  show();
  fireEvent.click(screen.getByLabelText("Viewer"));
  fireEvent.click(screen.getByLabelText("Crew"));
  expect(screen.getByRole("alert").textContent).toContain("Viewer cannot");
  expect((screen.getByRole<HTMLButtonElement>("button", { name: "Request Head approval" })).disabled).toBe(true);
});
it("requires identity confirmation and an explicit transfer confirmation for Head", () => {
  show({ isHead: true, initial: { ...base, rank: "ADMIN" } });
  expect((screen.getByRole<HTMLButtonElement>("button", { name: "Apply badge changes" })).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Confirm your password"), { target: { value: "Synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Make Head" }));
  expect(mocks.transfer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm leadership transfer" }));
  expect(mocks.transfer).toHaveBeenCalledWith({ userId: "account", confirmPassword: "Synthetic-password" });
});
