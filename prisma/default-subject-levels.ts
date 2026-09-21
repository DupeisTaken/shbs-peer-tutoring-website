import { seedId } from "./demo-support";

/** Default difficulty runs from beginner to advanced. Higher ranks can grant
 * lower offered levels in the same course group; never reverse this pipeline.
 * Stable IDs keep existing demo subject references intact when reseeding. */
export const DEFAULT_SUBJECT_LEVELS = [
  {
    id: seedId("level-standard"),
    name: "Standard",
    rank: 0,
    apScored: false,
    prefix: "",
  },
  {
    id: seedId("level-honors"),
    name: "Honors",
    rank: 1,
    apScored: false,
    prefix: "Honors",
  },
  { id: seedId("level-ap"), name: "AP", rank: 2, apScored: true, prefix: "AP" },
] as const;
