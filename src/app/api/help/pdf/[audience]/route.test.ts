import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HelpAudience } from "~/lib/help/types";
import type * as PdfModule from "~/server/help/pdf";
import { GET } from "./route";

const mock = vi.hoisted(() => ({ access: vi.fn(), render: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("~/server/help/access", () => ({ getHelpAccess: mock.access }));
vi.mock("~/server/help/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfModule>();
  return {
    ...actual,
    renderHelpPdf: mock.render,
  };
});
vi.mock("~/lib/help/catalogue", () => ({
  helpAudiences: [
    "public",
    "account",
    "student",
    "tutor",
    "crew",
    "observer",
    "staff",
    "admin",
    "head",
    "translator",
  ],
}));
vi.mock("~/server/help/assets", () => ({
  helpPrivateHeaders: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Cookie",
  },
}));

const request = (audience: string, query = "") =>
  GET(
    new Request(
      `https://school.example/api/help/pdf/${encodeURIComponent(audience)}${query}`,
    ),
    { params: Promise.resolve({ audience }) },
  );
const pdfBytes = Buffer.from("%PDF-1.7\nsynthetic test payload\n%%EOF\n");
function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Vary")).toBe("Cookie");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.access.mockResolvedValue({
    audiences: [
      "public",
      "account",
      "student",
      "observer",
      "staff",
      "translator",
    ] as HelpAudience[],
    downloadableAudiences: [
      "public",
      "account",
      "student",
      "tutor",
      "crew",
      "observer",
      "staff",
      "translator",
    ] as HelpAudience[],
    canDownload: true,
  });
  mock.render.mockResolvedValue(pdfBytes);
});

afterEach(() => {
  vi.useRealTimers();
});

it("lets visitors download the public handbook with a download timestamp and rejects private editions", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T04:55:00Z")); // 2026-11-24 12:55 UTC+8
  mock.access.mockResolvedValue({
    audiences: ["public"],
    downloadableAudiences: ["public"],
    canDownload: false,
  });
  const allowed = await request("public", "?locale=en");
  expect(allowed.status).toBe(200);
  expectPrivate(allowed);
  expect(allowed.headers.get("Content-Disposition")).toBe(
    'attachment; filename="shbs-help-public-en-2026-11-24-1255.pdf"',
  );
  expect(mock.render).toHaveBeenCalledWith(
    "public",
    "en",
    new Date("2026-11-24T04:55:00Z"),
  );
  mock.render.mockClear();
  for (const forbidden of ["account", "student", "tutor", "staff", "admin", "head"]) {
    const response = await request(forbidden);
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(response.headers.get("Content-Disposition")).toBeNull();
  }
  expect(mock.render).not.toHaveBeenCalled();
});

it("lets participants download only their authorized editions", async () => {
  mock.access.mockResolvedValue({
    audiences: ["public", "account", "student"],
    downloadableAudiences: ["public", "account", "student"],
    canDownload: false,
  });
  expect((await request("student", "?locale=zh")).status).toBe(200);
  expect(mock.render).toHaveBeenCalledWith("student", "zh", expect.any(Date));
  mock.render.mockClear();
  expect((await request("tutor")).status).toBe(403);
  expect((await request("staff")).status).toBe(403);
  expect(mock.render).not.toHaveBeenCalled();
});

it.each(["tutor", "crew", "student", "public"])(
  "allows staff to download the %s training edition with a download timestamp",
  async (audience) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T01:05:00Z")); // 2026-11-24 09:05 UTC+8
    const response = await request(audience, "?locale=zh");
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="shbs-help-${audience}-zh-2026-11-24-0905.pdf"`,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
    expect(mock.render).toHaveBeenCalledWith(
      audience,
      "zh",
      new Date("2026-11-24T01:05:00Z"),
    );
  },
);

it("does not expose Admin or Head edition bytes to a Coordinator", async () => {
  for (const audience of ["admin", "head"]) {
    const response = await request(audience);
    expect(response.status).toBe(403);
    expectPrivate(response);
  }
  expect(mock.render).not.toHaveBeenCalled();
});

it("allows the Admin edition while keeping Head-only content out of Admin requests", async () => {
  mock.access.mockResolvedValue({
    audiences: ["public", "account", "staff", "admin"],
    downloadableAudiences: [
      "public",
      "account",
      "student",
      "tutor",
      "crew",
      "observer",
      "staff",
      "admin",
      "translator",
    ],
    canDownload: true,
  });
  expect((await request("admin")).status).toBe(200);
  expect(mock.render).toHaveBeenCalledWith("admin", "en", expect.any(Date));
  mock.render.mockClear();
  expect((await request("head")).status).toBe(403);
  expect(mock.render).not.toHaveBeenCalled();
});

it("allows the Head edition only after current Head access is established", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T06:30:00Z")); // 14:30 UTC+8
  mock.access.mockResolvedValue({
    audiences: ["public", "account", "staff", "admin", "head"],
    downloadableAudiences: [
      "public",
      "account",
      "student",
      "tutor",
      "crew",
      "observer",
      "staff",
      "admin",
      "head",
      "translator",
    ],
    canDownload: true,
  });
  const response = await request("head");
  expect(response.status).toBe(200);
  expect(mock.render).toHaveBeenCalledWith(
    "head",
    "en",
    new Date("2026-11-24T06:30:00Z"),
  );
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="shbs-help-head-en-2026-11-24-1430.pdf"',
  );
});

it.each(["unknown", "../head", "HEAD", 'head";filename=private'])(
  "rejects an arbitrary audience %s before renderer or filename construction",
  async (audience) => {
    const response = await request(audience);
    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(mock.render).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Disposition")).toBeNull();
  },
);

it.each(["fr", "EN", "", "../../en"])(
  "rejects unsupported PDF locale %s",
  async (locale) => {
    const response = await request(
      "public",
      `?locale=${encodeURIComponent(locale)}`,
    );
    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(mock.render).not.toHaveBeenCalled();
  },
);

it("returns private actionable 503 guidance without leaking renderer paths or partial PDF bytes", async () => {
  mock.render.mockRejectedValueOnce(
    new Error("ENOENT /private-server/fonts/internal-font.otf"),
  );
  const response = await request("public");
  expect(response.status).toBe(503);
  expectPrivate(response);
  expect(response.headers.get("Content-Disposition")).toBeNull();
  const message = await response.text();
  expect(message).toContain("Return to PDF Handbooks");
  expect(message).not.toContain("private-server");
  expect(message).not.toContain("%PDF");
});

it("fails closed with private 503 guidance when live authorization fails", async () => {
  mock.access.mockRejectedValueOnce(
    new Error("Database unavailable on private-server.internal"),
  );
  const response = await request("head");
  expect(response.status).toBe(503);
  expectPrivate(response);
  expect(await response.text()).not.toContain("private-server");
  expect(response.headers.get("Content-Disposition")).toBeNull();
  expect(mock.render).not.toHaveBeenCalled();
});

it("bounds concurrent PDF renders with a retryable 503 and releases slots after completion", async () => {
  const resolvers: (() => void)[] = [];
  mock.render.mockImplementation(
    () =>
      new Promise<Buffer>((resolve) => {
        resolvers.push(() => resolve(pdfBytes));
      }),
  );
  const first = request("public");
  const second = request("student");
  await vi.waitFor(() => expect(resolvers).toHaveLength(2));
  const third = await request("tutor");
  expect(third.status).toBe(503);
  expectPrivate(third);
  expect(third.headers.get("Retry-After")).toBe("5");
  expect(mock.render).toHaveBeenCalledTimes(2);
  resolvers.forEach((resolve) => resolve());
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  mock.render.mockResolvedValueOnce(pdfBytes);
  expect((await request("tutor")).status).toBe(200);
});
