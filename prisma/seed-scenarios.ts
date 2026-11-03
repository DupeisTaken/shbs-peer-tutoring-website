import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { utcDatabaseUrl } from "../src/server/database-url";
import { seedDemoAcademics } from "./demo-academics";
import { seedDemoScenarios } from "./demo-scenarios";
import { assertDemoDatabase } from "./demo-support";
const connectionString = process.env.DATABASE_URL ?? "";
assertDemoDatabase(connectionString);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: utcDatabaseUrl(connectionString) }),
});
try {
  console.log("Demo scenario enrichment:", await seedDemoScenarios(db));
  console.log("Demo academic additions:", await seedDemoAcademics(db));
} finally {
  await db.$disconnect();
}
