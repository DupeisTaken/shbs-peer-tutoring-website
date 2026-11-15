import { participantArticles } from "./participant-content";
import { managementArticles } from "./management-content";
import { helpText as t, type HelpAudience } from "./types";

export const helpAudiences: HelpAudience[] = [
  "public",
  "account",
  "student",
  "tutor",
  "crew",
  "observer",
  "staff",
  "admin",
  "head",
  "translator",
];
export const helpAudienceTitles = {
  public: t("Get started", "开始使用"),
  account: t("Your account", "我的账户"),
  student: t("Get tutoring", "接受辅导"),
  tutor: t("Tutor workspace", "辅导伙伴工作台"),
  crew: t("Crew & patrols", "巡查队与巡查"),
  observer: t("Observe the program", "查看项目"),
  staff: t("Manage the program", "管理项目"),
  admin: t("Review & administer", "审核与管理"),
  head: t("Head responsibilities", "负责人职责"),
  translator: t("Translate the website", "翻译网站"),
} satisfies Record<HelpAudience, { en: string; zh: string }>;

export const helpArticles = [...participantArticles, ...managementArticles];

export function handbookArticles(audience: HelpAudience) {
  // Editions are task collections, not permission bundles. Management can download
  // participant training books without acquiring participant access in the product.
  return helpArticles.filter((article) => article.audience === audience);
}
