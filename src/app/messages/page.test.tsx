// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  role: "HEAD",
  suspended: false,
  redirect: vi.fn((url: string) => {
    throw Error(`redirect:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/server/auth", () => ({
  auth: async () => ({ user: { id: "test-user" } }),
}));
vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: async () => ({
        id: "test-user",
        role: mocks.role,
        suspendedAt: mocks.suspended ? new Date() : null,
      }),
    },
  },
}));
vi.mock("~/app/_components/workflow-shell", () => ({
  WorkflowShell: () => null,
}));
vi.mock("~/app/_components/message-inbox", () => ({
  MessageInbox: () => null,
}));
vi.mock("~/app/_components/message-admin", () => ({
  MessageAdmin: () => null,
}));
import PublicMessages from "./page";
import ManagementMessages from "../(admin)/admin/messages/page";
import Supervision from "../(admin)/admin/messages/supervision/page";
beforeEach(() => {
  mocks.role = "HEAD";
  mocks.suspended = false;
  vi.clearAllMocks();
});
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "resolves old direct/notification links for %s into management shell",
  async (role) => {
    mocks.role = role;
    await expect(PublicMessages()).rejects.toThrow("redirect:/admin/messages");
    expect(await ManagementMessages()).toBeTruthy();
  },
);
it("resolves student links into the embedded inbox", async () => {
  mocks.role = "STUDENT";
  await expect(PublicMessages()).rejects.toThrow(
    "redirect:/student?view=messages",
  );
});
it.each(["TUTOR", "CREW", "VIEWER"])(
  "retains standalone message access for %s",
  async (role) => {
    mocks.role = role;
    expect(await PublicMessages()).toBeTruthy();
    await expect(ManagementMessages()).rejects.toThrow("redirect:/messages");
  },
);
it.each(["COORDINATOR", "STUDENT", "TUTOR", "VIEWER"])(
  "rejects the supervision route for %s using the current account",
  async (role) => {
    mocks.role = role;
    await expect(Supervision()).rejects.toThrow("redirect:/messages");
  },
);
it.each(["HEAD", "ADMIN"])("allows supervision for %s", async (role) => {
  mocks.role = role;
  expect(await Supervision()).toBeTruthy();
});
it("routes suspended accounts away from every message destination", async () => {
  mocks.suspended = true;
  for (const page of [PublicMessages, ManagementMessages, Supervision])
    await expect(page()).rejects.toThrow("redirect:/suspended");
});
