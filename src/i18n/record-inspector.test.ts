import { describe, expect, it } from "vitest";
import de from "../../messages/de.json";
import el from "../../messages/el.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import zh from "../../messages/zh.json";

describe("database inspector translations", () => {
  it.each(Object.entries({ de, el, en, es, fr, ja, ko, zh }))(
    "provides every visible state and omission reason in %s",
    (_locale, catalog) => {
      expect(Object.keys(catalog.recordInspector).sort()).toEqual(
        Object.keys(en.recordInspector).sort(),
      );
      expect(Object.keys(catalog.recordInspector.reasons).sort()).toEqual([
        "relation",
        "restricted",
        "size",
        "unsupported",
      ]);
      for (const text of Object.values(catalog.recordInspector)) {
        if (typeof text === "string") expect(text.trim()).not.toBe("");
        else
          for (const reason of Object.values(text))
            expect(reason.trim()).not.toBe("");
      }
      expect(catalog.recordInspector.keyHelp).toContain("{fields}");
      expect(catalog.recordInspector.page).toContain("{page}");
      expect(Object.keys(catalog.recovery).sort()).toEqual(
        Object.keys(en.recovery).sort(),
      );
      for (const text of Object.values(catalog.recovery)) {
        if (typeof text === "string") expect(text.trim()).not.toBe("");
        else
          for (const diagnostic of Object.values(text))
            expect(diagnostic.trim()).not.toBe("");
      }
      expect(Object.keys(catalog.recovery.evidence).sort()).toEqual(
        Object.keys(en.recovery.evidence).sort(),
      );
      expect(catalog.recovery.evidence.missingCoverage).toContain("{tables}");
      expect(catalog.recovery.evidence.unsupportedEvent).toContain("{kind}");
      expect(catalog.recovery.application).toContain("{id}");
      expect(catalog.recovery.eventOther).toContain("{kind}");
    },
  );
});
