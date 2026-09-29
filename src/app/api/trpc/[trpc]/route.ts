import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { signupIngress } from "~/server/signup-ingress";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: Request) => {
  return createTRPCContext({
    headers: req.headers,
  });
};

const handler = (incoming: Request) => signupIngress(incoming, (req) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError:
      env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(
              `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`
            );
          }
        : undefined,
  }));

export { handler as GET, handler as POST };
