import { expect, it } from "vitest";
import { checkpointEvidenceText } from "./checkpoint-evidence";
it("localizes the terminal quarter-withdrawal boundary without changing its canonical diagnostic", () => {
  const diagnostic = "Approved quarter withdrawal is inspection-only. Generic recovery cannot reopen its requests, restore assignments or remove the quarter withdrawal block.";
  expect(checkpointEvidenceText(diagnostic, "en")).toBe(diagnostic);
  expect(checkpointEvidenceText(diagnostic, "zh-CN")).toBe(
    "已批准的季度退出检查点仅供查看。通用恢复不能重新开启相关申请、恢复分配或移除本季度退出限制。",
  );
});
it("translates canonical checkpoint consequences without changing source IDs, tables or saved evidence", () => {
  const source = "Restore TUTOR synthetic-record lifecycle to ARCHIVED.";
  expect(checkpointEvidenceText(source, "en")).toBe(source);
  expect(checkpointEvidenceText(source, "zh")).toBe(
    "将辅导伙伴 synthetic-record 的参与状态恢复为已归档。",
  );
  expect(
    checkpointEvidenceText(
      "Missing recovery coverage: Tutor, StudentSurvey.",
      "zh-CN",
    ),
  ).toBe("缺少恢复覆盖：Tutor, StudentSurvey。");
  expect(
    checkpointEvidenceText(
      "Create 2 owner-review draft(s); restoration awaits their ordinary fresh submissions.",
      "zh",
    ),
  ).toContain("2 份本人审核草稿");
});
it("keeps unknown future diagnostics verbatim and translates known preservation/delivery boundaries", () => {
  expect(checkpointEvidenceText("Future operator diagnostic: x", "zh")).toBe(
    "Future operator diagnostic: x",
  );
  expect(
    checkpointEvidenceText(
      "Current account security, restrictions and ownership.",
      "zh",
    ),
  ).toBe("当前账号安全、限制与归属。");
  expect(
    checkpointEvidenceText(
      "A captured delivery effect has an unknown outcome.",
      "zh",
    ),
  ).toBe("一项已记录的通知发送结果未知。");
});
