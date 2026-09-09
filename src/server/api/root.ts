import { approvalRouter } from "./routers/approval";
import {
  createCallerFactory,
  createTRPCRouter,
  publicProcedure,
} from "~/server/api/trpc";
import { tutorRouter } from "~/server/api/routers/tutor";
import { tuteeRouter } from "~/server/api/routers/tutee";
import { applicationRouter } from "~/server/api/routers/application";
import { adminRouter } from "~/server/api/routers/admin";
import { notificationRouter } from "~/server/api/routers/notification";
import { localizationRouter } from "~/server/api/routers/localization";
import { i18nRouter } from "~/server/api/routers/i18n";
import { registrationRouter } from "~/server/api/routers/registration";
import { accountRouter } from "~/server/api/routers/account";
import { crewRouter } from "~/server/api/routers/crew";
import { programRouter } from "~/server/api/routers/program";
import { viewerRouter } from "~/server/api/routers/viewer";
import { homeRouter } from "~/server/api/routers/home";
import { correctionsRouter } from "~/server/api/routers/corrections";
import { studentWorkflowRouter } from "~/server/api/routers/student-workflow";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 * Feature routers (tutor, admin, attendance, etc.) are added in later phases.
 */
import { studentRouter } from "./routers/student";
import { messagingRouter } from "./routers/messaging";

import { interviewManagementRouter } from "./routers/interview-management";
import { translationReviewRouter } from "./routers/translation-review";

export const appRouter = createTRPCRouter({
  approval: approvalRouter,
  /** Lightweight liveness check. */
  interviewManagement: interviewManagementRouter,
  translationReview: translationReviewRouter,
  student: studentRouter,
  messaging: messagingRouter,
  health: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
  studentWorkflow: studentWorkflowRouter,
  tutor: tutorRouter,
  tutee: tuteeRouter,
  application: applicationRouter,
  admin: adminRouter,
  notification: notificationRouter,
  localization: localizationRouter,
  i18n: i18nRouter,
  registration: registrationRouter,
  account: accountRouter,
  crew: crewRouter,
  program: programRouter,
  viewer: viewerRouter,
  home: homeRouter,
  corrections: correctionsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 */
export const createCaller = createCallerFactory(appRouter);
