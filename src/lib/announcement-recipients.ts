import { z } from "zod";

export const announcementAudienceSchema = z.object({
  mode: z.enum(["all", "filtered", "specific"]).default("all"),
  grades: z.array(z.number().int().min(1).max(12)).default([]),
  statuses: z
    .array(z.enum(["ACTIVE", "PENDING", "OPTED_OUT", "GRADUATED", "ARCHIVED"]))
    .default([]),
  subjects: z.array(z.string().min(1)).default([]),
  assignment: z.enum(["any", "with", "without"]).default("any"),
  includeTutorIds: z.array(z.string().min(1)).max(5000).default([]),
  excludeTutorIds: z.array(z.string().min(1)).max(5000).default([]),
});

export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;
export type AnnouncementCandidate = {
  id: string;
  name: string;
  gradeLevel: number | null;
  status: string;
  subjects: string[];
  activeTutees: number;
};

export const defaultAnnouncementAudience = (): AnnouncementAudience =>
  announcementAudienceSchema.parse({});

/** OR within each group, AND between groups; explicit exclusion always wins. */
export function selectAnnouncementRecipients(
  tutors: AnnouncementCandidate[],
  audience: AnnouncementAudience,
) {
  const include = new Set(audience.includeTutorIds);
  const exclude = new Set(audience.excludeTutorIds);
  return tutors.filter((tutor) => {
    if (exclude.has(tutor.id)) return false;
    if (include.has(tutor.id)) return true;
    if (audience.mode === "specific") return false;
    if (audience.mode === "all") return true;
    return (
      (!audience.grades.length ||
        (tutor.gradeLevel !== null &&
          audience.grades.includes(tutor.gradeLevel))) &&
      (!audience.statuses.length ||
        audience.statuses.some((status) => status === tutor.status)) &&
      (!audience.subjects.length ||
        tutor.subjects.some((subject) =>
          audience.subjects.includes(subject),
        )) &&
      (audience.assignment === "any" ||
        (audience.assignment === "with"
          ? tutor.activeTutees > 0
          : tutor.activeTutees === 0))
    );
  });
}

/** The database read and acknowledgement paths share this fail-closed predicate. */
export function announcementVisibility(tutorId: string) {
  return {
    OR: [
      { audienceRestricted: false },
      { recipientTutorIds: { has: tutorId } },
    ],
  };
}
