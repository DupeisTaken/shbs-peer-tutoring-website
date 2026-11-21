/** Only the two /p/<slug> owners can select an editor view on preview return. */
export type LandingEditorView = "pages" | "sections";

export function parseLandingEditorView(
  value: unknown,
): LandingEditorView | undefined {
  return value === "pages" || value === "sections" ? value : undefined;
}
