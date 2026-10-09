import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Inject only the command boundary in tests: exercise promotion without Docker,
// network access, registry credentials, or changes to the caller's Git checkout.
export function publishImage(env, run) {
  const {
    GITHUB_REF: ref,
    GITHUB_EVENT_NAME: event,
    GITHUB_SHA: sha,
    GITHUB_REPOSITORY: repository,
    IMAGE_ARCHIVE: archive,
    EXPECTED_IMAGE_ID: expectedId,
  } = env;
  if (
    ref !== "refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(event)
  ) {
    throw new Error("Only main push/dispatch runs may publish images.");
  }
  if (
    !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(expectedId ?? "") ||
    !archive
  ) {
    throw new Error("Missing or malformed verified-image metadata.");
  }

  run("docker", ["load", "--input", archive]);
  const loadedId = run("docker", [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    "shbs-smoke:local",
  ]).trim();
  if (loadedId !== expectedId) {
    throw new Error("Loaded image does not match the smoke-tested image ID.");
  }

  // Match the existing metadata-action tags. Push the revision tag first, then
  // recheck main immediately before each push (especially the mutable latest tag).
  const image = `ghcr.io/${repository.toLowerCase()}`;
  for (const tag of [`${image}:sha-${sha.slice(0, 7)}`, `${image}:latest`]) {
    run("docker", ["tag", expectedId, tag]);
    const current = run("git", ["ls-remote", "origin", "refs/heads/main"])
      .trim()
      .split(/\s+/)[0];
    if (current !== sha) {
      throw new Error(
        `Refusing to publish stale commit ${sha}; origin/main is ${current || "missing"}.`,
      );
    }
    run("docker", ["push", tag]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  publishImage(process.env, (command, args) => {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (output.trim()) console.log(output.trim());
    return output;
  });
}
