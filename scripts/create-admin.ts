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
    const headExists = (await tx.user.count({ where: { role: "HEAD" } })) > 0;
    const role = headExists ? "ADMIN" : "HEAD";
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
