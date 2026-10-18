import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { compare, SortHeader, type Sort } from "../sortable";

type CellProps = {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  "data-sort-value"?: string | number;
  "data-sortable"?: boolean;
};

/** Flatten fragments without executing components or mounting private readers.
 * Keep React's scoped keys so reordering preserves row-local drafts and dialogs.
 */
function elements(children: ReactNode): ReactElement<CellProps>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<CellProps>(child)) return [];
    if (child.type !== Fragment) return [child];
    return elements(child.props.children).map((nested) =>
      cloneElement(nested, { key: `${child.key}/${nested.key}` }),
    );
  });
}

/** Plain labels are sortable by text; domain cells supply raw values explicitly.
 * Never parse localized dates or inspect rendered DOM, component props or hidden details.
 */
function cellText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (isValidElement<CellProps>(value)) {
    if (typeof value.type !== "string" && value.type !== Fragment) return "";
    if (value.props.className?.split(" ").includes("sr-only")) return "";
    return cellText(value.props.children);
  }
  return Children.toArray(value).map(cellText).join("");
}

function valueOf(
  cell: ReactElement<CellProps> | undefined,
): string | number | null {
  const raw =
    cell?.props["data-sort-value"] ?? cellText(cell?.props.children).trim();
  if (raw === "" || raw === "—" || raw === "–") return null;
  // Signed decimal counts/hours must sort numerically (including negatives).
  if (typeof raw === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(raw))
    return Number(raw);
  return raw;
}

/** Opt-in information tables only. Features retain ownership of rows, filters,
 * permissions and fetching; status rows remain in place and data is never mutated.
 */
export function sortTableChildren(
  children: ReactNode,
  sort: Sort,
  locale: string,
): ReactNode {
  const sections = elements(children);
  const head = sections.find((section) => section.type === "thead");
  const headerRow = elements(head?.props.children)[0];
  const columns = elements(headerRow?.props.children);
  // Include the label so removing a conditional column cannot sort its neighbour.
  const columnKey = (column: ReactElement<CellProps>, index: number) =>
    `${column.key ?? index}:${cellText(column.props.children)}`;
  const sortable = (column: ReactElement<CellProps>) =>
    column.type === "th" &&
    column.props["data-sortable"] !== false &&
    !column.props.className?.split(" ").includes("table-actions-heading");
  const index = columns.findIndex(
    (column, i) => sortable(column) && columnKey(column, i) === sort.key,
  );

  return sections.map((section) => {
    if (section === head && headerRow) {
      return cloneElement(
        section,
        {},
        cloneElement(
          headerRow,
          {},
          columns.map((column, i) =>
            sortable(column) ? (
              <SortHeader
                {...column.props}
                key={column.key}
                sort={sort}
                sortKey={columnKey(column, i)}
              >
                {column.props.children}
              </SortHeader>
            ) : (
              column
            ),
          ),
        ),
      );
    }
    if (section.type !== "tbody") return section;
    const rows = elements(section.props.children);
    // Always use the same flattened tree, even without sorting, to preserve keys.
    if (sort.dir === "none" || index < 0)
      return cloneElement(section, {}, rows);
    const isRecord = (row: ReactElement<CellProps>) =>
      row.type === "tr" &&
      elements(row.props.children).every(
        (cell) => (cell.props.colSpan ?? 1) === 1,
      );
    const records = rows.filter(isRecord).map((row, position) => ({
      row,
      position,
      value: valueOf(elements(row.props.children)[index]),
    }));
    records.sort((a, b) => {
      // Unknowns stay last in both directions; equal values retain source order.
      if (a.value === null || b.value === null)
        return (
          (a.value === null ? 1 : 0) - (b.value === null ? 1 : 0) ||
          a.position - b.position
        );
      return (
        compare(a.value, b.value, locale) * (sort.dir === "asc" ? 1 : -1) ||
        a.position - b.position
      );
    });
    let next = 0;
    return cloneElement(
      section,
      {},
      rows.map((row) => (isRecord(row) ? records[next++]!.row : row)),
    );
  });
}
