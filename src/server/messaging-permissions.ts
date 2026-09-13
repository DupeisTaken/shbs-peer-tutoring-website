import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../generated/prisma";
import {
  defaultMessageGroups,
  MESSAGE_GROUPS,
  type MessageGroup,
} from "~/lib/messaging";
import { ownedStudentIds } from "./student-ownership";
import type { DomainDb } from "./transactions";

export async function effectiveMessagePermission(db: DomainDb, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new TRPCError({ code: "NOT_FOUND" });
  const [override, role, restriction] = await Promise.all([
    db.messagePermission.findUnique({ where: { scope: `USER:${userId}` } }),
    db.messagePermission.findUnique({ where: { scope: `ROLE:${user.role}` } }),
    db.messageRestriction.findUnique({ where: { userId } }),
  ]);
  const raw =
    override?.groups ?? role?.groups ?? defaultMessageGroups(user.role);
  // Unknown stored groups fail closed rather than accidentally widening a contact list.
  const groups = raw.filter((g): g is MessageGroup =>
    MESSAGE_GROUPS.includes(g as MessageGroup),
  );
  return {
    user,
    groups,
    source: override
      ? ("USER" as const)
      : role
        ? ("ROLE" as const)
        : ("DEFAULT" as const),
    restricted: restriction?.restricted ?? false,
  };
}

/** One directional rule powers search, new sends and replies. Historical read is independent. */
export async function eligibleMessageRecipients(
  db: DomainDb,
  senderId: string,
): Promise<Prisma.UserWhereInput> {
  const permission = await effectiveMessagePermission(db, senderId);
  if (permission.restricted || permission.user.suspendedAt)
    return { id: { in: [] } };
  const groups = new Set(permission.groups);
  const union: Prisma.UserWhereInput[] = [];
  if (groups.has("MANAGEMENT"))
    union.push({ role: { in: ["HEAD", "ADMIN", "COORDINATOR"] } });
  if (
    ["CURRENT_TUTORS", "PAST_TUTORS", "SAME_GROUP"].some((g) =>
      groups.has(g as MessageGroup),
    )
  ) {
    const students = await ownedStudentIds(db, senderId);
    const current = await db.pairing.findMany({
      where: {
        term: { active: true },
        tutees: { some: { tuteeId: { in: students } } },
      },
      select: {
        id: true,
        tutorId: true,
        tutees: { select: { tuteeId: true } },
      },
    });
    const currentTutors = [...new Set(current.map((p) => p.tutorId))];
    if (groups.has("CURRENT_TUTORS"))
      union.push({ tutorId: { in: currentTutors } });
    if (groups.has("PAST_TUTORS")) {
      const history = await db.messageTutorAssignment.findMany({
        where: { tuteeId: { in: students }, tutorId: { notIn: currentTutors } },
      });
      union.push({ tutorId: { in: history.map((h) => h.tutorId) } });
    }
    if (groups.has("SAME_GROUP")) {
      // Membership in the exact scheduled pairing, never merely the same slot or quarter.
      const peers = [
        ...new Set(current.flatMap((p) => p.tutees.map((t) => t.tuteeId))),
      ];
      const owners = await db.studentProfileOwnership.findMany({
        where: { tuteeId: { in: peers } },
        select: { userId: true },
      });
      union.push({
        OR: [
          { studentId: { in: peers } },
          { id: { in: owners.map((o) => o.userId) } },
        ],
      });
    }
  }
  const restricted = await db.messageRestriction.findMany({
    where: { restricted: true },
    select: { userId: true },
  });
  const available: Prisma.UserWhereInput = {
    id: { not: senderId, notIn: restricted.map((r) => r.userId) },
    suspendedAt: null,
  };
  // Do not represent ALL as OR:[{}]: empty logical filters can be normalized away by Prisma.
  // An empty override is a deliberate denial, not an omitted logical condition.
  if (!groups.has("ALL_USERS") && union.length === 0) return { id: { in: [] } };
  return groups.has("ALL_USERS")
    ? available
    : { AND: [available, { OR: union }] };
}
