import { expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { staleConflict } from "~/server/concurrency";
import {
  localizedStaleRecordError,
  STALE_RECORD_MESSAGE,
} from "./stale-record-error";

it("recognizes the server's unchanged standard conflict contract", () => {
  expect.assertions(3);
  try {
    staleConflict();
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCError);
    if (!(error instanceof TRPCError)) throw error;
    expect(error.code).toBe("CONFLICT");
    expect(
      localizedStaleRecordError(error.message, () => zh.saveErrors.staleRecord),
    ).toBe(zh.saveErrors.staleRecord);
  }
});

it("translates only the complete known stale-record instruction", () => {
  const translate = vi.fn(() => "Guidance in the active language");
  expect(localizedStaleRecordError(STALE_RECORD_MESSAGE, translate)).toBe(
    "Guidance in the active language",
  );
  expect(translate).toHaveBeenCalledExactlyOnceWith("staleRecord");
  expect(en.saveErrors.staleRecord).toBe(STALE_RECORD_MESSAGE);
  expect(zh.saveErrors.staleRecord).toBe(
    "此内容自加载后已发生变化。请刷新后重试。",
  );
});

it.each([
  undefined,
  "",
  "CONFLICT",
  "Panel changed; reload",
  ` ${STALE_RECORD_MESSAGE}`,
  `${STALE_RECORD_MESSAGE} `,
  `${STALE_RECORD_MESSAGE} Additional server detail.`,
  STALE_RECORD_MESSAGE.replace("—", "-"),
  STALE_RECORD_MESSAGE.replace(/\.$/, "!"),
])(
  "preserves the existing fallback for an unrecognized message: %s",
  (message) => {
    const translate = vi.fn(() => "Unrelated guidance");
    expect(localizedStaleRecordError(message, translate)).toBeUndefined();
    expect(translate).not.toHaveBeenCalled();
  },
);
