import type { VerificationPurpose } from "../../../generated/prisma";

type Bilingual = { en: string; zh: string };

/** Describe the approved operation, never a posted free-text purpose or secret. */
export const verificationPurposeLabels: Record<VerificationPurpose, Bilingual> =
  {
    PASSWORD_CHANGE: { en: "change your password", zh: "更改密码" },
    PASSWORD_RESET: { en: "reset your password", zh: "重设密码" },
    LOGIN_2FA: { en: "complete two-factor sign-in", zh: "完成双重验证登录" },
    EMAIL_CHANGE: { en: "change your primary email address", zh: "更改主邮箱" },
    SECONDARY_EMAIL: {
      en: "add a secondary email address",
      zh: "添加备用邮箱",
    },
  };

const invitationKinds: Record<string, Bilingual> = {
  HEAD: { en: "Head access", zh: "负责人权限" },
  ADMIN: { en: "Admin access", zh: "管理员权限" },
  COORDINATOR: { en: "Coordinator access", zh: "协调员权限" },
  TUTOR: { en: "Tutor participation", zh: "辅导伙伴身份" },
  CREW: { en: "Crew participation", zh: "值勤人员身份" },
  TUTEE: { en: "Tutee signup", zh: "学习伙伴报名" },
  VIEWER: { en: "read-only Viewer access", zh: "只读观察员权限" },
  HISTORY: { en: "access to your historical records", zh: "访问历史记录" },
};

export function invitationPurpose(kind: string): Bilingual {
  // Unknown historical kinds use a readable fallback, never untrusted kind text.
  return Object.hasOwn(invitationKinds, kind)
    ? invitationKinds[kind]!
    : { en: "account access", zh: "账户访问权限" };
}

/** Count reviewed profile records; attendance and private historical notes stay in the portal. */
export function historyInvitationScope(
  sources: readonly { kind: "TUTOR" | "TUTEE" }[],
): Bilingual {
  const tutors = sources.filter((source) => source.kind === "TUTOR").length;
  const tutees = sources.filter((source) => source.kind === "TUTEE").length;
  return {
    en: `Reviewed scope: ${tutors} historical tutor profile${tutors === 1 ? "" : "s"} and ${tutees} historical tutee profile${tutees === 1 ? "" : "s"}, with their associated records.`,
    zh: `已审核范围：${tutors} 份历史辅导伙伴档案、${tutees} 份历史学习伙伴档案及其关联记录。`,
  };
}
