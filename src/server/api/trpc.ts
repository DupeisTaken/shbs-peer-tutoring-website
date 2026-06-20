/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth();

  return {
    db,
    session,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware that times procedure execution. The measurement starts *after* the optional
 * artificial dev delay, so the logged number is the procedure's real handler cost (DB +
 * compute) — what you'd see in production — not network/waterfall simulation.
 *
 * The artificial delay (the T3 starter's waterfall-detector) is opt-in via `TRPC_DEV_DELAY=true`;
 * it's off by default so local dev isn't slowed by 100–500ms on every call.
 */
const timingMiddleware = t.middleware(async ({ next, path, type }) => {
  if (t._config.isDev && env.TRPC_DEV_DELAY) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const start = Date.now();
  const result = await next();
  const ms = Date.now() - start;

  if (t._config.isDev) {
    console.log(`[trpc] ${type.padEnd(8)} ${path} ${result.ok ? "ok " : "ERR"} ${ms}ms`);
  }

  return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        // infers the `session` as non-nullable
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

/** Roles allowed into the admin section / admin procedures. */
const ELEVATED_ROLES = ["ADMIN", "COORDINATOR"] as const;

function isElevated(role: string): boolean {
  return (ELEVATED_ROLES as readonly string[]).includes(role);
}

/**
 * Tutor procedure: requires the caller to be linked to a Tutor. Narrows `tutorId` to a
 * non-null string so downstream queries can safely scope by `ctx.session.tutorId`.
 *
 * THE CRITICAL RULE: every tutor-facing query MUST filter by `ctx.session.tutorId`.
 */
export const tutorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.tutorId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action requires a tutor account.",
    });
  }
  return next({
    ctx: {
      session: { ...ctx.session, tutorId: ctx.session.tutorId },
    },
  });
});

/** Admin procedure: ADMIN or COORDINATOR (coordinators have admin-level access). */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isElevated(ctx.session.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
  }
  return next();
});

/** Admin-only procedure: strictly ADMIN (e.g. managing users/roles). */
export const adminOnlyProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Administrator access required." });
  }
  return next();
});

/**
 * Guard for any procedure that accepts a `tutorId` argument: callers may only act on their
 * own tutor record unless they have an elevated (admin/coordinator) role. Throws FORBIDDEN
 * otherwise. Use this so a tutor can never read another tutor's data by changing an input.
 */
export function requireSelfOrAdmin(
  session: { role: string; tutorId: string | null },
  tutorId: string,
): void {
  if (isElevated(session.role)) return;
  if (session.tutorId !== tutorId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You may only access your own data.",
    });
  }
}
