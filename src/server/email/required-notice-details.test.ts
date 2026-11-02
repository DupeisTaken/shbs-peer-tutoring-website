import { describe, expect, it } from "vitest";
import {
  historyInvitationScope,
  invitationPurpose,
  verificationPurposeLabels,
} from "./required-notice-details";

describe("required email action details", () => {
  it("distinguishes each verification operation without including account values", () => {
    expect(verificationPurposeLabels.PASSWORD_CHANGE.en).toBe(
      "change your password",
    );
    expect(verificationPurposeLabels.EMAIL_CHANGE.zh).toBe("更改主邮箱");
    expect(
      new Set(Object.values(verificationPurposeLabels).map((value) => value.en))
        .size,
    ).toBe(5);
  });

  it("identifies all supported invitation audiences and treats unknown kinds as data", () => {
    const kinds = [
      "HEAD",
      "ADMIN",
      "COORDINATOR",
      "TUTOR",
      "TUTEE",
      "CREW",
      "VIEWER",
      "HISTORY",
    ];
    expect(new Set(kinds.map((kind) => invitationPurpose(kind).en)).size).toBe(
      kinds.length,
    );
    for (const kind of ["PRIVATE_REASON", "__proto__", "constructor"])
      expect(invitationPurpose(kind)).toEqual({
        en: "account access",
        zh: "账户访问权限",
      });
  });

  it("describes only reviewed profile counts, with no historical identifiers", () => {
    const sources = [
      { kind: "TUTOR" as const, id: "PRIVATE_TUTOR" },
      { kind: "TUTEE" as const, id: "PRIVATE_TUTEE_1" },
      { kind: "TUTEE" as const, id: "PRIVATE_TUTEE_2" },
    ];
    const detail = historyInvitationScope(sources);
    expect(detail.en).toContain(
      "1 historical tutor profile and 2 historical tutee profiles",
    );
    expect(detail.zh).toContain("2 份历史学习伙伴档案");
    expect(JSON.stringify(detail)).not.toContain("PRIVATE");
  });
});
