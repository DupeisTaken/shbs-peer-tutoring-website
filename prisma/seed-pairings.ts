import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { utcDatabaseUrl } from "../src/server/database-url";
import { assertDemoDatabase } from "./demo-support";
import { seedDemoPairings } from "./demo-pairings";

const connectionString = process.env.DATABASE_URL ?? "";
assertDemoDatabase(connectionString);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: utcDatabaseUrl(connectionString) }),
});
try {
  console.log("Demo assignment groups:", await seedDemoPairings(db));
} finally {
  await db.$disconnect();
}
