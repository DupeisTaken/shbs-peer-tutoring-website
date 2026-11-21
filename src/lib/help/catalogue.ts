import { participantArticles } from "./participant-content";
import { managementArticles } from "./management-content";
import { getHelpScreenshot, helpScreenshots } from "./screenshots";
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

// A frame belongs to one numbered instruction, not merely its feature's landing
// page. Capture checks bind the recorded title/body to that exact step so later
// reordering cannot silently attach a screenshot to a different action.
export const helpArticles = [...participantArticles, ...managementArticles].map(
  (article) => ({
    ...article,
    steps: article.steps.map((step, index) => {
      const id = `${article.slug}-step-${index + 1}`;
      const supplementaryScreenshots = [
        ...new Set(
          helpScreenshots
            .filter(
              (capture) =>
                capture.locale === "en" && capture.id.startsWith(`${id}-view-`),
            )
            .map((capture) => capture.id),
        ),
      ].sort(
        (left, right) =>
          Number(left.slice(`${id}-view-`.length)) -
          Number(right.slice(`${id}-view-`.length)),
      );
      return {
        ...step,
        ...(getHelpScreenshot(id) ? { screenshot: id } : {}),
        ...(supplementaryScreenshots.length
          ? { supplementaryScreenshots }
          : {}),
      };
    }),
  }),
);

export function handbookArticles(audience: HelpAudience) {
  // Editions are task collections, not permission bundles. Management can download
  // participant training books without acquiring participant access in the product.
  return helpArticles.filter((article) => article.audience === audience);
}
