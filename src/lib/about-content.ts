import type { Block } from "~/lib/page-blocks";

/**
 * Reserved HomeContent key toggling whether /about renders an editor-authored custom page
 * (stored in CustomPage with slug "about") instead of the dedicated built-in About page.
 * Intentionally omitted from HOME_FIELDS so only adminProcedure (`home.setAboutMode`) can change it.
 */
export const ABOUT_CUSTOM_MODE_KEY = "about.useCustom";

/** Reserved slug for the optional editor-authored alternative About page. */
export const ABOUT_PAGE_SLUG = "about";

export type AboutRoleId = "tutees" | "tutors" | "crew" | "management" | "viewers";

export type AboutContent = {
  lang: "en" | "zh";
  navTitle: string;
  headerTitle: string;
  title: string;
  eyebrow: string;
  introduction: string;
  contentsLabel: string;
  stats: {
    heading: string;
    sessionsLabel: string;
    sessionsCaption: string;
    minutesLabel: string;
    minutesCaption: string;
  };
  story: {
    id: string;
    title: string;
    paragraphs: string[];
    pillars: { title: string; body: string }[];
  };
  howItWorks: {
    id: string;
    title: string;
    curriculumTitle: string;
    curriculumBody: string;
    formatTitle: string;
    facts: { label: string; value: string; detail: string }[];
    admissionTitle: string;
    admissionIntro: string;
    admissionSteps: { step: string; title: string; body: string }[];
  };
  team: {
    id: string;
    title: string;
    independenceLead: string;
    roles: {
      id: AboutRoleId;
      title: string;
      badge: string;
      body: string;
    }[];
    headContactLabel: string;
    headContactFallback: string;
    viewerCta: string;
  };
  audiences: {
    id: string;
    title: string;
    intro: string;
    cards: { title: string; audience: string; body: string }[];
  };
  getInvolved: {
    id: string;
    title: string;
    body: string;
    requestTutor: string;
    becomeTutor: string;
    joinCrew: string;
    followProgram: string;
    helpCenter: string;
    privacyPolicy: string;
  };
  customPreviewNote: string;
};

const en: AboutContent = {
  lang: "en",
  navTitle: "About the Program",
  headerTitle: "Program Information",
  title: "About SHBS Peer Tutoring",
  eyebrow: "100% Student-Run · Founded 2024",
  // Spell out the full school name once here; use SHBS everywhere else.
  introduction:
    "Founded in 2024 at Shanghai Hongrun Boyuan School (SHBS), SHBS Peer Tutoring is a completely student-run mutual-help organization. Tutors and tutees meet as equals—supporting one another across coursework while building genuine connections across campus.",
  contentsLabel: "On this page",
  stats: {
    heading: "Program activity to date",
    sessionsLabel: "Total sessions held",
    sessionsCaption: "Completed peer-tutoring sessions recorded to date.",
    minutesLabel: "Total minutes tutored",
    minutesCaption: "Recorded minutes of peer tutoring across campus.",
  },
  story: {
    id: "story",
    title: "Our story & philosophy",
    paragraphs: [
      "SHBS Peer Tutoring began in 2024 with a straightforward idea: students who have just navigated a demanding course are often the clearest, most approachable guides for classmates working through it next.",
      "Rather than replicating a formal classroom hierarchy, the program is built on mutual help. Tutors and tutees collaborate as fellow students—sharing study strategies, working through difficult concepts together, and turning regular sessions into lasting friendships across grades.",
    ],
    pillars: [
      {
        title: "100% student-run",
        body: "Students lead every part of the organization—from recruitment and matching to scheduling, policies, and daily operations—independent of school faculty intervention.",
      },
      {
        title: "Equals in learning",
        body: "Tutors and tutees sit on the same side of the table. Asking a question is welcomed, and teaching a concept deepens understanding for both students.",
      },
      {
        title: "Built for connection",
        body: "Consistent after-school sessions create cross-grade mentorship and peer relationships that extend well beyond a single assignment or exam.",
      },
    ],
  },
  howItWorks: {
    id: "how-it-works",
    title: "Curriculum, sessions & tutor admission",
    curriculumTitle: "Honors & Advanced Placement (AP) coverage",
    curriculumBody:
      "We support SHBS's Honors and Advanced Placement (AP) curriculum, offering peer tutoring for almost every course taught at the school. As course offerings or student interests grow, new subjects can be added to the program.",
    formatTitle: "How sessions work",
    facts: [
      {
        label: "Group size",
        value: "1 tutor · 1–4 tutees",
        detail: "Focused one-on-one or small-group sessions tailored to the subject.",
      },
      {
        label: "Session length",
        value: "45 minutes",
        detail: "Standard sessions span 45 minutes with clear attendance tracking.",
      },
      {
        label: "Time & place",
        value: "After school · Classrooms",
        detail: "Pairs usually meet in campus classrooms right after the school day.",
      },
      {
        label: "Flexibility",
        value: "Agreed rescheduling",
        detail:
          "When regular timetables do not line up, tutors and tutees can agree on a rescheduled time.",
      },
    ],
    admissionTitle: "How students become tutors",
    admissionIntro:
      "Every tutor enters the program through a transparent, student-led selection process focused on subject mastery, communication, and reliability.",
    admissionSteps: [
      {
        step: "01",
        title: "Self-application",
        body: "Students apply during tutor recruitment, choosing the subjects they want to support and sharing their academic background.",
      },
      {
        step: "02",
        title: "Panel interview & training",
        body: "Applicants complete a student-run panel interview and training session covering teaching approach, expectations, and program policies.",
      },
      {
        step: "03",
        title: "Official admission",
        body: "Accepted applicants join the active tutor roster, receive subject qualifications, and begin matching with tutees while earning service hours.",
      },
    ],
  },
  team: {
    id: "team",
    title: "Who makes the program run",
    independenceLead:
      "SHBS Peer Tutoring is 100% student-run and operates independently of school faculty intervention. Every role below has a clear scope so students can collaborate reliably and transparently.",
    roles: [
      {
        id: "tutees",
        title: "Tutees",
        badge: "Learners",
        body: "Students who request free peer support in their chosen Honors or AP subjects, bring questions and materials, and work alongside a matched tutor.",
      },
      {
        id: "tutors",
        title: "Tutors",
        badge: "Peer mentors",
        body: "Fellow students admitted through application, panel interview, and training who lead sessions, share study methods, log attendance, and earn service hours.",
      },
      {
        id: "crew",
        title: "Crew",
        badge: "Campus support",
        body: "Student teammates who patrol tutoring classrooms during after-school sessions to confirm room activity and help keep attendance records trustworthy.",
      },
      {
        id: "management",
        title: "Management Team",
        badge: "Head · Admins · Coordinators",
        body: "Student leaders—combining the Program Head, Administrators, and Coordinators—who oversee recruitment, subject catalogs, matching, scheduling, reviews, and program continuity.",
      },
      {
        id: "viewers",
        title: "Viewers",
        badge: "Read-only spectators",
        body: "Spectators such as college admissions officers, parents, teachers, and external observers who may follow read-only program summaries. Viewers do not and will not have a say in program operations.",
      },
    ],
    headContactLabel: "Current Program Head contact",
    headContactFallback:
      "Reach the student Management Team through your usual SHBS contact channel or signed-in Messages.",
    viewerCta: "Follow the Program as a Viewer",
  },
  audiences: {
    id: "community",
    title: "A closer look for every visitor",
    intro:
      "Whether you are already on campus, considering joining SHBS, or reviewing our student community from outside, here is what the program reflects.",
    cards: [
      {
        audience: "SHBS students",
        title: "Thinking about joining?",
        body: "Asking for help is normal here. Join as a tutee to stay ahead in a demanding course, apply as a tutor to sharpen what you know, or join Crew to support sessions across campus.",
      },
      {
        audience: "Prospective & transfer students",
        title: "Exploring life at SHBS?",
        body: "Peer Tutoring shows how SHBS students actually treat one another: collaborative, self-motivated, and willing to invest after-school time to help classmates succeed.",
      },
      {
        audience: "College admissions officers",
        title: "Evaluating student initiative?",
        body: "From custom scheduling and attendance software to peer interviews, policy governance, and Crew verification, the entire operation is built and run by students without faculty intervention.",
      },
    ],
  },
  getInvolved: {
    id: "get-involved",
    title: "Get involved",
    body: "Ready to request a tutor, apply to teach, help run campus patrols, or learn how the portal works?",
    requestTutor: "Request a Tutor",
    becomeTutor: "Become a Tutor",
    joinCrew: "Join the Crew",
    followProgram: "Follow the Program",
    helpCenter: "Help Center",
    privacyPolicy: "Privacy policy",
  },
  customPreviewNote:
    "You are previewing the editor-authored alternative About page. Visitors currently see the built-in About page until you switch the alternative on and publish it.",
};

const zh: AboutContent = {
  lang: "zh",
  navTitle: "关于项目",
  headerTitle: "项目信息",
  title: "关于宏润博源同伴辅导",
  eyebrow: "100% 学生自主运营 · 始于 2024",
  // Spell out the full school name once here; use 宏润博源 everywhere else in Chinese.
  introduction:
    "宏润博源同伴辅导创立于 2024 年，是上海青浦区宏润博源高级中学完全由学生自主运营的校园互助组织。在这里，辅导伙伴与学习伙伴平等交流，在攻克学业难题的同时建立真诚而长久的校园联结。",
  contentsLabel: "本页目录",
  stats: {
    heading: "项目累计数据",
    sessionsLabel: "累计辅导场次",
    sessionsCaption: "截至目前已记录并完成的同伴辅导场次。",
    minutesLabel: "累计辅导分钟数",
    minutesCaption: "截至目前已记录的校园同伴辅导总时长（分钟）。",
  },
  story: {
    id: "story",
    title: "我们的初心与理念",
    paragraphs: [
      "宏润博源同伴辅导始于 2024 年一个朴素的想法：刚刚走过一门挑战性课程的同学，往往最了解学习中的卡点，也最容易与学弟学妹产生共鸣。",
      "我们不追求传统课堂式的上下级关系，而是强调同学之间的平等互助。辅导伙伴与学习伙伴并肩探讨问题、分享学习方法，也在每周的相处中建立跨越年级的信任与友谊。",
    ],
    pillars: [
      {
        title: "100% 学生自主运营",
        body: "从招募面试、科目配对到日程协调、制度制定与日常运营，全部由学生独立负责，不受学校教职人员干预。",
      },
      {
        title: "平等的同伴关系",
        body: "辅导伙伴与学习伙伴站在同一边。随时提问被鼓励，分享思路也让双方对知识有更深的理解。",
      },
      {
        title: "建立有价值的联结",
        body: "持续的课后同伴辅导不仅帮助解决具体科目问题，更在校园里搭建起跨年级交流与彼此支持的社区。",
      },
    ],
  },
  howItWorks: {
    id: "how-it-works",
    title: "课程体系、辅导形式与招募流程",
    curriculumTitle: "覆盖荣誉与 AP 课程体系",
    curriculumBody:
      "项目面向宏润博源的荣誉课程与 AP 大学先修课程体系，涵盖校内几乎所有开设科目；随着课程变化与同学需求增长，也可以随时加入新的辅导科目。",
    formatTitle: "日常辅导如何开展",
    facts: [
      {
        label: "辅导规模",
        value: "1 位辅导伙伴 · 1–4 位学习伙伴",
        detail: "以一对一或小型小组形式开展，保证充分互动与针对性。",
      },
      {
        label: "标准时长",
        value: "45 分钟",
        detail: "常规辅导每场 45 分钟，并由系统清晰记录出勤与时长。",
      },
      {
        label: "时间与地点",
        value: "放学后 · 校内教室",
        detail: "通常在放学后的校内教室面对面进行。",
      },
      {
        label: "灵活改期",
        value: "协商调整时间",
        detail: "当常规课表冲突时，辅导伙伴与学习伙伴可以协商改期。",
      },
    ],
    admissionTitle: "如何成为辅导伙伴",
    admissionIntro:
      "每位辅导伙伴都需通过透明、由学生主导的选拔流程，确保学科基础、沟通能力与责任心。",
    admissionSteps: [
      {
        step: "01",
        title: "自主报名",
        body: "在辅导伙伴招募期内提交申请，选择希望辅导的科目并说明相关学习经历。",
      },
      {
        step: "02",
        title: "小组面试与培训",
        body: "参加由学生团队主持的小组面试与培训，了解辅导方法、沟通礼仪与项目规范。",
      },
      {
        step: "03",
        title: "正式加入",
        body: "通过评估后正式成为辅导伙伴，获得对应科目辅导资格，开始与学习伙伴配对并积累服务时数。",
      },
    ],
  },
  team: {
    id: "team",
    title: "认识整个团队",
    independenceLead:
      "宏润博源同伴辅导 100% 由学生自主管理，独立于学校教职人员干预之外。不同角色分工明确，共同保障项目稳健、透明运转。",
    roles: [
      {
        id: "tutees",
        title: "学习伙伴",
        badge: "学习者",
        body: "选择自己需要支持的荣誉或 AP 科目，免费获得同学的耐心辅导，在交流中提升学习信心。",
      },
      {
        id: "tutors",
        title: "辅导伙伴",
        badge: "同伴导师",
        body: "通过报名、小组面试与培训加入的同学，负责准备并开展辅导、记录出勤，并获得对应服务时数。",
      },
      {
        id: "crew",
        title: "巡查队",
        badge: "校园支持",
        body: "在放学后辅导时段巡查教室的同伴成员，核实到场情况，帮助维护辅导秩序与出勤记录的公信力。",
      },
      {
        id: "management",
        title: "管理团队",
        badge: "负责人 · 管理员 · 协调员",
        body: "由项目负责人、管理员和协调员共同组成的学生管理团队，负责招募、科目管理、配对排课、审核与项目传承。",
      },
      {
        id: "viewers",
        title: "访客",
        badge: "只读观察者",
        body: "面向大学招生官、家长、教师及校外关注者的观察身份，可查看只读项目概览。访客不参与、也不会对项目日常运营发表决定权。",
      },
    ],
    headContactLabel: "现任项目负责人联系邮箱",
    headContactFallback:
      "如需联系学生管理团队，请通过日常学校联系渠道沟通，或登录账号后使用站内私信。",
    viewerCta: "以访客身份关注项目",
  },
  audiences: {
    id: "community",
    title: "致每一位来访者",
    intro:
      "无论你是正在校园就读的同学、考虑转入宏润博源的学生，还是希望进一步了解我们学生社区的大学招生官，这里都是观察宏润博源的真实窗口。",
    cards: [
      {
        audience: "宏润博源在校同学",
        title: "想要加入我们？",
        body: "在这里寻求帮助很自然。你可以成为学习伙伴攻克难点科目，申请成为辅导伙伴分享经验，或加入巡查队一起支持校园互助。",
      },
      {
        audience: "关注宏润博源的校外与转学同学",
        title: "想了解宏润博源的学习氛围？",
        body: "同伴辅导展现了宏润博源真实的校园文化：同学彼此支持、主动担当，愿意在放学后花时间一起把课程学扎实。",
      },
      {
        audience: "大学招生官与外部观察者",
        title: "想了解学生自主领导力？",
        body: "从排课出勤系统到同伴面试、制度治理与巡查核验，整个组织完全由学生搭建和运行，不受校方教职干预。",
      },
    ],
  },
  getInvolved: {
    id: "get-involved",
    title: "参与其中",
    body: "准备好申请同伴辅导、加入辅导伙伴或巡查队，或进一步了解平台使用方式了吗？",
    requestTutor: "申请同伴辅导",
    becomeTutor: "成为辅导伙伴",
    joinCrew: "加入巡查队",
    followProgram: "关注项目",
    helpCenter: "帮助中心",
    privacyPolicy: "隐私政策",
  },
  customPreviewNote:
    "你正在预览通过内置编辑器创建的自定义关于页面。启用并发布该页面前，访客看到的仍是内置关于页面。",
};

/** Resolve localized About page copy (Chinese for `zh`, English fallback for all other locales). */
export function getAboutContent(locale: string): AboutContent {
  return locale === "zh" ? zh : en;
}

/** Starter bilingual blocks used when an editor first enables a custom alternative About page. */
export function buildStarterAboutBlocks(): Block[] {
  return [
    {
      id: "about-intro",
      type: "RICH_TEXT",
      align: "center",
      text: {
        en: "## About SHBS Peer Tutoring\n\nFounded in 2024 at Shanghai Hongrun Boyuan School (SHBS), SHBS Peer Tutoring is a 100% student-run mutual-help organization operating independently of school faculty intervention. Tutors and tutees meet as equals across our Honors and Advanced Placement (AP) curriculum—building understanding and genuine campus connections.",
        zh: "## 关于宏润博源同伴辅导\n\n宏润博源同伴辅导创立于 2024 年，是上海青浦区宏润博源高级中学 100% 由学生自主运营、独立于教职人员干预之外的校园互助组织。辅导伙伴与学习伙伴在荣誉与 AP 课程体系中平等交流、共同成长。",
      },
    },
    {
      id: "about-cols",
      type: "COLUMNS",
      card: true,
      columns: [
        [
          {
            id: "about-c1",
            type: "RICH_TEXT",
            text: {
              en: "**How sessions work**\n\nStandard 45-minute sessions pair 1 tutor with 1–4 tutees in classrooms after school, with flexible rescheduling when timetables do not line up.",
              zh: "**辅导形式**\n\n常规辅导每场 45 分钟，由 1 位辅导伙伴与 1–4 位学习伙伴在放学后的教室开展，课表冲突时可协商改期。",
            },
          },
        ],
        [
          {
            id: "about-c2",
            type: "RICH_TEXT",
            text: {
              en: "**The whole student team**\n\nTutees, interviewed and trained tutors, campus Crew, and the student Management Team run the program together, while Viewers may follow read-only summaries without operational say.",
              zh: "**完整的团队**\n\n学习伙伴、经面试与培训加入的辅导伙伴、巡查队与学生管理团队共同运转项目；访客仅作只读观察，不参与项目运营决策。",
            },
          },
        ],
      ],
    },
    {
      id: "about-cta",
      type: "BUTTONS",
      align: "center",
      buttons: [
        {
          label: { en: "Request a Tutor", zh: "申请同伴辅导" },
          href: "/tutee",
          style: "primary",
        },
        {
          label: { en: "Become a Tutor", zh: "成为辅导伙伴" },
          href: "/tutor",
          style: "secondary",
        },
      ],
    },
  ];
}
