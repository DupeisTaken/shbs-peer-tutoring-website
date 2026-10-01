/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import PatrolPage from "./page";

const state = vi.hoisted(() => ({ hours: 0 }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ crew: { myStatus: { invalidate: vi.fn() } } }),
  crew: {
    myStatus: { useQuery: () => ({ data: { status: "ACTIVE", pendingRequest: null } }) },
    patrolConfig: { useQuery: () => ({ data: { rooms: [], myHours: 0.5, myPatrols: 2 } }) },
    myPatrols: { useQuery: () => ({ data: [] }) },
    requestOptOut: { useMutation: () => ({ mutate: vi.fn() }) },
    recallOptOut: { useMutation: () => ({ mutate: vi.fn() }) },
    requestReentry: { useMutation: () => ({ mutate: vi.fn() }) },
    submitPatrol: { useMutation: () => ({ isSuccess: true, data: { hours: state.hours }, mutate: vi.fn() }) },
  },
} }));
afterEach(cleanup);
const show = () => render(<NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={messages}><PatrolPage /></NextIntlClientProvider>);

it("announces that evidence was saved without claiming zero-hour submissions earned credit", () => {
  state.hours = 0; show();
  expect(screen.getByRole("status").textContent).toMatch(/saved with no additional hours/);
  expect(screen.getByRole("status").textContent).toMatch(/20-minute allowance/);
  expect(screen.getByText(/all observations from the last 20 minutes/)).toBeTruthy();
});
it("keeps the ordinary success confirmation for an awarded sweep", () => {
  state.hours = 0.5; show();
  expect(screen.getByRole("status").textContent).toBe("Patrol recorded.");
});
