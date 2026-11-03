import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
import { GET } from "./route";

it("checks the current identity without renewing a cookie that could revive a signed-out session", async () => {
  for (const { session, identity } of [
    { session: null, identity: "anonymous" },
    {
      session: { user: { id: "coordinator" }, role: "COORDINATOR", tutorId: null },
      identity: JSON.stringify(["coordinator", "COORDINATOR", null, null, 0]),
    },
    {
      session: { user: { id: "coordinator" }, role: "COORDINATOR", tutorId: null, sessionVersion: 3, historyAccessRevision: 7 },
      identity: JSON.stringify(["coordinator", "COORDINATOR", null, 3, 7]),
    },
  ]) {
    mocks.auth.mockResolvedValue(session);
    const response = await GET();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({
      identity,
    });
  }
});
