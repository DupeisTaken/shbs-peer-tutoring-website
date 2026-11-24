import {
  parse,
  TYPE,
  type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";

type ArgumentKind = "value" | "number" | "date" | "tag";
type Contract = Map<string, Set<ArgumentKind>>;

export type MessageCompatibility =
  | { compatible: true }
  | { compatible: false; reason: "source-syntax" | "syntax" }
  | {
      compatible: false;
      reason: "arguments";
      missing: string[];
      unexpected: string[];
      changed: string[];
    };

/** Read nested branches rather than treating their translated words as arguments. */
function collect(nodes: MessageFormatElement[], contract: Contract): Contract {
  for (const node of nodes) {
    if (node.type === TYPE.literal || node.type === TYPE.pound) continue;
    const kind: ArgumentKind =
      node.type === TYPE.tag
        ? "tag"
        : node.type === TYPE.number || node.type === TYPE.plural
          ? "number"
          : node.type === TYPE.date || node.type === TYPE.time
            ? "date"
            : "value";
    const kinds = contract.get(node.value) ?? new Set<ArgumentKind>();
    kinds.add(kind);
    contract.set(node.value, kinds);
    if (node.type === TYPE.tag) collect(node.children, contract);
    if (node.type === TYPE.select || node.type === TYPE.plural) {
      for (const option of Object.values(node.options))
        collect(option.value, contract);
    }
  }
  return contract;
}

function signature(kinds: Set<ArgumentKind>): string {
  // A source can interpolate {count} and pluralize it in the same message.
  // Its supplied value is numeric even when a locale needs only the plural.
  return [...kinds]
    .filter((kind) => kind !== "value" || !kinds.has("number"))
    .sort()
    .join("+");
}

/** Canonical messages describe the values/callbacks the caller supplies. Locale
 * plural categories, branch wording/order and numeric/date styles may differ;
 * new names, dropped values or changed runtime kinds cannot gain caller support. */
export function translationMessageCompatibility(
  source: string,
  value: string,
): MessageCompatibility {
  let canonical: Contract;
  let translated: Contract;
  try {
    canonical = collect(parse(source), new Map());
  } catch {
    return { compatible: false, reason: "source-syntax" };
  }
  try {
    translated = collect(parse(value), new Map());
  } catch {
    return { compatible: false, reason: "syntax" };
  }
  const missing = [...canonical.keys()]
    .filter((name) => !translated.has(name))
    .sort();
  const unexpected = [...translated.keys()]
    .filter((name) => !canonical.has(name))
    .sort();
  const changed = [...canonical]
    .filter(([name, kinds]) => {
      const replacement = translated.get(name);
      if (!replacement) return false;
      const sourceKind = signature(kinds);
      const replacementKind = signature(replacement);
      // Numeric values also support ordinary interpolation/select. Languages
      // without English plural inflection legitimately render "{count} 条记录".
      return (
        sourceKind !== replacementKind &&
        !(sourceKind === "number" && replacementKind === "value")
      );
    })
    .map(([name]) => name)
    .sort();
  return missing.length || unexpected.length || changed.length
    ? { compatible: false, reason: "arguments", missing, unexpected, changed }
    : { compatible: true };
}
