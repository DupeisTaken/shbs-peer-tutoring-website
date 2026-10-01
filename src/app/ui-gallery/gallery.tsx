"use client";

import { useEffect, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { Button, ChoiceButton, Switch } from "~/app/_components/ui/button";
import { Modal } from "~/app/_components/ui/modal";
import { FormSection, StatePanel } from "~/app/_components/ui/patterns";
import { SectionTabs } from "~/app/_components/ui/section-tabs";
import {
  SummaryTable,
  TableActions,
  TableAction,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { DEFAULT_THEME, THEMES, isTheme, type Theme } from "~/lib/theme";

const en = {
  badge: "Development · synthetic examples",
  title: "UI pattern gallery",
  intro:
    "Reusable building blocks for editing, choosing, reviewing and recovering. These examples use the same components as the application.",
  locale: "Example language",
  theme: "Accent theme",
  state: "Form state",
  normal: "Editable",
  pending: "Saving",
  error: "Save failed",
  readonly: "Read only",
  viewport:
    "Resize the browser to review the real responsive layout. Below 1024 px, controls keep their touch targets and the final action column stays reachable.",
  scope:
    "All edits stay in this page. Reload to reset the examples; no program records are changed.",
  edit: "Edit a section",
  editUse:
    "Use for related fields saved together. Keep the action row after every field in its scope.",
  profile: "Profile names",
  profileHelp: "Both names are included when you save this section.",
  name: "Display name",
  otherName: "Name in another language (optional)",
  save: "Save profile",
  cancel: "Cancel",
  saved: "Profile saved in this example.",
  saving: "Saving profile…",
  failed: "Profile could not be saved.",
  failedHelp:
    "Your draft is still here. Try again when the connection is available.",
  retry: "Try again",
  readOnlyHelp:
    "You can review this profile, but you cannot edit it in this state.",
  choices: "Choose, then act",
  choicesUse:
    "Selected values describe a draft. The commit action has its own emphasis and name.",
  recipients: "Meeting audience",
  tutors: "Tutors",
  crew: "Crew",
  confirmAudience: "Use this audience",
  audienceSaved: "Example audience updated.",
  notifications: "Email reminders",
  notificationsHelp: "This switch updates immediately within the example.",
  navigate: "Navigate a section",
  navigateUse:
    "Tabs change the visible panel. Arrow keys move focus; Enter or Space activates a tab without saving a draft.",
  tabs: "Example editor sections",
  details: "Details",
  preview: "Preview",
  detailsText:
    "Edit a section, then review its preview. Tab changes do not submit the form.",
  previewText: "Preview: an orientation meeting for the selected audience.",
  review: "Review a consequence",
  reviewUse:
    "Name the affected record and what will happen. Keep the safe action available and return focus to the trigger.",
  open: "Review archive action",
  modalTitle: "Archive orientation meeting?",
  modalDescription:
    "This example meeting moves to the archive. Its attendance history is retained.",
  modalBody: "Orientation meeting · Friday, 16:00 · Room 204",
  archive: "Archive meeting",
  archived: "Example meeting archived.",
  records: "Manage records",
  recordsUse:
    "Keep only brief information in columns. Put full details and editors in dialogs, opened by text links in the rightmost column. This rule also applies on mobile.",
  viewDetails: "View details",
  close: "Close",
  recordNotes:
    "Introduce the tutoring programme, review attendance expectations and meet the team. Bring questions about your availability and assigned subjects.",
  meeting: "Meeting",
  time: "Time",
  room: "Room",
  status: "Status",
  action: "Action",
  scheduled: "Scheduled",
  archiveStatus: "Archived",
  orientation: "Orientation meeting",
  friday: "Friday, 16:00",
  matrix: "Compare a matrix",
  matrixUse:
    "Compare brief values in the cells. Keep full schedule information behind the same rightmost View details link.",
  matrixLabel: "Example room availability",
  matrixHint:
    "Scroll horizontally to compare all time slots. Keyboard: focus the table region and use the arrow keys.",
  slot: "Time slot",
  available: "Available",
  booked: "Booked",
  recover: "Explain the current state",
  recoverUse:
    "Loading, no results, failures and denied access need different explanations. Provide a useful next action when one exists.",
  loadingTitle: "Loading meetings…",
  loadingBody: "Checking the latest schedule.",
  emptyTitle: "No meetings yet",
  emptyBody: "Create a meeting when the team is ready.",
  deniedTitle: "Editing access required",
  deniedBody: "Your current role can view records but cannot edit them.",
  errorTitle: "Schedule could not be loaded",
  errorBody: "Check the connection and try loading it again.",
  recoveryDone: "Example schedule loaded. There are no meetings yet.",
  implementation: "Implementation",
  usage: "Pattern guidance",
};
const zh: Record<keyof typeof en, string> = {
  badge: "开发环境 · 示例数据",
  title: "界面模式画廊",
  intro:
    "用于编辑、选择、审核和错误恢复的可复用组件。这些示例与实际应用使用同一套组件。",
  locale: "示例语言",
  theme: "主题强调色",
  state: "表单状态",
  normal: "可编辑",
  pending: "保存中",
  error: "保存失败",
  readonly: "只读",
  viewport:
    "调整浏览器窗口大小以查看真实的响应式布局。宽度低于 1024 像素时，控件保留触控区域，最右侧操作列保持可用。",
  scope: "所有修改仅保存在本页中。刷新可重置示例；不会更改实际项目记录。",
  edit: "编辑一个分区",
  editUse: "用于一起保存的相关字段。将操作行放在所有相关字段之后。",
  profile: "个人资料姓名",
  profileHelp: "保存此分区时将同时保存两个姓名字段。",
  name: "显示姓名",
  otherName: "其他语言姓名（可选）",
  save: "保存个人资料",
  cancel: "取消",
  saved: "已在本示例中保存个人资料。",
  saving: "正在保存个人资料…",
  failed: "无法保存个人资料。",
  failedHelp: "草稿仍保留在此处。连接恢复后请重试。",
  retry: "重试",
  readOnlyHelp: "在此状态下，您可以查看个人资料，但无法编辑。",
  choices: "先选择，再执行",
  choicesUse: "选中值表示草稿内容。提交操作有独立的视觉强调和明确名称。",
  recipients: "会议参加人员",
  tutors: "辅导伙伴",
  crew: "工作人员",
  confirmAudience: "使用所选参加人员",
  audienceSaved: "已更新示例参加人员。",
  notifications: "邮件提醒",
  notificationsHelp: "此开关会立即更新示例中的设置。",
  navigate: "切换分区",
  navigateUse:
    "选项卡切换显示面板。方向键移动焦点；回车或空格激活选项卡，不会保存草稿。",
  tabs: "示例编辑器分区",
  details: "详细信息",
  preview: "预览",
  detailsText: "编辑分区后查看预览。切换选项卡不会提交表单。",
  previewText: "预览：面向所选参加人员的新成员介绍会议。",
  review: "确认操作后果",
  reviewUse:
    "明确说明受影响的记录和操作结果。保留安全操作，关闭后将焦点返回触发按钮。",
  open: "查看归档确认",
  modalTitle: "归档新成员介绍会议？",
  modalDescription: "此示例会议将移入归档，出勤历史仍会保留。",
  modalBody: "新成员介绍会议 · 周五 16:00 · 204 教室",
  archive: "归档会议",
  archived: "已归档示例会议。",
  records: "管理记录",
  recordsUse:
    "列中只显示简要信息。详细内容和编辑表单放在弹窗中，通过最右侧的文字链接打开。手机端也使用相同规则。",
  viewDetails: "查看详情",
  close: "关闭",
  recordNotes:
    "介绍同伴辅导项目、说明出勤要求并认识团队。请准备好有关可用时间和辅导科目的问题。",
  meeting: "会议",
  time: "时间",
  room: "教室",
  status: "状态",
  action: "操作",
  scheduled: "已安排",
  archiveStatus: "已归档",
  orientation: "新成员介绍会议",
  friday: "周五 16:00",
  matrix: "比较矩阵",
  matrixUse:
    "单元格中保留简短对比值，完整安排通过最右侧统一的“查看详情”链接打开。",
  matrixLabel: "示例教室可用时间",
  matrixHint:
    "横向滚动以比较全部时段。键盘操作：聚焦表格区域，然后使用方向键。",
  slot: "时段",
  available: "可用",
  booked: "已预订",
  recover: "解释当前状态",
  recoverUse:
    "加载中、无结果、失败和无访问权限需要不同说明。在适当情况下提供有效的下一步操作。",
  loadingTitle: "正在加载会议…",
  loadingBody: "正在检查最新日程。",
  emptyTitle: "暂无会议",
  emptyBody: "团队准备好后即可创建会议。",
  deniedTitle: "需要编辑权限",
  deniedBody: "您当前的角色可以查看记录，但无法编辑。",
  errorTitle: "无法加载日程",
  errorBody: "请检查连接并重新加载。",
  recoveryDone: "示例日程已加载，目前暂无会议。",
  implementation: "实现组件",
  usage: "模式说明",
};

type ExampleState = "normal" | "pending" | "error" | "readonly";

function Example({
  number,
  title,
  description,
  components,
  children,
}: {
  number: string;
  title: string;
  description: string;
  components: string;
  children: ReactNode;
}) {
  return (
    <section className="card min-w-0 space-y-5 p-5 sm:p-6">
      <header className="space-y-2 border-b border-slate-100 pb-4">
        <p className="text-accent-700 text-xs font-semibold tracking-widest">
          {number}
        </p>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm leading-6 text-slate-600">{description}</p>
        <code className="block text-xs break-words text-slate-500">
          {components}
        </code>
      </header>
      {children}
    </section>
  );
}

/** A living component catalogue: state is local, and no example imports application mutations. */
export function UIGallery() {
  const [locale, setLocale] = useState<"en" | "zh">("en");
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [state, setState] = useState<ExampleState>("normal");
  const [draft, setDraft] = useState({
    name: "Alex Chen",
    otherName: "陈同学",
  });
  const [savedDraft, setSavedDraft] = useState(draft);
  const [saved, setSaved] = useState(false);
  const [audience, setAudience] = useState("tutors");
  const [audienceSaved, setAudienceSaved] = useState(false);
  const [reminders, setReminders] = useState(true);
  const [tab, setTab] = useState<"details" | "preview">("details");
  const [dialog, setDialog] = useState(false);
  const [archived, setArchived] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const t = locale === "en" ? en : zh;
  const pending = state === "pending";
  const readOnly = state === "readonly";

  // Preview the actual root tokens, restoring the visitor's theme on exit without changing cookies.
  useEffect(() => {
    const original = document.documentElement.dataset.theme;
    return () => {
      if (original === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = original;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const openDialog = () => setDialog(true);
  const recordStatus = archived ? t.archiveStatus : t.scheduled;

  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={{ tablePatterns: { details: t.viewDetails, close: t.close } }}
    >
      <main
        lang={locale === "zh" ? "zh-CN" : "en"}
        className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:py-12"
      >
        <header className="max-w-3xl space-y-3">
          <p className="text-accent-700 text-sm font-semibold">{t.badge}</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t.title}
          </h1>
          <p className="text-base leading-7 text-slate-600">{t.intro}</p>
          <p className="text-sm text-slate-500">{t.scope}</p>
        </header>

        <section aria-label={t.usage} className="card space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm font-medium">
              {t.locale}
              <select
                className="select"
                value={locale}
                onChange={(event) =>
                  setLocale(event.target.value === "zh" ? "zh" : "en")
                }
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              {t.theme}
              <select
                className="select capitalize"
                value={theme}
                onChange={(event) => {
                  if (isTheme(event.target.value)) setTheme(event.target.value);
                }}
              >
                {THEMES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              {t.state}
              <select
                className="select"
                value={state}
                onChange={(event) => {
                  setState(event.target.value as ExampleState);
                  setSaved(false);
                }}
              >
                {(["normal", "pending", "error", "readonly"] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {t[value]}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <p className="text-sm leading-6 text-slate-500">{t.viewport}</p>
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Example
            number="01"
            title={t.edit}
            description={t.editUse}
            components="FormSection · Button · StatePanel"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (pending || readOnly) return;
                if (state === "error") return;
                setSavedDraft(draft);
                setSaved(true);
              }}
            >
              <FormSection
                title={t.profile}
                description={t.profileHelp}
                busy={pending}
                actions={
                  <>
                    <Button variant="primary" type="submit" disabled={readOnly}>
                      {pending ? t.saving : t.save}
                    </Button>
                    <Button
                      disabled={readOnly}
                      onClick={() => {
                        setDraft(savedDraft);
                        setState("normal");
                        setSaved(false);
                      }}
                    >
                      {t.cancel}
                    </Button>
                  </>
                }
              >
                <label className="block space-y-2 text-sm font-medium">
                  {t.name}
                  <input
                    className="input"
                    required
                    readOnly={readOnly}
                    value={draft.name}
                    onChange={(event) => {
                      setDraft({ ...draft, name: event.target.value });
                      setSaved(false);
                    }}
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  {t.otherName}
                  <input
                    className="input"
                    readOnly={readOnly}
                    value={draft.otherName}
                    onChange={(event) => {
                      setDraft({ ...draft, otherName: event.target.value });
                      setSaved(false);
                    }}
                  />
                </label>
              </FormSection>
            </form>
            {pending && <StatePanel kind="loading" title={t.saving} />}
            {state === "error" && (
              <StatePanel
                kind="error"
                title={t.failed}
                action={
                  <Button onClick={() => setState("normal")}>{t.retry}</Button>
                }
              >
                {t.failedHelp}
              </StatePanel>
            )}
            {readOnly && (
              <StatePanel kind="denied" title={t.readonly}>
                {t.readOnlyHelp}
              </StatePanel>
            )}
            {saved && (
              <p role="status" className="text-sm text-emerald-800">
                {t.saved}
              </p>
            )}
          </Example>

          <div className="min-w-0 space-y-6">
            <Example
              number="02"
              title={t.choices}
              description={t.choicesUse}
              components="ChoiceButton · Switch · Button"
            >
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">
                  {t.recipients}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(["tutors", "crew"] as const).map((value) => (
                    <ChoiceButton
                      key={value}
                      selected={audience === value}
                      onClick={() => {
                        setAudience(value);
                        setAudienceSaved(false);
                      }}
                    >
                      {t[value]}
                    </ChoiceButton>
                  ))}
                </div>
                <Button
                  variant="primary"
                  onClick={() => setAudienceSaved(true)}
                >
                  {t.confirmAudience}
                </Button>
              </fieldset>
              {audienceSaved && (
                <p role="status" className="text-sm text-emerald-800">
                  {t.audienceSaved}
                </p>
              )}
              <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
                <div>
                  <p className="text-sm font-semibold">{t.notifications}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {t.notificationsHelp}
                  </p>
                </div>
                <Switch
                  label={t.notifications}
                  checked={reminders}
                  onChange={setReminders}
                />
              </div>
            </Example>
            <Example
              number="03"
              title={t.navigate}
              description={t.navigateUse}
              components="SectionTabs"
            >
              <SectionTabs
                label={t.tabs}
                items={[
                  { value: "details", label: t.details },
                  { value: "preview", label: t.preview },
                ]}
                value={tab}
                onChange={setTab}
              >
                <p className="text-sm leading-6 text-slate-600">
                  {tab === "details" ? t.detailsText : t.previewText}
                </p>
              </SectionTabs>
            </Example>
          </div>

          <Example
            number="04"
            title={t.review}
            description={t.reviewUse}
            components="Modal · Button"
          >
            <p className="text-sm font-medium">{t.modalBody}</p>
            <Button onClick={openDialog}>{t.open}</Button>
            {archived && (
              <p role="status" className="text-sm text-emerald-800">
                {t.archived}
              </p>
            )}
          </Example>

          <Example
            number="05"
            title={t.records}
            description={t.recordsUse}
            components="SummaryTable · TableActions · TableDetails"
          >
            <SummaryTable label={t.records}>
              <caption className="sr-only">{t.records}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.meeting}</th>
                  <th scope="col">{t.status}</th>
                  <th scope="col" className="table-actions-heading">
                    {t.action}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <p className="font-medium">{t.orientation}</p>
                  </td>
                  <td>{recordStatus}</td>
                  <TableActions>
                    <TableDetails title={t.orientation}>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <dt className="muted">{t.time}</dt>
                          <dd>{t.friday}</dd>
                        </div>
                        <div>
                          <dt className="muted">{t.room}</dt>
                          <dd>204</dd>
                        </div>
                      </dl>
                      <p>{t.recordNotes}</p>
                    </TableDetails>
                    <TableAction onClick={openDialog}>{t.open}</TableAction>
                  </TableActions>
                </tr>
              </tbody>
            </SummaryTable>
          </Example>

          <Example
            number="06"
            title={t.matrix}
            description={t.matrixUse}
            components="SummaryTable · TableDetails"
          >
            <p className="muted text-xs">{t.matrixHint}</p>
            <SummaryTable label={t.matrixLabel}>
              <caption className="sr-only">{t.matrixLabel}</caption>
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="p-3">
                    {t.slot}
                  </th>
                  {["204", "205", "206"].map((room) => (
                    <th scope="col" key={room} className="p-3">
                      {t.room} {room}
                    </th>
                  ))}
                  <th scope="col" className="table-actions-heading">
                    {t.action}
                  </th>
                </tr>
              </thead>
              <tbody>
                {["15:00", "16:00", "17:00"].map((time, index) => (
                  <tr key={time} className="border-b border-slate-100">
                    <th scope="row" className="p-3 font-medium">
                      {time}
                    </th>
                    {[0, 1, 2].map((room) => (
                      <td key={room} className="p-3 text-slate-600">
                        {index === room ? t.booked : t.available}
                      </td>
                    ))}
                    <TableActions>
                      <TableDetails title={`${t.slot} ${time}`}>
                        <p>
                          {t.room} {204 + index} · {t.orientation}
                        </p>
                        <p>{t.recordNotes}</p>
                      </TableDetails>
                    </TableActions>
                  </tr>
                ))}
              </tbody>
            </SummaryTable>
          </Example>

          <Example
            number="07"
            title={t.recover}
            description={t.recoverUse}
            components="StatePanel · Button"
          >
            <div className="space-y-3">
              <StatePanel kind="loading" title={t.loadingTitle}>
                {t.loadingBody}
              </StatePanel>
              <StatePanel kind="empty" title={t.emptyTitle}>
                {t.emptyBody}
              </StatePanel>
              <StatePanel kind="denied" title={t.deniedTitle}>
                {t.deniedBody}
              </StatePanel>
              {recovered ? (
                <StatePanel kind="empty" title={t.recoveryDone} />
              ) : (
                <StatePanel
                  kind="error"
                  title={t.errorTitle}
                  action={
                    <Button onClick={() => setRecovered(true)}>
                      {t.retry}
                    </Button>
                  }
                >
                  {t.errorBody}
                </StatePanel>
              )}
            </div>
          </Example>
        </div>

        {dialog && (
          <Modal
            title={t.modalTitle}
            description={t.modalDescription}
            onClose={() => setDialog(false)}
            footer={
              <>
                <Button data-dialog-autofocus onClick={() => setDialog(false)}>
                  {t.cancel}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setArchived(true);
                    setDialog(false);
                  }}
                >
                  {t.archive}
                </Button>
              </>
            }
          >
            <p className="text-sm text-slate-600">{t.modalBody}</p>
          </Modal>
        )}
      </main>
    </NextIntlClientProvider>
  );
}
