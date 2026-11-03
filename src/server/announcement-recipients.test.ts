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
          id: "a-biology",
          subject: "Biology",
          tutees: [{ tuteeId: "one" }, { tuteeId: "two" }],
        },
        { id: "a-math", subject: "Math", tutees: [{ tuteeId: "one" }] },
      ],
    },
  ]);
  const db = {
    tutor: { findMany: tutorFind },
    pairingExecutionSuccessor: { findMany: vi.fn().mockResolvedValue([]) },
    qualificationGrant: {
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
          id: true,
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

it.each(["tutor", "learner"])(
  "uses terminal assignments after a multi-hop %s transfer without erasing independent work or qualifications",
  async (kind) => {
    type Pairing = {
      id: string;
      subject: string;
      tutees: { tuteeId: string }[];
    };
    const tutors = ["a", "b", "c"].map((id) => ({
      id,
      englishName: id,
      gradeLevel: 12,
      status: id === "c" ? "ACTIVE" : "ARCHIVED",
      pairings: [] as Pairing[],
    }));
    const tutorIds = kind === "tutor" ? ["a", "b", "c"] : ["c", "c", "c"];
    for (const [index, id] of [
      "original",
      "intermediate",
      "terminal",
    ].entries()) {
      tutors
        .find((tutor) => tutor.id === tutorIds[index])!
        .pairings.push({
          id,
          subject: "Mathematics",
          tutees: [{ tuteeId: `learner-${index}` }],
        });
    }
    tutors[0]!.pairings.push({
      id: "independent",
      subject: "Science",
      tutees: [{ tuteeId: "independent-learner" }],
    });
    const before = structuredClone(tutors);
    const successors = vi
      .fn()
      .mockResolvedValue([
        { sourcePairingId: "original" },
        { sourcePairingId: "intermediate" },
      ]);
    const database = {
      tutor: { findMany: vi.fn().mockResolvedValue(tutors) },
      pairingExecutionSuccessor: { findMany: successors },
      qualificationGrant: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ tutorId: "a", subjectId: "biology" }]),
      },
      subject: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "biology", name: "Biology" }]),
      },
    } as unknown as DomainDb;
    expect(await announcementCandidates(database)).toEqual([
      {
        id: "a",
        name: "a",
        gradeLevel: 12,
        status: "ARCHIVED",
        subjects: ["Biology", "Science"],
        activeTutees: 1,
      },
      {
        id: "b",
        name: "b",
        gradeLevel: 12,
        status: "ARCHIVED",
        subjects: [],
        activeTutees: 0,
      },
      {
        id: "c",
        name: "c",
        gradeLevel: 12,
        status: "ACTIVE",
        subjects: ["Mathematics"],
        activeTutees: 1,
      },
    ]);
    expect(successors).toHaveBeenCalledOnce();
    expect(successors).toHaveBeenCalledWith({
      where: {
        sourcePairingId: {
          in: tutors.flatMap((tutor) =>
            tutor.pairings.map((pairing) => pairing.id),
          ),
        },
      },
      select: { sourcePairingId: true },
    });
    expect(tutors).toEqual(before);
  },
);
