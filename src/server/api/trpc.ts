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
import { getFeatures } from "~/server/program/features";

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

/**
 * Role hierarchy: HEAD > ADMIN > COORDINATOR > TUTOR > VIEWER.
 * - "Elevated" = admin-area access (HEAD, ADMIN, COORDINATOR).
 * - "Admin tier" = full admin powers excluding coordinators (HEAD, ADMIN) — e.g. role changes,
 *   program refresh. HEAD additionally manages the admin roster + leadership transfer.
 */
const ELEVATED_ROLES = ["HEAD", "ADMIN", "COORDINATOR"] as const;
const ADMIN_TIER_ROLES = ["HEAD", "ADMIN"] as const;

function isElevated(role: string): boolean {
  return (ELEVATED_ROLES as readonly string[]).includes(role);
}

function isAdminTier(role: string): boolean {
  return (ADMIN_TIER_ROLES as readonly string[]).includes(role);
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

/**
 * Admin-tier procedure: ADMIN or HEAD (not coordinators). For powers above a coordinator —
 * managing non-admin roles, program refresh, hour adjustments, etc.
 */
export const adminOnlyProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdminTier(ctx.session.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Administrator access required." });
  }
  return next();
});

/**
 * Head procedure: strictly HEAD (the singleton admin leader). Gates the powers only the head
 * holds — promoting/demoting admins and transferring leadership. See the head transfer in
 * the admin router; the head can never demote themselves except via that transfer.
 */
export const headProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.role !== "HEAD") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Head access required." });
  }
  return next();
});

/**
 * Active-tutor procedure: a tutor procedure that additionally requires the linked Tutor to be
 * ACTIVE. Inactive tutors (graduated / opted-out / archived) keep read-only access to their own
 * history but may not perform tutoring actions (attendance, slot picks, etc.). Mutations that
 * only an active tutor may run go on this; read-only tutor queries stay on `tutorProcedure`.
 */
export const activeTutorProcedure = tutorProcedure.use(async ({ ctx, next }) => {
  const tutor = await ctx.db.tutor.findUnique({
    where: { id: ctx.session.tutorId },
    select: { status: true },
  });
  if (tutor?.status !== "ACTIVE") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action requires an active tutor account.",
    });
  }
  return next();
});

/**
 * Translator procedure: admins/coordinators, or any user an admin has flagged `canTranslate`.
 * Gates the in-app localization editor (assigned tutors can help translate without admin rights).
 */
export const translatorProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (isElevated(ctx.session.role)) return next();
  const me = await ctx.db.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { canTranslate: true },
  });
  if (!me?.canTranslate) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Translation access required." });
  }
  return next();
});

/**
 * Crew procedure: an ACTIVE crew member (`crewStatus === "ACTIVE"`; a tutor can also be crew).
 * Gates patrol submission. Admins/coordinators are also allowed (they oversee the crew). Opted-out
 * or soft-removed crew are NOT active and cannot patrol (read-only portal only).
 */
export const crewProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const features = await getFeatures(ctx.db);
  if (!features.CREW) {
    throw new TRPCError({ code: "FORBIDDEN", message: "The crew module is disabled." });
  }
  if (isElevated(ctx.session.role)) return next();
  const me = await ctx.db.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { crewStatus: true },
  });
  if (me?.crewStatus !== "ACTIVE") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Active crew access required." });
  }
  return next();
});

/** Personal/contact fields hidden from the read-only VIEWER role. Names are NOT masked. */
const VIEWER_MASKED_KEYS = new Set(["email", "phone", "preferredContact"]);

/** Recursively null out PII keys in a query result (leaves Dates and everything else intact). */
function maskViewerPII(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskViewerPII);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = VIEWER_MASKED_KEYS.has(k) ? null : maskViewerPII(v);
    }
    return out;
  }
  return value;
}

/**
 * Read procedure for the admin area: ADMIN, COORDINATOR, or the read-only VIEWER. Use this for
 * admin QUERIES; keep mutations on `adminProcedure`/`adminOnlyProcedure` so VIEWER can browse
 * but never write. For VIEWER callers the result is run through `maskViewerPII`, so contact
 * details (emails / phone / preferred contact) never reach a viewer — names and stats remain.
 */
export const viewerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const { role } = ctx.session;
  if (!isElevated(role) && role !== "VIEWER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
  }
  // A suspended viewer keeps their login but loses read access (until reinstated / appeal).
  if (role === "VIEWER") {
    const me = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { suspendedAt: true },
    });
    if (me?.suspendedAt) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Your account is suspended." });
    }
  }
  const result = await next();
  if (role === "VIEWER" && result.ok) {
    return { ...result, data: maskViewerPII(result.data) };
  }
  return result;
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
