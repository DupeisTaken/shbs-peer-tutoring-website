import { beforeEach, expect, it, vi } from "vitest";
import type { HelpAudience } from "~/lib/help/types";
import type * as HelpAssets from "~/server/help/assets";
import { GET } from "./route";

const mock = vi.hoisted(() => ({
  access: vi.fn(),
  read: vi.fn(),
  captures: [
    {
      id: "public-screen",
      file: "public-screen.en.jpg",
      route: "/signin",
      locale: "en",
      capturedAt: "2026-11-15T16:00:00Z",
      viewport: { width: 1440, height: 1000 },
      role: "PUBLIC",
      sha256: "synthetic",
    },
    {
      id: "head-screen",
      file: "head-screen.en.jpg",
      route: "/admin/users",
      locale: "en",
      capturedAt: "2026-11-15T16:00:00Z",
      viewport: { width: 1440, height: 1000 },
      role: "HEAD",
      sha256: "synthetic",
    },
  ],
}));
vi.mock("server-only", () => ({}));
vi.mock("~/server/help/access", () => ({ getHelpAccess: mock.access }));
vi.mock("~/lib/help/catalogue", () => ({
  helpArticles: [
    { audience: "public", steps: [{ screenshot: "public-screen" }] },
    { audience: "head", steps: [{ screenshot: "head-screen" }] },
  ],
}));
vi.mock("~/lib/help/screenshots", () => ({
  getHelpScreenshot: (id: string, locale: string) =>
    mock.captures.find(
      (capture) => capture.id === id && capture.locale === locale,
    ) ??
    mock.captures.find(
      (capture) => capture.id === id && capture.locale === "en",
    ),
}));
vi.mock("~/server/help/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof HelpAssets>()),
  readScreenshot: mock.read,
}));

const request = (id: string, query = "") =>
  GET(
    new Request(
      `https://school.example/api/help/images/${encodeURIComponent(id)}${query}`,
    ),
    { params: Promise.resolve({ id }) },
  );
function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Vary")).toBe("Cookie");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.access.mockResolvedValue({
    audiences: ["public"] as HelpAudience[],
    canDownload: false,
  });
  mock.read.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});

it("serves the exact permitted public image bytes without requiring a login", async () => {
  const response = await request("public-screen");
  expect(response.status).toBe(200);
  expectPrivate(response);
  expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  );
  expect(mock.read).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "public-screen",
      file: "public-screen.en.jpg",
    }),
  );
});

it("returns the same missing response for restricted and unknown IDs without reading any bytes", async () => {
  for (const id of [
    "head-screen",
    "unknown-screen",
    "../private",
    "public-screen/../../private",
    "__proto__",
  ]) {
    const response = await request(id);
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(await response.text()).toBe("Not found");
  }
  expect(mock.read).not.toHaveBeenCalled();
});

it("does not infer Head image access from staff or Admin audiences", async () => {
  mock.access.mockResolvedValue({
    audiences: ["public", "account", "staff", "admin"],
    canDownload: true,
  });
  expect((await request("head-screen")).status).toBe(404);
  expect(mock.read).not.toHaveBeenCalled();
  mock.access.mockResolvedValue({
    audiences: ["public", "account", "staff", "admin", "head"],
    canDownload: true,
  });
  expect((await request("head-screen")).status).toBe(200);
  expect(mock.read).toHaveBeenCalledTimes(1);
});

it.each(["fr", "EN", "", "../en"])(
  "rejects unsupported image locale %s before account or file reads",
  async (locale) => {
    const response = await request(
      "public-screen",
      `?locale=${encodeURIComponent(locale)}`,
    );
    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(mock.access).not.toHaveBeenCalled();
    expect(mock.read).not.toHaveBeenCalled();
  },
);

it("allows the Chinese edition to use its reviewed English fallback", async () => {
  expect((await request("public-screen", "?locale=zh")).status).toBe(200);
  expect(mock.read).toHaveBeenCalledWith(
    expect.objectContaining({ locale: "en" }),
  );
});

it("returns private actionable 503 guidance without leaking an asset path", async () => {
  mock.read.mockRejectedValueOnce(
    new Error("ENOENT E:\\private-server\\internal-file.jpg"),
  );
  const response = await request("public-screen");
  expect(response.status).toBe(503);
  expectPrivate(response);
  const message = await response.text();
  expect(message).toContain("Reload this guide");
  expect(message).not.toContain("private-server");
  expect(message).not.toContain("ENOENT");
});

it("fails closed with private 503 guidance when live access cannot be resolved", async () => {
  mock.access.mockRejectedValueOnce(
    new Error("Database unavailable on private-server.internal"),
  );
  const response = await request("public-screen");
  expect(response.status).toBe(503);
  expectPrivate(response);
  expect(await response.text()).not.toContain("private-server");
  expect(mock.read).not.toHaveBeenCalled();
});
