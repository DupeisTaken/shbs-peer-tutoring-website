import { expect, it, vi } from "vitest";
import {
  isSerializationFailure,
  retryUsernameSnapshot,
  UsernameSnapshotConflict,
} from "./username-snapshot";

it("retries only tagged namespace failures, including wrapped tRPC causes", async () => {
  const work = vi
    .fn()
    .mockRejectedValueOnce(
      new Error("wrapped", {
        cause: new UsernameSnapshotConflict({ code: "40001" }),
      }),
    )
    .mockResolvedValue("committed");
  expect(await retryUsernameSnapshot(work)).toBe("committed");
  expect(work).toHaveBeenCalledTimes(2);
});
it("bounds repeated namespace contention to three fresh transactions", async () => {
  const error = new UsernameSnapshotConflict({ code: "P2034" });
  const work = vi.fn().mockRejectedValue(error);
  await expect(retryUsernameSnapshot(work)).rejects.toBe(error);
  expect(work).toHaveBeenCalledTimes(3);
});
it.each([{ code: "P2034" }, { code: "P2002" }, new Error("SMTP failed")])(
  "never repeats an untagged callback failure",
  async (error) => {
    const work = vi.fn().mockRejectedValue(error);
    await expect(retryUsernameSnapshot(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
  },
);
it("recognizes both Prisma serialization codes and adapter SQLSTATE", () => {
  expect(isSerializationFailure({ code: "P2034" })).toBe(true);
  expect(
    isSerializationFailure({ code: "P2010", meta: { code: "40001" } }),
  ).toBe(true);
  expect(
    isSerializationFailure({
      meta: { driverAdapterError: { cause: { originalCode: "40001" } } },
    }),
  ).toBe(true);
  expect(isSerializationFailure({ code: "P2002" })).toBe(false);
});
