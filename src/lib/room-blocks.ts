import { z } from "zod";

// The proposal parser and direct writes share the same range rules. Keeping the
// refinement in the schema rejects invalid requests before they enter review.
const period = {
  dayOfWeek: z.number().int().min(1).max(7),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
  reason: z.string().trim().max(200).optional(),
};
const ordered = (value: { startMin: number; endMin: number }) =>
  value.endMin > value.startMin;
const rangeError = { message: "End must be after start.", path: ["endMin"] };

export const createRoomBlockSchema = z
  .object({ roomId: z.string().min(1), ...period })
  .refine(ordered, rangeError);
export const updateRoomBlockSchema = z
  .object({ id: z.string().min(1), ...period })
  .refine(ordered, rangeError);
export const removeRoomBlockSchema = z.object({ id: z.string().min(1) });
