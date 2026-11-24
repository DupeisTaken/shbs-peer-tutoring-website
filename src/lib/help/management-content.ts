import {
  helpText as t,
  type HelpArticle,
  type HelpAudience,
  type HelpText,
} from "./types";

type ManagementGuide = Omit<
  HelpArticle,
  "audience" | "prerequisites" | "steps"
> & {
  audience?: HelpAudience;
  prerequisites?: HelpText[];
  screenshot: string;
  focus: HelpText;
  steps: [HelpText, HelpText][];
};

/** The screenshot stays beside the first instruction; the remaining steps name the
 * controls to find there. Source/action inventories support later completeness reviews. */
function guide({
  screenshot,
  focus,
  steps,
  audience = "staff",
  prerequisites,
  ...article
}: ManagementGuide): HelpArticle {
  return {
    ...article,
    audience,
    prerequisites: prerequisites ?? [
      t(
        "Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.",
        "使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。",
      ),
    ],
    steps: steps.map(([title, body], index) => ({
      title,
      body,
      ...(index === 0 ? { screenshot, focus } : {}),
    })),
  };
}

export const managementArticles: HelpArticle[] = [
  guide({
    slug: "manage-daily-work",
    title: t("Find daily management work", "查找日常管理任务"),
    summary: t(
      "Use the management overview, activity queues and mobile navigation to find the next task.",
      "通过管理概览、待办队列和移动端导航找到下一项任务。",
    ),
    route: "/admin",
    screenshot: "admin-overview",
    focus: t(
      "Start with the overview and the grouped navigation at the left.",
      "从概览及左侧分组导航开始。",
    ),
    steps: [
      [
        t("Open management", "进入管理区"),
        t(
          "Choose Back to Management from the header or account menu, or Enter management when that label is offered. On a phone, open the menu below the brand to reveal the same groups.",
          "从页首或账号菜单选择返回管理；入口显示进入管理区时，选择该项。手机上打开品牌下方的菜单，即可看到相同分组。",
        ),
      ],
      [
        t("Open Activity", "打开动态待办"),
        t(
          "Read the named queues and open the relevant request. Check its period, current status and person before acting; a notification is a shortcut to the record, not a decision.",
          "查看各待办队列并打开相关申请。操作前核对学期、当前状态和人员；通知只是记录的入口，并不代表已作决定。",
        ),
      ],
      [
        t("Find the right record", "找到正确记录"),
        t(
          "Use the page search, filters and rightmost Actions column. A sortable heading cycles ascending, descending and original order. Clear filters when looking for missing records.",
          "使用页面搜索、筛选和最右侧操作列。可排序表头依次切换升序、降序和原顺序。查找缺失记录时先清除筛选。",
        ),
      ],
      [
        t("Read the result", "确认操作结果"),
        t(
          "Saved means the live write completed. Submitted for Review means a Management Actions request exists and live records have not changed. Open that receipt to follow its decision.",
          "已保存表示实际写入完成。已提交审核表示已建立管理操作申请，现有记录尚未改变。打开回执可查看后续决定。",
        ),
      ],
    ],
    expected: t(
      "You can identify a task, open its current record and distinguish an applied change from a pending proposal.",
      "能够定位任务、打开当前记录，并分清已应用变更与待审提案。",
    ),
    explanation: [
      t(
        "Navigation follows both current permissions and effective feature switches. Read-only observers have a different, masked view and cannot submit management writes.",
        "导航同时受当前权限和生效功能开关控制。只读观察者看到经过遮蔽的内容，不能提交管理写入。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("A section or record is missing", "找不到栏目或记录"),
        solution: t(
          "Clear search and status/period filters. Check whether the module is enabled and your access still applies. Use Retry for a failed read; do not interpret an unavailable queue as empty.",
          "清除搜索及状态、学期筛选，确认模块已启用且权限仍有效。读取失败时使用重试；无法读取队列不等于队列为空。",
        ),
      },
    ],
    sources: [
      "src/app/_components/admin-nav.tsx",
      "src/app/(admin)/admin/page.tsx",
      "src/app/(admin)/admin/activity/page.tsx",
    ],
    covers: [
      "management overview",
      "activity queues",
      "mobile management navigation",
      "search/filter/sort",
      "applied versus proposed result",
    ],
  }),
  guide({
    slug: "match-tutoring-requests",
    title: t("Match a tutoring request", "为辅导申请匹配辅导伙伴"),
    summary: t(
      "Review verified demand, compare tutor qualifications and workload, then assign a subject choice.",
      "审核已验证的需求，比较辅导伙伴资格和工作量，再分配科目志愿。",
    ),
    route: "/admin/requests",
    screenshot: "admin-requests",
    focus: t(
      "Use Needs matching, then Select tutor on the relevant subject choice.",
      "选择待匹配，然后在相应科目志愿上使用选择辅导伙伴。",
    ),
    steps: [
      [
        t("Choose the request tab", "选择申请标签页"),
        t(
          "Open Signup Requests → Needs matching. Find the student in the list and expand the request. Check its source and verification labels, subject choices, available times and current answer revisions.",
          "打开报名申请→待匹配。在列表中找到学习伙伴并展开申请。核对来源和验证标记、科目志愿、可用时间及当前答案修订。",
        ),
      ],
      [
        t("Compare tutors", "比较辅导伙伴"),
        t(
          "Choose Select tutor for one choice. Review qualification, willingness, availability, assigned teaching blocks and the tutor's preferred maximum. Preferred capacity is advisory; it is not an automatic prohibition.",
          "对一个志愿选择辅导伙伴。检查资格、辅导意愿、可用时间、已分配辅导时段及辅导伙伴偏好上限。偏好容量仅供参考，并非自动禁令。",
        ),
      ],
      [
        t("Review the assignment", "审阅分配内容"),
        t(
          "Choose the intended tutor and inspect any qualification warning before continuing. Confirm the exact student, subject and period. Use normal matching before considering manual roster or pairing creation.",
          "选择预期辅导伙伴，继续前阅读资格警告。确认学习伙伴、科目和学期。应优先使用正常匹配，再考虑手动创建名册或配对。",
        ),
      ],
      [
        t("Check the saved placement", "检查分配结果"),
        t(
          "Complete the review and read the save or approval receipt. Find applied assignments under Assigned and in Pairings. Recurring scheduling and room allocation remain separate steps.",
          "完成审阅并读取保存或审核回执。已应用分配可在已分配和配对页面查看；固定排课和教室分配仍须另外完成。",
        ),
      ],
    ],
    expected: t(
      "The intended subject choice is assigned, or a clearly identified proposal waits for approval.",
      "预期科目志愿已分配，或生成可明确识别的待审提案。",
    ),
    explanation: [
      t(
        "Self-service, Staff-entered and Earlier signup describe provenance. Earlier signup means the entry source is unknown, not that it has older priority. The verified survey retains its original submission priority.",
        "自助报名、工作人员录入及早期报名描述来源。早期报名表示来源不明，不代表更早的优先级。已验证问卷保留原始提交优先级。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A tutor cannot be selected or the request is blocked",
          "无法选择辅导伙伴或申请被阻止",
        ),
        solution: t(
          "Inspect the stated qualification, membership, verification, invalidity or period restriction. Fix that source through its owning workflow; changing filters or creating a duplicate request does not resolve it.",
          "查看显示的资格、成员状态、验证、无效标记或学期限制。通过对应流程修正原因；更改筛选或重复建申请不能解决问题。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/requests/student-request-board.tsx",
      "src/server/api/routers/student-workflow.ts",
      "src/server/tutor-workload.ts",
    ],
    covers: [
      "Needs matching",
      "Assigned",
      "Needs review",
      "Closed",
      "request provenance",
      "Select tutor",
      "qualification warning",
      "workload advice",
      "subject assignment",
    ],
  }),
  guide({
    slug: "review-signup-validity",
    title: t(
      "Flag, clear or appeal an invalid signup",
      "标记、清除或复核无效报名",
    ),
    summary: t(
      "Record a reason, inspect status mail and resolve request-invalidity appeals without erasing evidence.",
      "记录原因、查看状态邮件并处理报名无效申诉，同时保留证据。",
    ),
    route: "/admin/requests",
    screenshot: "admin-requests",
    focus: t(
      "Find Request validity, Flag invalid and Review invalid flag on the request.",
      "在申请中找到申请有效性、标记无效及查看无效标记。",
    ),
    steps: [
      [
        t("Inspect the exact request", "检查具体申请"),
        t(
          "Open Signup Requests or Tutor Applications. Use Request validity to find flagged or unflagged entries, then open the request before making a change.",
          "打开报名申请或辅导伙伴申请。使用申请有效性筛选已标记或未标记条目，变更前先打开具体申请。",
        ),
      ],
      [
        t("Explain the flag or correction", "说明标记或修正原因"),
        t(
          "Choose Flag invalid or Review invalid flag → Clear invalid flag. Enter a reason suitable for the submitter to read, review the named entry, then save or submit for review.",
          "选择标记无效，或查看无效标记→清除无效标记。填写适合申请人阅读的原因，核对具体条目后保存或提交审核。",
        ),
      ],
      [
        t("Check email and appeals", "检查邮件与申诉"),
        t(
          "Read the invalidity dialog's email state and latest appeal. Refresh status reads only. Admin/Head may retry an eligible failed status email and decide a tutee invalidity appeal after reading its full reason.",
          "查看无效标记对话框中的邮件状态与最新申诉。刷新状态只会读取。管理员或负责人可重试符合条件的失败状态邮件，并在阅读完整原因后决定学习伙伴无效申请申诉。",
        ),
      ],
      [
        t("Confirm the decision", "确认决定"),
        t(
          "An accepted tutee appeal clears the flag. Final rejection closes the active request and removes its priority. Check the retained history and resulting request state before continuing processing.",
          "学习伙伴申诉获批后会清除标记；最终驳回会关闭当前申请并移除其优先级。继续处理前检查保留的历史及申请状态。",
        ),
      ],
    ],
    expected: t(
      "The current flag and any appeal decision are visible with their reasons and delivery status.",
      "能看到当前标记、申诉决定、相应原因及邮件投递状态。",
    ),
    explanation: [
      t(
        "A flag blocks processing but does not delete an entry or impose discipline. Clearing it preserves evidence and does not revive an expired request or restore membership. Verification deadlines continue while flagged; only request-specific mailbox proof permits disclosure of the reason.",
        "标记会阻止处理，但不删除条目或施加纪律处罚。清除标记会保留证据，不会恢复过期申请或成员资格。标记期间验证截止时间仍继续；只有针对该申请的邮箱证明才允许披露原因。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Status email is Blocked or the list did not refresh",
          "状态邮件被阻止或列表未刷新",
        ),
        solution: t(
          "Inspect the recorded address and the stated delivery restriction. Retry refresh reloads records after a completed save; it does not resend or repeat the decision. Pending Coordinator proposals send no invalidity notice until applied.",
          "核对记录地址及显示的投递限制。保存完成后的重试刷新只重载记录，不重新发送或重复决定。协调员待审提案在应用前不会发送无效通知。",
        ),
      },
    ],
    sources: [
      "src/app/_components/request-invalidity-controls.tsx",
      "src/app/_components/request-invalidity.tsx",
      "src/app/(admin)/admin/requests/request-email-status.ts",
    ],
    covers: [
      "flag invalid",
      "clear invalid flag",
      "validity filters",
      "invalidity reason",
      "request-status mail",
      "request appeal",
      "appeal acceptance/rejection",
    ],
  }),
  guide({
    slug: "revise-student-signup",
    audience: "admin",
    title: t(
      "Revise signup answers and release assignments",
      "修订报名答案并解除分配",
    ),
    summary: t(
      "Review changed subject choices and their explicit assignment consequences.",
      "审阅变更的科目志愿及其明确的分配后果。",
    ),
    route: "/admin/requests",
    screenshot: "admin-requests",
    focus: t(
      "Open the request's answer editor and review affected assigned choices.",
      "打开申请答案编辑器并审阅受影响的已分配志愿。",
    ),
    prerequisites: [
      t(
        "Admin or Head access and the exact current student request. Review the original submission before editing.",
        "需要管理员或负责人权限及准确的当前学习伙伴申请。编辑前阅读原始提交。",
      ),
    ],
    steps: [
      [
        t("Read original and current answers", "阅读原始及当前答案"),
        t(
          "Open the student's request and choose Edit signup answers. Compare the current answers with the retained original signature and policy revision. Confirm the subject and period you intend to change.",
          "打开学习伙伴申请并选择“编辑报名答案”。将当前答案与保留的原签名及政策版本对照。确认要更改的科目和学期。",
        ),
      ],
      [
        t("Edit the intended answers", "编辑预期答案"),
        t(
          "Update the needed fields in Edit signup answers. Check which subjects are assigned on the request. Owners can edit unassigned choices. A staff change to an assigned choice can release that assignment.",
          "在“编辑报名答案”中更新所需字段。先查看申请中哪些科目已分配。申请人可以编辑未分配的志愿。工作人员更改已分配的志愿可能会解除对应分配。",
        ),
      ],
      [
        t("Review releases explicitly", "明确审阅解除分配"),
        t(
          "Choose Review signup changes. Check the identified student and the release consequences. Match the affected subjects and assignments to the original request. Cancel returns to the draft.",
          "选择“审核报名更改”。核对学习伙伴及解除分配的后果，并与原申请中的科目和分配对照。“取消”会返回草稿。",
        ),
      ],
      [
        t("Verify the revised request", "验证修订申请"),
        t(
          "After saving, check the current choices and assignment status. Reopen the editor to verify the retained signature and policy version. If the list failed to refresh, retry the read.",
          "保存后检查当前志愿和分配状态。重新打开编辑器，核对保留的签名和政策版本。如果列表未刷新，请重试读取。",
        ),
      ],
    ],
    expected: t(
      "Only the reviewed answers and assignment releases change; the request's evidence remains readable.",
      "只有已审阅的答案及解除分配发生变化，申请证据仍可读取。",
    ),
    explanation: [
      t(
        "Signup-answer changes do not rewrite shared account identity, original policy signatures, completed lessons or attendance. A release must be reviewed as an assignment consequence, not treated as an ordinary profile edit.",
        "报名答案变更不会重写共享账号身份、原始政策签名、已完成课程或出勤。解除分配必须作为分配后果审阅，不能当作普通资料编辑。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The review is stale", "审阅内容已过时"),
        solution: t(
          "Use the explicit reload action and reread the new affected-assignment list. Do not reuse an earlier confirmation after another staff member changes the request.",
          "使用明确的重新加载操作，再次阅读新的受影响分配清单。其他工作人员变更申请后，不要沿用之前的确认。",
        ),
      },
    ],
    sources: [
      "src/app/_components/student-signup-editor.tsx",
      "src/server/api/routers/student-workflow.ts",
    ],
    covers: [
      "staff signup answer revision",
      "assigned choice release",
      "headUnassign",
      "original versus revised answers",
    ],
  }),
  guide({
    slug: "review-tutor-applications",
    title: t(
      "Review tutor applications and correct names",
      "审核辅导伙伴申请并修正姓名",
    ),
    summary: t(
      "Find current or completed applications, inspect setup status and correct initial application identity.",
      "查找当前或已完成申请，检查账号设置状态并修正初次申请姓名。",
    ),
    route: "/admin/applications",
    screenshot: "admin-applications",
    focus: t(
      "Use the application filters and expand the intended application.",
      "使用申请筛选并展开目标申请。",
    ),
    steps: [
      [
        t("Find the application", "查找申请"),
        t(
          "At the top, search Name or email and use the application-status, requested-subject, interview-completion and sort filters. Application cards display explicit panel progress alongside accept and reject vote counts. The separate Interview records section searches applicants, panelists or subjects; choose Needs completion, Completed or All there, then Search. Panelist search belongs to that lower section.",
          "在顶部按姓名或邮箱搜索，并使用申请状态、申请科目、面试完成情况及排序筛选。申请卡片会明确显示评审进度以及同意与拒绝票数。独立的面试记录区域支持搜索申请人、评审或科目；在该处选择待完成、已完成或全部，再点击搜索。按评审搜索应使用下方区域。",
        ),
      ],
      [
        t("Read the evidence", "阅读证据"),
        t(
          "Expand the record and inspect requested qualification, panel, chair, schedule, completion and account setup status. Open its existing panel link from interview history when relevant.",
          "展开记录，查看申请资格、评委组、主席、安排、完成情况及账号设置状态。必要时从面试历史打开对应评委链接。",
        ),
      ],
      [
        t("Correct an initial name", "修正初次申请姓名"),
        t(
          "For an eligible initial application, open the name-correction action, edit the four name fields and enter a reason. Review the before/after identity before saving or submitting a Coordinator proposal.",
          "对符合条件的初次申请，打开姓名修正操作，编辑四个姓名字段并填写原因。保存或提交协调员提案前审阅修改前后身份。",
        ),
      ],
      [
        t("Continue the proper workflow", "继续对应流程"),
        t(
          "Use panel assignment and interview review for qualification decisions. Use the offered account-setup action only when the source is eligible; a roster or accepted application is not itself a usable login.",
          "资格决定使用评委分配和面试审核流程。只有来源符合条件时才使用账号设置操作；名册或已接受申请本身不代表可登录账号。",
        ),
      ],
    ],
    expected: t(
      "The application and its interview/setup status are clear; any name correction has its own recorded reason.",
      "申请及面试、账号设置状态清楚可见；姓名修正拥有独立记录原因。",
    ),
    explanation: [
      t(
        "Name correction changes only the application name fields and reason. It does not accept the application, clear invalidity, change contacts or manufacture qualification/policy evidence.",
        "姓名修正仅改变申请姓名字段及原因，不会接受申请、清除无效标记、修改联系方式或制造资格与政策证据。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A completed interview or application cannot be found",
          "找不到已完成面试或申请",
        ),
        solution: t(
          "Switch to completed or all records and clear status filters. History sorting happens before pagination; use the displayed page controls rather than assuming the first page is the complete list.",
          "切换至已完成或全部记录并清除状态筛选。历史排序发生在分页之前；使用页面导航，不要把第一页当作全部记录。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/applications/page.tsx",
      "src/app/_components/application-identity-correction.tsx",
      "src/app/_components/application-filters.tsx",
    ],
    covers: [
      "application search/filter/history/sort",
      "initial application name correction",
      "account setup status",
      "application invalidity entry",
    ],
  }),
  guide({
    slug: "manage-interview-panels",
    title: t("Assign and complete an interview panel", "分配并完成面试评委组"),
    summary: t(
      "Choose a qualified panel and valid chair, schedule the interview, then record its actual completion.",
      "选择合资格评委和有效主席、安排面试，并记录实际完成情况。",
    ),
    route: "/admin/applications",
    screenshot: "admin-applications",
    focus: t(
      "Expand the applicant to find panel assignment and interview management.",
      "展开申请人，找到评委分配及面试管理。",
    ),
    steps: [
      [
        t("Select the panel", "选择评委组"),
        t(
          "Open the applicant's panel editor. Choose 3–8 active account-linked tutors, including at least one with staff-confirmed qualification in an applicant subject. Select an Admin or Head panelist as chair, then review and save the panel.",
          "打开申请人评委编辑器。选择3至8名关联活跃账号的辅导伙伴，其中至少一人在申请科目具备工作人员确认资格；再选择其中一名管理员或负责人担任主席，审阅后保存。",
        ),
      ],
      [
        t("Arrange the interview", "安排面试"),
        t(
          "The assigned chair opens Interviews to Conduct in Tutor Schedule and chooses Set Time. Enter the date and time in the program time zone. Each panelist submits their own vote.",
          "指定主席在辅导伙伴“课表”中打开“待进行的面试”，选择“设置时间”。按项目时区输入日期与时间。每位评委各自提交投票。",
        ),
      ],
      [
        t("Record the decision", "记录决定"),
        t(
          "Open Votes & Decision in Tutor Applications to read the tally. After all panelists vote, an eligible chair follows the displayed majority or tie rules in Interviews to Conduct and confirms the decision from there.",
          "在“辅导伙伴申请”中打开“投票与决定”查看票数。全体评委投票后，符合资格的主席在“待进行的面试”中按页面显示的多数或平票规则确认决定。",
        ),
      ],
      [
        t("Complete actual attendance", "完成实际出席记录"),
        t(
          "Record actual completion time, duration and attending panelists. For a later correction, enter the reason and review replacement credits before applying or proposing the whole correction.",
          "记录实际完成时间、时长及出席评委。后续修正时填写原因，审阅替换的学时后再应用或提出整个修正。",
        ),
      ],
    ],
    expected: t(
      "The saved panel, chair, schedule, votes, decision and completion remain attached to the application.",
      "保存的评委、主席、安排、投票、决定及完成情况均保留在申请中。",
    ),
    explanation: [
      t(
        "A valid Admin/Head chair is required for new scheduling, decisions and first completion. Historical hour correction retains the recorded chair rather than rechecking today's rank. Qualification, tutoring willingness and account access remain separate.",
        "新的安排、决定及首次完成需要有效管理员或负责人主席。历史学时修正保留记录中的主席，而非重新检查其当前职位。资格、辅导意愿和账号权限仍彼此独立。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Panel or completion controls are blocked",
          "评委或完成控件被阻止",
        ),
        solution: t(
          "Check active panel membership, recorded qualifications, the chair's current authority and the Interviews feature. History remains readable when interviews are off; writes wait until the module and eligibility permit them.",
          "检查评委活跃状态、已记录资格、主席当前权限及面试功能。关闭面试后历史仍可读；写入须待模块和资格允许。",
        ),
      },
    ],
    sources: [
      "src/app/_components/interview-panel-editor.tsx",
      "src/app/_components/interview-management.tsx",
      "src/server/api/routers/interview-management.ts",
      "src/server/interviews.ts",
    ],
    covers: [
      "panel assignment",
      "3–8 active panelists with qualified subject evidence",
      "Admin/Head chair",
      "interview scheduling",
      "panel voting",
      "chair decision",
      "actual completion",
      "interview hour correction",
    ],
  }),
  guide({
    slug: "inspect-subject-availability",
    title: t(
      "Compare qualifications and tutoring willingness",
      "比较辅导资格与意愿",
    ),
    summary: t(
      "Read direct and inherited qualification grants without confusing them with willingness or timetable availability.",
      "阅读直接与继承资格，避免将其与辅导意愿或时间可用性混淆。",
    ),
    route: "/admin/subject-availability",
    screenshot: "admin-subject-availability",
    focus: t(
      "Expand a tutor and use Qualified, Pending Review or Willing to tutor.",
      "展开辅导伙伴并使用已获资格、待审核或愿意辅导筛选。",
    ),
    steps: [
      [
        t("Find and expand the tutor", "查找并展开辅导伙伴"),
        t(
          "Open Subject Availability below Tutor Roster. Search the tutor or subject and expand the tutor to see grouped subjects and named level variants.",
          "打开辅导伙伴名册下方的科目可用性。搜索辅导伙伴或科目并展开辅导伙伴，查看分组科目及具体级别。",
        ),
      ],
      [
        t("Apply one local filter", "应用一个局部筛选"),
        t(
          "Choose Qualified, Pending Review or Willing to tutor for that tutor. Click the selected filter again to clear it; it combines with page-level search and filters.",
          "为该辅导伙伴选择已获资格、待审核或愿意辅导。再次点击已选筛选可清除；它会与页面搜索和筛选共同生效。",
        ),
      ],
      [
        t("Inspect qualification sources", "检查资格来源"),
        t(
          "Read the direct approval and recorded inherited lower-level grants. Compare willingness separately: Not recorded means the tutor has not saved a choice.",
          "阅读直接批准及已记录的低级别继承资格。另行比较辅导意愿：未记录表示辅导伙伴尚未保存选择。",
        ),
      ],
      [
        t("Use the correct follow-up", "选择正确后续操作"),
        t(
          "Open Edit details. Changing Willing to tutor saves immediately; Approve this subject and Remove approval source also submit immediately. Read the saved or Coordinator approval-request outcome before continuing. Admin/Head decide additional qualification applications separately. Check schedule and capacity independently when matching.",
          "打开编辑详情。更改辅导意愿会立即保存；批准此科目及移除审批来源也会立即提交。继续前阅读保存结果或协调员的审核申请结果。额外资格申请由管理员或负责人另行决定；匹配时须另行检查排期和容量。",
        ),
      ],
    ],
    expected: t(
      "You can explain whether the tutor is qualified, willing, pending review and otherwise eligible for an assignment.",
      "能够分辨辅导伙伴是否有资格、愿意辅导、待审，以及是否符合其他分配条件。",
    ),
    explanation: [
      t(
        "Approving a higher variant records the lower offered levels at that time. Later catalogue reordering does not recalculate those grants. Archived subjects with recorded evidence remain visible. Qualification alone does not set willingness.",
        "批准高级变体会记录当时提供的较低级别。此后重排目录不会重新计算资格。归档科目中已记录的证据仍可见。资格本身不代表意愿。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The expected qualification is missing", "缺少预期资格"),
        solution: t(
          "Clear filters and inspect the recorded approval sources and active catalogue variant. Do not infer a grant from present-day level order; ask Admin/Head to review the actual evidence.",
          "清除筛选并检查记录中的批准来源及活跃目录变体。不要从当前级别顺序推断资格；请管理员或负责人审核实际证据。",
        ),
      },
    ],
    sources: [
      "src/app/_components/subject-availability.tsx",
      "src/server/api/routers/qualification-application.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "qualification and willingness inspection",
      "local subject filters",
      "recorded inherited grants",
      "pending qualification requests",
    ],
  }),
  guide({
    slug: "decide-subject-qualifications",
    title: t(
      "Grant or remove a manual subject qualification",
      "手动授予或移除科目资格",
    ),
    summary: t(
      "Review evidence and grant sources; keep qualifications independent of willingness and account badges.",
      "审核证据与授予来源，保持资格、意愿及账号标记彼此独立。",
    ),
    route: "/admin/subject-availability",
    screenshot: "admin-subject-availability",
    focus: t(
      "Expand the tutor and inspect the exact variant and its approval source.",
      "展开辅导伙伴，检查具体级别及其批准来源。",
    ),
    prerequisites: [
      t(
        "Current management access. Admin/Head apply manual grants/source removals; Coordinators submit permitted changes for review. Additional qualification-application decisions use a separate Admin/Head workflow.",
        "需要当前管理权限。管理员、负责人应用手动资格授予或来源移除；协调员提交允许变更审核。额外资格申请决定使用独立管理员、负责人流程。",
      ),
    ],
    steps: [
      [
        t("Read the recorded grant", "阅读资格授予记录"),
        t(
          "In Subject Availability, expand the tutor and locate the exact subject variant. Read its qualification evidence, existing approval sources and independent willingness before using the manual approval action.",
          "在科目可用性展开辅导伙伴，定位准确科目级别。使用手动批准前阅读资格证据、现有批准来源及独立意愿。",
        ),
      ],
      [
        t("Check and grant the qualification", "核对并授予资格"),
        t(
          "In Edit details, check the named tutor, subject and level. Inspect the group's lower levels, then choose Approve this subject to submit immediately. Admin and Head apply the grant directly. A Coordinator follows the pending proposal in Management Actions.",
          "打开编辑详情，核对辅导伙伴、科目及级别。检查该科目组的较低级别，再选择批准此科目立即提交。管理员及负责人直接应用授予。协调员在管理操作中跟进待审提案。",
        ),
      ],
      [
        t("Remove only the intended source", "仅移除预期来源"),
        t(
          "Open Edit details for the variant with direct approval. Read its direct and inherited sources before choosing Remove approval source, which submits immediately. Once the change is applied, reopen the record and check which qualifications still have another source.",
          "对有直接批准的级别打开编辑详情，先阅读直接来源及继承来源，再选择移除审批来源立即提交。变更应用后重新打开记录，核对哪些资格仍有其他来源支持。",
        ),
      ],
      [
        t("Verify willingness separately", "另行核对意愿"),
        t(
          "Reload the tutor's qualifications and independently inspect the Willing to tutor value. Return to Tutor Applications for panel/interview evidence when needed.",
          "重新读取辅导伙伴资格，另行查看愿意辅导值。需要时回到辅导伙伴申请查看评委及面试证据。",
        ),
      ],
    ],
    expected: t(
      "The reviewed qualification decision is recorded with its source, without silently changing willingness.",
      "审核的资格决定及其来源已记录，不会暗中改变意愿。",
    ),
    explanation: [
      t(
        "Manual grant/source removal and an additional qualification-application decision are separate operations. Neither restores suspended/revoked participation, creates a login or silently records tutoring willingness.",
        "手动资格授予、来源移除与额外资格申请决定是独立操作。两者都不会恢复暂停或撤销参与、创建登录或暗中记录辅导意愿。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Acceptance reports restricted participation",
          "接受操作提示参与受限",
        ),
        solution: t(
          "Review suspension, school departure and revoked tutoring access in Users & Roles. Restore access only through its authorized workflow, then retry the qualification decision from fresh evidence.",
          "在用户与角色检查暂停、离校及被撤销辅导权限。仅通过授权流程恢复权限，再依据最新证据重试资格决定。",
        ),
      },
    ],
    sources: [
      "src/server/api/routers/interview-management.ts",
      "src/server/qualifications.ts",
      "src/lib/approval-policy.ts",
      "src/app/_components/subject-availability.tsx",
    ],
    covers: [
      "manual qualification approval",
      "Coordinator manual qualification proposal",
      "approval source removal",
      "qualification versus access",
    ],
  }),
  guide({
    slug: "manage-tutor-roster",
    title: t("Inspect and edit the tutor roster", "查看与编辑辅导伙伴名册"),
    summary: t(
      "Read profiles, status, qualifications and account evidence, or create a roster record after the manual-entry warning.",
      "查看资料、状态、资格与账号证据，或在手动录入警告后创建名册记录。",
    ),
    route: "/admin/tutors",
    screenshot: "admin-tutors",
    focus: t(
      "Find Edit profile and View user details in the rightmost Actions column.",
      "在最右侧操作列找到编辑资料与查看用户详情。",
    ),
    steps: [
      [
        t("Choose current or past records", "选择当前或历史记录"),
        t(
          "Search the tutor's saved names and inspect the current/past filters. Read status and academic summary before opening View user details.",
          "按辅导伙伴保存姓名搜索并检查当前、历史筛选。打开查看用户详情前阅读状态与学业摘要。",
        ),
      ],
      [
        t("Read or edit the profile", "阅读或编辑资料"),
        t(
          "View details shows grouped subjects, qualification sources, willingness, login status and account policy history. Use Edit profile for permitted changes and review old enrollment academics separately from current account academics.",
          "详情展示分组科目、资格来源、意愿、登录状态及账号政策历史。允许的变更使用编辑资料；原始入组学业资料与当前账号学业资料应分别审阅。",
        ),
      ],
      [
        t("Change roster status deliberately", "审慎变更名册状态"),
        t(
          "Open Edit profile and use Status to choose a permitted roster state, then save that section. Review account access separately in Users & Roles. An archived roster, a revoked Tutor badge and an opted-out member represent different states.",
          "打开编辑资料，在状态中选择允许的名册状态，再保存该区块。账号权限需另外在用户与角色中检查。归档名册、撤销辅导伙伴标记与退出成员是不同状态。",
        ),
      ],
      [
        t(
          "Create only when normal intake cannot",
          "仅在正常报名不适用时手动创建",
        ),
        t(
          "Choose Add Tutor, read the warning, check the acknowledgement and Continue. Complete the name fields marked required by the current form policy and optional Email/Grade, then choose Add Tutor. Read the saved or submitted-for-review result and inspect whether a separate account-setup step is needed.",
          "选择添加辅导伙伴，阅读警告、勾选确认并继续。按当前表单规则填写标记为必填的姓名字段及可选邮箱、年级，再选择添加辅导伙伴。阅读已保存或已提交审核结果，并检查是否仍需单独设置账号。",
        ),
      ],
    ],
    expected: t(
      "The roster reflects only the reviewed profile or membership change; accountless records remain explicitly accountless.",
      "名册仅反映已审阅资料或成员变更；无账号记录仍明确显示无账号。",
    ),
    explanation: [
      t(
        "Opening details grants no role-edit permission. A linked login and historical ownership are distinct from current participation. Legacy unsplit full names can be preserved when unrelated profile fields are edited.",
        "打开详情不会授予角色编辑权限。关联登录、历史归属与当前参与资格不同。编辑其他资料字段时可以保留旧的未拆分全名。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Save rejects a name or the tutor has no login",
          "保存拒绝姓名或辅导伙伴无法登录",
        ),
        solution: t(
          "If changing Latin name fields, provide the person's actual valid First Name; do not guess a split of an old full name. A missing email leaves manual creation accountless. Use the authorized setup workflow instead of creating another person.",
          "若变更拉丁字母姓名字段，应填写本人实际有效名字，不要猜测旧全名拆分。手动创建未填邮箱会保留为无账号记录。请使用授权设置流程，不要重复创建人员。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/tutors/page.tsx",
      "src/app/_components/tutor-details.tsx",
      "src/app/_components/tutor-profile-editor.tsx",
    ],
    covers: [
      "tutor roster search",
      "past tutors",
      "tutor details",
      "profile edits",
      "roster membership",
      "manual Add Tutor",
      "account policy evidence",
    ],
  }),
  guide({
    slug: "manage-tutee-roster",
    title: t("Inspect and edit the tutee roster", "查看与编辑学习伙伴名册"),
    summary: t(
      "Use one details reader for enrollment, choices, contact and history; understand accountless records and manual creation.",
      "在统一详情中查看入组、志愿、联系方式与历史，理解无账号记录和手动创建。",
    ),
    route: "/admin/tutees",
    screenshot: "admin-tutees",
    focus: t(
      "Use Current, History or All Records, then View details at the right.",
      "选择当前、历史或所有记录，再使用右侧查看详情。",
    ),
    steps: [
      [
        t("Find the enrollment", "查找入组记录"),
        t(
          "Choose Current, History or All Records and search saved first, last, preferred or additional-language names. Inspect the record's period rather than assuming one row represents all enrollments.",
          "选择当前、历史或所有记录，按保存的名、姓、偏好名或其他语言姓名搜索。检查记录学期，不要假设一行代表所有入组。",
        ),
      ],
      [
        t("Open full details", "打开完整详情"),
        t(
          "Choose View details in Actions. Read enrollment summary, first/second choices, email/account information and tutoring history. Use Previous/Next for history and Close to return to the same roster.",
          "在操作列选择查看详情。阅读入组摘要、第一和第二志愿、邮箱和账号信息及辅导历史。使用上一页、下一页浏览历史，关闭后返回原名册。",
        ),
      ],
      [
        t("Edit the right evidence", "编辑正确证据"),
        t(
          "Use Edit Profile for permitted contact/profile changes. Admin/Head manage historical links and invitations there. Compare original enrollment academics with current account academics before correcting either.",
          "允许的联系方式、资料变更使用编辑资料。管理员或负责人可在此管理历史关联和邀请。修正前比较原入组学业资料与当前账号学业资料。",
        ),
      ],
      [
        t("Use manual creation sparingly", "谨慎使用手动创建"),
        t(
          "For Add a Tutee, acknowledge the warning first, then enter names, academics and subject choices. Hide form preserves the draft during this visit; save or submit for review and verify the resulting roster entry.",
          "添加学习伙伴须先确认警告，再填写姓名、学业及科目志愿。隐藏表单会在本次访问保留草稿；保存或提交审核后检查生成名册。",
        ),
      ],
    ],
    expected: t(
      "The intended enrollment and history are visible; any edit or creation has a clear save/approval outcome.",
      "能看到预期入组及历史；编辑或创建具有明确保存或审核结果。",
    ),
    explanation: [
      t(
        "Accountless tutees remain in the roster. Historical ownership alone does not enable current-account verification. Observers see enrollment/subjects, while private contacts and history retain staff authorization.",
        "无账号学习伙伴仍保留在名册中。历史归属本身不会启用当前账号验证。观察者可看入组与科目，私人联系方式和历史仍需要工作人员权限。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "History failed or no email is available",
          "历史读取失败或没有邮箱",
        ),
        solution: t(
          "Use Retry inside history; the rest of the details remain available. A missing address is not a failed account read. Check the source profile and authorized ownership link before offering verification or setup.",
          "在历史区域使用重试，其他详情仍可用。没有地址不代表账号读取失败。提供验证或设置前检查来源资料及授权归属关联。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/tutees/page.tsx",
      "src/app/_components/tutee-details.tsx",
      "src/app/_components/tutee-editor.tsx",
    ],
    covers: [
      "Current/History/All Records",
      "tutee detail reader",
      "contact copying",
      "tutee history pagination",
      "tutee profile",
      "manual Add a Tutee",
      "accountless enrollment",
    ],
  }),
  guide({
    slug: "edit-pairings",
    title: t("Create or edit a teaching assignment", "创建或编辑辅导配对"),
    summary: t(
      "Review tutor, subjects, students and schedule; preserve saved groups and avoid duplicate manual creation.",
      "审核辅导伙伴、科目、学习伙伴及排课，保留已保存分组并避免重复手动创建。",
    ),
    route: "/admin/pairings",
    screenshot: "admin-pairings",
    focus: t(
      "Use View details or Edit in the Pairings table's Actions column.",
      "使用配对表操作列的查看详情或编辑。",
    ),
    steps: [
      [
        t("Inspect the existing assignment", "检查现有配对"),
        t(
          "Search/filter Pairings and open View details. Read the tutor, subject, students, schedule, room intent and explicit group membership before editing.",
          "搜索、筛选配对并打开查看详情。编辑前阅读辅导伙伴、科目、学习伙伴、排课、教室意图及明确分组成员。",
        ),
      ],
      [
        t("Edit the intended fields", "编辑预期字段"),
        t(
          "Open Edit and choose the correct tutor, subject, students and recurring time. Search does not remove already selected students; inspect the complete selected list before saving.",
          "打开编辑并选择正确辅导伙伴、科目、学习伙伴及固定时间。搜索不会移除已选学习伙伴；保存前检查完整已选清单。",
        ),
      ],
      [
        t("Review save or removal", "审阅保存或移除"),
        t(
          "Review named consequences, including affected group members and room changes. Confirm the intended change or the separate removal action, then read whether it applied or waits for approval.",
          "审阅明确后果，包括受影响组员及教室变更。确认预期变更或独立移除操作，再阅读是否已应用或待审核。",
        ),
      ],
      [
        t("Create only when required", "仅在必要时创建"),
        t(
          "New Pairing first requires the manual-creation warning acknowledgement. Keep its draft open if a response is lost; retry the unchanged attempt to recover the saved pairing. Start a new attempt explicitly for another assignment.",
          "新建配对首先要求确认手动创建警告。响应丢失时保持草稿开启，重试同一未变更操作以恢复已保存配对。另一配对须明确开始新操作。",
        ),
      ],
    ],
    expected: t(
      "The reviewed assignment is saved once, or its pending proposal is identifiable.",
      "已审阅配对仅保存一次，或能识别其待审提案。",
    ),
    explanation: [
      t(
        "Sharing a time or attendance submission does not combine independent bookings. Only explicit combined groups share the primary assignment's recurring schedule and planned room.",
        "相同时间或共同出勤提交不会合并独立预约。只有明确合并组才共享主配对固定排期及计划教室。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "An attempt already succeeded or the data changed",
          "操作已成功或数据已改变",
        ),
        solution: t(
          "Reload the saved record instead of changing and replaying an accepted creation draft. For stale edits, explicitly reload current evidence and review again. Retry refresh only reads after a completed save.",
          "重新加载已保存记录，不要修改并重放已接受的创建草稿。编辑过期时明确重载当前证据并重新审阅。保存完成后的重试刷新只会读取。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/pairings/page.tsx",
      "src/server/pairing-creation.ts",
      "src/server/pairing-groups.ts",
    ],
    covers: [
      "pairing details",
      "edit assignment",
      "student multiselect",
      "manual New Pairing",
      "pairing removal",
      "creation retry receipt",
      "group schedule",
    ],
  }),
  guide({
    slug: "allocate-planned-rooms",
    title: t("Allocate rooms and resolve shortages", "分配教室并处理空缺"),
    summary: t(
      "Choose automatic, fixed or no-room intent and review batch allocation across all pairings.",
      "选择自动、固定或无需实体教室，并审阅跨配对批量分配。",
    ),
    route: "/admin/pairings",
    screenshot: "admin-pairings",
    focus: t(
      "Inspect Room badges, Needs room and Auto assign all unassigned sessions.",
      "查看教室标记、需要教室筛选及自动分配所有未分配课程。",
    ),
    steps: [
      [
        t("Read the room state", "阅读教室状态"),
        t(
          "Open View details to distinguish Awaiting schedule, Needs room, No physical room and legacy unallocated records. Use Needs room to show actual shortages rather than every x badge.",
          "打开查看详情，区分待排课、需要教室、无需实体教室及旧未分配记录。需要教室筛选显示实际短缺，而非所有x标记。",
        ),
      ],
      [
        t("Choose room intent", "选择教室意图"),
        t(
          "Edit the pairing and select Automatic room allocation, a fixed staff-selected room, or No physical room. Review group subjects affected. A fixed room must be deliberately released to Automatic if desired.",
          "编辑配对并选择自动教室分配、工作人员固定教室或无需实体教室。审阅受影响组内科目。固定教室须明确改为自动才会释放。",
        ),
      ],
      [
        t("Retry or batch allocate", "重试或批量分配"),
        t(
          "After capacity becomes available, retry the shortage or choose Auto assign all unassigned sessions. Review the full unfiltered reservation list; a combined group appears once. Confirm or submit for review.",
          "容量恢复后重试短缺，或选择自动分配所有未分配课程。审阅不受当前筛选限制的完整预约清单；合并组只出现一次。确认或提交审核。",
        ),
      ],
      [
        t("Check the result counts", "核对结果数量"),
        t(
          "Read assigned and still-unassigned counts and return to remaining shortages. Existing rooms, fixed choices, awaiting schedules and intentional no-room choices are preserved by the batch.",
          "阅读已分配和仍未分配数量，再处理剩余短缺。批量操作会保留已有教室、固定选择、待排课及有意无需教室选择。",
        ),
      ],
    ],
    expected: t(
      "Each reviewed reservation has its current room state; remaining shortages stay visible for follow-up.",
      "每个已审阅预约显示当前教室状态，剩余短缺仍清楚可见以便跟进。",
    ),
    explanation: [
      t(
        "A pending automatic-room proposal reserves nothing: allocation occurs on approval. Planned-room changes do not rewrite actual attendance locations. Automatic assignment must be effectively enabled and the batch is bounded to 500 pairing records.",
        "待审自动教室提案不会预约教室，批准时才分配。计划教室变更不会重写实际出勤地点。自动分配须已生效启用，批量上限为500条配对记录。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Saving leaves Needs room", "保存后仍需要教室"),
        solution: t(
          "The schedule may have saved successfully without capacity. Check room blocks and conflicting fixed reservations, then deliberately retry when capacity changes. Repeated unchanged retries do not create capacity or move fixed bookings.",
          "排课可能已成功保存，但容量不足。检查教室禁用时段和冲突固定预约，容量变化后再明确重试。重复相同重试不会增加容量或移动固定预约。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/pairings/page.tsx",
      "src/server/room-allocation.ts",
      "src/server/room-bookings.ts",
    ],
    covers: [
      "room badges",
      "Needs room",
      "automatic/fixed/no physical room",
      "group reservations",
      "retry allocation",
      "batch auto-assign",
      "allocation result counts",
    ],
  }),
  guide({
    slug: "maintain-time-slots",
    category: "administration",
    title: t("Maintain recurring time slots", "维护固定时间段"),
    summary: t(
      "Create, edit, deactivate/reactivate or delete timetable slots and inspect changes before they propagate.",
      "创建、编辑、停用、重新启用或删除课表时间段，并在传播变更前检查影响。",
    ),
    route: "/admin/time-slots",
    screenshot: "admin-time-slots",
    focus: t(
      "Use the time-slot list and its named row actions.",
      "使用时间段列表及其明确的行操作。",
    ),
    steps: [
      [
        t("Read existing slots", "查看现有时间段"),
        t(
          "Open Time Slots and locate the relevant day/time in the list. Read its Active state and inspect the program timezone before entering clock times.",
          "打开时间段，在列表定位相应日期和时间。阅读启用状态，输入钟表时间前检查项目时区。",
        ),
      ],
      [
        t("Create or edit", "创建或编辑"),
        t(
          "Use the add or edit action, enter the labelled day and start/end values, and read validation. Review which existing assignments may use the slot before saving.",
          "使用添加或编辑操作，填写有标签的日期及开始、结束值并阅读验证提示。保存前检查哪些现有配对可能使用该时间段。",
        ),
      ],
      [
        t("Deactivate or delete deliberately", "审慎停用或删除"),
        t(
          "In Edit, change the Active checkbox to deactivate/reactivate the slot and review the named change. Delete is a separate consequence-reviewed action. Save or submit the permitted Coordinator proposal as shown.",
          "在编辑中更改启用复选框以停用或重新启用时间段，并审核明确变更。删除属于独立后果审阅操作。按显示保存或提交允许协调员提案。",
        ),
      ],
      [
        t("Check dependent scheduling", "检查依赖排课"),
        t(
          "After an applied change, inspect Pairings and relevant timetable displays. Read Retry recovery if a refresh failed instead of repeating the edit.",
          "变更应用后检查配对及相关课表显示。刷新失败时使用重试恢复，不要重复编辑。",
        ),
      ],
    ],
    expected: t(
      "The reviewed slot and active state are visible with any required approval receipt.",
      "已审阅时间段及启用状态可见，并可查看必要审核回执。",
    ),
    explanation: [
      t(
        "A shared slot is timetable configuration, not a dated attendance record. Review dependent schedules when changing it; historical actual lesson evidence retains its own recorded values.",
        "共享时间段属于课表配置，并非特定日期出勤记录。变更时须审阅依赖排课；历史实际课程证据保留自身记录值。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The form or list cannot reload", "表单或列表无法重载"),
        solution: t(
          "Keep the draft open and use Retry for the required read. If the source changed, use explicit Reload and reread the values. Do not create a near-duplicate slot to bypass the error.",
          "保持草稿开启并重试必要读取。若来源改变，明确重新加载并再读数值。不要创建近似重复时间段来绕过错误。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/time-slots/page.tsx",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "time slot creation",
      "time slot edits",
      "Active checkbox deactivate/reactivate",
      "time slot deletion",
      "schedule propagation",
    ],
  }),
  guide({
    slug: "maintain-rooms",
    category: "administration",
    title: t("Maintain rooms and unavailable periods", "维护教室及不可用时段"),
    summary: t(
      "Keep the room catalogue accurate and block unavailable periods before allocating lessons.",
      "准确维护教室目录，并在分配课程前标记不可用时段。",
    ),
    route: "/admin/rooms",
    screenshot: "admin-rooms",
    focus: t(
      "Open room actions and the room-unavailability grid.",
      "打开教室操作及教室不可用时段网格。",
    ),
    steps: [
      [
        t("Inspect the room", "检查教室"),
        t(
          "Open Rooms, locate the saved room name and choose Edit details to inspect its recurring unavailable periods. Check existing bookings in Pairings before changing room availability.",
          "打开教室，按保存名称找到教室，再选择编辑详情查看每周重复的不可用时段。变更教室可用性前，在配对中核对现有预约。",
        ),
      ],
      [
        t("Edit catalogue details", "编辑目录资料"),
        t(
          "Use Add Room for a new name or the existing room's edit action to rename it. Review deletion separately and inspect affected-booking consequences. Use the room-order editor when changing allocation priority/order.",
          "新名称使用添加教室，现有教室可用编辑操作改名。删除应独立审阅并检查受影响预约后果。更改分配优先级、顺序时使用教室排序编辑器。",
        ),
      ],
      [
        t("Mark unavailability", "标记不可用"),
        t(
          "Choose Edit details, then Add blocked period. Enter Day, Start time, End time and optional Reason, check the named room and range, then choose Save blocked period or the Coordinator's Submit request. Use Edit period for an existing block and review removal separately.",
          "选择编辑详情，再选择添加禁用时段。填写星期、开始时间、结束时间及可选理由，核对具体教室和范围，再保存禁用时段；协调员选择提交申请。已有时段使用编辑时段，移除需单独审阅。",
        ),
      ],
      [
        t("Recheck pairings", "重新检查配对"),
        t(
          "Inspect affected Pairings and any remaining Needs room records. A room catalogue edit is not an instruction to silently move a staff-fixed booking.",
          "检查受影响配对及仍需教室的记录。教室目录编辑不会暗中移动工作人员固定预约。",
        ),
      ],
    ],
    expected: t(
      "The catalogue and blocked periods match the reviewed room availability.",
      "目录及禁用时段与审阅后的教室可用性一致。",
    ),
    explanation: [
      t(
        "Planned allocation uses room capacity and booking constraints. Actual lesson location is recorded separately in attendance. Inspect the full room reader when a compact grid cell cannot show every detail.",
        "计划分配使用教室容量及预约约束。实际辅导地点在出勤中单独记录。紧凑网格无法显示全部细节时，应打开完整教室详情。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("A reservation still conflicts", "预约仍冲突"),
        solution: t(
          "Open the pairing's room intent and identify fixed, automatic or intentional no-room state. Resolve the specific room/time conflict before retrying allocation; do not overwrite attendance to fix a planned booking.",
          "打开配对教室意图，分辨固定、自动或有意无需教室状态。先解决具体教室、时间冲突，再重试分配；不要通过改出勤修复计划预约。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/rooms/page.tsx",
      "src/server/room-bookings.ts",
      "src/server/room-allocation.ts",
    ],
    covers: [
      "room catalogue",
      "Add Room",
      "room rename",
      "room deletion",
      "room order",
      "room unavailability add/edit/delete",
      "reservation conflicts",
    ],
  }),
  guide({
    slug: "maintain-subject-catalogue",
    category: "administration",
    title: t("Maintain subjects, groups and levels", "维护科目、分组及级别"),
    summary: t(
      "Search and batch-edit offered courses or import a reviewed catalogue without changing saved qualification history.",
      "搜索、批量编辑所提供课程或导入经审阅目录，同时保留已保存资格历史。",
    ),
    route: "/admin/subjects",
    screenshot: "admin-subjects",
    focus: t(
      "Use course search, group/level editors and visible-row batch selection.",
      "使用课程搜索、分组与级别编辑器及可见行批量选择。",
    ),
    steps: [
      [
        t("Find the course group", "查找课程分组"),
        t(
          "Open Subjects & Levels and search the saved course/group/variant names. Inspect inactive entries as well as the currently offered catalogue.",
          "打开科目与级别，按保存的课程、分组或变体名称搜索。除当前开设目录外，也检查已停用条目。",
        ),
      ],
      [
        t("Edit an individual course or level", "编辑单个课程或级别"),
        t(
          "In the group editor choose the offered levels, then Save group; unselected levels become inactive. Select an offering again and save to restore it. Level-name and prefix fields save when you leave them; AP-score toggles and ordering arrows submit immediately. Read the saved or Coordinator review-request result after each change.",
          "在科目组编辑器选择开设级别，再选择保存科目组；未选级别会停用。重新勾选并保存可恢复开设。级别名称及前缀在离开输入框时保存；AP计分选项和排序箭头会立即提交。每次变更后均应阅读保存或协调员审核申请结果。",
        ),
      ],
      [
        t("Review batch selection", "审阅批量选择"),
        t(
          "Select the intended visible courses. Choose Set level and/or Set status, check the selected count and hidden-selection notice, then choose Apply to N visible selected. This submits immediately; only visible selected courses change. Read the actual save or approval-request result.",
          "勾选预期可见课程，使用设置级别及／或设置状态，核对已选数量及隐藏选择提示，再选择应用于N门可见已选课程。此操作立即提交，只有可见且已选的课程会变更。阅读实际保存或审核申请结果。",
        ),
      ],
      [
        t("Import a catalogue deliberately", "审慎导入目录"),
        t(
          "Read the import help and download the example before selecting a JSON or CSV file. Selecting a valid file immediately submits its parsed catalogue changes. A permitted Coordinator import queues a review request. Read the actual import result or error, then reload the course list after an applied change.",
          "选择JSON或CSV文件前，先阅读导入说明并下载示例。选中有效文件会立即提交解析后的目录变更。协调员获准发起的导入会进入审核申请。阅读实际导入结果或错误，应用变更后重新读取课程清单。",
        ),
      ],
    ],
    expected: t(
      "The intended catalogue changes are saved or queued, with existing qualification evidence retained.",
      "预期目录变更已保存或待审，现有资格证据仍保留。",
    ),
    explanation: [
      t(
        "Saved qualification grants are snapshots of approved sources. Reordering levels does not retroactively grant or remove historical qualifications. Restoring an archived group/level remains subject to current management authority.",
        "已保存资格是获批来源的快照。重排级别不会追溯授予或移除历史资格。恢复归档分组或级别仍受当前管理权限约束。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Import validation fails or a batch contains the wrong courses",
          "导入验证失败或批量包含错误课程",
        ),
        solution: t(
          "For an import error, correct the file using the displayed format before selecting it again. For a batch that has not been applied, use Clear selection or correct the visible selections. Inspect IDs/names again; a hidden selection may not match the current filter.",
          "导入出错时，应按显示格式修正文件后再重新选择。尚未应用的批量操作可用清除选择，或修正可见选择。重新检查ID及名称；隐藏选择可能不符合当前筛选。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/subjects/page.tsx",
      "src/lib/approval-policy.ts",
      "src/server/api/routers/admin.ts",
    ],
    covers: [
      "subjects/groups/levels",
      "catalogue search",
      "batch course edit",
      "archive/restore subjects",
      "JSON/CSV catalogue import",
      "catalogue ordering",
    ],
  }),
  guide({
    slug: "review-tutor-membership",
    title: t("Review tutor opt-out and reentry", "审核辅导伙伴退出及重新加入"),
    summary: t(
      "Check pending membership requests, respect waiting periods and requeue affected students explicitly.",
      "核对待处理成员申请、遵守等待期，并明确将受影响学习伙伴重新排队。",
    ),
    route: "/admin/tutor-requests",
    screenshot: "admin-tutor-requests",
    focus: t(
      "Find the pending tutor, request type, reason and available decision controls.",
      "找到待处理申请的辅导伙伴、申请类型、原因及可用决定控件。",
    ),
    steps: [
      [
        t("Find the pending request", "找到待处理申请"),
        t(
          "In Tutor Status Requests, check the tutor, request type and reason. An opt-out may show the approval date and number of affected students. Check current membership in Tutor Roster and earlier decisions in the Audit Log if you have access.",
          "在辅导伙伴状态申请核对辅导伙伴、申请类型及原因。退出申请可能显示可审批日期及受影响学习伙伴人数。在辅导伙伴名册核对当前资格，并在有权限时通过审计日志查看过去的决定。",
        ),
      ],
      [
        t("Check eligibility and timing", "核对资格与时间"),
        t(
          "Opt-out approval requires seven elapsed days; reentry has no seven-day wait. Confirm the request is still pending and membership has not changed since submission.",
          "退出批准须经过七天；重新加入不需要七天等待。确认申请仍待处理，且成员状态自提交后未改变。",
        ),
      ],
      [
        t("Submit the decision", "提交决定"),
        t(
          "Check the tutor, reason and any affected students before choosing Approve or Deny. Both buttons submit immediately. Verify the updated roster after a direct decision or follow the Coordinator proposal in Management Actions.",
          "选择审批通过或拒绝前，核对辅导伙伴、原因及受影响学习伙伴。两个按钮均会立即提交。直接决定后核对更新的名册，或在管理操作中跟进协调员提案。",
        ),
      ],
      [
        t("Requeue affected students", "重新安排受影响学习伙伴"),
        t(
          "After an opt-out is applied, the prompt identifies any affected students. Choose Re-Queue Tutees to return them to matching, or Not Now to leave them for later review. Verify the signup queue and remaining pairings.",
          "退出应用后，提示会标出受影响的学习伙伴。选择重新加入队列将他们送回待匹配，或选择暂不操作以便稍后审核。核对报名队列及剩余配对。",
        ),
      ],
    ],
    expected: t(
      "Membership changes only through the reviewed decision; student matching consequences are handled explicitly.",
      "成员资格仅通过审阅决定变更，学习伙伴匹配后果得到明确处理。",
    ),
    explanation: [
      t(
        "A participant's request does not immediately end ACTIVE membership. Recall, withdrawal of an unapplied proposal and reversal of an applied decision are different actions with different authority.",
        "参与者提交申请不会立即结束活跃成员资格。撤回、撤销未应用提案及逆转已应用决定是不同操作，权限也不同。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Decision is unavailable or stale",
          "决定操作不可用或已过时",
        ),
        solution: t(
          "Check the elapsed waiting period and current membership. If another change superseded the request, decline the stale request and review the current roster rather than force-applying old evidence.",
          "检查等待期及当前成员状态。若其他变更已取代申请，应拒绝过时申请并检查当前名册，不要强行应用旧证据。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/tutor-requests/page.tsx",
      "src/server/membership.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "tutor opt-out review",
      "tutor reentry review",
      "seven-day wait",
      "student requeue",
      "membership decision history",
    ],
  }),
  guide({
    slug: "review-tutee-withdrawals",
    title: t("Review tutee withdrawals and removals", "审核学习伙伴退出与移除"),
    summary: t(
      "Distinguish self-submitted withdrawal, tutor relay and disciplinary removal before deciding.",
      "决定前区分本人退出、辅导伙伴转达及纪律移除。",
    ),
    route: "/admin/tutee-requests",
    screenshot: "admin-tutee-requests",
    focus: t(
      "Read source, scope and effective date in Withdrawal Requests & Removals.",
      "在退出申请与移除中阅读来源、范围及生效日期。",
    ),
    steps: [
      [
        t("Choose the correct request section", "选择正确申请区"),
        t(
          "Open Withdrawal Requests & Removals. Separate self-submitted withdrawals from tutor-relayed requests and read the student, source, scope and submitted time.",
          "打开退出申请与移除。区分本人提交与辅导伙伴转达申请，阅读学习伙伴、来源、范围及提交时间。",
        ),
      ],
      [
        t("Review effective timing", "审核生效时间"),
        t(
          "Read the approval-dependent effective date for a self-request. Tutor relays retain their own seven-day recall window and exact scheduled effective time; staff can cancel a relay before it takes effect.",
          "阅读本人申请中取决于批准的生效日期。辅导伙伴转达保留独立七天撤回窗口和精确预定生效时间；工作人员可在生效前取消。",
        ),
      ],
      [
        t("Decide the exact scope", "决定具体范围"),
        t(
          "Open the full reason and related participation evidence, review the affected choices or membership and confirm the appropriate approval, decline or cancellation action.",
          "打开完整原因及相关参与证据，审阅受影响志愿或成员资格，再确认适当批准、拒绝或取消操作。",
        ),
      ],
      [
        t("Check the retained history", "检查保留历史"),
        t(
          "After an applied result, inspect current request status and affected assignments. Use resolved history to verify the source and timing rather than deleting old request evidence.",
          "应用结果后检查当前申请状态及受影响分配。使用已处理历史验证来源和时间，不要删除旧申请证据。",
        ),
      ],
    ],
    expected: t(
      "The correct withdrawal/removal scope and timing are recorded without confusing separate request types.",
      "正确退出或移除范围及时间已记录，不会混淆不同申请类型。",
    ),
    explanation: [
      t(
        "Signup-invalidity appeals and disciplinary-card appeals are separate from withdrawal review. A reversal of applied participation consequences requires the current review authority and fresh evidence.",
        "报名无效申诉、纪律卡申诉与退出审核相互独立。逆转已生效参与后果需要当前审核权限和最新证据。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The student's status changed while reviewing",
          "审核时学习伙伴状态已改变",
        ),
        solution: t(
          "Keep your note, reload the authoritative request and reread the affected scope. Do not treat a transient queue error as no pending work or submit an old decision after a confirmed conflict.",
          "保留说明，重新读取权威申请并再次阅读影响范围。不要把暂时队列错误当作无待办，也不要在确认冲突后提交旧决定。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/tutee-requests/page.tsx",
      "src/app/(admin)/admin/tutee-requests/student-withdrawals.tsx",
      "src/server/membership.ts",
    ],
    covers: [
      "self withdrawal review",
      "tutor-relayed removal",
      "relay cancellation",
      "withdrawal scope/effective date",
      "resolved withdrawal history",
    ],
  }),
  guide({
    slug: "manage-crew-membership",
    title: t(
      "Manage Crew applications and patrol settings",
      "管理巡视组申请及设置",
    ),
    summary: t(
      "Review public applications, membership requests, the roster and patrol configuration in separate panels.",
      "在独立面板审核公开申请、成员申请、名册及巡视配置。",
    ),
    route: "/admin/crew",
    screenshot: "admin-crew",
    focus: t(
      "Use the Crew review, roster and patrol-settings panels.",
      "使用巡视组审核、名册及巡视设置面板。",
    ),
    steps: [
      [
        t("Review the application", "审核申请"),
        t(
          "Open Crew review work and inspect the verified application and current membership. Approve or decline the intended application after reading its reason and identity.",
          "打开巡视组审核，检查已验证申请及当前成员资格。阅读原因和身份后，批准或拒绝预期申请。",
        ),
      ],
      [
        t("Follow invitation setup", "跟进邀请设置"),
        t(
          "An approved public applicant still completes fresh mailbox verification and the shared invitation/account review before Crew access is added. Check the displayed setup status instead of assuming approval created a login.",
          "公开申请获批后，申请人仍须完成新邮箱验证及共享邀请、账号审阅，才能添加巡视组权限。检查显示的设置状态，不要假设批准就已创建登录。",
        ),
      ],
      [
        t("Review opt-out or reentry", "审核退出或重新加入"),
        t(
          "Read membership requests separately. Opt-out approval waits seven days; reentry has no seven-day wait. Check recalls and the current member status before confirming.",
          "单独阅读成员申请。退出批准需等待七天；重新加入无七天等待。确认前检查撤回及当前成员状态。",
        ),
      ],
      [
        t("Edit patrol settings", "编辑巡视设置"),
        t(
          "Open the settings panel, review the labelled patrol requirements and save through the shown authority path. Read patrol history or use its correction workflow for an existing observation.",
          "打开设置面板，审阅有标签的巡视要求，并按显示权限路径保存。已有观察记录应通过巡视历史或对应修正流程处理。",
        ),
      ],
    ],
    expected: t(
      "Application, account setup, membership and patrol configuration remain clearly separated.",
      "申请、账号设置、成员资格及巡视配置保持清晰分离。",
    ),
    explanation: [
      t(
        "Crew membership can coexist with Tutor access. Turning off the optional Crew module affects entry and actions; saved patrol and membership evidence remains historical evidence.",
        "巡视组成员资格可与辅导伙伴权限并存。关闭可选巡视组模块会影响入口与操作；已保存巡视及成员证据仍属于历史记录。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "An approved applicant cannot enter Patrol",
          "已批准申请人无法进入巡视",
        ),
        solution: t(
          "Check invitation redemption, current ACTIVE Crew status, account suspension/departure and the effective Crew feature. Reissue/setup controls follow their own eligibility and do not bypass account review.",
          "检查邀请兑换、当前活跃巡视组状态、账号暂停或离校及已生效巡视功能。重新发放或设置控件有各自条件，不能绕过账号审阅。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/crew/page.tsx",
      "src/app/_components/patrol-corrections.tsx",
      "src/server/api/routers/crew.ts",
    ],
    covers: [
      "Crew application review",
      "Crew roster",
      "Crew invitation setup",
      "Crew opt-out/reentry",
      "patrol settings",
      "Crew history",
    ],
  }),
  guide({
    slug: "manage-meetings",
    title: t("Create meetings and record attendance", "创建会议并记录出席"),
    summary: t(
      "Maintain meeting details, excuses, per-meeting drafts and historical comparison by period.",
      "按学期维护会议详情、请假、各会议草稿及历史比较。",
    ),
    route: "/admin/meetings",
    screenshot: "admin-meetings",
    focus: t(
      "Open a meeting for attendance; use Meeting history for previous periods.",
      "打开会议填写出席，使用会议历史查看先前学期。",
    ),
    steps: [
      [
        t("Choose the period and meeting", "选择学期及会议"),
        t(
          "Meetings starts in the current program period, including meetings already held. Open Meeting history and a labelled period for earlier records; Show past tutors changes people, not meeting periods.",
          "会议默认显示当前项目学期，包括已经举行的会议。较早记录请打开会议历史并选择具体学期；显示过往辅导伙伴只改变人员，不改变会议学期。",
        ),
      ],
      [
        t("Create a meeting or review deletion", "创建会议或核对删除"),
        t(
          "In the current period, enter Meeting title, Date and Time, check the date and program timezone, then choose Create. Use a meeting's Delete action for its separate named confirmation; Cancel returns without deleting it.",
          "在当前周期填写会议标题、日期及时间，核对日期和项目时区，再选择创建。会议的删除操作会打开独立明确确认；取消会返回且不删除。",
        ),
      ],
      [
        t("Save attendance explicitly", "明确保存出席"),
        t(
          "Expand a meeting, choose each tutor's attendance status and inspect excuse evidence, then use that meeting's attendance save action. Collapsing the meeting does not save or discard its current-visit draft.",
          "展开会议，选择各辅导伙伴出席状态并检查请假证据，再使用该会议出席保存操作。折叠会议不会保存或丢弃本次访问草稿。",
        ),
      ],
      [
        t("Compare and correct", "比较并修正"),
        t(
          "Use the period's totals/comparison to inspect outcomes. For a correction, review credits and related consequences as one change. If period grouping changes, review Reload groups before discarding drafts.",
          "使用学期总计或比较检查结果。修正时将学时及相关后果作为一个整体审阅。若学期分组发生变化，丢弃草稿前先审阅重新加载分组。",
        ),
      ],
    ],
    expected: t(
      "Meeting details and attendance have explicit saved results, with historical period evidence retained.",
      "会议详情与出席拥有明确保存结果，同时保留历史学期证据。",
    ),
    explanation: [
      t(
        "Recorded attendance takes precedence over a tutor's present-day membership in historical views. Drafts are retained per opened meeting during this visit; a browser reload is not draft storage.",
        "历史视图以已记录出席为准，不以辅导伙伴当前成员状态取代。各已打开会议草稿在本次访问分别保留；浏览器重载不提供草稿存储。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Save succeeded but totals did not refresh",
          "保存成功但总计未刷新",
        ),
        solution: t(
          "Use the read-only Retry refresh; do not save the attendance a second time. Scroll the comparison table's own horizontal region on small screens to reach remaining columns.",
          "使用只读重试刷新，不要再次保存出席。小屏幕可在比较表自己的水平区域滚动以查看剩余列。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/meetings/page.tsx",
      "src/server/meeting-hours.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "meeting creation/edit/delete",
      "attendance status",
      "meeting excuses",
      "per-meeting draft",
      "meeting period history",
      "Show past tutors",
      "attendance comparison",
      "Reload groups",
    ],
  }),
  guide({
    slug: "correct-attendance",
    title: t("Inspect and correct lesson attendance", "检查并修正课程出勤"),
    summary: t(
      "Read actual session evidence and submit a reasoned correction with its hours and discipline consequences.",
      "阅读实际课程证据，并提交包含学时与纪律后果的有理由修正。",
    ),
    route: "/admin/attendance",
    screenshot: "admin-attendance",
    focus: t(
      "Locate the lesson and open its full attendance details before correcting.",
      "定位课程，修正前先打开完整出勤详情。",
    ),
    steps: [
      [
        t("Find the submitted session", "查找已提交课程"),
        t(
          "Open Attendance Submissions and use the available person/date/period filters. Read the actual time, room, tutor/student attendance, comments and any cards rather than relying on the recurring plan.",
          "打开出勤提交并使用人员、日期或学期筛选。阅读实际时间、教室、辅导伙伴及学习伙伴出勤、备注和卡片，不要仅依赖固定计划。",
        ),
      ],
      [
        t("Open the correction", "打开修正"),
        t(
          "Choose the authorized correction action and enter corrected actual values with a clear reason. Review the original and proposed evidence together.",
          "选择授权修正操作，填写修正后的实际值及清楚原因。一起审阅原始和拟修改证据。",
        ),
      ],
      [
        t("Review all consequences", "审核全部后果"),
        t(
          "Read any recalculated credits, flags, deductions or participation effects. Submit the complete correction through direct Admin/Head application or the eligible Coordinator review path.",
          "阅读重新计算的学时、标记、扣减或参与影响。通过管理员或负责人直接应用，或符合条件的协调员审核路径，提交完整修正。",
        ),
      ],
      [
        t("Verify related records", "验证相关记录"),
        t(
          "Check corrected attendance, Service Hours and affected discipline/flag history. A successful result followed by a failed read calls for Retry refresh, not another correction.",
          "检查修正出勤、服务时数及受影响纪律或标记历史。操作成功但读取失败时应重试刷新，而非再次修正。",
        ),
      ],
    ],
    expected: t(
      "The actual attendance and dependent effects reflect the one reviewed correction, with its reason retained.",
      "实际出勤及依赖后果反映同一个已审阅修正，并保留原因。",
    ),
    explanation: [
      t(
        "Planned schedules and actual records are different evidence. A correction can reverse already reviewed effects, so the entire consequence set follows current review authority rather than applying safe-looking fields early.",
        "计划排期和实际记录是不同证据。修正可能逆转已审阅后果，因此全部后果须遵循当前审核权限，不能提前应用看似简单的字段。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The historical record is locked or changed",
          "历史记录被锁定或已改变",
        ),
        solution: t(
          "Read the stated period, source or review restriction. Reload fresh evidence for a version conflict and use the supported correction route; never edit a planned pairing to imitate a historical correction.",
          "阅读所述学期、来源或审核限制。版本冲突时重载新证据并使用支持的修正路径；不要编辑计划配对来模拟历史修正。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/attendance/page.tsx",
      "src/server/api/routers/corrections.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "attendance inspection",
      "historical attendance correction",
      "correction reasons",
      "dependent hours/discipline effects",
    ],
  }),
  guide({
    slug: "review-patrol-flags",
    title: t(
      "Review patrol evidence and attendance flags",
      "审核巡视证据及出勤标记",
    ),
    summary: t(
      "Compare lesson and patrol evidence, decide a flag and correct an observation through its own workflow.",
      "比较课程与巡视证据、决定标记，并通过对应流程修正观察。",
    ),
    route: "/admin/session-flags",
    screenshot: "admin-session-flags",
    focus: t(
      "Open a flagged lesson to compare attendance and patrol observations.",
      "打开标记课程，比较出勤与巡视观察。",
    ),
    steps: [
      [
        t("Read all evidence", "阅读全部证据"),
        t(
          "Open Attendance Flags and inspect the lesson, claimed time/location and related Crew observations. Check observation times and headcounts; a mismatch needs human review.",
          "打开出勤标记，检查课程、申报时间地点及相关巡视观察。核对观察时间及人数；不一致需要人工审核。",
        ),
      ],
      [
        t("Record a reasoned decision", "记录有理由的决定"),
        t(
          "Open the flag review, read prior status and enter the required reason. Confirm only the displayed decision and any associated deductions or other consequences.",
          "打开标记审核，阅读原状态并填写必要原因。仅确认显示的决定及相关扣减或其他后果。",
        ),
      ],
      [
        t("Correct the source when necessary", "必要时修正来源"),
        t(
          "If patrol evidence is wrong, open Crew patrol history and use its correction action with a reason. If attendance is wrong, use the lesson correction. Do not overwrite one source to conceal a mismatch in another.",
          "若巡视证据错误，打开巡视历史并使用带原因的修正操作；若出勤错误，使用课程修正。不要覆盖一个来源来掩盖另一个来源的不一致。",
        ),
      ],
      [
        t("Verify recalculation", "验证重新计算"),
        t(
          "After the applied correction/decision, inspect the flag state and relevant hours. Later changes to reviewed deductions must follow current reversal authority.",
          "修正或决定应用后，检查标记状态及相关学时。后续改变已审核扣减必须遵循当前逆转权限。",
        ),
      ],
    ],
    expected: t(
      "The reviewed flag has a recorded outcome and each evidence source retains its own correction trail.",
      "已审核标记有记录结果，各证据来源保留各自修正轨迹。",
    ),
    explanation: [
      t(
        "A patrol observation is supporting evidence, not an automatic verdict. Correcting observations can reconsider related flags/deductions while preserving the saved patrol hours; it does not re-award Crew credit.",
        "巡视观察是支持证据，不是自动裁决。修正观察可重新考虑相关标记、扣减，但保留已保存巡视学时，不会重新授予巡视学时。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The flag reappears or a correction awaits review",
          "标记再次出现或修正待审",
        ),
        solution: t(
          "Read the latest underlying attendance/patrol versions and the correction receipt. A pending proposal changes no live evidence; resolve its review before assuming the flag was cleared.",
          "阅读最新出勤、巡视版本及修正回执。待审提案不会改变实际证据；应先完成审核，再认为标记已清除。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/session-flags/page.tsx",
      "src/server/api/routers/corrections.ts",
      "src/server/api/routers/crew.ts",
    ],
    covers: [
      "attendance flag evidence",
      "flag approval/rejection",
      "patrol correction",
      "flag deductions",
      "source comparison",
    ],
  }),
  guide({
    slug: "review-discipline-and-appeals",
    title: t("Review disciplinary cards and appeals", "审核纪律卡及申诉"),
    summary: t(
      "Inspect the complete lesson record, decide a card and handle school-day appeal deadlines.",
      "查看完整课程记录、决定纪律卡并处理上课日申诉截止时间。",
    ),
    route: "/admin/discipline",
    screenshot: "admin-discipline",
    focus: t(
      "Open the card's review and full record before deciding.",
      "决定前打开纪律卡审核及完整记录。",
    ),
    steps: [
      [
        t("Inspect the card evidence", "检查纪律卡证据"),
        t(
          "In Tutee Discipline, find the named card in Pending Review. Read its reason, issuer and recorded session context. Open View details in Tutee Standing to check the student's current effective cards.",
          "在学习伙伴纪律页面的“待复核”中找到对应纪律卡。阅读原因、签发者及已记录的课次情况。在“学习伙伴纪律状态”选择“查看详情”，核对该学习伙伴目前计入的有效纪律卡。",
        ),
      ],
      [
        t("Review validation", "审核有效性"),
        t(
          "Choose Edit on the named pending card. Check its reason and add relevant context in Review note (optional). Valid or Invalid submits the decision immediately. Changes to a prior decision follow current Admin/Head review rules.",
          "在对应待复核纪律卡中选择“编辑”。核对原因，并在“复核备注（可选）”中补充相关情况。选择“有效”或“无效”即提交决定。更改先前决定须遵循当前管理员或负责人复核规则。",
        ),
      ],
      [
        t("Open card appeals", "打开纪律卡申诉"),
        t(
          "In Tutee Support, open Tutee Appeals and select Pending. Read the card reason and appeal, choose Overturn Card or Reject Appeal, then enter a Decision Reason and submit. Use the School calendar in Program Settings link to check which days count as school days.",
          "在“学习伙伴支持”中打开“学习伙伴申诉”，选择“待处理”。阅读纪律卡原因和申诉内容，选择“撤销纪律记录”或“驳回申诉”，填写“决定理由”后提交。通过“在项目设置中管理学校日历”链接核对哪些日期计为上课日。",
        ),
      ],
      [
        t("Verify the resulting standing", "验证最终纪律状态"),
        t(
          "In Tutee Standing, check the current status and choose View details to see the valid cards. Select Resolved in Tutee Appeals for any appeal decision. If standing shows removal pending, track the participation change separately in Withdrawal Requests & Removals.",
          "在“学习伙伴纪律状态”中核对当前状态，并选择“查看详情”查看有效纪律卡。在“学习伙伴申诉”中选择“已处理”可查看申诉决定。若纪律状态显示“待移除”，请在“退出申请与移除”中单独跟进参与状态变更。",
        ),
      ],
    ],
    expected: t(
      "The card and appeal have a reasoned current outcome, with historical evidence retained.",
      "卡片及申诉拥有有理由的当前结果，同时保留历史证据。",
    ),
    explanation: [
      t(
        "Effective cards, not every submitted allegation, determine standing. School-calendar overrides affect the five-school-day disciplinary appeal window. Signup-invalidity appeals use the signup request's separate review.",
        "有效卡片而非所有已提交指控决定纪律状态。学校日历覆盖会影响五个上课日纪律申诉窗口。报名无效申诉使用报名申请的独立审核。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The deadline seems different from calendar days",
          "截止时间似乎不同于日历天数",
        ),
        solution: t(
          "Follow the school-calendar link to Program Settings → Recruitment and Refresh and inspect overrides. Do not extend an appeal by changing unrelated request dates; use the displayed authoritative deadline.",
          "通过学校日历链接进入项目设置→招募及换期并检查覆盖设置。不要改无关申请日期来延长申诉；以显示的权威截止时间为准。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/discipline/page.tsx",
      "src/app/_components/student-support.tsx",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "card validation/rejection",
      "discipline evidence",
      "card appeal review",
      "school-day appeal deadline",
      "effective discipline standing",
      "discipline reversal",
    ],
  }),
  guide({
    slug: "review-student-feedback",
    title: t("Review feedback and tutee support", "查看反馈及学习伙伴支持"),
    summary: t(
      "Keep feedback, private conversations and appeals in their own authorized views.",
      "在各自授权视图中处理反馈、私人对话及申诉。",
    ),
    route: "/admin/student-support",
    screenshot: "admin-student-support",
    focus: t(
      "Choose Feedback or Appeals; each list keeps its own page controls.",
      "选择反馈或申诉；每个列表有独立分页。",
    ),
    steps: [
      [
        t("Choose the support panel", "选择支持面板"),
        t(
          "Open Tutee Support. Use Feedback for staff-authorized feedback, or Appeals for pending/resolved disciplinary appeals. Staff access to feedback is independent of the share-with-tutors setting.",
          "打开学习伙伴支持。反馈用于查看工作人员获准反馈；申诉用于待处理或已处理纪律申诉。工作人员反馈访问不依赖与辅导伙伴共享设置。",
        ),
      ],
      [
        t("Read the full context", "阅读完整背景"),
        t(
          "Read the name, subject, rating, full feedback and last update on the feedback card. For an appeal, read the card reason and appeal text on its entry. Use each list's own pagination when more records are available. Switching panels keeps current filters and drafts.",
          "直接在反馈卡片中查看姓名、科目、评分、完整反馈及最近更新时间。申诉的纪律卡原因和申诉内容显示在对应条目内。记录较多时使用各列表的独立分页。切换面板会保留当前筛选和草稿。",
        ),
      ],
      [
        t("Follow the appropriate response route", "使用适当响应途径"),
        t(
          "For an appeal, choose Overturn Card or Reject Appeal and enter a Decision Reason. For private follow-up, open Messages from the Feedback panel and select an allowed contact.",
          "处理申诉时选择“撤销纪律记录”或“驳回申诉”，并填写“决定理由”。如需私下跟进，请从反馈面板打开“消息”，并选择允许联系的人员。",
        ),
      ],
      [
        t("Review tutor sharing separately", "单独审核与辅导伙伴共享"),
        t(
          "Check Allow assigned tutors to read tutee feedback. Changing the checkbox submits immediately for Admin/Head or requests review for a Coordinator. It applies to past and future feedback. Authorized staff can read feedback regardless of this setting.",
          "检查“允许已分配的辅导伙伴查看学习伙伴反馈”。管理员或负责人切换复选框后即提交变更，协调员切换后提交审核申请。设置适用于已有和今后的反馈。有权限的工作人员始终可以查看反馈。",
        ),
      ],
    ],
    expected: t(
      "You read staff-authorized feedback and route each support item to its own workflow.",
      "阅读工作人员获准反馈，并将各支持事项引导至对应流程。",
    ),
    explanation: [
      t(
        "A feedback note and a disciplinary appeal are different evidence. Support visibility does not grant general access to private messages or unrelated students' records.",
        "反馈说明与纪律申诉是不同证据。支持可见性不会授予一般私人消息权限或无关学习伙伴记录权限。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("A feedback item is absent", "缺少某项反馈"),
        solution: t(
          "Check panel, period, pagination and current staff authorization, then Retry a failed read. For a tutor's missing feedback, inspect the separate share-with-tutors setting and current assignment ownership.",
          "检查面板、学期、分页及当前工作人员权限，读取失败后重试。辅导伙伴缺少反馈时，应检查独立共享设置及当前分配归属。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/student-support/page.tsx",
      "src/app/_components/student-support.tsx",
    ],
    covers: [
      "staff feedback reader",
      "feedback sharing settings",
      "pending/resolved support lists",
      "private support routing",
    ],
  }),
  guide({
    slug: "inspect-service-hours",
    title: t(
      "Read service-hour totals and breakdowns",
      "查看服务时数总计及明细",
    ),
    summary: t(
      "Compare full-period totals with the filtered tutor roster and inspect each credit or deduction.",
      "比较完整学期总计与筛选后的辅导伙伴名册，并检查每项学时或扣减。",
    ),
    route: "/admin/service-hours",
    screenshot: "admin-service-hours",
    focus: t(
      "Compare the period totals above the roster with its Active/Inactive/All filters.",
      "比较名册上方的学期总计及活跃、非活跃、全部筛选。",
    ),
    steps: [
      [
        t("Select the reporting period", "选择统计时段"),
        t(
          "Open Service Hours and choose the intended period. Read the complete program totals before narrowing the roster.",
          "打开服务时数并选择预期时段。缩小名册范围前先阅读完整项目总计。",
        ),
      ],
      [
        t("Filter the roster independently", "独立筛选名册"),
        t(
          "Choose Active, Inactive or All, then filter records/no records in the period and search by name. A recorded zero or offsetting deduction still counts as a record.",
          "选择活跃、非活跃或全部，再筛选时段内有记录或无记录并按姓名搜索。已记录零值或相抵扣减仍算有记录。",
        ),
      ],
      [
        t("Switch Summary and Breakdown", "切换摘要与明细"),
        t(
          "Use Summary for totals and Details, or Breakdown for earned hours, extras and deductions. Open the person's details to inspect the source contributions rather than adding display subtotals together.",
          "摘要展示总计及详情；明细展示已得学时、额外学时及扣减。打开个人详情检查来源贡献，不要将展示小计重复相加。",
        ),
      ],
      [
        t("Reveal hidden contributors", "显示隐藏贡献者"),
        t(
          "If Active hides people who contributed in the selected period, use the offered reveal action or All. On mobile, scroll inside the labelled table to reach the remaining columns.",
          "若活跃筛选隐藏了所选时段有贡献的人，可使用显示操作或全部。手机上在有标签的表格内部滚动查看其余列。",
        ),
      ],
    ],
    expected: t(
      "You can explain both the complete period total and the shown roster subtotal using original records.",
      "能够根据原始记录解释完整时段总计及当前名册小计。",
    ),
    explanation: [
      t(
        "Active/Inactive describes current membership, not historical-month status. The filtered subtotal covers shown rows; program totals cover the complete selected period. These views do not themselves issue school credit.",
        "活跃、非活跃描述当前成员资格，不是历史月份状态。筛选小计仅涵盖显示行；项目总计覆盖完整所选时段。这些视图本身不发放学校学时。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Totals differ after filtering", "筛选后总计不同"),
        solution: t(
          "Compare period, current-status and activity filters, then inspect All. Do not assume inactive contributors disappeared from program totals or school reports because a roster filter hides them.",
          "比较时段、当前状态及活动筛选，再查看全部。不要因名册筛选隐藏非活跃贡献者，就认为项目总计或学校报表不包含他们。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/service-hours/(roster)/page.tsx",
      "src/app/_components/service-hours-comparison.tsx",
      "src/lib/service-hours.ts",
    ],
    covers: [
      "service-hour period",
      "Active/Inactive/All",
      "records/no records",
      "Summary/Breakdown",
      "source hour details",
      "period totals versus subtotal",
    ],
  }),
  guide({
    slug: "record-hour-adjustments",
    title: t("Record or remove an hour adjustment", "记录或移除学时调整"),
    summary: t(
      "Add a reasoned extra or punishment adjustment for the correct tutor and month.",
      "为正确辅导伙伴及月份添加带原因的额外或处罚学时调整。",
    ),
    route: "/admin/hour-adjustments",
    screenshot: "admin-hour-adjustments",
    focus: t(
      "Use the creation action, then inspect Tutor, Month, Type, Amount and Reason.",
      "使用创建操作，再核对辅导伙伴、月份、类型、数量及原因。",
    ),
    steps: [
      [
        t("Check existing adjustments", "检查现有调整"),
        t(
          "Open Hour Adjustments and locate the tutor/month. Show past tutors is inside New hour adjustment; use it when the intended historical tutor is not offered in that dialog. Showing a person does not reactivate them.",
          "打开学时调整并定位辅导伙伴和月份。显示过往辅导伙伴位于新增学时调整弹窗中；若弹窗未提供目标历史辅导伙伴，可使用该选项。显示人员不会重新激活他们。",
        ),
      ],
      [
        t("Enter the adjustment", "填写调整"),
        t(
          "Open New hour adjustment. Select Tutor, Month and Type, enter a positive amount in the form's half-hour increments, such as 0.5, and give a specific reason. Check whether the type adds or deducts hours, then choose Add. This submits immediately.",
          "打开新增学时调整。选择辅导伙伴、月份及类型，按表单的半小时步长填写正数（如0.5），并说明具体原因。核对类型是增加还是扣减学时，再选择添加。此操作立即提交。",
        ),
      ],
      [
        t("Review a removal separately", "单独审核移除"),
        t(
          "Open an existing row's details to read its full reason. Use its delete/removal action only after reviewing the named adjustment and effect on totals; this is a reversal of saved evidence.",
          "打开现有行详情阅读完整原因。只有审阅具体调整及总计影响后，才使用删除或移除操作；这属于逆转已保存证据。",
        ),
      ],
      [
        t("Verify totals", "验证总计"),
        t(
          "Read the saved or approval result and inspect Service Hours for the same month. A successful write with a failed refresh uses read-only recovery.",
          "阅读保存或审核结果，并在服务时数中检查同一月份。写入成功而刷新失败时使用只读恢复。",
        ),
      ],
    ],
    expected: t(
      "One explained adjustment or reviewed reversal is reflected in the correct period totals.",
      "一项有说明调整或已审核逆转反映在正确时段总计中。",
    ),
    explanation: [
      t(
        "Adjustments are distinct source records. The creation draft survives closing/reopening during this visit, while navigating away or reloading does not store it.",
        "调整是独立来源记录。创建草稿会在本次访问关闭再打开时保留，但离开或重载页面不提供存储。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The amount looks wrong", "数量看起来不正确"),
        solution: t(
          "Check the selected month, amount and Extra/Punishment type, then inspect source details. Correct the saved adjustment through its reviewed workflow; do not add compensating duplicates without understanding the original error.",
          "检查月份、数量及额外或处罚类型，再查看来源详情。通过审核流程修正已保存调整；未理解原始错误前，不要添加相抵重复项。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/hour-adjustments/page.tsx",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "extra-hour adjustment",
      "punishment adjustment",
      "adjustment reason",
      "past tutor selector",
      "adjustment removal/reversal",
    ],
  }),
  guide({
    slug: "review-first-school-report",
    audience: "admin",
    title: t("Prepare the first school-hours report", "准备首份学校学时报表"),
    summary: t(
      "Resolve identities and explicitly reconcile already-posted opening balances before issuing school credit.",
      "发放学校学时前先解决身份问题，并明确核对已入账期初余额。",
    ),
    route: "/admin/service-hours",
    screenshot: "admin-school-reports",
    focus: t(
      "Open School reports and review opening balances and identity warnings.",
      "打开学校报表并审核期初余额及身份警告。",
    ),
    prerequisites: [
      t(
        "Admin or Head authority, Service Hours enabled, and school confirmation of already-reported hours and account references.",
        "需要管理员或负责人权限、启用服务时数，以及学校确认的已报告学时和账号参考。",
      ),
    ],
    steps: [
      [
        t("Open School reports", "打开学校报表"),
        t(
          "In Service Hours, open School reports and the opening-balance review. Inspect all people requiring reconciliation, including identity warnings and excluded archive-source counts.",
          "在服务时数中打开学校报表及期初余额审核。检查所有需核对人员，包括身份警告及排除归档来源数量。",
        ),
      ],
      [
        t("Confirm the person and account", "确认人员及账号"),
        t(
          "Review each person's original evidence and school-account reference. Resolve missing or conflicting identities through the existing account/record workflows before reporting.",
          "审核每个人的原始证据及学校账号参考。报告前通过现有账号或记录流程解决缺失或冲突身份。",
        ),
      ],
      [
        t("Record already-posted amounts", "记录已入账数量"),
        t(
          "Enter the reviewed already-reported opening amount for each person. Confirm zero explicitly where none was previously posted. Save completed people in batches; missing values are never treated as zero.",
          "为每人填写已核对的已报告期初数量。此前未入账者须明确确认零。可分批保存已完成人员；缺失值绝不会当作零。",
        ),
      ],
      [
        t("Inspect the individual preview", "检查个人预览"),
        t(
          "Review Carry In → Raw Change → Hours → Carry Out and the person's Details. Issue only when required reviews and identity conflicts have been resolved.",
          "检查转入余额→原始变化→入账时数→转出余额及个人详情。只有必要审核和身份冲突解决后才发放。",
        ),
      ],
    ],
    expected: t(
      "All required opening reviews are explicitly saved and the first report has a reviewed accounting boundary.",
      "全部必要期初审核已明确保存，首份报表拥有经审核的核算边界。",
    ),
    explanation: [
      t(
        "Historical archive imports remain program evidence but do not create new school credits or opening-review work. Overlap with already reviewed school evidence blocks issuance until reconciled. Old monthly totals cannot replace per-person opening review.",
        "历史归档导入保留为项目证据，但不产生新学校学时或期初审核任务。与已审核学校证据重叠会阻止发放，直至完成核对。旧月度总计不能代替逐人期初审核。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Issuance remains blocked", "仍无法发放"),
        solution: t(
          "Read every outstanding identity/opening-review warning. Save confirmed people, resolve the remaining sources and refresh the preview. Do not fill unknown balances with zero merely to enable issuance.",
          "阅读每条未解决身份或期初审核警告。保存已确认人员，解决剩余来源并刷新预览。不要为了启用发放而将未知余额填零。",
        ),
      },
    ],
    sources: [
      "src/app/_components/school-hours-baseline.tsx",
      "src/app/_components/school-hours-panel.tsx",
      "src/server/api/routers/school-hours.ts",
    ],
    covers: [
      "school-report opening balance",
      "school-account reference",
      "explicit reviewed zero",
      "identity reconciliation",
      "archive exclusion boundary",
      "first issue prerequisites",
    ],
  }),
  guide({
    slug: "issue-school-report",
    audience: "admin",
    title: t(
      "Issue and correct a school-hours report",
      "发放及修订学校学时报表",
    ),
    summary: t(
      "Preview an edition, issue exact posting amounts and avoid double-counting revised reports.",
      "预览版本、发放精确入账数量，并避免重复计算修订报表。",
    ),
    route: "/admin/service-hours",
    screenshot: "admin-school-reports",
    focus: t(
      "Use the report preview and saved-edition controls under School reports.",
      "使用学校报表中的预览及已保存版本控件。",
    ),
    prerequisites: [
      t(
        "Admin/Head access, resolved opening/identity reviews and enabled program mail/Service Hours prerequisites.",
        "需要管理员或负责人权限、已解决期初和身份审核，并满足项目邮件及服务时数启用条件。",
      ),
    ],
    steps: [
      [
        t("Choose month and preview", "选择月份并预览"),
        t(
          "Open School reports, choose the month and inspect each person's posting instructions plus the HTML/plain-text school email preview. A preview sends nothing and has no live report link.",
          "打开学校报表，选择月份并检查每人入账说明及HTML、纯文本学校邮件预览。预览不会发送，也无有效报表链接。",
        ),
      ],
      [
        t("Review and issue once", "审核后发放一次"),
        t(
          "Read the issuance review, then issue the report. Save and inspect the returned edition rather than repeating generation when a refresh fails.",
          "阅读发放审阅后发放报表。保存并检查返回版本；刷新失败时不要重复生成。",
        ),
      ],
      [
        t("Inspect exact posting amounts", "检查精确入账数量"),
        t(
          "The highlighted Hours amount is what to enter once. Open Details for school-account references, separate tutoring/Crew values and carry explanations. Do not separately post Carry In, Raw Change or Carry Out.",
          "突出显示的入账时数是应入账一次的数量。打开详情查看学校账号参考、辅导和巡视分项及结转解释。不要另行入账转入、原始变化或转出余额。",
        ),
      ],
      [
        t("Correct the latest eligible edition", "修订最新符合条件版本"),
        t(
          "Review the corrected edition. In Details, find the comparison row for the last edition the school entered and use its incremental amount. Once a later month has been issued, any new changes reconcile in the next report.",
          "核对修订版。在“详情”中找到学校上次实际入账版本的对照行，并使用该行的增量时数。后续月份的报表发放后，新变化会在下一份报表中核对。",
        ),
      ],
    ],
    expected: t(
      "A saved edition contains exact one-time posting instructions and a clear correction basis.",
      "保存版本包含精确一次入账说明及清晰修正依据。",
    ),
    explanation: [
      t(
        "New reports post complete 0.1-hour steps and carry the remainder across months without semester reset. For example, 80 minutes posts 1.3 hours and carries two minutes. Negative balances post zero and carry forward; future earnings cover deficits first.",
        "新报表以完整0.1小时单位入账，余数跨月结转，学期不清零。例如80分钟入账1.3小时并结转2分钟。负余额入账零并继续结转，未来收入先抵欠额。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "School already entered an older edition",
          "学校已录入旧版本",
        ),
        solution: t(
          "Use Details to choose the actual last-entered edition and its incremental correction. Issuing or emailing a report does not prove school entered it. Coordinate the entry record before applying another amount.",
          "在详情选择实际已入账版本及其增量修正。发放或发送报表不证明学校已录入。应用另一数量前先核对学校入账记录。",
        ),
      },
    ],
    sources: [
      "src/app/_components/school-hours-panel.tsx",
      "src/app/_components/school-hours-preview.tsx",
      "src/app/_components/school-hours-report.tsx",
      "src/server/api/routers/school-hours.ts",
    ],
    covers: [
      "school-report preview",
      "issue edition",
      "0.1-hour posting",
      "carry accounting",
      "report correction",
      "last-entered edition",
      "incremental correction",
    ],
  }),
  guide({
    slug: "schedule-school-report-delivery",
    category: "administration",
    title: t(
      "Configure school-report recipients and delivery",
      "配置学校报表收件人及投递",
    ),
    summary: t(
      "Save the recipient list and timezone, inspect delivery receipts and manage report-only links.",
      "保存收件人及时区、查看投递回执并管理仅报表链接。",
    ),
    route: "/admin/service-hours",
    screenshot: "admin-school-reports",
    focus: t(
      "Find recipient editing, the schedule and saved report delivery history.",
      "找到收件人编辑、计划及已保存报表投递历史。",
    ),
    steps: [
      [
        t("Edit the recipient draft", "编辑收件人草稿"),
        t(
          "Under School reports, choose Add recipient and enter each school email plus optional internal label. Use Edit or Remove for existing entries. Finish or cancel the recipient editor before saving the schedule.",
          "在学校报表选择添加收件人，填写各学校邮箱及可选内部标签。现有条目可编辑或移除。保存计划前先完成或取消收件人编辑器。",
        ),
      ],
      [
        t("Review schedule and timezone", "审核计划及时区"),
        t(
          "Review the timezone and default noon on the last day of the month, or set month-specific dates. Save through the displayed approval path. List edits remain drafts until this save; saving settings sends no report.",
          "审核时区及默认月末当天中午时间，或设置特定月份日期。通过显示的审核路径保存。列表修改在保存前仍为草稿；保存设置不会发送报表。",
        ),
      ],
      [
        t("Inspect an edition's delivery", "查看版本投递"),
        t(
          "Admin/Head can open School Delivery Status and check the state, attempts and any delivery notice. Retry delivery reuses the same saved edition and link when eligible. Report link opened records access separately from transport acceptance. Automated link checks can trigger it too.",
          "管理员或负责人可打开“学校投递状态”，查看状态、尝试次数和投递提示。符合条件时，“重试投递”使用同一已保存版本和链接。“报告链接已打开”记录访问，邮件传输是否已接受另行显示。自动链接检查也可能产生打开记录。",
        ),
      ],
      [
        t("Manage report links", "管理报表链接"),
        t(
          "Admin/Head can revoke or replace a report-only link when appropriate. Recipients need no login, so treat the live URL as access to the report and share only with the intended school recipients.",
          "管理员或负责人可按需撤销或替换仅报表链接。收件人无需登录，因此有效网址即报表访问权，应只分享给预期学校收件人。",
        ),
      ],
    ],
    expected: t(
      "The reviewed recipient/schedule settings and each edition's delivery state are visible.",
      "经审核的收件人和计划设置及各版本投递状态可见。",
    ),
    explanation: [
      t(
        "Automation starts off. Transport acceptance and a link visit do not confirm inbox reading or school entry; security scans/forwarding can create visits. Personal recipient reminders are independent of automatic monthly issuance.",
        "自动化默认关闭。传输接受及链接访问不能证明已读邮件或学校入账，安全扫描及转发也会产生访问。收件人个人提醒与自动月度发放相互独立。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("Automatic sending did not run", "自动发送未执行"),
        solution: t(
          "Check that the saved schedule is enabled, program mail and Service Hours are effective, recipients are valid and required accounting reviews are resolved. Read the saved edition's delivery state before retrying anything.",
          "检查已保存计划已启用、项目邮件及服务时数生效、收件人有效且必要核算审核完成。重试前先阅读已保存版本投递状态。",
        ),
      },
    ],
    sources: [
      "src/app/_components/school-hours-recipients.tsx",
      "src/app/_components/school-hours-panel.tsx",
      "src/server/api/routers/school-hours.ts",
    ],
    covers: [
      "school recipients add/edit/remove",
      "recipient labels",
      "monthly schedule",
      "month date override",
      "delivery retry",
      "link visit status",
      "report link revoke/replace",
    ],
  }),
  guide({
    slug: "export-period-reports",
    title: t(
      "Read, print and export period reports",
      "阅读、打印及导出学期报表",
    ),
    summary: t(
      "Choose the right historical scope and privacy setting before printing or downloading report tables.",
      "打印或下载报表前选择正确历史范围及隐私设置。",
    ),
    route: "/admin/history",
    screenshot: "admin-history",
    focus: t(
      "Choose a period and report, then inspect masking and output controls.",
      "选择学期及报表，再检查遮蔽与输出控件。",
    ),
    steps: [
      [
        t("Choose scope", "选择范围"),
        t(
          "Open Reports and select the intended period/report. Wait for the required records and inspect the report title and date scope before interpreting totals.",
          "打开报表并选择预期学期和报表。等必要记录加载后，先检查标题及日期范围，再理解总计。",
        ),
      ],
      [
        t("Inspect detail and privacy", "检查详情及隐私"),
        t(
          "Open relevant breakdowns and review the privacy/masking selection. Observer reports remain restricted; revealing a roster row elsewhere does not authorize private report data.",
          "打开相关明细并审核隐私、遮蔽选择。观察者报表仍受限制；其他位置显示名册行不会授予私人报表数据权限。",
        ),
      ],
      [
        t("Print or download", "打印或下载"),
        t(
          "Use Print for the selected report and inspect print preview. Report-table CSV downloads require Admin/Head. Choose the intended table and retain its period/header context when sharing the file.",
          "使用打印并检查打印预览。报表表格CSV下载需要管理员或负责人权限。选择预期表格，分享文件时保留学期和表头背景。",
        ),
      ],
      [
        t("Keep school posting separate", "单独处理学校入账"),
        t(
          "Use School reports in Service Hours for exact school posting instructions. General historical totals and program-record archives are not another instruction to credit the same hours.",
          "精确学校入账说明请使用服务时数中的学校报表。一般历史总计及项目记录归档不是再次入账相同学时的指令。",
        ),
      ],
    ],
    expected: t(
      "The printed/exported report reflects the selected period and permitted data scope.",
      "打印或导出报表反映所选学期及允许数据范围。",
    ),
    explanation: [
      t(
        "CSV preserves numeric quantities and quotes commas, quotes and newlines. Formula-like text receives a protective apostrophe; preserve it when opening or moving the export between spreadsheet tools.",
        "CSV保留数值，并对逗号、引号和换行进行引用。类似公式的文本会加保护单引号；在电子表格工具间打开或移动导出时应保留。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("A report prerequisite failed", "报表依赖读取失败"),
        solution: t(
          "Use the offered Retry to recover the selected report and its unavailable prerequisite. Keep the scope and masking choice; do not treat a partly loaded report as complete or export guessed totals.",
          "使用重试恢复所选报表及不可用依赖。保留范围和遮蔽选择；不要把部分加载报表当完整结果或导出猜测总计。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/history/page.tsx",
      "src/app/_components/monthly-hours-report.tsx",
    ],
    covers: [
      "period report scope",
      "historical reports",
      "report masking",
      "print",
      "report table CSV",
      "CSV formula protection",
    ],
  }),
  guide({
    slug: "publish-announcements",
    category: "administration",
    title: t("Publish and maintain an announcement", "发布及维护公告"),
    summary: t(
      "Preview the exact recipient snapshot, then publish, pin, edit or archive the announcement.",
      "预览准确收件人快照，再发布、置顶、编辑或归档公告。",
    ),
    route: "/admin/announcements",
    screenshot: "admin-announcements",
    focus: t(
      "Use the creation action and the audience's Include/Exclude controls.",
      "使用创建操作及受众的包含、排除控件。",
    ),
    steps: [
      [
        t("Start a draft", "开始草稿"),
        t(
          "Open Announcements and its creation action. Enter the title/body and relevant options. Closing and reopening preserves the draft during this visit; navigating away does not.",
          "打开公告及创建操作。填写标题、正文和相关选项。关闭再打开会保留本次访问草稿，离开页面则不会。",
        ),
      ],
      [
        t("Review the audience", "审核受众"),
        t(
          "Choose the audience filters and individual Include/Exclude overrides. Open the recipient preview and read the fixed count and actual intended recipients before publishing.",
          "选择受众筛选及逐人包含、排除覆盖。发布前打开收件人预览，阅读固定数量及实际预期收件人。",
        ),
      ],
      [
        t("Publish and verify", "发布并验证"),
        t(
          "Review the named announcement and publish or submit for review. Check the applied state and recipient snapshot; a pending proposal is not yet a published announcement.",
          "审阅具体公告并发布或提交审核。检查应用状态和收件人快照；待审提案尚不等于已发布公告。",
        ),
      ],
      [
        t("Maintain the saved record", "维护已保存记录"),
        t(
          "Use Save for edits, Pin or Unpin for placement, and Deactivate or Reactivate for visibility. Read the Dismissed count and recipient information separately. Delete opens its own review.",
          "使用“保存”提交编辑，通过“置顶”或“取消置顶”调整位置，通过“停用”或“重新启用”管理可见性。分别查看已关闭人数及收件人信息。“删除”会打开独立审核。",
        ),
      ],
    ],
    expected: t(
      "A published announcement has the reviewed content and a recorded recipient snapshot.",
      "已发布公告拥有经审核内容及已记录收件人快照。",
    ),
    explanation: [
      t(
        "Audience preview captures recipients for the publication, so later role or roster changes are not a reason to assume the original audience changed. Acknowledgement, notification delivery and email transport are distinct signals.",
        "受众预览为发布捕获收件人，因此不能因后续角色或名册变化就认为原受众已改变。已阅确认、通知投递及邮件传输是不同信号。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The expected recipient is absent", "预期收件人未出现"),
        solution: t(
          "Review both group filters and individual exclusions, then refresh the intended recipient preview before publishing. If already published, inspect that edition's snapshot instead of assuming today's filter results describe it.",
          "检查分组筛选和个人排除，发布前刷新预期收件人预览。若已发布，应查看该版本快照，不要假设当前筛选结果就是其受众。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/announcements/page.tsx",
      "src/app/(admin)/admin/announcements/recipient-picker.tsx",
    ],
    covers: [
      "announcement creation",
      "audience snapshot",
      "Include/Exclude overrides",
      "publish/edit/pin/deactivate/reactivate",
      "acknowledgement evidence",
    ],
  }),
  guide({
    slug: "edit-website-content",
    category: "administration",
    title: t("Edit website pages, news and images", "编辑网站页面、新闻及图片"),
    summary: t(
      "Use Landing Editor's independent tabs and language drafts, preview changes and publish deliberately.",
      "使用首页编辑器独立标签及语言草稿，预览变更并审慎发布。",
    ),
    route: "/admin/landing",
    screenshot: "admin-landing",
    focus: t(
      "Use Layout, Main Page Content, Sections, Program News, Pages and Images tabs.",
      "使用“布局”“主页面内容”“板块”“项目动态”“页面”和“图片”选项卡。",
    ),
    prerequisites: [
      t(
        "Current Coordinator/Admin/Head access and an explicit Translator assignment. Management rank alone does not grant Landing Editor access.",
        "需要当前协调员、管理员或负责人权限，并被明确指派为翻译员。只有管理职级不足以访问首页编辑器。",
      ),
    ],
    steps: [
      [
        t("Choose a content area", "选择内容区域"),
        t(
          "Open Landing Page and choose Layout, Main Page Content, Sections, Program News, Pages or Images. Use the arrow keys to move focus between tabs, then Enter or Space to open the focused tab.",
          "打开“首页”，选择“布局”“主页面内容”“板块”“项目动态”“页面”或“图片”。用方向键在选项卡之间移动焦点，再按回车或空格打开当前选项卡。",
        ),
      ],
      [
        t("Edit the current draft", "编辑当前草稿"),
        t(
          "Choose Language and edit the intended field. Fields with their own Save keep independent drafts across tabs and languages during this visit. In Pages, leaving a title or page-address field submits its change. Show in top nav submits immediately.",
          "选择“语言”并编辑需要的字段。有独立“保存”的字段会在本次访问中跨选项卡和语言保留各自草稿。在“页面”中，离开标题或页面地址字段时会提交更改。“显示在顶部导航”会立即提交。",
        ),
      ],
      [
        t("Preview before publication", "发布前预览"),
        t(
          "Open Preview to inspect the saved layout, titles, links and images. Editors can also see saved drafts and hidden sections in this preview. For an unsaved Markdown edit, use the inline Preview. Check links and image framing on small screens.",
          "打开“预览”检查已保存的布局、标题、链接及图片。编辑者还可在此预览中查看已保存的草稿和隐藏板块。未保存的 Markdown 编辑可使用编辑区内的“预览”。在小屏幕上核对链接和图片显示范围。",
        ),
      ],
      [
        t("Save, publish or restore", "保存、发布或恢复"),
        t(
          "Use each area's Save or Publish control and verify the public page after the change applies. Use Archive or Restore for Program News and Show or Hide for custom pages. Applied content appears without a redeploy.",
          "使用各区块的“保存”或“发布”控件，在更改生效后核对公开页面。“项目动态”使用“归档”或“恢复”，自定义页面使用“显示”或“隐藏”。生效的内容无需重新部署即可显示。",
        ),
      ],
    ],
    expected: t(
      "The public website reflects applied content while unrelated drafts remain independent.",
      "公开网站反映已应用内容，无关草稿保持独立。",
    ),
    explanation: [
      t(
        "A custom page is public content, not a protected participant record or a replacement for the policy versioning workflow. Help & How-to is a maintained catalogue; the legacy FAQ URL redirects there.",
        "自定义页面属于公开内容，不是受保护参与者记录，也不能替代政策版本流程。帮助与操作指南属于维护目录；旧常见问题网址会跳转至此。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The preview is denied or a save is not public",
          "预览被拒或保存未公开",
        ),
        solution: t(
          "Check both management access and explicit Translator assignment, then inspect the returned save/review state. Retry failed reads to recover drafts and verify the selected language. Repository policy edits do not publish site policies.",
          "检查管理权限及明确翻译员指派，再检查返回保存或审核状态。读取失败可重试恢复草稿并核对所选语言。仓库政策编辑不会发布网站政策。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/landing/landing-editor.tsx",
      "src/app/landing-preview/page.tsx",
      "src/app/p/[slug]/page.tsx",
    ],
    covers: [
      "landing layout",
      "fixed content",
      "landing sections",
      "news",
      "custom pages/slugs",
      "images",
      "language drafts",
      "landing preview",
      "content archive/restore",
    ],
  }),
  guide({
    slug: "publish-policy-revisions",
    category: "administration",
    title: t(
      "Publish a policy revision and translations",
      "发布政策修订及翻译",
    ),
    summary: t(
      "Save reviewed English source, add translations and inspect exact archived versions and renewed acceptance.",
      "保存已审核英文来源、添加翻译，并查看确切归档版本及重新接受。",
    ),
    route: "/admin/policies",
    screenshot: "admin-policies",
    focus: t(
      "Choose Tutor Policy or Tutee Policy and the editing language.",
      "选择辅导伙伴政策或学习伙伴政策及编辑语言。",
    ),
    steps: [
      [
        t("Choose the document", "选择文档"),
        t(
          "Open Policies and choose Tutor Policy or Tutee Policy. On a fresh site the editors begin blank; obtain the school's reviewed wording before publication.",
          "打开政策并选择辅导伙伴或学习伙伴政策。新站编辑器为空；发布前应获取学校审核文字。",
        ),
      ],
      [
        t("Save the reviewed English source", "保存经审核英文来源"),
        t(
          "Choose English and review the document title, version and policy text. Admin/Head use Save to publish. Coordinators use Request Admin approval. Check the resulting version before adding translations.",
          "选择英文，核对文档标题、版本及政策正文。管理员或负责人选择“保存”发布。协调员选择“请求管理员审批”。添加译文前核对发布版本。",
        ),
      ],
      [
        t("Save each translation", "分别保存翻译"),
        t(
          "Choose another editing language, enter the reviewed translation and save it explicitly. Opened language drafts survive switching during the visit but are not stored by browser reload or navigation.",
          "选择另一编辑语言，填写经审核翻译并明确保存。已打开语言草稿在本次访问切换时保留，但浏览器重载或离开不会存储。",
        ),
      ],
      [
        t("Inspect exact history", "查看确切历史"),
        t(
          "Use Version History → View for the archived title/text in its recorded language. Check the published revision and participants' renewed-acceptance requirements without altering their previous signatures.",
          "使用版本历史→查看，阅读记录语言中的归档标题及正文。检查已发布版本和参与者重新接受要求，不改变原签名。",
        ),
      ],
    ],
    expected: t(
      "The intended version and language are published through the authorized workflow, and archived text remains readable.",
      "预期版本及语言通过授权流程发布，归档文字仍可读取。",
    ),
    explanation: [
      t(
        "Policy acceptance records the exact accepted version, text, signature and time. A later revision does not overwrite the earlier acceptance; renewed acceptance is a separate participant action.",
        "政策接受记录准确接受版本、文字、签名及时间。后续修订不会覆盖旧接受；重新接受属于独立参与者操作。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Save succeeded but history or document cannot refresh",
          "保存成功但历史或文档无法刷新",
        ),
        solution: t(
          "Use the separate read-only refresh action before editing again. Do not republish the same change merely because its history read failed. For a missing translation, verify the document and editing language.",
          "再次编辑前使用独立只读刷新。不要仅因历史读取失败就重复发布。缺少翻译时检查文档及编辑语言。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/policies/page.tsx",
      "src/server/policy-acceptance.ts",
      "docs/guides/policies/README.md",
    ],
    covers: [
      "Tutor/Tutee policy editors",
      "English-first policy",
      "policy translation",
      "version history",
      "exact acceptance evidence",
      "renewed acceptance",
    ],
  }),
  guide({
    slug: "issue-account-invitations",
    title: t("Issue and share an account invitation", "发放及分享账号邀请"),
    summary: t(
      "Choose the authorized role, review binding/expiry, share an active card or export its image.",
      "选择授权角色、审核绑定及有效期，分享有效邀请卡或导出图片。",
    ),
    route: "/admin/registration-codes",
    screenshot: "admin-registration-codes",
    focus: t(
      "Inspect the role on the invitation card and active/used/expired states.",
      "检查邀请卡角色及有效、已用、已过期状态。",
    ),
    steps: [
      [
        t("Choose the permitted invitation kind", "选择允许邀请类型"),
        t(
          "Open Registration Codes. Admin/Head may issue Tutor, Crew, Admin or Coordinator invitations. Coordinators may request Tutor/Crew invitations for review, not management-rank grants. No code grants Head.",
          "打开注册码。管理员或负责人可发放辅导伙伴、巡视组、管理员或协调员邀请。协调员可申请审核辅导伙伴、巡视组邀请，不能授予管理职级。没有邀请代码可授予负责人。",
        ),
      ],
      [
        t("Check binding and issue", "核对绑定并发放"),
        t(
          "Select Kind, enter Label and optional Email, then check the role and recipient binding. For Admin/Head, Issue submits directly. Read the resulting expiry and Active status on the card or list. A Coordinator's issuance request remains pending until approved.",
          "选择类型，填写标签及可选邮箱，再核对角色和收件人绑定。管理员或负责人选择发放即直接提交。随后在邀请卡或列表中查看有效期及有效状态。协调员的发放申请在批准前保持待审。",
        ),
      ],
      [
        t("Share the active card", "分享有效邀请卡"),
        t(
          "Expand an active code and use its copy/share controls. Export Image downloads account-setup.png with only the setup card in the current language/accent; share it only with the intended recipient.",
          "展开有效代码并使用复制、分享控件。导出图片会下载当前语言及主题色的account-setup.png，仅包含设置卡；只应分享给预期收件人。",
        ),
      ],
      [
        t("Inspect use or revoke", "检查使用或撤销"),
        t(
          "Read used/expired cards as retained evidence; they show a crossed-out code without sharing actions. Admin/Head can revoke an eligible invitation through the named review action.",
          "已使用或过期卡作为保留证据阅读；其代码划线且无分享操作。管理员或负责人可通过明确审阅操作撤销符合条件邀请。",
        ),
      ],
    ],
    expected: t(
      "The intended active invitation or review receipt is visible, with the exact authorized role.",
      "能看到预期有效邀请或审核回执及准确授权角色。",
    ),
    explanation: [
      t(
        "The displayed invitation code authorizes inspection; separate mailbox verification proves the recipient. Existing accounts retain credentials and other access, adding only the authorized reviewed upgrade. Exporting changes neither code nor expiry.",
        "显示邀请代码授权查看；独立邮箱验证证明收件人。现有账号保留凭据及其他权限，只添加已授权审核升级。导出不会改变代码或有效期。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Image export fails or the recipient cannot redeem",
          "图片导出失败或收件人无法兑换",
        ),
        solution: t(
          "Retry image export from the same active card; do not issue a new code just for a download failure. For redemption, inspect expiry, recipient binding and used/revoked status; mailbox proof remains a separate recipient step.",
          "从同一有效卡重试图片导出，不要仅因下载失败就发新代码。兑换问题应检查有效期、收件人绑定及已用、撤销状态；邮箱证明仍是独立收件人步骤。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/registration-codes/page.tsx",
      "src/app/(admin)/admin/registration-codes/share-card.tsx",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "Tutor/Crew invitations",
      "Admin/Coordinator invitations",
      "email-bound invitation",
      "invitation expiry",
      "copy/share invitation",
      "Export Image",
      "used/expired card",
      "invitation revocation",
    ],
  }),
  guide({
    slug: "inspect-accounts-and-identities",
    title: t(
      "Find accounts, participation and original records",
      "查找账号、参与资格及原始记录",
    ),
    summary: t(
      "Use Users & Roles filters and on-demand details to distinguish login readiness, badges and retained history.",
      "使用用户与角色筛选和按需详情，区分登录就绪、标记及保留历史。",
    ),
    route: "/admin/users",
    screenshot: "admin-users",
    focus: t(
      "Read User, Login setup, Roles & participation and Actions independently.",
      "分别阅读用户、登录设置、角色及参与、操作各列。",
    ),
    steps: [
      [
        t("Combine search and filters", "组合搜索及筛选"),
        t(
          "Open Users & Roles and search the person. Combine Role and Account filters, exclusions, historical-record visibility and unverified-account visibility. Tutor Status appears only for a Tutor-only included-role selection.",
          "打开用户与角色并搜索人员。组合角色、账号筛选、排除、历史记录可见性及未验证账号可见性。辅导伙伴状态只在仅包含辅导伙伴角色时出现。",
        ),
      ],
      [
        t("Read login readiness separately", "单独查看登录就绪"),
        t(
          "Distinguish Setup complete, Setup incomplete, Invitation pending and No direct login attached. A complete setup does not guarantee current access; suspension and participation status remain independent.",
          "区分设置完成、设置未完成、邀请待处理及未直接关联登录。设置完成不保证当前权限；暂停与参与状态仍独立。",
        ),
      ],
      [
        t("Open User details", "打开用户详情"),
        t(
          "Read Login, Permissions and memberships, Attached participant profiles, Historical records and Combined records. Inspect exact account policy acceptance history and original enrollment academics without assuming names prove ownership.",
          "阅读登录、权限与成员资格、关联参与者资料、历史记录及合并记录。查看确切账号政策接受历史及原入组学业资料，不要认为姓名就能证明归属。",
        ),
      ],
      [
        t("Choose the right account pathway", "选择正确账号路径"),
        t(
          "Use Which account pathway should I use? when deciding between setup invitation, Forgot password, existing-account membership, history-only access and Combine records. Do not create a second login to solve a setup-state problem.",
          "在设置邀请、忘记密码、现有账号成员资格、仅历史访问及合并记录之间选择时，可打开应使用哪种账号路径。不要创建第二登录来解决设置状态问题。",
        ),
      ],
    ],
    expected: t(
      "You can identify the exact person, login state, independent capabilities and original evidence before editing.",
      "编辑前能识别具体人员、登录状态、独立能力及原始证据。",
    ),
    explanation: [
      t(
        "The directory has one row per explicitly combined person, including accountless profiles. Filters require one member to match the complete expression; they do not union different accounts' privileges. Tutor and Tutee memberships can coexist even when the compact row suppresses a redundant badge.",
        "目录按明确合并人员显示一行，包括无账号资料。筛选要求一个成员满足完整表达式，不合并不同账号权限。辅导伙伴和学习伙伴成员资格可共存，即使紧凑行省略重复标记。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("A known person is hidden", "已知人员未显示"),
        solution: t(
          "Clear exclusions and check Show historical records, Show unverified accounts and Account setup filters. Clearing search alone does not clear other filters. Inspect original source records rather than assuming the person was deleted.",
          "清除排除条件并检查显示历史记录、显示未验证账号及账号设置筛选。仅清除搜索不会清除其他筛选。应检查原始来源，不要假设人员已删除。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/users/page.tsx",
      "src/app/(admin)/admin/users/user-details.tsx",
      "src/server/account-directory.ts",
    ],
    covers: [
      "Users & Roles filters",
      "historical/unverified visibility",
      "login setup predicates",
      "permission badges",
      "User details",
      "policy history",
      "account pathway advice",
      "combined-person directory",
    ],
  }),
  guide({
    slug: "edit-account-profile",
    title: t("Edit names and academic profiles", "编辑姓名及学业资料"),
    summary: t(
      "Save independent profile sections without replacing original enrollment evidence or other drafts.",
      "分别保存资料区块，保留原始入组证据及其他草稿。",
    ),
    route: "/admin/users",
    screenshot: "admin-users",
    focus: t(
      "Open Edit profile and review each section's own Save action.",
      "打开编辑资料并检查各区块自己的保存操作。",
    ),
    steps: [
      [
        t("Choose the exact source", "选择准确来源"),
        t(
          "Find the account or unlinked participant and open Edit profile. Compare current account academics with the participant's original enrollment evidence before deciding which profile needs correction.",
          "找到账号或未关联参与者并打开编辑资料。决定修正哪份资料前，比较当前账号学业与参与者原入组证据。",
        ),
      ],
      [
        t("Edit one section", "编辑一个区块"),
        t(
          "Update the named fields in that section. For academic records, confirm grade and reference school year or explicit graduation/departure state; do not use the username's suffix as academic evidence.",
          "更新该区块明确字段。学业记录应确认年级及参考学年，或明确毕业、离校状态；不要把用户名后缀当作学业证据。",
        ),
      ],
      [
        t("Save and wait for refresh", "保存并等待读取"),
        t(
          "Use that section's Save and review the result. During any save the editor cannot close. After an accepted write, the section refreshes itself before becoming editable again; other section drafts remain independent.",
          "使用该区块保存并审核结果。任一区块保存时编辑器不能关闭。写入接受后该区块先自动刷新再恢复编辑，其他区块草稿仍独立。",
        ),
      ],
      [
        t("Review proposals explicitly", "明确审核提案"),
        t(
          "Follow a Coordinator proposal in Management Actions. A pending profile request does not change live identity, academics or participation. Close only after confirming all intended sections are saved.",
          "在管理操作跟进协调员提案。待审资料申请不会改变实际身份、学业或参与资格。确认全部预期区块已保存后再关闭。",
        ),
      ],
    ],
    expected: t(
      "Only the saved sections change, while original enrollment and unrelated drafts retain their own evidence.",
      "仅已保存区块发生变化，原始入组及无关草稿保留各自证据。",
    ),
    explanation: [
      t(
        "Legacy profiles can retain an unsplit full name when other fields change. Changing First Name, Last Name or Preferred Name requires a valid Latin First Name; Name in Another Language supports another writing system.",
        "旧资料在改其他字段时可以保留未拆分全名。修改名、姓或偏好名需要有效拉丁字母名字；其他语言姓名支持其他文字系统。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A section stays read-only after saving",
          "保存后区块仍只读",
        ),
        solution: t(
          "Use Retry refresh to read the accepted values without resubmitting. A version conflict's explicit Reload replaces only after the fresh read succeeds; inspect the new values before saving again.",
          "使用重试刷新读取已接受值，不要再次提交。版本冲突中的明确重新加载只有成功读取新值后才替换草稿；再次保存前检查新值。",
        ),
      },
    ],
    sources: [
      "src/app/_components/account-profile-editor.tsx",
      "src/app/_components/admin-account-view.tsx",
      "src/server/account-profile.ts",
    ],
    covers: [
      "staff name correction",
      "account academics",
      "unlinked profile edit",
      "independent section save",
      "profile version conflict",
      "academic reference year",
    ],
  }),
  guide({
    slug: "manage-account-access",
    audience: "admin",
    title: t("Manage account access and setup", "管理账号权限及设置"),
    summary: t(
      "Review rank and participant access, send setup/recovery, decide suspension appeals and delete only eligible accounts.",
      "审核管理职级与参与权限、发送设置或恢复、决定暂停申诉，并仅删除符合条件账号。",
    ),
    route: "/admin/users",
    screenshot: "admin-users",
    focus: t(
      "Use the exact account's Actions and read current permissions in User details.",
      "使用具体账号操作，并在用户详情阅读当前权限。",
    ),
    prerequisites: [
      t(
        "Current Admin or Head access. Follow each dedicated review/password requirement; current Head leadership uses a separate workflow.",
        "需要当前管理员或负责人权限。遵循各专用审阅及密码要求；当前负责人职权转移使用独立流程。",
      ),
    ],
    steps: [
      [
        t("Verify current identity and access", "确认当前身份及权限"),
        t(
          "Open User details and inspect live login status, management rank, Tutor/Tutee/Crew memberships, Translator assignment, suspension and school departure. Read each action's eligibility before changing it.",
          "打开用户详情，检查实际登录状态、管理职级、辅导伙伴或学习伙伴或巡视成员资格、翻译指派、暂停及离校。变更前阅读各操作资格。",
        ),
      ],
      [
        t("Use setup or recovery appropriately", "适当使用设置或恢复"),
        t(
          "Use Send Setup Link in Users & Roles for eligible unfinished setup. For a ready account, direct the owner to Forgot password on Sign In. The application delivers the setup or recovery link to the eligible recipient through that workflow.",
          "对符合条件但尚未完成设置的账号，请在“用户与角色”中选择“发送设置链接”。已就绪账号的使用者可在登录页选择“忘记密码”。应用会按相应流程向符合条件的收件人发送设置或恢复链接。",
        ),
      ],
      [
        t("Review authority and suspension changes", "审核权限及暂停变更"),
        t(
          "For permitted non-Head rank grants/revocations or participant access changes, review the named account and consequences and complete required password/review. For Review appeal, read the complete account appeal before approving or denying.",
          "允许的非负责人职级授予、撤销或参与权限变更，应审阅具体账号及后果并完成必要密码或审核。审核申诉时须先阅读完整账号申诉再批准或拒绝。",
        ),
      ],
      [
        t("Delete only through eligibility review", "仅通过资格审阅删除"),
        t(
          "If account deletion is offered, inspect the exact login and retained-record consequences and confirm through its dedicated workflow. The current Head and reviewed combined groups cannot be deleted as ordinary accounts.",
          "若提供账号删除，应检查准确登录及保留记录后果，并通过专用流程确认。当前负责人及已审核合并组不能作为普通账号删除。",
        ),
      ],
    ],
    expected: t(
      "Only the explicitly reviewed access or setup action is recorded; historical evidence and separate memberships remain authoritative.",
      "仅明确审核的权限或设置操作被记录，历史证据及独立成员资格仍具权威。",
    ),
    explanation: [
      t(
        "Management role and participation badges are separate. Granting management rank does not automatically grant Tutor/Crew/Translator participation. Setup complete is a credential predicate, not a guarantee of unsuspended access.",
        "管理角色与参与标记彼此独立。授予管理职级不会自动授予辅导伙伴、巡视或翻译资格。设置完成是凭据条件，不保证未暂停访问。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "An action is unavailable or its saved list did not refresh",
          "操作不可用或保存后列表未刷新",
        ),
        solution: t(
          "Read the server's current authority/ownership restriction. Do not use invitations to bypass a denied direct action. After an accepted decision, use Retry refresh rather than repeating suspension, deletion or appeal review.",
          "阅读服务器当前权限或归属限制。不要使用邀请绕过被拒直接操作。决定被接受后应重试刷新，不要重复暂停、删除或申诉审核。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/users/page.tsx",
      "src/server/api/routers/admin.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "non-Head rank grants/revocations",
      "participant badge/access",
      "Translator assignment",
      "setup delivery",
      "login recovery",
      "suspend/restore",
      "account appeal decision",
      "eligible account deletion",
    ],
  }),
  guide({
    slug: "manage-usernames",
    audience: "admin",
    title: t("Assign or change a permanent username", "分配或更改永久用户名"),
    summary: t(
      "Backfill an eligible missing handle or save a reviewed account/roster username without changing identity evidence.",
      "为符合条件缺失用户名者补充，或保存审核后的账号、名册用户名，同时保留身份依据。",
    ),
    route: "/admin/users",
    screenshot: "admin-users",
    focus: t(
      "Find Assign Username or the Username section inside Edit profile.",
      "找到分配用户名，或编辑资料中的用户名区块。",
    ),
    prerequisites: [
      t(
        "Admin/Head access. Both apply ordinary account username edits directly under current management policy; Coordinators cannot submit account username edits.",
        "需要管理员或负责人权限。当前管理政策下两者均可直接应用普通账号用户名编辑；协调员不能提交账号用户名编辑。",
      ),
    ],
    steps: [
      [
        t("Inspect the current handle", "检查当前用户名"),
        t(
          "Open Users & Roles and verify the exact login and linked tutor. For a verified eligible account without a handle, use Assign Username; reading the directory alone does not allocate one.",
          "打开用户与角色并核对具体登录及关联辅导伙伴。对已验证且符合条件的无用户名账号使用分配用户名；仅查看目录不会分配。",
        ),
      ],
      [
        t("Edit explicitly", "明确编辑"),
        t(
          "In Edit profile → Username, enter 1–64 ASCII letters or digits. Surrounding whitespace is trimmed and letters become lowercase. Review the old/new handles and the stated authority path.",
          "在编辑资料→用户名填写1至64个ASCII字母或数字。首尾空白会去除，字母转小写。审阅新旧用户名及显示权限路径。",
        ),
      ],
      [
        t("Review and save", "审核并保存"),
        t(
          "Review the old/new handles and save through Admin/Head authority. Confirm the applied result; an unchanged save is a no-op. Current policy rechecks older pending proposals before any reviewed application.",
          "审核新旧用户名并通过管理员、负责人权限保存。确认应用结果；保存相同值不会产生变化。当前政策会在审核应用旧待审提案前重新检查。",
        ),
      ],
      [
        t("Verify current values", "验证当前值"),
        t(
          "After the section refreshes, confirm the account and linked tutor handle changed together. Tell the owner to use the new handle or their existing email for sign-in after application.",
          "区块刷新后，确认账号及关联辅导伙伴用户名一并改变。应用后应告知用户使用新用户名或现有邮箱登录。",
        ),
      ],
    ],
    expected: t(
      "The intended handle is unique and synchronized with the linked tutor, or its reviewed request remains pending.",
      "预期用户名唯一且与关联辅导伙伴同步，或审核申请仍待处理。",
    ),
    explanation: [
      t(
        "A name or academic correction does not regenerate an established username. Changing the handle preserves email sign-in, password, IDs, memberships and history; the old handle stops signing in after application.",
        "姓名或学业修正不会重新生成已有用户名。更改用户名会保留邮箱登录、密码、ID、成员资格及历史；应用后旧用户名不能再登录。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The name is taken or the edit is stale",
          "用户名已被占用或编辑已过时",
        ),
        solution: t(
          "Check login and tutor-roster uniqueness, then choose a valid handle. If the account changed while you were editing, choose Discard Username Draft and Reload, review the current handle and re-enter the change. If reloading fails, retry the read before editing again.",
          "检查登录账号及辅导伙伴名册中的用户名是否唯一，再选择有效用户名。如果编辑期间账号发生变化，选择“放弃用户名草稿并重新加载”，核对当前用户名后重新输入变更。若重新加载失败，请先重试读取再编辑。",
        ),
      },
    ],
    sources: [
      "src/app/_components/account-username-editor.tsx",
      "src/server/api/routers/admin.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "Assign Username",
      "account username edit",
      "unlinked roster username",
      "username uniqueness",
      "permanent handle",
      "username synchronization",
    ],
  }),
  guide({
    slug: "combine-person-records",
    audience: "admin",
    title: t("Combine records after identity review", "审核身份后合并记录"),
    summary: t(
      "Group exact sources, select a retained login only when reviewed, and resolve current participation separately.",
      "分组合适准确来源，仅经审核选择保留登录，并单独解决当前参与。",
    ),
    route: "/admin/users",
    screenshot: "admin-users",
    focus: t(
      "Open Combine records; its source search is independent of directory filters.",
      "打开合并记录，其来源搜索与目录筛选独立。",
    ),
    prerequisites: [
      t(
        "Admin/Head access, verified identity evidence and your current password when the dedicated review requires it. Names/emails alone are not identity proof.",
        "需要管理员或负责人权限、已验证身份证据，以及专用审阅要求时的当前密码。姓名或邮箱本身不是身份证明。",
      ),
    ],
    steps: [
      [
        t("Select exact records", "选择准确记录"),
        t(
          "Open Combine records in Users & Roles or a historical profile. Search and select the exact login, tutor and tutee sources that belong to one person; read original IDs and evidence.",
          "在用户与角色或历史资料打开合并记录。搜索并选择属于同一人的准确登录、辅导伙伴及学习伙伴来源，阅读原始ID及证据。",
        ),
      ],
      [
        t("Review the full group", "审核完整分组"),
        t(
          "Preview every source. With no login the result remains accountless; one ready login may retain unowned history without reenrollment. For multiple logins, explicitly choose the retained login and review retirement only after conflicts are resolved.",
          "预览所有来源。无登录的结果仍为无账号；一个就绪登录可保留无归属历史而无需重新入组。多个登录时须明确选择保留登录，解决冲突后才审阅退休。",
        ),
      ],
      [
        t("Record evidence and confirm", "记录证据并确认"),
        t(
          "Enter identity evidence, acknowledge the complete review and provide your current password where required for multiple logins, ownership conflicts, active unowned work or restricted accounts. Read and retain the operation receipt.",
          "填写身份证据、确认完整审阅，并在多个登录、归属冲突、无归属活跃工作或受限账号等要求下填写当前密码。阅读并保留操作回执。",
        ),
      ],
      [
        t("Resolve operational work", "解决实际工作"),
        t(
          "If Current participation or login review required appears, open User details → Combined records → Review current participation. Follow each exact blocker, cancel an obsolete pending history invitation if reviewed, then Get fresh participation review and Finalize reviewed group with evidence.",
          "若出现需要当前参与或登录审核，打开用户详情→合并记录→审核当前参与。逐项处理具体阻碍；经审核可取消过时历史邀请，再获取最新参与审核并凭证据完成已审阅分组。",
        ),
      ],
    ],
    expected: t(
      "The directory identity is grouped with original sources retained, and any remaining operational review is explicit.",
      "目录身份已分组且原始来源保留，剩余实际操作审核明确可见。",
    ),
    explanation: [
      t(
        "Grouping does not silently union roles, transfer assignments, restore restrictions, deduplicate events or fabricate consent. Explicitly retired credentials stay disabled; source IDs preserve authorship. A receipt, not a checkbox or refresh, establishes finalization.",
        "分组不会暗中合并角色、转移配对、解除限制、去重事件或制造同意。明确退休凭据仍禁用；来源ID保留作者归属。完成由回执证明，不是勾选或刷新。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A new review still lists records from an earlier combination",
          "新审阅仍列出上一次合并的记录",
        ),
        solution: t(
          "In Selected records, remove each unrelated source before opening Review combination. Compare the names and original record IDs in Reviewed source records before confirming.",
          "打开审阅合并前，在已选记录中移除每条无关来源。确认前对照审阅来源记录中的姓名和原记录编号。",
        ),
      },
      {
        problem: t(
          "The review changed or the response was interrupted",
          "审阅已改变或响应中断",
        ),
        solution: t(
          "Get a fresh preview after changed evidence. If submission may have succeeded, inspect its receipt first and use read-only refresh. Do not submit a different grouping intent to recover an uncertain prior result.",
          "证据改变后获取新预览。若提交可能已成功，先检查回执并使用只读刷新。不要提交不同分组意图来恢复不确定的先前结果。",
        ),
      },
    ],
    sources: [
      "src/app/_components/combine-records.tsx",
      "src/app/_components/person-participation-review.tsx",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "Combine records",
      "retained login",
      "explicit login retirement",
      "identity evidence",
      "current participation blockers",
      "pending history invitation cancellation",
      "Finalize reviewed group",
    ],
  }),
  guide({
    slug: "link-historical-participant-records",
    audience: "admin",
    title: t(
      "Link history or invite a former participant",
      "关联历史或邀请往届参与者",
    ),
    summary: t(
      "Assign exact retained history to its verified owner or send an invitation with frozen history-only scope.",
      "将准确保留历史关联至已验证归属人，或发送范围固定的仅历史邀请。",
    ),
    route: "/admin/users",
    screenshot: "admin-users",
    focus: t(
      "Use historical Edit profile or User details → Combined records.",
      "使用历史资料编辑或用户详情→合并记录。",
    ),
    prerequisites: [
      t(
        "Admin/Head access and reviewed ownership evidence for every source. A private recipient mailbox must be verified through the recipient workflow.",
        "需要管理员或负责人权限，且每个来源都有已审核归属证据。私人收件邮箱须通过收件人流程验证。",
      ),
    ],
    steps: [
      [
        t("Find the original archive", "查找原始档案"),
        t(
          "Use Show past tutors/Show historical records and open Edit profile on the exact archive, or open Combined records for a reviewed historical group. Inspect original enrollment and existing retained owner.",
          "使用显示过往辅导伙伴或显示历史记录，打开准确档案的编辑资料，或打开已审核历史分组的合并记录。检查原始入组及现有保留归属人。",
        ),
      ],
      [
        t("Choose link or invitation", "选择关联或邀请"),
        t(
          "For an existing verified owner use the reviewed Combine records/history linking pathway. To invite an alumnus without a login, choose Set up historical access and review the recipient and every included source.",
          "已有已验证归属人使用审阅后的合并记录或历史关联路径。邀请无登录往届成员时选择设置历史访问，并审阅收件人及全部包含来源。",
        ),
      ],
      [
        t("Review ownership or delivery", "审核归属或投递"),
        t(
          "Record identity evidence and provide current-password confirmation for a retained-owner correction when required. Send only the reviewed invitation scope; later additions to a group do not expand a pending invitation.",
          "记录身份证据，修正保留归属人时按要求提供当前密码确认。仅发送已审核邀请范围；后续添加组员不会扩大待处理邀请。",
        ),
      ],
      [
        t("Verify history access separately", "单独验证历史访问"),
        t(
          "The recipient verifies the mailbox, reviews the invitation and separately claims the exact frozen sources after sign-in. Check the resulting ownership/claim receipt; current tutoring participation is not granted by history setup.",
          "收件人验证邮箱、审阅邀请，并在登录后单独认领准确固定来源。检查归属或认领回执；历史设置不会授予当前辅导参与资格。",
        ),
      ],
    ],
    expected: t(
      "Only the reviewed original history becomes linked or invited, with ownership evidence preserved.",
      "只有经审核原始历史被关联或邀请，且归属证据保留。",
    ),
    explanation: [
      t(
        "Several archived profiles may belong to one login without replacing its current profile or reactivating archives. Existing historical Tutee invitations keep their original claim workflow; matching contact data alone never authorizes private history.",
        "多个归档资料可属于同一登录，不替换当前资料或重新激活档案。现有历史学习伙伴邀请保留原认领流程；联系方式相同本身绝不授权私人历史。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A conflicting owner or current work blocks setup",
          "归属冲突或当前工作阻止设置",
        ),
        solution: t(
          "Open the exact ownership/current-participation review and resolve its stated sources. Do not send a broader replacement invitation or link by email alone. Cancel only a reviewed obsolete invitation, then load fresh evidence.",
          "打开准确归属或当前参与审核，解决所述来源。不要发送范围更广替代邀请或仅按邮箱关联。只取消已审核过时邀请，再读取最新证据。",
        ),
      },
    ],
    sources: [
      "src/app/_components/historical-record-invitation.tsx",
      "src/app/_components/combine-records.tsx",
      "docs/guides/historical-participant-transition.md",
    ],
    covers: [
      "archived tutor history link",
      "historical tutee ownership",
      "history-only invitation",
      "frozen invitation scope",
      "retained-owner correction",
      "recipient history claim",
    ],
  }),
  guide({
    slug: "correct-combined-records",
    audience: "admin",
    title: t(
      "Correct a mistaken grouping or history reader",
      "修正错误分组或历史读取人",
    ),
    summary: t(
      "Separate directory identities, correct retired-account history, or merge active participation through distinct reviews.",
      "通过不同审阅分开目录身份、修正退休账号历史或合并活跃参与。",
    ),
    route: "/admin/users",
    screenshot: "admin-users",
    focus: t(
      "Open User details → Combined records and choose the exact correction workflow.",
      "打开用户详情→合并记录，选择准确修正流程。",
    ),
    prerequisites: [
      t(
        "Admin/Head access, exact source evidence and current-password confirmation. These dedicated corrections are not ordinary Coordinator proposals.",
        "需要管理员或负责人权限、准确来源证据及当前密码确认。这些专用修正不是普通协调员提案。",
      ),
    ],
    steps: [
      [
        t("Choose the correction boundary", "选择修正边界"),
        t(
          "Open Combined records and identify whether the error concerns directory grouping, who reads retired-account history, or future active work. Use the corresponding named workflow; one cannot substitute for another.",
          "打开合并记录，确定错误涉及目录分组、退休账号历史读取人，还是未来活跃工作。使用相应明确流程；三者不能互相替代。",
        ),
      ],
      [
        t("Separate a mistaken grouping", "分离错误分组"),
        t(
          "In Separate Mistakenly Grouped Records, select sources to move and Review separation. Keep each login with its current records and retained history. Review both resulting identities, evidence and password before confirming; both require fresh participation review afterward.",
          "在分离错误分组记录选择要移动来源，再审核分离。每个登录须与其当前记录及保留历史一起。确认前审阅两个结果身份、证据及密码；此后两者均需最新参与审核。",
        ),
      ],
      [
        t("Correct exact history access", "修正准确历史访问"),
        t(
          "In Correct Retired-Account History, select original retired logins and a live history reader or quarantine. Decide every affected row as Retain, Assign or Quarantine, inspect before/after readers and remaining restrictions, then confirm the frozen review.",
          "在修正退休账号历史选择原退休登录及活跃历史读取人，或隔离。逐行决定保留、分配或隔离，检查前后读取人及剩余限制，再确认固定审阅。",
        ),
      ],
      [
        t(
          "Transfer active execution only when intended",
          "仅按意图转移活跃执行",
        ),
        t(
          "In Merge Active Participation, choose one active tutor/tutee record and retained login, exact qualification sources and whose willingness/availability to keep. Review assignments, published responses/deadlines, history-access and discipline consequences, record evidence/password and confirm only when all blockers resolve.",
          "在合并活跃参与选择一份活跃辅导伙伴、学习伙伴记录及保留登录、准确资格来源和要保留的意愿、可用时间来源。审阅配对、已发布响应及截止时间、历史权限与纪律后果，记录证据及密码，并在全部阻碍解决后确认。",
        ),
      ],
    ],
    expected: t(
      "A dedicated receipt records the reviewed separation, history correction or future-work transfer without restoring retired credentials.",
      "专用回执记录经审核分离、历史修正或未来工作转移，不会恢复退休凭据。",
    ),
    explanation: [
      t(
        "Directory grouping, private ownership and active execution are separate. Original actors, completed lessons, signatures, credit and intake priority remain evidence. New history access does not remove original suspension/departure restrictions, and pending email copies are never forwarded to a new reader.",
        "目录分组、私人归属与活跃执行彼此独立。原作者、已完成课程、签名、学时及报名优先级仍保留为证据。新历史权限不会解除原暂停、离校限制，待发邮件副本也不会转发给新读取人。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The response is uncertain or a blocker remains",
          "响应不确定或仍有阻碍",
        ),
        solution: t(
          "Check the operation receipt first. If none is visible, use the same frozen-operation retry with current password as offered; do not alter sources mid-retry. Resolve exact source restrictions/workflow blockers and obtain a fresh review before a new intent.",
          "先检查操作回执。若仍无回执，按界面使用当前密码重试同一固定操作，不要在重试中更改来源。解决具体来源限制及流程阻碍，再为新意图获取新审阅。",
        ),
      },
    ],
    sources: [
      "src/app/_components/person-partition.tsx",
      "src/app/_components/person-history-correction.tsx",
      "src/app/_components/person-participation-transfer.tsx",
    ],
    covers: [
      "Separate Mistakenly Grouped Records",
      "Correct Retired-Account History",
      "history quarantine",
      "per-row ownership decisions",
      "Merge Active Participation",
      "qualification/preference source review",
      "published deadline preservation",
      "exact-operation recovery",
    ],
  }),
  guide({
    slug: "correct-historical-academics",
    title: t("Correct historical academic evidence", "修正历史学业证据"),
    summary: t(
      "Review original enrollment values and apply a validated single or CSV batch correction.",
      "审核原始入组值，并应用经验证单项或CSV批量修正。",
    ),
    route: "/admin/academic-corrections",
    screenshot: "admin-academic-corrections",
    focus: t(
      "Choose Tutor/Tutee records and inspect before/after evidence in the correction preview.",
      "选择辅导伙伴或学习伙伴记录，并在修正预览检查前后证据。",
    ),
    steps: [
      [
        t("Find the historical source", "查找历史来源"),
        t(
          "Under Data & Recovery, open Academic Corrections, choose Tutor or Tutee and search the exact participant. Read original enrollment year, grade/reference year and any existing evidence gaps.",
          "在“数据与恢复”下打开学业修正，选择辅导伙伴或学习伙伴并搜索准确参与者。阅读原入组年份、年级及参考年份和现有证据缺口。",
        ),
      ],
      [
        t("Prepare the correction", "准备修正"),
        t(
          "Edit the intended historical fields and reason. For a batch, use the offered CSV format/export and keep its source fingerprints; the website and CSV share the validated preview.",
          "编辑预期历史字段及原因。批量操作使用提供CSV格式或导出并保留来源指纹；网页和CSV使用相同验证预览。",
        ),
      ],
      [
        t("Review every before/after value", "审核所有前后值"),
        t(
          "Inspect the full correction review, original sources and changed academic values. Admin/Head apply directly; a Coordinator submits the complete batch for review.",
          "检查完整修正审阅、原始来源及变化学业值。管理员或负责人直接应用；协调员将完整批次提交审核。",
        ),
      ],
      [
        t("Verify the accepted evidence", "验证已接受证据"),
        t(
          "After the result, reread the historical record and its audit record. Check current-account academics separately; a historical correction is not permission to invent present-day enrollment data.",
          "操作后重新阅读历史记录及审计证据。当前账号学业应单独检查；历史修正不代表可以编造当前入学资料。",
        ),
      ],
    ],
    expected: t(
      "The reviewed historical values change atomically with source evidence and reason retained.",
      "经审核历史值整体改变，并保留来源证据及原因。",
    ),
    explanation: [
      t(
        "Drafts retain exported fingerprints and are not silently rebased by background refresh. A batch is reviewed as one validated change; original enrollment values remain distinct from current account profiles.",
        "草稿保留导出指纹，不会被后台刷新暗中重新基准化。批次作为一个已验证变更审阅；原入组值与当前账号资料仍区分。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The CSV or preview is stale", "CSV或预览已过时"),
        solution: t(
          "Read the reported row/field errors. Reload fresh source evidence and regenerate/review the batch; do not strip fingerprints or retry old academic assumptions after a version conflict.",
          "阅读报告行或字段错误。重新读取来源证据并重新生成、审阅批次；版本冲突后不要移除指纹或重试旧学业假设。",
        ),
      },
    ],
    sources: [
      "src/app/_components/historical-academic-corrections.tsx",
      "src/lib/historical-academics.ts",
      "src/app/(admin)/admin/academic-corrections/page.tsx",
    ],
    covers: [
      "historical academic search",
      "single correction",
      "CSV academic batch",
      "before/after academic preview",
      "source fingerprints",
      "Coordinator correction proposal",
    ],
  }),
  guide({
    slug: "submit-management-proposals",
    title: t("Submit and follow a management proposal", "提交及跟进管理提案"),
    summary: t(
      "Capture a permitted change, read its request receipt and withdraw an unapplied proposal when needed.",
      "捕获允许的变更、阅读申请回执，并按需撤回尚未应用提案。",
    ),
    route: "/admin/approvals",
    screenshot: "admin-approvals",
    focus: t(
      "Use status/requester filters and open the exact request's evidence.",
      "使用状态及申请人筛选，并打开准确申请证据。",
    ),
    steps: [
      [
        t("Prepare the change in its own page", "在对应页面准备变更"),
        t(
          "Edit the intended operation where its records live, inspect the proposed values and any offered consequence review, then choose the shown request/review action. Coordinator authority is explicit; an unavailable action is not a generic permission to propose it elsewhere.",
          "在记录所属页面编辑预期操作，检查拟变更值及提供的后果审阅，再选择显示的申请、审核操作。协调员权限是明确列出的；操作不可用不代表可在别处通用提案。",
        ),
      ],
      [
        t("Open the request receipt", "打开申请回执"),
        t(
          "When Submitted for Review appears, open its Management Actions link and verify requester, target, operation, submitted time and captured before/after evidence.",
          "出现已提交审核时，打开管理操作链接并核对申请人、目标、操作、提交时间及捕获的前后证据。",
        ),
      ],
      [
        t("Follow pending and resolved states", "跟进待处理及已处理状态"),
        t(
          "Use Status to follow your requests. Admin/Head can also filter Requester; Coordinators see their own requests. Read the decision and resulting record rather than assuming the requested change was immediately saved.",
          "使用状态跟进本人的申请。管理员／负责人还可按申请人筛选；协调员只能查看自己的申请。阅读决定及最终记录，不要假设请求变更已立即保存。",
        ),
      ],
      [
        t("Withdraw an unapplied request", "撤回尚未应用申请"),
        t(
          "If your pending proposal is no longer needed, check its exact target and choose Withdraw Request. This button submits withdrawal immediately. Reversing a live applied change requires the owning feature's reviewed reversal.",
          "若自己的待审提案已不需要，先核对具体目标，再选择撤回申请；该按钮会立即提交撤回。逆转实际已应用变更需使用对应功能的审阅逆转流程。",
        ),
      ],
    ],
    expected: t(
      "A clearly identified proposal has the intended evidence and an honest pending/resolved state.",
      "可明确识别提案拥有预期证据及真实待处理或已处理状态。",
    ),
    explanation: [
      t(
        "Pending proposals change no live records. Original submitted evidence stays immutable; current roles, policy and target versions are rechecked when a reviewer applies the request.",
        "待审提案不改变实际记录。原始提交证据保持不可变；审核人应用申请时会重新检查当前角色、政策及目标版本。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The request is stale or rejected", "申请已过时或被拒"),
        solution: t(
          "Read the decision and changed evidence, return to the owning page, reload current values and submit a newly reviewed intent if still needed. Do not replay an old confirmation or submit duplicate proposals while waiting.",
          "阅读决定及变化证据，回到对应页面重载当前值，仍有需要时提交新审阅意图。不要重放旧确认或在等待时重复提案。",
        ),
      },
    ],
    sources: [
      "src/app/_components/management-actions.tsx",
      "src/lib/approval-policy.ts",
      "src/server/approvals.ts",
    ],
    covers: [
      "Coordinator proposal",
      "Admin refresh request",
      "Management Actions receipt",
      "status/requester filters",
      "proposal withdrawal",
      "pending versus applied evidence",
    ],
  }),
  guide({
    slug: "decide-management-proposals",
    audience: "admin",
    title: t("Review a management change request", "审核管理变更申请"),
    summary: t(
      "Read captured and current evidence, confirm consequences and approve or reject with a note.",
      "阅读已捕获及当前证据、确认后果，并附说明批准或拒绝。",
    ),
    route: "/admin/approvals",
    screenshot: "admin-approvals",
    focus: t(
      "Open a pending request and compare its recorded evidence before approving.",
      "打开待处理申请，批准前比较记录证据。",
    ),
    prerequisites: [
      t(
        "Current Admin/Head review authority for the operation. Head alone reviews official refresh requests; only Head can review their own eligible management proposal.",
        "需要操作所需当前管理员或负责人审核权限。只有负责人审核正式换期申请；只有负责人可审核本人符合条件管理提案。",
      ),
    ],
    steps: [
      [
        t("Read the complete request", "阅读完整申请"),
        t(
          "Open Management Actions and filter pending requests. Read requester, exact target, operation and captured before/after evidence. Follow the owning-record link when additional context is needed.",
          "打开管理操作并筛选待处理申请。阅读申请人、准确目标、操作及捕获前后证据。需要更多背景时跟随所属记录链接。",
        ),
      ],
      [
        t("Compare current authority and evidence", "比较当前权限及证据"),
        t(
          "Check that the request still matches current target data and authority. A compatible old proposal can be reviewed under current policy; stale or incompatible evidence requires rejection/return and a fresh request.",
          "检查申请仍符合当前目标数据及权限。兼容旧提案可按当前政策审核；过时或不兼容证据须拒绝或退回并重新申请。",
        ),
      ],
      [
        t("Decide with a note", "附说明决定"),
        t(
          "Enter the required review note, check the exact request, then choose Approve and Apply or Reject with Feedback. Complete the consequence review and fresh-password confirmation when the operation offers or requires them. Requests without an extra consequence review submit directly from the decision button.",
          "填写必填审核说明、核对具体申请，再选择批准并应用或拒绝并反馈。操作提供或要求后果审阅、密码确认时，完成对应步骤。没有额外后果审阅的申请会由决定按钮直接提交。",
        ),
      ],
      [
        t("Verify outcome and notices", "验证结果及通知"),
        t(
          "Inspect the applied record and separate request/action audit entries. Refresh reviewer notifications can append missing eligible notices without deciding requests or resending already-delivered notices.",
          "检查已应用记录及独立申请、操作审计条目。刷新审核人通知可补充缺失合资格通知，不会决定申请或重发已投递通知。",
        ),
      ],
    ],
    expected: t(
      "The request has one recorded decision and any applied action matches the reviewed current evidence.",
      "申请有一项已记录决定，且应用操作符合已审核当前证据。",
    ),
    explanation: [
      t(
        "Admin/Head review non-refresh proposals; official refresh belongs to Head. The Head self-review exception never permits an applicant to decide their own qualification interview. Review notes and policy versions remain audit record.",
        "管理员或负责人审核非换期提案；正式换期归负责人。负责人自审例外绝不允许申请人决定自己的资格面试。审核说明及政策版本保留为审计证据。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Approval is blocked or reviewer notices are missing",
          "批准受阻或缺少审核通知",
        ),
        solution: t(
          "Check self-review, current role/suspension and stale-evidence restrictions. Use Refresh reviewer notifications for missing routing only; it is not approval. For changed targets, request a new proposal rather than force the old one.",
          "检查自审、当前角色或暂停及过时证据限制。缺少分派仅使用刷新审核人通知，它不是批准。目标改变后应要求新提案，不要强推旧提案。",
        ),
      },
    ],
    sources: [
      "src/app/_components/management-actions.tsx",
      "src/server/approvals.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "approve/reject proposal",
      "captured/current evidence",
      "fresh consequence review",
      "self-review limits",
      "review note",
      "reviewer notification reconciliation",
    ],
  }),
  guide({
    slug: "inspect-audit-evidence",
    title: t(
      "Find an audit event and read exact evidence",
      "查找审计事件并阅读确切证据",
    ),
    summary: t(
      "Filter by stable actor, operation, record and displayed program dates; inspect stored values without reconstructing history.",
      "按稳定操作人、操作、记录及所示项目日期筛选，查看存储值而非重建历史。",
    ),
    route: "/admin/audit",
    screenshot: "admin-audit",
    focus: t(
      "Use the actor/event/operation/record/date filters, then Actions → Details.",
      "使用操作人、事件、操作、记录、日期筛选，再选择操作→详情。",
    ),
    steps: [
      [
        t("Set the filters", "设置筛选"),
        t(
          "Under Data & Recovery, open Audit Log and choose actor, event, operation, record or date filters. Date controls use the displayed program timezone. Actors with the same name remain separate stable accounts; removed users appear as Former account.",
          "在“数据与恢复”下打开审计日志并选择操作人、事件、操作、记录或日期筛选。日期控件使用显示的项目时区。同名操作人仍为不同稳定账号；已删除用户显示为原账号。",
        ),
      ],
      [
        t("Open event details", "打开事件详情"),
        t(
          "Choose Actions → Details to inspect recorded actor/account IDs, target, operation, exact timestamp including UTC, approval link and undo time. A proposal and its applied action are separate events.",
          "选择操作→详情，查看记录操作人及账号ID、目标、操作、包含UTC的确切时间、审核链接及撤销时间。提案和应用操作是不同事件。",
        ),
      ],
      [
        t("Read captured values", "阅读捕获值"),
        t(
          "Inspect the readable before/after fields and evidence. Use View stored JSON when exact types, field names or escaped text matter. Missing detailed evidence means it was not recorded, not that the current profile supplies it.",
          "检查可读前后字段及证据。需要准确类型、字段名或转义文字时使用查看存储JSON。缺少详细证据表示当时未记录，不应从当前资料补推。",
        ),
      ],
      [
        t("Follow recovery separately", "单独跟进恢复"),
        t(
          "If a captured admission needs recovery, open the supported Recovery workflow or ask the technical operator using an exact record reference. Audit details and old Undo summaries do not establish a complete reversible chain.",
          "若捕获的准入需恢复，应打开支持的恢复流程，或用准确记录参考联系技术操作员。审计详情和旧撤销摘要不构成完整可逆链。",
        ),
      ],
    ],
    expected: t(
      "You can cite the recorded event and distinguish known evidence from information never captured.",
      "能够引用记录事件，并分清已知证据与从未捕获的信息。",
    ),
    explanation: [
      t(
        "Stored evidence is historical. Current names or roles do not rewrite the event's recorded actor; event summaries and detailed values have different limits. Observer summaries remain masked.",
        "存储证据属于历史。当前姓名或角色不会重写事件记录操作人；事件摘要和详细值具有不同限制。观察者摘要仍被遮蔽。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Details failed or no evidence appears",
          "详情读取失败或无证据",
        ),
        solution: t(
          "Retry the event read without repeating its action. If the event explicitly lacks detail, document that limit and use other recorded sources; do not infer that nothing happened or invent before/after values.",
          "重试事件读取，不要重复其操作。若事件明确缺少详情，应记录该限制并使用其他已记录来源；不要推断未发生操作或编造前后值。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/audit/page.tsx",
      "src/server/recovery/record-inspector.ts",
    ],
    covers: [
      "audit filters",
      "program-timezone dates",
      "stable actors",
      "audit details",
      "before/after evidence",
      "stored JSON",
      "proposal/action distinction",
    ],
  }),
  guide({
    slug: "preview-admission-recovery",
    title: t(
      "Preview and apply supported admission recovery",
      "预览及应用受支持准入恢复",
    ),
    summary: t(
      "Inspect captured initial actions and their dependent consequences before any recovery is admitted.",
      "接受恢复前检查已捕获初始操作及依赖后果。",
    ),
    route: "/admin/recovery",
    screenshot: "admin-recovery",
    focus: t(
      "Choose the exact captured admission and inspect the complete recovery plan.",
      "选择准确捕获准入并检查完整恢复计划。",
    ),
    steps: [
      [
        t("Identify the target", "识别目标"),
        t(
          "Under Data & Recovery, open Recovery and select the captured initial admission from recorded evidence. Use exact actor/record references from Audit Log or Database records rather than a similar name.",
          "在“数据与恢复”下打开恢复并从已记录证据选择捕获初始准入。使用审计日志或数据库记录中的准确操作人、记录参考，不要按相似姓名选择。",
        ),
      ],
      [
        t("Preview the complete plan", "预览完整计划"),
        t(
          "Read the original effect, later dependent actions and resulting before/after records. The website supports a complete plan with at most one later dependent action; longer chains require the operator CLI.",
          "阅读原始效果、后续依赖操作及最终前后记录。网站支持至多一个后续依赖操作的完整计划；更长链需要操作员命令行。",
        ),
      ],
      [
        t("Confirm through the authorized path", "通过授权路径确认"),
        t(
          "Enter the required recovery evidence/reason and review all consequences. Admin/Head apply an eligible plan; Coordinator submissions require review. Cancel if the preview does not establish the intended recovery boundary.",
          "填写必要恢复证据或原因并审阅全部后果。管理员或负责人应用符合条件计划；协调员提交需要审核。若预览无法确立预期恢复边界，应取消。",
        ),
      ],
      [
        t("Verify receipt and downstream state", "验证回执及下游状态"),
        t(
          "After the accepted result, inspect the recovery receipt and affected records. Use read-only recovery after a refresh failure; unsupported chains should be handed to the technical operator with exact references.",
          "结果被接受后检查恢复回执及受影响记录。刷新失败使用只读恢复；不支持链应附准确参考交给技术操作员。",
        ),
      ],
    ],
    expected: t(
      "Only a complete supported recovery plan is admitted, with its evidence and outcome recorded.",
      "只有完整受支持恢复计划被接受，且其证据与结果被记录。",
    ),
    explanation: [
      t(
        "Old one-click audit Undo is unavailable because legacy payloads do not prove the whole consequence chain. A read-only preview or database inspector does not itself change records or authorize an unsupported recovery.",
        "旧的一键审计撤销不可用，因为旧载荷不能证明完整后果链。只读预览或数据库检查器本身不会更改记录，也不授权不支持的恢复。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The plan is unsupported or changed",
          "计划不受支持或已改变",
        ),
        solution: t(
          "Read the named dependency/blocker and load a fresh plan. Do not selectively undo easy fields. Use the maintained recovery runbook/operator CLI for longer or unsupported chains.",
          "阅读明确依赖或阻碍并加载新计划。不要选择性撤销简单字段。较长或不支持链应使用维护中的恢复手册及操作员命令行。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/recovery/page.tsx",
      "src/server/recovery/record-inspector.ts",
      "docs/guides/recovery.md",
    ],
    covers: [
      "captured admission recovery",
      "dependent consequence plan",
      "recovery preview",
      "reviewed recovery application",
      "operator CLI escalation",
      "legacy Undo limit",
    ],
  }),
  guide({
    slug: "inspect-database-records",
    audience: "admin",
    title: t("Inspect persisted records safely", "安全查看持久化记录"),
    summary: t(
      "Browse approved table projections, exact keys and recorded relationships without writing to the database.",
      "浏览获准表投影、准确键及记录关系，不写入数据库。",
    ),
    route: "/admin/database",
    screenshot: "admin-database",
    focus: t(
      "Choose Database table and optionally apply an exact JSON primary key.",
      "选择数据库表，并可选应用准确JSON主键。",
    ),
    prerequisites: [
      t(
        "Admin or Head access. The inspector is read-only and follows a field/table policy; it is not unrestricted database administration.",
        "需要管理员或负责人权限。检查器只读，并遵循字段、表政策；它不是无限制数据库管理。",
      ),
    ],
    steps: [
      [
        t("Select an approved table", "选择获准表"),
        t(
          "Under Data & Recovery, open Database records and choose Database table. Read its primary-key fields and Field access policy. Metadata only means rows are not queried under the current policy.",
          "在“数据与恢复”下打开数据库记录并选择数据库表。阅读其主键字段及字段访问政策。仅元数据表示当前政策下不会查询行。",
        ),
      ],
      [
        t("Browse or enter an exact key", "浏览或输入准确键"),
        t(
          "Leave Exact primary key blank to browse, or enter a JSON object containing every primary-key field with scalar values and choose Apply key filter. Use Previous/Next for the resulting pages.",
          "准确主键留空可浏览，或输入包含全部主键字段及标量值的JSON对象，再选择应用键筛选。使用上一页、下一页浏览结果。",
        ),
      ],
      [
        t("Inspect persisted evidence", "查看持久化证据"),
        t(
          "Choose Inspect record and read permitted fields and omitted-field reasons. Follow a recorded relationship only when needed; every linked read rechecks current policy and masking.",
          "选择检查记录，阅读允许字段及省略原因。必要时跟随记录关系；每次关联读取均重新检查当前政策及遮蔽。",
        ),
      ],
      [
        t("Copy an operator reference", "复制操作员参考"),
        t(
          "Use Copy record reference to preserve the exact table/key for the technical operator. Read CLI placeholders carefully; the reference is an identifier, not permission to execute a shell mutation.",
          "使用复制记录参考，将准确表和键交给技术操作员。仔细阅读命令行占位符；参考是标识，不是执行命令行写入的授权。",
        ),
      ],
    ],
    expected: t(
      "You have a precise permitted record reference and understand which values/relationships were not retrieved.",
      "获得准确且获准的记录参考，并理解哪些值或关系未读取。",
    ),
    explanation: [
      t(
        "No recorded relationships does not prove there are no other effects. Sensitive, oversized or unsupported fields remain omitted; the inspector does not reconstruct them or prove a complete recovery chain.",
        "未记录关系不证明不存在其他后果。敏感、超长或不支持字段仍会省略；检查器不会重建它们或证明完整恢复链。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The key is invalid or results are metadata only",
          "键无效或结果仅元数据",
        ),
        solution: t(
          "Match exactly the displayed primary-key field names and JSON scalar types. For metadata-only tables use the operator recovery guide; do not try alternate keys to infer protected row existence.",
          "准确匹配显示主键字段名及JSON标量类型。仅元数据表应使用操作员恢复指南，不要尝试替代键推测受保护行是否存在。",
        ),
      },
    ],
    sources: [
      "src/app/_components/database-inspector.tsx",
      "src/server/recovery/record-inspector.ts",
      "src/app/(admin)/admin/database/page.tsx",
    ],
    covers: [
      "database table metadata",
      "exact JSON key",
      "persisted field reader",
      "omitted-field policy",
      "recorded relationships",
      "CLI reference copy",
      "read-only inspector",
    ],
  }),
  guide({
    slug: "transfer-program-records",
    audience: "admin",
    title: t(
      "Export or import program-record archives",
      "导出或导入项目记录归档",
    ),
    summary: t(
      "Use stable-ID UTF-8 CSV templates, preview dependencies and import without overwriting existing records.",
      "使用稳定ID的UTF-8 CSV模板、预览依赖并导入，保留现有记录不覆盖。",
    ),
    route: "/admin/records",
    screenshot: "admin-records",
    focus: t(
      "Use Export, Templates and the selected-file import preview.",
      "使用导出、模板及已选文件导入预览。",
    ),
    prerequisites: [
      t(
        "Admin/Head access for templates, previews, imports and exports. Review archival purpose and storage before moving participant records.",
        "模板、预览、导入及导出均需要管理员或负责人权限。移动参与者记录前审核归档用途及存储位置。",
      ),
    ],
    steps: [
      [
        t("Download an archive or templates", "下载归档或模板"),
        t(
          "Under Data & Recovery, open Program Records and choose Export CSV archive or Download CSV templates. Read the listed export scope. Preserve the ZIP/CSV headers and stable source IDs. A full backup is a separate operator workflow.",
          "在“数据与恢复”下打开“项目记录”，选择“导出 CSV 归档”或“下载 CSV 模板”。阅读列出的导出范围，保留 ZIP、CSV 表头及稳定来源 ID。完整备份由操作员通过独立流程执行。",
        ),
      ],
      [
        t("Prepare related files together", "一起准备关联文件"),
        t(
          "Use the offered UTF-8 CSV formats and include related files together. Under Import Past Records, select the CSV files or ZIP archive. Check the selected file, parsed CSV count and displayed limits before previewing.",
          "使用提供的 UTF-8 CSV 格式，并一起选择相关文件。在“导入历史记录”中选择 CSV 文件或 ZIP 归档。预览前核对所选文件、解析出的 CSV 数量及显示的限制。",
        ),
      ],
      [
        t("Preview before import", "导入前预览"),
        t(
          "Choose Preview import and check New records and Already present for each record type. If a conflict or missing dependency is reported, correct the named file or row and preview again.",
          "选择“预览导入”，检查各类型的新增记录及已存在记录数量。若提示冲突或缺少依赖，请修正提示中的文件或行，再次预览。",
        ),
      ],
      [
        t("Confirm and verify", "确认并验证"),
        t(
          "Acknowledge the reviewed preview and choose Import records. Check the completion counts and audit receipt. Duplicate entries preserve the existing records and their stable source IDs.",
          "确认已审核预览后选择“导入记录”。核对完成数量和审计记录。重复条目会保留现有记录及其稳定来源 ID。",
        ),
      ],
    ],
    expected: t(
      "The reviewed archive is downloaded or only its validated new historical records are imported.",
      "经审核归档已下载，或仅其已验证新历史记录被导入。",
    ),
    explanation: [
      t(
        "The archive excludes credentials, configuration and private messages and grants no current participation. Imported historical source credits remain archive evidence and are excluded from new school posting; database backup/recovery is a separate operator process.",
        "归档不包括凭据、配置和私人消息，也不授予当前参与资格。导入历史来源学时保留为归档证据，不进入新学校入账；数据库备份和恢复属于独立操作员流程。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A preview has missing dependencies or conflicting IDs",
          "预览缺少依赖或ID冲突",
        ),
        solution: t(
          "Use the exact templates and include the referenced source files in the same review. Resolve conflicts against existing evidence; do not expect import to update old rows. Preview again after every file change.",
          "使用准确模板，并在同一次审核包含被引用来源文件。对照现有证据解决冲突，不要预期导入更新旧行。每次文件变化后重新预览。",
        ),
      },
    ],
    sources: [
      "src/app/_components/record-transfer.tsx",
      "src/lib/record-transfer-archive.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "program CSV ZIP export",
      "CSV templates",
      "UTF-8/stable IDs",
      "dependent archive import",
      "preview new/skipped/conflicts",
      "non-overwriting import",
      "archive scope exclusions",
    ],
  }),
  guide({
    slug: "supervise-disclosed-messages",
    audience: "admin",
    title: t(
      "Review disclosed messages and contact restrictions",
      "审核已告知监管消息及联系限制",
    ),
    summary: t(
      "Use reasoned Admin/Head supervision and separate permission controls without entering unrelated private threads.",
      "使用带理由的管理员或负责人监管及独立权限控件，避免进入无关私人会话。",
    ),
    route: "/admin/messages/supervision",
    screenshot: "admin-supervision",
    focus: t(
      "Use Supervision for reviewed conversations; Own inbox returns to your messages.",
      "监管用于审阅会话；个人收件箱返回自己的消息。",
    ),
    prerequisites: [
      t(
        "Current Admin or Head message-supervision authority. Coordinators and participant inbox access do not grant supervision.",
        "需要当前管理员或负责人消息监管权限。协调员或参与者收件箱权限不授予监管。",
      ),
    ],
    steps: [
      [
        t("Find the disclosed conversation", "查找已告知监管会话"),
        t(
          "Open Message Supervision. Search by name, username or message text, then check participants and visibility. Use View conversation to narrow the disclosed messages to that pair.",
          "打开消息监管，按姓名、用户名或消息正文搜索，核对参与者及可见状态。选择“查看双方对话”，筛选到该双方已告知监督规则的消息。",
        ),
      ],
      [
        t("Record the review reason", "记录审阅原因"),
        t(
          "Enter a review reason of at least five characters and choose Open audited review on the exact message. Read the content and audit history. Supervision applies to messages covered by the disclosed rule.",
          "输入至少五个字符的审阅理由，再对对应消息选择“审阅并记录操作”。查看正文及审计记录。监督适用于已告知监督规则的消息。",
        ),
      ],
      [
        t("Moderate explicitly", "明确执行监管操作"),
        t(
          "Check the exact message and enter the reason for changing it. Hide from participants and Restore for participants submit immediately. Check the resulting visibility and audit history. Use the separate account permission controls to restrict or restore contact access.",
          "核对对应消息并填写变更理由。“对双方隐藏”和“恢复双方可见”会立即提交。核对变更后的可见状态和审计记录。限制或恢复联系权限请使用独立的账号权限控件。",
        ),
      ],
      [
        t("Maintain permission rules separately", "单独维护权限规则"),
        t(
          "Choose Messaging permissions in Program Settings to inspect permitted contact groups by role or account. Choose Your inbox to send your own messages.",
          "选择“在项目设置中管理消息权限”，按角色或账号查看允许联系的组。发送自己的消息时选择“我的收件箱”。",
        ),
      ],
    ],
    expected: t(
      "An eligible reviewed conversation or restriction action has its own reason and audit record.",
      "符合条件审阅会话或限制操作拥有独立原因及审计证据。",
    ),
    explanation: [
      t(
        "Private messages are separate deliveries with participant ownership. Supervision is disclosed, permission-scoped and audited; it does not authorize silent forwarding or access to every historical message.",
        "私人消息是参与者拥有的独立投递。监管经过告知、受权限约束并有审计，不授权暗中转发或访问所有历史消息。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The thread is not available to supervision",
          "会话不允许监管",
        ),
        solution: t(
          "Read the eligibility/disclosure reason and verify current Admin/Head authority. Do not ask a participant to republish private history to bypass the boundary; use the authorized support process for the actual issue.",
          "阅读资格或告知原因并确认当前管理员或负责人权限。不要要求参与者重新发布私人历史以绕过边界；实际问题应使用授权支持流程。",
        ),
      },
    ],
    sources: [
      "src/app/_components/message-admin.tsx",
      "src/app/(admin)/admin/messages/supervision/page.tsx",
      "src/server/messaging-permissions.ts",
    ],
    covers: [
      "disclosed-message supervision",
      "reasoned conversation read",
      "message hide/restore",
      "contact restrict/unrestrict",
      "role/user contact permissions",
      "legacy participant-only boundary",
    ],
  }),
  guide({
    slug: "configure-recruitment",
    category: "administration",
    title: t(
      "Configure recruitment and next-period openings",
      "配置招募及下一学期开启时间",
    ),
    summary: t(
      "Review current intake, prepare destination-specific openings and publish the correct signup links/QR codes.",
      "审核当前招募、准备指定目标学期开启时间，并发布正确报名链接及二维码。",
    ),
    route: "/admin/program",
    screenshot: "admin-program",
    focus: t(
      "Open Recruitment and Refresh and distinguish current from next-period editors.",
      "打开招募及换期，并区分当前及下一学期编辑器。",
    ),
    steps: [
      [
        t("Inspect the current period", "检查当前学期"),
        t(
          "Open Program Settings → Recruitment and Refresh and read the current period and displayed timezone. Inspect Tutor and Tutee intake separately, including acceptance, opening, closing and setup prerequisites.",
          "打开项目设置→招募及换期，阅读当前学期及显示时区。分别检查辅导伙伴和学习伙伴招募，包括接受、开启、结束及设置条件。",
        ),
      ],
      [
        t("Edit current recruitment", "编辑当前招募"),
        t(
          "Use the current-period editor for the intended recruitment window. Review the saved dates/timezone and any independent acceptance switches before saving or submitting the permitted proposal.",
          "使用当前学期编辑器设置预期招募窗口。保存或提交允许提案前，审核保存日期、时区及独立接受开关。",
        ),
      ],
      [
        t("Prepare future openings", "准备未来开启时间"),
        t(
          "Use the separate next-period Tutor/Tutee editors. Confirm the named destination, choose an opening or an explicit clear, then save. An unset preparation preserves the destination's existing opening/default; clear removes only the opening restriction.",
          "使用独立下一学期辅导伙伴、学习伙伴编辑器。确认具体目标，选择开启时间或明确清除，再保存。未设置准备会保留目标现有开启或默认值；清除仅移除开启限制。",
        ),
      ],
      [
        t("Share the correct public entry", "分享正确公开入口"),
        t(
          "Use the signup preview links and public QR controls for the intended Tutor/Tutee/Crew or Home destination. Check the displayed destination and current recruitment notice before sharing. Official refresh activates prepared next-period openings together.",
          "使用报名预览链接及公开二维码控件进入预期辅导伙伴、学习伙伴、巡视组或首页目标。分享前检查显示目标及当前招募通知。正式换期会一并启用已准备下一学期开启时间。",
        ),
      ],
    ],
    expected: t(
      "Current recruitment and future preparations are distinct saved settings with clear destinations and times.",
      "当前招募与未来准备是不同已保存设置，具有明确目标及时间。",
    ),
    explanation: [
      t(
        "Preparing an opening does not refresh the program or bypass closing/acceptance/setup rules. Admin/Head apply preparation and timezone changes; Coordinators may submit permitted requests. Refresh itself remains Head authority.",
        "准备开启时间不会执行换期，也不会绕过结束、接受或设置规则。管理员、负责人可应用准备及时区变更；协调员可提交允许申请。换期本身仍属负责人权限。",
      ),
    ],
    troubleshooting: [
      {
        problem: t("The target or preparation changed", "目标或准备已改变"),
        solution: t(
          "Use explicit Reload, check the named destination and reread the saved values before reviewing again. After refresh use current-period editors; do not keep editing an obsolete preparation.",
          "明确重新加载，检查具体目标并重读保存值后再审核。换期后使用当前学期编辑器，不要继续编辑过时准备。",
        ),
      },
    ],
    sources: [
      "src/app/_components/recruitment-settings.tsx",
      "src/app/_components/next-recruitment-settings.tsx",
      "src/app/_components/program-public-qr-links.tsx",
      "src/app/_components/program-time-zone-settings.tsx",
    ],
    covers: [
      "current recruitment windows",
      "acceptance/opening/closing",
      "next-period Tutor/Tutee preparation",
      "explicit clear opening",
      "program timezone",
      "signup preview",
      "public signup QR",
    ],
  }),
  guide({
    slug: "configure-school-calendar",
    category: "administration",
    title: t(
      "Set school days and no-tutoring notices",
      "设置上课日及暂停辅导通知",
    ),
    summary: t(
      "Set date overrides and holiday ranges for the appeal calendar. Choose when a tutoring notice also pauses regular sessions.",
      "在申诉日历中设置单日调整和假期范围，并决定辅导通知是否同时暂停固定课程。",
    ),
    route: "/admin/program",
    screenshot: "admin-program",
    focus: t(
      "In Recruitment and Refresh, find School calendar and no-tutoring notices.",
      "在招募及换期中找到学校日历及不辅导通知。",
    ),
    steps: [
      [
        t("Inspect the calendar", "检查日历"),
        t(
          "Open Program Settings → Recruitment and Refresh and the school-calendar controls. Read the program timezone and existing school-day/non-school-day overrides before editing an individual date.",
          "打开项目设置→招募及换期中的学校日历控件。编辑单日之前先阅读项目时区及已有上课日、非上课日覆盖。",
        ),
      ],
      [
        t("Save or remove an override", "保存或移除覆盖"),
        t(
          "Choose the intended date and school-day value, then review and save through the shown authority path. Use the explicit remove/reset action to restore normal calendar behavior for a date.",
          "选择预期日期及是否上课，再通过显示权限路径审阅、保存。恢复某日正常日历行为，应使用明确移除或重置操作。",
        ),
      ],
      [
        t("Add a holiday range", "添加假期范围"),
        t(
          "Choose Add holiday. Enter Start date, End date and a shared Staff note. The range includes both dates and weekends, up to 366 days. Check the No school count and the listed overrides and notes that saving will replace. Choose Save holiday to apply the range or Request Admin Approval to submit one Coordinator proposal.",
          "选择添加假期，填写开始日期、结束日期和共用的工作人员备注。范围包含起止当天和周末，最长366天。核对不上课天数，以及保存时会被替换的已有日期设置及备注。选择保存假期以应用整个范围，或选择申请管理员审批以提交一项协调员提案。",
        ),
      ],
      [
        t("Create a notice or pause", "创建通知或暂停"),
        t(
          "Enter the starting date, inclusive ending date and reason. A new range defaults to Pause regular tutoring, which suppresses future ordinary sessions. Choose Notice only when the range should provide information without changing the schedule. New dated exceptions during a pause require explicit agreement.",
          "填写开始日期、含当天的结束日期及原因。新范围默认选择暂停固定辅导，会停止未来普通课程。若只提供说明而不改变课表，请改选仅通知。暂停期间的新日期例外须明确同意。",
        ),
      ],
      [
        t("Review existing commitments", "审核现有约定"),
        t(
          "Read affected published commitments before applying/lifting a pause. Already confirmed extra lessons and agreed reschedules remain; inspect the impact review rather than assuming every lesson is cancelled. Edit an existing notice to change its ending date/reason; to change its identifying start date, remove it and create a new notice. View details shows the full reason.",
          "应用或解除暂停前阅读受影响已发布约定。已确认加课及已同意改期会保留；应检查影响审核，不要假定所有课程均取消。变更结束日期、原因可编辑现有通知；变更用于标识的开始日期，须移除后新建。查看详情可读完整原因。",
        ),
      ],
    ],
    expected: t(
      "Reviewed calendar overrides and notice/pause effects are saved with their exact date ranges.",
      "已审核日历覆盖及通知、暂停效果按准确日期范围保存。",
    ),
    explanation: [
      t(
        "School-day overrides affect disciplinary appeal deadlines. A tutoring pause does not rewrite historical attendance or the appeal calendar. Overlapping notices remain independent, so removing one pause does not lift another.",
        "上课日覆盖影响纪律申诉截止时间。辅导暂停不重写历史出勤或申诉日历。重叠通知彼此独立，因此移除一个暂停不会解除另一个。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "An existing date changed while you edited a holiday",
          "编辑假期期间已有日期发生变化",
        ),
        solution: t(
          "Use Reload current range. Your dates and note stay in the form. Review the updated replacements before saving again. After a range is saved, Edit and Reset to normal still apply to individual dates.",
          "使用重新加载当前日期范围。日期和备注会保留在表单中。再次保存前检查更新后的替换内容。范围保存后，仍可对单日使用编辑或恢复常规安排。",
        ),
      },
      {
        problem: t(
          "Sessions remain paused after removing a notice",
          "移除通知后课程仍暂停",
        ),
        solution: t(
          "Inspect every overlapping pause and the exact inclusive range. Check whether the item was only a pending proposal. Do not change past attendance to make the plan match a new pause.",
          "检查每个重叠暂停及准确含端点范围，并确认该项是否仅为待审提案。不要改历史出勤来配合新暂停计划。",
        ),
      },
    ],
    sources: [
      "src/app/_components/school-calendar.tsx",
      "src/app/_components/program-calendar.tsx",
      "src/app/_components/school-calendar-notice.tsx",
      "src/lib/school-calendar.ts",
      "src/server/program/school-calendar.ts",
    ],
    covers: [
      "school-day override",
      "calendar override removal",
      "appeal school days",
      "inclusive holiday range",
      "holiday override replacement review",
      "holiday range conflict reload",
      "no-tutoring notice",
      "Pause regular tutoring",
      "overlapping pauses",
      "published-commitment review",
    ],
  }),
  guide({
    slug: "configure-signup-fields",
    category: "administration",
    title: t(
      "Configure signup fields, names and academics",
      "配置报名字段、姓名及学业要求",
    ),
    summary: t(
      "Set Required/Optional/Hidden fields, name presentation and academic confirmation without rewriting accepted evidence.",
      "设置必填、可选、隐藏字段、姓名展示及学业确认，同时保留已接受证据。",
    ),
    route: "/admin/signup-forms",
    screenshot: "admin-signup-forms",
    focus: t(
      "Choose the signup form and inspect each Required/Optional/Hidden choice.",
      "选择报名表并检查各必填、可选、隐藏选项。",
    ),
    steps: [
      [
        t("Choose the form and field", "选择表单及字段"),
        t(
          "Open Signup Forms and choose the intended form, such as Tutor signup. Read the current field requirements and choose Configure on the named row. Select Required, Optional or Hidden for that field.",
          "打开“报名表”并选择所需表单，例如“辅导伙伴报名”。查看当前字段要求，在对应字段行选择“配置”，再选“必填”“可选”或“隐藏”。",
        ),
      ],
      [
        t("Review name and grade policy", "审核姓名及年级政策"),
        t(
          "Open Program Settings → Account Settings → Names and Grades. Check the name options in Display preview and review Offered grades for future confirmations. Expand Name Field Requirements to check Latin-letter and other name rules for each account type.",
          "打开“项目设置”→“账号设置”→“姓名与年级”。在“姓名显示预览”中核对显示选项，并查看未来确认可使用的年级。展开“姓名字段要求”，核对各账号类型的拉丁字母等姓名规则。",
        ),
      ],
      [
        t("Save the intended scope", "保存预期范围"),
        t(
          "Review the intended requirement in the field's Configure dialog. Admin/Head use Save to apply the setting. Coordinators use Submit for approval. Check the field row after a successful save.",
          "在字段的“配置”对话框中核对所选要求。管理员或负责人选择“保存”应用设置，协调员选择“提交审批”。保存成功后核对对应字段行。",
        ),
      ],
      [
        t("Preview actual signup", "预览实际报名"),
        t(
          "Open the affected public form after the setting applies. Check the field label, required marker and validation. For a shared account policy change, check the relevant account-profile editor too.",
          "设置生效后打开对应的公开表单，核对字段标签、必填标记及校验。更改共享账号政策时，也请核对相应的账号资料编辑器。",
        ),
      ],
    ],
    expected: t(
      "Only the reviewed form/profile requirements apply and participant-facing guidance matches them.",
      "仅经审核表单、资料要求生效，参与者指引与其一致。",
    ),
    explanation: [
      t(
        "Name display preferences do not alter original names, usernames or historical signatures. If every name field is hidden, the self-profile explains that state rather than presenting an empty Save form. Failed requirement reads must not substitute guessed defaults.",
        "姓名展示偏好不改变原姓名、用户名或历史签名。若所有姓名字段隐藏，个人资料会说明状态，而非展示空白保存表单。要求读取失败不能用猜测默认值替代。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A field still appears or saving is blocked",
          "字段仍出现或保存受阻",
        ),
        solution: t(
          "Confirm form kind, applied versus pending state and current policy read. Retry failed settings reads while keeping your draft; use explicit Reload for version conflicts before making another save.",
          "确认表单类型、已应用或待审状态及当前政策读取。设置读取失败时保留草稿并重试；版本冲突应明确重载后再保存。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/signup-forms/page.tsx",
      "src/app/_components/program-name-settings.tsx",
      "src/app/_components/program-profile-settings.tsx",
    ],
    covers: [
      "signup field Required/Optional/Hidden",
      "form-specific requirements",
      "name fields and Latin policy",
      "name display",
      "grade/reference-year confirmation",
      "names/grades draft recovery",
    ],
  }),
  guide({
    slug: "configure-mail-and-access-controls",
    category: "administration",
    title: t(
      "Configure email, notification and access controls",
      "配置邮件、通知及访问控制",
    ),
    summary: t(
      "Review deployment status, required preferences, secondary-email binding, CAPTCHA and contact rules in their owning panels.",
      "在对应面板审核部署状态、必要偏好、备用邮箱绑定、验证码及联系规则。",
    ),
    route: "/admin/program",
    screenshot: "admin-program",
    focus: t(
      "Use Account Settings and Deployment Configurations; each control saves independently.",
      "使用账号设置及部署配置；各控件独立保存。",
    ),
    steps: [
      [
        t("Inspect delivery before changing policy", "变更政策前检查投递"),
        t(
          "Open Program Settings → Deployment Configurations → Email Notifications. Read Email Delivery Status for security and program mail. Open School Report Email Preview and check Email HTML or Plain Text. A preview sends nothing. Operators configure SMTP on the host.",
          "打开“项目设置”→“部署配置”→“邮件通知”。在“邮件投递状态”查看安全邮件和项目邮件。打开学校报表邮件预览，查看 HTML 或纯文本。预览不会发送邮件。SMTP 由技术操作员在主机上配置。",
        ),
      ],
      [
        t("Review email and notification requirements", "审核邮件及通知要求"),
        t(
          "Read the consequences beside Enable email notifications. Changing that switch submits the delivery setting through your current authority. In Required notifications, review the locks you want to change and choose Save requirements or Cancel. Locks govern separate user preferences.",
          "阅读“启用邮件通知”旁的影响说明。切换后会按当前权限提交投递设置。在“必需通知”中核对要更改的锁定项，再选择“保存通知要求”或“取消”。锁定设置作用于各用户的独立偏好。",
        ),
      ],
      [
        t("Review account/access controls", "审核账号及访问控件"),
        t(
          "Inspect secondary-email binding and CAPTCHA settings in their labelled controls, then save only the intended setting through its offered authority path. Role/user contact permissions require Admin/Head directly; Coordinators cannot propose contact-permission changes.",
          "在有标签控件中检查备用邮箱绑定及验证码设置，再通过各自权限路径仅保存预期设置。角色、用户联系权限需要管理员或负责人直接操作；协调员不能提案联系权限变更。",
        ),
      ],
      [
        t("Retry existing delivery carefully", "谨慎重试已有投递"),
        t(
          "Admin/Head can use Resend stuck emails for eligible failed or retrying deliveries. Read the result, then use Refresh status to confirm transport. Check access changes on the relevant sign-in, signup or messaging page.",
          "管理员或负责人可使用“重新发送滞留邮件”，处理符合条件的失败或重试中投递。阅读操作结果，再用“刷新状态”确认传输情况。在相应登录、报名或消息页面核对访问变更。",
        ),
      ],
    ],
    expected: t(
      "Each intended communication/security setting has its own applied or proposal outcome.",
      "每项预期通信、安全设置拥有独立应用或提案结果。",
    ),
    explanation: [
      t(
        "Essential account/request mail and optional program copies follow different rules. Transport acceptance is not proof of inbox delivery. Contact-permission configuration does not grant private-message supervision to Coordinators.",
        "必要账号、申请邮件与可选项目副本遵循不同规则。传输接受不证明收件箱投递。联系权限配置不会授予协调员私人消息监管。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Mail is still missing or CAPTCHA is unavailable",
          "仍收不到邮件或验证码不可用",
        ),
        solution: t(
          "Read the exact saved status, recipient address and provider/host configuration error, then use the corresponding retry or operator setup. Repeated resends do not fix provider readiness or extend fixed verification deadlines.",
          "阅读准确保存状态、收件地址及提供商、主机配置错误，再使用相应重试或操作员设置。反复重发不能修复提供商就绪，也不能延长固定验证期限。",
        ),
      },
    ],
    sources: [
      "src/app/_components/program-email-settings.tsx",
      "src/app/_components/program-notification-locks.tsx",
      "src/app/_components/program-captcha-settings.tsx",
      "src/app/_components/message-admin.tsx",
    ],
    covers: [
      "program email switch",
      "required notification preferences",
      "secondary-email binding",
      "SMTP readiness",
      "email previews",
      "stuck email retry",
      "CAPTCHA settings",
      "contact-permission settings",
    ],
  }),
  guide({
    slug: "stage-program-modules",
    category: "administration",
    title: t("Prepare optional-feature changes", "准备可选功能变更"),
    summary: t(
      "Compare effective and pending module switches and understand when official refresh activates them.",
      "比较当前生效与待生效模块开关，并理解正式换期何时启用。",
    ),
    route: "/admin/program",
    screenshot: "admin-program",
    focus: t(
      "Open Optional Features and compare effective versus pending values.",
      "打开可选功能，比较已生效与待生效值。",
    ),
    steps: [
      [
        t("Read the effective modules", "阅读已生效模块"),
        t(
          "Open Program Settings → Optional Features. Read the effective and pending states for the intended module, such as Crew, Interviews, Meetings, Service Hours or automatic room assignment.",
          "打开项目设置→可选功能。阅读预期模块已生效及待生效状态，例如巡视组、面试、会议、服务时数或自动教室分配。",
        ),
      ],
      [
        t("Prepare the intended switch", "准备预期开关"),
        t(
          "Set the switch to the intended next state. For Admin/Head this stages the change immediately. Coordinator changes go to Admin review. The current state stays effective until the official refresh activates the staged choice.",
          "将开关切换到预期的下一状态。管理员或负责人切换后立即将变更设为待生效，协调员的变更需提交管理员审核。正式换期应用待生效选择前，当前状态继续生效。",
        ),
      ],
      [
        t("Cancel a pending change deliberately", "明确取消待生效变更"),
        t(
          "Switch the feature back to its effective state and check the returned state. Once the cancellation applies, the pending badge clears. If the save succeeded and the read failed, use Retry refresh.",
          "将功能开关切回当前生效状态，并核对返回的状态。取消生效后，待生效标记会清除。如果保存成功但读取失败，请选择“重试刷新”。",
        ),
      ],
      [
        t("Review activation at refresh", "在换期审核启用"),
        t(
          "The authorized official refresh review lists staged settings and participation consequences. After Head applies refresh, inspect the effective modules and relevant workspaces.",
          "授权正式换期审阅会列出暂存设置及参与后果。负责人应用换期后，检查生效模块及相关工作区。",
        ),
      ],
    ],
    expected: t(
      "The next intended module state is explicitly staged without misrepresenting it as already active.",
      "下一预期模块状态已明确暂存，不会误称已经启用。",
    ),
    explanation: [
      t(
        "Turning a module off preserves its historical evidence under existing read rules. Staging and official refresh are different operations; an Admin may prepare settings but cannot execute refresh without Head.",
        "关闭模块会按现有读取规则保留历史证据。暂存与正式换期是不同操作；管理员可以准备设置，但不能代替负责人执行换期。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A switch seems saved but the feature is unchanged",
          "开关似已保存但功能未改变",
        ),
        solution: t(
          "Compare effective and pending values and the current period. Wait for the authorized refresh rather than repeatedly saving. If the pending target changed, reload the preparation and review again.",
          "比较生效、待生效值及当前学期。应等待授权换期，而不是反复保存。若待生效目标改变，应重载准备并重新审核。",
        ),
      },
    ],
    sources: [
      "src/app/_components/program-feature-settings.tsx",
      "src/server/program/features.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "effective/pending modules",
      "stage feature switch",
      "cancel pending switch",
      "Crew/Interviews/Meetings/Service Hours",
      "automatic room toggle",
      "refresh activation",
    ],
  }),
  guide({
    slug: "perform-official-refresh",
    audience: "head",
    title: t(
      "Review, schedule or apply official program refresh",
      "审核、安排或应用正式项目换期",
    ),
    summary: t(
      "Verify destination openings, staged modules and participation consequences before advancing the period.",
      "推进学期前核对目标开启时间、暂存模块及参与后果。",
    ),
    route: "/admin/program",
    screenshot: "admin-program",
    focus: t(
      "Read the destination and full refresh effects before typing REFRESH.",
      "输入REFRESH前阅读目标及完整换期影响。",
    ),
    prerequisites: [
      t(
        "Current Head authority and complete current-period/destination evidence. Admin can request refresh; only Head applies or schedules the official action.",
        "需要当前负责人权限及完整当前学期、目标证据。管理员可申请换期；只有负责人应用或安排正式操作。",
      ),
    ],
    steps: [
      [
        t("Review status and openings", "核对状态与开放时间"),
        t(
          "Open Program Settings → Recruitment and Refresh and find the unified Program Refresh card. Check the transition header, live schedule status, any staged optional features, and the compact embedded Next-Period Recruitment openings.",
          "打开项目设置→招募与刷新中的统一“项目刷新”卡片。核对周期推进标题、实时预约状态、暂存可选功能变更以及内嵌的下一周期报名开放时间。",
        ),
      ],
      [
        t("Read all refresh effects", "阅读全部换期影响"),
        t(
          "Expand Effects & full refresh details to inspect participation, scheduling and destination consequences. Resolve stale preparations and review current mail, policies, subjects, rooms and operator readiness before admitting the refresh.",
          "展开“刷新影响与完整详情”查看参与、排课及目标后果。接受换期前解决过时准备，并审核当前邮件、政策、科目、教室及操作员就绪。",
        ),
      ],
      [
        t("Schedule or run from one entrance", "在统一入口预约或执行"),
        t(
          "Use Authorize Refresh, which defaults to Schedule for later (or switch to Refresh now in the same entrance when advancing immediately). Enter REFRESH, open the final named consequence review and confirm; use Cancel scheduled refresh to remove an active or paused schedule.",
          "在“执行或预约刷新”中默认选择“预约定时刷新”（需即时推进时可在同一入口切换为“立即刷新”）。输入REFRESH并核对最终明确后果审阅后确认；如需移除待执行或已暂停预约，请使用“取消定时刷新”。",
        ),
      ],
      [
        t("Verify the new period", "验证新学期"),
        t(
          "After the accepted receipt, inspect the current period, activated openings/modules and participant workspaces. Use read-only refresh recovery if the accepted result cannot reload; never repeat a possibly completed period advance.",
          "回执被接受后检查当前学期、已启用开启时间、模块及参与者工作区。结果接受后无法重载时使用只读恢复，绝不重复可能已完成的学期推进。",
        ),
      ],
    ],
    expected: t(
      "One reviewed refresh advances to the intended period or one exact pending schedule is retained.",
      "一次已审核换期推进至预期学期，或保留一个准确待执行计划。",
    ),
    explanation: [
      t(
        "Official refresh activates staged settings and changes current participation while preserving historical attendance, policy acceptance and audits. Editing recruitment windows or staging modules alone does not advance the period.",
        "正式换期启用暂存设置并改变当前参与，同时保留历史出勤、政策接受及审计。只编辑招募窗口或暂存模块不会推进学期。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Refresh is blocked by changed preparation",
          "换期因准备变化受阻",
        ),
        solution: t(
          "Reload the named destination and saved preparation, then repeat the full review. Do not reuse a prior confirmation. For an uncertain submission inspect its current period/receipt before any exact supported retry.",
          "重载具体目标及保存准备，再完整重新审阅。不要复用旧确认。提交不确定时先检查当前学期及回执，再进行受支持的相同重试。",
        ),
      },
    ],
    sources: [
      "src/app/_components/program-refresh.tsx",
      "src/app/_components/scheduled-program-refresh.tsx",
      "src/app/_components/program-refresh-effects.tsx",
    ],
    covers: [
      "official refresh",
      "REFRESH confirmation",
      "destination opening review",
      "scheduled refresh",
      "cancel scheduled refresh",
      "refresh participation consequences",
      "activated staged modules",
    ],
  }),
  guide({
    slug: "transfer-head-leadership",
    audience: "head",
    title: t("Transfer program leadership", "转移项目负责人职权"),
    summary: t(
      "Review the eligible successor and confirm the dedicated password-protected Head transfer.",
      "审核符合条件继任者，并确认专用密码保护的负责人转移。",
    ),
    route: "/admin/users",
    screenshot: "admin-users",
    focus: t(
      "Use the dedicated leadership-transfer action, separate from ordinary role edits.",
      "使用专用负责人转移操作，与普通角色编辑分开。",
    ),
    prerequisites: [
      t(
        "You are the current Head, know your current password and have reviewed the intended eligible Admin/Coordinator successor.",
        "你是当前负责人，知道当前密码，并已审核预期符合条件管理员或协调员继任者。",
      ),
    ],
    steps: [
      [
        t("Identify the successor", "识别继任者"),
        t(
          "In Users & Roles, open the intended eligible administrator/coordinator and inspect the exact account ID, current status and authority. Do not select by display name alone.",
          "在用户与角色打开预期符合条件管理员或协调员，检查准确账号ID、当前状态及权限。不要仅凭显示姓名选择。",
        ),
      ],
      [
        t("Open the dedicated transfer", "打开专用转移"),
        t(
          "In Edit profile, open Roles and Participation and choose Make Head. Review the named successor and confirm that the outgoing Head will become an Admin.",
          "在“编辑资料”中打开角色与参与资格，选择“设为负责人”。核对所列继任者，并确认原负责人将成为管理员。",
        ),
      ],
      [
        t("Confirm identity and password", "确认身份及密码"),
        t(
          "Check the successor and resulting roles in the confirmation. Enter your current password and choose Confirm leadership transfer when those details are correct.",
          "在确认区核对继任者和变更后的角色。信息正确时输入当前密码，再选择“确认转交负责人”。",
        ),
      ],
      [
        t("Verify current leadership", "验证当前负责人"),
        t(
          "Inspect the accepted result and current roles. Pending management-review ownership is reconciled; review remaining work with the new Head through existing workflows.",
          "检查已接受结果及当前角色。待处理管理审核归属会重新协调；剩余工作应与新负责人通过现有流程审核。",
        ),
      ],
    ],
    expected: t(
      "The reviewed successor becomes the single Head and the outgoing Head becomes Admin.",
      "经审核继任者成为唯一负责人，原负责人变为管理员。",
    ),
    explanation: [
      t(
        "No invitation grants Head and the current Head cannot be deleted as an ordinary account. Leadership transfer is a dedicated operation with fresh authority/password checks, not a Coordinator proposal.",
        "没有邀请可授予负责人，当前负责人也不能作为普通账号删除。负责人转移是具有最新权限、密码检查的专用操作，不是协调员提案。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The successor or leadership changed",
          "继任者或负责人已改变",
        ),
        solution: t(
          "Stop the old review and load current accounts/authority. Read the server's eligibility restriction and start a fresh dedicated review; do not attempt to grant Head through an invitation or ordinary role switch.",
          "停止旧审阅并读取当前账号及权限。阅读服务器资格限制并开始新的专用审阅，不要尝试通过邀请或普通角色开关授予负责人。",
        ),
      },
    ],
    sources: [
      "src/app/(admin)/admin/users/page.tsx",
      "src/server/api/routers/admin.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "Head leadership transfer",
      "eligible Admin/Coordinator successor",
      "fresh password",
      "singleton Head",
      "outgoing Admin",
      "review notification ownership",
    ],
  }),
  guide({
    slug: "download-help-handbooks",
    title: t("Download and maintain help handbooks", "下载及维护帮助手册"),
    summary: t(
      "Get role-specific English/Chinese PDF handbooks and inspect the screenshot source and refresh procedure.",
      "获取分角色中英文PDF手册，并检查截图来源及更新流程。",
    ),
    route: "/admin/help",
    screenshot: "admin-help",
    focus: t(
      "Choose a permitted handbook audience and its English or Chinese PDF download.",
      "选择允许的手册角色及其中英文PDF下载。",
    ),
    steps: [
      [
        t("Open handbook downloads", "打开手册下载"),
        t(
          "In management navigation open PDF handbooks. Read the available editions; downloads follow current account authority, and the Head handbook remains Head-only.",
          "在管理导航打开PDF手册。阅读可用版本；下载遵循当前账号权限，负责人手册仅负责人可用。",
        ),
      ],
      [
        t("Choose language and audience", "选择语言及角色"),
        t(
          "Choose the role handbook you need and select English or 中文 PDF. Save the downloaded file and inspect its title, article list and screenshot captions before sharing the intended edition.",
          "选择所需角色手册，再选择英文或中文PDF。保存下载文件，分享预期版本前检查标题、文章清单及截图说明。",
        ),
      ],
      [
        t("Check screenshot provenance", "检查截图来源"),
        t(
          "Read the guide's screenshot source details for capture revision, date and route. In the GitHub catalogue open captures.json for role, viewport and crop receipts. Chinese guides label English fallback images. This set is labelled latest main, without claiming that revision is deployed.",
          "查看指南截图来源详情中的版本、日期及路径。在GitHub目录打开captures.json，查看角色、视口及裁剪记录。中文指南会标明英文回退截图。本组截图标为最新主分支，不声称该版本已经部署。",
        ),
      ],
      [
        t("Keep the GitHub copy synchronized", "保持GitHub副本同步"),
        t(
          "Use the repository's generated help catalogue for GitHub reading and the maintained refresh instructions for screenshot/PDF updates. Change the shared content source and regenerate outputs together rather than editing an exported handbook independently.",
          "GitHub阅读应使用仓库生成帮助目录；截图及PDF更新应按维护流程进行。修改共享内容来源并一并重新生成，不要独立编辑导出手册。",
        ),
      ],
    ],
    expected: t(
      "The downloaded edition matches the chosen language/audience and its capture evidence is inspectable.",
      "下载版本符合所选语言和角色，且可查看捕获证据。",
    ),
    explanation: [
      t(
        "The website, GitHub manual and PDFs derive from the same maintained article records. Real dev-server screenshots use synthetic data to illustrate controls; they do not grant permission to enter a restricted workflow.",
        "网站、GitHub手册及PDF来自同一维护文章记录。真实开发服务器截图使用虚构数据展示控件，不授权进入受限流程。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A handbook is unavailable or download is denied",
          "手册不可用或下载被拒",
        ),
        solution: t(
          "Return to PDF handbooks and check the editions allowed by your current authority. Retry a temporary download failure. If it continues, ask the operator to check the documented asset and font workflow; do not rename another role's file to imply it is the missing edition.",
          "返回PDF手册，检查当前权限允许的版本。临时下载失败时重试；若持续失败，请操作员检查文档中的截图及字体维护流程。不要给其他角色文件改名来冒充缺失版本。",
        ),
      },
    ],
    sources: ["src/app/(admin)/admin/help/page.tsx", "src/lib/help/types.ts"],
    covers: [
      "admin help handbook downloads",
      "role/language PDF",
      "screenshot provenance",
      "GitHub catalogue copy",
      "repeatable help refresh",
      "screenshot locale/crop disclosure",
    ],
  }),
  guide({
    slug: "use-school-report-link",
    audience: "public",
    title: t("Use a school-hours report link", "使用学校学时报表链接"),
    summary: t(
      "Open your emailed report, enter each exact amount once, download CSV and schedule or cancel a personal reminder.",
      "打开邮件报表、每项准确数量只录入一次、下载CSV，并安排或取消个人提醒。",
    ),
    route: "/",
    requiresPrivateLink: true,
    screenshot: "school-report",
    focus: t(
      "Use your own emailed View Month Report link; the screenshot uses a synthetic report with no reusable token.",
      "使用本人邮件中的查看月度报表链接；截图使用合成报表且没有可复用令牌。",
    ),
    prerequisites: [
      t(
        "An authorized school recipient's live report-only link from the report email. No site login is required. This guide never contains a live access token.",
        "需要授权学校收件人从报表邮件取得有效仅报表链接，无需网站登录。本指南不包含实际访问令牌。",
      ),
    ],
    steps: [
      [
        t("Open the saved report", "打开已保存报表"),
        t(
          "From your school email choose View Month Report. Check month and edition, then choose English or 中文. The live link grants report access, so share it only with authorized recipients.",
          "从学校邮件选择查看月度报表。检查月份及版本，再选择英文或中文。有效链接授予报表访问，因此只应分享给授权收件人。",
        ),
      ],
      [
        t("Read the exact amount", "阅读准确入账数量"),
        t(
          "Use the highlighted Hours value once for the named person. Click Hours or — to open Details and verify the school-account reference. For a correction, find the comparison row for the edition already entered and use the incremental amount shown there.",
          "对具体人员仅使用突出显示的入账时数一次。点击入账时数或横线打开“详情”，核对学校账号参考。需要修正时，找到此前已入账版本的对照行，使用该行显示的增量时数。",
        ),
      ],
      [
        t("Download or inspect details", "下载或查看详情"),
        t(
          "Use Download CSV for the saved edition. Do not add Carry In, Raw Change or Carry Out as separate credits. Close Details with Close, Escape or outside click; on phones scroll the report table horizontally for all columns.",
          "使用下载CSV获取保存版本。不要将转入余额、原始变化或转出余额作为另行学时。详情可用关闭、Escape或点外部关闭；手机上水平滚动报表以查看所有列。",
        ),
      ],
      [
        t("Manage your reminder", "管理个人提醒"),
        t(
          "On a personal emailed link choose Email me a reminder, pick a future date/time in the report timezone and confirm the masked original mailbox. Use Cancel this reminder email for an unsent reminder. The reminder always sends the same saved report; already entered hours must not be entered again.",
          "在个人邮件链接选择发送邮件提醒，按报表时区选择未来时间并确认遮蔽的原收件邮箱。未发提醒可用取消此提醒邮件。提醒始终发送同一保存报表，已录入学时不得再次录入。",
        ),
      ],
    ],
    expected: t(
      "You use the correct saved edition, post each amount once and can track your own unsent reminder.",
      "使用正确保存版本、每项数量只入账一次，并能跟踪本人未发提醒。",
    ),
    explanation: [
      t(
        "Anyone holding a live report link can read its report, but a personal reminder goes only to the original recipient mailbox, including after forwarding. One unfinished reminder and up to five requests per day are supported. Legacy shared links remain readable without personal reminder controls.",
        "持有效报表链接者均可读取该报表，但个人提醒仅发至原收件邮箱，转发后也不改变。支持一个未完成提醒，每天至多五次申请。旧共享链接仍可读，但没有个人提醒控件。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The link is revoked or reminder is missing/blocked",
          "链接已撤销或提醒缺失、受阻",
        ),
        solution: t(
          "Ask the issuing administrator for the current report link; do not guess tokens. For reminders, use your personal emailed link and inspect its own reminder status. A failed/blocked unsent reminder may be cancelled and scheduled again; delivery can be delayed.",
          "请发放管理员提供当前报表链接，不要猜测令牌。提醒须使用本人邮件链接并查看其提醒状态。失败或被阻止的未发提醒可取消后重新安排，投递可能延迟。",
        ),
      },
    ],
    sources: [
      "src/app/_components/school-hours-report.tsx",
      "src/app/reports/service-hours/[token]/route.ts",
      "src/server/api/routers/school-hours.ts",
    ],
    covers: [
      "school recipient report",
      "report language",
      "Hours Details",
      "last-entered edition correction",
      "recipient CSV",
      "personal reminder",
      "reminder cancellation",
      "live link access",
    ],
  }),
  guide({
    slug: "decide-additional-qualification-applications",
    audience: "admin",
    title: t("Decide an additional qualification request", "决定额外资格申请"),
    summary: t(
      "Review an added-subject/higher-level request, approve without interview when justified or route it through an interview.",
      "审核加科、升级申请；有依据时可无需面试批准，或按面试流程处理。",
    ),
    route: "/admin/applications",
    screenshot: "admin-applications",
    focus: t(
      "Expand an additional request and find Approve without Interview and Decision note.",
      "展开额外申请，找到无需面试批准及决定说明。",
    ),
    prerequisites: [
      t(
        "Admin/Head authority for qualificationApplication.decide. Coordinator manual-grant proposals in Subject Availability are a separate workflow.",
        "qualificationApplication.decide需要管理员或负责人权限。科目可用性中的协调员手动资格提案属于独立流程。",
      ),
    ],
    steps: [
      [
        t("Inspect the exact added request", "检查准确额外申请"),
        t(
          "Open Tutor Applications and locate the additional-subject or higher-level request. Read requested subject/level, the tutor's reason, captured qualification evidence and current status.",
          "打开辅导伙伴申请并定位加科或升级申请。阅读申请科目、级别、辅导伙伴原因、捕获资格证据及当前状态。",
        ),
      ],
      [
        t("Choose the evidence-based path", "选择有依据路径"),
        t(
          "If an interview is needed, assign a valid panel and chair using the interview workflow. If the available evidence supports direct acceptance, choose Approve without Interview and read the exact requested grants.",
          "若需面试，应使用面试流程分配有效评委和主席。若现有证据支持直接接受，选择无需面试批准并阅读准确申请资格授予。",
        ),
      ],
      [
        t("Record the permitted decision", "记录允许的决定"),
        t(
          "For direct acceptance, enter the required Decision note, review the named applicant, subjects and qualification consequences, then confirm Approve qualification. Rejection follows the interview path: an assigned Admin/Head chair reviews completed panel votes and the required decision note before confirming the panel decision.",
          "直接接受时，填写必要决定说明，审核具体申请人、科目及资格后果，再确认批准资格。拒绝须使用面试路径：指定管理员或负责人主席审核全部评委投票及必要决定说明后，再确认评委组决定。",
        ),
      ],
      [
        t("Verify independent state", "验证独立状态"),
        t(
          "Inspect the completed request and Subject Availability grant sources. Confirm willingness and account participation separately; the qualification result does not silently set either.",
          "检查已完成申请及科目可用性资格来源。另行确认意愿和账号参与；资格结果不会暗中设置两者。",
        ),
      ],
    ],
    expected: t(
      "The exact additional request has a recorded decision note and resulting qualification evidence.",
      "准确额外申请有已记录决定说明及最终资格证据。",
    ),
    explanation: [
      t(
        "A direct additional-application decision is Admin/Head-only. It is distinct from the manual qualification grant/source-removal controls available through the normal management authority path.",
        "额外申请直接决定仅限管理员或负责人。它与通过正常管理权限路径提供的手动资格授予、来源移除控件不同。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "The decision is blocked by changed or restricted participation",
          "决定因参与改变或受限而阻止",
        ),
        solution: t(
          "Read the exact source/status restriction and refresh the application evidence. Resolve suspension, departure or revoked access through its owning workflow before retrying; do not use another grant path to bypass the restriction.",
          "阅读准确来源、状态限制并刷新申请证据。通过对应流程解决暂停、离校或撤销权限后再重试；不要使用其他授予路径绕过限制。",
        ),
      },
    ],
    sources: [
      "src/app/_components/qualification-review.tsx",
      "src/server/api/routers/qualification-application.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "additional-subject decision",
      "higher-level decision",
      "Approve without Interview",
      "Decision note",
      "qualification application rejection",
      "interview-required route",
    ],
  }),
  guide({
    slug: "review-translations-and-languages",
    audience: "admin",
    title: t(
      "Review translations and language visibility",
      "审核翻译及语言可见性",
    ),
    summary: t(
      "Publish or reject pending translations and maintain enabled language order without requiring an editing assignment.",
      "发布或拒绝待审翻译，并维护启用语言顺序，无需额外编辑指派即可审核。",
    ),
    route: "/localization?view=review",
    screenshot: "localization",
    focus: t(
      "Open translation review and select the language and destination being reviewed.",
      "打开翻译审核并选择要审阅语言和目标。",
    ),
    prerequisites: [
      t(
        "Admin/Head review/publish authority. Editing translations remains a separate explicit Translator assignment; review authority alone does not grant the editor.",
        "需要管理员或负责人审核、发布权限。编辑翻译仍需要明确翻译员指派；仅审核权限不授予编辑器。",
      ),
    ],
    steps: [
      [
        t("Inspect the draft card", "检查草稿卡"),
        t(
          "Open Localization → Draft review and use its status filter to find pending or historical drafts. Inspect the language, key and destination shown on the intended draft card, then compare the original and proposed wording.",
          "打开本地化→草稿审核，使用状态筛选查找待审或历史草稿。检查预期草稿卡上显示的语言、键及目标，再比较原始与拟修改文字。",
        ),
      ],
      [
        t("Publish or reject the exact draft", "发布或拒绝准确草稿"),
        t(
          "Read the complete change and its destination before approving/publishing or rejecting with the offered review controls. A pending draft remains unpublished until the authorized review completes.",
          "使用提供审核控件批准、发布或拒绝前，阅读完整变更及目标。待审草稿在授权审核完成前仍未发布。",
        ),
      ],
      [
        t("Maintain languages deliberately", "审慎维护语言"),
        t(
          "In language settings, inspect enabled/hidden status and order. Review showing, hiding or reordering a language, and read the specific constraints before deleting an eligible custom language.",
          "在语言设置检查启用、隐藏状态及顺序。审阅显示、隐藏或重排语言；删除符合条件自定义语言前阅读具体约束。",
        ),
      ],
      [
        t("Verify live text", "验证实际文字"),
        t(
          "Choose the language on the actual destination page and inspect the applied strings. Missing strings may fall back to a supported source; check the exact destination/key rather than assuming the whole language published.",
          "在实际目标页面选择该语言并检查已应用文字。缺失条目可能回退至支持来源；应检查准确目标和键，不要假设整种语言已发布。",
        ),
      ],
    ],
    expected: t(
      "Only reviewed translation drafts and language settings are live, with edit and review authority kept separate.",
      "只有经审核翻译草稿及语言设置生效，编辑与审核权限仍分离。",
    ),
    explanation: [
      t(
        "Admin/Head may review without Translator assignment; explicit editing requires canTranslate and excludes Viewer. Interface keys, website text and policy text retain their own destination/version rules.",
        "管理员或负责人无翻译员指派也可审核；明确编辑需要canTranslate且排除观察者。界面键、网站文字及政策文字保留各自目标和版本规则。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "Review succeeded but text remains unchanged",
          "审核成功但文字未改变",
        ),
        solution: t(
          "Check language, destination, key and applied/pending state, then refresh the actual page. Do not republish an unrelated draft; a policy translation must follow its policy document workflow.",
          "检查语言、目标、键及已应用、待审状态，再刷新实际页面。不要重新发布无关草稿；政策翻译须遵循政策文档流程。",
        ),
      },
    ],
    sources: [
      "src/lib/translation-access.ts",
      "src/app/_components/translation-review.tsx",
      "src/app/_components/translation-editor.tsx",
    ],
    covers: [
      "Admin/Head translation review",
      "publish/reject translation",
      "language enable/hide",
      "language order",
      "custom language deletion",
      "review without Translator assignment",
    ],
  }),
  guide({
    slug: "change-program-timezone",
    category: "administration",
    title: t("Review and change the program timezone", "审核及更改项目时区"),
    summary: t(
      "Compare IANA region labels at a chosen preview date, then review the calendar and scheduling consequences before saving.",
      "在所选预览日期比较IANA区域标记，再审核日历及排课后果后保存。",
    ),
    route: "/admin/program",
    screenshot: "admin-program",
    focus: t(
      "Use Program timezone's Preview date and proposed-region selector.",
      "使用项目时区的预览日期及拟选区域选择器。",
    ),
    steps: [
      [
        t("Inspect the effective region", "检查生效区域"),
        t(
          "Open Program Settings → Recruitment and Refresh → Program Time Zone. Read the current IANA region and choose the proposed region. The UTC offset can vary with the preview date.",
          "打开“项目设置”→“招募与刷新”→“项目时区”。查看当前 IANA 区域并选择拟更改的区域。UTC 偏移可能随预览日期改变。",
        ),
      ],
      [
        t("Compare seasonal examples", "比较季节示例"),
        t(
          "Change Preview date to inspect seasonal offsets and the current/proposed local-time examples. It compares the same 12:00 UTC reference instant in both regions; changing this preview date does not save a program setting.",
          "更改预览日期，检查季节偏移及当前、拟改本地时间示例。它在两个区域比较同一12:00 UTC参考时刻；更改预览日期不会保存项目设置。",
        ),
      ],
      [
        t("Acknowledge and save", "确认并保存"),
        t(
          "Read the impact and acknowledge the effect on schedules and deadlines. Admin/Head use Save time zone. Coordinators use Request Admin Approval. To discard the draft, return to the effective region or choose Reload Current Settings.",
          "阅读影响并确认对排课及截止时间的影响。管理员或负责人选择“保存时区”，协调员选择“请求管理员审批”。若要放弃草稿，请切回当前区域或选择“重新加载当前设置”。",
        ),
      ],
      [
        t("Recheck dated inputs", "重新检查日期输入"),
        t(
          "Verify the saved region in Program Time Zone. For an out-of-date Next-Period Recruitment draft, use Reload preparation before editing again. Check the region beside dated schedules or calendar inputs where shown.",
          "在“项目时区”核对保存的区域。“下一周期招募”草稿过时时，先选择“重新加载准备”再编辑。在显示时区的日期排课或日历输入旁核对区域。",
        ),
      ],
    ],
    expected: t(
      "The applied region and conversion examples match the reviewed timezone change or a clearly pending proposal.",
      "已应用区域及转换示例符合经审阅时区变更，或明确显示待审提案。",
    ),
    explanation: [
      t(
        "Weekly wall-clock slots retain their clock values and saved instants remain the same instants. The region controls their displayed calendar interpretation and date-input conversion. Ambiguous or skipped daylight-saving local inputs are rejected rather than guessed.",
        "每周钟表时间段保留钟表值，已保存时刻仍为同一时刻。区域控制显示日历解释及日期输入转换。夏令时模糊或跳过的本地输入会被拒绝，不会猜测。",
      ),
    ],
    troubleshooting: [
      {
        problem: t(
          "A save is stale or a local date/time is rejected",
          "保存过时或本地日期时间被拒",
        ),
        solution: t(
          "Use explicit Reload to adopt the current region before reviewing again. For daylight-saving gaps/overlaps choose an unambiguous local time and inspect the named timezone; changing Preview date alone does not change the setting.",
          "明确重新加载以采用当前区域，再次审核。夏令时空缺或重叠应选择无歧义本地时间并检查明确时区；只改变预览日期不会改变设置。",
        ),
      },
    ],
    sources: [
      "src/app/_components/program-time-zone-settings.tsx",
      "src/lib/program-time.ts",
      "src/lib/approval-policy.ts",
    ],
    covers: [
      "program IANA timezone",
      "Preview date seasonal offset",
      "12:00 UTC comparison",
      "timezone acknowledgement",
      "Coordinator timezone proposal",
      "saved instants versus weekly wall clocks",
      "DST ambiguous/skipped input",
    ],
  }),
];
