// The orchestration layer uses only these two APIs from the existing package.
// Parsed YAML stays unknown until each caller checks its expected structure.
declare module "js-yaml" {
  export function load(source: string): unknown;
  export function dump(
    value: unknown,
    options?: { noRefs?: boolean; lineWidth?: number; noCompatMode?: boolean },
  ): string;
}
