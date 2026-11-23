import type { HelpArticle, HelpCategory, HelpLocale } from "~/lib/help/types";

export const helpCopy = {
  en: {
    title: "Help & How-to",
    subtitle: "Find your task. Follow the screens. Know what happens next.",
    intro:
      "Step-by-step walkthroughs, explanations and quick fixes for the peer tutoring website.",
    home: "Back to your home",
    catalogue: "All guides",
    search: "Search guides",
    searchHint: "Try attendance, password, scheduling or approval",
    audience: "Guide audience",
    allAudiences: "All available audiences",
    categories: "Browse by task",
    allCategories: "All tasks",
    results: "guides found",
    of: "of",
    reset: "Clear filters",
    empty: "No guides match these filters",
    emptyHelp: "Try a shorter phrase or clear the audience and task filters.",
    access:
      "The catalogue shows guides available to your current account. Independent tutor, crew and translation assignments add their own guides.",
    guest:
      "Reading as a visitor? Sign in to see guides for your account and roles.",
    signIn: "Sign in",
    open: "Read guide",
    steps: "steps",
    covers: "In this guide",
    before: "Before you start",
    walkthrough: "Step-by-step walkthrough",
    focus: "Look for",
    expected: "What happens next",
    explanation: "How it works",
    troubleshooting: "If something goes wrong",
    related: "Continue with",
    openPage: "Open this page",
    privateLinkHint:
      "Use the complete link from your email to open your record. Keep that private link to yourself.",
    contents: "On this page",
    image: "Open full screenshot",
    screenshot: "Real development-server screenshot",
    english: "English screen",
    chinese: "Chinese screen",
    provenance: "About these screenshots",
    provenanceHelp:
      "Screenshots use synthetic demonstration accounts on a real development server. They illustrate the saved release shown below; school settings and permissions can change the controls you see.",
    captured: "Captured",
    revision: "Source revision",
    release: "Release baseline",
    server: "Capture server",
    source: "View this catalogue on GitHub",
    downloads: "PDF handbooks",
    downloadsHelp:
      "Download a role handbook for offline reading. Each PDF contains the same walkthroughs and screenshots as this catalogue.",
    download: "Download PDF",
    handbookHelp:
      "Staff can download participant training handbooks here. Administration and Head handbooks follow your current authority.",
    pdfLanguage: "PDF language",
    fallback:
      "This guide is shown in English. English and Chinese editions are currently available.",
    screenshotMissing:
      "This screen is awaiting a verified capture. Follow the named controls in the written steps.",
    print: "Print or save this guide",
    support:
      "Still stuck? Include the page, time and role when contacting program support. Keep account links, codes and participant details private.",
    categoriesMap: {
      start: "Join the program",
      account: "Account & access",
      sessions: "Tutoring & patrol",
      operations: "Daily coordination",
      administration: "Settings & publishing",
    },
  },
  zh: {
    title: "帮助与操作指南",
    subtitle: "找到任务，跟随界面操作，了解接下来会发生什么。",
    intro: "同伴辅导网站的分步操作、原理说明与简要故障排查。",
    home: "返回你的首页",
    catalogue: "全部指南",
    search: "搜索指南",
    searchHint: "例如：考勤、密码、排课或审批",
    audience: "指南适用对象",
    allAudiences: "所有可用对象",
    categories: "按任务浏览",
    allCategories: "全部任务",
    results: "篇指南符合条件",
    of: "/",
    reset: "清除筛选",
    empty: "没有符合筛选条件的指南",
    emptyHelp: "试试更简短的关键词，或清除适用对象与任务筛选。",
    access:
      "目录仅显示当前账号可用的指南。辅导伙伴、巡查成员与翻译分工各自决定相应指南的访问权限。",
    guest: "当前以访客身份阅读。登录后可查看适用于你的账号与职责的指南。",
    signIn: "登录",
    open: "阅读指南",
    steps: "个步骤",
    covers: "本指南包括",
    before: "开始之前",
    walkthrough: "分步操作",
    focus: "请找到",
    expected: "接下来会发生什么",
    explanation: "运作原理",
    troubleshooting: "遇到问题时",
    related: "继续阅读",
    openPage: "打开相关页面",
    privateLinkHint:
      "请通过邮件中的完整私密链接打开你的记录，并妥善保管该链接。",
    contents: "本页目录",
    image: "打开完整截图",
    screenshot: "真实开发服务器截图",
    english: "英文界面",
    chinese: "中文界面",
    provenance: "关于这些截图",
    provenanceHelp:
      "截图来自真实开发服务器上的合成演示账号，对应下方标明的版本。学校配置与权限可能使你看到的控件有所不同。",
    captured: "截图时间",
    revision: "源代码版本",
    release: "发布版本基线",
    server: "截图服务器",
    source: "在 GitHub 查看本目录",
    downloads: "PDF 操作手册",
    downloadsHelp:
      "下载对应职责的手册以便离线阅读。PDF 与本目录使用相同的操作步骤和截图。",
    download: "下载 PDF",
    handbookHelp:
      "工作人员可在此下载参与者培训手册。管理审核与负责人手册按当前管理权限提供。",
    pdfLanguage: "PDF 语言",
    fallback: "本指南以英文显示。目前提供英文与中文版本。",
    screenshotMissing:
      "此界面正在等待经过核验的截图。请按文字步骤中列出的控件操作。",
    print: "打印或保存本指南",
    support:
      "仍需帮助时，请向项目支持提供页面、时间与职责。请勿公开账号链接、验证码或参与者详情。",
    categoriesMap: {
      start: "加入项目",
      account: "账号与访问",
      sessions: "辅导与巡查",
      operations: "日常协调",
      administration: "设置与发布",
    },
  },
} as const;

/** An explicit task category changes discoverability, never role access.
 * Existing guides retain their audience default until deliberately classified. */
export function helpCategory(
  article: Pick<HelpArticle, "audience" | "category">,
): HelpCategory {
  if (article.category) return article.category;
  const { audience } = article;
  if (audience === "public") return "start";
  if (audience === "account" || audience === "observer") return "account";
  if (["student", "tutor", "crew"].includes(audience)) return "sessions";
  return audience === "staff" ? "operations" : "administration";
}

export function captureDate(value: string, locale: HelpLocale): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "Asia/Shanghai",
      }).format(date);
}
