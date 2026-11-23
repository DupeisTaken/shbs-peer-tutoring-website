import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_RELEASE_TAG = "help-assets-latest";
export const ARCHIVE_NAME = "help-assets-baked.tar.gz";
export const CHECKSUM_NAME = "help-assets-baked.tar.gz.sha256";

const ALLOWED_FILE =
  /^docs\/guides\/help\/(?:captures\.json|assets\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:en|zh)\.jpg)$/;
const ALLOWED_DIR = /^docs(?:\/guides(?:\/help(?:\/assets)?)?)?\/?$/;

export function isAllowedHelpTarEntry(rawEntry) {
  if (typeof rawEntry !== "string") return false;
  const entry = rawEntry.replace(/^\.\//, "");
  if (!entry || entry.startsWith("/") || entry.includes("\\")) return false;
  if (entry.split("/").some((segment) => segment === "..")) return false;
  return ALLOWED_FILE.test(entry) || ALLOWED_DIR.test(entry);
}

/** Validate `tar -tvzf` verbose lines so symlinks, hardlinks, device nodes and
 * unexpected paths are rejected before any byte is written to the workspace. */
export function validateTarListing(verboseOutput) {
  const lines = verboseOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error("Baked help archive is empty");
  }
  const files = [];
  for (const line of lines) {
    const typeChar = line[0];
    if (typeChar !== "-" && typeChar !== "d") {
      throw new Error(`Disallowed tar entry type in help archive: ${line}`);
    }
    // GNU/BSD `tar -tvzf` ends with the entry path (after timestamp).
    const match = /\s(\S+)$/.exec(line);
    const entry = match?.[1];
    if (!entry || !isAllowedHelpTarEntry(entry)) {
      throw new Error(`Disallowed path in help archive: ${line}`);
    }
    if (typeChar === "-") {
      files.push(entry.replace(/^\.\//, ""));
    }
  }
  if (!files.includes("docs/guides/help/captures.json")) {
    throw new Error("Baked help archive is missing docs/guides/help/captures.json");
  }
  return files;
}

export function verifyArchiveChecksum(archiveBytes, checksumText) {
  const match = /^\s*([a-f0-9]{64})(?:\s+\*?(\S+))?\s*$/i.exec(checksumText);
  if (!match) {
    throw new Error("Malformed SHA-256 checksum file for baked help archive");
  }
  const expected = match[1].toLowerCase();
  const listedName = match[2];
  if (listedName && path.posix.basename(listedName) !== ARCHIVE_NAME) {
    throw new Error(`Checksum file targets unexpected archive: ${listedName}`);
  }
  const actual = createHash("sha256").update(archiveBytes).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Baked help archive SHA-256 mismatch (expected ${expected}, got ${actual})`,
    );
  }
  return actual;
}

export function verifyExtractedCaptures(rootDir) {
  const manifestPath = path.join(rootDir, "docs/guides/help/captures.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest || !Array.isArray(manifest.screenshots)) {
    throw new Error("Extracted captures.json is missing a screenshots array");
  }
  for (const shot of manifest.screenshots) {
    if (
      typeof shot?.file !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:en|zh)\.jpg$/.test(shot.file)
    ) {
      throw new Error(`Invalid screenshot filename in captures.json: ${shot?.file}`);
    }
    if (typeof shot.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(shot.sha256)) {
      throw new Error(`Invalid screenshot sha256 in captures.json: ${shot.file}`);
    }
    const imagePath = path.join(rootDir, "docs/guides/help/assets", shot.file);
    if (!existsSync(imagePath)) {
      throw new Error(`Missing extracted screenshot file: ${shot.file}`);
    }
    const actual = createHash("sha256").update(readFileSync(imagePath)).digest("hex");
    if (actual !== shot.sha256) {
      throw new Error(`Extracted screenshot checksum mismatch: ${shot.file}`);
    }
  }
  return manifest.screenshots.length;
}

function defaultExec(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

export function unpackHelpAssets({
  env = process.env,
  rootDir = process.cwd(),
  exec = defaultExec,
} = {}) {
  const repo = env.GITHUB_REPOSITORY?.trim();
  const tag = env.HELP_ASSETS_RELEASE_TAG?.trim() || DEFAULT_RELEASE_TAG;
  if (!repo) {
    console.log(
      "GITHUB_REPOSITORY is unset; skipping baked help-assets release download.",
    );
    return { status: "skipped", count: 0 };
  }

  try {
    exec("gh", ["release", "view", tag, "--repo", repo, "--json", "tagName"]);
  } catch (error) {
    const stderr = String(error?.stderr ?? error?.message ?? "");
    if (/release not found|not found|HTTP 404/i.test(stderr)) {
      console.log(
        `Release '${tag}' is not published yet on ${repo}; building with clean text-only Help manifest.`,
      );
      return { status: "missing-release", count: 0 };
    }
    throw error;
  }

  const stagingDir = mkdtempSync(path.join(os.tmpdir(), "shbs-help-assets-"));
  try {
    exec("gh", [
      "release",
      "download",
      tag,
      "--repo",
      repo,
      "--pattern",
      ARCHIVE_NAME,
      "--pattern",
      CHECKSUM_NAME,
      "--dir",
      stagingDir,
    ]);
    const archivePath = path.join(stagingDir, ARCHIVE_NAME);
    const checksumPath = path.join(stagingDir, CHECKSUM_NAME);
    const sha = verifyArchiveChecksum(
      readFileSync(archivePath),
      readFileSync(checksumPath, "utf8"),
    );
    const listing = exec("tar", ["-tvzf", archivePath]);
    validateTarListing(listing);
    exec("tar", ["-xzf", archivePath, "-C", rootDir]);
    const count = verifyExtractedCaptures(rootDir);
    console.log(
      `Unpacked ${count} verified baked help screenshots from release '${tag}' (${sha.slice(0, 12)}).`,
    );
    return { status: "unpacked", count, sha };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  unpackHelpAssets();
}
