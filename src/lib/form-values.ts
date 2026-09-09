/** FormData entries may also be files. These text-only forms reject that ambiguity. */
export function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
export function formTexts(data: FormData, key: string): string[] {
  return data.getAll(key).filter((value): value is string => typeof value === "string");
}
