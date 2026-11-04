import { expect, it } from "vitest";
import Schedule from "./page";
import Dashboard from "../dashboard/page";
it("keeps the legacy schedule URL on the guarded shared tutor workspace", () => {
  expect(Schedule).toBe(Dashboard);
});
