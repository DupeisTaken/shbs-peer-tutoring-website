import { expect, it } from "vitest";
import {
  nameDraft,
  personNameEdit,
  personNameSchema,
  unsplitLegacyName,
} from "./person-name";

it.each(["张小明", "Mary Ann Smith"])(
  "preserves %s without inventing name parts",
  (legacy) => {
    const original = nameDraft();
    expect(
      personNameEdit(
        { ...original, alternativeNames: "New alias" },
        original,
        legacy,
      ),
    ).toEqual({
      name: legacy,
      fields: { alternativeNames: "New alias" },
      preserved: true,
    });
  },
);
it.each(["firstName", "lastName", "preferredName"] as const)(
  "requires structured validation when %s changes",
  (key) => {
    const original = nameDraft();
    const edit = personNameEdit(
      { ...original, [key]: "张" },
      original,
      "张小明",
    );
    expect(edit.preserved).toBe(false);
    expect(personNameSchema.safeParse(edit.fields).success).toBe(false);
    expect(personNameEdit(original, original, "张小明").preserved).toBe(true);
  },
);
it("does not exempt new identities or allow clearing an existing structured name", () => {
  expect(personNameEdit(nameDraft(), nameDraft(), null).preserved).toBe(false);
  expect(
    personNameEdit(nameDraft(), nameDraft({ firstName: "Alex" }), "Alex")
      .preserved,
  ).toBe(false);
});

it("distinguishes stored legacy identity from active username fallbacks", () => {
  expect(
    unsplitLegacyName({
      legacyName: null,
      name: "person-41",
      username: "person-41",
    }),
  ).toBeNull();
  expect(
    unsplitLegacyName({ name: "person-41", username: "person-41" }),
  ).toBeNull();
  expect(unsplitLegacyName({ legacyName: "张小明", name: "person-41" })).toBe(
    "张小明",
  );
  expect(unsplitLegacyName({ englishName: "Mary Ann Smith" })).toBe(
    "Mary Ann Smith",
  );
  expect(
    unsplitLegacyName({ legacyName: "Mary Ann Smith", firstName: "Mary" }),
  ).toBeNull();
  expect(
    unsplitLegacyName({ legacyName: "Mary Ann Smith", firstName: "" }),
  ).toBeNull();
});
