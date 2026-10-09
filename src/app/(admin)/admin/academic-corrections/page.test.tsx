import { beforeEach, expect, it, vi } from "vitest";
import AcademicCorrectionsPage from "./page";
const mocks = vi.hoisted(() => ({ user: vi.fn(), auth: vi.fn() }));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: { user: { findUnique: mocks.user } } }));
vi.mock("~/app/_components/historical-academic-corrections", () => ({ HistoricalAcademicCorrections: () => null }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "caller" } }); });
it.each(["HEAD", "ADMIN"])("allows %s historical corrections with the matching apply/request workflow", async (role) => {
  mocks.user.mockResolvedValue({ role, suspendedAt: null });
  const page = await AcademicCorrectionsPage({ searchParams: Promise.resolve({}) });
  expect(page).toMatchObject({ props: { coordinator: role === "ADMIN" } });
});
it("blocks Coordinator historical correction submission at the route", async () => {
  mocks.user.mockResolvedValue({ role: "COORDINATOR", suspendedAt: null });
  await expect(AcademicCorrectionsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/admin");
});
