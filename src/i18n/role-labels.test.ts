import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const roles = [
  "STUDENT",
  "VIEWER",
  "CREW",
  "TUTOR",
  "COORDINATOR",
  "ADMIN",
  "HEAD",
] as const;

it("defines every account-role label in every bundled locale", () => {
  const messagesDir = resolve(process.cwd(), "messages");
  const expected = [...roles].sort();

  for (const file of readdirSync(messagesDir).filter((name) =>
    name.endsWith(".json"),
  )) {
    const messages = JSON.parse(
      readFileSync(resolve(messagesDir, file), "utf8"),
    ) as { admin?: { users?: { roles?: Record<string, string> } } };
    const labels = messages.admin?.users?.roles ?? {};
    expect(Object.keys(labels).sort(), file).toEqual(expected);
    for (const role of roles) {
      expect(labels[role], `${file}:${role}`).toBeTruthy();
      expect(labels[role], `${file}:${role}`).not.toContain("⟦");
    }
  }
});
