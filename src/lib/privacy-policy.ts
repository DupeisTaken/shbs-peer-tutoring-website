/** Repository-owned public notice, separate from versioned participation agreements.
 * Keep both translations in sync with data handling; unknown locales use English. */
type PrivacyPolicy = {
  lang: "en" | "zh";
  title: string;
  introduction: string;
  updatedLabel: string;
  contentsLabel: string;
  contactTitle: string;
  contactBody: string;
  contactFallback: string;
  sections: { id: string; title: string; paragraphs: string[] }[];
};

export const PRIVACY_POLICY_UPDATED = "2026-09-23";

const en: PrivacyPolicy = {
  lang: "en",
  title: "Privacy policy",
  introduction:
    "This policy explains how the peer-tutoring website handles information when you browse, create an account or take part in the program.",
  updatedLabel: "Last updated",
  contentsLabel: "On this page",
  contactTitle: "Questions about your information?",
  contactBody:
    "Contact program management to ask about your information, request access, correction or deletion, or raise a privacy concern. The team may need to verify your identity and review which records must be retained. Do not send passwords or verification codes.",
  contactFallback:
    "If you do not have an account, contact the school's peer-tutoring program team through your usual school contact. If you are signed in, you can also use private messages to contact management.",
  sections: [
    {
      id: "information",
      title: "Information we collect",
      paragraphs: [
        "Account and contact information includes your name, alternative names, username, email addresses, password hash, verification status and account preferences. Depending on the form and your role, you may also provide your grade, phone number, preferred contact method or school affiliation.",
        "Program records include signup and application answers, subject choices and qualifications, availability, assignments, attendance, service hours, interview notes and votes, patrol observations, feedback, disciplinary records, appeals and membership requests. Policy acceptance records include the accepted text, version, signature and time. Signup information can be stored before you verify your email or finish creating an account.",
        "We store messages, recipients, read status, notifications and delivery records, as well as management decisions and audit history. Security processing uses verification and recovery records and request information, such as an IP address, to limit abuse. The hosting service may also keep technical request and error logs.",
      ],
    },
    {
      id: "purposes",
      title: "How information is used",
      paragraphs: [
        "Information supports account access and recovery, matching learning partners with tutors, scheduling, attendance and service-hour records, recruitment, program communication, feedback, appeals and management review. Security and audit records help prevent misuse and investigate problems.",
        "You can manage available profile, email and notification settings in your account. Optional email notices depend on your preferences and program settings; account security notices are sent independently of optional notification preferences.",
      ],
    },
    {
      id: "access",
      title: "Who can access information",
      paragraphs: [
        "Access depends on role, participation and assignment. Participants can access their own records and the information made available for their tutoring or crew duties. Authorized program staff can access records needed for management and review. Viewer accounts receive permitted read-only information with personal contact details masked; masking contact details does not make every program record anonymous.",
        "Private messages are available to their sender and recipient. Messages marked for supervision can also be reviewed by authorized administrators and the program head; a review records the reviewer and reason. Private messaging is not end-to-end encrypted.",
        "The configured hosting, database and email services process information needed to run the website and deliver messages. Website operators with infrastructure access may also access stored data and backups. Ask program management for the providers and storage locations used by your school.",
      ],
    },
    {
      id: "browser-storage",
      title: "Cookies and browser storage",
      paragraphs: [
        "The site uses cookies for sign-in, security and session recovery. NEXT_LOCALE remembers your language and THEME remembers your color preference. Browser local storage remembers interface choices such as collapsed navigation, dismissed notices and management filters.",
        "You can clear cookies and local storage in your browser. This may sign you out or reset preferences; it does not delete records held by the program. Public pages may include externally hosted images or links chosen by program editors. Loading those images or following those links can send request information to the external service, whose own privacy policy applies.",
      ],
    },
    {
      id: "retention",
      title: "Storage and retention",
      paragraphs: [
        "Program information is stored in the website's database, with uploaded files, operational logs and any operator-managed backups stored separately as configured. Access controls and password hashing help protect accounts; infrastructure security and backups are managed by the operator.",
        "Leaving the program, recalling a request or removing access does not automatically erase historical records. Attendance, decisions, appeals, messages, audit history and exact policy acceptance records may remain to support program administration and resolve disputes. Retention periods and backup deletion depend on the school's operating arrangements; contact management for the applicable schedule or a deletion request.",
      ],
    },
    {
      id: "students",
      title: "Students and personal information",
      paragraphs: [
        "This website supports a school program, including students who may be minors. Provide only information needed for the program and avoid including unnecessary sensitive information about yourself or others in free-text answers or messages. Students and parents or guardians can contact program management about privacy questions or requests.",
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      paragraphs: [
        "Updates are published on this page with a revised date. This privacy policy explains information handling; tutor and tutee participation agreements are separate documents. Reading this page does not accept those agreements or change your participation.",
      ],
    },
  ],
};

const zh: PrivacyPolicy = {
  lang: "zh",
  title: "隐私政策",
  introduction:
    "本政策说明你在浏览同伴辅导网站、创建账号或参与项目时，网站如何处理相关信息。",
  updatedLabel: "最近更新",
  contentsLabel: "本页目录",
  contactTitle: "对你的信息有疑问？",
  contactBody:
    "你可以联系项目管理团队，了解个人信息的处理情况、申请查阅、更正或删除信息，或提出隐私问题。团队可能需要核实你的身份，并确认哪些记录需要保留。请勿发送密码或验证码。",
  contactFallback:
    "如果你没有账号，请通过日常学校联系渠道联系同伴辅导项目团队。已登录的用户也可以通过站内私信联系管理人员。",
  sections: [
    {
      id: "information",
      title: "我们收集的信息",
      paragraphs: [
        "账号与联系信息包括姓名、其他姓名、用户名、电子邮箱、密码哈希值、验证状态和账号偏好设置。根据表单和参与角色，你还可能提供年级、电话号码、偏好的联系方式或与学校的关系。",
        "项目记录包括报名与申请内容、科目选择与资格、可用时间、辅导安排、出勤、服务时数、面试记录与投票、巡查记录、反馈、纪律记录、申诉和成员资格申请。政策同意记录包括当时同意的正文、版本、签名和时间。报名信息可能在你验证邮箱或完成账号创建前就已保存。",
        "我们保存消息内容、收件人、已读状态、通知与发送记录，以及管理决定和操作审计记录。安全处理会使用验证与账号恢复记录，以及 IP 地址等请求信息，以限制滥用。托管服务也可能保留技术请求与错误日志。",
      ],
    },
    {
      id: "purposes",
      title: "信息的用途",
      paragraphs: [
        "这些信息用于账号访问与恢复、学习伙伴和辅导伙伴匹配、时间安排、出勤与服务时数记录、招募、项目沟通、反馈、申诉和管理审核。安全与审计记录帮助防止滥用并调查问题。",
        "你可以在账号中修改可用的个人资料、邮箱与通知设置。可选邮件通知取决于你的偏好和项目设置；账号安全通知不受可选通知偏好限制。",
      ],
    },
    {
      id: "access",
      title: "谁可以访问信息",
      paragraphs: [
        "访问范围取决于角色、参与情况与任务安排。参与者可以访问自己的记录，以及履行辅导或巡查职责所需的信息。获授权的项目人员可以访问管理与审核所需的记录。观察员账号可以查看允许范围内的只读信息，其中个人联系方式会被遮蔽；遮蔽联系方式并不代表所有项目记录都已匿名化。",
        "私信的发送者和接收者可以查看消息。标记为可监督的消息也可由获授权的管理员和项目负责人审核；审核会记录审核人和原因。站内私信不采用端到端加密。",
        "网站配置的托管、数据库和邮件服务会处理运行网站与发送消息所需的信息。拥有基础设施访问权限的网站运营人员也可能访问存储的数据与备份。如需了解学校使用的服务商和存储地点，请联系项目管理团队。",
      ],
    },
    {
      id: "browser-storage",
      title: "Cookie 与浏览器存储",
      paragraphs: [
        "网站使用 Cookie 支持登录、安全功能和会话恢复。NEXT_LOCALE 保存语言选择，THEME 保存配色偏好。浏览器本地存储会保存导航折叠状态、已关闭的提示和管理筛选条件等界面选择。",
        "你可以通过浏览器清除 Cookie 和本地存储。这可能导致退出登录或重置偏好，但不会删除项目保存的记录。公共页面可能包含项目编辑人员选用的外部图片或链接。加载这些图片或打开链接时，请求信息可能发送给外部服务，并受其自身隐私政策约束。",
      ],
    },
    {
      id: "retention",
      title: "存储与保留",
      paragraphs: [
        "项目信息保存在网站数据库中；上传的文件、运行日志及运营人员管理的备份会按实际配置另行存储。访问控制和密码哈希有助于保护账号；基础设施安全与备份由运营人员管理。",
        "退出项目、撤回申请或移除访问权限不会自动清除历史记录。出勤、决定、申诉、消息、审计记录及完整的政策同意记录可能继续保留，以支持项目管理和争议处理。保留期限与备份删除安排取决于学校的运营安排；如需了解适用期限或申请删除，请联系管理团队。",
      ],
    },
    {
      id: "students",
      title: "学生与个人信息",
      paragraphs: [
        "本网站用于学校项目，参与者可能包括未成年学生。请只提供项目所需的信息，避免在自由填写的答案或消息中加入自己或他人不必要的敏感信息。学生、家长或监护人可以就隐私问题或相关申请联系项目管理团队。",
      ],
    },
    {
      id: "changes",
      title: "政策更新",
      paragraphs: [
        "本政策的更新内容会在此页面发布，并注明修订日期。本隐私政策说明信息处理方式；辅导伙伴与学习伙伴的参与协议是独立文件。阅读本页不会构成对参与协议的同意，也不会改变你的参与状态。",
      ],
    },
  ],
};

export function getPrivacyPolicy(locale: string): PrivacyPolicy {
  return locale === "zh" ? zh : en;
}
