import { expect, it, vi } from "vitest";
import type { DomainDb } from "~/server/transactions";
import { announcementCandidates } from "./announcement-recipients";

it("candidate attributes deduplicate active tutees and merge approved/current-term subjects", async () => {
  const tutorFind = vi.fn().mockResolvedValue([
    {
      id: "a",
      englishName: "Amy",
      gradeLevel: 12,
      status: "ACTIVE",
      pairings: [
        {
          subject: "Biology",
          tutees: [{ tuteeId: "one" }, { tuteeId: "two" }],
        },
        { subject: "Math", tutees: [{ tuteeId: "one" }] },
      ],
    },
  ]);
  const db = {
    tutor: { findMany: tutorFind },
    tutorQualification: {
      findMany: vi.fn().mockResolvedValue([
        { tutorId: "a", subjectId: "bio" },
        { tutorId: "a", subjectId: "chem" },
        { tutorId: "a", subjectId: "deleted" },
      ]),
    },
    subject: {
      findMany: vi.fn().mockResolvedValue([
        { id: "bio", name: "Biology" },
        { id: "chem", name: "Chemistry" },
      ]),
    },
  } as unknown as DomainDb;
  expect(await announcementCandidates(db)).toEqual([
    {
      id: "a",
      name: "Amy",
      gradeLevel: 12,
      status: "ACTIVE",
      subjects: ["Biology", "Chemistry", "Math"],
      activeTutees: 2,
    },
  ]);
  expect(tutorFind.mock.calls[0]?.[0]).toMatchObject({
    select: {
      pairings: {
        where: { term: { active: true } },
        select: {
          subject: true,
          tutees: {
            where: { tutee: { status: "ACTIVE" } },
            select: { tuteeId: true },
          },
        },
      },
    },
  });
});
