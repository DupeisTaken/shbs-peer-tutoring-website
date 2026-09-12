import { beforeEach, expect, it, vi } from "vitest";
import Support from "../(admin)/admin/student-support/page";
import Interviews from "../(admin)/admin/interviews/page";
import LegacyInterview from "../interview-management/page";
import LegacySupport from "../student-support/page";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), features: vi.fn() }));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw Error(`redirect:${path}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("./student-support", () => ({ StudentSupport: () => null }));
vi.mock("./interview-management", () => ({ InterviewManagement: () => null }));
vi.mock("./workflow-shell", () => ({ WorkflowShell: () => null }));
beforeEach(() => {
  mocks.auth.mockResolvedValue({ role: "HEAD" });
  mocks.features.mockResolvedValue({ INTERVIEWS: true });
});
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "keeps %s staff workflows in management",
  async (role) => {
    mocks.auth.mockResolvedValue({ role });
    expect(await Support()).toBeTruthy();
    expect(await Interviews()).toBeTruthy();
    await expect(LegacySupport()).rejects.toThrow(
      "redirect:/admin/student-support",
    );
  },
);
it.each(["VIEWER", "TUTOR", "STUDENT", "CREW"])(
  "keeps %s out of staff queues while retaining shared feedback",
  async (role) => {
    mocks.auth.mockResolvedValue({ role });
    await expect(Support()).rejects.toThrow("redirect:/student-support");
    await expect(Interviews()).rejects.toThrow("redirect:/");
    expect(await LegacySupport()).toBeTruthy();
  },
);
it("preserves old interview notifications and blocks the disabled module", async () => {
  expect(() => LegacyInterview()).toThrow("redirect:/admin/interviews");
  mocks.features.mockResolvedValue({ INTERVIEWS: false });
  await expect(Interviews()).rejects.toThrow("redirect:/admin/applications");
});
