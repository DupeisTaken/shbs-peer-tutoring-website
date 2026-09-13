import { expect, it } from "vitest";
import { defaultMessageGroups, messageDestination } from "./messaging";
it.each(["HEAD", "ADMIN", "COORDINATOR"])(
  "keeps %s messages inside management navigation",
  (role) => {
    expect(messageDestination(role)).toBe("/admin/messages");
    expect(defaultMessageGroups(role)).toEqual(["ALL_USERS"]);
  },
);
it.each(["TUTOR", "CREW", "VIEWER"])(
  "retains the standalone destination for %s",
  (role) => {
    expect(messageDestination(role)).toBe("/messages");
    expect(defaultMessageGroups(role)).toEqual(["MANAGEMENT"]);
  },
);
it("keeps tutee message navigation inside the tutee workspace", () => {
  expect(messageDestination("STUDENT")).toBe("/student?view=messages");
});
