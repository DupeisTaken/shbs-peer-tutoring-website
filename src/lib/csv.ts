export type CsvCell = string | number | null;

/** Export user-supplied text as spreadsheet text, never an executable formula.
 * CSV quoting alone does not neutralize a formula. Prefix risky strings before quoting,
 * including whitespace/control-prefixed and full-width formula markers. Numeric values
 * remain numeric; callers should pass quantities as numbers, not formatted strings.
 * This protects the initial export; later spreadsheet edits/re-saves are outside our control.
 * See https://owasp.org/www-community/attacks/CSV_Injection.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell == null ? "" : String(cell);
          const prefix = value.trimStart();
          const controlPrefix = (text: string) =>
            text.charCodeAt(0) <= 0x1f || text.charCodeAt(0) === 0x7f;
          const unsafeText =
            typeof cell === "string" &&
            (/^[=+\-@＝＋－＠]/u.test(prefix) ||
              controlPrefix(value) ||
              controlPrefix(prefix));
          const text = unsafeText ? `'${value}` : value;
          return unsafeText || /[",\n\r]/u.test(text)
            ? `"${text.replaceAll('"', '""')}"`
            : text;
        })
        .join(","),
    )
    .join("\r\n");
}
