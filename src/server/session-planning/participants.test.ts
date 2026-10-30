import { expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";
import { participantKeys, participantsOverlap } from "./participants";

it("joins current roles and retained profile aliases only through verified ownership", async () => {
  const database = {
    user: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          {
            id: "person",
            tutorId: "current-tutor",
            studentId: "current-student",
          },
        ]),
    },
    tutorProfileOwnership: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ tutorId: "retained-tutor", userId: "person" }]),
    },
    studentProfileOwnership: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ tuteeId: "retained-student", userId: "person" }]),
    },
  } as unknown as TransactionDb;
  const keys = await participantKeys(
    database,
    ["current-tutor", "retained-tutor", "other-tutor"],
    ["current-student", "retained-student", "other-student"],
  );
  expect(
    participantsOverlap(keys, "current-tutor", [], "other-tutor", [
      "retained-student",
    ]),
  ).toBe(true);
  expect(
    participantsOverlap(keys, "retained-tutor", [], "other-tutor", [
      "current-student",
    ]),
  ).toBe(true);
  expect(
    participantsOverlap(
      keys,
      "other-tutor",
      ["other-student"],
      "current-tutor",
      [],
    ),
  ).toBe(false);
});
