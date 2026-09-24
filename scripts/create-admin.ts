/**
 * Create or repair the first production administrator without running the demo seed.
 *
 * Required environment: DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD.
 * The account becomes HEAD when no HEAD exists, otherwise ADMIN. Running it again is safe and
 * intentionally resets the named account's password, making the command useful for recovery too.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma";
import { hashPassword } from "../src/server/auth/password";
import { initializeProgram } from "../src/server/program/bootstrap";

const connectionString = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
function bootstrapName(): string {
  const candidate = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  if (candidate) return candidate;
  return "Program Head";
}
const name = bootstrapName();

if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address.");
}
if (!password || password.length < 12) {
  throw new Error(
    "BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.",
  );
}
const passwordHash = hashPassword(password);

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const account = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('program:leadership', 0))`;
    const headExists = (await tx.user.count({ where: { role: "HEAD" } })) > 0;
    const existing = await tx.user.findUnique({
      where: { email },
      select: { role: true },
    });
    const role = existing?.role === "HEAD" || !headExists ? "HEAD" : "ADMIN";
    const today = new Date();
    const year = today.getUTCFullYear() - (today.getUTCMonth() < 7 ? 1 : 0);
    const schoolYear =
      process.env.BOOTSTRAP_SCHOOL_YEAR ??
      `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`;
    const quarter = process.env.BOOTSTRAP_QUARTER ?? "Q1";
    if (!["Q1", "Q2", "Q3", "Q4"].includes(quarter))
      throw new Error("BOOTSTRAP_QUARTER must be Q1, Q2, Q3 or Q4.");
    await initializeProgram(
      tx,
      schoolYear,
      quarter as "Q1" | "Q2" | "Q3" | "Q4",
    );
    return tx.user.upsert({
      where: { email },
      update: {
        name,
        role,
        passwordHash,
        mustChangePassword: false,
        emailVerifiedAt: new Date(),
      },
      create: {
        email,
        name,
        role,
        passwordHash,
        mustChangePassword: false,
        emailVerifiedAt: new Date(),
      },
      select: { email: true, role: true },
    });
  });
  console.info(
    `Created or updated ${account.email} with role ${account.role}.`,
  );
} finally {
  await db.$disconnect();
}
