import { portalAccess } from "~/lib/portal-access";
import { projectManagementRead } from "~/server/management-read-models";
import { SignupRetry } from "~/server/signup-admission";
import { accountHistoryIds } from "~/server/account-history";
import { ApprovalQueued, queueProposal, proposalAuthority } from "~/server/approvals";
import { databaseScope, isTranslationPublication } from "~/server/db-scope";
import { runAuditedMutation, recordAuditAttempt, auditAttemptRecorded } from "~/server/audit/evidence";
import {
  APPROVAL_OPERATIONS,
  COORDINATOR_DIRECT_OPERATIONS,
} from "~/lib/approval-policy";
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
 * Turn Zod's verbose transport payload into a short form-level message. The flattened field
 * errors remain in `data.zodError` for controls that can render field-level detail; this summary
 * deliberately omits paths and submitted values so it is safe to show beside a form.
 */
export function validationSummary(error: ZodError): string {
  const flattened = error.flatten();
  const messages = [
    ...flattened.formErrors,
    ...Object.values(flattened.fieldErrors).flatMap((items) => items ?? []),
  ];
  const unique = [...new Set(messages)].filter(Boolean);
  if (!unique.length) return "Please review the submitted values.";
  // Preserve a shared translation key for name validation instead of embedding a raw
  // server code inside Zod's English summary. Field details remain available below.
  if (unique.length === 1 && unique[0] === "PROFILE_LATIN_NAME_REQUIRED")
    return unique[0];

  const shown = unique.slice(0, 3).join("; ");
  const omitted = unique.length - 3;
  const suffix = omitted > 0 ? `; ${omitted} more issue(s).` : ".";
  return `${
    unique.length === 1
      ? "Please correct the highlighted field: "
      : "Please correct the highlighted fields: "
  }${shown}${suffix}`;
}

/** Apply the transport additions in one testable step before tRPC serializes the error shape. */
export function formatTRPCErrorShape<
  TShape extends { message: string; data: object },
>(shape: TShape, error: { cause?: unknown }) {
  const zodError = error.cause instanceof ZodError ? error.cause : null;
  const summary = zodError ? validationSummary(zodError) : null;
  return {
    ...shape,
    message: summary ?? shape.message,
    data: {
      ...shape.data,
      approvalId:
        error.cause instanceof ApprovalQueued ? error.cause.approvalId : null,
      zodError: zodError ? zodError.flatten() : null,
      validationSummary: summary,
      retryAfterSeconds: error.cause instanceof SignupRetry ? error.cause.retryAfterSeconds : null,
    },
  };
}

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
    return formatTRPCErrorShape(shape, error);
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
    console.log(
      `[trpc] ${type.padEnd(8)} ${path} ${result.ok ? "ok " : "ERR"} ${ms}ms`,
    );
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
  .use(async ({ ctx, next, path, type }) => {
    // Authorization failures happen before the application transaction. Attribute only
    // signed-in accounts that still exist, and never report a queued request as a failure.
    const capture = async (error: unknown) => {
      if (type !== "mutation" || !ctx.session?.user || databaseScope.getStore() || auditAttemptRecorded(error) ||
          (error instanceof TRPCError && error.cause instanceof ApprovalQueued)) return;
      const account = await ctx.db.user.findUnique({ where: { id: ctx.session.user.id }, select: { role: true, name: true, username: true } });
      if (!account) return;
      await recordAuditAttempt(ctx.db, { id: ctx.session.user.id,
        name: account.name ?? account.username ?? null, role: account.role }, path, error);
    };
    try {
      const result = await next();
      if (!result.ok) await capture(result.error);
      return result;
    } catch (error) {
      await capture(error);
      throw error;
    }
  })
  .use(async ({ ctx, next, path, type, getRawInput }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    // Preserve the narrowed full session inside the later audit callback closure.
    const session = ctx.session;
    // Session cookies prove identity, not current privileges. Read current account state on
    // every API request so demotion, unlinking, suspension and deletion take effect immediately.
    const account = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: {
        role: true,
        mergedIntoId: true,
        tutorId: true,
        tutorAccessRevoked: true,
        schoolDeparture: true,
        canTranslate: true,
        tuteeMember: true,
        studentId: true,
        suspendedAt: true,
        name: true,
        username: true,
      },
    });
    if (!account || account.mergedIntoId) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (
      account.suspendedAt &&
      !["account.me", "account.suspension", "account.submitAppeal"].includes(
        path,
      )
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your account is suspended.",
      });
    }
    const access = portalAccess(account);
    if (type === "mutation" && access.departed && ["tutor.activateAccount", "tutor.requestReentry", "tutor.setAvailability", "tutor.setInterviewTime", "studentWorkflow.editAvailability", "studentWorkflow.applyAbort", "studentWorkflow.applyLegacyWithdrawal"].includes(path))
      throw new TRPCError({ code: "FORBIDDEN", message: "School departure is confirmed. Ask Head to review your return." });
    // Participant reads and writes share the same consent boundary as the tutee page.
    // Policy/onboarding and staff inspection remain available before participation is granted.
    const tuteeOperations = new Set([
      "student.me",
      "student.feedback",
      "student.appeal",
      "studentWorkflow.mine",
      "studentWorkflow.legacyParticipation",
      "studentWorkflow.applyLegacyWithdrawal",
      "studentWorkflow.editAvailability",
      "studentWorkflow.recall",
      "studentWorkflow.applyAbort",
    ]);
    if (tuteeOperations.has(path)) {
      if (account.role === "VIEWER" || (!account.tuteeMember && !access.departed))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Accept the tutee policy before entering the tutee area.",
        });
      if (
        account.tutorId && !access.departed &&
        !(await ctx.db.policyAcceptance.findFirst({
          where: { userId: { in: await accountHistoryIds(ctx.db, ctx.session.user.id) }, slug: "tutee-policy" },
          select: { id: true },
        }))
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Accept the tutee policy before participating.",
        });
    }
    // A rank never substitutes for an explicit translator assignment, including queued writes.
    if (
      (path.startsWith("localization.") ||
        path === "i18n.addLanguage" ||
        (path.startsWith("home.") &&
          [
            "home.setContent",
            "home.setNewsTranslation",
            "home.setSectionTranslation",
            "home.setPageTitle",
          ].includes(path))) &&
      !account.canTranslate &&
      !isTranslationPublication(ctx.session.user.id, account.role, path)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Translation access required.",
      });
    // Central classification covers legacy entry points as well as profile editing.
    // Participant requests cannot execute mutations; their eventual reviewer must be Head.
    // Check additional requests before legacy membership/coordinator proposal middleware.
    // A coordinator must not turn a prohibited decision into an approval replay loophole.
    if (type === "mutation" && ["admin.assignInterviewers", "admin.setApplicationStatus", "admin.deleteApplication", "tutor.decideInterview"].includes(path)) {
      const raw = await getRawInput();
      if (raw && typeof raw === "object") {
        const id = "applicationId" in raw ? raw.applicationId : "id" in raw ? raw.id : null;
        const app = typeof id === "string" ? await ctx.db.tutorApplication.findUnique({ where: { id }, select: { type: true, status: true } }) : null;
        if (app && app.type !== "INITIAL") {
          if (!["ADMIN", "HEAD"].includes(account.role))
            throw new TRPCError({ code: "FORBIDDEN", message: "Only Admin or Head may review qualification requests." });
          if (path !== "admin.assignInterviewers")
            throw new TRPCError({ code: "FORBIDDEN", message: "Use the qualification request decision controls. Request history cannot be deleted." });
          if (app.status !== "PENDING")
            throw new TRPCError({ code: "CONFLICT", message: "This request already has a review or final decision; its panel history must be retained." });
        }
      }
    }
    // Text-only translator mutations validate and create destination-bound drafts in
    // their resolvers. Other coordinator website changes use the general approval queue.
    const translationDraftWrite = [
      "localization.setString",
      "home.setContent",
      "home.setNewsTranslation",
      "home.setSectionTranslation",
      "home.setPageTitle",
    ].includes(path);
    if (type === "mutation" && !translationDraftWrite && Object.hasOwn(APPROVAL_OPERATIONS, path)) {
      const raw = await getRawInput();
      const authority = await proposalAuthority(ctx.db, path, raw);
      if (authority && !authority.directRoles.includes(account.role)) {
        // This check precedes queuing and resolver-specific gates, so a forbidden role
        // cannot turn an inaccessible management mutation into a request/replay loophole.
        if (!authority.requesterRoles.includes(account.role))
          throw new TRPCError({ code: "FORBIDDEN", message: "Your current role cannot submit this change." });
        const request = await queueProposal({ ...ctx.session, role: account.role }, path, raw);
        throw new TRPCError({ code: "PRECONDITION_FAILED",
          message: authority.reviewerRoles.length === 1
            ? "Submitted for Head approval. No live changes have been applied."
            : "Submitted for management approval. No live changes have been applied.",
          cause: new ApprovalQueued(request.id) });
      }
    }
    if (
      account.role === "COORDINATOR" &&
      type === "mutation" &&
      !translationDraftWrite &&
      (path.startsWith("home.") ||
        path.startsWith("localization.") ||
        path === "tutor.decideInterview")
    ) {
      if (!Object.hasOwn(APPROVAL_OPERATIONS, path))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This action requires an administrator.",
        });
      const request = await queueProposal(
        { ...ctx.session, role: account.role },
        path,
        await getRawInput(),
      );
      const cause = new ApprovalQueued(request.id);
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: cause.message,
        cause,
      });
    }
    const run = async (auditedDb: typeof ctx.db) => {
      if (type === "mutation" && path === "admin.updateTimeSlot") {
        // A slot correction must observe attendance committed while waiting for the
        // schedule barrier. READ COMMITTED plus the same role/slot locks as approval
        // retains authority without a pre-wait Serializable snapshot hiding that work.
        const { lockAttendanceApproval, lockAttendanceApprovalTarget } = await import("~/server/attendance-approval");
        await lockAttendanceApproval(auditedDb, path, [session.user.id]);
        await lockAttendanceApprovalTarget(auditedDb, path, await getRawInput());
        const currentActor = await auditedDb.user.findUnique({ where: { id: session.user.id },
          select: { role: true, suspendedAt: true, mergedIntoId: true } });
        if (!currentActor || currentActor.suspendedAt || currentActor.mergedIntoId || currentActor.role !== account.role)
          throw new TRPCError({ code: "CONFLICT", message: "Your current authority changed. Reload before editing this slot." });
      }
      if (type === "mutation" && !translationDraftWrite && Object.hasOwn(APPROVAL_OPERATIONS, path)) {
        // Conditional direct authority is re-read inside the application transaction.
        // Its Serializable boundary rejects a concurrent first decision/correction too.
        const currentAuthority = await proposalAuthority(auditedDb, path, await getRawInput());
        if (!currentAuthority?.directRoles.includes(account.role))
          throw new TRPCError({ code: "CONFLICT", message: "The action now requires review. Reload and submit a fresh request." });
      }
      return next({
      ctx: {
        db: auditedDb,
        portalAccess: access,
        // infers the `session` as non-nullable
        session: {
          ...session,
          role: account.role,
          tutorId:
            account.role === "VIEWER" || account.tutorAccessRevoked
              ? null
              : account.tutorId,
          user: session.user,
        },
      },
      });
    };
    // Successful changes and safe before/after evidence share a transaction. Queued
    // proposals have already stopped above, so their durable submission is retained.
    return type === "mutation"
      ? runAuditedMutation(ctx.db, { id: ctx.session.user.id,
          name: account.name ?? account.username ?? null, role: account.role }, path, run)
      : run(ctx.db);
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

/** Coordinators can inspect management data and submit sensitive changes for review.
 * Requests stop before the resolver: no live mutation is presented as a successful save. */
export const adminProcedure = protectedProcedure.use(
  async ({ ctx, next, path, type, getRawInput }) => {
    if (!isElevated(ctx.session.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admin access required.",
      });
    }
    if (
      ctx.session.role === "COORDINATOR" &&
      type === "mutation" &&
      !COORDINATOR_DIRECT_OPERATIONS.has(path)
    ) {
      if (!Object.hasOwn(APPROVAL_OPERATIONS, path))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This action requires an administrator.",
        });
      const raw = await getRawInput();
      if (
        path === "admin.setUserCanTutor" &&
        (!raw ||
          typeof raw !== "object" ||
          !("userId" in raw) ||
          raw.userId !== ctx.session.user.id)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only request changes to your own tutoring access.",
        });
      const request = await queueProposal(ctx.session, path, raw);
      const cause = new ApprovalQueued(request.id);
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: cause.message,
        cause,
      });
    }
    return next();
  },
);

/**
 * Admin-tier procedure: ADMIN or HEAD (not coordinators). For powers above a coordinator —
 * managing non-admin roles, program refresh, hour adjustments, etc.
 */
export const adminOnlyProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdminTier(ctx.session.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator access required.",
    });
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
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Head access required.",
    });
  }
  return next();
});

/**
 * Active-tutor procedure: a tutor procedure that additionally requires the linked Tutor to be
 * ACTIVE. Inactive tutors (graduated / opted-out / archived) keep read-only access to their own
 * history but may not perform tutoring actions (attendance, slot picks, etc.). Mutations that
 * only an active tutor may run go on this; read-only tutor queries stay on `tutorProcedure`.
 */
export const activeTutorProcedure = tutorProcedure.use(
  async ({ ctx, next }) => {
    const tutor = await ctx.db.tutor.findUnique({
      where: { id: ctx.session.tutorId },
      select: { status: true },
    });
    if (tutor?.status !== "ACTIVE" || !ctx.portalAccess.canParticipate) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This action requires an active tutor account.",
      });
    }
    return next();
  },
);

/**
 * Translator procedure: an explicit Head-approved `canTranslate` assignment.
 * Gates the in-app localization editor (assigned tutors can help translate without admin rights).
 */
export const translatorProcedure = protectedProcedure.use(
  async ({ ctx, next, path }) => {
    if (isTranslationPublication(ctx.session.user.id, ctx.session.role, path))
      return next();
    const me = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { canTranslate: true, role: true },
    });
    if (!me?.canTranslate || me.role === "VIEWER") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Translation access required.",
      });
    }
    return next();
  },
);

/** Management may inspect/review submitted drafts without acquiring editing permission. */
export const translationReviewerProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    if (["HEAD", "ADMIN", "COORDINATOR"].includes(ctx.session.role))
      return next();
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: { canTranslate: true },
    });
    if (!user.canTranslate)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Translation access required.",
      });
    return next();
  },
);

/**
 * Crew procedure: an ACTIVE crew member (`crewStatus === "ACTIVE"`; a tutor can also be crew).
 * Gates patrol submission. Admins/coordinators are also allowed (they oversee the crew). Opted-out
 * or soft-removed crew are NOT active and cannot patrol (read-only portal only).
 */
export const crewProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const features = await getFeatures(ctx.db);
  if (!features.CREW) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The crew module is disabled.",
    });
  }
  if (isElevated(ctx.session.role)) return next();
  const me = await ctx.db.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { crewStatus: true },
  });
  if (me?.crewStatus !== "ACTIVE") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Active crew access required.",
    });
  }
  return next();
});

/**
 * Management queries share an explicit observer response boundary. Viewer and
 * departure-based observer access use the same per-procedure safe read model;
 * authorized staff keep their full responses. Own-account/participant reads use
 * their separate ownership guards and are deliberately outside this boundary.
 */
export const viewerProcedure = protectedProcedure.use(async ({ ctx, next, path, type }) => {
  const { role } = ctx.session;
  if (!ctx.portalAccess.canReadManagement || type !== "query") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required.",
    });
  }
  // A suspended viewer keeps their login but loses read access (until reinstated / appeal).
  if (role === "VIEWER") {
    const me = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { suspendedAt: true },
    });
    if (me?.suspendedAt) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your account is suspended.",
      });
    }
  }
  const result = await next();
  if (ctx.portalAccess.maskManagementData && result.ok) {
    return { ...result, data: projectManagementRead(path, result.data) };
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
