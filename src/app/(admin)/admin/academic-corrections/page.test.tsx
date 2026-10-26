import { beforeEach, expect, it, vi } from "vitest";
import AcademicCorrectionsPage from "./page";
const mocks = vi.hoisted(() => ({ user: vi.fn(), auth: vi.fn() }));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: { user: { findUnique: mocks.user } } }));
vi.mock("~/app/_components/historical-academic-corrections", () => ({ HistoricalAcademicCorrections: () => null }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "caller" } }); });
it.each(["HEAD", "ADMIN", "COORDINATOR"])("allows %s historical corrections with the matching apply/request workflow", async (role) => {
  mocks.user.mockResolvedValue({ role, suspendedAt: null });
  const page = await AcademicCorrectionsPage({ searchParams: Promise.resolve({}) });
  expect(page).toMatchObject({ props: { coordinator: role === "COORDINATOR" } });
});
it.each(["VIEWER", "TUTOR", "STUDENT", "TRANSLATOR"])("blocks %s from private historical corrections", async (role) => {
  mocks.user.mockResolvedValue({ role, suspendedAt: null });
  await expect(AcademicCorrectionsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/admin");
});
it.each(["HEAD", "ADMIN", "COORDINATOR"])("blocks suspended %s despite the stored management rank", async (role) => {
  mocks.user.mockResolvedValue({ role, suspendedAt: new Date("2026-10-01") });
  await expect(AcademicCorrectionsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/admin");
});
