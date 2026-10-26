import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function hashFile(source, metadata) {
  // Images are inspected read-only. Refuse a swapped symlink on platforms with
  // O_NOFOLLOW, and stream from the checked handle rather than buffer file data.
  const handle = await open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.dev !== metadata.dev ||
      before.ino !== metadata.ino
    )
      throw new Error(`File changed during inventory: ${source}`);
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      hash.update(chunk);
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error(`File changed during inventory: ${source}`);
    return { size: before.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

/** Canonical filesystem evidence for an immutable runtime tree.
 * Timestamps are deliberately excluded: assembly/build timing is not runtime
 * content. Ownership, permissions, types, file bytes and literal links are kept.
 */
export async function inventory(root) {
  const directory = path.resolve(root);
  if (!(await lstat(directory)).isDirectory())
    throw new Error(`Inventory root must be a real directory: ${directory}`);
  const entries = [];
  async function visit(relative) {
    const source = path.join(directory, ...relative.split("/"));
    const metadata = await lstat(source);
    const type = metadata.isDirectory()
      ? "directory"
      : metadata.isFile()
        ? "file"
        : metadata.isSymbolicLink()
          ? "symlink"
          : null;
    if (!type) throw new Error(`Unsupported filesystem object: ${source}`);
    const entry = {
      path: relative,
      type,
      mode: metadata.mode & 0o7777,
      uid: metadata.uid,
      gid: metadata.gid,
    };
    if (type === "file") Object.assign(entry, await hashFile(source, metadata));
    if (type === "symlink") entry.target = await readlink(source);
    entries.push(entry);
    // lstat/readlink keep dangling, external and directory links as single
    // entries. No target resolution or recursive traversal through links occurs.
    if (type === "directory") {
      for (const name of (await readdir(source)).sort())
        await visit(relative ? `${relative}/${name}` : name);
    }
  }
  await visit("");
  return entries.sort((first, second) =>
    first.path < second.path ? -1 : first.path > second.path ? 1 : 0,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3) {
    console.error("Usage: node runtime-file-inventory.mjs ROOT");
    process.exitCode = 64;
  } else {
    try {
      console.log(JSON.stringify(await inventory(process.argv[2])));
    } catch (error) {
      console.error(`Runtime inventory failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
