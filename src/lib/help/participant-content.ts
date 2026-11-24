import { helpText as t, type HelpArticle } from "./types";

/** Task instructions stay beside their action inventory so source changes can be reviewed against coverage. */
export const participantArticles: HelpArticle[] = [
  {
    slug: "use-help-catalogue",
    audience: "public",
    title: t("Use the Help Center", "使用帮助中心"),
    summary: t(
      "Find a task, follow its real screens, download offline PDF handbooks and check what happens next.",
      "查找任务、跟随真实界面、下载离线PDF手册并检查接下来应出现的结果。",
    ),
    route: "/help",
    prerequisites: [
      t(
        "Public getting-started guides and their PDF handbook are available from the top-bar Help Center button without signing in; sign in to see collections for your current access.",
        "无需登录即可通过顶部“帮助中心”按钮阅读公开入门指南并下载对应PDF手册；登录后可查看当前权限对应的指南集。",
      ),
    ],
    steps: [
      {
        title: t("Search or filter the catalogue", "搜索或筛选目录"),
        body: t(
          "Open Help Center from the top bar on any page or from the landing-page footer. Search a task or symptom such as password, attendance or approval; search includes instructions and troubleshooting. Use Guide audience and Browse by task to narrow results, and Clear filters to reset search and both filters.",
          "在任意页面顶部栏或首页页脚打开“帮助中心”。搜索任务或症状，例如密码、出勤或审核；搜索范围包括步骤及故障排查。使用指南适用对象及按任务浏览缩小结果，再用清除筛选重置搜索和两类筛选。",
        ),
        screenshot: "help-catalogue",
      },
      {
        title: t("Follow the task guide", "按任务指南操作"),
        body: t(
          "Choose Read guide, check Before you start, then follow numbered steps and Look for directions beside the screens. Use On this page to jump to What happens next, How it works or If something goes wrong. Open this page opens the actual feature; reading instructions grants no access.",
          "选择阅读指南，先检查开始之前，再按编号步骤及截图旁的请找到提示操作。可用本页目录跳转至接下来会发生什么、运作原理或遇到问题时。打开相关页面会进入实际功能；阅读说明不会授予权限。",
        ),
        screenshot: "help-article",
      },
      {
        title: t("Enlarge and identify a screenshot", "放大并识别截图"),
        body: t(
          "Select the screenshot to enlarge it. Open Capture details for the original image, route, date and source revision. About these screenshots identifies the development baseline and server. Screens use synthetic demonstration accounts.",
          "选择截图将其放大。展开截图详情可查看原图、路径、日期及源代码版本。关于这些截图列明开发版本基线及服务器。截图使用虚构演示账号。",
        ),
      },
      {
        title: t(
          "Download an offline PDF handbook",
          "下载离线 PDF 手册",
        ),
        body: t(
          "Sign in to reveal current account, participation and assigned-role guides. Select PDF handbooks in Help Center to download English or Chinese handbooks for every collection available to you, stamped with the download date and time. Staff can also open Administration → PDF handbooks to distribute training editions. Old FAQ links continue to this catalogue.",
          "登录后显示当前账号、参与资格及分工对应指南。在帮助中心选择PDF操作手册，可下载本人可用指南集的中英文PDF，并附带下载日期与时间。工作人员也可在系统管理→PDF操作手册分发培训版本。旧常见问题链接会继续进入本目录。",
        ),
      },
    ],
    expected: t(
      "You find an available task guide, understand its expected result and can inspect the screenshot's origin.",
      "找到可用任务指南、了解预期结果，并能检查截图来源。",
    ),
    explanation: [
      t(
        "Audience and task filters only narrow guides already authorized by the server. Tutor, Tutee, Crew and Translator access are independent of management rank. Screenshot provenance records an illustrative release state; it does not prove every school configuration looks identical.",
        "适用对象与任务筛选仅缩小服务器已授权指南范围。辅导伙伴、学习伙伴、巡查及翻译权限独立于管理职级。截图来源记录所示发布状态，不代表每所学校配置下界面完全一致。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "No guide matches or your role collection is missing",
          "没有匹配指南或缺少本人职责指南集",
        ),
        solution: t(
          "Try a shorter phrase and Clear filters. Sign in with the intended account. If the collection still does not appear, ask management to check current membership/assignment and permissions; a filter or old bookmark cannot grant access.",
          "尝试更短关键词并清除筛选，使用正确账号登录。仍未显示时，请管理团队检查当前资格、分工及权限；筛选或旧书签不能授予访问权。",
        ),
      },
      {
        problem: t(
          "The image language or controls differ",
          "截图语言或控件不同",
        ),
        solution: t(
          "Check Capture details and use the named controls in your interface. If the guide shows an English screen, the callouts still follow the guide language. Report a persistent mismatch with the guide title and capture date.",
          "查看截图详情，并按本人界面的控件名称操作。如果指南显示英文界面，标注仍使用指南语言。若持续存在差异，请报告指南标题及截图日期。",
        ),
      },
    ],
    related: ["choose-registration", "navigate-workspaces", "report-problem"],
    sources: [
      "src/app/help/catalogue.tsx",
      "src/app/help/[slug]/page.tsx",
      "src/lib/help/screenshots.ts",
      "src/app/(admin)/admin/help/page.tsx",
    ],
    covers: [
      "help catalogue search",
      "audience filter",
      "task filter",
      "clear help filters",
      "role-aware guides",
      "numbered walkthrough",
      "full screenshot zoom",
      "screenshot provenance",
      "admin PDF handbooks",
      "FAQ redirect",
      "GitHub catalogue copy",
    ],
  },
  {
    slug: "choose-registration",
    audience: "public",
    title: t("Choose the right registration path", "选择正确的注册入口"),
    summary: t(
      "Start with tutoring, tutoring others, Crew, Viewer, or an invitation.",
      "根据申请辅导、成为辅导伙伴、巡查、观察员或邀请选择入口。",
    ),
    route: "/signin",
    prerequisites: [
      t(
        "Use the website address supplied by your program. Read Privacy policy from the homepage information menu/footer or /privacy before providing personal information; English and Chinese are available.",
        "使用项目团队提供的网站地址。提供个人信息前，请通过首页信息菜单、页脚或/privacy阅读隐私政策，提供英语及中文版本。",
      ),
    ],
    steps: [
      {
        title: t("Choose what you need", "选择所需服务"),
        body: t(
          "From Home, choose Request a Tutor to receive tutoring, Become a Tutor to apply to teach, or Join the crew for room patrol. Use Register as a Viewer for read-only observation when available.",
          "在首页选择“申请辅导”接受辅导、“成为辅导伙伴”申请授课，或“加入巡查团队”申请巡查。只需查看信息时，可在开放期间选择“注册为观察员”。",
        ),
        screenshot: "signin",
      },
      {
        title: t(
          "Use an invitation when you have one",
          "已有邀请时使用邀请入口",
        ),
        body: t(
          "Choose Register with an Invitation Code. Existing accounts can use Add access from their account menu instead of creating another account.",
          "选择“使用邀请码注册”。已有账号可从账号菜单选择“添加权限”，无需再创建账号。",
        ),
      },
      {
        title: t("Check the opening notice", "查看开放提示"),
        body: t(
          "A tutor or tutee form outside recruitment is a read-only preview. Check its opening time in the displayed program timezone and return when intake opens.",
          "辅导伙伴或学习伙伴招募未开放时，表单仅供预览。查看项目时区下的开放时间，并在开放后返回。",
        ),
      },
    ],
    expected: t(
      "You are on the application or invitation page for your intended access.",
      "进入与所需权限对应的申请或邀请页面。",
    ),
    explanation: [
      t(
        "An application, an approved roster entry, email verification and a ready login are different stages. Participation and management authority are separate.",
        "提交申请、名册获批、邮箱验证和可用登录账号属于不同阶段。参与资格与管理权限也相互独立。",
      ),
      t(
        "Tutor and tutee opening times can differ. A configured opening may still need activation and review. Return when the form is open to submit it.",
        "辅导伙伴和学习伙伴的开放时间可以不同。已配置的开放时间可能仍需启用和审核。表单开放后再返回提交。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Viewer signup or another entry is missing",
          "找不到观察员注册或其他入口",
        ),
        solution: t(
          "The program may have disabled that path. Ask management which application or authorized invitation to use; do not register a second account to bypass access rules.",
          "项目可能关闭了该入口。请向管理团队确认应使用哪种申请或授权邀请，不要通过创建第二个账号绕过权限。",
        ),
      },
    ],
    related: [
      "request-tutoring",
      "apply-tutor",
      "apply-crew",
      "register-viewer",
      "accept-invitation",
    ],
    sources: [
      "src/app/signin/page.tsx",
      "src/app/register/page.tsx",
      "src/app/signup/signup-opening-notice.tsx",
      "src/app/signup/signup-transition-notice.tsx",
      "src/lib/public-signup-transition.ts",
      "src/server/program/public-signup-transition.ts",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "choose signup route",
      "preview closed recruitment",
      "add access entry",
      "read privacy policy",
    ],
  },
  {
    slug: "request-tutoring",
    audience: "public",
    title: t(
      "Request a tutor and finish account review",
      "申请辅导并完成账号确认",
    ),
    summary: t(
      "Submit your choices, verify the exact request and continue to your tutee workspace.",
      "提交科目和时间，验证本次申请，然后进入学习伙伴页面。",
    ),
    route: "/tutee-signup",
    prerequisites: [
      t(
        "Tutee recruitment is open and a current participation policy is published.",
        "学习伙伴招募已开放，且已发布当前参与政策。",
      ),
      t(
        "Use an email you can access, preferably an address already verified on your existing account.",
        "使用可以收信的邮箱；已有账号时，优先使用该账号已验证的邮箱。",
      ),
    ],
    steps: [
      {
        title: t("Complete the request", "填写申请"),
        body: t(
          "Choose Request a Tutor. Enter the required names, contact preference, subject choices and available catalogue times. Read the policy, scroll to its end, agree and sign before Save and verify email.",
          "选择“申请辅导”，填写必填姓名、联系方式偏好、科目和可用时间。阅读政策并滚动到底部，勾选同意并签名，然后选择“保存并验证邮箱”。",
        ),
        screenshot: "signup",
        focus: t(
          "Required fields, subject choices and policy agreement",
          "必填项、科目选择和政策同意区",
        ),
      },
      {
        title: t("Verify this submission", "验证本次提交"),
        body: t(
          "Enter the four-digit emailed verification code, keeping leading zeros. An existing emailed confirmation link can also be opened and explicitly confirmed. Use the code step's resend if mail is missing.",
          "输入邮件中的四位验证码，并保留开头的零。已有确认邮件链接也可打开后明确确认。未收到邮件时使用验证码步骤中的重发操作。",
        ),
      },
      {
        title: t("Finish the shared account review", "完成统一账号确认"),
        body: t(
          "In the invitation popup choose Finish account review. Review this submission's answers and signed policy; create only missing credentials. Existing accounts complete normal sign-in and any two-factor check, then explicitly accept the request.",
          "在邀请弹窗中选择“完成账号确认”。核对本次答案和已签政策，仅补充缺少的登录资料。已有账号需完成正常登录和双重验证，再明确接受本次申请。",
        ),
        screenshot: "invitation",
        focus: t("Continue to account review", "继续账号确认"),
      },
      {
        title: t("Check the confirmed request", "查看确认后的申请"),
        body: t(
          "Open Enter Tutee Page → Requests. Check request confirmation separately from tutor assignment and schedule status. You may close and reopen the invitation receipt without repeating mailbox verification while it remains valid.",
          "打开“进入学习伙伴页面”→“申请”。分别查看申请确认、辅导伙伴分配和排课状态。在邀请仍有效时，可以关闭并重新打开邀请回执，无需重复邮箱验证。",
        ),
      },
    ],
    expected: t(
      "Requests shows your confirmed request, with assignment and scheduling states shown separately.",
      "“申请”显示已确认的申请，分配和排课状态单独呈现。",
    ),
    explanation: [
      t(
        "The first eligible saved submission establishes queue priority; mailbox verification alone does not complete signup. A proven replacement of an existing open request preserves its original priority, assignments, attendance and original agreement while recording the new submission's consent.",
        "首次符合条件的保存确定排队优先时间；仅验证邮箱并不代表报名完成。经验证后替换现有未结申请，会保留原优先时间、分配、出勤和原协议，同时记录新提交的同意证据。",
      ),
      t(
        "A first assignment starts a fixed seven-day verification deadline. Resends, reassignment and replacement submissions do not extend it.",
        "首次分配启动固定七天验证期限。重发、重新分配或替换提交均不会延长该期限。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Mail or saving failed", "邮件发送或保存失败"),
        solution: t(
          "Keep the form open. Retry the unchanged submission or use its resend/recovery action; do not submit another application just because mail is delayed. After a saved result with failed refresh, retry the read.",
          "保持页面打开。重试未修改的提交，或使用重发、恢复操作；不要因为邮件延迟就另交申请。已保存但刷新失败时，应重试读取。",
        ),
      },
      {
        problem: t(
          "The invitation or staged submission expired",
          "邀请或待确认提交已过期",
        ),
        solution: t(
          "Return to the originating request's recovery instructions or contact management, especially if the email was wrong. A resend cannot extend an expired fixed assignment deadline.",
          "返回原申请的恢复说明，或联系管理团队，尤其是邮箱填错时。重发不能延长已到期的固定分配验证期限。",
        ),
      },
    ],
    related: ["accept-invitation", "manage-tutee-request", "sign-in-recover"],
    sources: [
      "src/app/signup/signup-form.tsx",
      "src/app/signup/survey-verification.tsx",
      "src/app/register/register-flow.tsx",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "public tutee request",
      "policy signature",
      "request email verification",
      "resend request code",
      "same-email replacement",
      "queue priority",
      "account completion",
    ],
  },
  {
    slug: "apply-tutor",
    audience: "public",
    title: t("Apply to become a tutor", "申请成为辅导伙伴"),
    summary: t(
      "Submit qualifications and follow the interview and invitation process.",
      "提交资质说明，并完成面试及邀请流程。",
    ),
    route: "/tutor-signup",
    prerequisites: [
      t(
        "Tutor recruitment is open and the tutor policy is available.",
        "辅导伙伴招募已开放，且辅导伙伴政策可读。",
      ),
    ],
    steps: [
      {
        title: t("Enter your application", "填写申请"),
        body: t(
          "Choose Become a Tutor. Fill required identity and contact fields, select up to three offered subjects and explain the requested qualifications, grades, AP scores or self-study experience when applicable.",
          "选择“成为辅导伙伴”，填写必填身份和联系信息，选择最多三个开放科目，并按要求说明资质、成绩、AP分数或自学经历。",
        ),
        screenshot: "tutor-signup",
        focus: t("Subject qualification questions", "科目资质问题"),
      },
      {
        title: t("Read and submit", "阅读并提交"),
        body: t(
          "Read the displayed tutor policy and complete its agreement. Check the saved application receipt; wait for the team to arrange screening or an interview.",
          "阅读页面上的辅导伙伴政策并完成同意。查看申请保存回执，然后等待团队安排审核或面试。",
        ),
      },
      {
        title: t("Follow your accepted invitation", "使用获批后的邀请"),
        body: t(
          "After acceptance, use the supplied Tutor code or setup invitation, verify your email and finish shared account review. Then open the tutor workspace and check activation and current policy requirements.",
          "获批后，使用提供的辅导伙伴邀请码或设置邀请，验证邮箱并完成统一账号确认。随后进入辅导伙伴页面，检查激活状态及当前政策要求。",
        ),
      },
    ],
    expected: t(
      "A submission is recorded for review; only the later approved invitation/account workflow grants tutor access.",
      "申请进入审核；之后获批的邀请和账号流程才会授予辅导权限。",
    ),
    explanation: [
      t(
        "Submitting again while the same email's application is under review preserves the original answers and does not notify the team again. Interview completion, admission and awarded interview hours are distinct evidence.",
        "同一邮箱的申请仍在审核时重复提交，会保留原答案，也不会再次通知团队。面试完成、录取决定和面试时数分别记录。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Questions or policy do not load", "问题或政策无法加载"),
        solution: t(
          "Use Retry. The program needs configured subjects and a published policy; contact management if the form remains unavailable.",
          "使用“重试”。项目需先配置科目并发布政策；表单持续不可用时请联系管理团队。",
        ),
      },
      {
        problem: t(
          "You need to correct a submitted answer",
          "需要更正已提交答案",
        ),
        solution: t(
          "Contact the team rather than repeatedly applying. Staff can review eligible initial name corrections without rewriting your signed policy or other application evidence.",
          "请联系团队，不要反复提交。工作人员可审核符合条件的初次姓名更正，同时保留签署政策及其他申请证据。",
        ),
      },
    ],
    related: ["accept-invitation", "start-tutoring"],
    sources: [
      "src/app/tutor-signup/tutor-signup-form.tsx",
      "src/server/api/routers/application.ts",
    ],
    covers: [
      "tutor application",
      "qualification answers",
      "closed tutor intake",
      "duplicate tutor submission",
      "accepted tutor invitation",
    ],
  },
  {
    slug: "apply-crew",
    audience: "public",
    title: t(
      "Apply to Crew and check your application",
      "申请巡查团队并查询状态",
    ),
    summary: t(
      "Verify your mailbox, wait for staff approval and retrieve an approved invitation.",
      "验证邮箱、等待工作人员批准，并领取获批邀请。",
    ),
    route: "/crew-signup",
    prerequisites: [
      t(
        "Crew applications are available and you can access the submitted email.",
        "巡查申请已开放，且能使用所填邮箱。",
      ),
    ],
    steps: [
      {
        title: t("Apply and verify", "申请并验证"),
        body: t(
          "Complete Join the crew and enter the emailed verification code. This sends the application to staff; it does not create a login or Crew membership.",
          "填写“加入巡查团队”并输入邮件验证码。此操作仅将申请送交工作人员，不会创建登录账号或巡查资格。",
        ),
        screenshot: "crew-signup",
        focus: t("Application and check-status entry", "申请及状态查询入口"),
      },
      {
        title: t("Check an existing application", "查询现有申请"),
        body: t(
          "On the same page, enter its email in the status-check flow and verify a fresh mailbox code. Pending and rejected applications show their status without an invitation.",
          "在同一页面的状态查询流程中输入申请邮箱，并验证新的邮件验证码。待审核或已拒绝申请仅显示状态，不会提供邀请。",
        ),
      },
      {
        title: t("Accept approved access", "接受获批权限"),
        body: t(
          "An approved, usable invitation opens a popup. Copy the code, optionally Email code, or continue through the prefilled account review link. Existing accounts add approved Crew access while retaining credentials and other eligible access.",
          "获批且可用的邀请会打开弹窗。可复制邀请码、选择发送至邮箱，或通过预填链接继续账号确认。已有账号会添加获批巡查权限，并保留登录资料及其他符合条件的权限。",
        ),
      },
    ],
    expected: t(
      "Your status is visible, or approved Crew access is explicitly accepted through account review.",
      "可查看申请状态，或通过账号确认明确接受获批巡查权限。",
    ),
    explanation: [
      t(
        "Repeating an under-review Crew application keeps its original answers. Checking status or verifying email never substitutes for staff approval.",
        "重复提交审核中的巡查申请会保留原答案。查询状态或验证邮箱不能代替工作人员批准。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Approval has no usable invitation", "已获批但邀请不可用"),
        solution: t(
          "Follow the displayed expiry, revocation or already-used guidance and contact the team. Resending or changing the email requires a new verification code.",
          "根据页面上的过期、撤销或已使用提示操作，并联系团队。重发或修改邮箱后需要新的验证码。",
        ),
      },
    ],
    related: ["accept-invitation", "record-patrol", "crew-membership"],
    sources: [
      "src/app/crew-signup/crew-signup-form.tsx",
      "src/server/api/routers/crew.ts",
    ],
    covers: [
      "crew application",
      "crew mailbox verification",
      "crew application status",
      "crew invitation retrieval",
    ],
  },
  {
    slug: "register-viewer",
    audience: "public",
    title: t("Register for read-only Viewer access", "注册只读观察员权限"),
    summary: t(
      "Verify your email and review the access offered to your account.",
      "验证邮箱并确认账号所获权限。",
    ),
    route: "/viewer-signup",
    prerequisites: [
      t(
        "Public Viewer signup is enabled by the program.",
        "项目已启用公开观察员注册。",
      ),
    ],
    steps: [
      {
        title: t("Enter Viewer details", "填写观察员信息"),
        body: t(
          "Choose Register as a Viewer and supply the requested name, affiliation and email. Verify the initial emailed code.",
          "选择“注册为观察员”，填写所需姓名、所属机构和邮箱，然后验证邮件中的初始验证码。",
        ),
        screenshot: "viewer-signup",
        focus: t(
          "Viewer Registration name, affiliation and email fields",
          "观察员注册的姓名、所属机构及邮箱字段",
        ),
      },
      {
        title: t("Continue from the invitation", "通过邀请继续"),
        body: t(
          "Use the invitation popup's continuation link. A new account reviews the prefilled details and creates missing credentials. You can copy or optionally email its separate invitation code.",
          "使用邀请弹窗中的继续链接。新账号需核对预填信息并补充缺少的登录资料；也可复制或选择通过邮件发送单独的邀请码。",
        ),
      },
      {
        title: t("Read the permitted summaries", "查看允许访问的概览"),
        body: t(
          "Open the read-only management area. If the email already belongs to an account, this public flow signs into that existing account without adding Viewer or changing its access.",
          "进入只读管理区。如果邮箱已属于某个账号，此公开流程仅登录原账号，不会新增观察员身份或改变其权限。",
        ),
      },
    ],
    expected: t(
      "A new eligible account receives Viewer access; an existing account keeps its established access.",
      "符合条件的新账号获得观察员权限；已有账号保留原权限。",
    ),
    explanation: [
      t(
        "Viewer is exclusive of participant, translation and other badges. Read-only summaries show some names and program information but hide private contact, reasons, signatures and application evidence.",
        "观察员身份不能与参与资格、翻译或其他徽章共存。只读概览可能显示姓名及项目信息，但隐藏私人联系方式、原因、签名和申请证据。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The Viewer link is unavailable", "观察员链接不可用"),
        solution: t(
          "Ask management whether public signup is enabled. Use your existing sign-in or recovery if you already have an account.",
          "请向管理团队确认是否开放公开注册。已有账号时使用正常登录或密码恢复。",
        ),
      },
    ],
    related: ["accept-invitation", "observe-program"],
    sources: [
      "src/app/viewer-signup/viewer-signup-flow.tsx",
      "src/server/api/routers/viewer.ts",
    ],
    covers: [
      "viewer registration",
      "existing account viewer login",
      "viewer email verification",
    ],
  },
  {
    slug: "accept-invitation",
    audience: "public",
    title: t(
      "Use an invitation or add approved access",
      "使用邀请或添加获批权限",
    ),
    summary: t(
      "Keep invitation codes separate from mailbox codes and review the exact grant.",
      "区分邀请码与邮箱验证码，并核对具体授权。",
    ),
    route: "/register-account",
    prerequisites: [
      t(
        "Have a valid recipient invitation or staff key and access to the intended mailbox.",
        "持有有效收件人邀请或工作人员密钥，并能使用对应邮箱。",
      ),
    ],
    steps: [
      {
        title: t("Enter the whole invitation code", "输入完整邀请码"),
        body: t(
          "Open Register with an Invitation Code, or Add access when signed in. Enter the five-character letters-and-numbers code in the green invitation field and choose Continue. Older valid longer or numeric codes must be entered in full.",
          "打开“使用邀请码注册”，或登录后选择“添加权限”。在绿色邀请码框中输入五位字母数字组合，然后选择“继续”。仍有效的旧版长码或数字码必须完整输入。",
        ),
        screenshot: "invitation",
        focus: t(
          "Green invitation code field and Continue",
          "绿色邀请码输入框与继续按钮",
        ),
      },
      {
        title: t("Prove mailbox ownership", "证明邮箱所有权"),
        body: t(
          "When requested, enter the separate emailed verification code in the blue field. Back or Edit Identity corrects earlier details before verification but requires fresh proof. An email-bound staff key keeps that address read only.",
          "按提示在蓝色输入框中填写单独的邮件验证码。验证前可用“返回”或“编辑身份”更正资料，但随后需重新验证。绑定邮箱的工作人员密钥不允许修改该地址。",
        ),
      },
      {
        title: t("Review identity and access", "核对身份与权限"),
        body: t(
          "Read the invitation's displayed role or participation addition and prefilled application details. New accounts create missing credentials; existing accounts retain their password and complete any required sign-in or two-factor check. Confirm the authorized addition explicitly.",
          "阅读邀请显示的角色或参与资格，以及预填申请信息。新账号补充缺少的登录资料；已有账号保留密码，并完成必要的登录或双重验证。最后明确确认添加授权。",
        ),
      },
      {
        title: t("Read the completion receipt", "查看完成回执"),
        body: t(
          "Follow the next step to the correct workspace, academic confirmation or exact history claim. When the sign-in access card appears, Copy link or Save QR keeps the public /signin entry for later; it contains no account-verification proof. If account acceptance saved but sign-in failed, use its sign-in recovery instead of accepting again.",
          "根据下一步提示进入相应页面、确认学业信息或认领指定历史记录。出现登录入口卡时，可复制链接或保存二维码，保留公开/signin入口供以后使用；它不包含账号验证凭证。账号接受操作已保存但登录失败时，应使用登录恢复，避免再次接受。",
        ),
      },
    ],
    expected: t(
      "The receipt names the access actually accepted; opening a code alone grants nothing.",
      "回执说明实际接受的权限；仅打开邀请码不会授予权限。",
    ),
    explanation: [
      t(
        "New invitations last up to 15 minutes, subject to earlier authorization deadlines. A copied invitation in another browser needs recipient mailbox proof. Management invitations retain the higher rank, never grant Head, and participation invitations do not bypass suspension or reviewed school-return rules.",
        "新邀请最长有效十五分钟，且受更早授权期限约束。复制到另一浏览器的邀请码需要收件人邮箱验证。管理邀请保留更高的现有职级，不能授予负责人权限；参与邀请也不能绕过停用或返校审核。",
      ),
      t(
        "An authorized participation or management addition replaces exclusive Viewer access after review. Historical access requires its separate exact-record linking confirmation.",
        "经确认的参与或管理权限会替换独占的观察员身份。历史访问仍需单独确认关联指定记录。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Expired, replaced or used code",
          "邀请码已过期、被替换或已使用",
        ),
        solution: t(
          "Return to the original application's recovery/status action or ask the issuer for a usable invitation. Do not enter the mailbox code into the invitation field.",
          "返回原申请的恢复或状态查询操作，或请签发人提供可用邀请。不要把邮箱验证码填入邀请码框。",
        ),
      },
    ],
    related: ["sign-in-recover", "find-own-history", "account-academics"],
    sources: [
      "src/app/register/register-flow.tsx",
      "src/app/register/invitation-redemption.tsx",
      "src/app/register/invitation-receipt.tsx",
      "src/app/signup/signin-access.tsx",
    ],
    covers: [
      "invitation redemption",
      "staff keys",
      "add access",
      "new credentials",
      "existing account invitation",
      "legacy code formats",
      "invitation recovery",
      "copy public sign-in link",
      "save sign-in QR",
    ],
  },
  {
    slug: "sign-in-recover",
    audience: "public",
    title: t("Sign in or recover your password", "登录或找回密码"),
    summary: t(
      "Use your username or verified email, then complete any security check.",
      "使用用户名或已验证邮箱，并完成必要的安全验证。",
    ),
    route: "/signin",
    prerequisites: [
      t(
        "A login account has already been created; an application or roster row alone is not a login.",
        "已创建登录账号；仅有申请或名册记录并不代表已有登录。",
      ),
    ],
    steps: [
      {
        title: t("Enter your identifier and password", "输入登录标识和密码"),
        body: t(
          "On Sign In enter your username, primary email or verified secondary email and current password. Choose Sign In.",
          "在登录页输入用户名、主要邮箱或已验证备用邮箱，以及当前密码，然后选择“登录”。",
        ),
        screenshot: "signin",
      },
      {
        title: t(
          "Complete email two-factor when prompted",
          "按提示完成邮箱双重验证",
        ),
        body: t(
          "Enter the code sent to your primary email in the verification field. A secondary email used for sign-in does not change the two-factor destination.",
          "在验证码框中输入发送到主要邮箱的验证码。使用备用邮箱登录不会改变双重验证码的接收地址。",
        ),
      },
      {
        title: t("Use recovery when needed", "需要时使用恢复功能"),
        body: t(
          "Choose Forgot Password, request recovery with your username or a verified email, then follow the private link and set a new password. Username recovery goes to primary email; recovery with a secondary address goes to that address. Sign in again afterward.",
          "选择“忘记密码”，以用户名或已验证邮箱申请恢复，再通过私密链接设置新密码。用户名恢复发送到主要邮箱，以备用邮箱申请则发送到该地址。之后重新登录。",
        ),
        screenshot: "forgot-password",
      },
      {
        title: t(
          "Handle unfinished setup or suspension",
          "处理未完成设置或停用状态",
        ),
        body: t(
          "Use a supplied setup link if your account still needs email verification or password setup. Suspended users complete normal sign-in/security checks and use the suspension page to submit or review an account appeal.",
          "账号仍需验证邮箱或设置密码时，使用团队提供的设置链接。被停用账号需完成正常登录和安全检查，再在停用页面提交或查看账号申诉。",
        ),
      },
    ],
    expected: t(
      "You reach your authorized workspace or an explicit setup/suspension next step.",
      "进入获授权的页面，或看到明确的设置、停用后续步骤。",
    ),
    explanation: [
      t(
        "Changing or resetting a password signs out every existing session. Account recovery preserves permissions and tutoring history; it does not remove suspension or two-factor requirements.",
        "更改或重置密码会退出所有现有会话。账号恢复保留权限和辅导历史，但不会解除停用或双重验证要求。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The old mailbox is unavailable", "原邮箱无法使用"),
        solution: t(
          "Contact management for identity review. A setup page cannot change the displayed account mailbox, and an invitation does not replace an established password.",
          "请联系管理团队进行身份审核。设置页面不能修改显示的账号邮箱；邀请也不会替换已有密码。",
        ),
      },
      {
        problem: t("A code or link expired", "验证码或链接过期"),
        solution: t(
          "Restart the relevant sign-in or recovery flow and use the latest successfully sent message. Check spam and contact management if delivery remains unavailable.",
          "重新开始对应登录或恢复流程，使用最新成功发送的邮件。检查垃圾邮件；持续无法收信时联系管理团队。",
        ),
      },
    ],
    related: ["accept-invitation", "account-security"],
    sources: [
      "src/app/signin/sign-in-form.tsx",
      "src/app/forgot-password/forgot-password-form.tsx",
      "src/app/reset-password/reset-password-form.tsx",
      "src/app/suspended/page.tsx",
    ],
    covers: [
      "password sign-in",
      "email two-factor sign-in",
      "forgot password",
      "reset password",
      "unfinished setup",
      "suspension appeal",
    ],
  },
  {
    slug: "navigate-workspaces",
    audience: "account",
    title: t(
      "Find your workspace and read notifications",
      "切换工作区并查看通知",
    ),
    summary: t(
      "Use role-aware shortcuts, the mobile menu, language controls and your notice bell.",
      "使用按权限显示的快捷入口、手机菜单、语言设置和通知铃铛。",
    ),
    route: "/my-account",
    prerequisites: [
      t("Sign in with your existing account.", "使用现有账号登录。"),
    ],
    steps: [
      {
        title: t("Open the grouped account menu", "打开分组账号菜单"),
        body: t(
          "Use the header shortcuts or open your avatar menu to see links grouped under Workspaces, Tools and Account: Enter Tutor Page, Enter Tutee Page, Patrol, Translations or Back to Management. Use the top-bar Help Center button on any page for task guides. A shortcut does not grant a missing membership.",
          "使用顶部快捷入口或打开头像菜单查看按“工作区”“常用功能”“账号”分组的入口：进入辅导伙伴主页、进入学习伙伴主页、巡查、翻译或返回管理主页。任意页面顶部栏均可打开“帮助中心”。快捷入口不会授予缺失的参与资格。",
        ),
        screenshot: "account",
        focus: t(
          "Grouped account menu and top-bar Help Center button",
          "分组账号菜单与顶部帮助中心按钮",
        ),
      },
      {
        title: t("Use mobile and language controls", "使用手机与语言控件"),
        body: t(
          "On narrow screens use Menu to open management navigation; choose a link, Close or Escape to dismiss it. Use the language selector and theme control in the header. Scroll wide tables inside their own region.",
          "窄屏下使用“菜单”打开管理导航；选择链接、关闭或按Escape即可收起。页头可切换语言和主题。宽表格请在表格自身区域内横向滚动。",
        ),
      },
      {
        title: t("Follow your notifications", "查看自己的通知"),
        body: t(
          "Open the bell, select a notice to its related task, mark individual notices read or choose Mark all as read. Use Notification preferences to control badges and optional email separately.",
          "打开铃铛，选择通知进入关联任务，可逐条标为已读或选择“全部已读”。在通知偏好中分别设置角标与可选邮件。",
        ),
      },
      {
        title: t("Sort information safely", "安全排序信息"),
        body: t(
          "Select a sortable data heading for ascending, again for descending and a third time for original order. Keyboard users can focus it and press Enter or Space. Sorting preserves filters and changes no records.",
          "点击可排序数据列标题，依次为升序、降序、原始顺序。键盘用户可聚焦后按Enter或空格。排序保留筛选条件，不修改记录。",
        ),
      },
    ],
    expected: t(
      "You are in the intended permitted workspace, with notices linked to their owning tasks.",
      "进入所需且有权限的工作区，并可通过通知找到对应任务。",
    ),
    explanation: [
      t(
        "Management rank, Tutor/Tutee/Crew participation and Translator assignment are separate. Enabled program modules also affect visible navigation.",
        "管理职级、辅导伙伴／学习伙伴／巡查资格及翻译分配相互独立。项目模块开关也会影响导航。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("A page or shortcut is missing", "缺少页面或快捷入口"),
        solution: t(
          "Ask management to check the linked profile, membership, school departure, suspension and enabled module. Typing a hidden page's address cannot bypass its server permission check.",
          "请管理团队检查关联档案、参与资格、离校状态、停用和模块开关。直接输入隐藏页面地址不能绕过服务器权限检查。",
        ),
      },
    ],
    related: ["notification-preferences", "read-recover-save"],
    sources: [
      "src/app/_components/workspace-header.tsx",
      "src/app/_components/workspace-links.tsx",
      "src/app/_components/admin-nav.tsx",
      "src/app/_components/ui/table-sorting.tsx",
    ],
    covers: [
      "workspace switching",
      "mobile navigation",
      "language",
      "theme",
      "notification bell",
      "mark read",
      "table sorting",
    ],
  },
  {
    slug: "read-recover-save",
    audience: "account",
    title: t("Recover a failed load or save", "恢复加载或保存失败"),
    summary: t(
      "Recognize pending review, accepted writes, stale drafts and safe read-only retries.",
      "区分待审核、已接受保存、过时草稿与安全的只读重试。",
    ),
    route: "/my-account",
    prerequisites: [
      t(
        "Keep the affected page open while reviewing the message.",
        "查看提示时保持相关页面打开。",
      ),
    ],
    steps: [
      {
        title: t("Read the specific status", "阅读具体状态"),
        body: t(
          "Changes saved means the write was accepted. Submitted for Review means a proposal is pending and live records have not changed. An unavailable list is not an empty list.",
          "“更改已保存”表示写入已接受。“已提交审核”表示提案待审，实时记录尚未改变。列表不可用并不表示列表为空。",
        ),
        screenshot: "account",
        focus: t(
          "Section-specific save, error or recovery message",
          "各区域的保存、错误或恢复提示",
        ),
      },
      {
        title: t("Retry the correct operation", "重试正确操作"),
        body: t(
          "If saving failed, correct the error and deliberately retry. If saving succeeded but refresh failed, choose Retry refresh or Check request result: these read the accepted result instead of submitting it again.",
          "保存失败时，修正问题后主动重试。保存成功但刷新失败时，选择“重试刷新”或“检查申请结果”：这些操作读取已接受结果，不会重新提交。",
        ),
      },
      {
        title: t("Resolve a changed-record conflict", "处理记录变化冲突"),
        body: t(
          "Review the conflict notice. Explicit Reload replaces the stale draft only after current evidence loads successfully; review that evidence before a new submission. Close or Cancel never confirms a review.",
          "阅读冲突提示。明确选择“重新加载”并成功获取当前证据后，才会替换过时草稿；再次提交前重新核对。关闭或取消不会确认审核。",
        ),
      },
      {
        title: t("Keep drafts within their lifetime", "注意草稿有效范围"),
        body: t(
          "Most editors retain drafts while this page remains mounted, including collapse or tab changes. They are not autosaved across leaving or refreshing. Pending writes may lock editing and dismissal until their result is known.",
          "多数编辑器在当前页面仍挂载时保留草稿，包括折叠或切换页签。离开或刷新后不会自动保存。写入进行中可能锁定编辑及关闭，直到结果明确。",
        ),
      },
    ],
    expected: t(
      "You recover the current record without accidentally repeating a completed action.",
      "恢复当前记录，并避免意外重复已完成的操作。",
    ),
    explanation: [
      t(
        "Confirmation countdowns only enable the final button; they never submit automatically. Permission denial can remove protected content until a fresh authorized read succeeds.",
        "确认倒计时只启用最终按钮，不会自动提交。权限被拒绝时，受保护内容可能隐藏，直到重新成功验证权限。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "You cannot tell whether the action saved",
          "无法确定操作是否保存",
        ),
        solution: t(
          "Use the offered result check, inspect the affected record or ask management with the page and approximate time. Avoid changing and resubmitting an uncertain completed action.",
          "使用页面提供的结果查询、查看相关记录，或告知管理团队页面及大致时间。不要修改后重新提交结果尚不明确的已执行操作。",
        ),
      },
    ],
    sources: [
      "src/lib/invalidate-refresh.ts",
      "src/app/_components/ui/query-feedback.tsx",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "read retry",
      "save retry",
      "saved refresh failure",
      "stale conflict reload",
      "confirmation countdown",
      "draft lifetime",
    ],
  },
  {
    slug: "account-profile",
    audience: "account",
    title: t(
      "Update your shared profile and access requests",
      "更新共享资料及权限申请",
    ),
    summary: t(
      "Save your name fields independently and request eligible participation without duplicating accounts.",
      "单独保存姓名信息，并申请符合条件的参与资格，无需重复注册。",
    ),
    route: "/my-account",
    prerequisites: [
      t(
        "Sign in and open Account Settings; tutors can use Account Settings at /settings.",
        "登录并打开账号设置；辅导伙伴也可使用/settings的账号设置。",
      ),
    ],
    steps: [
      {
        title: t("Edit available name fields", "编辑可用姓名字段"),
        body: t(
          "In the profile section edit First Name, Last Name, Preferred Name or Name in Another Language when available. Latin fields accept accented letters, spaces, apostrophes and hyphens; use the other-language field for other scripts.",
          "在资料区域按需编辑名字、姓氏、惯用名或其他语言姓名。拉丁字段允许带重音字母、空格、撇号和连字符；其他文字请填入其他语言姓名。",
        ),
        screenshot: "account",
        focus: t(
          "Profile fields followed by this section's save and Cancel controls",
          "资料字段及下方当前区域的保存与取消按钮",
        ),
      },
      {
        title: t("Save this section", "保存当前区域"),
        body: t(
          "Choose Save Changes in tutor Settings, or Save profile in shared Account Settings, to save the name fields together. Cancel restores the last loaded values. Password, emails, academics and membership each have their own actions and are not saved by this button.",
          "在辅导伙伴设置中选择“保存更改”，或在通用账号设置中选择“保存个人资料”，一起保存姓名字段。“取消”恢复上次读取值。密码、邮箱、学业和参与资格各有独立操作，不会由此按钮保存。",
        ),
      },
      {
        title: t(
          "Review participation or an invitation",
          "申请参与资格或接受邀请",
        ),
        body: t(
          "Use the membership controls to request eligible participation, or Add access to review a supplied invitation. A participant request cannot grant a management rank; check its pending decision before assuming access changed.",
          "使用参与资格控件提交符合条件的申请，或用“添加权限”确认已收到的邀请。参与申请不能授予管理职级；应先查看决定，再判断权限是否改变。",
        ),
      },
    ],
    expected: t(
      "The profile section confirms its save, or a separate access request shows its actual review state.",
      "资料区域显示保存结果，或独立权限申请显示实际审核状态。",
    ),
    explanation: [
      t(
        "Current explicitly linked tutor/tutee profiles share the account's name fields. Historical applications and signatures retain their original names. Name visibility and requiredness follow program configuration; the system does not guess how to split a legacy name.",
        "当前明确关联的辅导伙伴和学习伙伴档案共享账号姓名。历史申请和签名保留原姓名。姓名显示和必填规则由项目配置决定；系统不会猜测旧姓名的拆分方式。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Your old full name has no split fields",
          "旧完整姓名没有拆分字段",
        ),
        solution: t(
          "Leave Latin name fields unchanged when correcting unrelated information. If changing a Latin name field, supply the actual valid First Name rather than guessing a split.",
          "仅更正其他信息时，请保持拉丁姓名字段不变。确需修改时，填写真实有效的名字，不要猜测拆分。",
        ),
      },
      {
        problem: t(
          "Profile saved but is still read only",
          "资料已保存但仍只读",
        ),
        solution: t(
          "Choose Retry refresh to read accepted values. If another editor changed the version, explicitly Reload and review before resubmitting.",
          "选择“重试刷新”读取已接受值。如其他人更改了版本，请明确重新加载并核对后再提交。",
        ),
      },
    ],
    related: ["account-academics", "account-emails", "accept-invitation"],
    sources: [
      "src/app/_components/account-settings.tsx",
      "src/app/_components/membership-editor.tsx",
      "src/app/(tutor)/settings/page.tsx",
    ],
    covers: [
      "edit own profile",
      "name fields",
      "save profile",
      "cancel profile draft",
      "request participant badge",
      "add access account menu",
    ],
  },
  {
    slug: "account-academics",
    audience: "account",
    title: t("Confirm your academic details", "确认学业信息"),
    summary: t(
      "Record the grade that actually applies in the current school year and inspect its history.",
      "记录当前学年实际年级，并查看确认历史。",
    ),
    route: "/my-account#academic-details",
    prerequisites: [
      t(
        "Open Academic Details in Account Settings.",
        "在账号设置中打开学业信息。",
      ),
    ],
    steps: [
      {
        title: t("Review the current report", "检查当前记录"),
        body: t(
          "Choose Review Academic Details or Edit Academic Details. Read the saved grade, reference school year and any Needs Review & Confirmation notice.",
          "选择“检查学业信息”或“编辑学业信息”，查看已存年级、参考学年及任何需要检查确认的提示。",
        ),
        screenshot: "account-academics",
        focus: t(
          "Opened academic editor, grade choice and reference school year",
          "已打开的学业编辑器、年级选择及参考学年",
        ),
      },
      {
        title: t("Choose a truthful value", "选择真实信息"),
        body: t(
          "Select an offered grade, Unknown, Graduated or Not Applicable as appropriate. The current school year is filled automatically. Confirm the report; this saves academics separately from profile names.",
          "按实际情况选择开放年级、未知、已毕业或不适用。当前学年自动填写。确认此记录；学业信息与姓名资料分别保存。",
        ),
      },
      {
        title: t("Inspect confirmation history", "查看确认历史"),
        body: t(
          "Open Confirmation History to read recorded values, source and dates. If an invitation completion points here, finish confirmation and then follow the normal tutor activation or Crew reentry workflow.",
          "打开确认历史，查看记录值、来源和日期。邀请完成页若指向此处，请先确认，再按正常辅导激活或巡查重新加入流程继续。",
        ),
      },
    ],
    expected: t(
      "Your current account academics are confirmed for the recorded school year.",
      "当前账号学业信息已按记录学年确认。",
    ),
    explanation: [
      t(
        "Expected graduation is derived from grade and reference year; it is not a separate editable field. Grades do not advance automatically. Academic Graduated does not itself change participation or grant observer access. Original enrollment academics and signed surveys remain historical evidence.",
        "预计毕业年份由年级和参考学年推算，不能单独编辑。年级不会自动升级。学业中的已毕业状态本身不会改变参与资格或授予观察权限。原入组学业信息及签署申请仍作为历史证据保留。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("School year changed while editing", "编辑时学年发生变化"),
        solution: t(
          "Reload and review the newly applied year before confirming. If the current year is not configured, ask management; Unknown and Not Applicable remain available.",
          "重新加载并检查新启用学年后再确认。如未配置当前学年，请联系管理团队；未知及不适用仍可使用。",
        ),
      },
    ],
    related: ["school-departure", "start-tutoring"],
    sources: [
      "src/app/_components/academic-profile.tsx",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "confirm academic grade",
      "unknown graduated not applicable",
      "academic confirmation history",
      "derived graduation",
      "school-year rollover",
    ],
  },
  {
    slug: "school-departure",
    audience: "account",
    title: t(
      "Report school departure or request a return",
      "报告离校或申请返校",
    ),
    summary: t(
      "Request graduation or transfer review and understand the effect on participation.",
      "申请毕业或转学审核，并了解对参与资格的影响。",
    ),
    route: "/my-account#academic-details",
    prerequisites: [
      t(
        "Open School Departure in tutor Settings, or use the separate departure control beside Academic Details in shared Account Settings.",
        "在辅导伙伴设置中打开“离校状态”，或使用通用账号设置中学业信息旁的独立离校控件。",
      ),
    ],
    steps: [
      {
        title: t("Open School Departure", "打开离校功能"),
        body: t(
          "In tutor Settings use School Departure directly; in shared Account Settings choose I have transferred away beside Academic Details. Select the applicable Change, enter Reason for review and choose Request change. Read Review departure change, then choose Confirm change to submit for Admin review; this does not approve departure.",
          "在辅导伙伴设置中直接使用“离校状态”；通用账号设置则选择学业信息旁的“我已转学离校”。选择适用的“变更”，填写“审核理由”，再选择“申请变更”。阅读“核对离校变更”后选择“确认变更”，仅提交管理员审核，并不代表离校已获批准。",
        ),
        screenshot: "account-departure",
        focus: t(
          "School Departure review, departure type and reason",
          "离校审核、离校类型及原因",
        ),
      },
      {
        title: t("Wait for the decision", "等待决定"),
        body: t(
          "Check the departure request and history. Admin/Head review it; submitting alone does not confirm departure. After confirmation, eligible Enter Viewers Portal opens masked read-only summaries.",
          "查看离校申请和历史。由管理员／负责人审核；仅提交不代表离校已确认。确认后，符合条件的“进入观察员门户”可打开脱敏只读概览。",
        ),
      },
      {
        title: t(
          "Request return when circumstances change",
          "情况改变时申请返校",
        ),
        body: t(
          "In School Departure choose Return to school under Change, enter Reason for review and choose Request change. Read Review departure change and Confirm change to submit the return request. After approval, restore tutor activation or learning enrollment through their normal workflows.",
          "在“离校状态”的“变更”中选择“返校”，填写“审核理由”并选择“申请变更”。阅读“核对离校变更”后选择“确认变更”，提交返校申请。获批后，通过正常流程恢复辅导激活或学习报名。",
        ),
      },
    ],
    expected: t(
      "The request shows its actual decision and your participation reflects only the approved outcome.",
      "申请显示实际决定，参与资格仅按已批准结果变化。",
    ),
    explanation: [
      t(
        "Confirmed departure closes current assignments and pending learning requests; a departing tutor's learners return to matching. It preserves account role and personal history. A reviewed return does not automatically restore assignments. Independent management, Crew and Translator permissions remain subject to their own rules.",
        "确认离校会结束当前分配及待处理学习申请；离校辅导伙伴的学习伙伴返回匹配。账号角色与个人历史保留。返校获批不会自动恢复分配。独立管理、巡查和翻译权限仍遵循各自规则。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "You set Graduated but cannot enter the Viewer portal",
          "已选择毕业但无法进入观察员门户",
        ),
        solution: t(
          "Academic graduation alone is not confirmed school departure. Check this separate reviewed request and ask management about observer restrictions.",
          "学业毕业状态不等于已确认离校。请检查此独立审核申请，并向管理团队了解观察权限限制。",
        ),
      },
    ],
    related: ["account-academics", "observe-program"],
    sources: [
      "src/app/_components/school-departure.tsx",
      "src/lib/portal-access.ts",
      "src/server/api/routers/departure.ts",
    ],
    covers: [
      "request graduation",
      "request school transfer",
      "departure history",
      "return to school",
      "departure observer access",
    ],
  },
  {
    slug: "account-security",
    audience: "account",
    title: t(
      "Change your password or two-factor preference",
      "更改密码或双重验证偏好",
    ),
    summary: t(
      "Confirm security changes and sign in again after a password change.",
      "确认安全更改，并在修改密码后重新登录。",
    ),
    route: "/my-account#account-password",
    prerequisites: [
      t(
        "Know your current password and have access to your primary email.",
        "知道当前密码，且能使用主要邮箱。",
      ),
    ],
    steps: [
      {
        title: t("Open the security section", "打开安全区域"),
        body: t(
          "In Account Settings find the password or two-factor controls. Enter your current password and complete the requested email security code when prompted.",
          "在账号设置中找到密码或双重验证控件。输入当前密码，并按提示完成邮件安全验证码。",
        ),
        screenshot: "account-password",
        focus: t(
          "Current password, new password and the password confirmation action",
          "当前密码、新密码及密码确认操作",
        ),
      },
      {
        title: t("Confirm the intended change", "确认所需更改"),
        body: t(
          "For password change, enter a new password of 8–1,024 characters and use that section's confirmation. For two-factor, review whether you are enabling or disabling the personal preference and confirm separately.",
          "修改密码时输入八至一千零二十四字符的新密码，再使用该区域的确认操作。更改双重验证时，核对正在启用还是关闭个人偏好，并单独确认。",
        ),
        screenshot: "account-twofactor",
        focus: t(
          "Two-factor preference and its independent security confirmation",
          "双重验证偏好及其独立安全确认",
        ),
      },
      {
        title: t("Sign in again after password change", "修改密码后重新登录"),
        body: t(
          "An accepted password change returns you to Sign In and revokes other existing sessions. Use the new password; retain access to the primary mailbox if two-factor is required.",
          "密码修改成功后会返回登录页，并撤销其他现有会话。使用新密码登录；如需双重验证，请确保主要邮箱可用。",
        ),
      },
    ],
    expected: t(
      "The requested security preference is saved, or the new password is usable at fresh sign-in.",
      "所需安全偏好已保存，或可使用新密码重新登录。",
    ),
    explanation: [
      t(
        "Email two-factor requires both the program feature and your account preference. Verified secondary emails do not bypass it. Security alerts and verification mail remain independent of optional notification switches.",
        "邮箱双重验证同时依赖项目功能及个人偏好。已验证备用邮箱不能绕过此要求。安全警报和验证邮件不受可选通知开关控制。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Too many password confirmations", "密码确认次数过多"),
        solution: t(
          "Wait fifteen minutes before retrying. The shared allowance covers ten checks per account, including successful checks across settings and privileged confirmations; signing in again does not reset it.",
          "等待十五分钟再重试。每账号共享十次检查额度，包括跨设置和特权确认的成功检查；重新登录不会重置额度。",
        ),
      },
      {
        problem: t(
          "An older password exceeds the input limit",
          "旧密码超过输入上限",
        ),
        solution: t(
          "Use Forgot Password to replace it with an 8–1,024-character password before changing settings.",
          "先通过忘记密码将其更换为八至一千零二十四字符，再更改设置。",
        ),
      },
    ],
    related: ["sign-in-recover", "account-emails"],
    sources: [
      "src/app/_components/two-factor-settings.tsx",
      "src/app/_components/account-settings.tsx",
      "src/lib/password-session.ts",
    ],
    covers: [
      "change password",
      "enable two-factor",
      "disable two-factor",
      "security email confirmation",
      "session revocation",
      "password confirmation limits",
    ],
  },
  {
    slug: "account-emails",
    audience: "account",
    title: t(
      "Manage primary and secondary email addresses",
      "管理主要与备用邮箱",
    ),
    summary: t(
      "Verify new addresses, select a primary and remove unused secondary addresses.",
      "验证新邮箱、选择主要邮箱，并移除不再使用的备用邮箱。",
    ),
    route: "/my-account#associated-emails",
    prerequisites: [
      t(
        "Open Associated Emails and know your current password.",
        "打开关联邮箱，并知道当前密码。",
      ),
    ],
    steps: [
      {
        title: t("Add and verify an address", "添加并验证邮箱"),
        body: t(
          "When Secondary-Email Binding is enabled, enter the new address and current password, then enter its emailed code. Up to five secondary addresses, including pending ones, are allowed.",
          "启用备用邮箱绑定时，输入新地址和当前密码，然后填写该邮箱收到的验证码。最多允许五个备用地址，待验证地址也计入。",
        ),
        screenshot: "account-emails",
        focus: t(
          "Associated Emails and verification state",
          "关联邮箱与验证状态",
        ),
      },
      {
        title: t("Handle a pending address", "处理待验证地址"),
        body: t(
          "Re-enter Current password to unlock Resend code or Cancel pending. Use Resend code for an expired or missing code, or Cancel pending beside the address to remove its request. Codes last ten minutes, permit five attempts and have a one-minute resend interval.",
          "重新输入当前密码，才能使用重发验证码或取消待验证。验证码过期或未收到时选择重发验证码；移除申请时，选择邮箱旁的取消待验证。验证码有效十分钟，允许五次尝试，重发间隔一分钟。",
        ),
      },
      {
        title: t(
          "Choose the primary or remove a secondary",
          "选择主要邮箱或移除备用邮箱",
        ),
        body: t(
          "Enter Current password above the email list, then choose Make primary beside a verified secondary address. This submits immediately; the previous verified primary becomes secondary. To remove a secondary, ensure the intended primary is marked, re-enter Current password and choose Remove beside the secondary. There is no separate confirmation dialog.",
          "在邮箱列表上方输入当前密码，再选择已验证备用邮箱旁的设为主要邮箱。操作立即提交，原已验证主要邮箱成为备用邮箱。移除备用邮箱前，确认预期主要邮箱已标记，重新输入当前密码，再选择该备用邮箱旁的移除。此操作没有另一个确认弹窗。",
        ),
      },
    ],
    expected: t(
      "Each address has an explicit verified/pending state and the intended primary is marked.",
      "每个地址显示明确的已验证或待验证状态，所需主要邮箱已标记。",
    ),
    explanation: [
      t(
        "Any verified address can sign into or recover the same account. Login two-factor still goes to primary. Primary changes update explicitly linked current contact rows while preserving identity, roles and signed history. Removing an address revokes its outstanding grants.",
        "任一已验证地址均可登录或恢复同一账号。登录双重验证码仍发送到主要邮箱。主要邮箱变更更新明确关联的当前联系记录，但保留身份、角色及签署历史。移除地址会撤销其未完成授权。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Adding or verifying is disabled", "无法添加或验证"),
        solution: t(
          "Re-enter Current password when Resend code or Cancel pending is disabled after sending. Wait for the resend cooldown. Check the program's Secondary-Email Binding notice: when off, existing verified addresses remain usable/removable, pending requests can be cancelled, and primary-email change remains available.",
          "发送后若重发验证码或取消待验证不可用，请重新输入当前密码，并等待重发冷却结束。查看项目备用邮箱绑定提示：关闭时，已有验证地址仍可使用或移除，待验证申请可取消，主要邮箱变更仍可用。",
        ),
      },
      {
        problem: t("Address ownership conflicts", "邮箱所有权冲突"),
        solution: t(
          "Do not create another account. Ownership is checked at verification, and a pending address reserves nothing; ask management to review an unexpected conflict.",
          "不要另建账号。所有权在验证时重新检查，待验证地址不会被保留；异常冲突请管理团队审核。",
        ),
      },
    ],
    related: ["sign-in-recover", "notification-preferences"],
    sources: [
      "src/app/_components/account-emails.tsx",
      "src/server/api/routers/account.ts",
    ],
    covers: [
      "add secondary email",
      "verify secondary email",
      "resend email code",
      "cancel pending email",
      "promote primary",
      "remove secondary",
      "email sign-in recovery",
    ],
  },
  {
    slug: "notification-preferences",
    audience: "account",
    title: t(
      "Choose notification badges, email and language",
      "选择通知角标、邮件及语言",
    ),
    summary: t(
      "Set categories independently and understand required notices and unsubscribe links.",
      "分别设置通知类别，并了解必需通知与退订链接。",
    ),
    route: "/my-account#notification-preferences",
    prerequisites: [
      t(
        "Open Account → Notification preferences, also linked from the bell.",
        "打开账号→通知偏好，也可通过铃铛中的链接进入。",
      ),
    ],
    steps: [
      {
        title: t("Choose badges and optional email", "选择角标与可选邮件"),
        body: t(
          "Set each category's unread badge and optional-email choices separately. Upcoming reminders are email-only. Required by your administrator choices stay checked and cannot be edited.",
          "分别设置各类别的未读角标与可选邮件。即将发生事件提醒仅通过邮件发送。标记为管理员要求的选项保持勾选，不能更改。",
        ),
        screenshot: "account-notifications",
        focus: t(
          "Notification categories and Email language",
          "通知类别与邮件语言",
        ),
      },
      {
        title: t(
          "Choose delivery language and addresses",
          "选择投递语言与邮箱",
        ),
        body: t(
          "Choose English or 中文 for emails, and optionally include verified secondary addresses when offered. Save applies this section; Cancel discards its draft. Email language does not change the website language.",
          "选择英语或中文邮件；提供该选项时可包含已验证备用邮箱。保存应用本区域设置，取消放弃草稿。邮件语言不会改变网站语言。",
        ),
      },
      {
        title: t("Use an unsubscribe link deliberately", "明确使用退订链接"),
        body: t(
          "An optional notice's Unsubscribe opens a review page without changing anything. Choose the exact category or all unlocked optional emails and confirm. Restore choices later in Notification preferences.",
          "可选通知中的退订链接仅打开审核页，不会立即更改设置。选择具体类别或所有未锁定可选邮件并确认。之后可在通知偏好中恢复。",
        ),
      },
    ],
    expected: t(
      "Saved preferences control eligible badges and optional mail without disabling required security or request-status messages.",
      "保存偏好后控制符合条件的角标和可选邮件，必需安全及申请状态邮件仍保留。",
    ),
    explanation: [
      t(
        "Disabling a badge preserves notices and read state. Optional mail requires the program mail switch, verified delivery addresses and category eligibility. Reminders cover eligible interviews, meetings and confirmed tutoring; they are checked again before sending.",
        "关闭角标会保留通知及已读状态。可选邮件依赖项目邮件开关、已验证地址及类别资格。提醒涵盖符合条件的面试、会议及已确认辅导，并在发送前再次检查。",
      ),
      t(
        "Unsubscribe affects the account's chosen category across primary and included secondary mailboxes. It cannot disable administrator-required choices. Links expire after 90 days and should remain private.",
        "退订作用于账号该类别，包括主要邮箱和已包含的备用邮箱。不能关闭管理员要求的选项。链接九十天后过期，应保持私密。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Email choices are unavailable or mail never arrives",
          "邮件选项不可用或未收到邮件",
        ),
        solution: t(
          "Check the program mail notice, your verification state and saved choices. Ask management about delivery warnings; successful queuing does not prove inbox delivery. Security and verification mail use separate rules.",
          "检查项目邮件提示、邮箱验证状态及已保存选项。向管理团队询问投递警告；排队成功不代表到达收件箱。安全与验证邮件遵循独立规则。",
        ),
      },
    ],
    sources: [
      "src/app/_components/account-emails.tsx",
      "src/app/unsubscribe/unsubscribe-form.tsx",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "notification category badges",
      "optional email",
      "email language",
      "secondary delivery preference",
      "required preferences",
      "unsubscribe category",
      "unsubscribe all",
      "reminders",
    ],
  },
  {
    slug: "read-accept-policy",
    audience: "account",
    title: t(
      "Read and accept a current participation policy",
      "阅读并接受当前参与政策",
    ),
    summary: t(
      "Review the exact revision before participation and reopen it without signing again.",
      "参与前核对具体修订版，也可重新打开阅读而不再次签署。",
    ),
    route: "/student?view=dashboard",
    prerequisites: [
      t(
        "A published policy applies to your tutor or tutee participation.",
        "已发布政策适用于你的辅导伙伴或学习伙伴资格。",
      ),
    ],
    steps: [
      {
        title: t("Open the required document", "打开所需文档"),
        body: t(
          "For tutee participation open Dashboard in the tutee workspace; tutors open /dashboard for their tutor-policy reminder. Follow the applicable policy notice and read the selected translation, with English fallback. Accounts with both types review both applicable policies.",
          "学习伙伴在本人页面打开概览；辅导伙伴通过/dashboard打开辅导政策提醒。跟随适用政策提示阅读所选译文，无译文时使用英语。兼有两种资格的账号需分别检查两项适用政策。",
        ),
        screenshot: "policy",
        focus: t(
          "Opened policy document, scroll area and agreement controls",
          "已打开的政策文档、滚动区域及同意控件",
        ),
      },
      {
        title: t("Read to the end and agree", "阅读到底并同意"),
        body: t(
          "Scroll to the bottom inside the policy text box using touch, mouse or keyboard. Then deliberately check the agreement, supply a signature when requested and complete the five-second confirmation. The timer never submits automatically.",
          "使用触摸、鼠标或键盘在政策文本框内滚动到底部。随后主动勾选同意，按要求签名并完成五秒确认。倒计时不会自动提交。",
        ),
      },
      {
        title: t(
          "Reopen without changing acceptance",
          "重新阅读且不改变接受记录",
        ),
        body: t(
          "Tutors can choose current policy in the accepted-policy message to read the latest document. Close, Escape or the backdrop dismisses its reader. Viewing alone records no acceptance.",
          "辅导伙伴可点击已接受提示中的当前政策，阅读最新文档。可关闭、按Escape或点击背景退出。仅查看不会记录接受。",
        ),
      },
    ],
    expected: t(
      "An accepted revision satisfies its participation requirement; a read-only opening changes nothing.",
      "已接受修订版满足其参与要求；只读打开不会改变任何记录。",
    ),
    explanation: [
      t(
        "A newly published applicable revision requires renewed consent. Historical signatures retain their exact text. You can cancel renewal to use messages, account settings, owned history, feedback and appeals; new participation still needs current consent.",
        "新发布且适用的修订版需要重新同意。历史签名保留其准确文本。可以取消续签并访问消息、账号设置、已有历史、反馈及申诉，但新的参与操作仍需当前同意。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The agreement checkbox stays disabled",
          "同意复选框仍不可用",
        ),
        solution: t(
          "Scroll inside the document box, not only the page. Reopening or changing revision/translation starts a fresh review. If loading or acceptance failed, use the offered Refresh before trying again.",
          "请在文档框内部滚动，而非仅滚动页面。重新打开或切换修订版、译文会重新开始阅读检查。加载或接受失败时，先使用页面提供的刷新。",
        ),
      },
    ],
    sources: [
      "src/app/_components/policy-consent.tsx",
      "src/app/(tutor)/dashboard/page.tsx",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "renew policy acceptance",
      "scroll policy gate",
      "policy signature",
      "read current policy",
      "cancel policy renewal",
    ],
  },
  {
    slug: "send-private-messages",
    audience: "account",
    title: t("Send a message or reply privately", "私下发送消息或回复"),
    summary: t(
      "Choose permitted recipients, keep each delivery separate and check its saved result.",
      "选择获准收件人、分别投递，并检查保存结果。",
    ),
    route: "/messages",
    prerequisites: [
      t(
        "Your current account can message at least one permitted contact and is not messaging-restricted.",
        "当前账号至少有一个可联系对象，且未受消息限制。",
      ),
    ],
    steps: [
      {
        title: t("Open your workspace inbox", "打开工作区收件箱"),
        body: t(
          "Use Messages. Tutees can stay in their Messages tab; management uses /admin/messages. Search by name or username, select up to 20 contacts and review the selected list before sending.",
          "打开消息。学习伙伴可留在消息页签；管理团队使用/admin/messages。按姓名或用户名搜索，选择最多二十位联系人，并在发送前核对已选列表。",
        ),
        screenshot: "student-messages",
        focus: t(
          "Recipient search, selected contacts and composer",
          "收件人搜索、已选联系人和编辑框",
        ),
      },
      {
        title: t("Write and send once", "编辑并发送一次"),
        body: t(
          "Read the disclosure above the composer, enter your text and send. A message to several people creates separate private deliveries; recipients do not see the other recipients or their replies.",
          "阅读编辑框上方的披露说明，输入文字并发送。群选收件人会分别私密投递；收件人看不到其他收件人及其回复。",
        ),
      },
      {
        title: t("Reply or return to your draft", "回复或返回原草稿"),
        body: t(
          "Choose Reply on a message. The composer names its sender and focuses the message field. Cancel reply returns to your separate general draft; a successful reply also returns there.",
          "在消息上选择回复。编辑框显示发送者并聚焦文字框。取消回复会返回独立的普通消息草稿；回复成功后也会返回。",
        ),
      },
      {
        title: t(
          "Mark incoming messages read and browse history",
          "将收到的消息标为已读并翻阅历史",
        ),
        body: t(
          "In Your Messages, choose Mark as Read on an unread incoming message. This saves immediately without a confirmation dialog. After the list refreshes, its Mark as Read button and unread left-border highlight disappear; opening the inbox or replying alone does not mark it read. Use this list's Next for older messages and Previous to return, checking the displayed page number and disabled buttons. Message read state and bell notices are independent; mark the notice read using the bell's own controls if needed.",
          "在“我的消息”中，对尚未阅读的收到消息选择“标为已读”。此操作立即保存，没有确认对话框。列表刷新后，该消息的“标为已读”按钮和彩色未读左边框消失；仅打开收件箱或回复不会将其标为已读。使用此列表的“下一页”翻阅较早消息、“上一页”返回，并留意显示的页码和禁用按钮。消息已读状态与铃铛通知相互独立；如需把通知标为已读，请使用铃铛自身的已读控件。",
        ),
        focus: t(
          "Incoming Mark as Read, its saved result and the Your Messages pager",
          "收到消息的标为已读按钮、保存结果与我的消息分页控件",
        ),
      },
    ],
    expected: t(
      "Your sent history confirms the delivery or shows a clear failure while retaining the draft. After marking an incoming message read and refreshing the list, its Mark as Read button and unread left-border highlight disappear.",
      "已发历史确认投递，或明确显示失败并保留草稿。收到消息被标为已读并刷新列表后，不再显示该消息的“标为已读”按钮和彩色未读左边框。",
    ),
    explanation: [
      t(
        "New disclosed messages may be reviewed or reversibly hidden by Admin/Head with audit record. Older participant-only messages retain that boundary. Contact eligibility affects new sending; existing permitted history remains readable after eligibility changes.",
        "新披露消息可能被管理员／负责人审核或可逆隐藏，操作留有审计证据。旧版仅参与者可见消息保留原边界。联系人资格影响新发送；资格改变后仍可阅读原有获准历史。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A selected recipient became unavailable",
          "已选收件人变为不可用",
        ),
        solution: t(
          "Nothing is delivered if any selected recipient becomes ineligible before sending. Refresh permitted contacts, review selections and retry with your retained text. An identical accepted retry does not duplicate delivery.",
          "发送前任一已选收件人失去资格时，不会投递任何消息。刷新获准联系人、检查选择，再用保留文字重试。已接受的相同重试不会重复投递。",
        ),
      },
      {
        problem: t("Your draft disappeared after leaving", "离开后草稿消失"),
        solution: t(
          "Message drafts last only during the current page visit. Save needed text privately before navigation; do not place participant information in public bug reports.",
          "消息草稿仅在当前页面访问期间保留。离开前请私下保留所需文字，不要把参与者信息放入公开问题报告。",
        ),
      },
    ],
    related: ["notification-preferences", "report-problem"],
    sources: [
      "src/app/messages/page.tsx",
      "src/app/_components/message-inbox.tsx",
      "src/server/api/routers/messaging.ts",
      "src/server/api/routers/notification.ts",
      "src/server/messaging-permissions.ts",
    ],
    covers: [
      "message recipient search",
      "select multiple recipients",
      "send message",
      "reply",
      "cancel reply",
      "mark incoming messages read",
      "browse message history",
      "message moderation disclosure",
      "messaging restriction",
    ],
  },
  {
    slug: "find-own-history",
    audience: "account",
    title: t("Find and link your tutoring history", "查找并关联自己的辅导历史"),
    summary: t(
      "Read tutoring received and provided, or accept an exact staff-reviewed history invitation.",
      "查看接受及提供辅导的历史，或接受工作人员审核的指定历史邀请。",
    ),
    route: "/history",
    prerequisites: [
      t(
        "Sign in to the account that explicitly owns the records, or use a private history invitation supplied after identity review.",
        "登录明确拥有记录的账号，或使用身份审核后提供的私密历史邀请。",
      ),
    ],
    steps: [
      {
        title: t("Open My Tutoring History", "打开我的辅导历史"),
        body: t(
          "Use My Tutoring History in the account menu. Separate sections show tutoring received and tutoring provided. Read the original period, record and session count, then choose the rightmost View History.",
          "从账号菜单选择“我的辅导历史”。接受辅导和提供辅导分别列出。查看原时期、记录及课次数，再选择最右侧的查看历史。",
        ),
        screenshot: "history",
        focus: t(
          "Received/provided history and View History",
          "接受／提供辅导历史与查看历史入口",
        ),
      },
      {
        title: t("Browse the retained evidence", "浏览保留证据"),
        body: t(
          "Use each session, meeting and amendment list's own page controls. Tutor session-hour summaries exclude separate manual hour amendments; inspect those separately when comparing totals.",
          "分别使用课次、会议及调整列表的分页控件。辅导课次时数概览不包含单独的手动调整；比较总数时请另外检查。",
        ),
      },
      {
        title: t(
          "Accept exact historical access when invited",
          "受邀时接受指定历史权限",
        ),
        body: t(
          "An alumnus without a login can verify the exact invited mailbox, continue from the invitation popup through account review, then review the listed source record and choose Link My History. Existing accounts use normal sign-in/recovery.",
          "没有登录账号的校友可验证邀请指定邮箱，经邀请弹窗完成账号确认，再核对列出的源记录并选择关联我的历史。已有账号使用正常登录或恢复。",
        ),
      },
    ],
    expected: t(
      "Only records explicitly owned or linked after the exact review appear; no new current enrollment is created.",
      "仅显示明确拥有或经指定审核关联的记录；不会创建当前参与报名。",
    ),
    explanation: [
      t(
        "History can remain readable after participation revocation or archive. Name/email matches do not establish ownership, and several historical profiles may belong to one account. Linking history does not reactivate participation, grant a badge or fabricate policy consent.",
        "参与权限被撤销或档案归档后，历史仍可能可读。姓名或邮箱匹配不代表所有权；同一账号可有多个历史档案。关联历史不会重新激活参与、授予徽章或补造政策同意。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A record is missing or the old email is unavailable",
          "缺少记录或旧邮箱不可用",
        ),
        solution: t(
          "Ask staff to review the exact original record and identity evidence. Use a replacement reviewed invitation if authorized; do not claim a similar-looking record or create duplicate accounts.",
          "请工作人员检查准确原记录及身份证据。经授权可用替代审核邀请；不要认领看似相近的记录或另建重复账号。",
        ),
      },
    ],
    related: ["accept-invitation", "sign-in-recover"],
    sources: [
      "src/app/history/page.tsx",
      "src/app/history/claim/history-claim.tsx",
      "src/app/history/personal-tutor-history.tsx",
    ],
    covers: [
      "personal history",
      "received tutoring history",
      "provided tutoring history",
      "session meeting amendment pagination",
      "history-only account",
      "link exact history",
    ],
  },
  {
    slug: "report-problem",
    audience: "public",
    title: t(
      "Get private support or report a website problem",
      "获得私密帮助或报告网站问题",
    ),
    summary: t(
      "Send personal matters privately and use synthetic examples in public issue reports.",
      "私人事务通过私密渠道处理，公开问题报告使用虚构示例。",
    ),
    route: "/help",
    prerequisites: [
      t(
        "Identify the page, intended action and what happened.",
        "明确页面、原本操作和实际结果。",
      ),
    ],
    externalAction: {
      href: "https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=01-bug_report.yml",
      label: t("Open bug report form (GitHub)", "打开缺陷报告表单（GitHub）"),
    },
    steps: [
      {
        title: t("Choose the right channel", "选择合适渠道"),
        body: t(
          "For your account, attendance, assignment or disciplinary matter use Messages or the program's verified private contact. Use the relevant appeal workflow for a decision; a software issue does not file an appeal.",
          "账号、出勤、分配或纪律事务请使用消息或项目确认的私密联系方式。对决定提出异议应使用对应申诉流程；报告软件问题不等于提交申诉。",
        ),
        screenshot: "signin",
        focus: t(
          "Sign In to reach your private workspace",
          "登录后进入个人私密工作区",
        ),
      },
      {
        title: t(
          "Describe a reproducible software problem",
          "描述可复现软件问题",
        ),
        body: t(
          "Use the repository's bug-report form. Include page path, role, browser/device, shortest steps, expected and actual result, and date/time with timezone. State unknown when you do not know the app revision.",
          "使用仓库的缺陷报告表单，提供页面路径、角色、浏览器／设备、最短复现步骤、预期与实际结果，以及含时区的时间。不知道应用版本时注明未知。",
        ),
      },
      {
        title: t("Remove personal information", "移除个人信息"),
        body: t(
          "Use invented names and records. Remove names, contacts, private messages, disciplinary details, codes, cookies and account/verification links before posting screenshots or logs. Report suspected security issues privately to a verified operator or maintainer.",
          "使用虚构姓名和记录。公开截图或日志前，移除姓名、联系方式、私信、纪律详情、验证码、Cookie及账号／验证链接。疑似安全问题请私下报告给已确认的运营人员或维护者。",
        ),
      },
    ],
    expected: t(
      "The right team receives an actionable report without publishing private participant evidence.",
      "正确团队收到可处理报告，同时避免公开参与者隐私证据。",
    ),
    explanation: [
      t(
        "The repository also has enhancement, feature and documentation forms. Private support and appeals preserve their own access and decision process.",
        "仓库也有改进、功能和文档表单。私密支持及申诉仍保留各自访问权限和决定流程。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "You cannot sign in to send a private message",
          "无法登录发送私信",
        ),
        solution: t(
          "Try password recovery or use the program's verified contact. Suspended accounts sign in normally and use the suspension appeal page.",
          "尝试密码恢复或使用项目确认的联系方式。停用账号仍需正常登录，并使用停用申诉页面。",
        ),
      },
    ],
    related: ["send-private-messages", "sign-in-recover"],
    sources: ["docs/contributing/issues.md", "docs/guides/user-guide.md"],
    covers: [
      "private support",
      "report bug",
      "feature enhancement documentation issue",
      "security report",
      "redact public evidence",
    ],
  },
  {
    slug: "tutee-workspace",
    audience: "student",
    title: t("Use your tutee dashboard and schedule", "使用学习伙伴概览和课表"),
    summary: t(
      "Find assigned tutors, confirmed times, rooms and the next task.",
      "查找分配的辅导伙伴、已确认时间、教室及下一步任务。",
    ),
    route: "/student?view=dashboard",
    prerequisites: [
      t(
        "Use your own tutee access. First-time participation requires current tutee policy acceptance; merely visiting grants nothing.",
        "使用本人学习伙伴权限。首次参与需接受当前政策，仅访问页面不会获得资格。",
      ),
    ],
    steps: [
      {
        title: t("Start with Dashboard", "从概览开始"),
        body: t(
          "Read current session and request summaries. Use Request a Tutor in the header for a new eligible request. Choose My Tutors & Schedule for the complete current assignment list.",
          "阅读当前课次及申请概览。新的符合条件申请可用页头的申请辅导。选择我的辅导伙伴与课表，查看完整当前分配。",
        ),
        screenshot: "student-dashboard",
        focus: t(
          "Workspace navigation and current task summaries",
          "工作区导航与当前任务概览",
        ),
      },
      {
        title: t("Read schedule status carefully", "仔细查看课表状态"),
        body: t(
          "Check tutor, subject, weekly time and room. Awaiting schedule means a tutor is assigned but no time has been confirmed. Use dated session cards for agreed moves/extras, and confirm individual dates with your tutor.",
          "检查辅导伙伴、科目、每周时间和教室。等待排课表示已分配辅导伙伴，但时间未确认。通过日期课次卡查看已约定调整或加课，并与辅导伙伴确认具体日期。",
        ),
        screenshot: "student-schedule",
        focus: t(
          "Assigned subject, tutor, time and room",
          "已分配科目、辅导伙伴、时间和教室",
        ),
      },
      {
        title: t("Move to the task you need", "进入所需任务"),
        body: t(
          "Requests manages enrollment; Attendance contains records/feedback; Support contains cards/appeals; Messages and Account stay inside this workspace. Previous/Next controls belong to their individual lists.",
          "申请用于管理报名；出勤包含记录与反馈；支持包含纪律卡与申诉；消息和账号仍位于此工作区。各列表的上一页／下一页控件独立工作。",
        ),
      },
    ],
    expected: t(
      "You can distinguish an assigned tutor from a confirmed weekly schedule and open the right follow-up.",
      "能够区分已分配辅导伙伴与已确认每周课表，并进入正确后续流程。",
    ),
    explanation: [
      t(
        "Only current active-period assignments on explicitly owned non-inactive profiles appear in the current schedule; historical attendance remains available. No-tutoring notices distinguish information-only dates from paused regular commitments; agreed exceptions use dated scheduling.",
        "当前课表仅显示本人明确拥有且未停用档案在当前时期的分配；历史出勤仍保留。无辅导提示区分纯信息日期与暂停普通课次；约定例外需使用日期排课流程。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The count is unknown or a tutor seems missing",
          "数量未知或缺少辅导伙伴",
        ),
        solution: t(
          "Use Retry for unavailable reads. Check Requests and the active period; ask staff to review explicit ownership or inactive status rather than matching another person's name/email.",
          "数据不可用时使用重试。检查申请与当前时期；请工作人员核查明确所有权或停用状态，不要凭他人姓名／邮箱匹配记录。",
        ),
      },
    ],
    related: [
      "manage-tutee-request",
      "respond-session-plan",
      "tutee-feedback-appeals",
    ],
    sources: [
      "src/app/student/student-workspace.tsx",
      "src/app/student/tutee-overview.tsx",
      "src/app/student/views.ts",
    ],
    covers: [
      "tutee navigation",
      "dashboard summaries",
      "view tutors schedule rooms",
      "awaiting schedule",
      "no-tutoring notices",
      "tutee pagination",
    ],
  },
  {
    slug: "manage-tutee-request",
    audience: "student",
    title: t("Edit or recall your tutoring request", "编辑或撤回辅导申请"),
    summary: t(
      "Correct current answers while preserving history, or permanently close an unmatched request.",
      "更正当前答案并保留历史，或永久结束尚未匹配的申请。",
    ),
    route: "/student?view=requests",
    prerequisites: [
      t(
        "You explicitly own an open request in the active program period.",
        "本人明确拥有当前时期的未结申请。",
      ),
    ],
    steps: [
      {
        title: t("Open Current Request", "打开当前申请"),
        body: t(
          "In Requests review request status, original priority, current choices, assigned tutors and any review notice. Closed contains retained terminal/history entries.",
          "在申请页检查状态、原优先时间、当前选择、已分配辅导伙伴及审核提示。已结束列表保留终止及历史记录。",
        ),
        screenshot: "student-requests",
        focus: t(
          "Current Request and its edit/recall actions",
          "当前申请及编辑、撤回操作",
        ),
      },
      {
        title: t("Edit eligible current answers", "编辑可修改的当前答案"),
        body: t(
          "Choose Edit Signup Answers and correct eligible names/contact/grade, availability or unassigned subject choices. Check the draft, then choose Save signup answers; this saves directly without another confirmation dialog. Read the saved result before editing again. Assigned choices cannot be dropped here; ask Admin/Head to review release and answer changes together.",
          "选择编辑报名回答，更正允许修改的姓名／联系／年级、可用时间或尚未分配科目。核对草稿后选择保存报名回答；此操作会直接保存，不会再打开确认弹窗。再次编辑前先阅读保存结果。此处不能删除已分配科目；请管理员／负责人一并审核释放分配及答案更改。",
        ),
      },
      {
        title: t("Recall only when you mean to close it", "确需结束时才撤回"),
        body: t(
          "For an eligible unassigned request choose Recall, read permanent-closure consequences, wait for the two-second confirmation and confirm. Cancel leaves it open. Check the saved result rather than submitting again after a refresh warning.",
          "符合条件的未分配申请可选择撤回，阅读永久结束影响，等待两秒确认后提交。取消会保留申请。若刷新警告出现，请先检查保存结果，不要重复提交。",
        ),
      },
    ],
    expected: t(
      "The current request shows accepted answers, or the recalled request appears closed with its history retained.",
      "当前申请显示已接受答案，或撤回申请以已结束状态保留历史。",
    ),
    explanation: [
      t(
        "An eligible current open request can be edited after public intake closes. Editing preserves original priority, assignments, sessions and signed evidence and does not change canonical login identity. Recall permanently closes that request; applying later establishes a new priority.",
        "符合条件的当前未结申请可在公开招募结束后编辑。编辑保留原优先时间、分配、课次和签署证据，不改变登录身份。撤回永久结束该申请；之后重新申请会产生新优先时间。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The request changed while editing", "编辑时申请已改变"),
        solution: t(
          "Keep the draft, explicitly reload the current version and review before resubmitting. A normal read Retry does not replace the captured review version.",
          "保留草稿，明确重新加载当前版本并核对后再提交。普通读取重试不会替换已捕获的审核版本。",
        ),
      },
    ],
    related: ["withdraw-tutee", "appeal-invalid-request", "request-tutoring"],
    sources: [
      "src/app/_components/student-signup-editor.tsx",
      "src/server/api/routers/student-workflow.ts",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "read current closed requests",
      "edit owned signup",
      "edit availability",
      "assigned subject restrictions",
      "recall unmatched request",
      "priority preservation",
    ],
  },
  {
    slug: "withdraw-tutee",
    audience: "student",
    title: t("Request withdrawal from tutoring", "申请退出辅导"),
    summary: t(
      "Ask for reviewed withdrawal after assignment and follow the actual decision.",
      "分配后申请经审核退出，并查看实际决定。",
    ),
    route: "/student?view=requests",
    prerequisites: [
      t(
        "You have eligible current participation, including a staff-entered enrollment explicitly linked to your account.",
        "本人有符合条件的当前参与记录，包括明确关联账号的工作人员录入报名。",
      ),
    ],
    steps: [
      {
        title: t("Open Participation", "打开参与情况"),
        body: t(
          "In Requests → Participation choose Request withdrawal…. Check that the button names the correct current quarter or semester.",
          "在申请→参与情况中选择申请退出，检查按钮标明正确当前学季或学期。",
        ),
        screenshot: "student-requests",
        focus: t("Participation and Request withdrawal", "参与情况与申请退出"),
      },
      {
        title: t("Give the reason and review", "填写原因并检查"),
        body: t(
          "Enter your reason, review which participation ends, wait for the three-second confirmation and submit. Cancel or Escape before submission leaves participation unchanged.",
          "输入原因，核对将结束的参与范围，等待三秒确认后提交。提交前取消或按Escape不会改变参与。",
        ),
      },
      {
        title: t("Follow the decision", "查看决定"),
        body: t(
          "Check the pending request and later approval or decline. Assignment remains active while review is pending. If accepted submission cannot refresh, use the read-only retry.",
          "检查待审申请及之后批准或拒绝结果。审核期间分配仍有效。提交已接受但无法刷新时，使用只读重试。",
        ),
      },
    ],
    expected: t(
      "A reasoned withdrawal request is recorded; participation ends only after approval.",
      "记录有原因的退出申请；仅获批后结束参与。",
    ),
    explanation: [
      t(
        "Approved withdrawal ends participation and blocks another request in the current program period. A tutor schedule-conflict review is narrower: approved rejection releases only that tutor's assignment and retains matching priority.",
        "退出获批会结束参与，并阻止在当前时期再次申请。辅导伙伴的排课冲突审核范围更窄：批准解除只释放该分配，并保留匹配优先时间。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "You only want to change one subject or date",
          "只想更改一个科目或日期",
        ),
        solution: t(
          "Use the request editor, staff assignment review or dated rescheduling instead. Review the displayed scope before choosing whole-period withdrawal.",
          "请使用申请编辑、工作人员分配审核或日期改期。选择整个时期退出前，先核对页面显示范围。",
        ),
      },
    ],
    related: ["manage-tutee-request", "respond-session-plan"],
    sources: [
      "src/server/api/routers/student-workflow.ts",
      "src/app/student/student-workspace.tsx",
    ],
    covers: [
      "tutee withdrawal",
      "staff-entered withdrawal",
      "withdrawal reason timed confirmation",
      "withdrawal pending decision",
      "period resubmission block",
    ],
  },
  {
    slug: "appeal-invalid-request",
    audience: "student",
    title: t("Appeal an invalid tutoring request", "申诉被标为无效的辅导申请"),
    summary: t(
      "Read the reason, submit one explanation and distinguish its receipt from a decision.",
      "阅读原因、提交说明，并区分提交回执和处理决定。",
    ),
    route: "/student?view=requests",
    prerequisites: [
      t(
        "You own the flagged request and its appeal is still eligible in the active period.",
        "本人拥有被标记申请，且当前时期仍允许申诉。",
      ),
    ],
    steps: [
      {
        title: t("Read the invalidity notice", "阅读无效提示"),
        body: t(
          "Open Review a Flagged Request in Requests and check its appeal status. You can also use the private link in the notice for this request. Complete sign-in or verification if prompted.",
          "在“申请”中打开“审核被标记的申请”，查看申诉状态。也可以使用此申请通知中的私密链接。如有提示，请完成登录或验证。",
        ),
        screenshot: "student-requests",
        focus: t(
          "Invalid request reason and appeal action",
          "申请无效原因与申诉操作",
        ),
      },
      {
        title: t("Submit a reasoned appeal", "提交有依据的申诉"),
        body: t(
          "Choose the appeal action, explain why the flag should be reviewed and submit once. Keep the page open while sending; a saved receipt is not an accepted appeal decision.",
          "选择申诉，解释为何应复核该标记，并提交一次。发送期间保持页面打开；保存回执并不代表申诉已获支持。",
        ),
      },
      {
        title: t("Check the separate decision", "查看独立决定"),
        body: t(
          "Read Pending, Declined or Cleared. Acceptance clears the flag and preserves original priority. Final rejection closes the active request and ends that priority, while retaining evidence.",
          "查看待处理、拒绝或已清除状态。申诉获支持会清除标记并保留原优先时间；最终拒绝会结束当前申请及其优先时间，但保留证据。",
        ),
      },
    ],
    expected: t(
      "Your appeal has a recorded submission and a separately visible management decision.",
      "申诉提交被记录，并单独显示管理决定。",
    ),
    explanation: [
      t(
        "The request remains invalid and blocked during appeal. Appeals and resends do not extend fixed verification deadlines. Current signup appeals end at period rollover. Older request-specific appeal links have their own displayed validity and allow only their limited appeal action.",
        "申诉期间申请仍无效并被阻止处理。申诉或重发不会延长固定验证期限。当前报名申诉在时期切换时结束。旧版指定申请申诉链接按自身显示期限生效，且仅允许其有限申诉操作。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Appeal submitted but the flag remains",
          "已提交申诉但仍有标记",
        ),
        solution: t(
          "Read the decision separately; submission alone does not clear it. If refresh failed after sending, retry the read instead of submitting the appeal again.",
          "单独查看决定；仅提交不会清除标记。发送后刷新失败时，重试读取，不要重复提交申诉。",
        ),
      },
    ],
    related: ["manage-tutee-request", "tutee-feedback-appeals"],
    sources: [
      "src/app/tutee-signup/appeal/signup-appeal.tsx",
      "src/app/request-appeal/request-appeal-form.tsx",
      "src/server/api/routers/student-workflow.ts",
    ],
    covers: [
      "signup invalidity reason",
      "signup appeal",
      "appeal decision",
      "request-specific email appeal",
      "verification deadlines during appeal",
    ],
  },
  {
    slug: "appeal-signup-from-email",
    audience: "public",
    title: t(
      "Appeal an invalid signup from its email notice",
      "通过邮件通知申诉无效报名",
    ),
    summary: t(
      "Use your private request-specific link without needing a site login, and check the separate decision.",
      "无需网站登录，通过本人私密申请链接提交申诉，并查看独立决定。",
    ),
    route: "/request-appeal",
    requiresPrivateLink: true,
    prerequisites: [
      t(
        "Open the complete appeal link in the notice sent to the mailbox recorded on your request. This guide contains no usable appeal token; typing the page address alone cannot identify a request.",
        "从发送到申请所填邮箱的通知中，打开完整申诉链接。本指南不含可用申诉令牌；仅输入页面地址不能识别申请。",
      ),
    ],
    steps: [
      {
        title: t("Find your request's notice email", "找到本人的申请通知邮件"),
        body: t(
          "Open the invalid-signup notice in the mailbox used for the application. Choose Review and appeal or Appeal this decision, as shown in the notice. Use the complete private link. It opens the appeal page for that request.",
          "在提交申请时使用的邮箱中打开报名无效通知。按通知显示选择“查看并申诉”或“对此决定提出申诉”。使用完整私密链接打开这份申请的申诉页面。",
        ),
        screenshot: "signup",
        focus: t(
          "Request a Tutor is the originating public application shown here; the appeal itself opens from your private notice email",
          "图中申请辅导是原公开申请入口；申诉本身通过本人私密通知邮件打开",
        ),
      },
      {
        title: t("Check the available request status", "查看可用申请状态"),
        body: t(
          "Check whether the appeal form is available or the page shows a saved appeal status. An older request may also show its type and original submission time. The private link permits review of this request's appeal only.",
          "查看页面是否提供申诉表单，或是否显示已保存的申诉状态。较早的申请还可能显示类型及原提交时间。私密链接仅允许查看这份申请的申诉。",
        ),
      },
      {
        title: t("Submit one explanation", "提交一次说明"),
        body: t(
          "If the form is available, enter your explanation and choose Submit appeal. Follow the form's length requirement: the legacy page needs 10–2,000 characters; the signup-specific page accepts a non-empty reason up to 2,000. Wait for the receipt; you cannot replace an appeal already recorded for that flag.",
          "表单可用时，填写说明并选择提交申诉。遵循表单长度要求：旧版页面要求十至两千字符；指定报名页面接受不超过两千字符的非空原因。等待回执；针对该标记已记录的申诉不能被替换。",
        ),
      },
      {
        title: t("Read the decision separately", "单独阅读决定"),
        body: t(
          "Appeal submitted is a receipt. Read Pending, Declined/Cleared or Accepted/Rejected separately to learn the review outcome. The invalid flag remains effective during review. If an accepted submission cannot refresh, use its read-only Retry instead of submitting again.",
          "申诉已提交只是回执。应单独查看待处理、拒绝／清除或接受／拒绝状态，了解审核结果。审核期间无效标记仍有效。已接受提交后刷新失败时，使用只读重试，不要再次提交。",
        ),
      },
    ],
    expected: t(
      "The exact request has one recorded appeal and an independently visible review outcome.",
      "指定申请有一份已记录申诉，审核结果独立显示。",
    ),
    explanation: [
      t(
        "The private link authorizes only this limited request appeal and can work before account setup. Legacy request-appeal links expire 90 days after notice creation; signup-specific links also require the current eligible request/version and active period. Clearing or reflagging retires obsolete proof. Appeals and email resends do not extend verification deadlines.",
        "私密链接仅授权该有限申请申诉，可在账号设置前使用。旧版申请申诉链接在通知创建九十天后过期；指定报名链接还要求当前符合条件的申请、版本及有效时期。清除或重新标记会使旧凭证失效。申诉和重发邮件不会延长验证期限。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The link is invalid, expired or shows no form",
          "链接无效、过期或没有表单",
        ),
        solution: t(
          "Reopen the complete latest notice from your own mailbox; signup-specific proof may be removed from the address bar after opening, so a later copied bare address will not work. If it remains unavailable, contact the team privately. Existing receipts may be read-only; do not create a duplicate application to replace an appeal.",
          "从本人邮箱重新打开最新完整通知；指定报名凭证可能在打开后从地址栏移除，所以之后复制的单独地址无效。仍不可用时，私下联系团队。已有回执可能仅供阅读；不要创建重复申请来替代申诉。",
        ),
      },
    ],
    related: ["appeal-invalid-request", "request-tutoring", "report-problem"],
    sources: [
      "src/app/request-appeal/request-appeal-form.tsx",
      "src/app/tutee-signup/appeal/signup-appeal.tsx",
      "src/server/student-signup-appeals.ts",
      "src/server/api/routers/student-workflow.ts",
    ],
    covers: [
      "accountless signup appeal",
      "mailbox request-specific appeal link",
      "public tutor request appeal",
      "public tutee signup appeal",
      "legacy appeal expiry",
      "one appeal per invalid flag",
      "appeal receipt versus decision",
      "private proof link recovery",
    ],
  },
  {
    slug: "tutee-feedback-appeals",
    audience: "student",
    title: t(
      "Review attendance, give feedback and appeal a card",
      "查看出勤、反馈及纪律卡申诉",
    ),
    summary: t(
      "Use session records and your own support history, with visibility and deadlines explained.",
      "使用课次记录和本人支持历史，并了解可见范围及期限。",
    ),
    route: "/student?view=attendance",
    prerequisites: [
      t(
        "The session or disciplinary card belongs to an explicitly owned profile.",
        "课次或纪律卡属于本人明确拥有的档案。",
      ),
    ],
    steps: [
      {
        title: t("Open Attendance", "打开出勤"),
        body: t(
          "Read recorded sessions across intakes and select the relevant lesson for feedback. Check the visibility explanation before submitting: feedback is management-only by default, with optional sharing to that session's tutor.",
          "查看不同招募时期的课次，选择对应课次提交反馈。提交前检查可见范围：反馈默认仅管理团队可见，可选共享给该课辅导伙伴。",
        ),
        screenshot: "student-attendance",
        focus: t(
          "Recorded session and feedback visibility",
          "已记录课次与反馈可见范围",
        ),
      },
      {
        title: t("Submit your feedback", "提交反馈"),
        body: t(
          "Enter the requested feedback and save once. If visibility is being checked or unavailable, use its retry to verify the current setting rather than assuming an older setting applies.",
          "填写所需反馈并保存一次。可见范围正在检查或不可用时，使用其重试确认当前设置，不要假定旧设置仍适用。",
        ),
        screenshot: "student-feedback",
        focus: t(
          "Expanded Session Feedback rating, comment and save controls",
          "展开的课次反馈评分、评论及保存控件",
        ),
      },
      {
        title: t("Review and appeal your card", "查看并申诉本人的纪律卡"),
        body: t(
          "In Support, find your card and read its reason, displayed appeal deadline and status. Submit one reasoned appeal by the end of the fifth school day after its recorded issue date in the program time zone. Return to Support to check the decision.",
          "在“支持”中找到本人纪律卡，查看原因、页面显示的申诉期限及状态。须在项目时区下签发日期后的第五个上课日结束前，提交一次有依据的申诉。之后返回“支持”查看决定。",
        ),
        screenshot: "student-support",
        focus: t(
          "Your cards, appeal reason and status",
          "本人纪律卡、申诉原因和状态",
        ),
      },
    ],
    expected: t(
      "Feedback or appeal displays its saved state, with the relevant sharing rule or decision visible.",
      "反馈或申诉显示已保存状态，并能查看对应共享规则或决定。",
    ),
    explanation: [
      t(
        "Later feedback sharing changes also affect earlier feedback. Pending appeals do not invalidate cards. With discipline enabled, an unexcused absence creates a valid red card; three valid yellows contribute one effective red, and two effective reds can remove active participation automatically.",
        "后续反馈共享变更也影响以前的反馈。待处理申诉不会使纪律卡失效。启用纪律模块时，无故缺席生成有效红卡；三张有效黄卡折算一张有效红卡，两张有效红卡可自动结束有效参与。",
      ),
      t(
        "School holidays and make-up days follow staff's school calendar. An upheld appeal invalidates the card and recalculates standing under the existing restoration rules.",
        "假期及补课日按工作人员维护的校历计算。申诉获支持会使纪律卡失效，并按现有恢复规则重新计算状态。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Sending succeeded but records did not reload",
          "发送成功但记录未重新加载",
        ),
        solution: t(
          "Use Try again to read the saved record. Your draft remains while the page stays open; do not resubmit an accepted appeal. For wrong attendance ask management to correct the exact record.",
          "使用重试读取保存记录。页面打开期间保留草稿；不要重复提交已接受申诉。出勤错误请管理团队更正指定记录。",
        ),
      },
    ],
    related: [
      "appeal-invalid-request",
      "send-private-messages",
      "find-own-history",
    ],
    sources: [
      "src/app/_components/student-support.tsx",
      "src/app/student/student-workspace.tsx",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "student attendance history",
      "submit session feedback",
      "feedback sharing",
      "view own cards",
      "card appeal",
      "school-day deadline",
      "discipline effects",
    ],
  },
  {
    slug: "continue-quarter-pairings",
    audience: "student",
    title: t(
      "Continue eligible pairings into the next quarter",
      "将符合条件的配对延续到下一学季",
    ),
    summary: t(
      "Review prior choices during the limited continuation window and read each assignment outcome.",
      "在有限延续窗口内检查原配对，并查看每项分配结果。",
    ),
    route: "/student?view=requests",
    prerequisites: [
      t(
        "An official Q1→Q2 or Q3→Q4 refresh has occurred, quarter mode is active, and you are within one hour of destination tutee signup first opening.",
        "已正式进行Q1到Q2或Q3到Q4刷新、当前使用学季模式，且仍在目标学习伙伴报名首次开放后一小时内。",
      ),
    ],
    steps: [
      {
        title: t("Select owned previous pairings", "选择本人原配对"),
        body: t(
          "On Dashboard or Requests read the continuation deadline in program timezone. Select the prior tutor/subject pairings you want and choose Review selected pairings.",
          "在概览或申请中查看项目时区下的延续截止时间。选择希望保留的原辅导伙伴／科目配对，再选择检查已选配对。",
        ),
        screenshot: "student-requests",
        focus: t(
          "Eligible continuation choices and named deadline when offered",
          "出现时的可延续选择及明确截止时间",
        ),
      },
      {
        title: t("Review and sign", "核对并签名"),
        body: t(
          "Read tutors, subjects and inherited weekly times, then review the current policy, agree and sign. Your request may contain at most two distinct subjects, including subjects already requested this quarter. Choose Join selected pairings.",
          "核对辅导伙伴、科目和沿用的每周时间，再阅读当前政策、同意并签名。申请最多包含两个不同科目，包括本学季已申请科目。选择加入已选配对。",
        ),
      },
      {
        title: t("Read each saved result", "逐项查看保存结果"),
        body: t(
          "Assigned and Request filed; awaiting assignment are different outcomes and may be mixed. Check the dated calendar for actual meetings and rooms. If the result is uncertain choose Check request result before submitting again.",
          "已分配与申请已提交、等待分配是不同结果，也可能同时出现。实际课次与教室应查看日期课表。结果不明确时先选择检查申请结果，不要再次提交。",
        ),
      },
    ],
    expected: t(
      "The accepted choices are added to one current request with an explicit outcome for each pairing.",
      "接受的选择加入同一当前申请，每项配对都有明确结果。",
    ),
    explanation: [
      t(
        "Pausing/reopening intake does not restart the hour. Continuation is unavailable across semesters/years or in semester mode. Confirming a regular signup removes continuation choices. Ineligible assignments may remain filed for matching; original historical evidence is retained.",
        "暂停或重开招募不会重新开始一小时。跨学期、跨学年或学期模式不能延续。确认常规报名后延续选项消失。不符合分配条件的选择仍可能以申请形式等待匹配；原历史证据保留。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("No continuation choices appear", "没有延续选项"),
        solution: t(
          "Check the transition, deadline, explicit ownership and whether you confirmed a normal request. Use the regular form when recruitment is open; unknown first-opening history does not create an invented window.",
          "检查时期转换、截止时间、明确所有权及是否已确认普通申请。招募开放时可使用常规表单；首次开放历史未知时不会虚设窗口。",
        ),
      },
      {
        problem: t(
          "The panel asks to review required details",
          "面板提示检查必需信息",
        ),
        solution: t(
          "Choose Review required details. Check the required name, academic and contact information, and complete email verification if prompted. Contact the program team if information is missing from your prior record.",
          "选择“检查必需信息”，核对必需的姓名、学业及联系方式，如有提示请完成邮箱验证。如果原记录缺少信息，请联系项目团队。",
        ),
      },
    ],
    related: ["request-tutoring", "manage-tutee-request"],
    sources: [
      "src/app/student/legacy-continuation.tsx",
      "src/server/api/routers/student-workflow.ts",
      "src/server/student-continuation.ts",
    ],
    covers: [
      "quarter continuation",
      "select prior pairings",
      "continuation policy signature",
      "partial continuation assignment",
      "continuation result recovery",
    ],
  },
  {
    slug: "respond-session-plan",
    audience: "student",
    title: t(
      "Suggest or respond to a dated session change",
      "建议或回应具体课次变更",
    ),
    summary: t(
      "Agree on reschedules, extras and cancellations without changing weekly pairing groups.",
      "协商改期、加课和取消，同时保留每周配对组。",
    ),
    route: "/student?view=schedule",
    prerequisites: [
      t(
        "You are an affected tutee on a current dated session or proposal.",
        "本人属于当前日期课次或提议的受影响学习伙伴。",
      ),
    ],
    steps: [
      {
        title: t("Open the exact session", "打开具体课次"),
        body: t(
          "In My Tutors & Schedule choose the dated lesson and use its suggestion or response action. Message to coordinate helps discuss a time, but a message alone does not formally accept a change.",
          "在我的辅导伙伴与课表中选择具体日期课次，使用建议或回应操作。可先通过协调消息讨论时间，但消息本身不正式接受变更。",
        ),
        screenshot: "student-schedule",
        focus: t(
          "Dated session and pending proposal actions",
          "具体日期课次及待回应提议操作",
        ),
      },
      {
        title: t("Review scope, time and location", "核对范围、时间与地点"),
        body: t(
          "Read which tutees are affected, the original/proposed times and assigned room or Online. Accept a workable proposal. Rejecting a tutor's first single-tutee proposal requires an alternative; review the final-proposal consequence before responding.",
          "查看受影响学习伙伴、原时间与拟定时间，以及教室或线上安排。合适则接受。拒绝辅导伙伴首次单人提议时须提供替代时间；回应最终提议前应阅读其影响。",
        ),
      },
      {
        title: t("Handle a group or cancellation", "处理小组或取消申请"),
        body: t(
          "For an all-tutee proposal everyone must accept the same time. Each may reject once with an alternative; later conflicts use Separate reschedule. For an agreed extra's cancellation choose Accept cancellation or Decline cancellation; no alternative time is required.",
          "全组提议需要所有人接受同一时间。每人可拒绝一次并提供替代时间；之后仍冲突时使用单独改期。已约定加课的取消申请可接受或拒绝取消，不需要替代时间。",
        ),
      },
      {
        title: t("Check the authoritative outcome", "查看最终有效结果"),
        body: t(
          "After responding, check the session's agreed state and essential notice. A cancellation submission receipt does not cancel the lesson. Refresh failed views using the read-only retry.",
          "回应后检查课次约定状态和必需通知。取消申请提交回执并不代表课次已取消。刷新失败时使用只读重试。",
        ),
      },
    ],
    expected: t(
      "The portal records your response and shows whether the dated commitment actually changed.",
      "页面记录回应，并显示具体日期安排是否真正改变。",
    ),
    explanation: [
      t(
        "A valid 24-hour response window begins only after essential email is accepted by the mail server; failure blocks automatic acceptance. When a full window cannot fit before the earlier session start, explicit agreement is required or the proposal expires. Rejecting a final single-tutee reschedule cancels only that dated commitment; rejected extras leave the regular lesson intact.",
        "有效二十四小时回应窗口仅在邮件服务器接受必需邮件后开始；发送失败不会自动接受。若在较早课次开始前不足完整窗口，则需明确同意，否则提议过期。拒绝最终单人改期仅取消该日期安排；拒绝加课不会取消常规课。",
      ),
      t(
        "Declined or expired extra-cancellation requests preserve the lesson. Scheduling changes do not create attendance or absence records.",
        "加课取消申请被拒绝或过期时，课次保留。排课更改不会创建出勤或缺席记录。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Email failed or the request expired", "邮件失败或申请过期"),
        solution: t(
          "Check delivery/status and coordinate with the tutor. Do not assume silence moved a lesson; use the portal's confirmed schedule. The original remains unless a separate authoritative change cancels it.",
          "查看投递与状态，并与辅导伙伴协调。不要假定未回应就已改课；以页面确认课表为准。除其他有效变更取消外，原课仍保留。",
        ),
      },
    ],
    related: ["tutee-workspace", "send-private-messages"],
    sources: [
      "src/app/_components/session-plan-time.tsx",
      "src/app/_components/session-agenda.tsx",
      "src/server/api/routers/session-planning.ts",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "tutee schedule suggestion",
      "accept reschedule",
      "reject with alternative",
      "final reschedule",
      "group separate reschedule",
      "respond extra",
      "accept decline extra cancellation",
      "essential email response timing",
    ],
  },
  {
    slug: "start-tutoring",
    audience: "tutor",
    title: t(
      "Activate tutoring and find your next task",
      "激活辅导并查找下一项任务",
    ),
    summary: t(
      "Confirm current participation, read action states and use the unified tutor workspace.",
      "确认当前参与状态、查看任务状态，并使用统一辅导伙伴工作区。",
    ),
    route: "/dashboard",
    prerequisites: [
      t(
        "Your account has a linked tutor profile with tutoring access.",
        "账号有关联的辅导伙伴档案及辅导权限。",
      ),
    ],
    steps: [
      {
        title: t("Check activation and policy notices", "检查激活与政策提示"),
        body: t(
          "Open Enter Tutor Page. If Pending, confirm whether you will participate using the displayed choice and review. Read and accept any current tutor policy before participation actions.",
          "打开进入辅导伙伴页面。待确认时，通过页面选项和审核确认是否参与。进行参与操作前，阅读并接受当前辅导政策。",
        ),
        screenshot: "tutor-overview",
        focus: t(
          "Participation notice, Needs attention and workspace panels",
          "参与提示、待处理任务和工作区页签",
        ),
      },
      {
        title: t("Use the four task panels", "使用四个任务页签"),
        body: t(
          "Schedule holds dated tutoring, interviews and meetings. Pairings holds recurring assignments. Preferences holds availability, workload and subject choices. History & hours holds retained evidence. Switching these local panels retains visited editors during the visit.",
          "课表包含日期辅导、面试和会议；配对包含每周分配；偏好包含可用时间、期望课次数和科目选择；历史与时数包含保留证据。在本次访问中切换这些本地页签会保留已打开编辑器。",
        ),
      },
      {
        title: t("Follow Needs attention", "跟进待处理任务"),
        body: t(
          "Open the task for an unconfirmed schedule, missing attendance, interview vote or meeting. Needs Action requires your work; Vote recorded / Awaiting decision means your vote is saved while the interview is still open.",
          "打开待确认排课、缺少出勤、面试投票或会议任务。需要处理表示等待本人操作；已投票／等待决定表示投票已保存，但面试仍未结束。",
        ),
      },
    ],
    expected: t(
      "You know your active status and can open the exact task that needs your action.",
      "明确本人有效状态，并能打开需要本人处理的指定任务。",
    ),
    explanation: [
      t(
        "Inactive tutors retain read-only history but cannot edit pairings or submit attendance. An Admin badge alone is not a tutor identity. Both /dashboard and /schedule render the tutor workspace; legacy section links preserve their destination without discarding an open editor.",
        "非活跃辅导伙伴保留只读历史，但不能编辑配对或提交出勤。仅有管理员徽章不代表辅导身份。/dashboard与/schedule均显示辅导工作区；旧章节链接保留目标，不会丢弃已打开编辑器。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Tutoring controls are unavailable", "辅导控件不可用"),
        solution: t(
          "Check status, current policy, academic confirmation, suspension, school departure and revoked access with management. Approval of an application alone does not restore a separate access revocation.",
          "与管理团队检查状态、当前政策、学业确认、停用、离校及权限撤销。申请获批本身不会恢复单独被撤销的辅导权限。",
        ),
      },
    ],
    related: [
      "tutor-availability",
      "tutor-pairing-time",
      "record-attendance",
      "tutor-membership-hours",
    ],
    sources: [
      "src/app/(tutor)/dashboard/page.tsx",
      "src/app/(tutor)/_components/tutor-workspace.tsx",
      "src/app/(tutor)/_components/tutor-activation.tsx",
    ],
    covers: [
      "pending tutor activation",
      "tutor workspace panels",
      "needs attention",
      "inactive tutor history",
      "legacy dashboard fragments",
    ],
  },
  {
    slug: "tutor-availability",
    audience: "tutor",
    title: t(
      "Set time availability and preferred session count",
      "设置可用时间及期望课次数",
    ),
    summary: t(
      "Save weekly catalogue choices and a separate advisory workload preference.",
      "保存每周可用时间，并单独设置建议性的工作量偏好。",
    ),
    route: "/dashboard#tutor-preferences",
    prerequisites: [
      t(
        "You are an active tutor with current participation requirements satisfied.",
        "本人为有效辅导伙伴，且符合当前参与要求。",
      ),
    ],
    steps: [
      {
        title: t("Edit My Time Availability", "编辑我的可用时间"),
        body: t(
          "Open Preferences → My Availability → Edit My Time Availability. Select the catalogue weekday/time slots you can teach and choose Save Availability. Cancel restores the last loaded time selection.",
          "打开偏好→我的可用时间→编辑我的可用时间。选择可授课的目录星期及时间段，再选择保存可用时间。取消会恢复上次读取的选择。",
        ),
        screenshot: "tutor-availability",
        focus: t(
          "Weekday time choices and Save Availability",
          "星期时间选择与保存可用时间",
        ),
      },
      {
        title: t("Save Preferred Sessions separately", "单独保存期望课次数"),
        body: t(
          "Under the time choices choose one of 0–4, or clear the preference, then use its own Save. Zero means prefer no assignments; an unset preference is different. Saving availability does not save this separate draft.",
          "在时间选择下方选择零至四，或清空偏好，再使用该区域的保存。零表示希望不分配课程；未设置是另一种状态。保存时间不会保存此独立草稿。",
        ),
      },
      {
        title: t("Check the saved workload context", "查看保存后的工作量信息"),
        body: t(
          "Compare assigned session-block count with the saved preference. Group changes refresh this count without replacing an unsaved preference. After an accepted save with failed synchronization use Retry refresh.",
          "比较已分配教学块数量与已保存偏好。配对组改变会刷新数量，但不替换未保存偏好。保存已接受但同步失败时，使用重试刷新。",
        ),
      },
    ],
    expected: t(
      "Saved availability and preferred workload each show their own accepted values.",
      "可用时间和期望工作量分别显示各自已接受值。",
    ),
    explanation: [
      t(
        "The preference is advisory: staff may assign above it and lowering it does not cancel an assignment. Becoming inactive resets it to locked zero; reactivation keeps zero until changed. A valid combined group counts as one block, while matching times alone do not combine assignments.",
        "偏好仅供参考：工作人员仍可超出偏好分配，降低偏好不会取消分配。变为非活跃会重置并锁定为零；恢复活跃后需自行修改。有效配对组计为一个教学块，仅时间相同不会合并分配。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Saved values changed elsewhere", "保存值已在其他地方更改"),
        solution: t(
          "Use Reload saved preference to deliberately replace only that stale draft. Failed saves retain your selection; read-only Retry refresh recovers a successful save without submitting again.",
          "使用重新加载已存偏好，明确仅替换该过时草稿。保存失败保留选择；只读重试刷新恢复已成功保存结果，不会再次提交。",
        ),
      },
    ],
    related: ["tutor-pairing-time", "combine-split-pairings"],
    sources: [
      "src/app/(tutor)/_components/availability-editor.tsx",
      "src/app/_components/tutor-workload-preference.tsx",
    ],
    covers: [
      "save tutor availability",
      "cancel availability",
      "preferred sessions",
      "clear workload preference",
      "workload count",
      "preference recovery",
    ],
  },
  {
    slug: "tutor-subject-qualifications",
    audience: "tutor",
    title: t(
      "Set subject willingness and request qualifications",
      "设置科目意愿并申请资质",
    ),
    summary: t(
      "Separate approved qualification, willingness and a pending additional-subject request.",
      "区分已获批资质、辅导意愿和待审新增科目申请。",
    ),
    route: "/dashboard#tutor-preferences",
    prerequisites: [
      t(
        "Active tutors can change willingness or make eligible qualification requests; inactive tutors retain read-only history.",
        "有效辅导伙伴可修改意愿或提交符合条件的资质申请；非活跃辅导伙伴保留只读历史。",
      ),
    ],
    steps: [
      {
        title: t(
          "Edit willingness for approved subjects",
          "编辑已获批科目意愿",
        ),
        body: t(
          "Open My Subject Willingness → Edit willingness. Choose Willing to Tutor or Unwilling to Tutor for each offered approved subject. Each choice saves immediately; check the result before continuing. Not recorded means no choice was saved.",
          "打开我的科目意愿→编辑意愿。对已批准开放科目选择愿意辅导或不愿辅导。每次选择立即保存；继续前检查结果。未记录表示尚未保存选择。",
        ),
        screenshot: "tutor-preferences",
        focus: t(
          "Subject Willingness and Subject Qualifications",
          "科目意愿与科目资质",
        ),
      },
      {
        title: t(
          "Request a new subject or higher level",
          "申请新科目或更高等级",
        ),
        body: t(
          "In Subject Qualifications choose the subject/level, explain your qualifications and submit. Under Your Requests use Pending, Approved, Rejected or Recalled filters and expand history to read decision notes and granted subjects.",
          "在科目资质中选择科目／等级，说明资质并提交。在你的申请中使用待处理、已批准、已拒绝或已撤回筛选，并展开历史查看决定说明及已授予科目。",
        ),
      },
      {
        title: t(
          "Recall an eligible pending request",
          "撤回符合条件的待审申请",
        ),
        body: t(
          "Choose Recall request while Pending or Interview, review the named subject and confirm. A recalled request cannot be reopened or approved; submit a fresh request later when ready.",
          "在待处理或面试阶段选择撤回申请，核对具体科目后确认。已撤回申请不能重开或获批；准备好后需重新提交。",
        ),
      },
    ],
    expected: t(
      "Current willingness is saved independently and request history shows its actual decision stage.",
      "当前意愿独立保存，申请历史显示实际决定阶段。",
    ),
    explanation: [
      t(
        "Pending, rejected or recalled requests do not change existing qualifications. Admin/Head may approve directly with a decision note or assign an interview; interview rejection requires the authorized chair and votes. Approval captures lower offered levels at that time; later catalogue reordering does not change saved grants.",
        "待审、被拒或撤回申请不会改变现有资质。管理员／负责人可附决定说明直接批准或安排面试；面试拒绝需要获授权主席及投票。批准会记录当时开放的较低等级，之后目录重排不会改变已存授权。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A subject does not appear or duplicate request is blocked",
          "科目未显示或重复申请被阻止",
        ),
        solution: t(
          "Only saved approved qualifications appear in willingness. Review existing pending requests for that subject/level before submitting again. Ask management about missing catalogue or qualification evidence.",
          "意愿中仅显示已有批准资质。再次提交前，检查相同科目／等级现有待审申请。目录或资质证据缺失时联系管理团队。",
        ),
      },
    ],
    related: ["tutor-interviews", "tutor-availability"],
    sources: [
      "src/app/(tutor)/_components/subject-willingness.tsx",
      "src/app/(tutor)/_components/qualification-requests.tsx",
      "src/server/api/routers/qualification-application.ts",
    ],
    covers: [
      "subject willingness",
      "additional qualification request",
      "higher-level request",
      "qualification history filters",
      "recall qualification",
      "qualification versus willingness",
    ],
  },
  {
    slug: "tutor-pairing-time",
    audience: "tutor",
    title: t(
      "Read your pairing and choose a weekly time",
      "查看配对并选择每周时间",
    ),
    summary: t(
      "Use shared availability advice and confirm a schedule without double-booking.",
      "参考共同可用时间，确认课表并避免重复预约。",
    ),
    route: "/dashboard#tutor-pairings",
    prerequisites: [
      t(
        "You are active and own a current populated assignment.",
        "本人处于活跃状态，且拥有当前含学习伙伴的分配。",
      ),
    ],
    steps: [
      {
        title: t("Inspect My Pairings", "检查我的配对"),
        body: t(
          "Open Pairings. Read each group's subjects, weekly time, room status and distinct tutees. Choose Details beside a tutee to inspect saved availability, verification deadline and pending reviews.",
          "打开配对，查看每组科目、每周时间、教室状态及不同学习伙伴。选择学习伙伴旁的详情，查看已存可用时间、验证期限及待审事项。",
        ),
        screenshot: "tutor-pairings",
        focus: t(
          "Pairing schedule selector before the tutee list and Details",
          "学习伙伴列表之前的配对时间选择器与详情",
        ),
      },
      {
        title: t("Compare the time groups", "比较时间分组"),
        body: t(
          "Use the default time selector. Both Available requires the same saved catalogue slot for you and every current tutee; Other Time Slots lacks that shared evidence. Unavailable choices are disabled when they overlap another teaching block.",
          "使用默认时间选择器。双方可用要求本人及所有当前学习伙伴保存相同目录时间段；其他时间段缺少该共同证据。与其他教学块重叠的不可用选项会被禁用。",
        ),
      },
      {
        title: t("Review and save the time", "核对并保存时间"),
        body: t(
          "Discuss the time, select the intended slot and confirm the named review. A combined group shares one time, so changing a member's default changes the whole group. Check the room result and dated calendar afterward.",
          "讨论时间后选择所需时段，并确认具体审核。配对组共享时间，修改一个成员默认时间会改变整组。之后检查教室结果及日期课表。",
        ),
      },
      {
        title: t("Report an actual schedule conflict", "报告实际排课冲突"),
        body: t(
          "In tutee Details use the schedule-conflict request, provide a reason and complete its two-second review. The assignment stays active until approval. Missing saved availability alone does not establish a conflict.",
          "在学习伙伴详情中使用排课冲突申请，提供原因并完成两秒审核。获批前分配仍有效。仅缺少已存可用时间并不能证明冲突。",
        ),
      },
    ],
    expected: t(
      "The pairing shows its confirmed shared time or a pending reasoned conflict request.",
      "配对显示已确认共享时间，或有理由的待审冲突申请。",
    ),
    explanation: [
      t(
        "Clock overlap is not enough to establish a shared catalogue choice. Back-to-back sessions are allowed; separate overlapping assignments conflict. Awaiting schedule reserves no time. Tutors can trigger automatic room assignment but do not choose a staff-fixed room.",
        "时钟区间重叠不等于相同目录选择。首尾相接课次允许，独立分配重叠会冲突。等待排课不占用时间。辅导伙伴可触发自动教室分配，但不能选择工作人员固定教室。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "No room or no shared slot is available",
          "无可用教室或共同时间段",
        ),
        solution: t(
          "Review each person's saved catalogue availability and actual booking conflicts. Needs room means the schedule lacks a reservation; ask management to review capacity. Never assume automatic assignment silently changed to Online.",
          "检查每人已存目录时间及实际预约冲突。需要教室表示课表没有教室预订，请管理团队检查容量。不要假定自动分配失败后已转为线上。",
        ),
      },
    ],
    related: [
      "combine-split-pairings",
      "plan-dated-session",
      "tutor-membership-hours",
    ],
    sources: [
      "src/app/(tutor)/_components/tutor-pairings.tsx",
      "src/app/(tutor)/_components/pairing-tutee-details.tsx",
    ],
    covers: [
      "view tutee pairing details",
      "choose recurring time",
      "both available ranking",
      "schedule conflict request",
      "shared group time",
      "room status",
    ],
  },
  {
    slug: "combine-split-pairings",
    audience: "tutor",
    title: t(
      "Combine, repair or split recurring pairings",
      "合并、修复或拆分每周配对",
    ),
    summary: t(
      "Create a reusable shared teaching block while retaining individual subject assignments and history.",
      "建立可复用共享教学块，同时保留各科目分配及历史。",
    ),
    route: "/dashboard#tutor-pairings",
    prerequisites: [
      t(
        "You are active and own two to six eligible current populated assignments with complete student–subject coverage.",
        "本人处于活跃状态，拥有二至六个符合条件的当前分配，并具有完整学习伙伴与科目覆盖。",
      ),
    ],
    steps: [
      {
        title: t("Select groups to combine", "选择要合并的配对组"),
        body: t(
          "Every pairing starts as its own group in My Pairings. Choose Combine groups, select two or more populated groups, and choose Combine selected. Every student in the combined group must already have every selected subject; combining never creates a missing assignment.",
          "在我的配对中，每个配对默认独立为一组。点击合并配对组，勾选两个或更多含学习伙伴的组，然后选择合并所选。组内每位学习伙伴必须已拥有每个所选科目；合并不会创建缺失分配。",
        ),
        screenshot: "tutor-pairings",
        focus: t(
          "Unified pairing group cards with inline combine selection and split controls",
          "统一的配对组卡片及行内合并勾选与拆分操作",
        ),
      },
      {
        title: t(
          "Choose the primary member and shared schedule",
          "选择主配对及共享时间",
        ),
        body: t(
          "In the Combine Pairing Groups dialog choose the primary member, then leave the group Awaiting schedule or choose one shared catalogue slot. Review students, subjects, time and room consequences before saving.",
          "在合并配对组对话框中选择主配对，可保持等待排课或选择一个共享目录时段。保存前核对学生、科目、时间及教室影响。",
        ),
        screenshot: "tutor-grouping",
        focus: t(
          "Primary member and shared schedule in the group action dialog",
          "配对组对话框中的主配对及共享时间",
        ),
      },
      {
        title: t("Repair or split deliberately", "明确修复或拆分"),
        body: t(
          "Choose Split this group or Repair or split directly on a combined group card. Two-assignment groups dissolve into separate single-assignment groups; larger groups can split completely or keep two to six valid assignments together (retaining an unpublished confirmed interval only when membership is unchanged). Leaving assignments keep their students/subjects/room but return to Awaiting schedule until separately scheduled.",
          "在已合并配对组卡片上直接选择拆分此组或修复或拆分。双配对组可直接拆分为独立组；更大的组可全部拆分或保留二至六个有效配对（仅成员不变时可保留未发布的已确认时段）。退出组的分配保留学生、科目和教室，但返回等待排课，需另行安排。",
        ),
      },
    ],
    expected: t(
      "My Pairings shows a valid shared block, repaired group or separately unscheduled assignments.",
      "我的配对显示有效共享教学块、修复后组或分别等待排课的分配。",
    ),
    explanation: [
      t(
        "A–Chemistry and B–Chemistry can combine; mixing Chemistry and Mathematics for both students needs all four student–subject relationships. A saved valid group counts as one workload block. Group changes affect future plans, preserving past attendance, ratings and credit; Needs repair groups must be repaired or split before combined scheduling/attendance.",
        "A化学与B化学可合并；若两名学生同时组合化学和数学，则必须已有四种学生科目关系。有效组计为一个工作量教学块。组变更影响未来计划，保留过去出勤、评分及学分；需要修复的组必须先修复或拆分，才能进行组合排课和出勤。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Save rejects coverage, time or room",
          "保存因覆盖、时间或教室被拒",
        ),
        solution: t(
          "Use Back to correct the selection. A fixed-room or overlapping independent-block conflict cannot be silently overridden. If saved groups changed, Reload saved groups explicitly replaces the draft after a successful read; a saved-result Retry only refreshes.",
          "使用返回修正选择。不能静默覆盖固定教室或独立教学块冲突。已存组改变时，成功读取后明确重新加载已存组以替换草稿；已存结果的重试仅刷新。",
        ),
      },
    ],
    related: ["tutor-pairing-time", "record-attendance"],
    sources: [
      "src/app/(tutor)/_components/pairing-group-editor.tsx",
      "src/server/api/routers/pairing-groups.ts",
    ],
    covers: [
      "combine pairings",
      "primary group member",
      "complete subject coverage",
      "group shared time",
      "repair group",
      "split group",
      "untick member",
      "group draft recovery",
    ],
  },
  {
    slug: "record-attendance",
    audience: "tutor",
    title: t(
      "Record attendance for an ended tutoring session",
      "为已结束辅导课记录出勤",
    ),
    summary: t(
      "Open the exact dated lesson and record what actually happened once.",
      "打开具体日期课次，如实记录实际情况并提交一次。",
    ),
    route: "/dashboard#sessions",
    prerequisites: [
      t(
        "You are active, have current tutor-policy acceptance and the lesson has ended without a saved attendance entry.",
        "本人处于活跃状态并已接受当前辅导政策；课次已结束且尚未记录出勤。",
      ),
    ],
    steps: [
      {
        title: t("Choose the ended lesson", "选择已结束课次"),
        body: t(
          "In Schedule → Needs attendance open Record attendance on the exact lesson. Check its captured subjects and tutees, including separately rescheduled participants. Do not use another lesson to record missing history.",
          "在课表→待记录出勤中，打开具体课次的记录出勤。核对捕获的科目和学习伙伴，包括单独改期人员。不要借其他课次补录缺失历史。",
        ),
        screenshot: "tutor-schedule",
        focus: t(
          "Ended lesson marked Needs attendance",
          "标记待记录出勤的已结束课次",
        ),
      },
      {
        title: t("Record actual time and location", "记录实际时间与地点"),
        body: t(
          "Confirm actual start/end and room or Online; planned lessons use 45 minutes but attendance records the duration that actually occurred. Read any room-conflict warning; a truthful historical report does not reserve a future conflicting room.",
          "确认实际起止时间、教室或线上。计划课次为四十五分钟，但出勤记录实际时长。阅读任何教室冲突提示；如实历史记录不会预订未来冲突教室。",
        ),
        screenshot: "tutor-attendance",
        focus: t(
          "Actual times, location and attendance rows",
          "实际时间、地点及出勤行",
        ),
      },
      {
        title: t("Complete every attendance row", "填写每人的出勤"),
        body: t(
          "Record your attendance and every student's actual attendance. Supply required absence/excuse reasons, comments, session ratings and reasons for requested disciplinary cards. Combined lessons count distinct students once and retain captured subjects.",
          "填写本人及每位学生实际出勤。提供所需缺席或请假原因、评论、课次评分及纪律卡申请原因。组合课次中不同学生各计一次，并保留捕获科目。",
        ),
      },
      {
        title: t("Submit and check the receipt", "提交并查看回执"),
        body: t(
          "Submit once and read the saved receipt. The accepted entry is locked; Submit Another starts a new entry. If totals fail to refresh use Retry refresh. Ask management for corrections to a saved or unplanned historical lesson.",
          "提交一次并查看保存回执。已接受记录会锁定；再次提交入口用于新记录。总数刷新失败时使用重试刷新。已存记录或未计划历史课次的更正需联系管理团队。",
        ),
      },
    ],
    expected: t(
      "One attendance record and its calculated consequences are saved for the exact lesson.",
      "指定课次保存一条出勤记录及其计算结果。",
    ),
    explanation: [
      t(
        "An identical retry does not award another credit; changed answers after saving require correction. Moving the time cannot create duplicate attendance. Adjacent non-overlapping sessions remain valid. Extra/rescheduled labels come from the schedule rather than an attendance checkbox.",
        "相同重试不会再次计时；保存后修改答案需更正流程。移动时间不能创建重复出勤。相邻不重叠课次允许分别记录。加课或改期标签来自课表，而非出勤复选框。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A draft is open for a different lesson",
          "另一课次已有草稿",
        ),
        solution: t(
          "Resume or explicitly discard it before switching. Closing the form retains its draft during this visit. For uncertain submission inspect the saved result before retrying.",
          "切换前继续原草稿或明确放弃。关闭表单会在本次访问保留草稿。提交结果不明确时，先查看保存结果再重试。",
        ),
      },
    ],
    related: [
      "plan-dated-session",
      "combine-split-pairings",
      "tutor-membership-hours",
    ],
    sources: [
      "src/app/(tutor)/_components/attendance-form.tsx",
      "src/app/_components/session-agenda.tsx",
      "src/app/(tutor)/_components/tutor-schedule.tsx",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "dated attendance",
      "actual time location",
      "tutor student attendance",
      "absence reasons",
      "ratings comments",
      "disciplinary card request",
      "attendance receipt",
      "submit another",
      "duplicate attendance prevention",
    ],
  },
  {
    slug: "plan-dated-session",
    audience: "tutor",
    title: t("Reschedule a session or add an extra lesson", "改期或新增加课"),
    summary: t(
      "Review exact participants, time and room before sending an agreement proposal.",
      "发送协商提议前，核对具体人员、时间及教室。",
    ),
    route: "/dashboard#sessions",
    prerequisites: [
      t(
        "You own an eligible current pairing and the affected session can still be planned.",
        "本人拥有符合条件的当前配对，且相关课次仍可安排。",
      ),
    ],
    steps: [
      {
        title: t("Open the session action", "打开课次操作"),
        body: t(
          "In Schedule choose Reschedule Session or Add Extra Session. For a regular lesson paused by a no-tutoring notice, choose Arrange exception to propose an explicitly agreed dated exception for the affected learners. Use Message to coordinate first when useful; chat does not formally accept a schedule change.",
          "在课表中选择改期或新增加课。常规课因无辅导通知而暂停时，可选择安排例外辅导，为受影响学习伙伴提议需明确约定的日期例外。必要时先发送协调消息；聊天不等于正式接受课表变更。",
        ),
        screenshot: "tutor-schedule",
        focus: t(
          "Session action menu and dated event",
          "课次操作菜单与具体日期事件",
        ),
      },
      {
        title: t("Choose scope, time and mode", "选择范围、时间与方式"),
        body: t(
          "Keep Include all tutees in this session checked, or uncheck it and choose one person. Choose In person — room assigned automatically or Online. Editing start/end retains the planned 45-minute duration.",
          "可保留包含本课所有学习伙伴，或取消勾选后选一人。选择线下自动分配教室或线上。修改起止时间时，计划时长仍保持四十五分钟。",
        ),
        screenshot: "tutor-session-plan",
        focus: t(
          "Proposal editor with included tutees, date/time and In person or Online",
          "提议编辑器中的学习伙伴范围、日期时间及线下或线上方式",
        ),
      },
      {
        title: t("Review availability and room", "检查可用情况和教室"),
        body: t(
          "Choose Review and read the assigned room before sending. Review reserves nothing; if that room becomes unavailable, edit and review again. The system does not silently change the reviewed room or switch to Online.",
          "选择检查，并在发送前查看分配教室。检查不会预订；教室变为不可用时须编辑后重新检查。系统不会静默更换已审核教室或转为线上。",
        ),
      },
      {
        title: t("Send and follow agreement", "发送并跟进同意情况"),
        body: t(
          "Send the reviewed proposal and inspect essential-email delivery and each response. Use this suggestion can formalize an exact current tutee suggestion. For one tutee, accept their alternative or reject with one final proposal. If a group shows Separate rescheduling requested, choose Start individual requests and review/confirm the affected participants; then follow each individual request. The group timer stops while separate rescheduling is requested, and the weekly pairing group remains intact.",
          "发送核对后的提议，并检查必需邮件投递及各人回应。使用此建议可将完全一致的当前学习伙伴建议正式化。单人改期可接受其替代时间，或拒绝并提供一次最终提议。小组显示已申请单独改期时，选择开始个人申请，核对并确认受影响人员，再分别跟进各人申请。申请单独改期期间小组倒计时停止，每周配对组仍保留。",
        ),
      },
    ],
    expected: t(
      "The dated calendar shows the proposal and then its authoritative agreed, expired or cancelled result.",
      "日期课表先显示提议，再显示最终有效的已约定、过期或取消结果。",
    ),
    explanation: [
      t(
        "Rescheduling changes a dated commitment; extras leave the regular lesson intact. The 24-hour automatic-acceptance window begins only after essential email transport accepts the notice. Short windows require explicit agreement before the earlier start; delayed reconciliation after a session starts requires review rather than a retroactive move.",
        "改期改变具体日期安排；加课保留常规课。二十四小时自动接受窗口仅在邮件传输接受必需通知后开始。短窗口需在较早开始前明确同意；课次开始后才处理的延迟情况需审核，不会追溯改课。",
      ),
      t(
        "Add Extra Session opens a source picker showing the actual weekly pairing slot; choose Choose session to continue. Eligible paused sources offer Arrange exception there. Fully paused or cancelled commitments leave Upcoming; use All or History to inspect their retained cancellation evidence. These controls do not change your private calendar subscription settings.",
        "添加额外辅导会打开来源选择器，显示实际每周配对时段；点击选择辅导继续。符合条件的暂停来源会在此提供安排例外辅导。完全暂停或取消的约定不再显示于近期；可在全部或历史中检查保留的取消证据。这些控件不会改变私密日历订阅设置。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Mail failed or no response window fits",
          "邮件失败或回应窗口不足",
        ),
        solution: t(
          "Inspect delivery status and retry eligible delivery, then check the confirmed portal result. Do not treat silence as acceptance without a valid window. Expiry preserves the original unless another authoritative change cancels it.",
          "检查投递状态并重试符合条件的投递，再查看页面确认结果。没有有效窗口时不要将沉默视为接受。除其他有效变更取消外，过期会保留原课。",
        ),
      },
    ],
    related: [
      "cancel-extra-session",
      "respond-session-plan",
      "session-calendar",
    ],
    sources: [
      "src/app/_components/session-plan-time.tsx",
      "src/app/_components/session-agenda.tsx",
      "src/server/api/routers/session-planning.ts",
      "src/app/(tutor)/_components/student-schedule-action.tsx",
    ],
    covers: [
      "reschedule tutor session",
      "add extra",
      "all or one tutee",
      "online or automatic room",
      "review room",
      "formalize suggestion",
      "respond alternative",
      "final proposal",
      "essential delivery",
      "Arrange exception",
      "Start individual requests",
      "formalize separate rescheduling",
    ],
  },
  {
    slug: "cancel-extra-session",
    audience: "tutor",
    title: t(
      "Request cancellation of an agreed extra lesson",
      "申请取消已约定加课",
    ),
    summary: t(
      "Review exactly which dated commitments are affected and wait for agreement.",
      "核对受影响的具体日期安排，并等待同意。",
    ),
    route: "/dashboard#sessions",
    prerequisites: [
      t(
        "The extra is agreed, has not started and has no recorded attendance.",
        "加课已约定、尚未开始且未记录出勤。",
      ),
    ],
    steps: [
      {
        title: t("Find the agreed extra", "找到已约定加课"),
        body: t(
          "In Schedule open the extra's card and choose Cancel Extra Session. Use All to find extras beyond the two-week Upcoming window, including a moved extra.",
          "在课表打开加课卡并选择取消加课。可用全部查找两周即将发生窗口之外的加课，包括已改期加课。",
        ),
        screenshot: "tutor-schedule",
        focus: t(
          "Agreed Extra card and Cancel Extra Session",
          "已约定加课卡与取消加课",
        ),
      },
      {
        title: t("Review the participants", "核对参与者"),
        body: t(
          "Include all current tutees or choose one, then review the exact date, time and people. Close or Cancel before submission sends nothing. Send only the reviewed cancellation request.",
          "选择所有当前学习伙伴或一人，然后核对具体日期、时间及人员。提交前关闭或取消不会发送任何内容。只发送核对后的取消申请。",
        ),
      },
      {
        title: t("Check agreement and the result", "检查同意情况与结果"),
        body: t(
          "Each included tutee can Accept cancellation or Decline cancellation. The extra remains scheduled until agreement under essential-email response rules. Check the saved request separately from actual cancellation.",
          "每位包含的学习伙伴可接受或拒绝取消。按必需邮件回应规则达成同意前，加课仍在课表中。应区分申请保存与真正取消。",
        ),
      },
    ],
    expected: t(
      "Only the selected dated extra commitments are cancelled after the required agreement.",
      "所需同意达成后，仅取消选定日期的加课安排。",
    ),
    explanation: [
      t(
        "A decline or expiry preserves the lesson. This request has no alternative-time or separate-reschedule step. It preserves peers, weekly pairing groups and ordinary lessons.",
        "拒绝或过期会保留课次。此申请没有替代时间或单独改期步骤，并保留其他成员、每周配对组及常规课。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The action is missing or refresh failed",
          "操作缺失或刷新失败",
        ),
        solution: t(
          "Check the extra is agreed/upcoming and has no attendance. After a saved request, use read-only refresh rather than sending another cancellation. For a lesson that already happened, ask management about attendance correction.",
          "检查加课已约定、尚未开始且无出勤。申请保存后用只读刷新，不要重复发送取消。已发生课次请管理团队审核出勤更正。",
        ),
      },
    ],
    related: ["plan-dated-session", "record-attendance"],
    sources: [
      "src/server/api/routers/session-planning.ts",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "cancel agreed extra",
      "cancel selected tutee extra",
      "find extra all scope",
      "extra cancellation agreement",
      "declined expired cancellation",
    ],
  },
  {
    slug: "session-calendar",
    audience: "account",
    title: t(
      "Subscribe to confirmed sessions in your calendar",
      "在个人日历订阅已确认课次",
    ),
    summary: t(
      "Use the private subscription link and rotate or revoke it when needed.",
      "使用私密订阅链接，并按需更换或撤销。",
    ),
    route: "/student?view=schedule",
    prerequisites: [
      t(
        "Your tutor or tutee Sessions workspace offers calendar subscription.",
        "辅导伙伴或学习伙伴课次页面提供日历订阅。",
      ),
    ],
    steps: [
      {
        title: t("Open your session calendar controls", "打开课次日历控件"),
        body: t(
          "Open My Tutors & Schedule in the tutee workspace, or Schedule at /dashboard#sessions for tutors. Choose Calendar subscription and read the private-link guidance and current availability.",
          "学习伙伴打开我的辅导伙伴与课表，辅导伙伴打开/dashboard#sessions的课表。选择日历订阅，并阅读私密链接说明及当前可用状态。",
        ),
        screenshot: "student-schedule",
        focus: t(
          "Calendar subscription controls when available",
          "可用时的日历订阅控件",
        ),
      },
      {
        title: t("Create and copy the private link", "创建并复制私密链接"),
        body: t(
          "Choose Create private link, review that creating a link revokes previous links, then confirm Create private link. Copy the displayed Private subscription link into your calendar app before closing this dialog. The URL is shown only for this opening; opening the dialog later does not reveal it again.",
          "选择创建私密链接，阅读创建会撤销旧链接的提示，再确认创建私密链接。关闭弹窗前，将显示的私密订阅链接复制到日历应用。网址仅在本次打开期间显示，之后重新打开不会再次显示。",
        ),
      },
      {
        title: t("Check the confirmed appointments", "核对已确认约会"),
        body: t(
          "Use the website as the authoritative view for agreed session time and room. Pending proposals and chat messages are not confirmed appointments.",
          "以网站中已约定课次时间和教室为最终依据。待处理提议与聊天消息不属于已确认约会。",
        ),
      },
      {
        title: t("Rotate or revoke a shared link", "更换或撤销已分享链接"),
        body: t(
          "If the link was lost or exposed, choose Replace private link, review and confirm, then copy the new URL and update your calendar. Every previous link stops updating. Choose Revoke private link and confirm to stop subscriptions without changing sessions. Keep all subscription URLs out of public reports.",
          "链接丢失或泄露时，选择替换私密链接，检查并确认，再复制新网址并更新个人日历。全部旧链接停止更新。选择撤销私密链接并确认，可停止订阅而不改变课次。请勿在公开报告中包含订阅网址。",
        ),
      },
    ],
    expected: t(
      "Your calendar subscribes using a current private link, or an old link has been revoked.",
      "个人日历使用当前私密链接订阅，或旧链接已撤销。",
    ),
    explanation: [
      t(
        "Calendar applications refresh on their own schedule and can lag behind the portal. The link is a private capability, so anyone holding it may retrieve the calendar it authorizes.",
        "日历应用按自身周期刷新，可能滞后于网站。该链接是一种私密访问凭证，持有人可能读取其授权日历。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The calendar still shows an old time", "日历仍显示旧时间"),
        solution: t(
          "Confirm the portal's final agreed result, then refresh the subscription in your calendar application. Check that you replaced a rotated link rather than importing an old static copy.",
          "先确认网站最终约定结果，再在日历应用刷新订阅。检查已替换更换后的链接，而非导入旧静态副本。",
        ),
      },
    ],
    related: ["plan-dated-session", "respond-session-plan"],
    sources: [
      "src/app/_components/session-calendar-subscription.tsx",
      "src/app/_components/session-agenda.tsx",
      "src/app/api/session-calendar/[token]/route.ts",
    ],
    covers: [
      "calendar subscription",
      "create calendar link",
      "confirm calendar creation",
      "copy private calendar link",
      "one-time calendar URL display",
      "rotate calendar token",
      "revoke calendar token",
      "calendar refresh lag",
    ],
  },
  {
    slug: "tutor-interviews",
    audience: "tutor",
    title: t(
      "Vote on an interview or complete chair duties",
      "进行面试投票或履行主席职责",
    ),
    summary: t(
      "Review the application, submit your vote and distinguish a decision from recorded hours.",
      "检查申请、提交本人投票，并区分决定与已记录时数。",
    ),
    route: "/dashboard#sessions",
    prerequisites: [
      t(
        "You are an assigned eligible panelist. Scheduling and final decisions require the selected Admin/Head tutor chair; applicants cannot review themselves.",
        "本人为已分配的合格面试委员。排期及最终决定要求所选管理员／负责人辅导伙伴主席；申请人不能自评。",
      ),
    ],
    steps: [
      {
        title: t("Open Interview work", "打开面试工作"),
        body: t(
          "In Schedule open your assigned interview and inspect the requested subjects and qualification explanation. Chairs can also open Interviews to Conduct; completed records are in its collapsed history section.",
          "在课表中打开分配的面试，查看申请科目及资质说明。主席也可打开待主持面试；已完成记录位于折叠历史区域。",
        ),
        screenshot: "tutor-schedule",
        focus: t(
          "Interview card, vote status and action",
          "面试卡、投票状态及操作",
        ),
      },
      {
        title: t("Submit your own vote", "提交本人的投票"),
        body: t(
          "Read the application evidence and record your vote through its existing control. Check Vote recorded / Awaiting decision. Every panelist must vote before the final decision; opening or scheduling earns no hours.",
          "阅读申请证据，通过现有控件记录本人投票。检查已投票／等待决定。最终决定前每位委员必须投票；仅打开或排期不会计时。",
        ),
      },
      {
        title: t("Chair: schedule and decide", "主席：排期并决定"),
        body: t(
          "An authorized chair schedules the interview and records the outcome after all votes, following the majority and resolving a tie. On approval enter actual completion time, minutes and attending panelists, then review Approve & award hours.",
          "获授权主席安排面试，并在全部投票后依据多数意见记录结果，平票时作出决定。批准时填写实际完成时间、分钟数及出席委员，再检查批准并授予时数。",
        ),
      },
      {
        title: t("Check completion follow-up", "检查完成后续"),
        body: t(
          "Read the saved decision and completion separately. Acceptance, interview credit and initial invitation setup can apply together; additional qualifications grant subjects without a new registration code. Ask management to correct completion/hours through Interview Records.",
          "分别检查保存决定及完成记录。录取、面试计时和初次邀请设置可一并生效；新增资质授予科目但不创建新注册码。完成信息或时数更正请管理团队通过面试记录处理。",
        ),
      },
    ],
    expected: t(
      "Your vote is saved, or the authorized chair's final decision and actual attendance credit are recorded.",
      "本人投票已保存，或获授权主席最终决定及实际出席时数已记录。",
    ),
    explanation: [
      t(
        "Coordinators may vote as panelists but cannot chair. A missing or demoted chair blocks new scheduling/decision/first completion until management fixes the panel; existing historical completion corrections retain their recorded chair. A completed interview can still await votes or decision.",
        "协调员可作为委员投票，但不能担任主席。缺少主席或主席降职时，新排期、决定及首次完成受阻，需管理团队修正面试组；已有历史完成更正保留原主席。面试已完成仍可能等待投票或决定。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The decision is blocked", "决定被阻止"),
        solution: t(
          "Check every vote, eligible active panelists, subject qualifications and a selected current Admin/Head chair. Restricted applicant access may require a separate management restoration; retrying acceptance cannot bypass it.",
          "检查全部投票、有效活跃委员、科目资质及当前管理员／负责人主席。申请人权限限制可能需单独管理恢复；重复批准不能绕过。",
        ),
      },
    ],
    related: ["tutor-subject-qualifications", "tutor-membership-hours"],
    sources: [
      "src/app/(tutor)/_components/my-interviews.tsx",
      "src/app/(tutor)/_components/schedule-interview-details.tsx",
      "src/server/api/routers/interview-management.ts",
    ],
    covers: [
      "panel review",
      "interview vote",
      "chair scheduling",
      "majority tie decision",
      "approve award hours",
      "interview completion",
      "completed history",
      "panel chair restrictions",
    ],
  },
  {
    slug: "tutor-meetings",
    audience: "tutor",
    title: t("Review meetings and request an excuse", "查看会议并申请请假"),
    summary: t(
      "Read current/history attendance and submit or cancel an excuse before the deadline.",
      "查看当前及历史出勤，并在期限前提交或取消请假。",
    ),
    route: "/dashboard#sessions",
    prerequisites: [
      t(
        "The meeting belongs to your tutor schedule and the excuse deadline has not passed.",
        "会议属于本人辅导伙伴课表，且请假截止时间未过。",
      ),
    ],
    steps: [
      {
        title: t("Open the meeting", "打开会议"),
        body: t(
          "In Schedule choose the meeting card. Read its date, program timezone and attendance or excuse state. A meeting awaiting staff attendance does not ask you to record your own attendance.",
          "在课表中选择会议卡，查看日期、项目时区和出勤或请假状态。等待工作人员记录出勤的会议不要求本人自行登记。",
        ),
        screenshot: "tutor-schedule",
        focus: t("Meeting card and excuse state", "会议卡及请假状态"),
      },
      {
        title: t("Submit or cancel your excuse", "提交或取消请假"),
        body: t(
          "Use the excuse action, supply the requested reason and confirm at least 60 minutes before the meeting starts. You may cancel your own eligible excuse before that same deadline. Staff-recorded statuses require staff correction.",
          "使用请假操作，填写所需原因，并至少在会议开始前六十分钟确认。同一期限前可取消本人符合条件的请假。工作人员记录的状态需由工作人员更正。",
        ),
      },
      {
        title: t("Read Meeting history", "查看会议历史"),
        body: t(
          "Open Meeting history, then a school-year/quarter group for recorded attendance. Semester mode groups both constituent quarters. Period not recorded remains explicit; future meetings recorded under other periods appear separately.",
          "打开会议历史，再选择学年／学季组查看已记录出勤。学期模式合并该学期两个学季。未记录时期会明确标示；记录于其他时期的未来会议单独呈现。",
        ),
      },
    ],
    expected: t(
      "Your excuse shows its saved state or historical meeting attendance remains readable.",
      "请假显示保存状态，或可读取历史会议出勤。",
    ),
    explanation: [
      t(
        "The first three unexcused tutor-meeting absences per semester have no automatic deduction; each further one deducts 0.25 hours. Excused absences do not consume that allowance. Missing attendance is not an absence.",
        "每学期前三次无故会议缺席不自动扣时；之后每次扣零点二五小时。获准请假不占此额度。缺少出勤记录不代表缺席。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Period grouping changed or a save failed",
          "时期分组改变或保存失败",
        ),
        solution: t(
          "Keep your draft and use Retry after a failed save/read. Reload groups explicitly confirms discarding unsaved drafts after an applied quarter/semester mode change; it waits for pending saves/refreshes.",
          "保存或读取失败后保留草稿并重试。已启用的学季／学期模式改变时，重新加载分组会明确要求确认放弃未保存草稿，并等待进行中的保存和刷新。",
        ),
      },
    ],
    related: ["tutor-membership-hours", "find-own-history"],
    sources: [
      "src/app/(tutor)/_components/tutor-meetings.tsx",
      "src/app/(tutor)/_components/schedule-meeting-details.tsx",
    ],
    covers: [
      "meeting schedule",
      "submit meeting excuse",
      "cancel meeting excuse",
      "meeting history",
      "semester absence allowance",
      "meeting grouping reload",
    ],
  },
  {
    slug: "tutor-membership-hours",
    audience: "tutor",
    title: t(
      "Manage tutoring participation and understand hours",
      "管理辅导参与并了解时数",
    ),
    summary: t(
      "Request or recall membership changes, relay eligible departures and inspect separate credit sources.",
      "申请或撤回资格变更、转达符合条件的退出，并分别检查时数来源。",
    ),
    route: "/settings",
    prerequisites: [
      t(
        "You have a linked tutor profile; actions depend on current participation and existing pending requests.",
        "本人有关联辅导档案；可用操作取决于当前参与状态及现有待处理申请。",
      ),
    ],
    steps: [
      {
        title: t("Request or recall your opt-out", "申请或撤回本人退出"),
        body: t(
          "In Account Settings open opt-out, enter an optional reason, review the named request and confirm after its three-second pause. Participation continues until staff approval, allowed only after seven days. Use the separate recall control to withdraw a pending request.",
          "在账号设置打开退出，填写可选原因，核对申请并在三秒暂停后确认。工作人员获准在七天后批准；批准前继续参与。待审申请可通过独立撤回控件取消。",
        ),
        screenshot: "tutor-membership",
        focus: t(
          "Tutor participation request and pending state",
          "辅导参与申请与待处理状态",
        ),
      },
      {
        title: t(
          "Request reentry or confirm a new semester",
          "申请重新加入或确认新学期",
        ),
        body: t(
          "An opted-out tutor can request reentry without a seven-day wait, but approval remains required. Only one pending membership request is allowed. After semester refresh, pending continuing tutors directly choose available or opting out in the activation prompt.",
          "已退出辅导伙伴可申请重新加入，无七天等待，但仍需批准。同一时间仅允许一个待审资格申请。学期刷新后，待确认的继续参与者可在激活提示直接选择可参与或退出。",
        ),
      },
      {
        title: t(
          "Relay only an eligible student's request",
          "仅转达符合条件学生的退出",
        ),
        body: t(
          "For a non-survey enrolled student use the relay action in pairing Details, add an optional reason and review. It processes after a seven-day recall window unless recalled or cancelled. Survey students request whole-period withdrawal in their own workspace; schedule conflicts use their own review.",
          "非问卷报名学生可在配对详情使用转达操作，填写可选原因并检查。七天撤回窗口后自动处理，除非撤回或取消。问卷学生应在本人页面申请整个时期退出；排课冲突使用独立审核。",
        ),
      },
      {
        title: t("Inspect History & hours", "检查历史与时数"),
        body: t(
          "Read the reporting period, earned tutoring hours, extras and deductions. Review sessions, interviews, meeting deductions and manual adjustments. Crew Hours is separate and is not included in the tutoring total.",
          "查看报告时期、辅导获得时数、额外时数和扣除。检查课次、面试、会议扣时及手动调整。巡查时数单独计算，不包含在辅导总时数内。",
        ),
        screenshot: "tutor-history",
        focus: t(
          "Selected period and earned/extras/deductions",
          "所选时期及获得、额外、扣除时数",
        ),
      },
    ],
    expected: t(
      "Membership requests show pending/decided state and hours can be traced to their recorded source.",
      "资格申请显示待审或决定状态，时数可追溯至记录来源。",
    ),
    explanation: [
      t(
        "A submission receipt never ends participation immediately. An outdated student relay cancels if the program refreshes or its original assignment is removed before processing. Historical attendance credit follows its recorded policy; manual adjustments and Crew credit remain separate evidence.",
        "提交回执不会立即结束参与。若处理前项目刷新或原分配删除，过时学生转达会取消。历史出勤按记录政策计时；手动调整与巡查计时仍为独立证据。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Hours or membership differ from your expectation",
          "时数或资格与预期不符",
        ),
        solution: t(
          "Check period, actual saved attendance, adjustments and review decision. Ask management to inspect the exact source record. After a successful request with refresh failure use Retry refresh rather than requesting again.",
          "检查时期、实际保存出勤、调整及审核决定。请管理团队核对准确来源记录。申请成功但刷新失败时使用重试刷新，不要重复申请。",
        ),
      },
    ],
    related: ["record-attendance", "tutor-meetings", "find-own-history"],
    sources: [
      "src/app/(tutor)/settings/page.tsx",
      "src/app/(tutor)/_components/pairing-tutee-details.tsx",
      "src/app/(tutor)/dashboard/page.tsx",
    ],
    covers: [
      "tutor opt-out",
      "recall opt-out",
      "tutor reentry",
      "semester participation choice",
      "student withdrawal relay",
      "relay recall",
      "tutoring hours breakdown",
      "crew hours separate",
    ],
  },
  {
    slug: "record-patrol",
    audience: "crew",
    title: t("Record a room patrol sweep", "记录教室巡查"),
    summary: t(
      "Save honest room observations and understand when a sweep earns Crew hours.",
      "如实保存教室观察，并了解何时获得巡查时数。",
    ),
    route: "/patrol",
    prerequisites: [
      t(
        "Your Crew access is active and the Crew module is enabled.",
        "本人巡查资格有效，且项目已启用巡查模块。",
      ),
    ],
    steps: [
      {
        title: t(
          "Open Patrol and walk the room order",
          "打开巡查并按教室顺序检查",
        ),
        body: t(
          "Open Patrol from your workspace/account menu and follow the listed room order. At each visited room, select the actual student headcount: 0, 1, 2, 3 or 4+. The page automatically timestamps each selection; choosing again replaces that room's count and time. Include at least one room.",
          "从工作区或账号菜单打开巡查，按列表中的教室顺序检查。每到一间教室，选择实际学生人数：0、1、2、3 或 4+。页面会自动记录每次选择的时间；再次选择会替换该教室的人数和时间。至少记录一间教室。",
        ),
        screenshot: "patrol",
        focus: t(
          "Ordered rooms and selected headcount buttons",
          "按顺序排列的教室及已选人数按钮",
        ),
      },
      {
        title: t("Check selections and submit", "核对选项并提交巡查"),
        body: t(
          "Check the highlighted counts, optionally enter Patrol note, then choose Submit Patrol (n), where n is the number of recorded rooms. This saves the sweep immediately. Do not reselect an older count just to refresh its timestamp. If a future-time error appears, check your device clock; the server allows only one minute of clock difference.",
          "核对高亮的人数选项，可在「巡查备注」中填写说明，再点击「提交巡查（n）」，其中 n 为已记录的教室数量。此按钮会立即保存巡查。不要为了刷新时间而重新选择较早记录的人数。若出现观察时间在未来的错误，请检查设备时钟；服务器仅允许一分钟时钟误差。",
        ),
      },
      {
        title: t("Read the saved credit result", "查看保存的计时结果"),
        body: t(
          "Check whether the saved sweep earned 0.5 Crew hours or 0 hours and review its history. A no-credit result still preserves observations. For mistakes, identify the exact patrol and ask management for a reasoned correction.",
          "检查保存巡查获得零点五巡查小时还是零小时，并查看历史。无计时结果仍保留观察记录。出现错误时，指出准确巡查记录并请管理团队按原因更正。",
        ),
      },
    ],
    expected: t(
      "The saved sweep appears in Recent Patrols with its Crew hours; a zero-credit success message explains when no hours were added.",
      "保存的巡查会出现在「近期巡查」并显示巡查时数；未增加时数时，成功提示会说明原因。",
    ),
    explanation: [
      t(
        "An eligible sweep awards 0.5 hours at most once every 20 minutes per Crew member, measured by the server. All observations must be within the last 20 minutes. Older observations or cooldown submissions save with zero hours. Reserved observation intervals cannot be reused by changing rooms, counts, notes or request keys.",
        "服务器按每位巡查成员计算，每二十分钟最多一次符合条件巡查获得零点五小时。全部观察需在最近二十分钟内。较旧观察或冷却期提交会以零小时保存。改变教室、人数、备注或请求标识不能重复使用已占观察区间。",
      ),
      t(
        "Crew credit is separate from tutoring credit. A patrol discrepancy can flag attendance for management review; it does not itself impose a penalty.",
        "巡查计时与辅导计时分开。巡查差异可能生成出勤审核提示，但本身不会处罚。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The sweep saved zero hours", "巡查保存为零小时"),
        solution: t(
          "Check every observation's actual age and the server cooldown. Keep truthful evidence; do not submit altered times or repeated sweeps to claim credit. An identical retry returns the existing result.",
          "检查每项观察实际距今时间和服务器冷却期。保留真实证据，不要修改时间或重复巡查以获得时数。相同重试返回原结果。",
        ),
      },
      {
        problem: t("Patrol controls are unavailable", "巡查控件不可用"),
        solution: t(
          "Check active Crew membership and module status with management. Use Retry for failed authorized reads; an unavailable history is not an empty history.",
          "与管理团队检查有效巡查资格及模块状态。获准读取失败时使用重试；历史不可用不代表没有记录。",
        ),
      },
    ],
    related: ["crew-membership", "apply-crew"],
    sources: [
      "src/app/patrol/page.tsx",
      "src/server/api/routers/crew.ts",
      "src/server/api/routers/patrol-credit.test.ts",
    ],
    covers: [
      "patrol room order",
      "patrol observation time",
      "headcount buckets",
      "submit patrol",
      "patrol history",
      "crew credit cooldown",
      "zero-credit sweep",
      "patrol correction request",
    ],
  },
  {
    slug: "crew-membership",
    audience: "crew",
    title: t(
      "Request Crew opt-out, recall or reentry",
      "申请退出巡查、撤回或重新加入",
    ),
    summary: t(
      "Keep patrol participation and pending membership review separate.",
      "区分巡查参与与待审资格申请。",
    ),
    route: "/patrol",
    prerequisites: [
      t(
        "Your account has Crew membership and no conflicting pending request.",
        "账号已有巡查资格，且无冲突的待处理申请。",
      ),
    ],
    steps: [
      {
        title: t("Read your Crew state", "查看巡查状态"),
        body: t(
          "Open Patrol and inspect current status and pending membership request. Crew-only membership does not grant Tutor assignments or management authority.",
          "打开巡查，查看当前状态及待处理资格申请。仅有巡查资格不会授予辅导分配或管理权限。",
        ),
        screenshot: "patrol",
        focus: t(
          "Crew status and membership request controls",
          "巡查状态与资格申请控件",
        ),
      },
      {
        title: t("Request or recall opt-out", "申请或撤回退出"),
        body: t(
          "Use the opt-out control, give the requested reason and confirm its named review after the three-second pause. Staff can approve only after seven days. Use Recall for a pending opt-out if you choose to continue.",
          "使用退出控件，填写所需原因，并在三秒暂停后确认具体审核。工作人员只能在七天后批准。决定继续时，可撤回待审退出申请。",
        ),
      },
      {
        title: t("Request reentry", "申请重新加入"),
        body: t(
          "An opted-out member can request reentry without the seven-day wait, but staff approval is still required. An inactive account may need explicit staff restoration. Check the decision before attempting new patrols.",
          "已退出成员可申请重新加入，无七天等待，但仍需工作人员批准。停用账号可能需明确工作人员恢复。开始新巡查前请检查决定。",
        ),
      },
    ],
    expected: t(
      "The membership request shows pending, recalled or decided state; patrol availability follows actual approved access.",
      "资格申请显示待审、已撤回或决定状态；巡查可用性按实际获批权限执行。",
    ),
    explanation: [
      t(
        "Academic confirmation after an invitation does not itself reactivate opted-out Crew. Participation remains subject to Crew membership and the enabled program module, independently of other account badges.",
        "邀请后的学业确认本身不会重新激活已退出巡查资格。参与仍取决于巡查资格和启用模块，与账号其他徽章独立。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Request accepted but status did not refresh",
          "申请已接受但状态未刷新",
        ),
        solution: t(
          "Use Retry refresh to read the saved request, not another submission. If the saved status changed since the request, ask management to review the current state.",
          "使用重试刷新读取已保存申请，不要重复提交。若保存状态在申请后改变，请管理团队检查当前状态。",
        ),
      },
    ],
    related: ["record-patrol", "account-academics"],
    sources: [
      "src/app/patrol/page.tsx",
      "src/app/_components/account-settings.tsx",
      "src/server/api/routers/crew.ts",
    ],
    covers: [
      "crew opt-out",
      "crew opt-out recall",
      "crew reentry",
      "crew inactive restoration",
      "crew pending membership",
    ],
  },
  {
    slug: "observe-program",
    audience: "observer",
    title: t(
      "Browse the program as a read-only observer",
      "以只读观察员浏览项目",
    ),
    summary: t(
      "Read permitted summaries while keeping private evidence and management actions restricted.",
      "阅读允许的概览，私人证据和管理操作仍受限制。",
    ),
    route: "/admin",
    prerequisites: [
      t(
        "You are an eligible Viewer or have approved departure-based observer access, and are not suspended.",
        "本人为符合条件的观察员，或有离校获批观察权限，且未被停用。",
      ),
    ],
    steps: [
      {
        title: t("Enter the read-only portal", "进入只读门户"),
        body: t(
          "Use the management area or Enter Viewers Portal offered for your account. On mobile open Menu; available pages reflect enabled modules and your permission.",
          "使用账号提供的管理区或进入观察员门户。手机端打开菜单；可用页面随模块及权限变化。",
        ),
        screenshot: "observer",
        focus: t(
          "Read-only navigation and permitted summaries",
          "只读导航与允许查看的概览",
        ),
      },
      {
        title: t("Read and filter summaries", "阅读并筛选概览"),
        body: t(
          "Browse allowed names, schedules, statuses, ratings and totals. Use available search, period filters and sortable headings; these only change the view. Read published policies and announcements through their permitted pages.",
          "浏览允许的姓名、时间安排、状态、评分和总数。使用可用搜索、时期筛选和排序标题，这些操作仅改变视图。通过允许页面阅读已发布政策及公告。",
        ),
      },
      {
        title: t("Use your own account separately", "单独管理本人账号"),
        body: t(
          "Open Account Settings or My Tutoring History for your own eligible records. If you need participant access, request it or review an authorized Add access invitation; do not create a duplicate account.",
          "打开账号设置或我的辅导历史，查看本人符合条件的记录。需要参与资格时，提交申请或确认授权添加权限邀请，不要重复注册。",
        ),
      },
    ],
    expected: t(
      "You can inspect permitted program summaries without gaining management write powers or another person's private history.",
      "可查看允许项目概览，但不获得管理写入权限或他人私人历史。",
    ),
    explanation: [
      t(
        "Contact details, signatures, private comments, absence reasons, application evidence and decision notes are masked. These summaries are not anonymous. Viewer is an exclusive role; departure-based observation is a separate access condition and does not replace your account role.",
        "联系方式、签名、私人评论、缺席原因、申请证据和决定说明会隐藏。概览并非匿名数据。观察员是独占角色；离校观察是另一种访问条件，不会替换账号角色。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Details or an action are missing", "缺少详情或操作"),
        solution: t(
          "That content may be private or require management authority. Ask staff about the exact task rather than opening hidden addresses. Observer access may also be revoked independently after departure.",
          "内容可能私密或需管理权限。请向工作人员说明具体任务，而非尝试隐藏地址。离校观察权限也可能被单独撤销。",
        ),
      },
    ],
    related: ["register-viewer", "school-departure", "find-own-history"],
    sources: [
      "src/lib/portal-access.ts",
      "src/app/_components/admin-nav.tsx",
      "docs/guides/user-guide.md",
    ],
    covers: [
      "observer portal",
      "masked management summaries",
      "read-only filters",
      "viewer boundaries",
      "departure observation",
      "observer own account",
    ],
  },
  {
    slug: "translate-interface-website",
    audience: "translator",
    title: t("Translate interface and website text", "翻译界面及网站文字"),
    summary: t(
      "Choose the exact destination, keep language drafts separate and follow publication review.",
      "选择准确目标、分别保留语言草稿，并跟进发布审核。",
    ),
    route: "/localization",
    prerequisites: [
      t(
        "You have an explicit approved Translator assignment. Management review permission alone does not grant editing assignment.",
        "本人有明确获批的翻译分配；仅有管理审核权限不代表可编辑。",
      ),
    ],
    steps: [
      {
        title: t("Choose text type and language", "选择文字类型及语言"),
        body: t(
          "Open Translations and select Interface text or Website text. Choose the target language and exact destination/group. Search interface strings and expand their group before editing; preserve variables and intended meaning.",
          "打开翻译，选择界面文字或网站文字，再选择目标语言及准确位置／分组。搜索界面字符串并展开分组后编辑，保留变量及原意。",
        ),
        screenshot: "localization",
        focus: t(
          "Interface text, Website text, Draft review and language selector",
          "界面文字、网站文字、草稿审核及语言选择",
        ),
      },
      {
        title: t("Submit using the correct control", "使用对应方式提交"),
        body: t(
          "A changed interface field submits when focus leaves it. Website text uses its explicit submission button. Check each saved/pending/error state before leaving. Open language/destination drafts remain independent during the visit.",
          "界面字段修改后在失去焦点时提交。网站文字使用明确提交按钮。离开前检查每项保存、待处理或错误状态。本次访问中打开的语言及目标草稿相互独立。",
        ),
      },
      {
        title: t("Follow Draft review", "跟进草稿审核"),
        body: t(
          "Use Pending, Published, Rejected or All filters to read review status. Ordinary translators and Coordinator edits create private drafts; only Admin/Head approve/publish or reject. A Coordinator may Request Admin/Head approval, leaving the draft pending.",
          "使用待处理、已发布、已拒绝或全部筛选查看审核状态。普通翻译人员及协调员编辑产生私密草稿；仅管理员／负责人能批准发布或拒绝。协调员可申请管理员／负责人批准，草稿仍保持待审。",
        ),
      },
      {
        title: t("Add a language carefully", "谨慎新增语言"),
        body: t(
          "Use Languages to add a language with English fallback. New languages start hidden until management reviews and enables them. Only the permitted management controls change public visibility, order or deletion; built-in catalogues cannot be deleted.",
          "在语言区域添加使用英语回退的新语言。新增语言默认隐藏，直至管理团队审核启用。只有获准管理控件能更改公开可见性、顺序或删除；内置语言目录不可删除。",
        ),
      },
    ],
    expected: t(
      "Your exact destination has a saved draft or an explicitly identified authorized live publication.",
      "指定目标生成已保存草稿，或明确标识的获授权实时发布。",
    ),
    explanation: [
      t(
        "Admin/Head with Translator assignment can publish their direct edits; their editor labels these as live changes. Translating text grants no structural page deletion, account authority or unilateral policy publication. Policy translations follow the separate policy revision process; UI language visibility does not create a policy translation.",
        "具有翻译分配的管理员／负责人可直接发布本人编辑；编辑器会标示实时更改。翻译文字不会授予页面结构删除、账号权限或单方政策发布。政策翻译遵循独立修订流程；界面语言可见不等于已有政策译文。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The destination changed or submission refresh failed",
          "目标已改变或提交后刷新失败",
        ),
        solution: t(
          "A stale destination needs fresh text/draft after reloading; do not approve old wording against changed content. After accepted submission with failed synchronization use read-only Retry. Drafts are not stored after leaving/reloading the editor.",
          "目标过时时应重新加载后编写新草稿，不应针对已改变内容批准旧文字。提交已接受但同步失败时使用只读重试。离开或刷新编辑器后不保留本地草稿。",
        ),
      },
    ],
    related: ["read-recover-save", "read-accept-policy"],
    sources: [
      "src/app/_components/translation-editor.tsx",
      "src/app/_components/translation-strings.tsx",
      "src/app/_components/translation-composer.tsx",
      "src/app/_components/translation-review.tsx",
      "src/lib/translation-access.ts",
    ],
    covers: [
      "interface translation",
      "website translation",
      "translation language destination",
      "blur submit",
      "private draft",
      "translation review filters",
      "add hidden language",
      "translation publication boundary",
      "translation draft recovery",
    ],
  },
  {
    slug: "tutor-program-information",
    audience: "tutor",
    title: t(
      "Read announcements, room schedules and learner standing",
      "阅读公告、教室课表及学习伙伴状态",
    ),
    summary: t(
      "Find shared program information while respecting the limits on private evidence.",
      "查看共享项目信息，并尊重私人证据的访问限制。",
    ),
    route: "/dashboard",
    prerequisites: [
      t(
        "Use your tutor workspace; optional sections depend on enabled modules and relevant records.",
        "使用本人辅导伙伴页面；可选区域取决于启用模块及相关记录。",
      ),
    ],
    steps: [
      {
        title: t("Read addressed announcements", "阅读发给本人的公告"),
        body: t(
          "Read the announcement cards above your workspace. Pinned posts stay visible even after an earlier acknowledgement; they have no Dismiss button. Use Dismiss on an ordinary post when offered. Addressed posts use the audience captured at publication; another tutor's notice is not yours to acknowledge.",
          "阅读本人工作区上方的公告卡片。置顶公告即使曾确认仍会保留，也没有收起按钮。普通公告提供收起按钮时可使用。定向公告使用发布时确定的受众，不能代他人确认。",
        ),
        screenshot: "tutor-overview",
        focus: t(
          "Announcements above the tutor workspace",
          "辅导伙伴页面上方公告",
        ),
      },
      {
        title: t("Inspect the shared room schedule", "查看共享教室课表"),
        body: t(
          "Use the shared room-schedule view in the tutor workspace to read planned public room commitments. Read the exact time and room details, and close the reader when finished. It does not display private interview evidence or reserve a room for you.",
          "在辅导伙伴页面使用共享教室课表，查看公开计划教室安排。核对具体时间及教室详情，完成后关闭阅读器。此视图不会显示私人面试证据，也不会为本人预订教室。",
        ),
        screenshot: "tutor-pairings",
        focus: t(
          "Shared room schedule beside pairing tools when offered",
          "提供时配对工具旁的共享教室课表",
        ),
      },
      {
        title: t("Read your learners' standing", "查看本人学习伙伴状态"),
        body: t(
          "When discipline history is available, expand a tutee's timeline to inspect card color, date and pending/valid outcome. Tutors see standing and outcomes, never the private card reasons. Request new cards only through the relevant attendance form with an actual reason.",
          "纪律历史可用时，可展开学习伙伴时间线，查看卡片颜色、日期及待处理或有效结果。辅导伙伴可见状态和结果，不能查看私人纪律原因。新纪律卡需通过相关出勤表单并提供真实原因申请。",
        ),
      },
      {
        title: t("Reopen the handbook", "重新打开手册"),
        body: t(
          "Choose Handbook or current policy to read the published tutor policy in the interface language, with English fallback. Reading does not sign a new revision; complete the separate participation-policy review if prompted.",
          "选择手册或当前政策，按界面语言阅读已发布辅导政策，无译文时使用英语。阅读不会签署新修订版；如提示，仍需完成独立参与政策审核。",
        ),
      },
      {
        title: t("Read feedback shared with you", "阅读共享给本人的反馈"),
        body: t(
          "Open Tutee Support at /student-support. When management enables Share feedback with tutors, you can read feedback for your own recorded sessions and use Previous/Next for that list. When sharing is off or cannot be verified, follow the stated unavailable/privacy message rather than assuming access.",
          "打开/student-support的学习伙伴支持。管理团队启用与辅导伙伴共享反馈后，可阅读本人已记录课次的反馈，并用上一页／下一页浏览。共享关闭或无法确认时，应遵循页面不可用或隐私提示，不要假定仍有访问权限。",
        ),
      },
    ],
    expected: t(
      "You understand the current announcement, planned room information and permitted learner standing.",
      "了解当前公告、教室计划信息及允许查看的学习伙伴状态。",
    ),
    explanation: [
      t(
        "Optional discipline history hides after a successful empty read, not during a failed load. Shared room information does not grant management room-selection powers; the assigned session remains authoritative for your lesson.",
        "可选纪律历史仅在成功读取为空后隐藏，加载失败时不会视为空。共享教室信息不授予管理教室选择权限；本人课程仍以分配课次为准。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The section is missing or cannot refresh",
          "区域缺失或无法刷新",
        ),
        solution: t(
          "Check whether the module is enabled and you have addressed announcements or relevant records. Use Retry for failed reads. Ask management privately about incorrect standing; do not infer hidden reasons from a summary.",
          "检查模块是否启用，以及本人是否有定向公告或相关记录。读取失败时使用重试。状态错误请私下联系管理团队，不要从概览猜测隐藏原因。",
        ),
      },
    ],
    related: ["read-accept-policy", "record-attendance", "tutor-pairing-time"],
    sources: [
      "src/app/(tutor)/_components/announcements-banner.tsx",
      "src/app/(tutor)/_components/tutor-room-schedule.tsx",
      "src/app/(tutor)/_components/tutor-discipline.tsx",
      "src/app/(tutor)/handbook/page.tsx",
      "src/app/_components/student-support.tsx",
      "src/server/api/routers/student.ts",
    ],
    covers: [
      "read addressed announcement",
      "acknowledge dismiss announcement",
      "shared room schedule",
      "read tutee discipline standing",
      "card timeline privacy",
      "read tutor handbook",
      "read feedback shared with tutor",
    ],
  },
];
