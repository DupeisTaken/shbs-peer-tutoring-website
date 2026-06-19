import {
  createCallerFactory,
  createTRPCRouter,
  publicProcedure,
} from "~/server/api/trpc";
import { tutorRouter } from "~/server/api/routers/tutor";
import { tuteeRouter } from "~/server/api/routers/tutee";
import { adminRouter } from "~/server/api/routers/admin";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 * Feature routers (tutor, admin, attendance, etc.) are added in later phases.
 */
export const appRouter = createTRPCRouter({
  /** Lightweight liveness check. */
  health: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
  tutor: tutorRouter,
  tutee: tuteeRouter,
  admin: adminRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 */
export const createCaller = createCallerFactory(appRouter);
