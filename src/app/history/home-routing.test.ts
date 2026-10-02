import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  studentId: null as string | null,
  tuteeMember: false,
}));
vi.mock("~/server/auth", () => ({
  auth: async () => ({ user: { id: "alumni" }, role: "STUDENT" }),
}));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: async () => ({ ...state, suspendedAt: null }) } },
}));
vi.mock("~/app/_components/landing-view", () => ({ LandingView: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(destination);
  },
}));
import Home from "../page";
it.each([
  [null, false, "/history"],
  ["current", false, "/student"],
  [null, true, "/student"],
] as const)(
  "routes studentId=%s membership=%s to %s",
  async (studentId, tuteeMember, destination) => {
    Object.assign(state, { studentId, tuteeMember });
    await expect(Home()).rejects.toThrow(destination);
  },
);
