import { loggerLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";

export function createClientLoggerLink() {
  return loggerLink<AppRouter>({
    enabled: (op) => {
      if (op.direction === "down" && op.result instanceof TRPCClientError) {
        const data = op.result.data;
        // These named editors own inline rejection/queued-approval recovery.
        // Console errors would raise Next's overlay over their recovery controls.
        if (
          (data?.path === "pairingGroups.save" &&
            (data.code === "BAD_REQUEST" || data.code === "CONFLICT")) ||
          (data?.path === "admin.declineSignup" &&
            (data.code === "BAD_REQUEST" ||
              data.code === "CONFLICT" ||
              data.code === "PRECONDITION_FAILED"))
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
