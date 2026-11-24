import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/create-admin.ts");
const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");

function runBootstrap(password: string) {
  try {
    execFileSync(process.execPath, [tsxCli, script], {
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://postgres:unused@127.0.0.1:1/unused",
        BOOTSTRAP_ADMIN_EMAIL: "bootstrap@example.test",
        BOOTSTRAP_ADMIN_PASSWORD: password,
      },
      encoding: "utf8",
      stdio: "pipe",
    });
    return { ok: true, output: "" };
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    return {
      ok: false,
      output: `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`,
    };
  }
}

it("rejects passwords shorter than 12 or longer than 1024 characters before connecting", () => {
  const shortResult = runBootstrap("short11char");
  expect(shortResult.ok).toBe(false);
  expect(shortResult.output).toContain("at least 12 characters");
  expect(shortResult.output).not.toContain("short11char");

  const oversized = "x".repeat(1025);
  const longResult = runBootstrap(oversized);
  expect(longResult.ok).toBe(false);
  expect(longResult.output).toContain("at most 1024 characters");
  expect(longResult.output).not.toContain(oversized);
});
