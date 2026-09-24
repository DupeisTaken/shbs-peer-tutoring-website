import { describe, expect, it } from "vitest";
import { BUNDLED_POLICIES, POLICY_VERSION } from "../../prisma/policies";
import { roundToHalfHour } from "./service-hours";

/** Guard the documents actually loaded by the seed, including translated structure
 * and numerical examples that would mislead participants if the calculator changes. */
describe("bundled policy documents", () => {
  it("loads exactly one current English and Chinese draft for each audience", () => {
    expect(BUNDLED_POLICIES.map((p) => `${p.slug}.${p.locale}`).sort()).toEqual(
      [
        "tutee-policy.en",
        "tutee-policy.zh",
        "tutor-policy.en",
        "tutor-policy.zh",
      ],
    );
    for (const policy of BUNDLED_POLICIES) {
      expect(policy.version).toBe(POLICY_VERSION);
      expect(policy.body.split("\n")[0]).toBe(`# ${policy.title}`);
      const revisions = policy.body.match(/\b\d{4}\.\d{2}\.\d{2}\b/g);
      expect(revisions).not.toBeNull();
      expect(new Set(revisions)).toEqual(new Set([POLICY_VERSION]));
      expect(policy.body).not.toContain("\uFFFD");
    }
  });

  it.each(["tutor-policy", "tutee-policy"])(
    "%s preserves the legacy section order with matching translated subsections",
    (slug) => {
      const policies = BUNDLED_POLICIES.filter((p) => p.slug === slug);
      const structure = (body: string) =>
        [...body.matchAll(/^(#{2,3}) ([IVX]+|\d+)\./gm)].map(
          ([, depth, number]) => `${depth} ${number}`,
        );
      expect(structure(policies[0]!.body)).toEqual(
        structure(policies[1]!.body),
      );
      const sections = structure(policies[0]!.body).filter((s) =>
        s.startsWith("## "),
      );
      expect(sections).toEqual(
        (slug === "tutor-policy"
          ? ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]
          : ["I", "II", "III", "IV"]
        ).map((number) => `## ${number}`),
      );
    },
  );

  it("both tutor documents give rounding examples that match the real calculator", () => {
    const tables = BUNDLED_POLICIES.filter(
      (p) => p.slug === "tutor-policy",
    ).map((policy) => {
      const examples = [
        ...policy.body.matchAll(/^\| (\d+) \| ([\d.]+) \|$/gm),
      ].map(([, minutes, hours]) => [Number(minutes), Number(hours)] as const);
      expect(examples.length).toBeGreaterThanOrEqual(8);
      for (const [minutes, hours] of examples) {
        expect(hours, `${policy.locale}: ${minutes} minutes`).toBe(
          roundToHalfHour(minutes),
        );
      }
      return examples;
    });
    expect(tables[0]).toEqual(tables[1]);
  });
});
