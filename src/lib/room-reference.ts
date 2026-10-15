import { z } from "zod";

// Imported and historical rooms may have explicit IDs. Keep their keys opaque
// and unchanged; existence is checked inside the submission's write transaction.
export const roomReference = z.string().min(1, "Select a room.");
