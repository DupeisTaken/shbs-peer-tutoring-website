import { expect, it, vi } from "vitest";
import { changeVerifiedPassword } from "./session-version";
import { verifyPassword } from "./password";

it("rejects out-of-range passwords before calling user.updateMany", async () => {
  const updateMany = vi.fn();
  const db = { user: { updateMany } } as unknown as Parameters<
    typeof changeVerifiedPassword
  >[0];

  await expect(
    changeVerifiedPassword(db, "user-1", "old-hash", "short7!"),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    changeVerifiedPassword(db, "user-1", "old-hash", "a".repeat(1025)),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(updateMany).not.toHaveBeenCalled();
});

it("accepts boundary 8 and 1024 character passwords with conditional old-hash write", async () => {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = { user: { updateMany } } as unknown as Parameters<
    typeof changeVerifiedPassword
  >[0];

  await changeVerifiedPassword(db, "user-1", "old-hash", "Exact8!!");
  await changeVerifiedPassword(db, "user-1", "old-hash", "b".repeat(1024));

  expect(updateMany).toHaveBeenCalledTimes(2);
  const firstCall = updateMany.mock.calls[0]?.[0] as {
    data: { passwordHash: string };
  };
  const secondCall = updateMany.mock.calls[1]?.[0] as {
    data: { passwordHash: string };
  };
  expect(verifyPassword("Exact8!!", firstCall.data.passwordHash)).toBe(true);
  expect(verifyPassword("b".repeat(1024), secondCall.data.passwordHash)).toBe(
    true,
  );
});
