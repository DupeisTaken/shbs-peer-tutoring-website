import { z } from "zod";

export const departureChange = z.object({
  userId: z.string().min(1),
  action: z.enum(["GRADUATED", "TRANSFERRED", "RETURN", "REVOKE", "RESTORE"]),
  expectedRevision: z.number().int().min(0),
  explanation: z.string().trim().min(1).max(1000),
});
