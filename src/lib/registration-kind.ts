export const REGISTRATION_KINDS = [
  "TUTOR",
  "CREW",
  "ADMIN",
  "COORDINATOR",
] as const;
export type RegistrationKind = (typeof REGISTRATION_KINDS)[number];
export function isManagementCode(
  kind: string,
): kind is "ADMIN" | "COORDINATOR" {
  return kind === "ADMIN" || kind === "COORDINATOR";
}
/** Share cards and redemption use the same explicit role label as the issuer selector. */
export const registrationKindLabel = {
  TUTOR: "kindTutor",
  CREW: "kindCrew",
  ADMIN: "kindAdmin",
  COORDINATOR: "kindCoordinator",
} as const;
