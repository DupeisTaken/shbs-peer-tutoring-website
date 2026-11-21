# 管理项目

由网站帮助目录生成。请修改内容源文件后运行 `npm run help:export`。

[目录与截图来源](README.md)

截图来源: `1df44d6bb31cf04352adae9c65819139b7b747d8`. New captures use latest-main development baseline 1df44d6b, selected 2026-11-21, with the Help candidate. Earlier captures list their own revision and capture date.

此 GitHub 培训副本包含各角色操作说明。实际使用网站功能仍需登录并具备当前项目权限。所有示例数据均为虚构。

- [查找日常管理任务](#查找日常管理任务)
- [为辅导申请匹配辅导伙伴](#为辅导申请匹配辅导伙伴)
- [标记、清除或复核无效报名](#标记清除或复核无效报名)
- [审核辅导伙伴申请并修正姓名](#审核辅导伙伴申请并修正姓名)
- [分配并完成面试评委组](#分配并完成面试评委组)
- [比较辅导资格与意愿](#比较辅导资格与意愿)
- [手动授予或移除科目资格](#手动授予或移除科目资格)
- [查看与编辑辅导伙伴名册](#查看与编辑辅导伙伴名册)
- [查看与编辑学习伙伴名册](#查看与编辑学习伙伴名册)
- [创建或编辑辅导配对](#创建或编辑辅导配对)
- [分配教室并处理空缺](#分配教室并处理空缺)
- [维护固定时间段](#维护固定时间段)
- [维护教室及不可用时段](#维护教室及不可用时段)
- [维护科目、分组及级别](#维护科目分组及级别)
- [审核辅导伙伴退出及重新加入](#审核辅导伙伴退出及重新加入)
- [审核学习伙伴退出与移除](#审核学习伙伴退出与移除)
- [管理巡视组申请及设置](#管理巡视组申请及设置)
- [创建会议并记录出席](#创建会议并记录出席)
- [检查并修正课程出勤](#检查并修正课程出勤)
- [审核巡视证据及出勤标记](#审核巡视证据及出勤标记)
- [审核纪律卡及申诉](#审核纪律卡及申诉)
- [查看反馈及学习伙伴支持](#查看反馈及学习伙伴支持)
- [查看服务时数总计及明细](#查看服务时数总计及明细)
- [记录或移除学时调整](#记录或移除学时调整)
- [配置学校报表收件人及投递](#配置学校报表收件人及投递)
- [阅读、打印及导出学期报表](#阅读打印及导出学期报表)
- [发布及维护公告](#发布及维护公告)
- [编辑网站页面、新闻及图片](#编辑网站页面新闻及图片)
- [发布政策修订及翻译](#发布政策修订及翻译)
- [发放及分享账户邀请](#发放及分享账户邀请)
- [查找账户、参与资格及原始记录](#查找账户参与资格及原始记录)
- [编辑姓名及学业资料](#编辑姓名及学业资料)
- [修正历史学业证据](#修正历史学业证据)
- [提交及跟进管理提案](#提交及跟进管理提案)
- [查找审计事件并阅读确切证据](#查找审计事件并阅读确切证据)
- [预览及应用受支持准入恢复](#预览及应用受支持准入恢复)
- [配置招募及下一学期开启时间](#配置招募及下一学期开启时间)
- [设置上课日及暂停辅导通知](#设置上课日及暂停辅导通知)
- [配置报名字段、姓名及学业要求](#配置报名字段姓名及学业要求)
- [配置邮件、通知及访问控制](#配置邮件通知及访问控制)
- [准备可选功能变更](#准备可选功能变更)
- [下载及维护帮助手册](#下载及维护帮助手册)
- [审核及更改项目时区](#审核及更改项目时区)

## 查找日常管理任务

通过管理概览、待办队列和移动端导航找到下一项任务。

打开: `/admin`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **进入管理区** 从页首或账户菜单选择返回管理；入口显示进入管理区时，选择该项。手机上打开品牌下方的菜单，即可看到相同分组。

   请注意: 从概览及左侧分组导航开始。

   ![进入管理区 · 管理入口](assets/annotated/81629a10b2f11b29fe1cab7ed57e059ef2a6b72327609386d2dd800bad65d6c3.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   协调员打开辅导伙伴账户菜单，通过实际显示的返回管理入口回到管理工作区。

   /dashboard · EN · 2026-11-16

   [原始完整截图](assets/manage-daily-work-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **打开动态待办** 查看各待办队列并打开相关申请。操作前核对学期、当前状态和人员；通知只是记录的入口，并不代表已作决定。

   ![打开动态待办 · 队列](assets/annotated/57b419cba99301290a3e00c87f980b487ed6d187c48bfb7572ec423e03c698ca.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   动态页面显示当前各具名队列及数量；需要配对入口打开对应报名申请记录。

   /admin/activity · EN · 2026-11-16

   [原始完整截图](assets/manage-daily-work-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **找到正确记录** 使用页面搜索、筛选和最右侧操作列。可排序表头依次切换升序、降序和原顺序。查找缺失记录时先清除筛选。

   ![找到正确记录 · 搜索](assets/annotated/fe99e9f67d9f2c8b394d0c91fa26d7fcdf2dec393a61be682de7cc289b726e9b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   人员搜索将名册缩小到Alice；可排序表头及最右侧操作控件均清晰可见。

   /admin/tutors · EN · 2026-11-16

   [原始完整截图](assets/manage-daily-work-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

4. **确认操作结果** 已保存表示实际写入完成。已提交审核表示已建立管理操作申请，现有记录尚未改变。打开回执可查看后续决定。

   ![确认操作结果 · 等待审核](assets/annotated/b5054833cde2bb199c17ab5ffee9448d174c65746e2c3afe5338b554b95ae820.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际申请已提交审核；每周时段尚未变更，可通过查看申请打开回执。

   /admin/time-slots · EN · 2026-11-16

   [原始完整截图](assets/manage-daily-work-step-4.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

能够定位任务、打开当前记录，并分清已应用变更与待审提案。

### 工作原理

导航同时受当前权限和生效功能开关控制。只读观察者看到经过遮蔽的内容，不能提交管理写入。

### 问题排查

- **找不到栏目或记录** 清除搜索及状态、学期筛选，确认模块已启用且权限仍有效。读取失败时使用重试；无法读取队列不等于队列为空。

## 为辅导申请匹配辅导伙伴

审核已验证的需求，比较辅导伙伴资格和工作量，再分配科目志愿。

打开: `/admin/requests`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择申请标签页** 打开报名申请→待匹配。在列表中找到学习伙伴并展开申请。核对来源和验证标记、科目志愿、可用时间及当前答案修订。

   请注意: 选择待匹配，然后在相应科目志愿上使用选择辅导伙伴。

   **视图 1**

   ![视图 1 · 已确认申请 · 可用时间](assets/annotated/34c889145baabe5bcd3eec9e45aecaf05810b043c3d39e49b03f72399c876cb0.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   凯特·帕克已确认的自助申请列出尚未分配的AP化学与生物选择。可用时段为周二及周四15:30至16:30。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/match-tutoring-requests-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 待匹配 · 有效性筛选](assets/annotated/633e8561edf9e1e3a380ee166337566981b4775fcef59c239e88c7581ed511bd.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际报名申请面板位于待匹配。申请有效性筛选可缩小列表范围。找到当前学习伙伴的申请行并展开，查看核验与提交的选项。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/match-tutoring-requests-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **比较辅导伙伴** 对一个志愿选择辅导伙伴。检查资格、辅导意愿、可用时间、已分配辅导时段及辅导伙伴偏好上限。偏好容量仅供参考，并非自动禁令。

   ![比较辅导伙伴 · 辅导伙伴及工作量 · 资格说明](assets/annotated/a1b6aeae4d71f61c5ff4d8463e9b0a86a76d07ee368748a0191e45be2114c6a8.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   AP化学选择器显示赵辅导伙伴（1/1），已分配一节、偏好上限一节。资格说明指出哪些选择需要额外审核。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/match-tutoring-requests-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **审阅分配内容** 选择预期辅导伙伴，继续前阅读资格警告。确认学习伙伴、科目和学期。应优先使用正常匹配，再考虑手动创建名册或配对。

   ![审阅分配内容 · 科目及辅导伙伴](assets/annotated/dd127c0c44136ad5e4e237df7083582f06048f952dadc277c84470f0fc80ec21.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   首次分配审核显示凯特·帕克、AP化学及赵辅导伙伴，并说明保留申请优先顺序。示例停留在审核，未分配辅导伙伴。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/match-tutoring-requests-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **检查分配结果** 完成审阅并读取保存或审核回执。已应用分配可在已分配和配对页面查看；固定排课和教室分配仍须另外完成。

   **视图 1**

   ![视图 1 · 具体申请 · 分配已保存 · 已分配辅导伙伴](assets/annotated/78be57b19d8112a6d5722169c98359f102e63dd2e69e8bdd8d734d8dbfa53f9d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   此已保存申请位于“已分配”。Emma Sun 的数学志愿已显示辅导伙伴 Alice Chen。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/match-tutoring-requests-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 已保存辅导伙伴 · 同一学习伙伴](assets/annotated/341e3af3f5bcbac3b5bd224c00515da640833ca368f524442249b94764d7479a.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “配对”显示同一已保存学习伙伴、数学科目和辅导伙伴。现有每周时间及教室另行记录。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/match-tutoring-requests-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

预期科目志愿已分配，或生成可明确识别的待审提案。

### 工作原理

自助报名、工作人员录入及早期报名描述来源。早期报名表示来源不明，不代表更早的优先级。已验证问卷保留原始提交优先级。

### 问题排查

- **无法选择辅导伙伴或申请被阻止** 查看显示的资格、成员状态、验证、无效标记或学期限制。通过对应流程修正原因；更改筛选或重复建申请不能解决问题。

## 标记、清除或复核无效报名

记录原因、查看状态邮件并处理报名无效申诉，同时保留证据。

打开: `/admin/requests`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **检查具体申请** 打开报名申请或辅导伙伴申请。使用申请有效性筛选已标记或未标记条目，变更前先打开具体申请。

   请注意: 在申请中找到申请有效性、标记无效及查看无效标记。

   **视图 1**

   ![视图 1 · 具体申请 · 已确认报名 · 标记操作](assets/annotated/1dbd94fbecda2e2eb904517137f6da95131d8cca2b91f6c9a80385f933e0fd74.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   审核有效性前打开已确认的申请。示例的两项科目志愿仍待匹配。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 有效性筛选 · 被标记报名 · 查看标记](assets/annotated/7b52154522cf3d0a1eedaf917b957575f57e9c8c470a9ce57966958c2ac06397.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “无效条目”筛选会在“已关闭”中显示具体被标记申请，其原提交时间仍可见。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **说明标记或修正原因** 选择标记无效，或查看无效标记→清除无效标记。填写适合申请人阅读的原因，核对具体条目后保存或提交审核。

   **视图 1**

   ![视图 1 · 具名申请 · 标记原因 · 保存标记](assets/annotated/38de8ac9d7366a26b316aaef59ac65b1bebce3723a2a7c7852975b0977f87c29.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   核对具名申请，填写适合提交人阅读的理由，并在保存前检查标记操作。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 原标记原因 · 清除原因](assets/annotated/72c243d4df56453a7d9d72ed01eb05e17144263f11cdcbdf8e3eb438e1a185a3.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   单独的清除标记审阅会在新说明栏上方显示已保存标记。本草稿已取消。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **检查邮件与申诉** 查看无效标记对话框中的邮件状态与最新申诉。刷新状态只会读取。管理员或负责人可重试符合条件的失败状态邮件，并在阅读完整原因后决定学习伙伴无效申请申诉。

   **视图 1**

   ![视图 1 · 待审核报名申诉 · 完整说明 · 审阅通过操作](assets/annotated/bbf1c274a4a50f815ce00b78a9a6f13efae496449f43121d748ade3ba6791b30.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   作出具名决定前，在“待审核”中阅读最新说明。邮件回执可在标记审阅中查看。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 邮件服务已接受 · 刷新回执](assets/annotated/86e5afefe5118d6c8c1dbea02c2a973690db24cee1c44352ee7d4021a84c9173.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   标记已保存，邮件服务已接受该通知。“刷新邮件状态”用于读取现有回执。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 清除无效标记 · 确认决定](assets/annotated/2bf9c6dae3096994fd440d796eb50d83795d0a4b41996eadc8e225f102fe85c1.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   核对通过待审核申诉的后果。确认后标记会清除，并可恢复匹配。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-3-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **确认决定** 学习伙伴申诉获批后会清除标记；最终驳回会关闭当前申请并移除其优先级。继续处理前检查保留的历史及申请状态。

   **视图 1**

   ![视图 1 · 已返回待匹配 · 原优先时间 · 原标记已清除](assets/annotated/3d1b88e18c6185985a902b6163692b5f942fed07c0a1ed97e78a06f9a66e7de6.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   工作人员通过申诉后，该申请按原提交时间返回“待匹配”。两项科目志愿仍待分配。

   /admin/requests · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 审核前 · 已记录通过](assets/annotated/d5e3334347357c33774576dd6de8ca56c521b227b8ff54b28e61ca32d131688e.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   审计对照记录同一申诉从“待审核”变为“申诉已通过”，并保存处理时间。

   /admin/audit · EN · 2026-11-20

   [原始完整截图](assets/review-signup-validity-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

能看到当前标记、申诉决定、相应原因及邮件投递状态。

### 工作原理

标记会阻止处理，但不删除条目或施加纪律处罚。清除标记会保留证据，不会恢复过期申请或成员资格。标记期间验证截止时间仍继续；只有针对该申请的邮箱证明才允许披露原因。

### 问题排查

- **状态邮件被阻止或列表未刷新** 核对记录地址及显示的投递限制。保存完成后的重试刷新只重载记录，不重新发送或重复决定。协调员待审提案在应用前不会发送无效通知。

## 审核辅导伙伴申请并修正姓名

查找当前或已完成申请，检查账户设置状态并修正初次申请姓名。

打开: `/admin/applications`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **查找申请** 在顶部按姓名或邮箱搜索，并使用申请状态、申请科目、面试完成情况及排序筛选。独立的面试记录区域支持搜索申请人、评审或科目；在该处选择待完成、已完成或全部，再点击搜索。按评审搜索应使用下方区域。

   请注意: 使用申请筛选并展开目标申请。

   **视图 1**

   ![视图 1 · 姓名 · 状态 · 完成](assets/annotated/f8d7087463d0802aedc8cb2f349053917e2a4cd5a093bf4f1eedec8bf9b35204.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   顶部申请筛选找到一份处于面试状态的 Capture Admission Applicant 申请；此处按申请人姓名或邮箱搜索，与下方面试历史搜索独立。

   /admin/applications · EN · 2026-11-16

   [原始完整截图](assets/review-tutor-applications-step-1.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 评审 · 完成 · 搜索](assets/annotated/d8dfe8c172571071b9d0c3c669a15cdd9b357d7abeb85d41836696f3d0e7972c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   独立的面试记录搜索按评审 Alex Interview Chair 及待完成筛选，返回一份 Capture Admission 待完成面试；顶部申请人搜索保持独立。

   /admin/applications · EN · 2026-11-16

   [原始完整截图](assets/review-tutor-applications-step-1-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

2. **阅读证据** 展开记录，查看申请资格、评委组、主席、安排、完成情况及账户设置状态。必要时从面试历史打开对应评委链接。

   **视图 1**

   ![视图 1 · 科目 · 时间](assets/annotated/df78c874fe08a40238d7810e47b90ce8ee12bfb05ac60d4b6371c5549195d62a.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   待审初次申请保留原始及当前姓名、数学资格证据与已安排面试时间；姓名、评审组、完成记录及决定均未变更。

   /admin/applications · EN · 2026-11-16

   [原始完整截图](assets/review-tutor-applications-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 主席 · 评审](assets/annotated/e0c0b2b892b768e695929fa31fcab4fdf6b7542694ff50dca209ae6289557255.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   保存的三人评审组仍为 Alex Interview Chair、Alice Chen 和 Bob Liu，Alex 为已选管理员主席；未点击保存评审组，原有三张赞成票仍可见。

   /admin/applications · EN · 2026-11-16

   [原始完整截图](assets/review-tutor-applications-step-2-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 3**

   ![视图 3 · 评审组 · 待完成](assets/annotated/b9cc1087004bc43efeace4a9728fd1e702a4eaa64f26fa518df45aa5c82e1ed4.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   展开的面试历史显示现有评审组链接、待完成的面试与时数，以及等待实际录用决定的注册状态；未执行完成记录、时数发放或录用操作。

   /admin/applications · EN · 2026-11-16

   [原始完整截图](assets/review-tutor-applications-step-2-view-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **修正初次申请姓名** 对符合条件的初次申请，打开姓名修正操作，编辑四个姓名字段并填写原因。保存或提交协调员提案前审阅修改前后身份。

   **视图 1**

   ![视图 1 · 名 · 姓 · 偏好 · 其他](assets/annotated/a0ee99031f770c5c43f8661c282f9b9afce4c698bef753d9b94f53495a2da6bb.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   修正申请姓名窗口显示保留的原始提交及尚未提交的偏好姓名草稿 Capture Preview；原因明确说明此虚构预览将取消，未执行应用姓名修正。

   /admin/applications · EN · 2026-11-16

   [原始完整截图](assets/review-tutor-applications-step-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 应用 · 取消](assets/annotated/b9c43bb01007c3d4efe5c53c55112ea6be4e42c875e79d5bd5c056a0727127c7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   尚未提交的修正填写了明确的虚构预览原因，并分别显示应用姓名修正和取消操作；演示将选择取消，不保存或提交申请姓名修正。

   /admin/applications · EN · 2026-11-16

   [原始完整截图](assets/review-tutor-applications-step-3-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

4. **继续对应流程** 资格决定使用评委分配和面试审核流程。只有来源符合条件时才使用账户设置操作；名册或已接受申请本身不代表可登录账户。

   ![继续对应流程 · 已接受 · 设置](assets/annotated/f5e44d836d67a083e5c88bf3c3690b4ee879c998506dba5d5a83f9459eddc621.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已接受的申请提供“Set Up Account”入口。本图仅展示打开账户设置详情之前的入口；本次演示没有创建登录账户或邀请。

   /admin/applications · EN · 2026-11-16

   [原始完整截图](assets/review-tutor-applications-step-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

申请及面试、账户设置状态清楚可见；姓名修正拥有独立记录原因。

### 工作原理

姓名修正仅改变申请姓名字段及原因，不会接受申请、清除无效标记、修改联系方式或制造资格与政策证据。

### 问题排查

- **找不到已完成面试或申请** 切换至已完成或全部记录并清除状态筛选。历史排序发生在分页之前；使用页面导航，不要把第一页当作全部记录。

## 分配并完成面试评委组

选择合资格评委和有效主席、安排面试，并记录实际完成情况。

打开: `/admin/applications`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择评委组** 打开申请人评委编辑器。选择3至8名关联活跃账户的辅导伙伴，其中至少一人在申请科目具备工作人员确认资格；再选择其中一名管理员或负责人担任主席，审阅后保存。

   请注意: 展开申请人，找到评委分配及面试管理。

   ![选择评委组 · 面试小组 · 显示已批准的科目 · 已指定的主持人 · 保存面试小组](assets/annotated/627df7cf62ae656f9360846147079128acd60a5a9187014e5a2442246983ec85.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   待处理的数学申请已选三位具备已记录科目资格的面试官。Alex 被选为主持人。“保存面试小组”会对这份申请应用更改。

   /admin/applications · EN · 2026-11-20

   [原始完整截图](assets/manage-interview-panels-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **安排面试** 指定主席在辅导伙伴“课表”中打开“待进行的面试”，选择“设置时间”。按项目时区输入日期与时间。每位评委各自提交投票。

   ![安排面试 · 已指定的主持人 · 日期和时间 · 设置时间并保存](assets/annotated/1ffd21bcd16d777b2f45044418635d9c10c05eed13d4a72cee19000c82674c64.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已指定的管理员主持人在导师日程中查看“设置时间”输入框中的现有时间及独立保存按钮。现有时间保持不变。

   /dashboard#sessions · EN · 2026-11-20

   [原始完整截图](assets/manage-interview-panels-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **记录决定** 在“辅导伙伴申请”中打开“投票与决定”查看票数。全体评委投票后，符合资格的主席在“待进行的面试”中按页面显示的多数或平票规则确认决定。

   **视图 1**

   ![视图 1 · 投票与决定 · 三票均同意 · 已记录的投票](assets/annotated/38b4da9c0c2cc7be6511443d1eefa16fce8324d1041c4fabee530dc52fa71813.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “投票与决定”列出了三位面试官已保存的投票及 3 比 0 的统计。此管理页面显示申请仍待决定。

   /admin/applications · EN · 2026-11-20

   [原始完整截图](assets/manage-interview-panels-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 多数票与统计 · 必需的决定说明 · 打开批准审核](assets/annotated/222e2c102e433967b69735a725da23dc37e3b39b4a3b583ac5b62481a08f7d7f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际指定主持人可查看 3 比 0 的多数票结果并填写必需的决定说明。“批准”会打开这份首次申请的下一步审核。

   /dashboard#sessions · EN · 2026-11-20

   [原始完整截图](assets/manage-interview-panels-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **完成实际出席记录** 记录实际完成时间、时长及出席评委。后续修正时填写原因，审阅替换的学时后再应用或提出整个修正。

   **视图 1**

   ![视图 1 · 完成时间 · 出席分钟数 · 到场成员 · 审核时数](assets/annotated/b3f7d157b6ca4047839234c11803ce1bd8c7ec7e49c96f7e5142fd7c8c8038ca.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   草稿在审核计时前填写实际完成时间、分钟数及到场面试官。当前申请仍待记录完成与时数。

   /admin/applications · EN · 2026-11-20

   [原始完整截图](assets/manage-interview-panels-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 审核拟计时数 · 拟计总时数 · 确认后应用](assets/annotated/23e021205c66ec427f5b03bfb0eb1a406cba9a3e3b9e96cbfcd3aa554d3b4840.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   同一待提交审核显示三位已选到场人员各拟计 0.5 小时，共拟计 1.5 小时。取消会保留原待处理记录。

   /admin/applications · EN · 2026-11-20

   [原始完整截图](assets/manage-interview-panels-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 仅替换本次面试时数 · 原时数 → 拟计时数](assets/annotated/0493d80e9a01631b29727b743de3dff8ca7f4806d09387ea6ab37a9acf20d99a.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   后续更正审核把 George 已记录的 35 分钟时数与草稿示例 40 分钟比较，并显示替换范围及“取消”。

   /admin/applications · EN · 2026-11-20

   [原始完整截图](assets/manage-interview-panels-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

保存的评委、主席、安排、投票、决定及完成情况均保留在申请中。

### 工作原理

新的安排、决定及首次完成需要有效管理员或负责人主席。历史学时修正保留记录中的主席，而非重新检查其当前职位。资格、辅导意愿和账户权限仍彼此独立。

### 问题排查

- **评委或完成控件被阻止** 检查评委活跃状态、已记录资格、主席当前权限及面试功能。关闭面试后历史仍可读；写入须待模块和资格允许。

## 比较辅导资格与意愿

阅读直接与继承资格，避免将其与辅导意愿或时间可用性混淆。

打开: `/admin/subject-availability`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **查找并展开辅导伙伴** 打开辅导伙伴名册下方的科目可用性。搜索辅导伙伴或科目并展开辅导伙伴，查看分组科目及具体级别。

   请注意: 展开辅导伙伴并使用已获资格、待审核或愿意辅导筛选。

   ![查找并展开辅导伙伴 · 搜索 · 辅导伙伴](assets/annotated/39924eae2c916ffc5ed14a0ad8b37fc87994465238af014fe2d80b756966dd2f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   搜索定位到独立的 Roster Practice Practice 辅导伙伴；展开的名册显示科目名称及级别。该辅导伙伴目前没有已批准资格或已记录的辅导意愿；本图没有更改任何详情。

   /admin/subject-availability · EN · 2026-11-16

   [原始完整截图](assets/inspect-subject-availability-step-1.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

2. **应用一个局部筛选** 为该辅导伙伴选择已获资格、待审核或愿意辅导。再次点击已选筛选可清除；它会与页面搜索和筛选共同生效。

   ![应用一个局部筛选 · 已获资格 · 无匹配](assets/annotated/a2ceba28c18b73423cfffae5a3991ad33113e73f2c7933fc198d0d4ea4116294.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   本图拍摄于第4步所示 Honors 实际批准之前：“Qualified”与搜索组合后，未找到 Roster Practice Practice 的合格科目。再次点击“Qualified”可清除该筛选；筛选或打开“Edit details”不会授予资格。

   /admin/subject-availability · EN · 2026-11-16

   [原始完整截图](assets/inspect-subject-availability-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **检查资格来源** 阅读直接批准及已记录的低级别继承资格。另行比较辅导意愿：未记录表示辅导伙伴尚未保存选择。

   **视图 1**

   ![视图 1 · 直接批准 · 意愿](assets/annotated/e78584c393defa9b9b47033cce2c3e1f4c67b0e7b3ac501c5c9adb5a4cb2ba10.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   本图为第4步所示实际“Approve this subject”操作后的保存结果：Honors 显示“Direct approval: Approved”，辅导意愿仍为“Not recorded”。仅打开“Edit details”不会授予资格；未执行“Remove approval source”。

   /admin/subject-availability · EN · 2026-11-16

   [原始完整截图](assets/inspect-subject-availability-step-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 继承资格 · 意愿](assets/annotated/f6a5049bbf31800bb3baf6dc1d33c0944ecb6d0cfdda10956ec985bfe815af17.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   本图拍摄于第4步所示 Honors 实际批准之后：Standard 已记录来自 Honors Capture Catalogue Practice Example 的继承资格，没有直接 Standard 批准。此时辅导意愿仍为“Not recorded”；第4步后续视图才展示另行保存的意愿。

   /admin/subject-availability · EN · 2026-11-16

   [原始完整截图](assets/inspect-subject-availability-step-3-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

4. **选择正确后续操作** 打开编辑详情。更改辅导意愿会立即保存；批准此科目及移除审批来源也会立即提交。继续前阅读保存结果或协调员的审核申请结果。额外资格申请由管理员或负责人另行决定；匹配时须另行检查排期和容量。

   **视图 1**

   ![视图 1 · 批准 · 意愿](assets/annotated/5eba6076d724f5fff48ec2fdd67788ca1c799c99940e9b7315ea40a3670e170c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Roster Practice Practice 尚未获得此活跃练习 Honors 变体的资格，辅导意愿也未记录。“Approve this subject”及意愿更改均会立即提交；本图展示两个动作执行前的状态。

   /admin/subject-availability · EN · 2026-11-16

   [原始完整截图](assets/inspect-subject-availability-step-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 已存意愿 · 来源](assets/annotated/fce681168e839fd9bd821801dd7915333c8d93b56358e9529a41f50fbc1b9629.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   仅更改 Standard 的辅导意愿后，现已保存为“Willing to tutor”。实际名册摘要为2项资格、1项意愿。已记录的 Honors 继承来源未变；没有直接批准 Standard，也没有预留匹配排期。

   /admin/subject-availability · EN · 2026-11-16

   [原始完整截图](assets/inspect-subject-availability-step-4-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

能够分辨辅导伙伴是否有资格、愿意辅导、待审，以及是否符合其他分配条件。

### 工作原理

批准高级变体会记录当时提供的较低级别。此后重排目录不会重新计算资格。归档科目中已记录的证据仍可见。资格本身不代表意愿。

### 问题排查

- **缺少预期资格** 清除筛选并检查记录中的批准来源及活跃目录变体。不要从当前级别顺序推断资格；请管理员或负责人审核实际证据。

## 手动授予或移除科目资格

审核证据与授予来源，保持资格、意愿及账户标记彼此独立。

打开: `/admin/subject-availability`

### 开始之前

- 需要当前管理权限。管理员、负责人应用手动资格授予或来源移除；协调员提交允许变更审核。额外资格申请决定使用独立管理员、负责人流程。

### 操作步骤

1. **阅读资格授予记录** 在科目可用性展开辅导伙伴，定位准确科目级别。使用手动批准前阅读资格证据、现有批准来源及独立意愿。

   请注意: 展开辅导伙伴，检查具体级别及其批准来源。

   ![阅读资格授予记录 · 直接批准 · 辅导意愿记录](assets/annotated/069ab726c6da7a659a490f0a5dbd8eb371a170b36355807af6fb167f1722d476.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   暂不可用的练习辅导伙伴仍可查看荣誉级记录。界面显示已保存的直接批准，独立意愿为未记录。本例未更改任何字段。

   /admin/subject-availability · EN · 2026-11-20

   [原始完整截图](assets/decide-subject-qualifications-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **核对并授予资格** 打开编辑详情，核对辅导伙伴、科目及级别。检查该科目组的较低级别，再选择批准此科目立即提交。管理员及负责人直接应用授予。协调员在管理操作中跟进待审提案。

   **视图 1**

   ![视图 1 · 辅导伙伴及具体级别 · 当前资格 · 立即提交](assets/annotated/6d382351ff0cfdf60b068b92a77f8132297434b0586d78ae5c806b2f67181f7a.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   选择“批准此科目”前核对具名辅导伙伴和荣誉级别。此时尚未提交新批准。

   /admin/subject-availability · EN · 2026-11-20

   [原始完整截图](assets/decide-subject-qualifications-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 标准级别 · Honors 级别](assets/annotated/2dc1c11c8631dbbc11bef72f4bde62c1bd330f18baf8f76f8f6285f152c026a3.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   选择批准来源前，比较同一科目组的标准及荣誉级别。Bob 的两条记录目前均显示未获得资格。

   /admin/subject-availability · EN · 2026-11-20

   [原始完整截图](assets/decide-subject-qualifications-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **仅移除预期来源** 对有直接批准的级别打开编辑详情，先阅读直接来源及继承来源，再选择移除审批来源立即提交。变更应用后重新打开记录，核对哪些资格仍有其他来源支持。

   ![仅移除预期来源 · 直接批准来源 · 移除此来源](assets/annotated/25ef560686447a846bcae36635e0f2d41f40b5e089d200542bbc8285d91060d1.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   移除前核对这项具体的荣誉级别直接批准。“移除批准来源”会立即提交。本预览显示变更前的批准来源。

   /admin/subject-availability · EN · 2026-11-20

   [原始完整截图](assets/decide-subject-qualifications-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **另行核对意愿** 重新读取辅导伙伴资格，另行查看愿意辅导值。需要时回到辅导伙伴申请查看评委及面试证据。

   ![另行核对意愿 · 已记录继承 · 已保存意愿](assets/annotated/9da57d6bef41d1fa256559515a06d6906f827eaf402888a73802d5930b41d1f5.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   标准级记录显示已保存的愿意辅导，以及单独记录的荣誉级继承。该辅导伙伴仍暂不可用，未更改任何字段。

   /admin/subject-availability · EN · 2026-11-20

   [原始完整截图](assets/decide-subject-qualifications-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

审核的资格决定及其来源已记录，不会暗中改变意愿。

### 工作原理

手动资格授予、来源移除与额外资格申请决定是独立操作。两者都不会恢复暂停或撤销参与、创建登录或暗中记录辅导意愿。

### 问题排查

- **接受操作提示参与受限** 在用户与角色检查暂停、离校及被撤销辅导权限。仅通过授权流程恢复权限，再依据最新证据重试资格决定。

## 查看与编辑辅导伙伴名册

查看资料、状态、资格与账户证据，或在手动录入警告后创建名册记录。

打开: `/admin/tutors`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择当前或历史记录** 按辅导伙伴保存姓名搜索并检查当前、历史筛选。打开查看用户详情前阅读状态与学业摘要。

   请注意: 在最右侧操作列找到编辑资料与查看用户详情。

   ![选择当前或历史记录 · 搜索](assets/annotated/97341c993f3c8bb1f53dd7e1f40ef7886eda7618a67b036f9db207b73bd82964.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   当前辅导伙伴名册已筛选到Alice，显示在岗状态、学业摘要及查看历史辅导伙伴入口。

   /admin/tutors · EN · 2026-11-16

   [原始完整截图](assets/manage-tutor-roster-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **阅读或编辑资料** 详情展示分组科目、资格来源、意愿、登录状态及账户政策历史。允许的变更使用编辑资料；原始入组学业资料与当前账户学业资料应分别审阅。

   **视图 1**

   ![视图 1 · 科目](assets/annotated/82c4553ba8f3b14c8898f0c978b8cea8a5f405c26e5f75c3f6e2d9d20171513b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Alice的真实详情显示关联登录、学业摘要、分组已确认科目及独立记录的辅导意愿。

   /admin/tutors · EN · 2026-11-16

   [原始完整截图](assets/manage-tutor-roster-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 政策证据](assets/annotated/03ec3decb7639ac20585774ba38c76dd68aeeda2fb1f21dd4602beb170702981.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Alice保留的政策历史区分已接受的辅导伙伴版本与仍待接受的学习伙伴政策，并展开已接受的确切英文文本。

   /admin/tutors · EN · 2026-11-16

   [原始完整截图](assets/manage-tutor-roster-step-2-view-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **审慎变更名册状态** 打开编辑资料，在状态中选择允许的名册状态，再保存该区块。账户权限需另外在用户与角色中检查。归档名册、撤销辅导伙伴标记与退出成员是不同状态。

   **视图 1**

   ![视图 1 · 选择归档 · 保存此区块](assets/annotated/fa47fbe0de14ed80910aeb9d5be755739b647cc870c1f2193007639e6f9b6df0.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   示例辅导伙伴的名册资料在状态中已选择归档。此时资料仍是未保存的草稿。保存资料会把该状态应用于名册记录。

   /admin/tutors · EN · 2026-11-20

   [原始完整截图](assets/manage-tutor-roster-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 已显示过往人员 · 已归档 · 登录标记](assets/annotated/507316b648c5ae2fa9107f356c8b918276428991e446af476f4050ea3a15847a.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   保存一次后，显示过往辅导伙伴可找到同一练习人员，其状态为已归档。独立的参与者记录无登录标记仍然可见。

   /admin/tutors · EN · 2026-11-20

   [原始完整截图](assets/manage-tutor-roster-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **仅在正常报名不适用时手动创建** 选择添加辅导伙伴，阅读警告、勾选确认并继续。按当前表单规则填写标记为必填的姓名字段及可选邮箱、年级，再选择添加辅导伙伴。阅读已保存或已提交审核结果，并检查是否仍需单独设置账户。

   **视图 1**

   ![视图 1 · 风险确认](assets/annotated/32fe68c9bb9f62a125a18e8f8518b1de22dc1d5cb118354da8b33fd192cb26bf.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际手动创建风险提示要求先确认风险，才能继续打开表单；尚未创建参与者记录。

   /admin/tutors · EN · 2026-11-16

   [原始完整截图](assets/manage-tutor-roster-step-4.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 草稿](assets/annotated/535ac193398240db42e7754c438e7dffa5b7c756401c5b0242829b83db0e822d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   手动辅导伙伴表单按当前必填姓名规则填写为草稿，尚未创建参与者或登录账户。

   /admin/tutors · EN · 2026-11-16

   [原始完整截图](assets/manage-tutor-roster-step-4-view-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

名册仅反映已审阅资料或成员变更；无账户记录仍明确显示无账户。

### 工作原理

打开详情不会授予角色编辑权限。关联登录、历史归属与当前参与资格不同。编辑其他资料字段时可以保留旧的未拆分全名。

### 问题排查

- **保存拒绝姓名或辅导伙伴无法登录** 若变更拉丁字母姓名字段，应填写本人实际有效名字，不要猜测旧全名拆分。手动创建未填邮箱会保留为无账户记录。请使用授权设置流程，不要重复创建人员。

## 查看与编辑学习伙伴名册

在统一详情中查看入组、志愿、联系方式与历史，理解无账户记录和手动创建。

打开: `/admin/tutees`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **查找入组记录** 选择当前、历史或所有记录，按保存的名、姓、偏好名或其他语言姓名搜索。检查记录学期，不要假设一行代表所有入组。

   请注意: 选择当前、历史或所有记录，再使用右侧查看详情。

   **视图 1**

   ![视图 1 · 当前 · 搜索记录](assets/annotated/df78a590f099606d3f42984b97b8040001e58a15d62f5d74dfe153d3019fd82f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   当前已选中。搜索 Emma Sun 找到活跃入组记录，行中显示 26-27 学年。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/manage-tutee-roster-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 历史 · 非活跃](assets/annotated/7d3b100e731772bb7341709a4a6dc60aa38f9d913bbf8f9a71024b77527dd303.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   历史已选中。搜索 Adam Frost 找到上一批虚构学生的真实非活跃记录。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/manage-tutee-roster-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **打开完整详情** 在操作列选择查看详情。阅读入组摘要、第一和第二志愿、邮箱和账户信息及辅导历史。使用上一页、下一页浏览历史，关闭后返回原名册。

   **视图 1**

   ![视图 1 · 入组 · 科目志愿](assets/annotated/689b364613e98620a350d914ae73a5595ad864722bf65d89f6bfdeee6a8c40e5.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   查看详情打开 Emma Sun 的入组摘要和已保存科目志愿。工作人员可继续向下看已验证联系方式和辅导历史。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/manage-tutee-roster-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 辅导历史 · 历史分页](assets/annotated/3b7cc0dbafebb50334c1f7a80e459ce428463f74beb4e966800e0b221774ed39.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Emma 的辅导历史已加载。当前账户学业资料与原入组记录分别显示。此示例只有一页。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/manage-tutee-roster-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **编辑正确证据** 允许的联系方式、资料变更使用编辑资料。管理员或负责人可在此管理历史关联和邀请。修正前比较原入组学业资料与当前账户学业资料。

   **视图 1**

   ![视图 1 · 编辑资料 · 账户邮箱](assets/annotated/9426218f0c5128fb087ed0f1d118fab8e255042b6272f280671a91bef1bb7e38.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   编辑资料打开确切关联的入组记录。规范邮箱受保护，由账户持有者管理。本画面仅供审核，未保存变更。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/manage-tutee-roster-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 账户学业 · 编辑学业](assets/annotated/ae32b3622e77622cf3db83bad50b27b0972f5bbe36adc01fe1c0670191e1f00d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   学业资料是 Emma 当前账户的独立区域。原入组记录仍可在详情及历史中查看。本画面没有变更。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/manage-tutee-roster-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **谨慎使用手动创建** 添加学习伙伴须先确认警告，再填写姓名、学业及科目志愿。隐藏表单会在本次访问保留草稿；保存或提交审核后检查生成名册。

   **视图 1**

   ![视图 1 · 确认风险 · 打开表单](assets/annotated/aaf052e14b7d8a33f778430feefc2aa73c2630aee255b7460e1b9b0051bdb90a.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已确认仅在不得已时手动创建，继续填写已可用。这一步只打开本地学习伙伴草稿。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/manage-tutee-roster-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 姓名 · 第一志愿 · 核对后保存](assets/annotated/61f92fd2ec3e53771ebffb13768656758589c858821ef56b752af49b7bb9bbeb.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Capture Draft Learner 已填写姓名、9 年级及第一志愿数学。表单仍是未保存草稿。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/manage-tutee-roster-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

能看到预期入组及历史；编辑或创建具有明确保存或审核结果。

### 工作原理

无账户学习伙伴仍保留在名册中。历史归属本身不会启用当前账户验证。观察者可看入组与科目，私人联系方式和历史仍需要工作人员权限。

### 问题排查

- **历史读取失败或没有邮箱** 在历史区域使用重试，其他详情仍可用。没有地址不代表账户读取失败。提供验证或设置前检查来源资料及授权归属关联。

## 创建或编辑辅导配对

审核辅导伙伴、科目、学习伙伴及排课，保留已保存分组并避免重复手动创建。

打开: `/admin/pairings`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **检查现有配对** 搜索、筛选配对并打开查看详情。编辑前阅读辅导伙伴、科目、学习伙伴、排课、教室意图及明确分组成员。

   请注意: 使用配对表操作列的查看详情或编辑。

   ![检查现有配对 · 合并名单 · 固定时间 · 固定教室](assets/annotated/22046b7c208f6957418f87138715e2f30af5e98ecb8d1fd438cdd0b0aa4ea987.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   孙学习伙伴的数学配对与福斯特及吴学习伙伴共用已确认课表。固定时段为周一15:30至16:30，A101由工作人员指定。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/edit-pairings-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **编辑预期字段** 打开编辑并选择正确辅导伙伴、科目、学习伙伴及固定时间。搜索不会移除已选学习伙伴；保存前检查完整已选清单。

   ![编辑预期字段 · 固定时段 · 搜索学习伙伴 · 保留的学习伙伴](assets/annotated/bd1c7ffcbc04cbbbebd591e3e482ef741f9170d15f1accccfce7c0eaeb640972.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   编辑草稿仍选择数学、陈辅导伙伴和周一固定时段。搜索利亚姆时，孙学习伙伴仍保留在已选名单中。尚未提交。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/edit-pairings-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **审阅保存或移除** 审阅明确后果，包括受影响组员及教室变更。确认预期变更或独立移除操作，再阅读是否已应用或待审核。

   ![审阅保存或移除 · 移除影响 · 指定配对](assets/annotated/b767e4fd7b0bb0cf5eba823a5bcfd23e6e795c6dade80215fbc2ad64b02017c5.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   移除审核显示陈辅导伙伴、数学及孙学习伙伴，并说明配对移除和已有出勤记录的限制。本次审核已取消。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/edit-pairings-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **仅在必要时创建** 新建配对首先要求确认手动创建警告。响应丢失时保持草稿开启，重试同一未变更操作以恢复已保存配对。另一配对须明确开始新操作。

   ![仅在必要时创建 · 确认风险 · 继续填写表单](assets/annotated/aaa41a749cd80cb1745a6f2042e620b0e919c8812eabe7186363fde864770f8d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   新建配对先显示手动创建警告。勾选确认前，继续填写表单不可用；继续仅打开草稿。本例在未创建配对时取消。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/edit-pairings-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

已审阅配对仅保存一次，或能识别其待审提案。

### 工作原理

相同时间或共同出勤提交不会合并独立预约。只有明确合并组才共享主配对固定排期及计划教室。

### 问题排查

- **操作已成功或数据已改变** 重新载入已保存记录，不要修改并重放已接受的创建草稿。编辑过期时明确重载当前证据并重新审阅。保存完成后的重试刷新只会读取。

## 分配教室并处理空缺

选择自动、固定或无需实体教室，并审阅跨配对批量分配。

打开: `/admin/pairings`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **阅读教室状态** 打开查看详情，区分待排课、需要教室、无需实体教室及旧未分配记录。需要教室筛选显示实际短缺，而非所有x标记。

   请注意: 查看教室标记、需要教室筛选及自动分配所有未分配课程。

   **视图 1**

   ![视图 1 · 已发布时段 · 明确无需教室](assets/annotated/89a8720ec5f85764171cd7a37f7c565316fa29841ff25c74f4e33001a0e5a698.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   这项已保存的数学配对已有固定时段，并明确选择无需实体教室，因此不计入教室短缺。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/allocate-planned-rooms-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 短缺筛选 · 无教室短缺](assets/annotated/89d9aa76640331c3d585d71271d19a1f128e9530cebfe524dc24fe7be662087f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已选择需要教室筛选，当前有零项预约。明确无需实体教室的配对不计入此筛选。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/allocate-planned-rooms-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **选择教室意图** 编辑配对并选择自动教室分配、工作人员固定教室或无需实体教室。审阅受影响组内科目。固定教室须明确改为自动才会释放。

   ![选择教室意图 · 教室选择草稿 · 合并组](assets/annotated/5024403f72a5e84dfb0b3bf0dc98aad1f177eddf9d24eba2a1962a35daeec090.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   配对编辑草稿选择无需实体教室，并提示该选择关系到共用教室的三项数学配对。关闭草稿可保留原先由工作人员指定的A101。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/allocate-planned-rooms-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **重试或批量分配** 容量恢复后重试短缺，或选择自动分配所有未分配课程。审阅不受当前筛选限制的完整预约清单；合并组只出现一次。确认或提交审核。

   **视图 1**

   ![视图 1 · 一项预约 · 周一数学课程 · 执行分配](assets/annotated/dd5e5e6fe5920e2747e4f05d1d7212d1a506eec514ec2157988291d9a56dd433.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   A101 恢复可用后，批量审核列出周一唯一的数学教室预约。此时还未分配教室。

   /admin/pairings · EN · 2026-11-21

   [原始完整截图](assets/allocate-planned-rooms-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 一项待分配 · 尚需教室](assets/annotated/138f530de84ffc5f3e91a669b3752b337123902db72651d403f67bb1c65fe01f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   数学配对已排定时间，但当时没有可用教室，待分配教室列表中有一项预约。

   /admin/pairings · EN · 2026-11-21

   [原始完整截图](assets/allocate-planned-rooms-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **核对结果数量** 阅读已分配和仍未分配数量，再处理剩余短缺。批量操作会保留已有教室、固定选择、待排课及有意无需教室选择。

   **视图 1**

   ![视图 1 · 更改已应用 · 已分配一项，零项待分配](assets/annotated/fbec56ca08eda82c5773fab7af5ee5d7751baee30641455c69fdc4ce5e23169a.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   批量分配已完成。已核对一项预约，为它分配了教室，没有待分配项。刷新后的配对显示 A101。

   /admin/pairings · EN · 2026-11-21

   [原始完整截图](assets/allocate-planned-rooms-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 已分配 A101 · 无待分配项](assets/annotated/913c6225f13363059e2c2b11a01fde8a8d5137795bc921fb3cf63ab2f3e4e246.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   刷新后，数学配对通过自动分配获得 A101，已无待分配的教室预约。

   /admin/pairings · EN · 2026-11-21

   [原始完整截图](assets/allocate-planned-rooms-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

每个已审阅预约显示当前教室状态，剩余短缺仍清楚可见以便跟进。

### 工作原理

待审自动教室提案不会预约教室，批准时才分配。计划教室变更不会重写实际出勤地点。自动分配须已生效启用，批量上限为500条配对记录。

### 问题排查

- **保存后仍需要教室** 排课可能已成功保存，但容量不足。检查教室禁用时段和冲突固定预约，容量变化后再明确重试。重复相同重试不会增加容量或移动固定预约。

## 维护固定时间段

创建、编辑、停用、重新启用或删除课表时间段，并在传播变更前检查影响。

打开: `/admin/time-slots`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **查看现有时间段** 打开时间段，在列表定位相应日期和时间。阅读启用状态，输入钟表时间前检查项目时区。

   请注意: 使用时间段列表及其明确的行操作。

   ![查看现有时间段 · 时间](assets/annotated/5dd421145f586aefeadcaf4ddb153d8ab4f4e00ee347bfa95272d3d4a3074783.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   变更前的每周时段目录；周一A时段显示星期、起止时间及启用状态。

   /admin/time-slots · EN · 2026-11-16

   [原始完整截图](assets/maintain-time-slots-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **创建或编辑** 使用添加或编辑操作，填写有标签的日期及开始、结束值并阅读验证提示。保存前检查哪些现有配对可能使用该时间段。

   ![创建或编辑 · 标签](assets/annotated/0682fe247ec59041153a0b87aabe56851a1b5d8876f11e2eecb472aecb0956c7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已填写独立周六15:30至16:00时段的新增编辑器，尚未提交变更。

   /admin/time-slots · EN · 2026-11-16

   [原始完整截图](assets/maintain-time-slots-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **审慎停用或删除** 在编辑中更改启用复选框以停用或重新启用时间段，并审核明确变更。删除属于独立后果审阅操作。按显示保存或提交允许协调员提案。

   ![审慎停用或删除 · 启用](assets/annotated/35d27dd4dd371d8db31d9a49904c821f98679a994a88379fe2c50755377faa28.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   管理员核对示例A时段编辑并取消启用勾选；保存更改将停用此独立且未分配的时段。

   /admin/time-slots · EN · 2026-11-16

   [原始完整截图](assets/maintain-time-slots-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

4. **检查依赖排课** 变更应用后检查配对及相关课表显示。刷新失败时使用重试恢复，不要重复编辑。

   **视图 1**

   ![视图 1 · 课表](assets/annotated/c3724e12f89bcad379894ac6305ba7b224fa4921b110570636bf9acb84478677.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   独立且未分配的 Capture Guide Slot A 停用后，配对页显示现有每周教室课表。已有周一预约保持原状。

   /admin/pairings · EN · 2026-11-16

   [原始完整截图](assets/maintain-time-slots-step-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 停用](assets/annotated/b8d0049a90af351ee9d1f03cfed65d1d87480a56738c9491fa331a7306b25e99.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   独立且未分配的示例A时段已保存为停用状态，原有每周时段仍保持启用。

   /admin/time-slots · EN · 2026-11-16

   [原始完整截图](assets/maintain-time-slots-step-4-view-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

已审阅时间段及启用状态可见，并可查看必要审核回执。

### 工作原理

共享时间段属于课表配置，并非特定日期出勤记录。变更时须审阅依赖排课；历史实际课程证据保留自身记录值。

### 问题排查

- **表单或列表无法重载** 保持草稿开启并重试必要读取。若来源改变，明确重新加载并再读数值。不要创建近似重复时间段来绕过错误。

## 维护教室及不可用时段

准确维护教室目录，并在分配课程前标记不可用时段。

打开: `/admin/rooms`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **检查教室** 打开教室，按保存名称找到教室，再选择编辑详情查看每周重复的不可用时段。变更教室可用性前，在配对中核对现有预约。

   请注意: 打开教室操作及教室不可用时段网格。

   **视图 1**

   ![视图 1 · 禁用](assets/annotated/19cc20bb3c7352a984df1651b18340263b5facf2136c4fe4e59d555fc4e3d58e.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   展开 A101，查看已保存的周三16:00至17:00教职工会议每周禁用时段，尚未变更教室。

   /admin/rooms · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-1.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 预约](assets/annotated/b16441604a9b24ec5f0ec4320067ecf7904cc90069ba796bcc8e5893386e62fc.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   更改教室可用性前，在配对中筛选周一15:30至16:30的 A101 现有预约；已保存的数学及 Alice 记录保持原状。

   /admin/pairings · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-1-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

2. **编辑目录资料** 新名称使用添加教室，现有教室可用编辑操作改名。删除应独立审阅并检查受影响预约后果。更改分配优先级、顺序时使用教室排序编辑器。

   **视图 1**

   ![视图 1 · 添加](assets/annotated/aa0e268299945b03e52e25fc9baaa0eae76ff3af1278f1efd3c5cd60d84e01b3.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在添加教室前填写新的 Capture Guide Room 名称；此草稿尚未变更目录。

   /admin/rooms · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 保存](assets/annotated/bc2f70d67aa940ca438718c3093cf10ff9f6075e63ea8b5021e15cc23a25a257.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   新建的 Capture Guide Room 已展开教室设置；保存教室名称前，草拟改名为 Capture Guide Room A。未更改任何共享教室名称。

   /admin/rooms · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-2-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 3**

   ![视图 3 · 审阅](assets/annotated/006f33dc2017c64c80067d93d91049549a7efe2b7d5899ce0d9b534733608b04.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   具名删除审阅说明将移除 Capture Guide Room A 及其禁用时段，已有配对使用的教室不可删除。本演示将取消审阅并保留教室。

   /admin/rooms · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-2-view-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 4**

   ![视图 4 · 顺序](assets/annotated/25d1df30562b485c898ae2e772a690503cf60264111134f01d523d6e39d8b389.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   仅演示用途的教室在未保存的教室顺序草稿中上移一位。保存顺序将应用完整顺序；本演示将重新读取顺序以放弃草稿。

   /admin/rooms · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-2-view-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **标记不可用** 选择编辑详情，再选择添加禁用时段。填写星期、开始时间、结束时间及可选理由，核对具体教室和范围，再保存禁用时段；协调员选择提交申请。已有时段使用编辑时段，移除需单独审阅。

   **视图 1**

   ![视图 1 · 星期 · 时间 · 保存](assets/annotated/7525c9b3fd48ed14910a1563c62c3b592347cd3a5257899a926c715d87c0ccab.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   为 Capture Guide Room A 草拟周日09:00至10:00的每周禁用时段，填写演示维护理由，尚未保存。

   /admin/rooms · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2](assets/maintain-rooms-step-3-view-2.en.jpg)

   已保存的周日禁用时段显示在编辑器上方。

   英文界面

   <details>
   <summary>截图详情</summary>

   /admin/rooms · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-3-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 3**

   ![视图 3 · 移除](assets/annotated/6bf89ceb461a305af3cca9fa5a065f30f224531b25305e0d9555c7730897ba14.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   内联移除审阅列明周日09:00至10:00，并提供确认移除或取消。本演示将取消并保留已保存的禁用时段。

   /admin/rooms · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-3-view-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

4. **重新检查配对** 检查受影响配对及仍需教室的记录。教室目录编辑不会暗中移动工作人员固定预约。

   ![重新检查配对 · 需教室](assets/annotated/b141c0a4471b0af44dcf672c0b023c3bbcf672f8afe82ddd5c81abdc485909e8.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   为未分配的演示教室保存周日禁用时段后，需教室筛选显示零个预约；画面为当前真实空队列。

   /admin/pairings · EN · 2026-11-16

   [原始完整截图](assets/maintain-rooms-step-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

目录及禁用时段与审阅后的教室可用性一致。

### 工作原理

计划分配使用教室容量及预约约束。实际辅导地点在出勤中单独记录。紧凑网格无法显示全部细节时，应打开完整教室详情。

### 问题排查

- **预约仍冲突** 打开配对教室意图，分辨固定、自动或有意无需教室状态。先解决具体教室、时间冲突，再重试分配；不要通过改出勤修复计划预约。

## 维护科目、分组及级别

搜索、批量编辑所提供课程或导入经审阅目录，同时保留已保存资格历史。

打开: `/admin/subjects`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **查找课程分组** 打开科目与级别，按保存的课程、分组或变体名称搜索。除当前开设目录外，也检查已停用条目。

   请注意: 使用课程搜索、分组与级别编辑器及可见行批量选择。

   ![查找课程分组 · 搜索 · 状态](assets/annotated/0b3034ec19dc0ecab4b462864a7056b2276768b3e627ce0a98e6af45b9a2bede.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在已开设课程目录搜索 Mathematics，显示已保存的 Standard 课程；状态控件可用于查看启用或停用条目。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-1.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

2. **编辑单个课程或级别** 在科目组编辑器选择开设级别，再选择保存科目组；未选级别会停用。重新勾选并保存可恢复开设。级别名称及前缀在离开输入框时保存；AP计分选项和排序箭头会立即提交。每次变更后均应阅读保存或协调员审核申请结果。

   **视图 1**

   ![视图 1 · 级别 · 保存](assets/annotated/0e2b32da9e2d2c3bd9f4f16eb30f72392f3340027194572760cb94dd3abe6639.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   数学科目组保存前：保留原有名称，已选标准级别；尚未提交目录变更。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 级别 · 科目名](assets/annotated/5335ebcb8cba2dd457777940dbcef087e8a06c3791629d5456bee9ca1c75df9b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   导入的练习科目组保留 Standard 开设级别；已草拟并预览新的基础科目名，尚未点击保存科目组。Honors 与 AP 未勾选；未编辑种子科目。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-2-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 3**

   ![视图 3](assets/maintain-subject-catalogue-step-2-view-3.en.jpg)

   保存单一层级后，科目组会列出 Standard（标准）层级的科目。

   英文界面

   <details>
   <summary>截图详情</summary>

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-2-view-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 4**

   ![视图 4 · 复用 · 名称 · 新建](assets/annotated/6b771769f661629f9372af48350aee8b3b62ce38edc712027a875f99afb6d5c4.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   独立练习组名称仍为 Capture Catalogue Practice。已更名的停用 Standard 变体被选中复用，Honors 使用相同基础名称创建新变体。本图是尚未保存的两个开设级别草稿；AP 及预置科目均未更改。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-2-view-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 5**

   ![视图 5](assets/maintain-subject-catalogue-step-2-view-5.en.jpg)

   重新启用 Standard（标准）层级并添加 Honors（荣誉）层级后，科目组中会同时列出这两项。

   英文界面

   <details>
   <summary>截图详情</summary>

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-2-view-5.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **审阅批量选择** 勾选预期可见课程，使用设置级别及／或设置状态，核对已选数量及隐藏选择提示，再选择应用于N门可见已选课程。此操作立即提交，只有可见且已选的课程会变更。阅读实际保存或审核申请结果。

   **视图 1**

   ![视图 1 · 数量 · 状态 · 应用](assets/annotated/61080bcefc9d6a09c1309ab9d5b5630f541f639c17ee561b132ecd9a8539b1fe.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已选一门可见数学课程；停用为尚未提交的批量选项。尚未点击应用，数学仍为启用状态。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 选择 · 状态 · 应用](assets/annotated/a346ac06b6df8d81afbdd247d74f7bbd83aa8e4a2678768991558c0d0c109647.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   仅选中导入的练习科目：一个可见已选、零个隐藏已选。设置状态草拟为非活跃，已存记录仍显示活跃；尚未点击应用于一个可见已选科目。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-3-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 3**

   ![视图 3 · 非活跃](assets/annotated/ceab74a2fb6915b577e51278ab67d9d3d7069304314216f49bb42511badf30fc.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   批量变更已立即完成；导入的练习科目现在显示非活跃，已选数量归零，无需另一个审核对话框。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-3-view-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

4. **审慎导入目录** 选择JSON或CSV文件前，先阅读导入说明并下载示例。选中有效文件会立即提交解析后的目录变更。协调员获准发起的导入会进入审核申请。阅读实际导入结果或错误，应用变更后重新读取课程清单。

   **视图 1**

   ![视图 1 · 示例 · 文件](assets/annotated/625da019d491f97bbe44c3672545122f45c9a7b6c20007a555d8d050404f33f0.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   选择文件前查看真实的导入科目说明及 JSON 示例。尚未选择文件；选中有效文件将立即提交其新增目录变更。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 已创建 · 结果](assets/annotated/7753349ca49144a6766b0b513cb1c80aa664b0c6355ccf499a81158c5f4c73c9.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   单个虚构示例文件已导入：创建一组中的一组，跳过零个未变更组。新建 Capture Catalogue Practice 科目组可见；处理后文件选择框已重置。

   /admin/subjects · EN · 2026-11-16

   [原始完整截图](assets/maintain-subject-catalogue-step-4-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

预期目录变更已保存或待审，现有资格证据仍保留。

### 工作原理

已保存资格是获批来源的快照。重排级别不会追溯授予或移除历史资格。恢复归档分组或级别仍受当前管理权限约束。

### 问题排查

- **导入验证失败或批量包含错误课程** 导入出错时，应按显示格式修正文件后再重新选择。尚未应用的批量操作可用清除选择，或修正可见选择。重新检查ID及名称；隐藏选择可能不符合当前筛选。

## 审核辅导伙伴退出及重新加入

核对待处理成员申请、遵守等待期，并明确将受影响学习伙伴重新排队。

打开: `/admin/tutor-requests`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **找到待处理申请** 在辅导伙伴状态申请核对辅导伙伴、申请类型及原因。退出申请可能显示可审批日期及受影响学习伙伴人数。在辅导伙伴名册核对当前资格，并在有权限时通过审计日志查看过去的决定。

   请注意: 找到待处理申请的辅导伙伴、申请类型、原因及可用决定控件。

   ![找到待处理申请 · 辅导员与申请类型 · 原因 · 待审重新加入](assets/annotated/755711f25f92435567271ba397433d21cd80fea8bf9dd3fe0657cf4cb319795b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   辅导员状态申请显示辅导员和申请类型，以及已填写的原因。图中两项重新加入申请仍待审核。

   /admin/tutor-requests · EN · 2026-11-20

   [原始完整截图](assets/review-tutor-membership-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **核对资格与时间** 退出批准须经过七天；重新加入不需要七天等待。确认申请仍待处理，且成员状态自提交后未改变。

   ![核对资格与时间 · 等待期已满 · 重新加入无需等待](assets/annotated/435ef234f68b139489290b6a2649957f27cb4c24369263c696cdc1064eff8f98.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   待审核的退出申请显示等待期已满及受影响的学习伙伴人数。重新加入申请没有等待日期，仍需工作人员作出决定。

   /admin/tutor-requests · EN · 2026-11-20

   [原始完整截图](assets/review-tutor-membership-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **提交决定** 选择审批通过或拒绝前，核对辅导伙伴、原因及受影响学习伙伴。两个按钮均会立即提交。直接决定后核对更新的名册，或在管理操作中跟进协调员提案。

   ![提交决定 · 阅读原因 · 立即批准 · 立即拒绝](assets/annotated/ecd72e02803c1d86f3cc97d1ee75eb5ec205a654a1c8528a0ac861cf7d69c8ab.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   先核对确切的申请行。批准和拒绝都会立即提交决定。画面显示提交前的按钮，申请仍待审核。

   /admin/tutor-requests · EN · 2026-11-20

   [原始完整截图](assets/review-tutor-membership-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **重新安排受影响学习伙伴** 退出应用后，提示会标出受影响的学习伙伴。选择重新加入队列将他们送回待匹配，或选择暂不操作以便稍后审核。核对报名队列及剩余配对。

   **视图 1**

   ![视图 1 · 两名受影响学习伙伴 · 重新入队 · 暂不操作](assets/annotated/91880705492c27750b5c424dad13c06e4b67e362e3b2c322e651bcc8c67b94ed.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Leo 的退出申请获批后，页面提供将两名学习伙伴另行加入待匹配队列的操作。本例选择“暂不操作”，两项分配均保留。

   /admin/tutor-requests · EN · 2026-11-20

   [原始完整截图](assets/review-tutor-membership-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 第一项分配保留 · 第二项分配保留](assets/annotated/3c1fbbb7507db8708da038898ec2537a0483e5c969b1351df1b754db67e5f21f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   选择“暂不操作”后，“配对”仍显示 Xena Ross 和 Sam Diaz 的 Leo 美国历史 AP 分配。

   /admin/pairings · EN · 2026-11-20

   [原始完整截图](assets/review-tutor-membership-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 已保存辅导伙伴状态](assets/annotated/21448722c5388d296d5a69115cc4c127f3de8845548a6a88a9ee564846375648.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   工作人员审批后，辅导伙伴名册确认 Leo 已退出。两名学习伙伴的分配已留待稍后处理。

   /admin/tutors · EN · 2026-11-20

   [原始完整截图](assets/review-tutor-membership-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

成员资格仅通过审阅决定变更，学习伙伴匹配后果得到明确处理。

### 工作原理

参与者提交申请不会立即结束活跃成员资格。撤回、撤销未应用提案及逆转已应用决定是不同操作，权限也不同。

### 问题排查

- **决定操作不可用或已过时** 检查等待期及当前成员状态。若其他变更已取代申请，应拒绝过时申请并检查当前名册，不要强行应用旧证据。

## 审核学习伙伴退出与移除

决定前区分本人退出、辅导伙伴转达及纪律移除。

打开: `/admin/tutee-requests`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择正确申请区** 打开退出申请与移除。区分本人提交与辅导伙伴转达申请，阅读学习伙伴、来源、范围及提交时间。

   请注意: 在退出申请与移除中阅读来源、范围及生效日期。

   ![选择正确申请区 · 自行申请 · 辅导伙伴代报](assets/annotated/f060c93a6508150155538475e5e071f107d3f8ba2321875654ab8e11d78364d0.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Frank Wu 位于学习伙伴自行提交的退出区，显示本期全部辅导范围及提交时间。下方独立的辅导伙伴代报区当前没有待处理申请。

   /admin/tutee-requests · EN · 2026-11-20

   [原始完整截图](assets/review-tutee-withdrawals-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **审核生效时间** 阅读本人申请中取决于批准的生效日期。辅导伙伴转达保留独立七天撤回窗口和精确预定生效时间；工作人员可在生效前取消。

   ![审核生效时间 · 批准后生效 · 七天撤回期](assets/annotated/4f12351a4c3c97c7d57a5f315ffb2ae217e85a3a06cc280096056689576fa9c6.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Frank 的自行申请仅在批准后生效。辅导伙伴代报另有七天撤回期，本例没有等待生效的代报申请。

   /admin/tutee-requests · EN · 2026-11-20

   [原始完整截图](assets/review-tutee-withdrawals-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **决定具体范围** 打开完整原因及相关参与证据，审阅受影响志愿或成员资格，再确认适当批准、拒绝或取消操作。

   ![决定具体范围 · 本季度范围](assets/annotated/7cdc1fc68490f36648761547c23d0293e4e2d0e19f9681c3c0f9718dbd466453.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   指定审核适用于本期全部辅导。界面说明批准会释放所有辅导配对、关闭申请并阻止本期重新报名。本次审核已取消。

   /admin/tutee-requests · EN · 2026-11-20

   [原始完整截图](assets/review-tutee-withdrawals-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **检查保留历史** 应用结果后检查当前申请状态及受影响分配。使用已处理历史验证来源和时间，不要删除旧申请证据。

   ![检查保留历史 · 已批准历史 · 来源及时间](assets/annotated/ac940bc0bcf95fb9562f32927f454d32539603c0559f246243d1e5614de15351.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   现有已审核历史显示 Wren Withdrawn 已批准，由学习伙伴自行提交本期全部辅导的退出申请，并保留决定时间。这是此前已保存的结果。

   /admin/tutee-requests · EN · 2026-11-20

   [原始完整截图](assets/review-tutee-withdrawals-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

正确退出或移除范围及时间已记录，不会混淆不同申请类型。

### 工作原理

报名无效申诉、纪律卡申诉与退出审核相互独立。逆转已生效参与后果需要当前审核权限和最新证据。

### 问题排查

- **审核时学习伙伴状态已改变** 保留说明，重新读取权威申请并再次阅读影响范围。不要把暂时队列错误当作无待办，也不要在确认冲突后提交旧决定。

## 管理巡视组申请及设置

在独立面板审核公开申请、成员申请、名册及巡视配置。

打开: `/admin/crew`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **审核申请** 打开巡视组审核，检查已验证申请及当前成员资格。阅读原因和身份后，批准或拒绝预期申请。

   请注意: 使用巡视组审核、名册及巡视设置面板。

   ![审核申请 · 申请人姓名 · 邀请后果 · 原始留言 · 确认接受](assets/annotated/166f0b5369fb43a06e6edfaa3ec0db39e79e94c3449c478758d2ff1e44ef77fb.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   具名审核显示 Dorian West、原始申请留言，并说明接受后会发出注册邀请。本次审核已取消。

   /admin/crew · EN · 2026-11-20

   [原始完整截图](assets/manage-crew-membership-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **跟进邀请设置** 公开申请获批后，申请人仍须完成新邮箱验证及共享邀请、账户审阅，才能添加巡视组权限。检查显示的设置状态，不要假设批准就已创建登录。

   ![跟进邀请设置 · 已发邀请 · 已接受的申请人 · 到期时间](assets/annotated/4a3db230385cfe49ea507ae89d2f70dc6c3d41235a12baf294c9c31bf4934428.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已发邀请码列出已接受、仍待注册的申请人及到期时间。只读查看者视图显示进度但隐藏邀请凭证。

   /admin/crew · EN · 2026-11-20

   [原始完整截图](assets/manage-crew-membership-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **审核退出或重新加入** 单独阅读成员申请。退出批准需等待七天；重新加入无七天等待。确认前检查撤回及当前成员状态。

   ![审核退出或重新加入 · 退出 · 重新加入 · 等待期已满](assets/annotated/a7326235b1abd6b09e54dbfd1a51f11f4f9d6794bad45bb5c6a8e6ec7129cc0b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   两项待审申请分别是等待期已满的 Cora 退出申请和专用巡查成员重新加入申请。本次未提交资格决定。

   /admin/crew · EN · 2026-11-20

   [原始完整截图](assets/manage-crew-membership-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **编辑巡视设置** 打开设置面板，审阅有标签的巡视要求，并按显示权限路径保存。已有观察记录应通过巡视历史或对应修正流程处理。

   ![编辑巡视设置 · 巡查顺序 · 教室顺序 · 上移 · 保存顺序](assets/annotated/6bb3d7c2f49ae4614041cde7a3d54c11d72934bb9a8d17a818466629b8233986.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   巡查设置显示当前教室顺序及移动控件。修改顺序后可保存；此画面保留现有设置。

   /admin/crew · EN · 2026-11-20

   [原始完整截图](assets/manage-crew-membership-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

申请、账户设置、成员资格及巡视配置保持清晰分离。

### 工作原理

巡视组成员资格可与辅导伙伴权限并存。关闭可选巡视组模块会影响入口与操作；已保存巡视及成员证据仍属于历史记录。

### 问题排查

- **已批准申请人无法进入巡视** 检查邀请兑换、当前活跃巡视组状态、账户暂停或离校及已生效巡视功能。重新发放或设置控件有各自条件，不能绕过账户审阅。

## 创建会议并记录出席

按学期维护会议详情、请假、各会议草稿及历史比较。

打开: `/admin/meetings`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择学期及会议** 会议默认显示当前项目学期，包括已经举行的会议。较早记录请打开会议历史并选择具体学期；显示过往辅导伙伴只改变人员，不改变会议学期。

   请注意: 打开会议填写出席，使用会议历史查看先前学期。

   **视图 1**

   ![视图 1 · 当前时段 · 已举行](assets/annotated/638743192bff707123e4d93d2746ae32a1aa347facf28749547584d622119555.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   会议页面打开实际当前分组2026–27 Q1，其中包括已举行的 Weekly tutor meeting。会议历史使用独立的时段查看入口；本图未编辑会议或出席记录。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-1.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 历史 · 时段 · 会议](assets/annotated/263d845f1d3fc57aa9d69622664c95f09a3b891f2b373a0bcd9c3327dc6a828c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   会议历史已打开，实际2025–26 Q4分组展示其已记录的25-26 Q4 tutor meeting及出席情况。这是时段切换，与显示过往辅导伙伴无关。未更改历史证据。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-1-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

2. **创建会议或核对删除** 在当前周期填写会议标题、日期及时间，核对日期和项目时区，再选择创建。会议的删除操作会打开独立明确确认；取消会返回且不删除。

   **视图 1**

   ![视图 1 · 日期 · 时间 · 创建](assets/annotated/429dd2e80d32bfad30b823ad5432723373947b1e38080fbfb40e00950be43d34.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   这是尚未保存的独立练习会议草稿：Capture Guide Meeting - 2026-11-16，时间为项目时区2026年11月16日16:00，晚于练习辅导伙伴当地14:33的创建时间，也早于本次拍摄。“Create”会直接提交；此时会议尚未创建。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 已保存](assets/annotated/8c5a81279430459c166f1e86be057a658eb9cf85240f0266edab0cff2e574434.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “Create”已实际提交一次，真实已保存的卡片显示 Capture Guide Meeting - 2026-11-16，项目时区时间为2026年11月16日下午4:00，归属当前2026–27 Q1分组。此新会议尚未记录出席。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-2-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 3**

   ![视图 3 · 核对](assets/annotated/bb1934f1d438665def1c576bfc28a83ddcd1569e11b37c185ffd3434801238f6.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际“Delete meeting?”确认框只列出独立练习会议 Capture Guide Meeting - 2026-11-16，并提醒删除会议及其出席记录无法撤销。本次会取消该审核；未确认删除。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-2-view-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **明确保存出席** 展开会议，选择各辅导伙伴出席状态并检查请假证据，再使用该会议出席保存操作。折叠会议不会保存或丢弃本次访问草稿。

   **视图 1**

   ![视图 1 · 出席 · 保存](assets/annotated/7261b453894b721bd91a854d14eb57f8505e0f9f55e5456f74bbe1fd798946d8.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在新建的独立练习会议 Capture Guide Meeting - 2026-11-16 中，仅为 Roster Practice Practice 本地选择了出席。其他可选辅导伙伴均未记录；非活跃辅导伙伴显示只读豁免。尚未按“Save Attendance”，“Cancel”会还原为空白的已保存状态。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 已保存](assets/annotated/321f49e21c8a191964567cc0f448b6c05eb5290cea95f4ca38eb590c8cfb4e31.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “Save Attendance”已实际提交一次，编辑器显示“Saved.”。Roster Practice Practice 是此独立新会议唯一选中的出席记录；没有提交其他辅导伙伴的出席。出席本身不会发放服务时数。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-3-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

4. **比较并修正** 使用学期总计或比较检查结果。修正时将学时及相关后果作为一个整体审阅。若学期分组发生变化，丢弃草稿前先审阅重新加载分组。

   **视图 1**

   ![视图 1 · 摘要 · 比较](assets/annotated/f4605f52165428caf35c77096fef7f0cbf920734e5b68c7385903016b88c3b13.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   当前2026–27 Q1已展开汇总。矩阵按实际会议日期比较已记录出席，其中包含新建的11月16日会议。向下滚动同一表格可查看练习辅导伙伴已保存的出席；未提交任何出席更正。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 排序 · 出席](assets/annotated/1f7ebee7ab0a184a1041cae9b9cf8feab4eef3cf73a8cd7b61c163d377d2c857.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际按辅导伙伴列降序排列后，Roster Practice Practice 显示在顶部。其已保存的 P（出席）位于2026年11月16日列；该辅导伙伴其他会议日期仍未记录。排序只改变显示顺序。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-4-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 3**

   ![视图 3 · 会议 · 出席](assets/annotated/f3d04eb9a1be71b6f3a465f720a2bc29e37dacaa347ec9397c9d39b0d6ecc17b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Roster Practice Practice 的具名详情显示独立练习会议实际时间为2026年11月16日星期一下午4:00，并记录为出席。该辅导伙伴在其余三个当前时段会议中没有记录，以破折号表示。本查看器未编辑任何记录。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-4-view-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 4**

   ![视图 4 · 草稿 · 提交](assets/annotated/d59a518057633d000bc0be8bd2e6013f035e388f55c5546f8858e2caf5055ec8.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   仅在未提交的更正草稿中，把独立练习会议的练习辅导伙伴从已保存出席改选为无故缺席。管理员按“Submit attendance correction”会直接应用更改，但本次没有按下。本演示会取消草稿并保留已保存的出席记录。

   /admin/meetings · EN · 2026-11-16

   [原始完整截图](assets/manage-meetings-step-4-view-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

会议详情与出席拥有明确保存结果，同时保留历史学期证据。

### 工作原理

历史视图以已记录出席为准，不以辅导伙伴当前成员状态取代。各已打开会议草稿在本次访问分别保留；浏览器重载不提供草稿存储。

### 问题排查

- **保存成功但总计未刷新** 使用只读重试刷新，不要再次保存出席。小屏幕可在比较表自己的水平区域滚动以查看剩余列。

## 检查并修正课程出勤

阅读实际课程证据，并提交包含学时与纪律后果的有理由修正。

打开: `/admin/attendance`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **查找已提交课程** 打开出勤提交并使用人员、日期或学期筛选。阅读实际时间、教室、辅导伙伴及学习伙伴出勤、备注和卡片，不要仅依赖固定计划。

   请注意: 定位课程，修正前先打开完整出勤详情。

   ![查找已提交课程 · 记录时间 · 出勤 · 服务小时 · 已保存备注](assets/annotated/8d45f6c886d386c4b0b5a852d757afc89322124bf58bcbc9072d5fddb91df14d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   按月份与辅导员筛选，打开已提交课程的查看详情。只读记录显示实际记录时间、出勤、服务小时和备注。

   /admin/attendance · EN · 2026-11-20

   [原始完整截图](assets/correct-attendance-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **打开修正** 选择授权修正操作，填写修正后的实际值及清楚原因。一起审阅原始和拟修改证据。

   ![打开修正 · 出勤日期 · 开始与结束 · 辅导员状态 · 实际教室](assets/annotated/fca96ea4e1b1ca3b8300f301a4f8c12adcad6c5839e707471f4424a4c331d286.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   更正出勤会打开该合并课程的当前记录。起草更正前，核对日期、时间、辅导员状态及教室。

   /admin/attendance · EN · 2026-11-20

   [原始完整截图](assets/correct-attendance-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **审核全部后果** 阅读重新计算的学时、标记、扣减或参与影响。通过管理员或负责人直接应用，或符合条件的协调员审核路径，提交完整修正。

   ![审核全部后果 · 更正原因 · 操作权限 · 保存更正](assets/annotated/dcc182db293c7bbdba01cfd868a2944e25487122c089e5acc50c00d006c68423.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   阅读表单的重新计算说明与撤销权限，填写原因，并在核对拟议更正后再提交。当前为未保存草稿。

   /admin/attendance · EN · 2026-11-20

   [原始完整截图](assets/correct-attendance-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **验证相关记录** 检查修正出勤、服务时数及受影响纪律或标记历史。操作成功但读取失败时应重试刷新，而非再次修正。

   **视图 1**

   ![视图 1 · 已保存备注 · 时数仍为 3.0 · 原课次时长](assets/annotated/00f7c034a35b9f0ff9334cd4b8b00ae969dd909838ed1a312b3ebf8b6298720e.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   重新打开已保存课次。可核对更新备注，以及原有 60 分钟时长、两名出勤学习伙伴和 3.0 服务时数。

   /admin/attendance · EN · 2026-11-20

   [原始完整截图](assets/correct-attendance-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 原备注 · 原时数](assets/annotated/a8b69844c0590e07effaca748220cd71ed182ce1a0b962cfb0c92159854b79ce.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   修正前，这节独立课次显示原备注及 3.0 服务时数。Vera Ng 与 Yuki Sato 均标记为出勤。

   /admin/attendance · EN · 2026-11-20

   [原始完整截图](assets/correct-attendance-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 辅导伙伴 · 核验后的总时数](assets/annotated/260ba16958f2def3321b3a616fb73f74993f2ed24d0228076661b352eb22c379.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   服务时数汇总仍显示 Jason 的两节课，其十一月总时数保持 6.6。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/correct-attendance-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

实际出勤及依赖后果反映同一个已审阅修正，并保留原因。

### 工作原理

计划排期和实际记录是不同证据。修正可能逆转已审阅后果，因此全部后果须遵循当前审核权限，不能提前应用看似简单的字段。

### 问题排查

- **历史记录被锁定或已改变** 阅读所述学期、来源或审核限制。版本冲突时重载新证据并使用支持的修正路径；不要编辑计划配对来模拟历史修正。

## 审核巡视证据及出勤标记

比较课程与巡视证据、决定标记，并通过对应流程修正观察。

打开: `/admin/session-flags`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **阅读全部证据** 打开出勤标记，检查课程、申报时间地点及相关巡视观察。核对观察时间及人数；不一致需要人工审核。

   请注意: 打开标记课程，比较出勤与巡视观察。

   ![阅读全部证据 · 教室与时间 · 比较人数](assets/annotated/2e88166b0cf204d30b296d8eee613c3e5b56b2dd6aa9759a372038ce1541ff14.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   打开待审核标记，核对申报的教室与时间并比较两个人数。将巡查作为佐证前，须在巡查历史中核对实际观察时间。

   /admin/session-flags · EN · 2026-11-20

   [原始完整截图](assets/review-patrol-flags-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **记录有理由的决定** 打开标记审核，阅读原状态并填写必要原因。仅确认显示的决定及相关扣减或其他后果。

   ![记录有理由的决定 · 决定说明 · 扣减小时 · 确认后执行 · 关闭草稿](assets/annotated/ea2f887755152e7288f8f20208e079e82af7d052d198e428e6e372af1e22b8c1.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   草稿显示选定的扣减、当前差异、说明及扣减小时字段。关闭后，原标记仍待审核。

   /admin/session-flags · EN · 2026-11-20

   [原始完整截图](assets/review-patrol-flags-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **必要时修正来源** 若巡视证据错误，打开巡视历史并使用带原因的修正操作；若出勤错误，使用课程修正。不要覆盖一个来源来掩盖另一个来源的不一致。

   ![必要时修正来源 · 更正影响 · 观察记录 · 填写原因 · 保存更正](assets/annotated/dbbb2f18409f4486ca320549f0222f3ead36f21790a393700510cf9d9d91e421.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   从巡查设置打开更正巡查，可查看已保存的观察记录并填写原因。这个独立示例展示巡查证据更正，草稿未保存。

   /admin/crew · EN · 2026-11-20

   [原始完整截图](assets/review-patrol-flags-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **验证重新计算** 修正或决定应用后，检查标记状态及相关学时。后续改变已审核扣减必须遵循当前逆转权限。

   **视图 1**

   ![视图 1 · 标记已关闭 · 处理说明 · 复核人员和时间](assets/annotated/2ffa4da489bc6c816cad342b67c83562621dcbd013377282f18ba41f57cca91c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   重新打开已关闭的标记，确认原因、复核人员和处理时间。此演练保留了原签到记录和服务时数。

   /admin/session-flags · EN · 2026-11-21

   [原始完整截图](assets/review-patrol-flags-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 关闭原因 · 确认关闭标记](assets/annotated/97e9fddf87291f4d1b64ced9e3fd53bb6e3a208a6e0e3df350541a23b62d5f1d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   此独立演练的标记在对应教室和时段内找不到巡查记录。复核人员记下原因，选择「判定有效并关闭」，保留原签到记录。

   /admin/session-flags · EN · 2026-11-21

   [原始完整截图](assets/review-patrol-flags-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

已审核标记有记录结果，各证据来源保留各自修正轨迹。

### 工作原理

巡视观察是支持证据，不是自动裁决。修正观察可重新考虑相关标记、扣减，但保留已保存巡视学时，不会重新授予巡视学时。

### 问题排查

- **标记再次出现或修正待审** 阅读最新出勤、巡视版本及修正回执。待审提案不会改变实际证据；应先完成审核，再认为标记已清除。

## 审核纪律卡及申诉

查看完整课程记录、决定纪律卡并处理上课日申诉截止时间。

打开: `/admin/discipline`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **检查纪律卡证据** 在学习伙伴纪律页面的“待复核”中找到对应纪律卡。阅读原因、签发者及已记录的课次情况。在“学习伙伴纪律状态”选择“查看详情”，核对该学习伙伴目前计入的有效纪律卡。

   请注意: 决定前打开纪律卡审核及完整记录。

   **视图 1**

   ![视图 1 · 卡片证据](assets/annotated/ee839f19fb19fd59de496a5f5ebafb766fa02286732c645da7eecbd8a05a36f9.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Cory Flynn 的已保存卡片详情显示辅导伙伴记录的原因、来源及待审核状态。此待审核卡片未改变当前有效纪律状态。

   /admin/discipline · EN · 2026-11-20

   [原始完整截图](assets/review-discipline-and-appeals-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 有效状态](assets/annotated/7d6f549a793cbb42902bc805381c11baea3fc485302708a40e99a8b5c9372fee.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   纪律状态行显示 Cory Flynn 当前状态正常，另有一张待审核卡片。查看详情可打开记录的原因。

   /admin/discipline · EN · 2026-11-20

   [原始完整截图](assets/review-discipline-and-appeals-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **审核有效性** 在对应待复核纪律卡中选择“编辑”。核对原因，并在“复核备注（可选）”中补充相关情况。选择“有效”或“无效”即提交决定。更改先前决定须遵循当前管理员或负责人复核规则。

   ![审核有效性 · 可选说明 · 决定操作](assets/annotated/229a24d7618dce6c027f350e57f5c6b2edd536e82358ca3f622caa4c66603972.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   此待审核编辑器显示 Cory Flynn 的指定卡片和可选的虚构说明草稿。有效和无效按钮用于作出决定。关闭草稿时未记录决定。

   /admin/discipline · EN · 2026-11-20

   [原始完整截图](assets/review-discipline-and-appeals-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **打开纪律卡申诉** 在“学习伙伴支持”中打开“学习伙伴申诉”，选择“待处理”。阅读纪律卡原因和申诉内容，选择“撤销纪律记录”或“驳回申诉”，填写“决定理由”后提交。通过“在项目设置中管理学校日历”链接核对哪些日期计为上课日。

   ![打开纪律卡申诉 · 待处理申诉 · 申诉记录 · 校历](assets/annotated/1cff09c980e52285b3b4d0f71f74631bc23c8afed928065fd9bd4c394332b1e4.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   待处理学习伙伴申诉显示 Frank Wu 的原卡片原因及已提交申诉。推翻卡片及驳回申诉可分别打开决定操作。本次未填写决定。

   /admin/student-support · EN · 2026-11-20

   [原始完整截图](assets/review-discipline-and-appeals-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **验证最终纪律状态** 在“学习伙伴纪律状态”中核对当前状态，并选择“查看详情”查看有效纪律卡。在“学习伙伴申诉”中选择“已处理”可查看申诉决定。若纪律状态显示“待移除”，请在“退出申请与移除”中单独跟进参与状态变更。

   **视图 1**

   ![视图 1 · 待移除](assets/annotated/d21d60c0269b29a975f589533a99b67b72b349cfeb2eaf3d74023dd468c1187b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Zoe Banner 的历史状态显示六格填满、待移除。此处可读取状态及查看详情，移除流程须另行核对。

   /admin/discipline · EN · 2026-11-20

   [原始完整截图](assets/review-discipline-and-appeals-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 有效卡片历史](assets/annotated/1e23f054ea3396fc82b689808a0730c98df3c5b23ea80674a51ba40583dc04e5.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Zoe Banner 保留的纪律历史列出两张已标记为有效的红牌。这些是已有卡片记录，截图期间未作决定。

   /admin/discipline · EN · 2026-11-20

   [原始完整截图](assets/review-discipline-and-appeals-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 已解决结果](assets/annotated/b9e75f3f15e6be83e4e55e33a1a2f2583b2fc8b45ca4844eff06c4da5ec74154.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在虚构队列中，独立的已解决申诉筛选目前为空。此处没有该状态示例的新申诉决定。

   /admin/student-support · EN · 2026-11-20

   [原始完整截图](assets/review-discipline-and-appeals-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

卡片及申诉拥有有理由的当前结果，同时保留历史证据。

### 工作原理

有效卡片而非所有已提交指控决定纪律状态。学校日历覆盖会影响五个上课日纪律申诉窗口。报名无效申诉使用报名申请的独立审核。

### 问题排查

- **截止时间似乎不同于日历天数** 通过学校日历链接进入项目设置→招募及换期并检查覆盖设置。不要改无关申请日期来延长申诉；以显示的权威截止时间为准。

## 查看反馈及学习伙伴支持

在各自授权视图中处理反馈、私人对话及申诉。

打开: `/admin/student-support`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择支持面板** 打开学习伙伴支持。反馈用于查看工作人员获准反馈；申诉用于待处理或已处理纪律申诉。工作人员反馈访问不依赖与辅导伙伴共享设置。

   请注意: 选择反馈或申诉；每个列表有独立分页。

   ![选择支持面板 · 课程反馈 · 学习伙伴申诉](assets/annotated/35d072bc696cf767627b35324d843eb39b8593cc8bf031c64e6aa83e35cd93fd.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   学习伙伴支持默认打开课程反馈，学习伙伴申诉位于独立选项卡。辅导伙伴共享未勾选时，工作人员仍可读取反馈。

   /admin/student-support · EN · 2026-11-20

   [原始完整截图](assets/review-student-feedback-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **阅读完整背景** 直接在反馈卡片中查看姓名、科目、评分、完整反馈及最近更新时间。申诉的纪律卡原因和申诉内容显示在对应条目内。记录较多时使用各列表的独立分页。切换面板会保留当前筛选和草稿。

   ![阅读完整背景 · 反馈记录 · 反馈页码](assets/annotated/a6e8015afe837bb5a681340ec0b22686af3bdbb059f3cdf276807008effb7d9e.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Emma Sun 的内嵌记录显示数学、已保存的 5/5 评分、完整意见及时间。课程反馈当前只有一页。

   /admin/student-support · EN · 2026-11-20

   [原始完整截图](assets/review-student-feedback-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **使用适当响应途径** 处理申诉时选择“撤销纪律记录”或“驳回申诉”，并填写“决定理由”。如需私下跟进，请从反馈面板打开“消息”，并选择允许联系的人员。

   ![使用适当响应途径 · 决定说明](assets/annotated/39cb9f3c4c92c18bf36cfcdb0627bd2c924b146607074a7baaa88a0f88a18c23.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   驳回申诉会打开待处理记录的决定原因草稿。说明为空时提交不可用。本例取消草稿，申诉仍待处理。

   /admin/student-support · EN · 2026-11-20

   [原始完整截图](assets/review-student-feedback-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **单独审核与辅导伙伴共享** 检查“允许已分配的辅导伙伴查看学习伙伴反馈”。管理员或负责人切换复选框后即提交变更，协调员切换后提交审核申请。设置适用于已有和今后的反馈。有权限的工作人员始终可以查看反馈。

   ![单独审核与辅导伙伴共享 · 辅导伙伴访问 · 共享范围](assets/annotated/8991e91ec22d51ce4df372eed60310c462822512b5eae6163e5da5d92c60f3a6.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   键盘焦点位于已保存的未勾选辅导伙伴共享控件。说明涵盖已有及今后的反馈，私信仍独立。本次未更改设置。

   /admin/student-support · EN · 2026-11-20

   [原始完整截图](assets/review-student-feedback-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

阅读工作人员获准反馈，并将各支持事项引导至对应流程。

### 工作原理

反馈说明与纪律申诉是不同证据。支持可见性不会授予一般私人消息权限或无关学习伙伴记录权限。

### 问题排查

- **缺少某项反馈** 检查面板、学期、分页及当前工作人员权限，读取失败后重试。辅导伙伴缺少反馈时，应检查独立共享设置及当前分配归属。

## 查看服务时数总计及明细

比较完整学期总计与筛选后的辅导伙伴名册，并检查每项学时或扣减。

打开: `/admin/service-hours`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择统计时段** 打开服务时数并选择预期时段。缩小名册范围前先阅读完整项目总计。

   请注意: 比较名册上方的学期总计及活跃、非活跃、全部筛选。

   ![选择统计时段 · 月份 · 总计](assets/annotated/a3a7bdd5c070f8fda9a7354a27a1cd7560ba18ff947d9f8381b8dc478d5eeed1.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   2026年11月已实际生效：所选时段显示2026-11，并提供“Clear”。筛选名册之前，项目总计包含所有辅导伙伴：净时数73.1、已得67.0、额外7.3及扣减1.3。

   /admin/service-hours · EN · 2026-11-16

   [原始完整截图](assets/inspect-service-hours-step-1.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

2. **独立筛选名册** 选择活跃、非活跃或全部，再筛选时段内有记录或无记录并按姓名搜索。已记录零值或相抵扣减仍算有记录。

   ![独立筛选名册 · 状态 · 记录 · 搜索](assets/annotated/5e82e4c158a53ce58e05992ea1334cd0e0ca2d3f269963542591bb618ccb404d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在已生效的11月时段中，活跃、无记录及姓名搜索组合仅显示 Roster Practice Practice，课程次数为零、时数0.0。项目总计仍为73.1/67.0/7.3/1.3；只有筛选小计变为零。

   /admin/service-hours · EN · 2026-11-16

   [原始完整截图](assets/inspect-service-hours-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **切换摘要与明细** 摘要展示总计及详情；明细展示已得学时、额外学时及扣减。打开个人详情检查来源贡献，不要将展示小计重复相加。

   **视图 1**

   ![视图 1 · 摘要 · 查看详情](assets/annotated/5eaaaedafcd8d71687c71b5d9b00afc89b8b5c476cf9ee6f551063bfdaf7052b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已选择 2026 年 11 月的摘要。筛选后的 Alice Chen 行显示六次辅导、17.8 净时数及其查看详情操作。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/inspect-service-hours-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 已得时数 · 总计](assets/annotated/8925beab2e8b23cbdc3d24282dd8dec4749b7ec18bf3fdfeb3c1e557734cc4c0.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   摘要行详情显示 Alice 的六次辅导、15.0 已得时数、2.8 额外时数、0.0 扣减及 17.8 净时数。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/inspect-service-hours-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 明细 · 已得列 · 扣减](assets/annotated/59aa99a897b375df8fef03e8e9c78f6f0da09c997f85cc2d4bddf61f146cc719.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   明细保持相同的 11 月范围及 Alice 行，已得、额外、扣减和总计各有一列。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/inspect-service-hours-step-3-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **显示隐藏贡献者** 若活跃筛选隐藏了所选时段有贡献的人，可使用显示操作或全部。手机上在有标签的表格内部滚动查看其余列。

   **视图 1**

   ![视图 1 · 活跃筛选 · 一位人员被隐藏 · 显示贡献者](assets/annotated/91df32ddd293fb99fa00061884b246b9e57913ddad43e008825737a22c0f941f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   活跃筛选隐藏了一位11月有记录的贡献者。所选时段的项目总计仍包含该人员。选择查看非活跃贡献者可打开匹配名册。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/inspect-service-hours-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 非活跃 · 有记录 · 已显示人员 · 总计0.5](assets/annotated/cba7c2cee5cb24f2ea767be9db4c938570ef6ec02681a0fdb31cdf00b175ea61.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   查看非活跃贡献者将筛选设为非活跃及有记录。练习人员显示为非活跃，额外0.5、总计0.5。该名册筛选前后项目总计相同。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/inspect-service-hours-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

能够根据原始记录解释完整时段总计及当前名册小计。

### 工作原理

活跃、非活跃描述当前成员资格，不是历史月份状态。筛选小计仅涵盖显示行；项目总计覆盖完整所选时段。这些视图本身不发放学校学时。

### 问题排查

- **筛选后总计不同** 比较时段、当前状态及活动筛选，再查看全部。不要因名册筛选隐藏非活跃贡献者，就认为项目总计或学校报表不包含他们。

## 记录或移除学时调整

为正确辅导伙伴及月份添加带原因的额外或处罚学时调整。

打开: `/admin/hour-adjustments`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **检查现有调整** 打开学时调整并定位辅导伙伴和月份。显示过往辅导伙伴位于新增学时调整弹窗中；若弹窗未提供目标历史辅导伙伴，可使用该选项。显示人员不会重新激活他们。

   请注意: 使用创建操作，再核对辅导伙伴、月份、类型、数量及原因。

   **视图 1**

   ![视图 1 · 新建调整 · 辅导伙伴 · 月份](assets/annotated/beef6eeddecdd0c3df1f14fd75a00effd7b2ccf3c389b78f463b902049ce7380.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   现有调整表列出辅导伙伴、月份、类型和数量。11月的可见记录中，Jason Kim 有一项已保存的额外学时调整。打开新增学时调整可查看过往辅导伙伴选项。

   /admin/hour-adjustments · EN · 2026-11-20

   [原始完整截图](assets/record-hour-adjustments-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 已显示过往人员 · 过往人员](assets/annotated/da49021bbd7b257ccbd938f89cf7e9c5e1317b8913ce5680c0245674158e5124.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在新增学时调整中，显示过往辅导伙伴会让已归档的练习人员可选。按钮现显示隐藏过往辅导伙伴。该显示操作未改变人员状态，也未提交第二项调整。

   /admin/hour-adjustments · EN · 2026-11-20

   [原始完整截图](assets/record-hour-adjustments-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **填写调整** 打开新增学时调整。选择辅导伙伴、月份及类型，按表单的半小时步长填写正数（如0.5），并说明具体原因。核对类型是增加还是扣减学时，再选择添加。此操作立即提交。

   ![填写调整 · 额外 · 半小时 · 具体原因 · 提交一次](assets/annotated/2cc977d213ae838d89998c4bb3dae4339905c53ce87a7cb2ea3e1c441fd34c5d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   尚未提交的草稿选择 Roster Practice Practice 和2026年11月，类型为额外，数量为0.5，并填写具体原因。点击添加即提交。

   /admin/hour-adjustments · EN · 2026-11-20

   [原始完整截图](assets/record-hour-adjustments-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **单独审核移除** 打开现有行详情阅读完整原因。只有审阅具体调整及总计影响后，才使用删除或移除操作；这属于逆转已保存证据。

   **视图 1**

   ![视图 1 · 月份与数量 · 保存的原因 · 保留记录 · 移除学时](assets/annotated/3ccab0bfdcfab0e457ee01f184dc9d6c7054e8f4bef82d09171107ea19d1d051.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   移除审核指出确切的练习辅导伙伴、2026年11月、额外0.5及保存的原因。删除会使该人员总时数减少0.5。本次审核已取消，保留已保存记录。

   /admin/hour-adjustments · EN · 2026-11-20

   [原始完整截图](assets/record-hour-adjustments-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 指定调整 · 原始原因](assets/annotated/5438a6e1523785492e80da72e3ac35956a3dd23d5041c305497da7dfbebdf8c8.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   查看详情可核对这条已保存调整：2026年11月、额外0.5以及原始练习原因。打开移除审核前先阅读这些证据。

   /admin/hour-adjustments · EN · 2026-11-20

   [原始完整截图](assets/record-hour-adjustments-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **验证总计** 阅读保存或审核结果，并在服务时数中检查同一月份。写入成功而刷新失败时使用只读恢复。

   **视图 1**

   ![视图 1 · 同一月份 · 额外0.5 · 总计0.5](assets/annotated/fd832bbd4a0f0411a6aca601263d0f293ec3a69ab6df21c9f341fe8eec76e5cb.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   服务时数确认同一月份，即2026年11月。练习辅导伙伴无课程，明细中显示额外0.5、总计0.5。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/record-hour-adjustments-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 变更已应用](assets/annotated/4f8a3867e137d9337d36f91b7529586ea93dd4f97317f3c0e6c863e07d2bbafc.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   表单确认该11月练习调整已应用。关闭结果后前往服务时数核对同一月份。

   /admin/hour-adjustments · EN · 2026-11-20

   [原始完整截图](assets/record-hour-adjustments-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

一项有说明调整或已审核逆转反映在正确时段总计中。

### 工作原理

调整是独立来源记录。创建草稿会在本次访问关闭再打开时保留，但离开或重载页面不提供存储。

### 问题排查

- **数量看起来不正确** 检查月份、数量及额外或处罚类型，再查看来源详情。通过审核流程修正已保存调整；未理解原始错误前，不要添加相抵重复项。

## 配置学校报表收件人及投递

保存收件人及时区、查看投递回执并管理仅报表链接。

打开: `/admin/service-hours`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **编辑收件人草稿** 在学校报表选择添加收件人，填写各学校邮箱及可选内部标签。现有条目可编辑或移除。保存计划前先完成或取消收件人编辑器。

   请注意: 找到收件人编辑、计划及已保存报表投递历史。

   **视图 1**

   ![视图 1 · 学校邮箱 · 内部标签](assets/annotated/5deda0cb6e45f8d88859e87a7cf01b48434cbc52dd63301099b772effc81fece.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   打开的“添加收件人”编辑器只填写一个合成学校邮箱及其可选内部标签，计划尚未保存。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 收件人标签 · 编辑收件人](assets/annotated/a70589b9ab93d802640660a94c9f4850d6cee2a72d9d95f1621f35f9aee6abe7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   本地计划草稿包含一位带标签的合成收件人，可编辑或移除。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

2. **审核计划及时区** 审核时区及默认月末当天中午时间，或设置特定月份日期。通过显示的审核路径保存。列表修改在保存前仍为草稿；保存设置不会发送报表。

   **视图 1**

   ![视图 1 · 时区 · 默认中午 · 保存计划](assets/annotated/90274d6b0798aae3e0a1f95d8b2f1bee0a4fb8b56758063e343f93815b8a1822.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   未保存的计划使用 Asia/Shanghai，默认在月末中午发送，未设置日期覆盖。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 计划复核 · 确认保存](assets/annotated/39e58d1fe3ff5c69a547fa366338db8a2a54c10c17bfae1fb1da35dfc3938b82.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   计划复核显示一位合成收件人，并说明保存配置不会生成报告。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 3**

   ![视图 3 · 下次发送 · 时区](assets/annotated/4bd71edab41efab7add0a52f9339c8b5e867a2c98541796603c32723cb7e2185.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已保存计划已启用，包含一位合成收件人。下次发送为 Asia/Shanghai 11 月 30 日中午。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-2-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

3. **查看版本投递** 管理员或负责人可打开“学校投递状态”，查看状态、尝试次数和投递提示。符合条件时，“重试投递”使用同一已保存版本和链接。“报告链接已打开”记录访问，邮件传输是否已接受另行显示。自动链接检查也可能产生打开记录。

   **视图 1**

   ![视图 1 · 已阻止 · 未记录打开 · 重试投递](assets/annotated/23afae834361e750892253c8208a21fb9bee889da8882105b6c5ed4548d5eead.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   项目邮件关闭时已保存第 1 版。其邮件处于阻止状态、尝试为零、未记录打开，同时可重试同一版本的投递。

   /admin/service-hours/school-reports/77a833d6-d3a3-42ce-a219-a97d82b15125 · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 同一版本 · 重试一次](assets/annotated/b2c7d340bafa1ee5ecbdecb4c877be82b18fc0a069eea251896e053b0f23ee71.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际重试复核使用同一已保存版本及链接，说明不会生成新报告或新增时数。

   /admin/service-hours/school-reports/77a833d6-d3a3-42ce-a219-a97d82b15125 · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 3**

   ![视图 3 · 重试已排队](assets/annotated/9ce712df3eab67693baa45eac798286ef12e96371f21bc46e260ea697f152592.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已接受的重试将 11 月第 1 版重新加入投递队列，已保存版本未变。

   /admin/service-hours/school-reports/77a833d6-d3a3-42ce-a219-a97d82b15125 · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-3-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 4**

   ![视图 4 · 已发送 · 链接访问](assets/annotated/b2a41b8d46bc525885608a0b5f36ecae79951f7ceeb726b46eb32a691d77c1af.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   同一份 11 月第 1 版显示尝试一次后已发送，并另外记录了一次链接访问。此记录出现在退出登录后打开实际邮件操作之后。

   /admin/service-hours/school-reports/77a833d6-d3a3-42ce-a219-a97d82b15125 · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-3-view-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **管理报表链接** 管理员或负责人可按需撤销或替换仅报表链接。收件人无需登录，因此有效网址即报表访问权，应只分享给预期学校收件人。

   **视图 1**

   ![视图 1 · 撤销影响](assets/annotated/786c3e110db23ef8e8ec4ffeb15d388675d7f326212f176f0f16ff4d0341f3c4.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际撤销复核说明当前报告链接将无法打开。此复核已取消。

   /admin/service-hours/school-reports/77a833d6-d3a3-42ce-a219-a97d82b15125 · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 同一版本](assets/annotated/1f8efb69014df41bad2ef0babd4db456837604b58ef27f9547cb50f25e0d7c31.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   独立的重新生成链接复核仅替换同一报告版本的访问链接，不会新增入账指示。此复核已取消。

   /admin/service-hours/school-reports/77a833d6-d3a3-42ce-a219-a97d82b15125 · EN · 2026-11-20

   [原始完整截图](assets/schedule-school-report-delivery-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

经审核的收件人和计划设置及各版本投递状态可见。

### 工作原理

自动化默认关闭。传输接受及链接访问不能证明已读邮件或学校入账，安全扫描及转发也会产生访问。收件人个人提醒与自动月度发放相互独立。

### 问题排查

- **自动发送未执行** 检查已保存计划已启用、项目邮件及服务时数生效、收件人有效且必要核算审核完成。重试前先阅读已保存版本投递状态。

## 阅读、打印及导出学期报表

打印或下载报表前选择正确历史范围及隐私设置。

打开: `/admin/history`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择范围** 打开报表并选择预期学期和报表。等必要记录加载后，先检查标题及日期范围，再理解总计。

   请注意: 选择学期及报表，再检查遮蔽与输出控件。

   ![选择范围 · 学年 · 时段 · 已加载报表](assets/annotated/b57fe4dc48a443b97fb8e90013f152bfc5347e121950672945a208182326f908.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已选择 25-26 学年及全学年。加载后的标题确认历史范围，个人信息遮蔽已开启。

   /admin/history · EN · 2026-11-20

   [原始完整截图](assets/export-period-reports-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **检查详情及隐私** 打开相关明细并审核隐私、遮蔽选择。观察者报表仍受限制；其他位置显示名册行不会授予私人报表数据权限。

   **视图 1**

   ![视图 1 · 详情级别 · 隐藏个人信息](assets/annotated/34db17915fc9c610d0537a89041e9fad1895b37df13d24bc2d990763d908ae46.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已选择明细并勾选隐藏个人信息。生成的报表确认个人信息已隐藏，下方显示有权限查看的辅导伙伴表。

   /admin/history · EN · 2026-11-20

   [原始完整截图](assets/export-period-reports-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 已得时数 · 总计](assets/annotated/5fe82d64e8bc337ceb16193df637b74547ea55cf34006d417ffbe06d2e4c3c80.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   历史行详情显示八次辅导的已保存时数。已得、额外、扣减及总计分别列出。

   /admin/history · EN · 2026-11-20

   [原始完整截图](assets/export-period-reports-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **打印或下载** 使用打印并检查打印预览。报表表格CSV下载需要管理员或负责人权限。选择预期表格，分享文件时保留学期和表头背景。

   **视图 1**

   ![视图 1 · 打印或保存 PDF · 报表范围](assets/annotated/786254dd24c4b6c87d03927afcd08beecdedf57de0705817363a7a093ccd0ea8.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已加载并遮蔽个人信息的 25-26 全学年报表可打印或另存为 PDF。所选范围保持不变。

   /admin/history · EN · 2026-11-20

   [原始完整截图](assets/export-period-reports-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 选择表格 · CSV](assets/annotated/6bf75cc87ea96c4953a165206b608c74a6993a5f8a7cc0c68013ffbc3b9aee95.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   CSV 控件属于按辅导伙伴统计服务时数的表格。此历史明细报表的每个表都有自己的导出操作。

   /admin/history · EN · 2026-11-20

   [原始完整截图](assets/export-period-reports-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **单独处理学校入账** 精确学校入账说明请使用服务时数中的学校报表。一般历史总计及项目记录归档不是再次入账相同学时的指令。

   ![单独处理学校入账 · 学校月报](assets/annotated/509e7fdaaa00343179cfdcecd0686351cd36d216e7fb4e3009e42684a844186f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   学校月报是辅导伙伴服务时数中的独立区域。说明要求每项未报变更只报告一次，并明确发放报表不代表入账确认。

   /admin/service-hours · EN · 2026-11-20

   [原始完整截图](assets/export-period-reports-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

打印或导出报表反映所选学期及允许数据范围。

### 工作原理

CSV保留数值，并对逗号、引号和换行进行引用。类似公式的文本会加保护单引号；在电子表格工具间打开或移动导出时应保留。

### 问题排查

- **报表依赖读取失败** 使用重试恢复所选报表及不可用依赖。保留范围和遮蔽选择；不要把部分加载报表当完整结果或导出猜测总计。

## 发布及维护公告

预览准确收件人快照，再发布、置顶、编辑或归档公告。

打开: `/admin/announcements`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **开始草稿** 打开公告及创建操作。填写标题、正文和相关选项。关闭再打开会保留本次访问草稿，离开页面则不会。

   请注意: 使用创建操作及受众的包含、排除控件。

   ![开始草稿](assets/publish-announcements-step-1.en.jpg)

   英文界面

   <details>
   <summary>截图详情</summary>

   在同一次访问中关闭并重新打开对话框后，这份未发送的公告草稿仍保留标题和消息正文。

   /admin/announcements · EN · 2026-11-20

   [原始完整截图](assets/publish-announcements-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **审核受众** 选择受众筛选及逐人包含、排除覆盖。发布前打开收件人预览，阅读固定数量及实际预期收件人。

   **视图 1**

   ![视图 1 · 收件人筛选 · 预览人数](assets/annotated/23bff6a0c84b89630b26888197bd5fe10c5bb4af3b0d42b792a89f0ec1838772.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   按活跃状态筛选后，预览显示 17 位收件人。搜索 Alice 只缩小覆盖选项列表，预览仍显示筛选后的完整名单。

   /admin/announcements · EN · 2026-11-20

   [原始完整截图](assets/publish-announcements-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 一位收件人 · 包含](assets/annotated/9d14fe32b2b8f2cca9e7b766d80eb10243d4baa0fd6956b2766fee32b735f519.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   选择“仅指定辅导伙伴”并包含 Alice Chen 后，未发送的草稿仅有一位拟定收件人。

   /admin/announcements · EN · 2026-11-20

   [原始完整截图](assets/publish-announcements-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **发布并验证** 审阅具体公告并发布或提交审核。检查应用状态和收件人快照；待审提案尚不等于已发布公告。

   **视图 1**

   ![视图 1 · 公告标题 · 一位收件人 · 发布公告](assets/annotated/5255596cc749fb930ee6631b3c60e44886d34bbaba39a4dca877630abf1ce1e7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   这条练习公告只发送给一位选定导师。主管点击“发布公告”后立即生效。

   /admin/announcements · EN · 2026-11-20

   [原始完整截图](assets/publish-announcements-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 已保存的公告 · 当前已生效 · 固定收件人名单](assets/annotated/a525e5891e70522de5a30b95dd892a7afc4e3a7bfa5ab9b9ab6b949634f378f6.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   保存后的练习公告已生效，已发布的固定名单只包含一位导师。

   /admin/announcements · EN · 2026-11-20

   [原始完整截图](assets/publish-announcements-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **维护已保存记录** 使用“保存”提交编辑，通过“置顶”或“取消置顶”调整位置，通过“停用”或“重新启用”管理可见性。分别查看已关闭人数及收件人信息。“删除”会打开独立审核。

   **视图 1**

   ![视图 1 · 停用 · 已关闭](assets/annotated/d2f46195f020521188d60214509b001b6219862e70363839ede969f13248e8cb.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已保存的启用公告提供“保存”“取消置顶”和“停用”操作，并单独显示已关闭人数。

   /admin/announcements · EN · 2026-11-20

   [原始完整截图](assets/publish-announcements-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 未启用 · 重新启用](assets/annotated/dc03ab32389b2bcb48f1d531a3700ec816df9157e4d9e71eb2446c7b17c8c498.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   另一条较早的公告未启用，可通过“重新启用”操作恢复；此处尚未执行。

   /admin/announcements · EN · 2026-11-20

   [原始完整截图](assets/publish-announcements-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

已发布公告拥有经审核内容及已记录收件人快照。

### 工作原理

受众预览为发布捕获收件人，因此不能因后续角色或名册变化就认为原受众已改变。已阅确认、通知投递及邮件传输是不同信号。

### 问题排查

- **预期收件人未出现** 检查分组筛选和个人排除，发布前刷新预期收件人预览。若已发布，应查看该版本快照，不要假设当前筛选结果就是其受众。

## 编辑网站页面、新闻及图片

使用首页编辑器独立标签及语言草稿，预览变更并审慎发布。

打开: `/admin/landing`

### 开始之前

- 需要当前协调员、管理员或负责人权限，并被明确指派为翻译员。只有管理职级不足以访问首页编辑器。

### 操作步骤

1. **选择内容区域** 打开“首页”，选择“布局”“主页面内容”“板块”“项目动态”“页面”或“图片”。用方向键在选项卡之间移动焦点，再按回车或空格打开当前选项卡。

   请注意: 使用“布局”“主页面内容”“板块”“项目动态”“页面”和“图片”选项卡。

   ![选择内容区域 · 焦点所在标签](assets/annotated/8d57ebc3b08de52d112927bc04cdfa51c3191a38c72ffad238ef29f890fd84d7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “布局”仍为所选标签，右方向键把键盘焦点移到“主页面内容”，回车或空格可打开该标签。

   /admin/landing · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **编辑当前草稿** 选择“语言”并编辑需要的字段。有独立“保存”的字段会在本次访问中跨选项卡和语言保留各自草稿。在“页面”中，离开标题或页面地址字段时会提交更改。“显示在顶部导航”会立即提交。

   **视图 1**

   ![视图 1 · 内容语言 · 标题草稿 · 保存此字段](assets/annotated/ef7e9e6b54fe4e200ddc4c8e20b6286fda991673bbb465bf77c9341ea5a95d63.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   内容语言切换到中文再切回后，英文主标题草稿仍在。启用的“保存”按钮仅应用此字段。

   /admin/landing · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 页面地址 · 顶部导航](assets/annotated/2a513e7aa1d15b3c2dc0e87eda95dcddfbdd5bc4a25c3545a3e22c39581aae06.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已保存的“关于项目”页面显示页面地址与已启用的顶部导航位置。本图未更改页面设置。

   /admin/landing · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **发布前预览** 打开“预览”检查已保存的布局、标题、链接及图片。编辑者还可在此预览中查看已保存的草稿和隐藏板块。未保存的 Markdown 编辑可使用编辑区内的“预览”。在小屏幕上核对链接和图片显示范围。

   **视图 1**

   ![视图 1 · 编辑器预览 · 已保存标题 · 公开页面链接](assets/annotated/1c0a70499e0a01d64d75812f72074fc74d1d1cb838bbd28c6a25bc6393cb75be.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   获得授权的首页“预览”显示实际布局和公开入口链接。未保存的测试标题不会出现在此处。

   /landing-preview · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2](assets/annotated/0d4716ceeffd22f62aaa57677b670328d85150980be63c2a3c00089ca200726d.webp)

   - **1.** 主标题

   - **2.** 公开入口

   英文界面

   <details>
   <summary>截图详情</summary>

   同一已保存的首页预览在移动端宽度下以单列显示主标题和两个公开入口。

   /landing-preview · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **保存、发布或恢复** 使用各区块的“保存”或“发布”控件，在更改生效后核对公开页面。“项目动态”使用“归档”或“恢复”，自定义页面使用“显示”或“隐藏”。生效的内容无需重新部署即可显示。

   **视图 1**

   ![视图 1 · 本条示例动态 · 已发布状态 · 发布日期](assets/annotated/5f10ec4fc4512e8acd9d5d20cfce44a42d02f80013c2e3fc9e2b0cfc0fe7e3ae.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   确切的练习帖子已发布。编辑器显示已保存状态、发布日期及取消发布控件。

   /admin/landing · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 创建草稿](assets/annotated/d33f74dbc301f2b7464fa697d7d355b077d4b545765b0eeae37202be36d85079.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在新帖子中填写标题和正文。创建草稿先为编辑者保存练习帖子，以便后续发布。

   /admin/landing · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 已保存的动态 · 草稿状态 · 发布此动态](assets/annotated/95f03b6ce27745def6e96f47c74c65510acaa70b857e0259b79b9068f310330b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   保存的确切项目动态标记为草稿。具有权限的管理员可在该卡片中发布这条动态。

   /admin/landing · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 4**

   ![视图 4 · 项目动态预览 · 预览中的草稿 · 草稿标记](assets/annotated/2c7d7fc3e4aa9f103d9a2509c8019dc722abbb24963283d963b73eec584b196e.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   仅编辑者可用的页面预览在项目动态下显示已保存的练习帖子，并标记为草稿。

   /landing-preview · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-4-view-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 5**

   ![视图 5 · 公开项目动态 · 已发布的动态 · 访客可见正文](assets/annotated/38717165f08fdb9f5aee81a699b2f238233c9302faf43b5fca4ad22581b50f59.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   退出登录后的公开首页在项目动态下显示这条确切的已发布练习帖子。

   / · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-4-view-5.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 6**

   ![视图 6 · 同一条动态 · 已归档 · 恢复为草稿](assets/annotated/3e680f6b2fa5f0e8f86dd58987a971653f8d0234ccb90e4afa3297f6c5c3b5bc.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   归档已将帖子从公开动态移除。已归档卡片提供恢复操作，可将帖子恢复为草稿。

   /admin/landing · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-4-view-6.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 7**

   ![视图 7 · 已恢复为草稿 · 保留的日期 · 再次发布](assets/annotated/676eeab2b833bdd9c7801f51942bc61f25f1dfc90a278a7d495725ee2520929b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   恢复后，同一条帖子再次成为草稿。保留的发布日期不会改变其草稿状态。

   /admin/landing · EN · 2026-11-20

   [原始完整截图](assets/edit-website-content-step-4-view-7.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

公开网站反映已应用内容，无关草稿保持独立。

### 工作原理

自定义页面属于公开内容，不是受保护参与者记录，也不能替代政策版本流程。帮助与操作指南属于维护目录；旧常见问题网址会跳转至此。

### 问题排查

- **预览被拒或保存未公开** 检查管理权限及明确翻译员指派，再检查返回保存或审核状态。读取失败可重试恢复草稿并核对所选语言。仓库政策编辑不会发布网站政策。

## 发布政策修订及翻译

保存已审核英文来源、添加翻译，并查看确切归档版本及重新接受。

打开: `/admin/policies`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择文档** 打开政策并选择辅导伙伴或学习伙伴政策。新站编辑器为空；发布前应获取学校审核文字。

   请注意: 选择辅导伙伴政策或学习伙伴政策及编辑语言。

   ![选择文档 · 辅导伙伴政策 · 学习伙伴政策](assets/annotated/8bbeb66f8d26c9f05cf343f86df36db7200b189310f8b2c4ec28bc06fa4adf67.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “政策文件”分别显示已发布的学习伙伴和辅导伙伴政策。此处演示现有的辅导伙伴政策。

   /admin/policies · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

2. **保存经审核英文来源** 选择英文，核对文档标题、版本及政策正文。管理员或负责人选择“保存”发布。协调员选择“请求管理员审批”。添加译文前核对发布版本。

   **视图 1**

   ![视图 1 · 已发布版本 · 英文政策已保存](assets/annotated/26b4238a82099ff1b690b97eff36105e6546d0fff275a4b9d977697657ebe0bc.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   英文辅导伙伴政策现显示“Saved.”及已发布的独立演示版本，既有政策内容均保留。

   /admin/policies · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 待保存版本 · 保存英文政策](assets/annotated/67cc0585961ff110575968fb49d808aaf67f9ed57b98ffed9e16122cbf2a2a42.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   辅导伙伴政策英文草稿保留已发布内容，仅添加独立演示备注和明确版本。“保存”即执行发布。

   /admin/policies · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

3. **分别保存翻译** 选择另一编辑语言，填写经审核翻译并明确保存。已打开语言草稿在本次访问切换时保留，但浏览器重载或离开不会存储。

   **视图 1**

   ![视图 1 · 当前编辑语言 · 译文已保存](assets/annotated/56b56f9e47ece96dbab85841e62e91aabcd51d714ac07864837ec36b2b71cd17.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   中文辅导伙伴政策显示其独立保存的版本及对应演示备注，当前编辑语言为中文。

   /admin/policies · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 选择编辑语言 · 填写版本 · 保存此译文](assets/annotated/89e62fc65fca65eb7b8a2cd71719cdbda5688840c476cf44d47f8f52c49b219a.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   中文辅导伙伴政策草稿使用独立编辑语言。对应的演示备注和版本已就绪，可单独保存。

   /admin/policies · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **查看确切历史** 使用版本历史→查看，阅读记录语言中的归档标题及正文。检查已发布版本和参与者重新接受要求，不改变原签名。

   **视图 1**

   ![视图 1 · 查看已归档的版本](assets/annotated/247ec84718ed1f808ef9c6c8453f76a8f81ca7fe072d72f3701257d86eb738db.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   旧英文辅导伙伴政策按记录的 2026.10.14 版打开。当前演示版本与归档正文和此前接受记录分开保存。

   /admin/policies · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 已归档的中文版本](assets/annotated/dcb97a8407ec0297bd676fcbe8589afe3546447166616a52838b77d63f34d3a1.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “查看”打开独立归档的 2026.10.14 版中文辅导伙伴政策，并使用该记录的原始语言。

   /admin/policies · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 3**

   ![视图 3 · 版本历史 · 查看归档副本](assets/annotated/8ad34d3f2bfbad5b333ee081dbf5bd5bad68e92d1550c8e528acf02d3c33190c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   展开的英文“版本历史”列出已替换的 2026.10.14 版，并提供独立“查看”操作。

   /admin/policies · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 4**

   ![视图 4 · 政策更新 · 查看参与要求](assets/annotated/6e282cb18be04a2e18e5b2710114c049ae82eda1474aee81e9408d2382b05024.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   关联辅导伙伴的账户重新登录后，新参与操作前会提示查看更新后的辅导伙伴政策。此画面中未记录接受。

   /admin · EN · 2026-11-20

   [原始完整截图](assets/publish-policy-revisions-step-4-view-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

预期版本及语言通过授权流程发布，归档文字仍可读取。

### 工作原理

政策接受记录准确接受版本、文字、签名及时间。后续修订不会覆盖旧接受；重新接受属于独立参与者操作。

### 问题排查

- **保存成功但历史或文档无法刷新** 再次编辑前使用独立只读刷新。不要仅因历史读取失败就重复发布。缺少翻译时检查文档及编辑语言。

## 发放及分享账户邀请

选择授权角色、审核绑定及有效期，分享有效邀请卡或导出图片。

打开: `/admin/registration-codes`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择允许邀请类型** 打开注册码。管理员或负责人可发放辅导伙伴、巡视组、管理员或协调员邀请。协调员可申请审核辅导伙伴、巡视组邀请，不能授予管理职级。没有邀请代码可授予负责人。

   请注意: 检查邀请卡角色及有效、已用、已过期状态。

   ![选择允许邀请类型 · 选择账户类型 · 注册码](assets/annotated/6ec32e1bb155d7be3ebd3369899e22cda7697de094bf1e51747862173d956b75.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   管理员发放注册邀请时可选择辅导伙伴、巡视组、管理员或协调员。表单尚未提交。

   /admin/registration-codes · EN · 2026-11-20

   [原始完整截图](assets/issue-account-invitations-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **核对绑定并发放** 选择类型，填写标签及可选邮箱，再核对角色和收件人绑定。管理员或负责人选择发放即直接提交。随后在邀请卡或列表中查看有效期及有效状态。协调员的发放申请在批准前保持待审。

   **视图 1**

   ![视图 1 · 邀请标签 · 绑定邮箱 · 发放注册码](assets/annotated/4da477188c06d2b005245e0741bfc0c4a0bd36c756acc1d521562e2709c465d9.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   辅导伙伴邀请草稿已填写演示标签，并绑定固定邮箱。选择发放代码会直接提交邀请。

   /admin/registration-codes · EN · 2026-11-20

   [原始完整截图](assets/issue-account-invitations-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 已保存 · 有效 · 到期日期](assets/annotated/587675d4824fded7de8971120abbcdb7f6a20848a256112f286240c8ad2160b1.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   绑定邮箱的辅导伙伴邀请已保存并处于有效状态。列表显示到期日期，邀请卡已关闭。

   /admin/registration-codes · EN · 2026-11-20

   [原始完整截图](assets/issue-account-invitations-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **分享有效邀请卡** 展开有效代码并使用复制、分享控件。导出图片会下载当前语言及主题色的account-setup.png，仅包含设置卡；只应分享给预期收件人。

   **视图 1**

   ![视图 1 · 导出图片](assets/annotated/6002fad7de4f426c9fd793a1d637d517c3778a7140cda31f1c991e2c62417a2c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   展开有效邀请卡后，可使用分享控件导出图片。完整的短窗口画面将实际代码留在滚动区域上方。

   /admin/registration-codes · EN · 2026-11-20

   [原始完整截图](assets/issue-account-invitations-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 复制并交给收件人 · 确认邀请有效](assets/annotated/be507a8a7b4996286fa2bece3af72098c44bb82b1994a4958e2f73971e11f5e7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   折叠的有效辅导伙伴邀请行提供复制操作，画面不显示邀请码。仅向指定收件人分享。

   /admin/registration-codes · EN · 2026-11-20

   [原始完整截图](assets/issue-account-invitations-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **检查使用或撤销** 已使用或过期卡作为保留证据阅读；其代码划线且无分享操作。管理员或负责人可通过明确审阅操作撤销符合条件邀请。

   **视图 1**

   ![视图 1 · 已过期 · 已使用](assets/annotated/7fa5e953a5777b1bd689245686c3a813bff1fff1d054970df322c1fdbb17fdd8.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   列表保留一条已过期和一条已使用的辅导伙伴邀请。两条非有效记录都不提供复制或撤销。

   /admin/registration-codes · EN · 2026-11-20

   [原始完整截图](assets/issue-account-invitations-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 核对该邀请 · 核对后再撤销](assets/annotated/d1808ae5cac247a4cfa676b1059b10e01a7a2df49f44827c4ab41febc1fbb452.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   撤销审阅显示该有效演示邀请的确切名称和到期日期。此次审阅已取消。

   /admin/registration-codes · EN · 2026-11-20

   [原始完整截图](assets/issue-account-invitations-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

能看到预期有效邀请或审核回执及准确授权角色。

### 工作原理

显示邀请代码授权查看；独立邮箱验证证明收件人。现有账户保留凭据及其他权限，只添加已授权审核升级。导出不会改变代码或有效期。

### 问题排查

- **图片导出失败或收件人无法兑换** 从同一有效卡重试图片导出，不要仅因下载失败就发新代码。兑换问题应检查有效期、收件人绑定及已用、撤销状态；邮箱证明仍是独立收件人步骤。

## 查找账户、参与资格及原始记录

使用用户与角色筛选和按需详情，区分登录就绪、标记及保留历史。

打开: `/admin/users`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **组合搜索及筛选** 打开用户与角色并搜索人员。组合角色、账户筛选、排除、历史记录可见性及未验证账户可见性。辅导伙伴状态只在仅包含辅导伙伴角色时出现。

   请注意: 分别阅读用户、登录设置、角色及参与、操作各列。

   **视图 1**

   ![视图 1 · 辅导状态 · 账户筛选](assets/annotated/16bf797f2ffe4f5d45155a1ca4acc780c40cdbd6c3aa0d347e35fa5563368a20.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   目录在包含辅导伙伴、排除观察者并选择设置完成后找到 Alice Chen。筛选旁可见辅导状态。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/inspect-accounts-and-identities-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 包含辅导伙伴 · 排除观察者](assets/annotated/116a188e7f057e0d34ad5e9a5fcd0da50010ae268cba26ea3e78067f353eff53.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   打开的角色筛选包含辅导伙伴并排除观察者。仅包含辅导伙伴角色，因此辅导状态可用。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/inspect-accounts-and-identities-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **单独查看登录就绪** 区分设置完成、设置未完成、邀请待处理及未直接关联登录。设置完成不保证当前权限；暂停与参与状态仍独立。

   **视图 1**

   ![视图 1 · 设置完成 · 账户停用](assets/annotated/87c5b399ac39f36a98d128e19868db9503cc090111825fdca88208f1e57671f5.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   示例观察员同时显示设置完成和已停用。结合设置与访问标记判断当前访问状态。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/inspect-accounts-and-identities-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 未关联登录 · 辅导伙伴记录](assets/annotated/a950a693558578cafb831c3ca08b90305ae21bdfcec9c29fdc5069e86e3dbb44.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Roster Practice Practice 有辅导伙伴参与标记，且未直接关联登录。名册历史独立于登录或密码。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/inspect-accounts-and-identities-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **打开用户详情** 阅读登录、权限与成员资格、关联参与者资料、历史记录及合并记录。查看确切账户政策接受历史及原入组学业资料，不要认为姓名就能证明归属。

   **视图 1**

   ![视图 1 · 合并记录 · 登录](assets/annotated/b65b6810561711e27c7949240b812c63d7b2fc1f4034970e8086e41d2ccd61d3.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   Alice 的用户详情打开合并目录身份与独立登录区域。权限和关联资料在同一对话框下方。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/inspect-accounts-and-identities-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 权限 · 政策历史](assets/annotated/fbc1e1633ad7e19051f080eb639ecd98cb9aed78f0284e76a84d2ff8c0b8d22c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   权限与成员资格显示账户角色，并单独提供政策接受历史以供审核。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/inspect-accounts-and-identities-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 关联资料 · 历史记录](assets/annotated/b0ceff295fcb0d68bac8725a6d9351f3c466307970d5a9b02a37940159d78acb.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   关联参与者资料显示 Alice 的直接关联辅导伙伴记录及当前账户学业资料。历史记录是独立区域，此账户在该区域没有记录。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/inspect-accounts-and-identities-step-3-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **选择正确账户路径** 在设置邀请、忘记密码、现有账户成员资格、仅历史访问及合并记录之间选择时，可打开应使用哪种账户路径。不要创建第二登录来解决设置状态问题。

   ![选择正确账户路径 · 账户路径](assets/annotated/a6f3b199b641a7ee53ed8357e1d2386858c4986ad69108a3d87c2bd1a59e0616.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   展开的账户路径说明区分设置与密码找回、现有成员资格、仅历史访问及经审核的账户合并。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/inspect-accounts-and-identities-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

编辑前能识别具体人员、登录状态、独立能力及原始证据。

### 工作原理

目录按明确合并人员显示一行，包括无账户资料。筛选要求一个成员满足完整表达式，不合并不同账户权限。辅导伙伴和学习伙伴成员资格可共存，即使紧凑行省略重复标记。

### 问题排查

- **已知人员未显示** 清除排除条件并检查显示历史记录、显示未验证账户及账户设置筛选。仅清除搜索不会清除其他筛选。应检查原始来源，不要假设人员已删除。

## 编辑姓名及学业资料

分别保存资料区块，保留原始入组证据及其他草稿。

打开: `/admin/users`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择准确来源** 找到账户或未关联参与者并打开编辑资料。决定修正哪份资料前，比较当前账户学业与参与者原入组证据。

   请注意: 打开编辑资料并检查各区块自己的保存操作。

   ![选择准确来源 · 查看原始报名资料 · 核对原始年级](assets/annotated/97bc40c6767eacd6dd42a642973d3d7c1d4b786ad120ad606864013a4ef253e7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   关联的已归档导师记录独立显示其原始报名学业资料，与账号当前学业资料分开。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/edit-account-profile-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **编辑一个区块** 更新该区块明确字段。学业记录应确认年级及参考学年，或明确毕业、离校状态；不要把用户名后缀当作学业证据。

   **视图 1**

   ![视图 1 · 编辑其他语言姓名 · 仅保存本区内容](assets/annotated/c6e95a6e519c9fb7301dcb7b497aa0d980e29a3b0fe80b998f76773563e7e274.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   此草稿仅修改其他语言姓名，保留之前记录的拉丁字母姓名。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/edit-account-profile-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 核对申报年级 · 核对参考学年](assets/annotated/6997195374d8890c6f9bd3cbde8b53985ff65d0591fa2e032442294d649eda6d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   尚未保存的“学业资料详情”表单显示申报年级及其参考学年。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/edit-account-profile-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **保存并等待读取** 使用该区块保存并审核结果。任一区块保存时编辑器不能关闭。写入接受后该区块先自动刷新再恢复编辑，其他区块草稿仍独立。

   **视图 1**

   ![视图 1 · 核对已保存姓名 · 独立处理年级草稿](assets/annotated/d3d593c72063e86e06b7bca15465d01b7a07ce398eb4ad403de169e4be697178.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   刷新后的“姓名”区显示已保存的值，申报年级仍由独立的“学业资料详情”编辑区显示。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/edit-account-profile-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2](assets/edit-account-profile-step-3-view-2.en.jpg)

   英文界面

   <details>
   <summary>截图详情</summary>

   重新加载页面并打开资料后，其他语言姓名仍显示为已保存。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/edit-account-profile-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **明确审核提案** 在管理操作跟进协调员提案。待审资料申请不会改变实际身份、学业或参与资格。确认全部预期区块已保存后再关闭。

   **视图 1**

   ![视图 1 · 核对待审核状态 · 核对受影响的账号 · 比较拟议值](assets/annotated/e378db6cd393a0a7560540f2ab7e6fb01d75acb919844ca5670ad66266a76221.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在“管理操作”中，协调员的请求列出账号及待审核、尚未应用的其他语言姓名变更。

   /admin/approvals · EN · 2026-11-20

   [原始完整截图](assets/edit-account-profile-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 核对拟议姓名 · 请求管理员审核](assets/annotated/0e2e890c4b872f23bdb6e51350daf62a51e38062a5faa06cf1b7010a90c37630.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   协调员可提交其他语言姓名的文字变体供管理员审核。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/edit-account-profile-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 确认已提交审核 · 查看待审核请求](assets/annotated/8fd44434665af4c4d95199489fc63074241381f8c0c88beaaac39e4ec2d467e7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   提交提示确认这项拟议编辑尚未更改实时记录。

   /admin/users · EN · 2026-11-20

   [原始完整截图](assets/edit-account-profile-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

仅已保存区块发生变化，原始入组及无关草稿保留各自证据。

### 工作原理

旧资料在改其他字段时可以保留未拆分全名。修改名、姓或偏好名需要有效拉丁字母名字；其他语言姓名支持其他文字系统。

### 问题排查

- **保存后区块仍只读** 使用重试刷新读取已接受值，不要再次提交。版本冲突中的明确重新加载只有成功读取新值后才替换草稿；再次保存前检查新值。

## 修正历史学业证据

审核原始入组值，并应用经验证单项或CSV批量修正。

打开: `/admin/academic-corrections`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **查找历史来源** 打开学业修正，选择辅导伙伴或学习伙伴并搜索准确参与者。阅读原入组年份、年级及参考年份和现有证据缺口。

   请注意: 选择辅导伙伴或学习伙伴记录，并在修正预览检查前后证据。

   ![查找历史来源 · 选择参与者类型 · 按姓名或编号搜索 · 查看原始证据](assets/annotated/a1635f3b892ea522ca66362cb99349a8c531757866827edabefadedf59c34f99.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在学习伙伴中查到 Hugo Mraz 的指定历史记录。原始报名记录为 12 年级，参考学年未知，未记录确认日期。

   /admin/academic-corrections · EN · 2026-11-20

   [原始完整截图](assets/correct-historical-academics-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

2. **准备修正** 编辑预期历史字段及原因。批量操作使用提供CSV格式或导出并保留来源指纹；网页和CSV使用相同验证预览。

   ![准备修正 · 历史年级标签 · 注明原始证据 · 说明更正原因](assets/annotated/6b54613602c7b07c130bf3683195f0b1be21ec16a6610b48fb73ac1590ac055c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   草稿完整写出同一个 12 年级值，参考学年仍留空，并记录原始证据和更正原因。

   /admin/academic-corrections · EN · 2026-11-20

   [原始完整截图](assets/correct-historical-academics-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

3. **审核所有前后值** 检查完整修正审阅、原始来源及变化学业值。管理员或负责人直接应用；协调员将完整批次提交审核。

   **视图 1**

   ![视图 1 · 查看更正前的值 · 核对拟更正的值 · 核对后应用](assets/annotated/1962c08fb27c2b5b1d8651778ac1bcbf25a81efbe8df1f49e84075506720423d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   单条记录审核显示，更正前为 12、更正后为 Grade 12，参考学年仍未知。原始证据保留，尚未应用更正。

   /admin/academic-corrections · EN · 2026-11-20

   [原始完整截图](assets/correct-historical-academics-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 确认已完成核对 · 应用已审核批次](assets/annotated/4a16516242ecdde2ad7c1616647d33235a5a0020049d8e030fb00953b707277b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   核对原始证据、拟更正文字及未知学年后，已勾选确认框。启用的按钮只会应用这一条已审核记录。

   /admin/academic-corrections · EN · 2026-11-20

   [原始完整截图](assets/correct-historical-academics-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **验证已接受证据** 操作后重新阅读历史记录及审计证据。当前账户学业应单独检查；历史修正不代表可以编造当前入学资料。

   **视图 1**

   ![视图 1 · 已保存更正回执 · 保留的原始证据 · 已记录的管理更正](assets/annotated/90c341b4727953acdf1123e1baa7e9ee29422dfc41a01af1b5ace27c04b040df.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   这一条更正已保存。历史年级标签现为 Grade 12，保留的原始证据仍为 12，参考学年和确认日期仍未记录。

   /admin/academic-corrections · EN · 2026-11-20

   [原始完整截图](assets/correct-historical-academics-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 查看已保存的版本 · 查看此版本的证据](assets/annotated/13290218b0642f9f04e229363d1135f9ba8a0f82bffc20ea2b98acd39d48ae53.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已保存的更正历史显示第 1 版、保留的未知参考学年，以及确切的证据和原因。

   /admin/academic-corrections · EN · 2026-11-20

   [原始完整截图](assets/correct-historical-academics-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 3**

   ![视图 3 · 核对已应用结果 · 核对指定历史记录](assets/annotated/5ff63ef11b37e7761cf4e4d2c29e78d6c12967228c67ed93f68b3abde084c992.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   审计日志显示已对这条指定历史学业记录应用一次网站更正。

   /admin/audit · EN · 2026-11-20

   [原始完整截图](assets/correct-historical-academics-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 4**

   ![视图 4 · 未启用报名 · 单独检查账户关联](assets/annotated/cd27ee602ec7501655d83cca06769a269088de7b2f3f59582d11f5044e7b61f7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   单独复查名册后，同一历史参与者记录仍为未启用，报名显示仍为 12 年级，且没有关联登录。

   /admin/tutees · EN · 2026-11-20

   [原始完整截图](assets/correct-historical-academics-step-4-view-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

经审核历史值整体改变，并保留来源证据及原因。

### 工作原理

草稿保留导出指纹，不会被后台刷新暗中重新基准化。批次作为一个已验证变更审阅；原入组值与当前账户资料仍区分。

### 问题排查

- **CSV或预览已过时** 阅读报告行或字段错误。重新读取来源证据并重新生成、审阅批次；版本冲突后不要移除指纹或重试旧学业假设。

## 提交及跟进管理提案

捕获允许的变更、阅读申请回执，并按需撤回尚未应用提案。

打开: `/admin/approvals`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **在对应页面准备变更** 在记录所属页面编辑预期操作，检查拟变更值及提供的后果审阅，再选择显示的申请、审核操作。协调员权限是明确列出的；操作不可用不代表可在别处通用提案。

   请注意: 使用状态及申请人筛选，并打开准确申请证据。

   ![在对应页面准备变更 · 提交提案](assets/annotated/5f9c1c598fa738920ac82699f0fb9063e4c598ad9d0a52cefcc52769d27dfc01.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   协调员在时段所属编辑器中准备示例A时段；添加时段会提交管理员审核提案。

   /admin/time-slots · EN · 2026-11-16

   [原始完整截图](assets/submit-management-proposals-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **打开申请回执** 出现已提交审核时，打开管理操作链接并核对申请人、目标、操作、提交时间及捕获的前后证据。

   ![打开申请回执 · 变更证据](assets/annotated/d80c6bac2e4a2a7ff0b6ce441f09164e5e8651c8ad8160b4dbf51241c6f897cf.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   协调员打开真实待审时段申请，查看申请人、操作及捕获的拟变更值；申请尚未应用。

   /admin/approvals · EN · 2026-11-16

   [原始完整截图](assets/submit-management-proposals-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **跟进待处理及已处理状态** 使用状态跟进本人的申请。管理员／负责人还可按申请人筛选；协调员只能查看自己的申请。阅读决定及最终记录，不要假设请求变更已立即保存。

   **视图 1**

   ![视图 1 · 状态](assets/annotated/4ed120249dd911d4c0e05b5a64ebb75924781aa074f75d09111b0b310c68c784.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   协调员按等待审核筛选自己的申请；协调员仅查看自己的申请，审核人的申请人筛选另行展示。

   /admin/approvals · EN · 2026-11-16

   [原始完整截图](assets/submit-management-proposals-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 申请人](assets/annotated/9d4fec377b9bd341b9d6520a6d66e79accbb3ce17efb9dfdfb6cab32d820e9c6.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   管理员和负责人审核人可同时按申请人和状态筛选；此实际视图仅显示Carol的待审申请。

   /admin/approvals · EN · 2026-11-16

   [原始完整截图](assets/submit-management-proposals-step-3-view-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

4. **撤回尚未应用申请** 若自己的待审提案已不需要，先核对具体目标，再选择撤回申请；该按钮会立即提交撤回。逆转实际已应用变更需使用对应功能的审阅逆转流程。

   **视图 1**

   ![视图 1 · 撤回](assets/annotated/f2766c141cd0176636879895d2aa71b22943b939dd5d224f6650d03e4928e7b0.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   协调员核对待审示例B时段的具体值及撤回申请操作，尚未撤回。

   /admin/approvals · EN · 2026-11-16

   [原始完整截图](assets/submit-management-proposals-step-4.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 撤回结果](assets/annotated/85fab787ad01763119bc3f8a2fb22d43b2ff86be7ecf356f9fbf44c7fc318cb2.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际已撤回申请保留示例B时段证据，并明确显示尚未应用。

   /admin/approvals · EN · 2026-11-16

   [原始完整截图](assets/submit-management-proposals-step-4-view-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

可明确识别提案拥有预期证据及真实待处理或已处理状态。

### 工作原理

待审提案不改变实际记录。原始提交证据保持不可变；审核人应用申请时会重新检查当前角色、政策及目标版本。

### 问题排查

- **申请已过时或被拒** 阅读决定及变化证据，回到对应页面重载当前值，仍有需要时提交新审阅意图。不要重放旧确认或在等待时重复提案。

## 查找审计事件并阅读确切证据

按稳定操作人、操作、记录及所示项目日期筛选，查看存储值而非重建历史。

打开: `/admin/audit`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **设置筛选** 打开审计日志并选择操作人、事件、操作、记录或日期筛选。日期控件使用显示的项目时区。同名操作人仍为不同稳定账户；已删除用户显示为原账户。

   请注意: 使用操作人、事件、操作、记录、日期筛选，再选择操作→详情。

   ![设置筛选 · 选择操作人 · 选择操作 · 选择记录类型 · 应用筛选](assets/annotated/1e1c90d97d466c9e4823468a48d53f49b46fb486c2b00bb62317b34ddb4c068f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   按帮助捕获管理员、添加导师操作和管理员记录类型筛选。结果包含一条匹配操作。如需添加日期，请查看时区说明。

   /admin/audit · EN · 2026-11-20

   [原始完整截图](assets/inspect-audit-evidence-step-1.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

2. **打开事件详情** 选择操作→详情，查看记录操作人及账户ID、目标、操作、包含UTC的确切时间、审核链接及撤销时间。提案和应用操作是不同事件。

   ![打开事件详情 · UTC 时间 · 技术详情 · 操作人 ID · 操作](assets/annotated/9ec894d1c2702467e74823927f62393a18cdf63f77d68dd9c11ea0704172c13f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   打开查看详情后，先比较项目时间和确切 UTC 时间，再展开技术详情查看操作人账户 ID 和操作。本事件未记录目标 ID 或审核。

   /admin/audit · EN · 2026-11-20

   [原始完整截图](assets/inspect-audit-evidence-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **阅读捕获值** 检查可读前后字段及证据。需要准确类型、字段名或转义文字时使用查看存储JSON。缺少详细证据表示当时未记录，不应从当前资料补推。

   **视图 1**

   ![视图 1 · 导师记录 · 操作前 · 操作后](assets/annotated/ec8b9943d18776c51875663a1c07c26f9389dd58ff1cffb0a71d46c119ea6249.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   展开导师比较，阅读捕获的值。此创建事件没有记录操作前的记录。操作后列显示历史上的 Roster Practice Practice 记录。

   /admin/audit · EN · 2026-11-20

   [原始完整截图](assets/inspect-audit-evidence-step-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **视图 2**

   ![视图 2 · 存储 JSON · 值类型](assets/annotated/cba3671b091b2377739f6dbaa392675dcd45e5d8f065f2e4f9e6eaa38d8edc0c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   打开查看存储 JSON，按记录原样阅读字段名、空值、数字和字符串。

   /admin/audit · EN · 2026-11-20

   [原始完整截图](assets/inspect-audit-evidence-step-3-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

4. **单独跟进恢复** 若捕获的准入需恢复，应打开支持的恢复流程，或用准确记录参考联系技术操作员。审计详情和旧撤销摘要不构成完整可逆链。

   ![单独跟进恢复 · 恢复参考 · 没有捕获的准入记录](assets/annotated/04092f4592086ad1930e2df0197deefb4fc47cf0d6410a2c8a2ec732637a9f64.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   从审计日志进入单独的准入恢复页面。若存在受支持的恢复参考，请填写。此演示没有捕获的初次准入记录。

   /admin/recovery · EN · 2026-11-20

   [原始完整截图](assets/inspect-audit-evidence-step-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

能够引用记录事件，并分清已知证据与从未捕获的信息。

### 工作原理

存储证据属于历史。当前姓名或角色不会重写事件记录操作人；事件摘要和详细值具有不同限制。观察者摘要仍被遮蔽。

### 问题排查

- **详情读取失败或无证据** 重试事件读取，不要重复其操作。若事件明确缺少详情，应记录该限制并使用其他已记录来源；不要推断未发生操作或编造前后值。

## 预览及应用受支持准入恢复

接受恢复前检查已捕获初始操作及依赖后果。

打开: `/admin/recovery`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **识别目标** 打开恢复并从已记录证据选择捕获初始准入。使用审计日志或数据库记录中的准确操作人、记录参考，不要按相似姓名选择。

   请注意: 选择准确捕获准入并检查完整恢复计划。

   ![识别目标 · 找到录取记录 · 查看恢复影响](assets/annotated/10e6985265a2cbebd6747045dfb7b7c271fbbb4d9b6ea4b2007d4c29f15b9ad9.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   面试负责人正式批准后，演示辅导伙伴申请留下了原始录取操作。请核对确切记录编号。

   /admin/recovery · EN · 2026-11-20

   [原始完整截图](assets/preview-admission-recovery-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **预览完整计划** 阅读原始效果、后续依赖操作及最终前后记录。网站支持至多一个后续依赖操作的完整计划；更长链需要操作员命令行。

   **视图 1**

   ![视图 1 · 阅读恢复预览 · 后续操作 · 恢复资格](assets/annotated/4ad2c47b75b7cd4d0f8fe46fe8ba55fc2db2a25b885ff64dbc669b7ec168b27c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   收件人验证前，这条录取记录具备完整证据，后续操作为零。系统支持进入恢复审阅。

   /admin/recovery · EN · 2026-11-20

   [原始完整截图](assets/preview-admission-recovery-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 核对恢复影响 · 查看保留内容](assets/annotated/56998a94adc9205feb1854d9913a3c68dfee16a997d5087c3731ab2547b51d7b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   尚未接受的演示录取有一条待撤销的注册码、零个待核对账户和零条待解除配对。历史面试出勤及工时会保留。

   /admin/recovery · EN · 2026-11-20

   [原始完整截图](assets/preview-admission-recovery-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 一项后续操作 · 符合恢复条件](assets/annotated/ec5b1b58b2524fee8aada00799ce4ac7d2c7c8fc6cfc99ef65bdee44c6b35e84.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   独立邮箱验证后，同一录取有一条邀请操作记录。当前计划仍可在网站恢复。没有创建新账户或配对。

   /admin/recovery · EN · 2026-11-21

   [原始完整截图](assets/preview-admission-recovery-step-2-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **通过授权路径确认** 填写必要恢复证据或原因并审阅全部后果。管理员或负责人应用符合条件计划；协调员提交需要审核。若预览无法确立预期恢复边界，应取消。

   ![通过授权路径确认 · 阅读确认信息 · 核对后再确认](assets/annotated/fea4bd9eb2e6b763b1795ddc88322a96d0ac30b182e03a6bb1e7c6f93d6b12d0.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   最终审阅明确说明撤销本条演示录取的影响。打开收件人操作指南前，已取消此次审阅。

   /admin/recovery · EN · 2026-11-20

   [原始完整截图](assets/preview-admission-recovery-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **验证回执及下游状态** 结果被接受后检查恢复回执及受影响记录。刷新失败使用只读恢复；不支持链应附准确参考交给技术操作员。

   **视图 1**

   ![视图 1 · 已保存回执 · 永久链接 · 恢复原因](assets/annotated/4c9afba0ae6a34b48a34e1828dbd04922a1243762f8406448919174d1184c3a8.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   此保存回执属于前面审阅的准确演示录取。回执有固定链接并保留操作员原因。

   /admin/recovery · EN · 2026-11-21

   [原始完整截图](assets/preview-admission-recovery-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 恢复面试状态 · 已记工时保留](assets/annotated/44936a7f91658a3644788cf9697e708587ad6f9c193f613284e23619750aeafd.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   重新读取面试记录后，申请人已回到面试状态，原 30 分钟的面试完成记录及出席工时仍保留。

   /admin/applications · EN · 2026-11-21

   [原始完整截图](assets/preview-admission-recovery-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 3**

   ![视图 3 · 同一申请人 · 已过期](assets/annotated/343d23f0b616f94bdfdc577eb3cacf73c5bb63f05b0683214bda8dc70e692c34.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   该准确演示录取的注册码在真实邀请列表中显示已过期。无效邀请码处于折叠状态。

   /admin/registration-codes · EN · 2026-11-21

   [原始完整截图](assets/preview-admission-recovery-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

只有完整受支持恢复计划被接受，且其证据与结果被记录。

### 工作原理

旧的一键审计撤销不可用，因为旧载荷不能证明完整后果链。只读预览或数据库检查器本身不会更改记录，也不授权不支持的恢复。

### 问题排查

- **计划不受支持或已改变** 阅读明确依赖或阻碍并加载新计划。不要选择性撤销简单字段。较长或不支持链应使用维护中的恢复手册及操作员命令行。

## 配置招募及下一学期开启时间

审核当前招募、准备指定目标学期开启时间，并发布正确报名链接及二维码。

打开: `/admin/program`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **检查当前学期** 打开项目设置→招募及换期，阅读当前学期及显示时区。分别检查辅导伙伴和学习伙伴招募，包括接受、开启、结束及设置条件。

   请注意: 打开招募及换期，并区分当前及下一学期编辑器。

   **视图 1**

   ![视图 1 · 当前时段 · 项目时区](assets/annotated/11c13cbea599252d3e299a8ae785144f779108de42ba259929c5327ab2770a0f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “招募与刷新”标签显示当前时段和招募日期所用的项目时区。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-recruitment-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 学习伙伴招募 · 辅导伙伴招募](assets/annotated/bc8ef06cca01b712d6c9cbaa168df401dd10ee0bd2a87b44de31c1c571b31f53.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   学习伙伴与辅导伙伴的已保存招募设置各自独立。图中两个接受申请开关均已开启。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-recruitment-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **编辑当前招募** 使用当前学期编辑器设置预期招募窗口。保存或提交允许提案前，审核保存日期、时区及独立接受开关。

   ![编辑当前招募 · 开始时间 · 结束时间 · 应用时间](assets/annotated/a18a08a20f6b415cd3679ee6c5bd624dbcdc9a43be1ca5bf671ab0f0450cd380.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   当前学习伙伴招募编辑器显示两项尚未保存的开始、结束时间（Asia/Shanghai），接受申请开关仍开启。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-recruitment-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **准备未来开启时间** 使用独立下一学期辅导伙伴、学习伙伴编辑器。确认具体目标，选择开启时间或明确清除，再保存。未设置准备会保留目标现有开启或默认值；清除仅移除开启限制。

   **视图 1**

   ![视图 1 · 目标周期 · 尚未准备 · 清除限制](assets/annotated/6cd48cada88819aa42ff85537ebce736405a19fd8088cd967d790a2fe92decef.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   两个角色都未为 26–27 学年第 2 学季准备开放时间。“清除开放时间限制”是针对所选角色的明确操作。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-recruitment-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 开放日期 · 保存开放时间](assets/annotated/6da8857c0c7e76de46de22ee560347a76e371b19a0375c1fead736d97541420e.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   辅导伙伴开放时间编辑器显示本地的第 2 学季开放时间草稿，尚未点击“保存开放时间”。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-recruitment-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **分享正确公开入口** 使用报名预览链接及公开二维码控件进入预期辅导伙伴、学习伙伴、巡视组或首页目标。分享前检查显示目标及当前招募通知。正式换期会一并启用已准备下一学期开启时间。

   **视图 1**

   ![视图 1 · 报名链接 · 下载二维码](assets/annotated/c9f26688b864631d28de14a57e1d23f8ab20cd1f24364416cf28c88bb8f87d0e.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “分享报名链接”列出辅导伙伴、学习伙伴、巡查队与网站首页，并提供带名称的二维码下载。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-recruitment-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 辅导伙伴报名](assets/annotated/08e00bd55edab342db734e89618d71d07be091b22c252a8e5dbb5e7f469aca42.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   辅导伙伴报名入口打开实际公开申请表。在此合成环境中，本期辅导伙伴招募已开放。

   /tutor-signup · EN · 2026-11-20

   [原始完整截图](assets/configure-recruitment-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

当前招募与未来准备是不同已保存设置，具有明确目标及时间。

### 工作原理

准备开启时间不会执行换期，也不会绕过结束、接受或设置规则。管理员、负责人可应用准备及时区变更；协调员可提交允许申请。换期本身仍属负责人权限。

### 问题排查

- **目标或准备已改变** 明确重新加载，检查具体目标并重读保存值后再审核。换期后使用当前学期编辑器，不要继续编辑过时准备。

## 设置上课日及暂停辅导通知

在申诉日历中设置单日调整和假期范围，并决定辅导通知是否同时暂停固定课程。

打开: `/admin/program`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **检查日历** 打开项目设置→招募及换期中的学校日历控件。编辑单日之前先阅读项目时区及已有上课日、非上课日覆盖。

   请注意: 在招募及换期中找到学校日历及不辅导通知。

   ![检查日历 · 项目时区 · 已保存日期](assets/annotated/e97ed2672f21bf38d6e6c1d32c4fb62e12e798691f5fb8699f06204089fe851b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   招募及换期显示项目的亚洲／上海时区、独立的辅导通知以及学校日历中保存的日期调整。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-school-calendar-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **保存或移除覆盖** 选择预期日期及是否上课，再通过显示权限路径审阅、保存。恢复某日正常日历行为，应使用明确移除或重置操作。

   **视图 1**

   ![视图 1 · 实际日期 · 上课状态 · 课表 · 保存学校日期](assets/annotated/c14ac25cdd206dcedf68f1d931e62048ae90d523a6986234c30ac6419d56a265.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   草稿将一个星期六设为上课日，并采用周一课表。保存学校日期前检查日期、上课状态和课表。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-school-calendar-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 核对保存日期 · 确认恢复](assets/annotated/1a3f44c1367028a54050bfab7d26d6146f3f2bbadb766c6119e92795bba85568.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   恢复常规安排要求核对保存的日期，并说明对校历规则、保留历史及已约定课程的影响。示例停留在审核。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-school-calendar-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **添加假期范围** 选择添加假期，填写开始日期、结束日期和共用的工作人员备注。范围包含起止当天和周末，最长366天。核对不上课天数，以及保存时会被替换的已有日期设置及备注。选择保存假期以应用整个范围，或选择申请管理员审批以提交一项协调员提案。

   ![添加假期范围 · 选择日期范围 · 统计全部日期 · 核对替换项目 · 保存假期](assets/annotated/34ef2bf8fb73fbab8d4e9a36a07d6790b09f77d7156af37b9fcdc9537d585adf.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   草稿选择11月16日至18日。界面预览计算出三个不上课日，并列出保存时会替换的11月17日调整。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-school-calendar-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **创建通知或暂停** 填写开始日期、含当天的结束日期及原因。新范围默认选择暂停固定辅导，会停止未来普通课程。若只提供说明而不改变课表，请改选仅通知。暂停期间的新日期例外须明确同意。

   **视图 1**

   ![视图 1 · 含起止日期 · 课程安排影响 · 原因 · 审核影响](assets/annotated/478763234f1c336f815c093673976c82fae822a58038d80283a6d3086784d9d0.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   独立的辅导通知草稿涵盖11月23日至24日，显示暂停固定辅导及其影响。仅通知可发布说明，保持课程安排。先进入审核，尚未保存。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-school-calendar-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **视图 2**

   ![视图 2 · 仅通知 · 课表不变 · 保存通知](assets/annotated/bcba79954eb1cb1a7241dc60a5b8c250d74fa283a236c6eb8cbd218979e3c69f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   仅通知发布说明，同时保持已有日期约定。本例显示独立保存按钮，尚未保存。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-school-calendar-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

5. **审核现有约定** 应用或解除暂停前阅读受影响已发布约定。已确认加课及已同意改期会保留；应检查影响审核，不要假定所有课程均取消。变更结束日期、原因可编辑现有通知；变更用于标识的开始日期，须移除后新建。查看详情可读完整原因。

   ![审核现有约定 · 受影响约定 · 保留约定 · 审核后保存](assets/annotated/f93bac350eb01dbf9daa9fa8c5f1044c5d203c4a42ab5d06a33528c8961df188.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   实际影响审核计算出此草稿涉及12项固定辅导学习伙伴约定，并显示范围内已确认加课或已同意改期的数量为零。保存通知是独立操作，本例未执行。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-school-calendar-step-5.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

### 预期结果

已审核日历覆盖及通知、暂停效果按准确日期范围保存。

### 工作原理

上课日覆盖影响纪律申诉截止时间。辅导暂停不重写历史出勤或申诉日历。重叠通知彼此独立，因此移除一个暂停不会解除另一个。

### 问题排查

- **编辑假期期间已有日期发生变化** 使用重新加载当前日期范围。日期和备注会保留在表单中。再次保存前检查更新后的替换内容。范围保存后，仍可对单日使用编辑或恢复常规安排。

- **移除通知后课程仍暂停** 检查每个重叠暂停及准确含端点范围，并确认该项是否仅为待审提案。不要改历史出勤来配合新暂停计划。

## 配置报名字段、姓名及学业要求

设置必填、可选、隐藏字段、姓名展示及学业确认，同时保留已接受证据。

打开: `/admin/signup-forms`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **选择表单及字段** 打开“报名表”并选择所需表单，例如“辅导伙伴报名”。查看当前字段要求，在对应字段行选择“配置”，再选“必填”“可选”或“隐藏”。

   请注意: 选择报名表并检查各必填、可选、隐藏选项。

   **视图 1**

   ![视图 1 · 导师报名 · 第二科目 · 配置此字段](assets/annotated/25ffd3923e7106721fc6b469d708d86bdb7bc878df7a12476f22e344c8d8c84d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   已选中导师报名页签。“第二科目”一行显示当前要求，并提供独立的配置按钮。

   /admin/signup-forms · EN · 2026-11-20

   [原始完整截图](assets/configure-signup-fields-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 所选字段 · 当前为选填 · 可选设置](assets/annotated/2f3a2059a74546867772e09d82aaa6a18e2b9aa2dd1fedb39265275ae02cb8ee.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   点击“配置”会打开所选导师报名字段。当前为“选填”，窗口列出三个可选设置。

   /admin/signup-forms · EN · 2026-11-20

   [原始完整截图](assets/configure-signup-fields-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

2. **审核姓名及年级政策** 打开“项目设置”→“账户设置”→“姓名与年级”。在“姓名显示预览”中核对显示选项，并查看未来确认可使用的年级。展开“姓名字段要求”，核对各账户类型的拉丁字母等姓名规则。

   **视图 1**

   ![视图 1 · 账号设置 · 显示预览 · 可选年级](assets/annotated/7013cdacdc3ff45da8b155279423bfb62d2c6189ed6d90481fd77f2996cf19ea.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “账号设置”中的“姓名与年级”显示实时姓名示例和将用于后续确认的可选年级。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-signup-fields-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 导师账号规则 · 名字要求](assets/annotated/6c1c8e4b72b8ac72f27b1ae8ea7543ad97aac4f88632f92f464ae85bb75cb274.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   导师账号类型在独立窗口中设置各姓名字段的要求。此次查看未修改任何字段。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-signup-fields-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

3. **保存预期范围** 在字段的“配置”对话框中核对所选要求。管理员或负责人选择“保存”应用设置，协调员选择“提交审批”。保存成功后核对对应字段行。

   **视图 1**

   ![视图 1 · 第二科目 · 选择必填 · 保存字段](assets/annotated/cdadfb69c76d502e4cd01f2736014ca5d2a5e2b0a3b0a632053c34b05c488199.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “第二科目”窗口已选中“必填”。“保存字段”只应用这一个导师报名字段。

   /admin/signup-forms · EN · 2026-11-20

   [原始完整截图](assets/configure-signup-fields-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 导师报名 · 已保存的要求](assets/annotated/624cac13c04737e36ce39ad54e019bdbf1decdf272f55543549fa00b7e8bc257.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   配置窗口已关闭，导师报名的“第二科目”已显示为“必填”。

   /admin/signup-forms · EN · 2026-11-20

   [原始完整截图](assets/configure-signup-fields-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **预览实际报名** 设置生效后打开对应的公开表单，核对字段标签、必填标记及校验。更改共享账户政策时，也请核对相应的账户资料编辑器。

   ![预览实际报名 · 必填标记 · 第二科目](assets/annotated/9cdbcda82ec89a8bcaec0d76d9957f9131f8e230017efb0fc8909abbe9934395.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在实际公开导师报名表中，保存设置后“第二科目”显示“必填”标记。

   /tutor-signup · EN · 2026-11-20

   [原始完整截图](assets/configure-signup-fields-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

仅经审核表单、资料要求生效，参与者指引与其一致。

### 工作原理

姓名展示偏好不改变原姓名、用户名或历史签名。若所有姓名字段隐藏，个人资料会说明状态，而非展示空白保存表单。要求读取失败不能用猜测默认值替代。

### 问题排查

- **字段仍出现或保存受阻** 确认表单类型、已应用或待审状态及当前政策读取。设置读取失败时保留草稿并重试；版本冲突应明确重载后再保存。

## 配置邮件、通知及访问控制

在对应面板审核部署状态、必要偏好、备用邮箱绑定、验证码及联系规则。

打开: `/admin/program`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **变更政策前检查投递** 打开“项目设置”→“部署配置”→“邮件通知”。在“邮件投递状态”查看安全邮件和项目邮件。打开学校报表邮件预览，查看 HTML 或纯文本。预览不会发送邮件。SMTP 由技术操作员在主机上配置。

   请注意: 使用账户设置及部署配置；各控件独立保存。

   **视图 1**

   ![视图 1 · 安全邮件 · 项目邮件 · 打开邮件预览](assets/annotated/e6d31f938e8c55dac784ad4d874ada0e3b030ae631714191725381b18edfc995.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   部署配置分别显示两项 SMTP 检查和学校报告邮件预览。SMTP 就绪不代表邮件已进入收件箱。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-mail-and-access-controls-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 仅供预览 · 邮件 HTML](assets/annotated/9548fe94d3761723cd330fb91032b2912b53c8d3798b531cba9e2ff50df93c50.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   邮件 HTML 按所选学校报告月份生成实际预览，既不推进基准也不发送邮件。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-mail-and-access-controls-step-1-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 3**

   ![视图 3 · 纯文本](assets/annotated/b788bba0cf2cb93c43a56a66d46fd9575ca7fb427ecdaa30fb7ca13729cc200e.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   纯文本选项卡显示同一只读报告预览的另一种邮件格式。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-mail-and-access-controls-step-1-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

2. **审核邮件及通知要求** 阅读“启用邮件通知”旁的影响说明。切换后会按当前权限提交投递设置。在“必需通知”中核对要更改的锁定项，再选择“保存通知要求”或“取消”。锁定设置作用于各用户的独立偏好。

   **视图 1**

   ![视图 1 · 核对未读标记锁定 · 保存](assets/annotated/d881865d23b88b5c01cbf41d944b087097d9ee98147228a8ffbd0d3b76675382.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   必要通知中的公告未读标记是本地草稿。可保存要求，也可取消并丢弃草稿。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-mail-and-access-controls-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 邮件开关 · 阅读变更影响](assets/annotated/7f6578e37249443aa42c8eae66c449ac34ded3c4b6c061c1113360c90f688e54.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   投递设置显示项目邮件已启用，并说明立即切换会影响哪些邮件。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-mail-and-access-controls-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

3. **审核账户及访问控件** 在有标签控件中检查备用邮箱绑定及验证码设置，再通过各自权限路径仅保存预期设置。角色、用户联系权限需要管理员或负责人直接操作；协调员不能提案联系权限变更。

   **视图 1**

   ![视图 1 · 备用邮箱 · 验证码已关闭 · 查看服务配置状态](assets/annotated/fb217abf68d011256522cbd487ce3bceffad5ec77fc741b39220fc18d73534b5.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   页面分别显示备用邮箱绑定已启用，以及因服务提供方尚未配置而无法启用验证码。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-mail-and-access-controls-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 核对指定账号 · 当前生效联系组 · 必须填写理由](assets/annotated/a3fd2f370d28c9eb139f226eef1f7952028e9d1dd0f309bffb2164bb06be5f07.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   账户设置显示指定的 Alice 账号及生效的消息联系组。填写理由前无法保存。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-mail-and-access-controls-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **谨慎重试已有投递** 管理员或负责人可使用“重新发送滞留邮件”，处理符合条件的失败或重试中投递。阅读操作结果，再用“刷新状态”确认传输情况。在相应登录、报名或消息页面核对访问变更。

   ![谨慎重试已有投递 · 刷新状态 · 符合条件时重试 · 阅读重试范围](assets/annotated/1b355556d57f0a0d0ed9d265435bfbace1093c7b301327de81623673347ebb5f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   刚刷新的状态显示两个投递渠道均已就绪，当前没有符合条件的滞留邮件，重发控件不可用。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/configure-mail-and-access-controls-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

每项预期通信、安全设置拥有独立应用或提案结果。

### 工作原理

必要账户、申请邮件与可选项目副本遵循不同规则。传输接受不证明收件箱投递。联系权限配置不会授予协调员私人消息监管。

### 问题排查

- **仍收不到邮件或验证码不可用** 阅读准确保存状态、收件地址及提供商、主机配置错误，再使用相应重试或操作员设置。反复重发不能修复提供商就绪，也不能延长固定验证期限。

## 准备可选功能变更

比较当前生效与待生效模块开关，并理解正式换期何时启用。

打开: `/admin/program`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **阅读已生效模块** 打开项目设置→可选功能。阅读预期模块已生效及待生效状态，例如巡视组、面试、会议、服务时数或自动教室分配。

   请注意: 打开可选功能，比较已生效与待生效值。

   ![阅读已生效模块 · 当前生效 · 换期后关闭 · 暂存前的教室开关](assets/annotated/138cd2ab6efa5b3d96cfebcb84155f38cc6984a72b1dc4307566e523829945b4.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   可选功能区区分已生效的开启状态和待生效徽章。导师会议已开启且待关闭，自动分配教室已开启且暂无待生效变更。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/stage-program-modules-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

2. **准备预期开关** 将开关切换到预期的下一状态。管理员或负责人切换后立即将变更设为待生效，协调员的变更需提交管理员审核。正式换期应用待生效选择前，当前状态继续生效。

   ![准备预期开关 · 当前开启 · 待生效关闭 · 拟用关闭状态](assets/annotated/3065c3a197ff93f5a79ee52022b43b3162e25d4a1782da00e93c40319d3c3231.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   自动分配教室当前仍为开启，关闭待下一次换期生效。开关表示未来拟用状态。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/stage-program-modules-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

3. **明确取消待生效变更** 将功能开关切回当前生效状态，并核对返回的状态。取消生效后，待生效标记会清除。如果保存成功但读取失败，请选择“重试刷新”。

   ![明确取消待生效变更 · 恢复为开启 · 开关已开启 · 导师会议仍待关闭](assets/annotated/8b60c506686c22ba9332ce8c6515d1c99acb6e1ece4ea108c01cd09560bc960b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   “自动分配教室”目前已开启。“导师会议”一行则显示将在下次刷新时关闭。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/stage-program-modules-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **在换期审核启用** 授权正式换期审阅会列出暂存设置及参与后果。负责人应用换期后，检查生效模块及相关工作区。

   **视图 1**

   ![视图 1 · 暂存模块结果 · 参与变更 · 取消本次审核](assets/annotated/4e7ad0ff1d974cdc6850ec062380bda62aac303b1146e704209d597db39b3412.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   真实的负责人审核列出目标时期换期后导师会议将关闭，并说明对参与及保留历史的影响。取消后当前时期保持生效。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/stage-program-modules-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 查看暂存模块 · 输入 REFRESH · 打开换期审核](assets/annotated/046b1c5ed47b8f64dafe22902f62f3b4fedb40e95900b677ed01604fae1b5f6f.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   当前换期预览列出导师会议将关闭。输入 REFRESH 后可打开指定目标时期的审核。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/stage-program-modules-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 3**

   ![视图 3 · 当前Q2 · 会议现已关闭 · 已生效的开关](assets/annotated/2a4931d7f6d84714d1ae83d3bef04f46a1d2a90f33e937d122b01ee1d32c1420.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   正式换期已接受，Q2为当前学季，辅导伙伴会议实际为关闭，已无待应用的覆盖设置。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/stage-program-modules-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

下一预期模块状态已明确暂存，不会误称已经启用。

### 工作原理

关闭模块会按现有读取规则保留历史证据。暂存与正式换期是不同操作；管理员可以准备设置，但不能代替负责人执行换期。

### 问题排查

- **开关似已保存但功能未改变** 比较生效、待生效值及当前学期。应等待授权换期，而不是反复保存。若待生效目标改变，应重载准备并重新审核。

## 下载及维护帮助手册

获取分角色中英文PDF手册，并检查截图来源及更新流程。

打开: `/admin/help`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **打开手册下载** 在管理导航打开PDF手册。阅读可用版本；下载遵循当前账户权限，负责人手册仅负责人可用。

   请注意: 选择允许的手册角色及其中英文PDF下载。

   ![打开手册下载 · 打开手册 · 手册列表](assets/annotated/35bdbefdf8c3438c497fa35f54a45b097d3872596d60f2cc014dcdfe7c94ac35.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   在管理侧栏打开 PDF 手册。管理员可查看参与角色和管理手册。负责人手册按账户角色开放。

   /admin/help · EN · 2026-11-20

   [原始完整截图](assets/download-help-handbooks-step-1.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

2. **选择语言及角色** 选择所需角色手册，再选择英文或中文PDF。保存下载文件，分享预期版本前检查标题、文章清单及截图说明。

   ![选择语言及角色 · 英文 · 中文](assets/annotated/59264b56aa466884e3b05493da00d580b5ed02ea664dd877829d472f4dbecfc6.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   滚动后可看到查看项目手册。选好角色后下载英文或中文版本，并核对保存的 PDF 标题。

   /admin/help · EN · 2026-11-20

   [原始完整截图](assets/download-help-handbooks-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **检查截图来源** 查看指南截图来源详情中的版本、日期及路径。在GitHub目录打开captures.json，查看角色、视口及裁剪记录。中文指南会标明英文回退截图。本组截图标为最新主分支，不声称该版本已经部署。

   ![检查截图来源 · 来源版本 · 截图日期 · 开发服务器](assets/annotated/30bbb5e4fe6f254e5d1c1ef8329065497466fd3c5cd995926403d1fc12f3662c.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   展开指南中的关于这些截图，查看开发基线、拍摄日期和服务器。每个步骤也会标注自己的页面路径和来源版本，可能与当前默认值不同。

   /help/sign-in-recover · EN · 2026-11-20

   [原始完整截图](assets/download-help-handbooks-step-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

4. **保持GitHub副本同步** GitHub阅读应使用仓库生成帮助目录；截图及PDF更新应按维护流程进行。修改共享内容来源并一并重新生成，不要独立编辑导出手册。

   ![保持GitHub副本同步 · GitHub 副本 · PDF 手册](assets/annotated/4e35e469a9521664b35c7714146d683c53206f3ce1f6772bb32897e25b3d8ab2.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   帮助目录链接到维护中的 GitHub 副本和 PDF 手册。修改共享指南后，按仓库流程重新生成各版本。

   /help · EN · 2026-11-20

   [原始完整截图](assets/download-help-handbooks-step-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

### 预期结果

下载版本符合所选语言和角色，且可查看捕获证据。

### 工作原理

网站、GitHub手册及PDF来自同一维护文章记录。真实开发服务器截图使用虚构数据展示控件，不授权进入受限流程。

### 问题排查

- **手册不可用或下载被拒** 返回PDF手册，检查当前权限允许的版本。临时下载失败时重试；若持续失败，请操作员检查文档中的截图及字体维护流程。不要给其他角色文件改名来冒充缺失版本。

## 审核及更改项目时区

在所选预览日期比较IANA区域标记，再审核日历及排课后果后保存。

打开: `/admin/program`

### 开始之前

- 使用有效的管理权限登录。可选模块须已启用。协调员将允许的变更提交审核；管理员和负责人可直接应用非换期变更。

### 操作步骤

1. **检查生效区域** 打开“项目设置”→“招募与刷新”→“项目时区”。查看当前 IANA 区域并选择拟更改的区域。UTC 偏移可能随预览日期改变。

   请注意: 使用项目时区的预览日期及拟选区域选择器。

   ![检查生效区域 · 项目时区 · 预览日期 · 当前区域](assets/annotated/70cd6a2413df249613c4d854d656fa08117014ab651d65f2b68424e63ce6f756.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   当前项目时区为 Asia/Shanghai，并显示 IANA 区域选择器及偏移标签所用日期。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/change-program-timezone-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

2. **比较季节示例** 更改预览日期，检查季节偏移及当前、拟改本地时间示例。它在两个区域比较同一12:00 UTC参考时刻；更改预览日期不会保存项目设置。

   **视图 1**

   ![视图 1 · 一月预览日期 · 比较同一时刻 · 一月本地时间](assets/annotated/7cb84d340824febd3cbdd3ee4badb02e65d312c376c607488cce8beaa53ae11d.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   一月在两个区域使用同一 12:00 UTC 时刻。纽约显示 GMT−05:00 的 07:00，已保存设置仍为 Asia/Shanghai。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/change-program-timezone-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 七月预览日期 · 比较同一时刻 · 七月本地时间](assets/annotated/339d9e77ee16a62539142f2452b8b650a9d31319f431b5e85345091cf8035e67.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   七月在同样的 UTC 正午比较中，纽约显示 GMT−04:00 的 08:00。预览日期只改变示例。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/change-program-timezone-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

3. **确认并保存** 阅读影响并确认对排课及截止时间的影响。管理员或负责人选择“保存时区”，协调员选择“请求管理员审批”。若要放弃草稿，请切回当前区域或选择“重新加载当前设置”。

   ![确认并保存 · 核对显示的影响 · 确认影响 · 保存时区](assets/annotated/259b19cd9efd659e9adcb70d2d4be0d8d7a51c85b16b2fc0e7be72217b6dbaf3.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   新加坡草稿与当前生效的上海区域比较。负责人选择保存时区前，已勾选影响确认。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/change-program-timezone-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

4. **重新检查日期输入** 在“项目时区”核对保存的区域。“下一周期招募”草稿过时时，先选择“重新加载准备”再编辑。在显示时区的日期排课或日历输入旁核对区域。

   **视图 1**

   ![视图 1 · 核对已保存区域 · 查看保存结果](assets/annotated/b21faa7f2ad711667823eae7621c9680b94d46a40b6a48ba1659edf731c8f35b.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   编辑器显示真实保存结果，新生效的 IANA 区域为 Asia/Singapore。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/change-program-timezone-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 2**

   ![视图 2 · 查看过时警告 · 重新加载此准备](assets/annotated/53e4d56fd98ddf07cd57e60bc702d7e8c1e721285ca18e8ad4d0f035e08133d7.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   之前打开的导师招募准备仍保留上海时区，重新加载准备成功前无法编辑。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/change-program-timezone-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

   **视图 3**

   ![视图 3 · 重载后的区域 · 日期输入所用时区](assets/annotated/b27dd434644089d3d86234abcd77b7813a2ca9ab5ac8a37293005508f2380802.webp)

   英文界面

   <details>
   <summary>截图详情</summary>

   重新加载后，导师招募准备在尚未保存的开启日期和时间旁显示新加坡时区。

   /admin/program · EN · 2026-11-20

   [原始完整截图](assets/change-program-timezone-step-4-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate. Isolated synthetic first-report demonstration phase.

   </details>

### 预期结果

已应用区域及转换示例符合经审阅时区变更，或明确显示待审提案。

### 工作原理

每周钟表时间段保留钟表值，已保存时刻仍为同一时刻。区域控制显示日历解释及日期输入转换。夏令时模糊或跳过的本地输入会被拒绝，不会猜测。

### 问题排查

- **保存过时或本地日期时间被拒** 明确重新加载以采用当前区域，再次审核。夏令时空缺或重叠应选择无歧义本地时间并检查明确时区；只改变预览日期不会改变设置。
