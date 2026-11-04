import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTRPCUntypedClient,
  TRPCClientError,
  type TRPCLink,
} from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "~/server/api/root";
import { createClientLoggerLink } from "./client-logger";

const input = { snapshot: "0".repeat(64), groups: [] };
const path = "pairingGroups.save";

function rejected(code: string | undefined, errorPath?: string) {
  return TRPCClientError.from<AppRouter>({
    error: {
      code: code === "INTERNAL_SERVER_ERROR" ? -32603 : -32600,
      message: "Synthetic server rejection",
      data: {
        code,
        path: errorPath,
        httpStatus: code === "INTERNAL_SERVER_ERROR" ? 500 : 400,
      },
    },
  });
}

/** A real client/link chain preserves the exact rejection from its transport. */
function client(error?: TRPCClientError<AppRouter>) {
  const transport: TRPCLink<AppRouter> = () => () =>
    observable((observer) => {
      if (error) observer.error(error);
      else {
        observer.next({ result: { data: "saved" } });
        observer.complete();
      }
    });
  return createTRPCUntypedClient<AppRouter>({
    links: [createClientLoggerLink(), transport],
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(["development", "production"] as const)(
  "%s client logging",
  (environment) => {
    function capture() {
      vi.stubEnv("NODE_ENV", environment);
      return {
        log: vi.spyOn(console, "log").mockImplementation(() => undefined),
        error: vi.spyOn(console, "error").mockImplementation(() => undefined),
      };
    }

    it.each(["BAD_REQUEST", "CONFLICT"])(
      "keeps %s group-save rejection unchanged without a console error",
      async (code) => {
        const output = capture();
        const error = rejected(code, path);
        await expect(client(error).mutation(path, input)).rejects.toBe(error);
        expect(output.error).not.toHaveBeenCalled();
        expect(output.log).toHaveBeenCalledTimes(
          environment === "development" ? 1 : 0,
        );
      },
    );

    it.each([
      ["FORBIDDEN", path],
      ["UNAUTHORIZED", path],
      ["INTERNAL_SERVER_ERROR", path],
      ["BAD_REQUEST", "tutor.setPairingSlot"],
      ["CONFLICT", "tutor.setPairingSlot"],
      ["BAD_REQUEST", ""],
      ["BAD_REQUEST", undefined],
      [undefined, path],
    ])("retains default diagnostics for %s at %s", async (code, errorPath) => {
      const output = capture();
      const error = rejected(code, errorPath);
      await expect(
        client(error).mutation(errorPath ?? path, input),
      ).rejects.toBe(error);
      expect(output.error).toHaveBeenCalledTimes(1);
      // Keep tRPC's default payload/formatting, including the original rejection.
      const detail: unknown = output.error.mock.calls[0]?.at(-1);
      expect(detail).toMatchObject({
        input,
        result: error,
      });
      expect(detail).toHaveProperty("elapsedMs", expect.any(Number));
      expect(output.log).toHaveBeenCalledTimes(
        environment === "development" ? 1 : 0,
      );
    });

    it("retains unstructured transport diagnostics and the network cause", async () => {
      const output = capture();
      const cause = new TypeError("Synthetic network unavailable");
      const error = TRPCClientError.from<AppRouter>(cause);
      await expect(client(error).mutation(path, input)).rejects.toBe(error);
      expect(error.cause).toBe(cause);
      expect(output.error).toHaveBeenCalledTimes(1);
    });

    it("preserves ordinary development request/result logs and production silence", async () => {
      const output = capture();
      await expect(client().mutation(path, input)).resolves.toBe("saved");
      expect(output.error).not.toHaveBeenCalled();
      expect(output.log).toHaveBeenCalledTimes(
        environment === "development" ? 2 : 0,
      );
    });
  },
);
