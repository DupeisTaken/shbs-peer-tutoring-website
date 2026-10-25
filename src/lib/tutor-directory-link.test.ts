import { describe, expect, it } from "vitest";
import {
  tutorDirectoryAnchor,
  tutorDirectoryHref,
  tutorIdFromDirectoryHash,
} from "./tutor-directory-link";

describe("explicit tutor directory destinations", () => {
  it("round-trips opaque roster IDs without names or mailbox lookup", () => {
    const id = "historical tutor/中文#1";
    const anchor = tutorDirectoryAnchor(id);
    expect(tutorDirectoryHref(id)).toBe(`/admin/users#${anchor}`);
    expect(tutorIdFromDirectoryHash(`#${anchor}`)).toBe(id);
  });

  it.each(["", "#application-tutor", "#tutor-", "#tutor-%ZZ"])(
    "ignores an unrelated or malformed fragment %s",
    (hash) => expect(tutorIdFromDirectoryHash(hash)).toBeNull(),
  );
});
