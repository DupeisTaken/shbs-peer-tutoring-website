import { loggerLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";

export function createClientLoggerLink() {
  return loggerLink<AppRouter>({
    enabled: (op) => {
      if (op.direction === "down" && op.result instanceof TRPCClientError) {
        const data = op.result.data;
        // The group editor renders these rejected drafts with inline recovery.
        // Logging them as console errors also raises Next's development overlay.
        if (
          data?.path === "pairingGroups.save" &&
          (data.code === "BAD_REQUEST" || data.code === "CONFLICT")
        )
          return false;
      }
      return (
        process.env.NODE_ENV === "development" ||
        (op.direction === "down" && op.result instanceof Error)
      );
    },
  });
}
