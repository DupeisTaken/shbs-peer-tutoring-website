/** Chair eligibility is independent of other panelists' rank. Coordinators can
 * participate and vote, but only Admin or Head accounts may chair an interview. */
export function isInterviewChairRole(role: string | null | undefined) {
  return role === "ADMIN" || role === "HEAD";
}
