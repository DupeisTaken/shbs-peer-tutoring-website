import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "../../generated/prisma";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { db } from "~/server/db";
import { GLOBAL_LOCALE } from "~/server/home/content";
import { translationBaseline } from "~/server/translation-destination";
import {
  intentAccounts,
  intentBusinessSnapshot,
  intentCaller,
  intentWrites,
  resetTranslationIntentFixture,
  type IntentActor,
  type IntentEnvelope,
} from "~/test/translation-intent-fixture";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
beforeEach(resetTranslationIntentFixture);
afterAll(async () => {
  await db.$disconnect();
}, 10_000);

function envelope(
  actor: IntentActor = "author",
  id: string = randomUUID(),
): IntentEnvelope {
  return {
    version: 1,
    id,
    actorId: intentAccounts[actor].id,
    mode: actor === "publisher" ? "PUBLISH" : "DRAFT",
  };
}
const own = (intent: IntentEnvelope) => ({
  actorId: intent.actorId,
  intentId: intent.id,
});

it.each(intentWrites)(
  "binds $operation once for each draft/publication mode and strips its envelope",
  async (write) => {
    for (const actor of ["author", "coordinator", "publisher"] as const) {
      const intent = envelope(actor);
      const first = await write.run(intentCaller(actor), intent);
      const receipt = await db.translationIntentReceipt.findUniqueOrThrow({
        where: { actorId_intentId: own(intent) },
      });
      expect(receipt).toMatchObject({
        protocolVersion: 1,
        status: "ACCEPTED",
        operation: write.operation,
        mode: intent.mode,
      });
      expect(receipt.inputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(first).toMatchObject({
        ok: true,
        receipt: {
          status: "ACCEPTED",
          intentId: intent.id,
          mode: intent.mode,
          outcome: intent.mode === "DRAFT" ? "DRAFT_SUBMITTED" : "PUBLISHED",
          replayed: false,
        },
      });
      if (intent.mode === "DRAFT") {
        const draft = await db.translationDraft.findUniqueOrThrow({
          where: { id: receipt.draftId! },
        });
        expect(draft).toMatchObject({
          authorId: intent.actorId,
          operation: write.operation,
          state: "PENDING",
        });
        expect(draft.payload).not.toHaveProperty("intent");
        expect(draft.payload).toHaveProperty("_destinationBaseline");
      } else expect(receipt.draftId).toBeNull();
      const beforeReplay = await intentBusinessSnapshot();
      const replay = await write.run(intentCaller(actor), intent);
      expect(replay).toMatchObject({
        ok: true,
        receipt: {
          status: "ACCEPTED",
          intentId: intent.id,
          mode: intent.mode,
          replayed: true,
          draftId: receipt.draftId,
          acceptedAt: receipt.createdAt,
          cleared: receipt.cleared,
        },
      });
      expect(await intentBusinessSnapshot()).toEqual(beforeReplay);
    }
  },
);

it.each(intentWrites)(
  "keeps keyless $operation behavior separate from optional-key admission",
  async (write) => {
    const first = await write.run(intentCaller("author"));
    expect(first).not.toHaveProperty("receipt");
    await write.run(intentCaller("author"));
    expect(
      await db.translationDraft.count({
        where: { operation: write.operation },
      }),
    ).toBe(2);
    expect(await db.translationIntentReceipt.count()).toBe(0);
    const published = await write.run(intentCaller("publisher"));
    expect(published).not.toHaveProperty("receipt");
    expect(await db.translationDraft.count()).toBe(2);
  },
);

it.each(intentWrites)(
  "rejects unavailable locale before first keyed $operation admission",
  async (write) => {
    const before = await intentBusinessSnapshot();
    await expect(
      write.run(intentCaller("author"), envelope(), {
        locale: "xx-no-such-language",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await intentBusinessSnapshot()).toEqual(before);
  },
);

it.each([
  { write: intentWrites[2], missing: { postId: "no-such-post" } },
  { write: intentWrites[3], missing: { sectionId: "no-such-section" } },
  { write: intentWrites[4], missing: { id: "no-such-page" } },
])(
  "rejects missing first-admission parent for $write.operation",
  async ({ write, missing }) => {
    const before = await intentBusinessSnapshot();
    await expect(
      write.run(intentCaller("author"), envelope(), missing),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await intentBusinessSnapshot()).toEqual(before);
  },
);

it.each([intentWrites[0], intentWrites[1]])(
  "rejects unknown first-admission key for $operation without reserving the UUID",
  async (write) => {
    const intent = envelope();
    await expect(
      write.run(intentCaller("author"), intent, { key: "not-a-real-key" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.translationIntentReceipt.count()).toBe(0);
    // First-terminal binding: a fully rolled-back rejected input did not prepare
    // a binding. A later valid first admission can still use this unused UUID.
    await expect(
      write.run(intentCaller("author"), intent),
    ).resolves.toMatchObject({ receipt: { replayed: false } });
  },
);

it("hashes parsed business text and canonical UUID rather than raw envelope/session material", async () => {
  const intent = envelope();
  const first = await intentWrites[2].run(
    intentCaller("author"),
    { ...intent, id: intent.id.toUpperCase() },
    { locale: " en ", title: "  Parsed title  " },
  );
  expect(first).toMatchObject({ receipt: { intentId: intent.id } });
  const before = await intentBusinessSnapshot();
  await expect(
    intentWrites[2].run(intentCaller("author"), intent, {
      locale: "en",
      title: "Parsed title",
    }),
  ).resolves.toMatchObject({ receipt: { replayed: true } });
  expect(await intentBusinessSnapshot()).toEqual(before);
});

it("keeps keyed heroImageId publication global while retaining the requested locale and original draft baseline", async () => {
  const bytes = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KXcAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const image = await db.homeImage.create({
    data: {
      id: "intent-real-hero-image",
      mimeType: "image/png",
      byteSize: bytes.byteLength,
      data: bytes,
      alt: "Synthetic one-pixel hero fixture",
    },
  });
  const business = { locale: "zh", key: "heroImageId", value: image.id };
  const published = envelope("publisher");
  await intentCaller("publisher").home.setContent({
    ...business,
    intent: published,
  });
  expect(GLOBAL_LOCALE).toBe("en");
  expect(
    await db.homeContent.findUniqueOrThrow({
      where: { key_locale: { key: business.key, locale: GLOBAL_LOCALE } },
    }),
  ).toMatchObject({ value: image.id });
  expect(
    await db.homeContent.findUnique({
      where: { key_locale: { key: business.key, locale: business.locale } },
    }),
  ).toBeNull();

  const baseline = await translationBaseline(db, "home.setContent", business);
  const submitted = envelope();
  await intentCaller("author").home.setContent({
    ...business,
    intent: submitted,
  });
  const receipt = await db.translationIntentReceipt.findUniqueOrThrow({
    where: { actorId_intentId: own(submitted) },
  });
  expect(
    (
      await db.translationDraft.findUniqueOrThrow({
        where: { id: receipt.draftId! },
      })
    ).payload,
  ).toEqual({ ...business, _destinationBaseline: baseline });
  const beforeReplay = await intentBusinessSnapshot();
  await expect(
    intentCaller("publisher").home.setContent({
      ...business,
      intent: published,
    }),
  ).resolves.toMatchObject({ receipt: { mode: "PUBLISH", replayed: true } });
  await expect(
    intentCaller("author").home.setContent({ ...business, intent: submitted }),
  ).resolves.toMatchObject({ receipt: { mode: "DRAFT", replayed: true } });
  expect(await intentBusinessSnapshot()).toEqual(beforeReplay);
  expect(
    await db.homeImage.findUniqueOrThrow({ where: { id: image.id } }),
  ).toEqual(image);

  for (const actor of ["author", "publisher"] as const) {
    await expect(
      intentCaller(actor).home.setContent({
        ...business,
        locale: "xx-missing-global-locale",
        intent: envelope(actor),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  expect(await intentBusinessSnapshot()).toEqual(beforeReplay);
});

it("refuses accepted binding changes without adopting another actor, operation, mode or payload", async () => {
  const intent = envelope();
  await intentWrites[0].run(intentCaller("author"), intent);
  const before = await intentBusinessSnapshot();
  await expect(
    intentWrites[0].run(intentCaller("author"), intent, {
      value: "Changed synthetic text",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    intentWrites[1].run(intentCaller("author"), intent),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    intentWrites[0].run(intentCaller("author"), { ...intent, mode: "PUBLISH" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    intentWrites[0].run(intentCaller("other"), intent),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    intentCaller("other").translationIntent.get(own(intent)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    intentCaller("other").translationIntent.stop(own(intent)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await intentBusinessSnapshot()).toEqual(before);
  // A different original actor may independently own the same random UUID.
  await intentWrites[0].run(
    intentCaller("other"),
    envelope("other", intent.id),
  );
  expect(await db.translationIntentReceipt.count()).toBe(2);
});

it.each(["APPROVED", "REJECTED", "DELETED"] as const)(
  "replays historical draft submission after the draft is %s without consuming the author key during review",
  async (decision) => {
    const intent = envelope();
    await intentWrites[0].run(intentCaller("author"), intent);
    const receipt = await db.translationIntentReceipt.findUniqueOrThrow({
      where: { actorId_intentId: own(intent) },
    });
    const draft = await db.translationDraft.findUniqueOrThrow({
      where: { id: receipt.draftId! },
    });
    if (decision === "DELETED")
      await db.translationDraft.delete({ where: { id: draft.id } });
    else
      await intentCaller("publisher").translationReview.decide({
        id: draft.id,
        approve: decision === "APPROVED",
        expectedUpdatedAt: draft.updatedAt,
      });
    const before = await intentBusinessSnapshot();
    await expect(
      intentWrites[0].run(intentCaller("author"), intent),
    ).resolves.toMatchObject({
      receipt: {
        outcome: "DRAFT_SUBMITTED",
        mode: "DRAFT",
        draftId: draft.id,
        replayed: true,
      },
    });
    expect(await intentBusinessSnapshot()).toEqual(before);
    expect(await db.translationIntentReceipt.count()).toBe(1);
    expect(
      await db.translationIntentReceipt.findUniqueOrThrow({
        where: { actorId_intentId: own(intent) },
      }),
    ).toEqual(receipt);
  },
);

it.each(intentWrites)(
  "publishes reviewed $operation without requiring or reusing an author envelope",
  async (write) => {
    const intent = envelope();
    await write.run(intentCaller("author"), intent);
    const receipt = await db.translationIntentReceipt.findUniqueOrThrow({
      where: { actorId_intentId: own(intent) },
    });
    const draft = await db.translationDraft.findUniqueOrThrow({
      where: { id: receipt.draftId! },
    });
    // Management review may publish without acquiring the author's Translator
    // grant. The trusted internal publication remains a separate operation.
    await db.user.update({
      where: { id: intentAccounts.publisher.id },
      data: { canTranslate: false },
    });
    await intentCaller("publisher").translationReview.decide({
      id: draft.id,
      approve: true,
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(
      await db.translationDraft.findUniqueOrThrow({ where: { id: draft.id } }),
    ).toMatchObject({
      state: "APPROVED",
      reviewedById: intentAccounts.publisher.id,
    });
    expect(await db.translationIntentReceipt.count()).toBe(1);
    expect(
      await db.translationIntentReceipt.findUniqueOrThrow({
        where: { actorId_intentId: own(intent) },
      }),
    ).toEqual(receipt);
    expect(await db.translationDraft.count()).toBe(1);
  },
);

it.each([
  {
    write: intentWrites[2],
    remove: () => db.newsPost.delete({ where: { id: "intent-news" } }),
  },
  {
    write: intentWrites[3],
    remove: () => db.landingSection.delete({ where: { id: "intent-section" } }),
  },
  {
    write: intentWrites[4],
    remove: () => db.customPage.delete({ where: { id: "intent-page" } }),
  },
])(
  "returns historical $write.operation receipt before validating a deleted parent",
  async ({ write, remove }) => {
    const intent = envelope();
    await write.run(intentCaller("author"), intent);
    await remove();
    const before = await intentBusinessSnapshot();
    await expect(
      write.run(intentCaller("author"), intent),
    ).resolves.toMatchObject({
      receipt: { outcome: "DRAFT_SUBMITTED", replayed: true },
    });
    expect(await intentBusinessSnapshot()).toEqual(before);
  },
);

it.each(intentWrites)(
  "returns historical $operation receipt after its custom language is deleted",
  async (write) => {
    const intent = envelope();
    await write.run(intentCaller("author"), intent, { locale: "xx-intent" });
    await db.language.delete({ where: { code: "xx-intent" } });
    const before = await intentBusinessSnapshot();
    await expect(
      write.run(intentCaller("author"), intent, { locale: "xx-intent" }),
    ).resolves.toMatchObject({
      receipt: { outcome: "DRAFT_SUBMITTED", replayed: true },
    });
    expect(await intentBusinessSnapshot()).toEqual(before);
  },
);

it("retains accepted mode across promotion/demotion and allows metadata recovery after Translator revocation", async () => {
  const draftIntent = envelope();
  const publishIntent = envelope("publisher");
  await intentWrites[0].run(intentCaller("author"), draftIntent);
  await intentWrites[1].run(intentCaller("publisher"), publishIntent);
  await db.user.update({
    where: { id: intentAccounts.author.id },
    data: { role: "ADMIN" },
  });
  await db.user.update({
    where: { id: intentAccounts.publisher.id },
    data: { role: "STUDENT" },
  });
  await expect(
    intentWrites[0].run(intentCaller("author"), draftIntent),
  ).resolves.toMatchObject({ receipt: { mode: "DRAFT", replayed: true } });
  await expect(
    intentWrites[1].run(intentCaller("publisher"), publishIntent),
  ).resolves.toMatchObject({ receipt: { mode: "PUBLISH", replayed: true } });
  await db.user.update({
    where: { id: intentAccounts.author.id },
    data: { canTranslate: false },
  });
  const before = await intentBusinessSnapshot();
  await expect(
    intentCaller("author").translationIntent.get(own(draftIntent)),
  ).resolves.toMatchObject({
    status: "ACCEPTED",
    mode: "DRAFT",
    outcome: "DRAFT_SUBMITTED",
  });
  await expect(
    intentCaller("author").translationIntent.stop(own(draftIntent)),
  ).resolves.toMatchObject({ status: "ACCEPTED", mode: "DRAFT" });
  const stopped = envelope();
  await expect(
    intentCaller("author").translationIntent.stop(own(stopped)),
  ).resolves.toMatchObject({ status: "STOPPED" });
  expect(await db.translationIntentReceipt.count()).toBe(
    before.receipts.length + 1,
  );
  expect(await db.translationDraft.count()).toBe(before.drafts.length);
});

it.each(["author", "publisher"] as const)(
  "refuses a first %s intent whose requested mode is incompatible with current authority",
  async (actor) => {
    const intent = envelope(actor);
    await db.user.update({
      where: { id: intent.actorId },
      data: { role: actor === "author" ? "ADMIN" : "STUDENT" },
    });
    const before = await intentBusinessSnapshot();
    await expect(
      intentWrites[0].run(intentCaller(actor), intent),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await intentBusinessSnapshot()).toEqual(before);
  },
);

it.each([intentWrites[0], intentWrites[1]])(
  "replays the original $operation clear result without clearing a later deliberate publication",
  async (write) => {
    const intent = envelope("publisher");
    await expect(
      write.run(intentCaller("publisher"), intent, { value: "" }),
    ).resolves.toMatchObject({
      ok: true,
      cleared: true,
      receipt: { cleared: true },
    });
    await write.run(intentCaller("publisher"), envelope("publisher"));
    const before = await intentBusinessSnapshot();
    await expect(
      write.run(intentCaller("publisher"), intent, { value: "" }),
    ).resolves.toMatchObject({
      ok: true,
      cleared: true,
      receipt: { cleared: true, replayed: true },
    });
    expect(await intentBusinessSnapshot()).toEqual(before);
  },
);

it("keeps get read-only and treats NOT_RECORDED as absence without manufacturing a terminal row", async () => {
  const intent = envelope();
  const before = await intentBusinessSnapshot();
  const audits = await db.auditLog.count();
  const guard = await db.usernameNamespaceGuard.findMany();
  await expect(
    intentCaller("author").translationIntent.get(own(intent)),
  ).resolves.toMatchObject({ status: "NOT_RECORDED" });
  expect(await intentBusinessSnapshot()).toEqual(before);
  expect(await db.auditLog.count()).toBe(audits);
  expect(await db.usernameNamespaceGuard.findMany()).toEqual(guard);
  await intentCaller("author").translationIntent.stop(own(intent));
  const stopped = await intentBusinessSnapshot();
  const stoppedAudits = await db.auditLog.count();
  const stoppedGuard = await db.usernameNamespaceGuard.findMany();
  await expect(
    intentCaller("author").translationIntent.get(own(intent)),
  ).resolves.toMatchObject({ status: "STOPPED" });
  expect(await intentBusinessSnapshot()).toEqual(stopped);
  expect(await db.auditLog.count()).toBe(stoppedAudits);
  expect(await db.usernameNamespaceGuard.findMany()).toEqual(stoppedGuard);
});

it("uses fresh request generations for historical recovery without changing the original business binding", async () => {
  const intent = envelope();
  await intentWrites[0].run(intentCaller("author"), intent);
  const receipt = await db.translationIntentReceipt.findUniqueOrThrow({
    where: { actorId_intentId: own(intent) },
  });
  await db.user.update({
    where: { id: intent.actorId },
    data: { passwordHash: "synthetic-new-login-credential" },
  });
  const user = await db.user.findUniqueOrThrow({
    where: { id: intent.actorId },
  });
  const fresh = intentCaller("author", {
    sessionVersion: user.sessionVersion,
    historyAccessRevision: user.historyAccessRevision,
  });
  await expect(
    intentCaller("author").translationIntent.get(own(intent)),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(fresh.translationIntent.get(own(intent))).resolves.toMatchObject(
    { status: "ACCEPTED", draftId: receipt.draftId },
  );
  await expect(
    fresh.translationIntent.stop(own(intent)),
  ).resolves.toMatchObject({ status: "ACCEPTED", draftId: receipt.draftId });
  await expect(intentWrites[0].run(fresh, intent)).resolves.toMatchObject({
    receipt: { replayed: true },
  });
  expect(
    await db.translationIntentReceipt.findUniqueOrThrow({
      where: { actorId_intentId: own(intent) },
    }),
  ).toEqual(receipt);
  expect(await db.translationDraft.count()).toBe(1);
});

it.each([{ version: 2 }, { id: "not-a-uuid" }, { actorId: "" }])(
  "rejects unsupported transport envelopes before terminal admission: %j",
  async (change) => {
    const intent = envelope();
    const before = await intentBusinessSnapshot();
    await expect(
      intentWrites[0].run(intentCaller("author"), intent, {
        intent: { ...intent, ...change },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await intentBusinessSnapshot()).toEqual(before);
  },
);

it("never discloses transport UUID/hash/composite binding in actual keyed-write audit JSON", async () => {
  const intent = envelope();
  await intentWrites[0].run(intentCaller("author"), intent);
  const receipt = await db.translationIntentReceipt.findUniqueOrThrow({
    where: { actorId_intentId: own(intent) },
  });
  const audit = await db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
  const serialized = JSON.stringify(audit);
  for (const secret of [
    intent.id,
    receipt.inputHash!,
    JSON.stringify(own(intent)),
  ])
    expect(serialized).not.toContain(secret);
  for (const field of [
    "intentId",
    "inputHash",
    "protocolVersion",
    "actorId_intentId",
    '"intent"',
  ])
    expect(serialized).not.toContain(field);
  // The composite catalog key must remain lookup data even for recorded receipt
  // creates. Neither entityId nor any safe snapshot may smuggle its UUID.
  expect(audit.every((entry) => !entry.entityId?.includes(intent.id))).toBe(
    true,
  );
  const draft = await db.translationDraft.findUniqueOrThrow({
    where: { id: receipt.draftId! },
  });
  expect(JSON.stringify(draft.payload)).not.toContain(intent.id);
  expect(draft.payload as Prisma.JsonObject).not.toHaveProperty("intent");
});

it("keeps stop terminal for all five late operations and leaves accepted stop requests historical", async () => {
  const intent = envelope();
  await intentCaller("author").translationIntent.stop(own(intent));
  const before = await intentBusinessSnapshot();
  for (const write of intentWrites) {
    await expect(
      write.run(intentCaller("author"), intent),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      write.run(intentCaller("author"), { ...intent, mode: "PUBLISH" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }
  expect(await intentBusinessSnapshot()).toEqual(before);
  const accepted = envelope();
  await intentWrites[0].run(intentCaller("author"), accepted);
  const acceptedBefore = await intentBusinessSnapshot();
  await expect(
    intentCaller("author").translationIntent.stop(own(accepted)),
  ).resolves.toMatchObject({ status: "ACCEPTED", outcome: "DRAFT_SUBMITTED" });
  expect(await intentBusinessSnapshot()).toEqual(acceptedBefore);
});

it.each([
  { table: "Notification", actor: "author" },
  { table: "TranslationIntentReceipt", actor: "author" },
  { table: "TranslationIntentReceipt", actor: "publisher" },
] as const)(
  "rolls back $actor domain work, receipt and notices together when $table insertion fails",
  async ({ table, actor }) => {
    const before = await intentBusinessSnapshot();
    const intent = envelope(actor);
    // Genuine database failure after domain work starts, without replacing the
    // caller/helper or adding a fake post-authorization seam to production.
    await db.$executeRawUnsafe(`CREATE FUNCTION intent_atomic_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Synthetic translation transaction insertion refusal'; END $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER intent_atomic_failure BEFORE INSERT ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION intent_atomic_failure()`);
      await expect(
        intentWrites[0].run(intentCaller(actor), intent),
      ).rejects.toBeDefined();
      expect(await intentBusinessSnapshot()).toEqual(before);
      expect(
        await db.auditLog.count({
          where: {
            kind: { not: "ATTEMPT" },
            operation: "localization.setString",
          },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS intent_atomic_failure ON "${table}"`,
      );
      await db.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS intent_atomic_failure()",
      );
    }
    // A fully rolled-back failure left no prepared/terminal binding.
    await expect(
      intentWrites[0].run(intentCaller(actor), intent),
    ).resolves.toMatchObject({ receipt: { replayed: false } });
  },
);

it("cannot rewrite or delete an accepted or stopped terminal row", async () => {
  const accepted = envelope();
  const stopped = envelope();
  await intentWrites[0].run(intentCaller("author"), accepted);
  await intentCaller("author").translationIntent.stop(own(stopped));
  const before = await intentBusinessSnapshot();
  for (const intent of [accepted, stopped]) {
    const where = { actorId_intentId: own(intent) };
    await expect(
      db.translationIntentReceipt.update({
        where,
        data: { createdAt: new Date(0) },
      }),
    ).rejects.toBeDefined();
    await expect(
      db.translationIntentReceipt.delete({ where }),
    ).rejects.toBeDefined();
  }
  expect(await intentBusinessSnapshot()).toEqual(before);
});

it.each(["suspended", "retired", "voided", "deleted"] as const)(
  "does not grant %s original actors or a survivor own receipt/stop authority",
  async (state) => {
    const intent = envelope();
    await intentWrites[0].run(intentCaller("author"), intent);
    if (state === "deleted")
      await db.user.delete({ where: { id: intent.actorId } });
    else
      await db.user.update({
        where: { id: intent.actorId },
        data:
          state === "suspended"
            ? { suspendedAt: new Date() }
            : state === "retired"
              ? { mergedIntoId: intentAccounts.other.id }
              : { recoveryVoidedAt: new Date() },
      });
    const rows = await db.translationIntentReceipt.findMany();
    await expect(
      intentCaller("author").translationIntent.get(own(intent)),
    ).rejects.toBeDefined();
    await expect(
      intentCaller("author").translationIntent.stop(own(intent)),
    ).rejects.toBeDefined();
    await expect(
      intentWrites[0].run(intentCaller("author"), intent),
    ).rejects.toBeDefined();
    if (state === "retired") {
      // Retirement assigns history and rotates the survivor's generations. The
      // old login is independently denied before original-actor ownership checks.
      await expect(
        intentCaller("other").translationIntent.get(own(intent)),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        intentCaller("other").translationIntent.stop(own(intent)),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    // A distinct fresh valid survivor login still gains no execution ownership
    // of the original actor's UUID. These values are not sampled after a wait.
    const survivor = await db.user.findUniqueOrThrow({
      where: { id: intentAccounts.other.id },
    });
    const freshSurvivor = intentCaller("other", {
      sessionVersion: survivor.sessionVersion,
      historyAccessRevision: survivor.historyAccessRevision,
    });
    await expect(
      freshSurvivor.translationIntent.get(own(intent)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      freshSurvivor.translationIntent.stop(own(intent)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.translationIntentReceipt.findMany()).toEqual(rows);
  },
);
