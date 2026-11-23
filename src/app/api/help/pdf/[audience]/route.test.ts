import { beforeEach, expect, it, vi } from "vitest";
import type { HelpAudience } from "~/lib/help/types";
import { GET } from "./route";

const mock = vi.hoisted(() => ({ access: vi.fn(), render: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("~/server/help/access", () => ({ getHelpAccess: mock.access }));
vi.mock("~/server/help/pdf", () => ({ renderHelpPdf: mock.render }));
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
    canDownload: true,
  });
  mock.render.mockResolvedValue(pdfBytes);
});

it.each([
  ["public"],
  ["public", "account", "student"],
  ["public", "account", "observer"],
] as HelpAudience[][])(
  "short-circuits a non-staff account with %j",
  async (...audiences) => {
    mock.access.mockResolvedValue({ audiences, canDownload: false });
    const response = await request("public");
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(mock.render).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Disposition")).toBeNull();
  },
);

it.each(["tutor", "crew", "student", "public"])(
  "allows staff to download the %s training edition without adding a membership",
  async (audience) => {
    const response = await request(audience, "?locale=zh");
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="shbs-help-${audience}-zh.pdf"`,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
    expect(mock.render).toHaveBeenCalledWith(audience, "zh");
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
    canDownload: true,
  });
  expect((await request("admin")).status).toBe(200);
  expect(mock.render).toHaveBeenCalledWith("admin", "en");
  mock.render.mockClear();
  expect((await request("head")).status).toBe(403);
  expect(mock.render).not.toHaveBeenCalled();
});

it("allows the Head edition only after current Head access is established", async () => {
  mock.access.mockResolvedValue({
    audiences: ["public", "account", "staff", "admin", "head"],
    canDownload: true,
  });
  const response = await request("head");
  expect(response.status).toBe(200);
  expect(mock.render).toHaveBeenCalledWith("head", "en");
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="shbs-help-head-en.pdf"',
  );
});

it.each(["unknown", "../head", "HEAD", 'head\";filename=private'])(
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
  expect(message).toContain("Return to PDF handbooks");
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
