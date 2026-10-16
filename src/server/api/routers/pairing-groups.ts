import {
  createTRPCRouter,
  activeTutorProcedure,
  tutorProcedure,
} from "../trpc";
import {
  pairingGroupsInput,
  readPairingGroups,
  savePairingGroups,
} from "~/server/pairing-groups";

export const pairingGroupsRouter = createTRPCRouter({
  mine: tutorProcedure.query(({ ctx }) =>
    readPairingGroups(ctx.db, ctx.session.tutorId),
  ),
  save: activeTutorProcedure
    .input(pairingGroupsInput)
    .mutation(({ ctx, input }) =>
      savePairingGroups(ctx.db, ctx.session.tutorId, input),
    ),
});
