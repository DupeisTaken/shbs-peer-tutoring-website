import { createTranslator } from "next-intl";
import { expect, it } from "vitest";

import de from "../../messages/de.json";
import el from "../../messages/el.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import zh from "../../messages/zh.json";

const catalogs = { en, zh, es, ja, ko, el, de, fr };
const labels = {
  en: [
    "panel 4 (minimum 3)",
    "Interview Panel (3–8 Tutors, One Chair)",
    "0 accept · 3 reject",
  ],
  zh: [
    "面试小组 4 人（至少 3 人）",
    "面试小组（3–8 人，一名组长）",
    "0 票通过 · 3 票拒绝",
  ],
  es: [
    "panel de 4 (mínimo 3)",
    "Panel de entrevista (de 3 a 8 tutores, un responsable)",
    "0 aceptan · 3 rechazan",
  ],
  ja: [
    "パネル 4名（最低3名）",
    "面接パネル（3～8名、代表1名）",
    "0 合格 · 3 不合格",
  ],
  ko: [
    "패널 4명 (최소 3명)",
    "면접 패널 (3~8명, 대표 1명)",
    "0명 합격 · 3명 불합격",
  ],
  el: [
    "επιτροπή 4 ατόμων (τουλάχιστον 3)",
    "Επιτροπή συνέντευξης (3–8 βοηθοί, ένας υπεύθυνος)",
    "0 έγκριση · 3 απόρριψη",
  ],
  de: [
    "Gremium mit 4 Personen (mindestens 3)",
    "Interviewgremium (3–8 Tutoren, ein Leiter)",
    "0 dafür · 3 dagegen",
  ],
  fr: [
    "jury de 4 personnes (minimum 3)",
    "Jury d'entretien (de 3 à 8 tuteurs, un responsable)",
    "0 pour · 3 contre",
  ],
};

it.each(Object.entries(catalogs))(
  "distinguishes the saved panel count, supported range and recorded votes in %s",
  (locale, messages) => {
    const t = createTranslator({
      locale,
      messages,
      namespace: "admin.applications",
    });
    const [count, heading, tally] = labels[locale as keyof typeof labels];
    expect(t("panelCount", { n: 4, min: 3 })).toBe(count);
    expect(t("panelRangeHeading", { min: 3, max: 8 })).toBe(heading);
    expect(t("voteTally", { accepts: 0, rejects: 3 })).toBe(tally);
    for (const key of ["panelRangeIntro", "pickRangeHint"] as const) {
      const copy = t(key, { min: 3, max: 8 });
      expect(copy).toContain("3");
      expect(copy).toContain("8");
      expect(copy).not.toMatch(/\{|\}|⟦/);
    }
  },
);
