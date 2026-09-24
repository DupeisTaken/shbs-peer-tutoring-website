import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertDemoDatabase, seedId } from "../../prisma/demo-support";

describe("disposable demonstration database", () => {
  const acknowledgement = { SHBS_DEMO_SEED: "1", NODE_ENV: "development" };
  it("produces stable API-valid IDs for both fixtures and references", () => {
    expect(z.string().cuid().parse(seedId("room-a101"))).toBe(
      seedId("room-a101"),
    );
    expect(seedId("room-a101")).not.toBe(seedId("room-a102"));
  });
  it("allows an explicitly acknowledged loopback demonstration database", () => {
    expect(() =>
      assertDemoDatabase(
        "postgresql://postgres@127.0.0.1:55439/shbs_program_demo",
        acknowledgement,
      ),
    ).not.toThrow();
  });
  it.each([
    [
      "postgresql://postgres@production.example/shbs_program_demo",
      acknowledgement,
    ],
    ["postgresql://postgres@localhost/program", acknowledgement],
    ["postgresql://postgres@localhost/shbs_contest", acknowledgement],
    ["postgresql://postgres@localhost/shbs_programdemo", acknowledgement],
    [
      "postgresql://postgres@localhost/shbs_program_demo",
      { NODE_ENV: "development" },
    ],
    [
      "postgresql://postgres@localhost/shbs_program_demo",
      { ...acknowledgement, NODE_ENV: "production" },
    ],
    [
      "postgresql://postgres@localhost/shbs_program_demo?host=production.example",
      acknowledgement,
    ],
  ])("rejects unsafe seed target %s", (url, env) => {
    expect(() => assertDemoDatabase(url, env)).toThrow();
  });
});
