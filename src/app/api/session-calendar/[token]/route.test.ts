import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ feed: vi.fn(), database: {} }));
vi.mock("~/server/db", () => ({ db: mock.database }));
vi.mock("~/server/session-planning-calendar", () => ({ sessionCalendarFeed: mock.feed }));
import { GET } from "./route";
beforeEach(() => vi.resetAllMocks());
const request = () => new Request("https://school.example.test/api/session-calendar/synthetic-token");
const context = { params: Promise.resolve({ token: "synthetic-token" }) };

it("serves a private, non-cacheable calendar without interactive cookie authorization", async () => {
  mock.feed.mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  const response = await GET(request(), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  expect(mock.feed).toHaveBeenCalledWith(mock.database, "synthetic-token");
});

it("reveals no identity or token for revoked and unavailable subscriptions", async () => {
  mock.feed.mockResolvedValue(null);
  const invalid = await GET(request(), context);
  expect(invalid.status).toBe(404);
  mock.feed.mockRejectedValue(new Error("PRIVATE TOKEN AND IDENTITY"));
  const failed = await GET(request(), context);
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("PRIVATE");
  expect(await invalid.text()).not.toContain("synthetic-token");
});
