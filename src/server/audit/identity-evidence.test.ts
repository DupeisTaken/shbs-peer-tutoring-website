import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma";
import { runAuditedMutation, safeAuditSnapshot } from "./evidence";

const schema = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

it("selects and rereads every schema identity without relying on runtime primary-key metadata", async () => {
  // Derive expectations from the owned schema, independently of the runtime
  // catalog. A new/changed key must work through the actual audit interceptor.
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const name = match[1]!;
    if (name === "AuditLog") continue; // The audit writer must never audit itself.
    const compound = /@@id\s*\(\s*\[([^\]]+)\]/s.exec(match[2]!);
    const fields = compound
      ? compound[1]!.split(",").map((field) => field.trim())
      : [...match[2]!.matchAll(/^\s*(\w+)\s+\S+[^\n]*\s@id\b/gm)].map(
          (field) => field[1]!,
        );
    expect(fields.length, name).toBeGreaterThan(0);
    const identity = Object.fromEntries(
      fields.map((field) => [field, `synthetic-${field}`]),
    );
    const findMany = vi.fn(
      async (_args: { where: unknown; select: Record<string, boolean> }) => [
        { ...identity },
      ],
    );
    const delegate = name.charAt(0).toLowerCase() + name.slice(1);
    const tx = {
      [delegate]: { findMany, updateMany: async () => ({ count: 1 }) },
      auditLog: { create: async () => ({}) },
    };
    const client = {
      ...tx,
      $transaction: async (work: (tx: object) => Promise<unknown>) => work(tx),
    } as unknown as PrismaClient;

    await runAuditedMutation(
      client,
      { id: "synthetic-head", name: "Synthetic head", role: "HEAD" },
      "admin.updateSubjects",
      async (db) => {
        const model = Reflect.get(db, delegate) as {
          updateMany: (args: object) => Promise<unknown>;
        };
        await model.updateMany({ where: identity, data: {} });
        return { ok: true };
      },
    );

    expect(findMany, name).toHaveBeenCalledTimes(2);
    const select = Object.fromEntries(fields.map((field) => [field, true]));
    expect(findMany.mock.calls[0]?.[0].select, name).toMatchObject(select);
    expect(findMany, name).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where:
          fields.length === 1 && fields[0] === "id"
            ? { id: { in: [identity.id] } }
            : { OR: [identity] },
      }),
    );
  }
});

it("keeps private lookup identities outside the evidence disclosure allowlist", () => {
  expect(
    safeAuditSnapshot(
      {
        senderId: "private-sender",
        clientKey: "private-retry-key",
        payloadHash: "private-payload-hash",
        count: 2,
      },
      "MessageBatch",
    ),
  ).toEqual({ count: 2 });
  expect(
    safeAuditSnapshot(
      {
        tokenHash: "private-token-hash",
        identityHash: "private-identity-hash",
        version: 2,
      },
      "CaptchaGrant",
    ),
  ).toEqual({ version: 2 });
  expect(
    safeAuditSnapshot(
      {
        tutorId: "synthetic-tutor",
        subjectId: "synthetic-subject",
        willing: false,
      },
      "TutorSubjectWillingness",
    ),
  ).toEqual({
    tutorId: "synthetic-tutor",
    subjectId: "synthetic-subject",
    willing: false,
  });
});
