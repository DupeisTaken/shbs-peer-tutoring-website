import "dotenv/config";
import { db } from "../src/server/db";
import { changeSchoolDeparture } from "../src/server/school-departure";

/** Explicit operator migration, never a runtime status-to-permission shortcut.
 * Default is a dry run. Repeated application skips already-confirmed accounts. */
const apply = process.argv.includes("--apply");
let cursor: string | undefined;
let eligible = 0,
  skipped = 0,
  confirmed = 0;
try {
  while (true) {
    const accounts = await db.user.findMany({
      where: { tutor: { status: "GRADUATED" }, schoolDeparture: { is: null } },
      include: { tutor: true },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!accounts.length) break;
    for (const account of accounts) {
      cursor = account.id;
      const activeStudent = await db.tutee.count({
        where: {
          status: { in: ["ACTIVE", "PENDING"] },
          OR: [
            { id: account.studentId ?? "" },
            {
              id: {
                in: (
                  await db.studentProfileOwnership.findMany({
                    where: { userId: account.id },
                    select: { tuteeId: true },
                  })
                ).map((o) => o.tuteeId),
              },
            },
          ],
        },
      });
      if (
        account.suspendedAt ||
        account.tutorAccessRevoked ||
        account.role === "VIEWER" ||
        activeStudent
      ) {
        skipped++;
        console.log(
          JSON.stringify({
            userId: account.id,
            result: "manual-review",
            reason:
              "revoked, suspended, exclusive Viewer or active learning participation",
          }),
        );
        continue;
      }
      eligible++;
      console.log(
        JSON.stringify({
          userId: account.id,
          result: apply ? "applying" : "eligible",
        }),
      );
      if (apply) {
        await changeSchoolDeparture(
          db,
          {
            userId: account.id,
            action: "GRADUATED",
            expectedRevision: 0,
            explanation:
              "Backfilled explicit pre-existing tutor graduation; account identity retained.",
          },
          null,
          "LEGACY_GRADUATED_TUTOR",
        );
        confirmed++;
      }
    }
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      eligible,
      skipped,
      confirmed,
    }),
  );
} finally {
  await db.$disconnect();
}
