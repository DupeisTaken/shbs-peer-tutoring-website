import { createHash, randomUUID } from "node:crypto";
import { APP_TITLE } from "~/lib/branding";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma, type SchoolHoursSchedule } from "../../generated/prisma";
import { schoolHoursExportName } from "~/lib/school-hours-name";
import { programDateTimeInput } from "~/lib/program-time";
import { getProgramTimeZone } from "./program/time-zone";
import { getFeatures } from "./program/features";
import { isEmailDeliveryAvailable } from "./email/sender";
import { emailOrigin } from "./email/urls";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { lockUsernameNamespace } from "./auth/username-namespace";
import { isSerializationFailure } from "./auth/username-snapshot";
import { databaseScope } from "./db-scope";
import {
  schoolHoursBaselineInput,
  schoolHoursCarrySchema,
  schoolHoursComponentsSchema,
  schoolHoursGenerateInput,
  schoolHoursSettingsInput,
  schoolHoursSnapshotSchema,
  type SchoolHoursBaselineInput,
  type SchoolHoursComponents,
  type SchoolHoursGenerateInput,
  type SchoolHoursSettingsInput,
  type SchoolHoursSnapshot,
} from "./school-hours-input";
import {
  nextSchoolHoursOccurrence,
  schoolHoursDueAt,
  shiftMonth,
} from "./school-hours-time";
import {
  issueSchoolHoursToken,
  schoolHoursTokenHash,
  schoolHoursTokenMatches,
} from "./school-hours-link";
import { schoolHoursEmailCopy } from "./school-hours-email";
import {
  quantizeSchoolHours,
  sumSchoolHoursCarry,
} from "./school-hours-posting";
import {
  publicSchoolHoursReport,
  schoolHoursCsv as publicSchoolHoursCsv,
} from "./school-hours-public";

export { schoolHoursSettingsInput, schoolHoursSnapshotSchema };
export const schoolHoursLock = "school-hours-chain";
export const schoolHoursCategory = "school_hours";
const keys = ["earned", "extras", "deductions", "crew"] as const;
const zero = (): SchoolHoursComponents => ({
  earned: 0,
  extras: 0,
  deductions: 0,
  crew: 0,
});
// Stored decimal values are authoritative. Decimal arithmetic prevents source
// order/reconciliation from inventing binary floating-point correction hours.
const sum = (...values: number[]) =>
  values
    .reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
    .toNumber();
const minus = (left: number, right: number) =>
  new Prisma.Decimal(left).minus(right).toNumber();
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "The school report changed. Reload and review it again.",
  });
const invalid = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message });
type Blocker = { code: string; beneficiaryId?: string; message: string };
const sourceSchema = z.object({
  key: z.string(),
  beneficiaryId: z.string(),
  component: z.enum(keys),
  value: z.number().finite().nonnegative(),
  ownerKind: z.enum(["user", "tutor"]),
  ownerId: z.string(),
});
const personSchema = z.object({
  beneficiaryId: z.string(),
  schoolAccountKey: z.string(),
  components: schoolHoursComponentsSchema,
  carryHours: schoolHoursCarrySchema.default("0"),
  provenanceUserIds: z.array(z.string()),
  provenanceTutorIds: z.array(z.string()),
});
const baselineSchema = z.object({
  people: z.array(personSchema),
  sources: z.array(sourceSchema),
  consumedOpeningIds: z.array(z.string()).optional(),
});
type Baseline = z.infer<typeof baselineSchema>;
type Person = z.infer<typeof personSchema>;
const emptyBaseline = (): Baseline => ({ people: [], sources: [] });
const parseBaseline = (value: unknown) =>
  value == null ? emptyBaseline() : baselineSchema.parse(value);
const nameSelect = {
  firstName: true,
  lastName: true,
  preferredName: true,
  alternativeNames: true,
  legacyName: true,
} as const;
type NameParts = SchoolHoursSnapshot["rows"][number]["nameParts"];
type CurrentPerson = {
  beneficiaryId: string;
  exportName: string;
  nameParts: NameParts;
  components: SchoolHoursComponents;
  provenanceUserIds: string[];
  provenanceTutorIds: string[];
  sourceCount: number;
};

async function snapshotTransaction<T>(
  db: DomainDb,
  work: (tx: TransactionDb) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await inTransaction(db, work, {
        isolationLevel: "RepeatableRead",
      });
    } catch (error) {
      const unique =
        !!error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002";
      if (
        attempt >= 2 ||
        databaseScope.getStore() ||
        !(isSerializationFailure(error) || unique)
      )
        throw error;
    }
  }
}
async function fence(tx: TransactionDb) {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
}
async function actor(tx: TransactionDb, actorId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR SHARE`;
  const user = await tx.user.findUnique({
    where: { id: actorId },
    select: {
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  if (
    !user ||
    user.suspendedAt ||
    user.mergedIntoId ||
    user.recoveryVoidedAt ||
    !["ADMIN", "HEAD"].includes(user.role)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator access required.",
    });
}
async function audit(
  tx: TransactionDb,
  userId: string | null,
  operation: string,
  entityId: string,
  details: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({
    data: {
      userId,
      operation: `schoolHours.${operation}`,
      entity: "SchoolHoursReport",
      entityId,
      action: "Changed school service-hours reporting",
      details,
    },
  });
}

/** Explicit ownership and retirement edges are identity evidence. Names, shared
 * Person rows and email addresses never join beneficiaries. */
async function collect(db: DomainDb) {
  const [users, tutors, sessions, adjustments, patrols, imported] =
    await Promise.all([
      db.user.findMany({
        select: {
          id: true,
          ...nameSelect,
          name: true,
          tutorId: true,
          mergedIntoId: true,
        },
      }),
      db.tutor.findMany({
        select: {
          id: true,
          ...nameSelect,
          englishName: true,
          nameFieldsConfirmed: true,
          retainedOwner: { select: { userId: true } },
        },
      }),
      db.session.findMany({
        select: { id: true, tutorId: true, shCount: true },
        orderBy: { id: "asc" },
      }),
      db.serviceHourAdjustment.findMany({
        select: { id: true, tutorId: true, type: true, amount: true },
        orderBy: { id: "asc" },
      }),
      db.patrol.findMany({
        select: { id: true, crewUserId: true, hours: true },
        orderBy: { id: "asc" },
      }),
      db.importedRecordProvenance.findMany({
        where: {
          entity: { in: ["Session", "ServiceHourAdjustment", "Patrol"] },
        },
        select: { entity: true, recordId: true },
      }),
    ]);
  const importedKeys = new Set(
    imported.map((row) => `${row.entity}:${row.recordId}`),
  );
  const importedSourceKeys = new Set(
    imported.map(
      (row) =>
        `${row.entity === "Session" ? "session" : row.entity === "Patrol" ? "patrol" : "adjustment"}:${row.recordId}`,
    ),
  );
  const archivedSourceKeys = new Set<string>();
  const archived = (entity: string, id: string, sourceKey: string) => {
    if (!importedKeys.has(`${entity}:${id}`)) return false;
    archivedSourceKeys.add(sourceKey);
    return true;
  };
  const blockers: Blocker[] = [];
  const userMap = new Map(users.map((user) => [user.id, user]));
  const tutorMap = new Map(tutors.map((tutor) => [tutor.id, tutor]));
  const rootUser = (id: string): string | null => {
    const seen = new Set<string>();
    let user = userMap.get(id);
    while (user?.mergedIntoId) {
      if (seen.has(user.id)) return null;
      seen.add(user.id);
      user = userMap.get(user.mergedIntoId);
    }
    return user?.id ?? null;
  };
  const tutorKey = (id: string): string | null => {
    const tutor = tutorMap.get(id);
    if (!tutor) return null;
    const owners = users
      .filter((user) => user.tutorId === id)
      .map((user) => user.id);
    if (tutor.retainedOwner) owners.push(tutor.retainedOwner.userId);
    const roots = [...new Set(owners.map(rootUser))];
    if (roots.includes(null) || roots.length > 1) return null;
    return roots[0] ? `user:${roots[0]}` : `tutor:${id}`;
  };
  const resolve = (id: string) =>
    id.startsWith("user:")
      ? rootUser(id.slice(5))
        ? `user:${rootUser(id.slice(5))}`
        : null
      : id.startsWith("tutor:")
        ? tutorKey(id.slice(6))
        : null;
  const people = new Map<string, CurrentPerson>();
  const componentTotals = new Map<
    string,
    Record<(typeof keys)[number], Prisma.Decimal>
  >();
  const sources: Baseline["sources"] = [];
  function add(
    kind: "user" | "tutor",
    ownerId: string,
    key: string,
    component: (typeof keys)[number],
    value: number,
  ) {
    const beneficiaryId =
      kind === "user" ? resolve(`user:${ownerId}`) : tutorKey(ownerId);
    if (!beneficiaryId) {
      blockers.push({
        code: "OWNERSHIP_CONFLICT",
        message: "A source has missing or conflicting explicit ownership.",
      });
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      blockers.push({
        code: "SOURCE_VALUE_INVALID",
        beneficiaryId,
        message: "A stored credit or deduction has an invalid amount.",
      });
      return;
    }
    let person = people.get(beneficiaryId);
    const canonicalProfile = beneficiaryId.startsWith("user:")
      ? userMap.get(beneficiaryId.slice(5))
      : null;
    const profile =
      kind === "tutor"
        ? (tutorMap.get(canonicalProfile?.tutorId ?? ownerId) ??
          tutorMap.get(ownerId)!)
        : userMap.get(beneficiaryId.slice(5))!;
    const confirmed =
      "nameFieldsConfirmed" in profile ? profile.nameFieldsConfirmed : true;
    if (!person) {
      person = {
        beneficiaryId,
        exportName: schoolHoursExportName(profile),
        nameParts: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          preferredName: profile.preferredName,
          alternativeNames: profile.alternativeNames,
          legacyName: profile.legacyName,
          confirmed,
        },
        components: zero(),
        provenanceUserIds: [],
        provenanceTutorIds: [],
        sourceCount: 0,
      };
      people.set(beneficiaryId, person);
      componentTotals.set(beneficiaryId, {
        earned: new Prisma.Decimal(0),
        extras: new Prisma.Decimal(0),
        deductions: new Prisma.Decimal(0),
        crew: new Prisma.Decimal(0),
      });
    }
    if (kind === "tutor" && !person.provenanceTutorIds.includes(ownerId))
      person.provenanceTutorIds.push(ownerId);
    if (kind === "user" && !person.provenanceUserIds.includes(ownerId))
      person.provenanceUserIds.push(ownerId);
    if (
      beneficiaryId.startsWith("user:") &&
      !person.provenanceUserIds.includes(beneficiaryId.slice(5))
    )
      person.provenanceUserIds.push(beneficiaryId.slice(5));
    const totals = componentTotals.get(beneficiaryId)!;
    totals[component] = totals[component].plus(value);
    person.sourceCount++;
    sources.push({
      key,
      beneficiaryId,
      component,
      value,
      ownerKind: kind,
      ownerId,
    });
  }
  // Stored archive hours remain available in rosters/history. Importing evidence
  // alone never certifies new school credit, even for an already-reviewed owner.
  for (const row of sessions)
    if (!archived("Session", row.id, `session:${row.id}`))
      add("tutor", row.tutorId, `session:${row.id}`, "earned", row.shCount);
  // Reconciliation IDs (meeting absences/interview awards) are logical source
  // keys, so delete/recreate with the same ID never becomes a second deduction.
  for (const row of adjustments)
    if (!archived("ServiceHourAdjustment", row.id, `adjustment:${row.id}`))
      add(
        "tutor",
        row.tutorId,
        `adjustment:${row.id}`,
        row.type === "EXTRA" ? "extras" : "deductions",
        row.amount,
      );
  for (const row of patrols)
    if (!archived("Patrol", row.id, `patrol:${row.id}`))
      add("user", row.crewUserId, `patrol:${row.id}`, "crew", row.hours);
  for (const person of people.values())
    for (const key of keys)
      person.components[key] = componentTotals
        .get(person.beneficiaryId)!
        [key].toNumber();
  sources.sort((a, b) => a.key.localeCompare(b.key));
  return {
    people,
    sources,
    blockers,
    resolve,
    userMap,
    tutorMap,
    archivedSourceKeys,
    importedSourceKeys,
  };
}

async function accounting(db: DomainDb) {
  const config = await db.schoolHoursSchedule.findUnique({
    where: { id: "program" },
  });
  const head = config?.headReportId
    ? await db.schoolHoursReport.findUniqueOrThrow({
        where: { id: config.headReportId },
      })
    : null;
  const current = await collect(db);
  const opening = parseBaseline(config?.openingBaseline);
  const committed = head ? parseBaseline(head.sourceBaseline) : emptyBaseline();
  const priorRows = head
    ? schoolHoursSnapshotSchema.parse(head.snapshot).rows
    : [];
  const previous = new Map<string, Person>();
  const blockers = [...current.blockers];
  // Reimporting a deleted logical source must not turn its committed credit into
  // a negative correction. Such a boundary change needs explicit reconciliation.
  for (const source of [...committed.sources, ...opening.sources]) {
    if (
      current.importedSourceKeys.has(source.key) &&
      !blockers.some(
        (blocker) =>
          blocker.code === "IMPORTED_SOURCE_REQUIRES_RECONCILIATION" &&
          blocker.beneficiaryId === source.beneficiaryId,
      )
    )
      blockers.push({
        code: "IMPORTED_SOURCE_REQUIRES_RECONCILIATION",
        beneficiaryId: source.beneficiaryId,
        message:
          "Previously reviewed school-reporting evidence was restored as an archive. Reconcile its reporting boundary before issuing.",
      });
  }
  const resolvePerson = (person: Person) => {
    const direct = current.resolve(person.beneficiaryId);
    if (direct) return direct;
    // Tutor profile removal is safe only when its retained account still proves
    // who owns the frozen balance; account loss is never a silent reversal.
    const roots = [
      ...new Set(
        person.provenanceUserIds
          .map((id) => current.resolve(`user:${id}`))
          .filter((id): id is string => !!id),
      ),
    ];
    return roots.length === 1 ? roots[0]! : null;
  };
  // Consumption follows the reviewed opening entry, not today's merged account.
  // A newly reviewed balance can later retire into a previously reported owner;
  // dropping it by canonical equality would report its historical hours twice.
  const consumedOpeningIds = new Set(
    committed.consumedOpeningIds ??
      committed.people.map((person) => person.beneficiaryId),
  );
  for (const person of [
    ...committed.people,
    ...opening.people.filter(
      (person) => !consumedOpeningIds.has(person.beneficiaryId),
    ),
  ]) {
    const id = resolvePerson(person);
    if (!id) {
      blockers.push({
        code: "OWNER_MISSING",
        beneficiaryId: person.beneficiaryId,
        message:
          "A previously reported participant lost its ownership evidence. Restore or reconcile the account first.",
      });
      continue;
    }
    const old = previous.get(id);
    if (old && old.schoolAccountKey !== person.schoolAccountKey)
      blockers.push({
        code: "ACCOUNT_MAPPING_CONFLICT",
        beneficiaryId: id,
        message: "Combined account balances have different school identifiers.",
      });
    if (old) {
      for (const key of keys)
        old.components[key] = sum(old.components[key], person.components[key]);
      old.carryHours = sumSchoolHoursCarry([old.carryHours, person.carryHours]);
    } else
      previous.set(id, {
        ...person,
        beneficiaryId: id,
        components: { ...person.components },
      });
  }
  for (const source of head ? committed.sources : opening.sources) {
    const next = current.sources.find((row) => row.key === source.key);
    const oldOwner = current.resolve(source.beneficiaryId);
    if (next && oldOwner !== next.beneficiaryId)
      blockers.push({
        code: "SOURCE_OWNER_CHANGED",
        beneficiaryId: next.beneficiaryId,
        message:
          "A previously reported source moved to another owner. Reconcile ownership first.",
      });
    if (
      !next &&
      !(source.ownerKind === "user"
        ? current.userMap.has(source.ownerId)
        : current.tutorMap.has(source.ownerId))
    )
      blockers.push({
        code: "OWNER_MISSING",
        beneficiaryId: source.beneficiaryId,
        message:
          "A source owner disappeared together with reported evidence. Restore or reconcile the account first.",
      });
  }
  const accounts = new Map<string, string>();
  for (const person of previous.values()) {
    const other = accounts.get(person.schoolAccountKey);
    if (other && other !== person.beneficiaryId)
      blockers.push({
        code: "DUPLICATE_ACCOUNT_MAPPING",
        beneficiaryId: person.beneficiaryId,
        message: "Two independent participants share one school identifier.",
      });
    accounts.set(person.schoolAccountKey, person.beneficiaryId);
  }
  const ids = [
    ...new Set([...current.people.keys(), ...previous.keys()]),
  ].sort();
  const participants = ids.map((id) => {
    const live = current.people.get(id),
      old = previous.get(id);
    if (!old)
      blockers.push({
        code: "BASELINE_REQUIRED",
        beneficiaryId: id,
        message:
          "Review this participant's school identifier and opening already-reported balances.",
      });
    const priorRow = priorRows.find(
      (row) => current.resolve(row.beneficiaryId) === id,
    );
    return {
      beneficiaryId: id,
      exportName:
        live?.exportName ?? priorRow?.exportName ?? "Retained participant",
      schoolAccountKey: old?.schoolAccountKey ?? null,
      current: live?.components ?? zero(),
      alreadyReported: old?.components ?? null,
      carryHours: old?.carryHours ?? "0",
      needsReview: !old,
      sourceCount: live?.sourceCount ?? 0,
    };
  });
  return {
    config,
    head,
    current,
    previous,
    participants,
    blockers,
    contentHash: digest({
      baselineVersion: config?.baselineVersion ?? 0,
      head: head?.id ?? null,
      participants,
      sources: current.sources,
      archivedSourceKeys: [...current.archivedSourceKeys].sort(),
      blockers,
    }),
  };
}

export async function schoolHoursBaselinePreview(db: DomainDb) {
  return snapshotTransaction(db, async (tx) => {
    const result = await accounting(tx);
    return {
      contentHash: result.contentHash,
      baselineVersion: result.config?.baselineVersion ?? 0,
      headReportId: result.head?.id ?? null,
      participants: result.participants,
      blockers: result.blockers,
      archivedSourceCount: result.current.archivedSourceKeys.size,
    };
  });
}

export async function reviewSchoolHoursBaseline(
  db: DomainDb,
  raw: SchoolHoursBaselineInput,
  actorId: string,
) {
  const input = schoolHoursBaselineInput.parse(raw);
  return snapshotTransaction(db, async (tx) => {
    await fence(tx);
    await actor(tx, actorId);
    await lockEntity(tx, schoolHoursLock);
    const result = await accounting(tx);
    if (
      result.contentHash !== input.expectedContentHash ||
      (result.config?.baselineVersion ?? 0) !== input.expectedBaselineVersion
    )
      throw conflict();
    const opening = parseBaseline(result.config?.openingBaseline);
    for (const row of input.participants) {
      const live = result.current.people.get(row.beneficiaryId);
      if (!live)
        throw invalid(
          "The participant is no longer present in the reviewed sources.",
        );
      if (result.head && result.previous.has(row.beneficiaryId))
        throw invalid(
          "Committed balances cannot be overwritten. Correct source records and issue an incremental correction.",
        );
      const person: Person = {
        beneficiaryId: row.beneficiaryId,
        schoolAccountKey: row.schoolAccountKey,
        components: {
          earned: row.earned,
          extras: row.extras,
          deductions: row.deductions,
          crew: row.crew,
        },
        carryHours: "0",
        provenanceUserIds: live.provenanceUserIds,
        provenanceTutorIds: live.provenanceTutorIds,
      };
      opening.people = opening.people.filter(
        (old) => old.beneficiaryId !== row.beneficiaryId,
      );
      opening.people.push(person);
    }
    opening.people.sort((a, b) =>
      a.beneficiaryId.localeCompare(b.beneficiaryId),
    );
    const mappings = opening.people.map((row) => row.schoolAccountKey);
    if (new Set(mappings).size !== mappings.length)
      throw invalid(
        "Each independent participant needs a distinct school identifier.",
      );
    // A partial review anchors only its selected people. Preserve everyone
    // else's reviewed ownership evidence rather than adopting a background read.
    const reviewed = new Set(
      input.participants.map((row) => row.beneficiaryId),
    );
    opening.sources = [
      ...opening.sources.filter(
        (source) =>
          !reviewed.has(
            result.current.resolve(source.beneficiaryId) ??
              source.beneficiaryId,
          ),
      ),
      ...result.current.sources.filter((source) =>
        reviewed.has(source.beneficiaryId),
      ),
    ].sort((left, right) => left.key.localeCompare(right.key));
    const baselineVersion = input.expectedBaselineVersion + 1;
    await tx.schoolHoursSchedule.upsert({
      where: { id: "program" },
      create: {
        id: "program",
        timeZone: await getProgramTimeZone(tx),
        openingBaseline: opening,
        baselineVersion,
        openingReviewedAt: new Date(),
      },
      update: {
        openingBaseline: opening,
        baselineVersion,
        openingReviewedAt: new Date(),
      },
    });
    await audit(tx, actorId, "reviewBaseline", "program", {
      baselineVersion,
      participants: input.participants.length,
      reason: input.reason,
    });
    return { baselineVersion };
  });
}

export function schoolHoursConfig(
  row: SchoolHoursSchedule | null,
  zone: string,
) {
  return {
    enabled: row?.enabled ?? false,
    recipientEmails: row?.recipientEmails ?? [],
    recipientLabels: (row?.recipientLabels ?? {}) as Record<string, string>,
    timeZone: row?.timeZone ?? zone,
    includeStatistics: row?.includeStatistics ?? false,
    dateOverrides: (row?.dateOverrides ?? {}) as Record<string, string>,
    version: row?.version ?? 0,
    baselineVersion: row?.baselineVersion ?? 0,
    openingReviewedAt: row?.openingReviewedAt ?? null,
    nextMonth: row?.nextMonth ?? null,
    nextDueAt: row?.nextDueAt ?? null,
  };
}
export async function validateSchoolHoursSettings(
  db: DomainDb,
  raw: SchoolHoursSettingsInput,
) {
  const input = schoolHoursSettingsInput.parse(raw);
  for (const month of Object.keys(input.dateOverrides))
    schoolHoursDueAt(month, input.timeZone, input.dateOverrides);
  if (input.enabled) {
    if (!(await getFeatures(db)).SERVICE_HOURS)
      throw invalid("Service hours is turned off.");
    if (!input.recipientEmails.length)
      throw invalid("Select at least one school recipient.");
    const result = await accounting(db);
    if (!result.config?.openingReviewedAt || result.blockers.length)
      throw invalid(
        "Review every opening balance and resolve the ownership blockers before enabling reporting.",
      );
    if (!process.env.AUTH_SECRET?.trim())
      throw invalid("Configure secure report links before enabling reporting.");
  }
  return input;
}
export async function saveSchoolHoursSettings(
  db: DomainDb,
  raw: SchoolHoursSettingsInput,
  actorId: string,
) {
  return snapshotTransaction(db, async (tx) => {
    await fence(tx);
    await actor(tx, actorId);
    await lockEntity(tx, schoolHoursLock);
    const input = await validateSchoolHoursSettings(tx, raw);
    const before = await tx.schoolHoursSchedule.findUnique({
      where: { id: "program" },
    });
    if ((before?.version ?? 0) !== input.expectedVersion) throw conflict();
    const next = input.enabled
      ? before?.enabled && before.nextMonth
        ? {
            month: before.nextMonth,
            dueAt: schoolHoursDueAt(
              before.nextMonth,
              input.timeZone,
              input.dateOverrides,
            ),
          }
        : nextSchoolHoursOccurrence(new Date(), input)
      : null;
    const { expectedVersion, ...fields } = input;
    // Older clients omit labels. Preserve retained mailboxes' labels while
    // removing labels for deleted recipients; an explicit empty map clears all.
    const recipientLabels =
      input.recipientLabels ??
      Object.fromEntries(
        Object.entries(
          schoolHoursConfig(before, input.timeZone).recipientLabels,
        ).filter(([email]) => input.recipientEmails.includes(email)),
      );
    const row = await tx.schoolHoursSchedule.upsert({
      where: { id: "program" },
      create: {
        id: "program",
        ...fields,
        recipientLabels,
        version: expectedVersion + 1,
        nextMonth: next?.month ?? null,
        nextDueAt: next?.dueAt ?? null,
      },
      update: {
        ...fields,
        recipientLabels,
        version: expectedVersion + 1,
        nextMonth: next?.month ?? null,
        nextDueAt: next?.dueAt ?? null,
        lastGenerationError: null,
      },
    });
    await tx.emailDelivery.updateMany({
      where: {
        category: schoolHoursCategory,
        status: { in: ["PENDING", "FAILED", "BLOCKED"] },
        OR: [
          { recipient: { notIn: input.recipientEmails } },
          ...(!input.enabled ? [{ schoolHoursReminderSourceId: null }] : []),
        ],
      },
      data: {
        status: "SKIPPED",
        lastError: input.enabled ? "RECIPIENT_REMOVED" : "SCHEDULE_OFF",
        completedAt: new Date(),
        leaseUntil: null,
      },
    });
    await audit(tx, actorId, "save", "program", {
      version: row.version,
      enabled: row.enabled,
      recipientCount: row.recipientEmails.length,
    });
    return { config: schoolHoursConfig(row, row.timeZone) };
  });
}

async function preview(db: DomainDb, month: string) {
  const state = await accounting(db);
  const config = schoolHoursConfig(state.config, await getProgramTimeZone(db));
  const headSnapshot = state.head
    ? schoolHoursSnapshotSchema.parse(state.head.snapshot)
    : null;
  const sameMonth = state.head?.month === month;
  const priorEditions = sameMonth
    ? (
        await db.schoolHoursReport.findMany({
          where: {
            scheduleId: "program",
            month,
            revision: { lte: state.head!.revision },
          },
          orderBy: { revision: "asc" },
          select: { revision: true, snapshot: true },
        })
      ).map((edition) => ({
        revision: edition.revision,
        snapshot: schoolHoursSnapshotSchema.parse(edition.snapshot),
      }))
    : [];
  const blockers = [...state.blockers];
  if (!config.openingReviewedAt)
    blockers.push({
      code: "OPENING_NOT_REVIEWED",
      message: "Review the opening balances before the first school issue.",
    });
  if (state.head && month < state.head.month)
    blockers.push({
      code: "ANCESTOR_MONTH",
      message:
        "An older issue cannot replace a later committed balance. Include corrections in the next issue.",
    });
  if (month > programDateTimeInput(new Date(), config.timeZone).slice(0, 7))
    blockers.push({
      code: "FUTURE_MONTH",
      message: "Future report occurrences cannot be issued yet.",
    });
  const rows = state.participants.map((participant) => {
    const live = state.current.people.get(participant.beneficiaryId);
    const frozenName = headSnapshot?.rows.find(
      (row) =>
        state.current.resolve(row.beneficiaryId) === participant.beneficiaryId,
    )?.nameParts;
    const previous = participant.alreadyReported ?? zero(),
      current = participant.current;
    const change = {
      earned: minus(current.earned, previous.earned),
      extras: minus(current.extras, previous.extras),
      deductions: minus(current.deductions, previous.deductions),
      crew: minus(current.crew, previous.crew),
    };
    const tutoringChange = sum(
        change.earned,
        change.extras,
        -change.deductions,
      ),
      crewChange = change.crew;
    // The source baseline advances in full, but only positive whole tenths are posted.
    // The signed remainder travels with this person's baseline, even across
    // months and ownership retirement. Preview and mail retries never consume it.
    const { hoursToAdd, carryOutHours } = quantizeSchoolHours(
      sum(tutoringChange, crewChange),
      participant.carryHours,
    );
    const oldRow = headSnapshot?.rows.filter(
      (row) =>
        state.current.resolve(row.beneficiaryId) === participant.beneficiaryId,
    );
    const oldMonth = oldRow?.length
      ? sum(...oldRow.map((row) => row.monthAmount))
      : null;
    const previousMonthAmount = sameMonth
      ? (oldRow?.[0]?.previousMonthAmount ?? null)
      : state.head?.month === shiftMonth(month, -1)
        ? oldMonth
        : null;
    const monthAmount = sameMonth ? sum(oldMonth ?? 0, hoursToAdd) : hoursToAdd;
    // School recipients may have applied an older edition and missed an email.
    // Freeze a correction from every prior edition; choosing a row is a school
    // ledger decision, never another advance of our financial baseline.
    const editionCorrections = priorEditions.map((edition) => {
      const amount = sum(
        ...edition.snapshot.rows
          .filter(
            (row) =>
              state.current.resolve(row.beneficiaryId) ===
              participant.beneficiaryId,
          )
          .map((row) => row.monthAmount),
      );
      return {
        revision: edition.revision,
        monthAmount: amount,
        correctionToCurrent: minus(monthAmount, amount),
      };
    });
    return {
      beneficiaryId: participant.beneficiaryId,
      exportName: participant.exportName,
      schoolAccountKey: participant.schoolAccountKey ?? "",
      nameParts: live?.nameParts ??
        frozenName ?? {
          firstName: null,
          lastName: null,
          preferredName: null,
          alternativeNames: null,
          legacyName: participant.exportName,
          confirmed: false,
        },
      current,
      previous,
      change,
      tutoringChange,
      crewChange,
      hoursToAdd,
      carryInHours: participant.carryHours,
      carryOutHours,
      monthAmount,
      previousEditionAmount: sameMonth ? oldMonth : null,
      previousMonthAmount,
      monthComparison:
        previousMonthAmount == null
          ? null
          : minus(monthAmount, previousMonthAmount),
      unchanged: keys.every((key) => change[key] === 0) && hoursToAdd === 0,
      priorEditions: editionCorrections,
    };
  });
  const totals = {
    people: rows.length,
    tutoringChange: 0,
    crewChange: 0,
    hoursToAdd: 0,
    monthAmount: 0,
  };
  for (const row of rows) {
    totals.tutoringChange = sum(totals.tutoringChange, row.tutoringChange);
    totals.crewChange = sum(totals.crewChange, row.crewChange);
    totals.hoursToAdd = sum(totals.hoursToAdd, row.hoursToAdd);
    totals.monthAmount = sum(totals.monthAmount, row.monthAmount);
  }
  const snapshot: SchoolHoursSnapshot = {
    schemaVersion: 1,
    postingPolicy: "TENTH_HOUR_CARRY_NONNEGATIVE",
    month,
    revision: sameMonth ? state.head!.revision + 1 : 1,
    generatedAt: new Date().toISOString(),
    timeZone: config.timeZone,
    predecessorId: state.head?.id ?? null,
    supersedesId: sameMonth ? state.head!.id : null,
    rows,
    totals,
    includeStatistics: config.includeStatistics,
  };
  const contentHash = digest({
    configVersion: config.version,
    baselineVersion: config.baselineVersion,
    recipients: config.recipientEmails,
    snapshot: { ...snapshot, generatedAt: null },
    sources: state.current.sources,
    archivedSourceKeys: [...state.current.archivedSourceKeys].sort(),
    blockers,
  });
  return {
    ...snapshot,
    generatedAt: new Date(snapshot.generatedAt),
    configVersion: config.version,
    baselineVersion: config.baselineVersion,
    expectedHeadId: state.head?.id ?? null,
    contentHash,
    blockers,
    email: schoolHoursEmailCopy({
      brand: APP_TITLE,
      iconUrl: `${emailOrigin()}/icon.png`,
      report: snapshot,
      reportUrl: "#school-report-preview",
      preview: true,
    }),
    state,
    snapshot,
  };
}
export async function previewSchoolHours(db: DomainDb, month: string) {
  return snapshotTransaction(db, async (tx) => {
    const result = await preview(tx, month);
    return {
      ...result.snapshot,
      generatedAt: result.generatedAt,
      configVersion: result.configVersion,
      baselineVersion: result.baselineVersion,
      expectedHeadId: result.expectedHeadId,
      contentHash: result.contentHash,
      blockers: result.blockers,
      email: result.email,
      archivedSourceCount: result.state.current.archivedSourceKeys.size,
    };
  });
}

async function createReport(
  tx: TransactionDb,
  config: SchoolHoursSchedule,
  month: string,
  generationKey: string,
  generationHash: string,
  actorId: string | null,
  reason: string | null,
  dueAt: Date | null,
  expected?: SchoolHoursGenerateInput,
) {
  const result = await preview(tx, month);
  if (
    expected &&
    (expected.expectedVersion !== config.version ||
      expected.expectedBaselineVersion !== config.baselineVersion ||
      expected.expectedHeadId !== config.headReportId ||
      expected.expectedContentHash !== result.contentHash)
  )
    throw conflict();
  if (result.blockers.length) throw invalid(result.blockers[0]!.message);
  if (result.supersedesId && !reason)
    throw invalid("Give a reason for the incremental correction.");
  const id = randomUUID();
  const baseline: Baseline = {
    people: result.rows.map((row) => ({
      beneficiaryId: row.beneficiaryId,
      schoolAccountKey: row.schoolAccountKey,
      components: row.current,
      carryHours: row.carryOutHours ?? "0",
      provenanceUserIds:
        result.state.current.people.get(row.beneficiaryId)?.provenanceUserIds ??
        result.state.previous.get(row.beneficiaryId)?.provenanceUserIds ??
        [],
      provenanceTutorIds:
        result.state.current.people.get(row.beneficiaryId)
          ?.provenanceTutorIds ??
        result.state.previous.get(row.beneficiaryId)?.provenanceTutorIds ??
        [],
    })),
    sources: result.state.current.sources,
    consumedOpeningIds: [
      ...new Set([
        ...(parseBaseline(result.state.head?.sourceBaseline)
          .consumedOpeningIds ??
          parseBaseline(result.state.head?.sourceBaseline).people.map(
            (person) => person.beneficiaryId,
          )),
        ...parseBaseline(config.openingBaseline).people.map(
          (person) => person.beneficiaryId,
        ),
      ]),
    ].sort(),
  };
  const report = await tx.schoolHoursReport.create({
    data: {
      id,
      scheduleId: "program",
      month,
      revision: result.revision,
      predecessorId: config.headReportId,
      supersedesId: result.supersedesId,
      configVersion: config.version,
      baselineVersion: config.baselineVersion,
      timeZone: config.timeZone,
      generatedAt: new Date(result.snapshot.generatedAt),
      dueAt,
      snapshot: result.snapshot,
      sourceBaseline: baseline,
      intendedRecipients: config.recipientEmails,
      contentHash: result.contentHash,
      generationKey,
      generationHash,
      generatedById: actorId,
      reason,
      linkTokenHash: schoolHoursTokenHash(issueSchoolHoursToken(id, 1)),
    },
  });
  if (result.supersedesId) {
    await tx.schoolHoursReport.update({
      where: { id: result.supersedesId },
      data: { supersededById: id },
    });
    await tx.emailDelivery.updateMany({
      where: {
        schoolHoursReportId: result.supersedesId,
        status: { in: ["PENDING", "FAILED", "BLOCKED"] },
      },
      data: {
        status: "SKIPPED",
        lastError: "SUPERSEDED",
        completedAt: new Date(),
        leaseUntil: null,
      },
    });
  }
  const program = await tx.programSettings.findUnique({
    where: { id: "program" },
    select: { emailNotificationsEnabled: true },
  });
  const blocked = !program?.emailNotificationsEnabled
    ? "EMAIL_OFF"
    : !isEmailDeliveryAvailable("PROGRAM")
      ? "TRANSPORT_UNAVAILABLE"
      : null;
  await tx.emailDelivery.createMany({
    data: config.recipientEmails.map((recipient) => ({
      category: schoolHoursCategory,
      event: "school_hours_report",
      recipient,
      schoolHoursReportId: id,
      status: blocked ? "BLOCKED" : "PENDING",
      lastError: blocked,
      destination: `/admin/service-hours/school-reports/${id}`,
    })),
  });
  await tx.schoolHoursSchedule.update({
    where: { id: "program" },
    data: { headReportId: id, lastGenerationError: null },
  });
  await audit(tx, actorId, actorId ? "generate" : "sweep", id, {
    month,
    revision: report.revision,
    people: result.rows.length,
    recipientCount: config.recipientEmails.length,
    predecessorId: config.headReportId,
    reason,
  });
  return {
    reportId: id,
    revision: report.revision,
    queued: blocked ? 0 : config.recipientEmails.length,
  };
}
export async function generateSchoolHours(
  db: DomainDb,
  raw: SchoolHoursGenerateInput,
  actorId: string,
) {
  const input = schoolHoursGenerateInput.parse(raw);
  return snapshotTransaction(db, async (tx) => {
    await fence(tx);
    await actor(tx, actorId);
    await lockEntity(tx, schoolHoursLock);
    const generationKey = `manual:${actorId}:${input.requestId}`,
      generationHash = digest(input);
    const old = await tx.schoolHoursReport.findUnique({
      where: { generationKey },
    });
    if (old) {
      if (old.generationHash !== generationHash) throw conflict();
      return {
        reportId: old.id,
        revision: old.revision,
        queued: old.intendedRecipients.length,
      };
    }
    if (!(await getFeatures(tx)).SERVICE_HOURS)
      throw invalid("Service hours is turned off.");
    const config = await tx.schoolHoursSchedule.findUnique({
      where: { id: "program" },
    });
    if (!config?.enabled)
      throw invalid("Enable school reporting before issuing a report.");
    return createReport(
      tx,
      config,
      input.month,
      generationKey,
      generationHash,
      actorId,
      input.reason ?? null,
      null,
      input,
    );
  });
}
export async function sweepSchoolHours(db: DomainDb, now = new Date()) {
  const due = await db.schoolHoursSchedule.findUnique({
    where: { id: "program" },
  });
  if (!due?.enabled || !due.nextMonth || !due.nextDueAt || due.nextDueAt > now)
    return { generated: false };
  return snapshotTransaction(db, async (tx) => {
    await fence(tx);
    await lockEntity(tx, schoolHoursLock);
    const config = await tx.schoolHoursSchedule.findUnique({
      where: { id: "program" },
    });
    if (
      !config?.enabled ||
      !config.nextMonth ||
      !config.nextDueAt ||
      config.nextDueAt > now ||
      !(await getFeatures(tx)).SERVICE_HOURS
    )
      return { generated: false };
    const existing = await tx.schoolHoursReport.findFirst({
      where: { scheduleId: "program", month: config.nextMonth },
    });
    const result = await preview(tx, config.nextMonth);
    const covered =
      !!existing ||
      (!!result.state.head && result.state.head.month > config.nextMonth);
    if (!covered && result.blockers.length) {
      if (config.lastGenerationError !== result.blockers[0]!.code) {
        await tx.schoolHoursSchedule.update({
          where: { id: "program" },
          data: { lastGenerationError: result.blockers[0]!.code },
        });
        await audit(tx, null, "sweepBlocked", "program", {
          month: config.nextMonth,
          blocker: result.blockers[0]!.code,
        });
      }
      return { generated: false, blocked: result.blockers[0]!.code };
    }
    // A manual later issue has already consumed all source history. Skip this
    // ancestor occurrence rather than trying to revise it or stalling forever.
    const receipt = covered
      ? null
      : await createReport(
          tx,
          config,
          config.nextMonth,
          `automatic:${config.nextMonth}`,
          digest({ month: config.nextMonth }),
          null,
          null,
          config.nextDueAt,
        );
    const nextMonth = shiftMonth(config.nextMonth, 1);
    await tx.schoolHoursSchedule.update({
      where: { id: "program" },
      data: {
        nextMonth,
        nextDueAt: schoolHoursDueAt(
          nextMonth,
          config.timeZone,
          config.dateOverrides as Record<string, string>,
        ),
      },
    });
    if (covered)
      await audit(tx, null, "occurrenceSkipped", "program", {
        month: config.nextMonth,
        nextMonth,
        headReportId: config.headReportId,
        reason: "ALREADY_COVERED",
      });
    return { generated: !!receipt, ...receipt };
  });
}

function deliveryCounts(deliveries: { status: string; attempts: number }[]) {
  const result = {
    queued: 0,
    retrying: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
  };
  for (const row of deliveries) {
    if (row.status === "PENDING")
      result[row.attempts ? "retrying" : "queued"]++;
    else if (row.status === "SENDING") result.sending++;
    else if (row.status === "SENT") result.sent++;
    else if (row.status === "FAILED") result.failed++;
    else if (row.status === "SKIPPED") result.skipped++;
    else if (row.status === "BLOCKED") result.blocked++;
  }
  return result;
}
export async function getSchoolHoursSettings(db: DomainDb, role: string) {
  const [row, reports, zone, features, program] = await Promise.all([
    db.schoolHoursSchedule.findUnique({ where: { id: "program" } }),
    db.schoolHoursReport.findMany({
      orderBy: { generatedAt: "desc" },
      take: 24,
      include: {
        deliveries: {
          where: { schoolHoursReminderSourceId: null },
          select: { status: true, attempts: true },
        },
      },
    }),
    getProgramTimeZone(db),
    getFeatures(db),
    db.programSettings.findUnique({
      where: { id: "program" },
      select: { emailNotificationsEnabled: true },
    }),
  ]);
  return {
    config: schoolHoursConfig(row, zone),
    canApply: ["ADMIN", "HEAD"].includes(role),
    canEdit: ["ADMIN", "HEAD", "COORDINATOR"].includes(role),
    canGenerate: ["ADMIN", "HEAD"].includes(role),
    serviceHoursEnabled: features.SERVICE_HOURS,
    transportAvailable: isEmailDeliveryAvailable("PROGRAM"),
    optionalEmailEnabled: program?.emailNotificationsEnabled ?? false,
    headReportId: row?.headReportId ?? null,
    recentReports: reports.map((report) => ({
      id: report.id,
      month: report.month,
      revision: report.revision,
      generatedAt: report.generatedAt,
      predecessorId: report.predecessorId,
      supersedesId: report.supersedesId,
      supersededById: report.supersededById,
      revokedAt: report.linkRevokedAt,
      linkVersion: report.linkVersion,
      head: row?.headReportId === report.id,
      deliveryCounts: deliveryCounts(report.deliveries),
      status: report.supersededById
        ? "SUPERSEDED"
        : report.linkRevokedAt
          ? "REVOKED"
          : "ISSUED",
    })),
  };
}
export async function getSchoolHoursReport(db: DomainDb, id: string) {
  const report = await db.schoolHoursReport.findUnique({
    where: { id },
    include: {
      deliveries: {
        select: {
          id: true,
          recipient: true,
          status: true,
          attempts: true,
          lastError: true,
          completedAt: true,
          availableAt: true,
          schoolHoursLinkOpenedAt: true,
          schoolHoursReminderSourceId: true,
          schoolHoursScheduledFor: true,
        },
      },
    },
  });
  if (!report) throw new TRPCError({ code: "NOT_FOUND" });
  let linkUrl: string | null = null;
  if (!report.linkRevokedAt && !report.supersededById) {
    try {
      const token = issueSchoolHoursToken(id, report.linkVersion);
      if (schoolHoursTokenMatches(token, report.linkTokenHash))
        linkUrl = `/reports/service-hours/${token}`;
    } catch {
      /* History and CSV remain readable if link issuance is unavailable. */
    }
  }
  return {
    ...schoolHoursSnapshotSchema.parse(report.snapshot),
    generatedAt: report.generatedAt,
    id,
    configVersion: report.configVersion,
    baselineVersion: report.baselineVersion,
    reason: report.reason,
    deliveries: report.deliveries,
    linkVersion: report.linkVersion,
    revokedAt: report.linkRevokedAt,
    supersededById: report.supersededById,
    linkUrl,
  };
}
export async function schoolHoursCsv(db: DomainDb, id: string) {
  const report = await getSchoolHoursReport(db, id);
  return publicSchoolHoursCsv(
    publicSchoolHoursReport({
      ...report,
      generatedAt: report.generatedAt.toISOString(),
    }),
  );
}
export async function retrySchoolHoursReport(
  db: DomainDb,
  id: string,
  actorId: string,
) {
  return snapshotTransaction(db, async (tx) => {
    await fence(tx);
    await actor(tx, actorId);
    await lockEntity(tx, schoolHoursLock);
    const report = await tx.schoolHoursReport.findUnique({ where: { id } }),
      config = await tx.schoolHoursSchedule.findUnique({
        where: { id: "program" },
      });
    if (
      !report ||
      !config?.enabled ||
      report.linkRevokedAt ||
      report.supersededById
    )
      throw invalid(
        "This report cannot be sent. Check its current link and schedule.",
      );
    const result = await tx.emailDelivery.updateMany({
      where: {
        schoolHoursReportId: id,
        schoolHoursReminderSourceId: null,
        recipient: { in: config.recipientEmails },
        status: { in: ["FAILED", "BLOCKED"] },
      },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        completedAt: null,
        leaseUntil: null,
        lastError: null,
      },
    });
    await audit(tx, actorId, "retry", id, { retried: result.count });
    return { retried: result.count };
  });
}
export async function changeSchoolHoursLink(
  db: DomainDb,
  id: string,
  actorId: string,
  reissue: boolean,
  expectedLinkVersion: number,
) {
  return snapshotTransaction(db, async (tx) => {
    await fence(tx);
    await actor(tx, actorId);
    await lockEntity(tx, schoolHoursLock);
    const report = await tx.schoolHoursReport.findUnique({ where: { id } });
    if (!report) throw new TRPCError({ code: "NOT_FOUND" });
    if (expectedLinkVersion !== report.linkVersion) throw conflict();
    if (reissue && report.supersededById)
      throw invalid("A superseded issue cannot receive a new link.");
    // Revocation changes the reviewed link state too. Advancing its version
    // prevents an older reissue confirmation from silently undoing revocation.
    // A fresh repeat revoke is a no-op and does not consume another version.
    if (!reissue && report.linkRevokedAt) return { revoked: true as const };
    const linkVersion = report.linkVersion + 1,
      token = reissue ? issueSchoolHoursToken(id, linkVersion) : null;
    await tx.schoolHoursReport.update({
      where: { id },
      data: reissue
        ? {
            linkVersion,
            linkTokenHash: schoolHoursTokenHash(token!),
            linkRevokedAt: null,
          }
        : { linkVersion, linkRevokedAt: new Date() },
    });
    // Settle reminders bound to the invalidated capability immediately, so a
    // fresh personal link never shows an old reminder as still scheduled.
    await tx.emailDelivery.updateMany({
      where: {
        schoolHoursReportId: id,
        schoolHoursReminderSourceId: { not: null },
        status: { in: ["PENDING", "BLOCKED", "FAILED"] },
      },
      data: {
        status: "SKIPPED",
        lastError: reissue ? "LINK_CHANGED" : "LINK_REVOKED",
        completedAt: new Date(),
        leaseUntil: null,
      },
    });
    await audit(tx, actorId, reissue ? "reissueLink" : "revokeLink", id, {
      linkVersion,
    });
    return reissue
      ? { linkVersion, url: `/reports/service-hours/${token!}` }
      : { revoked: true as const };
  });
}
