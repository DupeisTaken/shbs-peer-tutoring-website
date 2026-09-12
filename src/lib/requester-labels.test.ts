import { expect, it } from "vitest";
import { requesterLabels } from "./requester-labels";
it("uses emails only to disambiguate names and preserves readable historical identities", () => {
  const labels = requesterLabels(
    [
      { requesterId: "1", requesterName: "Old Alex" },
      { requesterId: "2", requesterName: "Alex" },
      { requesterId: "3", requesterName: "Former Pat" },
    ],
    [
      { id: "1", name: "Alex", username: "alex1", email: "a@example.edu" },
      { id: "2", name: "Alex", username: "alex2", email: "b@example.edu" },
    ],
  );
  expect(labels.map((entry) => entry.label)).toEqual([
    "Alex (a@example.edu)",
    "Alex (b@example.edu)",
    "Former Pat",
  ]);
});
it("does not expose an opaque ID when no historical name exists", () => {
  expect(
    requesterLabels(
      [{ requesterId: "opaque-id", requesterName: "opaque-id" }],
      [],
    )[0]?.label,
  ).toBe("Former team member");
});
