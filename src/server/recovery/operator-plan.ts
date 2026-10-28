import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { operatorAssert, OperatorError } from "./operator-cli";

/** Stable serialization binds the reviewed report, target and every plan input. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
export function planHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function databaseIdentity(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new OperatorError("INVALID_DATABASE_URL");
  }
  operatorAssert(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname &&
      url.pathname.length > 1 &&
      !url.hash,
    "INVALID_DATABASE_URL",
  );
  // URL options can redirect a connection through libpq. Reject them at this host boundary.
  operatorAssert(
    [...url.searchParams.keys()].every((key) =>
      [
        "sslmode",
        "schema",
        "connection_limit",
        "pool_timeout",
        "options",
      ].includes(key),
    ),
    "UNSUPPORTED_DATABASE_URL_OPTIONS",
  );
  operatorAssert(
    !url.searchParams.has("options"),
    "UNSUPPORTED_DATABASE_URL_OPTIONS",
  );
  const identity = {
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
  };
  operatorAssert(
    identity.user &&
      !Object.values(identity).some((value) => /[\u0000-\u001f]/.test(value)),
    "INVALID_DATABASE_URL",
  );
  return identity;
}
export async function writeOperatorJson(
  path: string,
  value: unknown,
): Promise<void> {
  // Exclusive creation preserves previous evidence and prevents accidental replacement.
  const file = await open(resolve(path), "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function readOperatorPlan(
  path: string,
  expectedHash: string,
): Promise<unknown> {
  operatorAssert(/^[a-f0-9]{64}$/.test(expectedHash), "INVALID_PLAN_HASH");
  const file = await open(resolve(path), "r");
  try {
    operatorAssert(
      (await file.stat()).isFile() &&
        (await file.stat()).size <= 8 * 1024 * 1024,
      "INVALID_PLAN_FILE",
    );
    let data: unknown;
    try {
      data = JSON.parse(await file.readFile("utf8"));
    } catch {
      throw new OperatorError("INVALID_PLAN_FILE");
    }
    operatorAssert(planHash(data) === expectedHash, "PLAN_HASH_MISMATCH");
    return data;
  } finally {
    await file.close();
  }
}
export async function assertRegularFile(
  path: string,
  maxSize: number,
): Promise<void> {
  const info = await stat(path);
  operatorAssert(
    info.isFile() && info.size > 0 && info.size <= maxSize,
    "INVALID_BACKUP_FILE",
  );
}
