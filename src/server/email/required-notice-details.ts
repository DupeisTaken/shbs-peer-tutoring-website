import type { VerificationPurpose } from "../../../generated/prisma";

type Bilingual = { en: string; zh: string };

/** Describe the approved operation, never a posted free-text purpose or secret. */
export const verificationPurposeLabels: Record<VerificationPurpose, Bilingual> =
  {
    PASSWORD_CHANGE: { en: "change your password", zh: "修改密码" },
    PASSWORD_RESET: { en: "reset your password", zh: "重置密码" },
    LOGIN_2FA: { en: "finish two-factor sign-in", zh: "完成双重验证登录" },
    EMAIL_CHANGE: { en: "change your primary email", zh: "更改主邮箱" },
    SECONDARY_EMAIL: {
      en: "add a secondary email",
      zh: "添加备用邮箱",
    },
  };

const invitationKinds: Record<string, Bilingual> = {
  HEAD: { en: "Head role", zh: "负责人权限" },
  ADMIN: { en: "Admin role", zh: "管理员权限" },
  COORDINATOR: { en: "Coordinator role", zh: "协调员权限" },
  TUTOR: { en: "Tutor", zh: "辅导伙伴" },
  CREW: { en: "Crew", zh: "巡查成员" },
  TUTEE: { en: "Tutee signup", zh: "学习伙伴报名" },
  VIEWER: { en: "read-only Viewer access", zh: "只读观察员权限" },
  HISTORY: { en: "historical records", zh: "历史记录" },
};

export function invitationPurpose(kind: string): Bilingual {
  // Unknown historical kinds use a readable fallback, never untrusted kind text.
  return Object.hasOwn(invitationKinds, kind)
    ? invitationKinds[kind]!
    : { en: "account", zh: "账号" };
}

/** Count reviewed profile records; attendance and private historical notes stay in the portal. */
export function historyInvitationScope(
  sources: readonly { kind: "TUTOR" | "TUTEE" }[],
): Bilingual {
  const tutors = sources.filter((source) => source.kind === "TUTOR").length;
  const tutees = sources.filter((source) => source.kind === "TUTEE").length;
  if (tutors > 0 && tutees === 0) {
    return {
      en: `Records ready to link: ${tutors} past tutor ${tutors === 1 ? "profile" : "profiles"} and related history.`,
      zh: `待关联记录：${tutors} 份往期辅导伙伴档案及相关记录。`,
    };
  }
  if (tutees > 0 && tutors === 0) {
    return {
      en: `Records ready to link: ${tutees} past tutee ${tutees === 1 ? "profile" : "profiles"} and related history.`,
      zh: `待关联记录：${tutees} 份往期学习伙伴档案及相关记录。`,
    };
  }
  return {
    en: `Records ready to link: ${tutors} past tutor ${tutors === 1 ? "profile" : "profiles"} and ${tutees} past tutee ${tutees === 1 ? "profile" : "profiles"}, with related history.`,
    zh: `待关联记录：${tutors} 份往期辅导伙伴档案、${tutees} 份往期学习伙伴档案及相关记录。`,
  };
}
