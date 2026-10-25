import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { hashPassword } from "./auth/password";
import { combineAccounts, previewCombine } from "./combine-accounts";
import { linkTutorHistory, previewTutorHistory } from "./tutor-history";
import { emptyUserFilters, matchesUserFilters } from "~/lib/user-filters";

const caller = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: "directory-reviewer",
        name: "Synthetic reviewer",
        email: "reviewer@example.test",
      },
      role: "HEAD" as Session["role"],
      tutorId: null,
      expires: "2099-01-01",
    },
  });

it("keeps an accountless current enrollment discoverable behind an archived tutor representative", async () => {
  await db.person.create({
    data: { id: "mixed-filter-group", resolutionState: "REVIEW_REQUIRED" },
  });
  await db.tutor.create({
    data: {
      id: "archived-filter-source",
      englishName: "Original archive label",
      status: "ARCHIVED",
      personId: "mixed-filter-group",
    },
  });
  await db.tutee.create({
    data: {
      id: "active-filter-source",
      englishName: "Current learner label",
      status: "ACTIVE",
      intakeTermId: "current",
      personId: "mixed-filter-group",
    },
  });
  const rows = (await caller().admin.accounts()).rows;
  const group = rows.find((row) => row.personId === "mixed-filter-group")!;
  expect(group.tutorStatus).toBe("ARCHIVED");
  expect(group.currentTutee).toBe(false);
  expect(group.directoryMembers).toHaveLength(2);
  expect(matchesUserFilters(group, emptyUserFilters())).toBe(true);
  expect(
    matchesUserFilters(group, emptyUserFilters(), "Current learner label"),
  ).toBe(true);
  expect(
    matchesUserFilters(group, emptyUserFilters(), "Original archive label"),
  ).toBe(false);
  expect(
    matchesUserFilters(
      group,
      { ...emptyUserFilters(), showPastTutors: true },
      "Original archive label",
    ),
  ).toBe(true);
});

it("filters grouped tutor participation using its own lifecycle, setup and search without changing the primary badge", async () => {
  await db.user.create({
    data: {
      id: "filter-primary",
      name: "Primary learner login",
      username: "filterprimary",
      email: "filter-primary@example.test",
      role: "STUDENT",
      passwordHash: "synthetic-hash",
      emailVerifiedAt: new Date(),
    },
  });
  await db.person.create({
    data: {
      id: "tutor-filter-group",
      primaryUserId: "filter-primary",
      resolutionState: "REVIEW_REQUIRED",
    },
  });
  await db.user.update({
    where: { id: "filter-primary" },
    data: { personId: "tutor-filter-group" },
  });
  await db.tutor.update({
    where: { id: "unowned" },
    data: { personId: "tutor-filter-group" },
  });
  const group = (await caller().admin.accounts()).rows.find(
    (row) => row.personId === "tutor-filter-group",
  )!;
  expect(group).toMatchObject({
    userId: "filter-primary",
    role: "STUDENT",
    tutorId: null,
    tutorStatus: null,
    tuteeMember: false,
    account: "registered",
  });
  const filters = emptyUserFilters();
  filters.role.include = ["TUTOR"];
  filters.status.include = ["ACTIVE"];
  expect(matchesUserFilters(group, filters, "Unowned Tutor")).toBe(true);
  expect(matchesUserFilters(group, filters, "Primary learner login")).toBe(
    false,
  );
  filters.account.include = ["registered"];
  expect(matchesUserFilters(group, filters)).toBe(false);
  filters.account.include = ["none"];
  expect(matchesUserFilters(group, filters)).toBe(true);
  expect(group.tutorDestinations).toEqual([
    {
      tutorId: "unowned",
      name: "Unowned Tutor",
      username: null,
      status: "ACTIVE",
      account: "none",
      hasEmail: false,
      suspended: false,
      retainedOwnerName: null,
    },
  ]);
});

it("preserves each grouped Tutor destination's own state without exposing credentials or matching email", async () => {
  await db.person.create({
    data: { id: "destination-group", primaryUserId: "person" },
  });
  await db.user.update({
    where: { id: "person" },
    data: {
      personId: "destination-group",
      passwordHash: "private-credential-hash",
    },
  });
  await db.tutor.updateMany({
    where: { id: { in: ["direct", "unowned", "archive-1"] } },
    data: { personId: "destination-group" },
  });
  await db.tutor.update({
    where: { id: "unowned" },
    data: { email: "person@example.test", username: "sourcehandle" },
  });
  await db.registrationCode.create({
    data: {
      code: "A12BC",
      kind: "TUTOR",
      email: "person@example.test",
      expiresAt: new Date("2099-01-01"),
    },
  });
  const group = (await caller().admin.accounts()).rows.find(
    (row) => row.personId === "destination-group",
  )!;
  expect(group).toMatchObject({
    userId: "person",
    role: "ADMIN",
    account: "registered",
  });
  expect(group.tutorDestinations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        tutorId: "direct",
        name: "Current Tutor",
        account: "registered",
      }),
      expect.objectContaining({
        tutorId: "unowned",
        name: "Unowned Tutor",
        username: "sourcehandle",
        account: "none",
        hasEmail: true,
      }),
      expect.objectContaining({
        tutorId: "archive-1",
        name: "Archive One",
        account: null,
        retainedOwnerName: "Synthetic Person",
      }),
    ]),
  );
  expect(
    group.directoryMembers.some((row) => row.tutorId === "archive-1"),
  ).toBe(false);
  expect(JSON.stringify(group)).not.toContain("private-credential-hash");
  expect(JSON.stringify(group.tutorDestinations)).not.toContain(
    "person@example.test",
  );
  expect(
    group.tutorDestinations.flatMap((source) => Object.keys(source)),
  ).not.toContain("role");
  expect(
    group.tutorDestinations.some((source) => source.tutorId === "missing"),
  ).toBe(false);
});

it.each([false, true])(
  "projects a retained source's own direct-login readiness with ready=%s",
  async (ready) => {
    await db.tutorProfileOwnership.create({
      data: { tutorId: "direct", userId: "person" },
    });
    // Readiness belongs to the direct account in both states; historical
    // ownership cannot impersonate it or convert it into accountless setup.
    await db.user.update({
      where: { id: "person" },
      data: { passwordHash: ready ? "synthetic-ready-hash" : null },
    });
    const row = (await caller().admin.accounts()).rows.find(
      (entry) => entry.userId === "person",
    )!;
    expect(
      row.tutorDestinations.find((source) => source.tutorId === "direct"),
    ).toMatchObject({
      tutorId: "direct",
      account: ready ? "registered" : "setup",
      hasEmail: true,
    });
    expect(
      await db.tutorProfileOwnership.findUnique({ where: { tutorId: "direct" } }),
    ).toMatchObject({ userId: "person" });
    expect(await db.registrationCode.count()).toBe(0);
  },
);

it("retains exact archive destinations through explicit ownership even before Person backfill", async () => {
  const group = (await caller().admin.accounts()).rows.find(
    (row) => row.userId === "person",
  )!;
  expect(group.personId).toBeNull();
  expect(group.tutorDestinations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        tutorId: "archive-1",
        account: null,
        retainedOwnerName: "Synthetic Person",
      }),
      expect.objectContaining({
        tutorId: "archive-2",
        account: null,
        retainedOwnerName: "Synthetic Person",
      }),
    ]),
  );
  expect(
    group.tutorDestinations.some((source) => source.tutorId === "unowned"),
  ).toBe(false);
});

it("rejects retained archive setup before issuing invitations or changing ownership", async () => {
  await expect(
    caller().admin.sendTutorSetup({ tutorId: "archive-1" }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message:
      "This tutor record has a retained historical owner. Use existing account recovery.",
  });
  expect(await db.registrationCode.count()).toBe(0);
  expect(await db.user.count()).toBe(2);
  expect(
    await db.tutorProfileOwnership.findUnique({
      where: { tutorId: "archive-1" },
    }),
  ).toMatchObject({ userId: "person" });
});

it("preserves verified sibling visibility when the designated login still needs verification", async () => {
  await db.user.createMany({
    data: [
      {
        id: "pending-filter",
        name: "Pending identity",
        username: "pendingfilter",
        email: "pending-filter@example.test",
        role: "STUDENT",
      },
      {
        id: "verified-filter",
        name: "Verified identity",
        username: "verifiedfilter",
        email: "verified-filter@example.test",
        role: "STUDENT",
        emailVerifiedAt: new Date(),
        passwordHash: "synthetic-hash",
      },
    ],
  });
  await db.person.create({
    data: {
      id: "verification-filter-group",
      primaryUserId: "pending-filter",
      resolutionState: "REVIEW_REQUIRED",
    },
  });
  await db.user.updateMany({
    where: { id: { in: ["pending-filter", "verified-filter"] } },
    data: { personId: "verification-filter-group" },
  });
  const group = (await caller().admin.accounts()).rows.find(
    (row) => row.personId === "verification-filter-group",
  )!;
  expect(group).toMatchObject({
    userId: "pending-filter",
    account: "setup",
    emailVerifiedAt: null,
  });
  expect(matchesUserFilters(group, emptyUserFilters())).toBe(true);
  expect(
    matchesUserFilters(group, emptyUserFilters(), "Verified identity"),
  ).toBe(true);
  expect(
    matchesUserFilters(group, emptyUserFilters(), "Pending identity"),
  ).toBe(false);
});

it("keeps retained historical aliases searchable only with their actual owning member", async () => {
  await db.person.create({
    data: { id: "alias-filter-group", primaryUserId: "person" },
  });
  await db.user.update({
    where: { id: "person" },
    data: { personId: "alias-filter-group" },
  });
  await db.tutor.update({
    where: { id: "archive-1" },
    data: { personId: "alias-filter-group" },
  });
  await db.tutor.update({
    where: { id: "unowned" },
    data: { personId: "alias-filter-group" },
  });
  const group = (await caller().admin.accounts()).rows.find(
    (row) => row.personId === "alias-filter-group",
  )!;
  const filters = emptyUserFilters();
  filters.role.include = ["ADMIN"];
  expect(matchesUserFilters(group, filters, "Archive One")).toBe(true);
  expect(matchesUserFilters(group, filters, "Unowned Tutor")).toBe(false);
  expect(
    group.directoryMembers.find((member) => member.userId === "person")
      ?.searchTerms,
  ).toContain("Archive One");
});

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw new Error(
      "Account directory tests require isolated local shbs_shipping_test",
    );
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.term.createMany({
    data: [
      {
        id: "current",
        schoolYear: "26-27",
        quarter: "Q1",
        name: "Current",
        active: true,
      },
      {
        id: "old",
        schoolYear: "23-24",
        quarter: "Q1",
        name: "Old",
        active: false,
      },
    ],
  });
  await db.tutor.createMany({
    data: [
      {
        id: "direct",
        englishName: "Current Tutor",
        status: "PENDING",
        gradeLevel: 12,
      },
      {
        id: "archive-1",
        englishName: "Archive One",
        status: "ARCHIVED",
        gradeLevel: 9,
        gradeSchoolYear: "23-24",
      },
      {
        id: "archive-2",
        englishName: "Archive Two",
        status: "GRADUATED",
        gradeLevel: 10,
        gradeSchoolYear: "24-25",
      },
      { id: "unowned", englishName: "Unowned Tutor", status: "ACTIVE" },
    ],
  });
  await db.tutee.createMany({
    data: [
      {
        id: "direct-student",
        englishName: "Current Student",
        status: "ACTIVE",
        intakeTermId: "current",
      },
      {
        id: "retained-student",
        englishName: "Past Student",
        status: "INACTIVE",
        intakeTermId: "old",
        gradeLevel: "9",
      },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: "directory-reviewer",
        email: "reviewer@example.test",
        role: "HEAD",
        username: "reviewer",
      },
      {
        id: "person",
        name: "Synthetic Person",
        email: "person@example.test",
        username: "person",
        role: "ADMIN",
        tutorId: "direct",
        studentId: "direct-student",
        tuteeMember: true,
        canTranslate: true,
        crewStatus: "INACTIVE",
        emailVerifiedAt: new Date(),
        mustChangePassword: false,
      },
    ],
  });
  await db.academicProfile.create({
    data: {
      userId: "person",
      status: "REPORTED",
      gradeLevel: 12,
      schoolYear: "26-27",
      confirmedAt: new Date(),
      reconfirmRequired: false,
    },
  });
  await db.tutorProfileOwnership.createMany({
    data: ["archive-1", "archive-2"].map((tutorId) => ({
      tutorId,
      userId: "person",
    })),
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: "retained-student", userId: "person" },
  });
});
afterAll(() => db.$disconnect());

it("shows one accountless person across tutor and tutee records without hiding unrelated namesakes", async () => {
  await db.person.create({ data: { id: "accountless-person" } });
  await db.tutor.update({
    where: { id: "unowned" },
    data: { personId: "accountless-person" },
  });
  await db.tutee.createMany({
    data: [
      {
        id: "unowned-past",
        englishName: "Unowned Tutor",
        status: "INACTIVE",
        intakeTermId: "old",
        personId: "accountless-person",
      },
      {
        id: "unrelated-past",
        englishName: "Unowned Tutor",
        status: "INACTIVE",
        intakeTermId: "old",
      },
    ],
  });
  const { rows } = await caller().admin.accounts();
  expect(
    rows.filter((row) => row.personId === "accountless-person"),
  ).toHaveLength(1);
  expect(
    rows.find((row) => row.personId === "accountless-person"),
  ).toMatchObject({
    userId: null,
    combinedRecordCount: 2,
    identityReviewRequired: false,
  });
  expect(rows.some((row) => row.tuteeId === "unrelated-past")).toBe(true);
  const details = await caller().admin.accountDetails({ tutorId: "unowned" });
  expect(details.group?.tutees.map((row) => row.id)).toEqual(["unowned-past"]);
  expect(details.group?.users).toEqual([]);
  expect(await db.user.count()).toBe(2);
});

it("keeps both unresolved live logins reachable in one directory identity without unioning memberships", async () => {
  await db.user.create({
    data: {
      id: "other-login",
      name: "Other recorded name",
      email: "other@example.test",
      role: "VIEWER",
    },
  });
  await db.person.create({
    data: {
      id: "pending-person",
      primaryUserId: "person",
      resolutionState: "REVIEW_REQUIRED",
    },
  });
  await db.user.updateMany({
    where: { id: { in: ["person", "other-login"] } },
    data: { personId: "pending-person" },
  });
  const { rows } = await caller().admin.accounts();
  const row = rows.find((entry) => entry.personId === "pending-person");
  expect(
    rows.filter((entry) => entry.personId === "pending-person"),
  ).toHaveLength(1);
  expect(row).toMatchObject({
    userId: "person",
    role: "ADMIN",
    identityReviewRequired: true,
  });
  expect(row?.personSearchTerms).toContain("Other recorded name");
  const details = await caller().admin.accountDetails({ userId: "person" });
  expect(details.group?.users.map((member) => member.id)).toEqual([
    "other-login",
    "person",
  ]);
  expect(
    await caller().admin.accountProfile({ userId: "other-login" }),
  ).toMatchObject({
    userId: "other-login",
    name: "Other recorded name",
    profileVersion: 0,
  });
});

it("represents retained archives once under the account while keeping unowned roster rows", async () => {
  const { rows } = await caller().admin.accounts();
  expect(rows.filter((row) => row.userId === "person")).toHaveLength(1);
  expect(rows.find((row) => row.userId === "person")).toMatchObject({
    tutorId: "direct",
    hasTutorHistory: true,
    hasTuteeHistory: true,
  });
  expect(
    rows.filter((row) => row.userId === null).map((row) => row.tutorId),
  ).toEqual(["unowned"]);
  expect(await db.tutor.count()).toBe(4);
  expect(await db.tutee.count()).toBe(2);
  const details = await caller().admin.accountDetails({ userId: "person" });
  expect(details.retained.map((record) => record.id).sort()).toEqual([
    "archive-1",
    "archive-2",
    "retained-student",
  ]);
});

it("removes an accountless directory row after linking and a repeated link preserves the original roster", async () => {
  await db.tutor.update({
    where: { id: "unowned" },
    data: { status: "ARCHIVED" },
  });
  await db.user.update({
    where: { id: "person" },
    data: { passwordHash: "synthetic-ready-password" },
  });
  const original = await db.tutor.findUniqueOrThrow({
    where: { id: "unowned" },
  });
  expect(
    (await caller().admin.accounts()).rows.some(
      (row) => row.userId === null && row.tutorId === original.id,
    ),
  ).toBe(true);
  // Exercise the real ownership workflow; directory consolidation must be a projection,
  // not another account mutation or destruction of the imported source record.
  for (let attempt = 0; attempt < 2; attempt++) {
    const pair = { tutorId: original.id, userId: "person" };
    await linkTutorHistory(db, "directory-reviewer", {
      ...pair,
      fingerprint: (await previewTutorHistory(db, pair)).fingerprint,
      reason: "Reviewed original imported records and confirmed identity",
      acknowledged: true,
    });
    const { rows } = await caller().admin.accounts();
    expect(rows.filter((row) => row.userId === "person")).toHaveLength(1);
    expect(
      rows.some((row) => row.userId === null && row.tutorId === original.id),
    ).toBe(false);
  }
  const retained = await db.tutor.findUniqueOrThrow({
    where: { id: original.id },
  });
  expect(retained.personId).toBe(
    (await db.user.findUniqueOrThrow({ where: { id: "person" } })).personId,
  );
  expect({ ...retained, personId: original.personId }).toEqual(original);
  expect(
    (await caller().admin.tutors()).some((row) => row.id === original.id),
  ).toBe(true);
  expect(
    (await caller().admin.accountDetails({ userId: "person" })).retained
      .map((record) => record.id)
      .sort(),
  ).toEqual(["archive-1", "archive-2", "retained-student", "unowned"]);
  expect(
    await db.auditLog.count({ where: { operation: "tutorHistory.link" } }),
  ).toBe(1);
});

it("uses historical visibility for a tutor-history-only account without granting tutor membership", async () => {
  await db.studentProfileOwnership.deleteMany({ where: { userId: "person" } });
  await db.user.update({
    where: { id: "person" },
    data: {
      role: "STUDENT",
      tutorId: null,
      studentId: null,
      tuteeMember: false,
      canTranslate: false,
      crewStatus: null,
    },
  });
  const row = (await caller().admin.accounts()).rows.find(
    (entry) => entry.userId === "person",
  )!;
  expect(row).toMatchObject({
    tutorId: null,
    hasTutorHistory: true,
    hasTuteeHistory: false,
  });
  expect(matchesUserFilters(row, emptyUserFilters())).toBe(false);
  expect(
    matchesUserFilters(row, { ...emptyUserFilters(), showPastTutors: true }),
  ).toBe(true);
  expect(
    (await caller().admin.accountDetails({ userId: "person" })).membership
      ?.tutor,
  ).toBe(false);
});

it("keeps combined historical ownership under the surviving directory account", async () => {
  const password = "Directory-combine-review-493!";
  const passwordHash = hashPassword(password);
  await db.user.update({
    where: { id: "directory-reviewer" },
    data: { passwordHash },
  });
  await db.user.update({ where: { id: "person" }, data: { passwordHash } });
  await db.user.create({
    data: {
      id: "duplicate-directory",
      role: "ADMIN",
      email: "duplicate-directory@example.test",
      username: "duplicate-directory",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });
  await db.tutorProfileOwnership.update({
    where: { tutorId: "archive-1" },
    data: { userId: "duplicate-directory" },
  });
  await db.studentProfileOwnership.update({
    where: { tuteeId: "retained-student" },
    data: { userId: "duplicate-directory" },
  });
  const original = await db.tutor.findUniqueOrThrow({
    where: { id: "archive-1" },
  });
  const pair = { survivorId: "person", duplicateId: "duplicate-directory" };
  const preview = await previewCombine(db, pair);
  expect(preview.conflicts).toEqual([]);
  await combineAccounts(db, "directory-reviewer", {
    ...pair,
    fingerprint: preview.fingerprint,
    confirmPassword: password,
  });
  const { rows } = await caller().admin.accounts();
  expect(rows.filter((row) => row.userId === "person")).toHaveLength(1);
  expect(rows.some((row) => row.userId === pair.duplicateId)).toBe(false);
  expect(
    rows.filter((row) => row.userId === null).map((row) => row.tutorId),
  ).toEqual(["unowned"]);
  expect(
    (await caller().admin.accountDetails({ userId: "person" })).retained
      .map((record) => record.id)
      .sort(),
  ).toEqual(["archive-1", "archive-2", "retained-student"]);
  const retained = await db.tutor.findUniqueOrThrow({
    where: { id: "archive-1" },
  });
  expect(retained.personId).toBe(
    (await db.user.findUniqueOrThrow({ where: { id: "person" } })).personId,
  );
  expect({ ...retained, personId: original.personId }).toEqual(original);
  expect(
    await db.user.findUnique({ where: { id: pair.duplicateId } }),
  ).toMatchObject({ mergedIntoId: "person", passwordHash: null });
});

it("requires actual credentials for setup readiness and never exposes their hash", async () => {
  let { rows } = await caller().admin.accounts();
  expect(rows.find((row) => row.userId === "person")?.account).toBe("setup");
  await db.user.update({
    where: { id: "person" },
    data: { passwordHash: "synthetic-opaque-hash" },
  });
  rows = (await caller().admin.accounts()).rows;
  expect(rows.find((row) => row.userId === "person")?.account).toBe(
    "registered",
  );
  expect(JSON.stringify(rows)).not.toContain("synthetic-opaque-hash");
  expect(rows.every((row) => !("passwordHash" in row))).toBe(true);
  await db.user.update({
    where: { id: "person" },
    data: { mustChangePassword: true },
  });
  expect(
    (await caller().admin.accounts()).rows.find(
      (row) => row.userId === "person",
    )?.account,
  ).toBe("setup");
});

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "%s can read separate attachments and several retained records without writes",
  async (role) => {
    await db.user.update({
      where: { id: "directory-reviewer" },
      data: { role },
    });
    const before = await db.user.findUnique({ where: { id: "person" } });
    const result = await caller().admin.accountDetails({ userId: "person" });
    expect(result.membership).toMatchObject({
      rank: "ADMIN",
      tutor: true,
      tutee: true,
      translator: true,
      crew: true,
    });
    expect(result.attached.map((row) => row.id).sort()).toEqual([
      "direct",
      "direct-student",
    ]);
    expect(result.retained.map((row) => row.id).sort()).toEqual([
      "archive-1",
      "archive-2",
      "retained-student",
    ]);
    expect(
      result.retained.every(
        (row) => row.academic.expectedGraduationYear === 2027,
      ),
    ).toBe(true);
    expect(
      result.retained.every((row) => row.academic.needsConfirmation === false),
    ).toBe(true);
    expect(await db.user.findUnique({ where: { id: "person" } })).toEqual(
      before,
    );
    expect(await db.historicalAcademicRecord.count()).toBe(0);
    expect(result).not.toHaveProperty("passwordHash");
  },
);

it.each(["VIEWER", "TUTOR", "STUDENT", "CREW"] as const)(
  "denies %s even with a stale Head session",
  async (role) => {
    await db.user.update({
      where: { id: "directory-reviewer" },
      data: { role },
    });
    await expect(
      caller().admin.accountDetails({ userId: "person" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().admin.accountDetails({ tutorId: "archive-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().admin.accounts()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  },
);

it("distinguishes roster-only records with retained owners and keeps revoked capability separate", async () => {
  const owned = await caller().admin.accountDetails({ tutorId: "archive-1" });
  expect(owned.membership).toBeNull();
  expect(owned.attached[0]).toMatchObject({
    direct: false,
    retainedOwner: { id: "person" },
    academic: { schoolYear: "23-24", gradeLevel: 9 },
  });
  expect(
    (await caller().admin.accountDetails({ tutorId: "unowned" })).attached[0]
      ?.retainedOwner,
  ).toBeNull();
  await db.user.update({
    where: { id: "person" },
    data: {
      tutorAccessRevoked: true,
      suspendedAt: new Date(),
      suspendedReason: "Synthetic restriction",
    },
  });
  const revoked = await caller().admin.accountDetails({ userId: "person" });
  expect(revoked.membership).toMatchObject({ tutor: false, tutee: true });
  expect(revoked.attached).toHaveLength(2);
  expect(revoked.suspendedReason).toBe("Synthetic restriction");
});

it("uses saved original academics after reactivation and in the existing tutor detail dialog", async () => {
  await db.historicalAcademicRecord.create({
    data: {
      id: "legacy-tutor:direct",
      tutorId: "direct",
      rawGrade: "7",
      schoolYear: "20-21",
      source: "LEGACY_TUTOR",
    },
  });
  const result = await caller().admin.accountDetails({ userId: "person" });
  expect(result.attached.find((row) => row.id === "direct")).toMatchObject({
    historical: true,
    academic: {
      gradeLevel: 7,
      schoolYear: "20-21",
      expectedGraduationYear: 2026,
      needsConfirmation: false,
    },
  });
  expect(await caller().tutorDetails.get({ tutorId: "direct" })).toMatchObject({
    historicalGrade: true,
    academic: {
      gradeLevel: 7,
      schoolYear: "20-21",
      expectedGraduationYear: 2026,
      needsConfirmation: false,
    },
  });
});

it("does not infer missing enrollment years from today's program year and rejects missing records", async () => {
  await db.tutor.update({
    where: { id: "archive-1" },
    data: { gradeSchoolYear: null },
  });
  expect(
    (await caller().admin.accountDetails({ tutorId: "archive-1" })).attached[0]
      ?.academic.expectedGraduationYear,
  ).toBeNull();
  await expect(
    caller().admin.accountDetails({ userId: "missing" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    caller().admin.accountDetails({ tutorId: "missing" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
