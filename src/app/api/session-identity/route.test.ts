import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
import { GET } from "./route";

it("checks the current identity without renewing a cookie that could revive a signed-out session", async () => {
  for (const session of [
    null,
    { user: { id: "coordinator" }, role: "COORDINATOR", tutorId: null },
  ]) {
    mocks.auth.mockResolvedValue(session);
    const response = await GET();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({
      identity: session
        ? JSON.stringify(["coordinator", "COORDINATOR", null])
        : "anonymous",
    });
  }
});
