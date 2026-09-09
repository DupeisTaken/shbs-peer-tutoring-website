import { expect, it, vi } from "vitest";
import { z, ZodError } from "zod";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { ApprovalQueued } from "~/server/approvals";
import { formatTRPCErrorShape, validationSummary } from "./trpc";

it("summarizes repeated field validation failures without exposing paths", () => {
  const schema = z.object({
    observations: z.array(z.object({ roomId: z.string().cuid() })),
  });
  let error: ZodError;
  try {
    schema.parse({
      observations: [{ roomId: "room-a101" }, { roomId: "room-b201" }],
    });
    throw new Error("expected validation to fail");
  } catch (cause) {
    if (!(cause instanceof ZodError)) throw cause;
    error = cause;
  }

  const summary = validationSummary(error);
  expect(summary).toBe("Please correct the highlighted field: Invalid cuid.");
  expect(summary).not.toContain("room-a101");
  expect(summary).not.toContain("observations");
});

it("keeps distinct validation messages concise and actionable", () => {
  const error = new ZodError([
    { code: "custom", path: ["first"], message: "First is required" },
    { code: "custom", path: ["second"], message: "Second is required" },
    { code: "custom", path: ["third"], message: "Third is required" },
    { code: "custom", path: ["fourth"], message: "Fourth is required" },
  ]);

  expect(validationSummary(error)).toBe(
    "Please correct the highlighted fields: First is required; Second is required; Third is required; 1 more issue(s).",
  );
});

it("uses a useful fallback when Zod reports no message text", () => {
  expect(validationSummary(new ZodError([]))).toBe(
    "Please review the submitted values.",
  );
});

it("preserves flattened details and approval metadata in the transport shape", () => {
  const cause = new ZodError([
    { code: "custom", path: ["email"], message: "Use a school email" },
  ]);
  const shape = formatTRPCErrorShape(
    { message: "raw validation payload", data: { code: "BAD_REQUEST" } },
    { cause },
  );
  expect(shape.message).toBe(
    "Please correct the highlighted field: Use a school email.",
  );
  expect(shape.data.zodError).toEqual(cause.flatten());
  expect(shape.data.validationSummary).toBe(shape.message);

  const queued = formatTRPCErrorShape(
    { message: "business rule", data: { code: "FORBIDDEN" } },
    { cause: new ApprovalQueued("approval-123") },
  );
  expect(queued.message).toBe("business rule");
  expect(queued.data.approvalId).toBe("approval-123");
  expect(queued.data.zodError).toBeNull();
});
