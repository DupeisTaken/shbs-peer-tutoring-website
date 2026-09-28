import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  TRANSFER_MAX_BYTES,
  TRANSFER_README,
  transferFilesSchema,
  type TransferFile,
} from "./record-transfer";

export function createRecordArchive(files: TransferFile[]) {
  const entries: Record<string, Uint8Array> = {
    "README.txt": strToU8(TRANSFER_README),
  };
  for (const file of files) entries[file.name] = strToU8(file.text);
  return zipSync(entries, { level: 1 });
}

/** Check declared expanded sizes before decompression, not after allocating a ZIP bomb. */
export function readRecordArchive(bytes: Uint8Array): TransferFile[] {
  if (bytes.length > TRANSFER_MAX_BYTES)
    throw new Error("The ZIP must be at most 5 MiB.");
  let size = 0,
    count = 0;
  const names = new Set<string>();
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name === "README.txt") return false;
      size += entry.originalSize;
      count++;
      if (!/^[A-Za-z]+\.csv$/.test(entry.name) || names.has(entry.name))
        throw new Error("ZIP contains an unsupported or duplicate filename.");
      names.add(entry.name);
      if (size > TRANSFER_MAX_BYTES || count > 60)
        throw new Error("Expanded CSV data exceeds the import limits.");
      return true;
    },
  });
  return transferFilesSchema.parse(
    Object.entries(entries).map(([name, data]) => ({
      name,
      text: strFromU8(data),
    })),
  );
}
