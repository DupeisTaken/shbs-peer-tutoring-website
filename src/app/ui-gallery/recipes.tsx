"use client";

import { NavigationRecipes } from "./navigation-recipes";
import { ActionReviewRecipe } from "./action-review-recipe";
import { useEffect, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";
import { PersonNameFields } from "~/app/_components/person-name-fields";
import { FieldRequirement } from "~/app/_components/field-requirement";
import { OfferedGradeSelect } from "~/app/_components/profile-policy";
import { AcademicDetails } from "~/app/_components/academic-profile";
import { ApprovalReviewDetails } from "~/app/_components/approval-review-details";
import { PublicFormCard } from "~/app/_components/public-form-page";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import { ProfileEditSection } from "~/app/_components/profile-edit-section";
import { CurrentPolicyDialog } from "~/app/_components/current-policy-dialog";
import { Button, ChoiceButton, Switch } from "~/app/_components/ui/button";
import { Modal, useDialogPending } from "~/app/_components/ui/modal";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";
import {
  ChangeReview,
  FilterToolbar,
  FormActions,
  FormSection,
  InlineNotice,
  SettingRow,
} from "~/app/_components/ui/patterns";

const en = {
  long: "Long forms and readers",
  longHelp:
    "Wide forms retain a sticky Close header. Readers scroll their document independently. A child review owns Escape and returns focus to its opener.",
  openLong: "Open wide participant editor",
  openReader: "Open policy reader",
  policy: "Example programme policy",
  policyBody:
    "## Attendance\n\nTell the programme team when your availability changes.\n\n## Records\n\nAttendance history remains available for review.",
  editor: "Participant editor example",
  draft: "Draft note",
  child: "Review participant change",
  childHelp:
    "This review is nested inside the participant editor. Closing it preserves the editor draft.",
  cancel: "Cancel review",
  failSave: "Simulate a failed save",
  otherSection: "Independent profile section",
  otherDraft: "Independent profile draft",
  saveOther: "Save the other section",
  saving: "Saving example…",
  failed: "The example save failed. Your draft is retained.",
  participant: "Participant form",
  participantHelp:
    "Compose the existing four-part names, field requirements and offered grades. The state selector above controls editable, pending, failure and read-only examples.",
  identity: "Participant identity",
  grade: "Grade",
  save: "Save participant",
  saved: "Participant saved in this example.",
  readOnly: "This participant example is read only.",
  academic: "Academic summary",
  publicCard: "Public form card",
  publicHelp:
    "Public signup and history claim reuse PublicFormPage, PublicPageNavigation and PublicFormCard. Their route and consent requirements remain in each feature.",
  filters: "Filter toolbar",
  filtersHelp:
    "Pressed choices filter records. Native search and selects keep their keyboard behavior; reset and counts belong to the feature.",
  search: "Search rooms",
  all: "All rooms",
  active: "Active rooms",
  reset: "Reset filters",
  matches: "Matching rooms",
  none: "No rooms match these filters.",
  disclosure: "Disclosure lifetimes",
  disclosureHelp:
    "Retained content mounts on first open and preserves drafts after collapse. Query-only details mount on demand. Existing creation forms can stay mounted from the start.",
  retained: "Retained draft",
  lazy: "On-demand details",
  lazyText: "These read-only details exist only while this disclosure is open.",
  settings: "Setting rows",
  settingsHelp:
    "Binary switches apply immediately. Unknown willingness is distinct from No. Staged checkboxes wait for Save.",
  reminders: "Example reminders",
  immediate: "Applies immediately in this local example.",
  willing: "Example willingness",
  unknown: "No answer recorded",
  yes: "Yes",
  no: "No",
  staged: "Display preferred names",
  saveSettings: "Save display setting",
  settingSaved: "Display setting saved in this example.",
  review: "Preview and change review",
  reviewHelp:
    "Reuse saved before/after evidence and feature-owned acknowledgement. Changing the proposed name clears the preview and its acknowledgement.",
  proposed: "Requested room name",
  quiet: "Quiet study",
  science: "Science room",
  prepare: "Prepare example review",
  reviewTitle: "Review room name",
  consequence:
    "Only the room name changes in this example. Bookings are retained.",
  acknowledge: "I reviewed this example change",
  apply: "Apply example change",
  applied: "Example room name changed.",
  notices: "Inline feedback with a retained draft",
  noticesHelp:
    "Background failure stays alongside usable content. Retry refreshes the status without replacing the draft. Initial failures still use StatePanel.",
  refresh: "Simulate background failure",
  refreshFailed:
    "The background refresh failed; your current draft is still available.",
  retry: "Retry refresh",
  refreshed: "Example refresh completed; your draft is unchanged.",
};
const zh: Record<keyof typeof en, string> = {
  long: "长表单与阅读弹窗",
  longHelp:
    "宽表单保留固定关闭标题栏。阅读器正文独立滚动。子审核弹窗处理 Escape，关闭后焦点返回打开按钮。",
  openLong: "打开宽版参与者编辑器",
  openReader: "打开政策阅读器",
  policy: "示例项目政策",
  policyBody:
    "## 出勤\n\n可用时间发生变化时，请通知项目团队。\n\n## 记录\n\n出勤历史始终保留供查阅。",
  editor: "参与者编辑器示例",
  draft: "草稿备注",
  child: "审核参与者更改",
  childHelp: "此审核嵌套在参与者编辑器中。关闭审核会保留编辑器草稿。",
  cancel: "取消审核",
  failSave: "模拟保存失败",
  otherSection: "独立个人资料部分",
  otherDraft: "独立个人资料草稿",
  saveOther: "保存另一部分",
  saving: "正在保存示例…",
  failed: "示例保存失败，草稿已保留。",
  participant: "参与者表单",
  participantHelp:
    "组合现有的四部分姓名、字段要求和可选年级。上方状态选择器可查看编辑、保存中、失败和只读状态。",
  identity: "参与者身份信息",
  grade: "年级",
  save: "保存参与者",
  saved: "已在本示例中保存参与者。",
  readOnly: "此参与者示例为只读。",
  academic: "学业摘要",
  publicCard: "公开表单卡片",
  publicHelp:
    "公开报名与历史认领共用 PublicFormPage、PublicPageNavigation 和 PublicFormCard。路由及同意要求仍由各功能负责。",
  filters: "筛选工具栏",
  filtersHelp:
    "按下的选项筛选记录。原生搜索与选择框保留键盘操作；重置和计数由功能负责。",
  search: "搜索教室",
  all: "所有教室",
  active: "启用的教室",
  reset: "重置筛选",
  matches: "匹配的教室",
  none: "没有符合筛选条件的教室。",
  disclosure: "展开区域的生命周期",
  disclosureHelp:
    "保留型内容首次打开后会保留，折叠不会丢失草稿。只读详情按需挂载，现有创建表单可从一开始保持挂载。",
  retained: "保留草稿",
  lazy: "按需详情",
  lazyText: "这些只读详情仅在展开此区域时挂载。",
  settings: "设置行",
  settingsHelp:
    "二元开关立即应用。未填写意愿与“否”不同。暂存复选框在保存后才生效。",
  reminders: "示例提醒",
  immediate: "立即应用到本地示例。",
  willing: "示例意愿",
  unknown: "尚未记录回答",
  yes: "是",
  no: "否",
  staged: "显示偏好姓名",
  saveSettings: "保存显示设置",
  settingSaved: "已在本示例中保存显示设置。",
  review: "预览与更改审核",
  reviewHelp:
    "复用已保存的前后对照以及功能负责的确认。修改拟用名称会清除预览与确认。",
  proposed: "拟用教室名称",
  quiet: "安静自习室",
  science: "科学教室",
  prepare: "准备示例审核",
  reviewTitle: "审核教室名称",
  consequence: "本示例仅更改教室名称，预约保留不变。",
  acknowledge: "我已审核此示例更改",
  apply: "应用示例更改",
  applied: "示例教室名称已更改。",
  notices: "保留草稿的行内反馈",
  noticesHelp:
    "后台失败显示在可用内容旁。重试仅刷新状态，不替换草稿。首次加载失败仍使用 StatePanel。",
  refresh: "模拟后台失败",
  refreshFailed: "后台刷新失败，当前草稿仍保留。",
  retry: "重试刷新",
  refreshed: "示例刷新完成，草稿未改变。",
};
type Copy = typeof en;

function Recipe({
  title,
  help,
  components,
  children,
}: {
  title: string;
  help: string;
  components: string;
  children: ReactNode;
}) {
  return (
    <section className="card min-w-0 space-y-5 p-5 sm:p-6">
      <header className="space-y-2 border-b border-slate-100 pb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {/* Component names in explanatory copy must wrap even at enlarged text sizes. */}
        <p className="text-sm leading-6 wrap-break-word text-slate-600">
          {help}
        </p>
        <code className="block text-xs break-words text-slate-500">
          {components}
        </code>
      </header>
      {children}
    </section>
  );
}

function DraftNote({ label }: { label: string }) {
  const [note, setNote] = useState("");
  return (
    <label className="block space-y-2 text-sm font-medium">
      {label}
      <input
        className="input"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </label>
  );
}

function DialogDraft({ t }: { t: Copy }) {
  const [review, setReview] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [otherSaved, setOtherSaved] = useState(false);
  const [otherPending, setOtherPending] = useState(false);
  const busy = useDialogPending(pending || otherPending);
  useEffect(() => {
    if (!otherPending) return;
    // Production saves await an authorized fresh snapshot before re-enabling
    // their own fields. This local timer demonstrates that same lifetime.
    const timer = setTimeout(() => {
      setOtherPending(false);
      setOtherSaved(true);
    }, 600);
    return () => clearTimeout(timer);
  }, [otherPending]);
  // Demonstration only; cancelled on unmount and never connected to a mutation.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setPending(false);
      setFailed(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [pending]);
  return (
    <div className="space-y-5">
      <fieldset disabled={busy} className="space-y-4">
        <DraftNote label={t.draft} />
        <FormActions>
          <Button onClick={() => setReview(true)}>{t.child}</Button>
          <Button
            variant="primary"
            onClick={() => {
              setFailed(false);
              setPending(true);
            }}
          >
            {pending ? t.saving : t.failSave}
          </Button>
        </FormActions>
      </fieldset>
      {failed && (
        <InlineNotice tone="error" announcement="alert">
          {t.failed}
        </InlineNotice>
      )}
      <div onChangeCapture={() => setOtherSaved(false)}>
        <ProfileEditSection
          title={t.otherSection}
          busy={otherPending}
          saved={otherSaved}
          readOnly={false}
          actions={
            <Button
              onClick={() => {
                if (!busy) setOtherPending(true);
              }}
            >
              {t.saveOther}
            </Button>
          }
        >
          <DraftNote label={t.otherDraft} />
        </ProfileEditSection>
      </div>
      {review && (
        <Modal
          title={t.child}
          description={t.childHelp}
          onClose={() => setReview(false)}
          footer={
            <Button data-dialog-autofocus onClick={() => setReview(false)}>
              {t.cancel}
            </Button>
          }
        >
          <AcademicDetails />
        </Modal>
      )}
    </div>
  );
}

/** Executable compositions use real domain presentation; all state is local and
 * no preview imports a server mutation or supplies production authorization. */
export function RecipeGallery({
  locale,
  state,
}: {
  locale: "en" | "zh";
  state: "normal" | "pending" | "error" | "readonly";
}) {
  const t = locale === "en" ? en : zh;
  const [dialog, setDialog] = useState<"editor" | "reader" | null>(null);
  const [name, setName] = useState({
    firstName: "Alex",
    lastName: "Chen",
    preferredName: "",
    alternativeNames: "陈同学",
  });
  const [grade, setGrade] = useState("10");
  const [participantSaved, setParticipantSaved] = useState(false);
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [reminders, setReminders] = useState(true);
  const [willingness, setWillingness] = useState<boolean | null>(null);
  const [displayNames, setDisplayNames] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [proposed, setProposed] = useState("quiet");
  const [preview, setPreview] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [applied, setApplied] = useState(false);
  const [refresh, setRefresh] = useState<"idle" | "failed" | "ready">("idle");
  const rooms = [
    { name: t.quiet, active: true },
    { name: t.science, active: false },
  ].filter(
    (room) =>
      (!activeOnly || room.active) &&
      room.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="Asia/Shanghai"
      messages={locale === "en" ? enMessages : zhMessages}
    >
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ActionReviewRecipe />
        <Recipe
          title={t.long}
          help={t.longHelp}
          components="NativeDialog · ProfileDialog · CurrentPolicyDialog · useDialogPending"
        >
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialog("editor")}>{t.openLong}</Button>
            <Button onClick={() => setDialog("reader")}>{t.openReader}</Button>
          </div>
        </Recipe>
        <Recipe
          title={t.participant}
          help={t.participantHelp}
          components="PersonNameFields · FieldRequirement · OfferedGradeSelect · FormSection · AcademicDetails"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (state === "normal") setParticipantSaved(true);
            }}
          >
            <FormSection
              title={t.identity}
              busy={state === "pending"}
              actions={
                <Button
                  type="submit"
                  variant="primary"
                  disabled={state === "readonly"}
                >
                  {state === "pending" ? t.saving : t.save}
                </Button>
              }
            >
              <fieldset
                disabled={state === "readonly"}
                className="min-w-0 space-y-4"
              >
                <div className="max-w-2xl">
                  <PersonNameFields
                    value={name}
                    onChange={(value) => {
                      setName(value);
                      setParticipantSaved(false);
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="recipe-grade" className="label">
                    {t.grade}
                    <FieldRequirement state="required" />
                  </label>
                  <OfferedGradeSelect
                    id="recipe-grade"
                    value={grade}
                    onChange={(value) => {
                      setGrade(value);
                      setParticipantSaved(false);
                    }}
                    offeredGrades={[9, 10, 11, 12]}
                    required
                  />
                </div>
              </fieldset>
            </FormSection>
          </form>
          {state === "error" && (
            <InlineNotice tone="error" announcement="alert">
              {t.failed}
            </InlineNotice>
          )}
          {state === "readonly" && <InlineNotice>{t.readOnly}</InlineNotice>}
          {participantSaved && state === "normal" && (
            <InlineNotice tone="success" announcement="status">
              {t.saved}
            </InlineNotice>
          )}
          <DisclosureSection title={t.academic} lifetime="lazy">
            <AcademicDetails />
          </DisclosureSection>
        </Recipe>
        <Recipe
          title={t.filters}
          help={t.filtersHelp}
          components="FilterToolbar · ChoiceButton · native input · Button compact"
        >
          <FilterToolbar
            label={t.filters}
            summary={`${t.matches}: ${rooms.length}`}
            actions={
              <Button
                size="compact"
                onClick={() => {
                  setSearch("");
                  setActiveOnly(false);
                }}
              >
                {t.reset}
              </Button>
            }
          >
            <label className="min-w-0 flex-1 space-y-2 text-sm font-medium">
              {t.search}
              <input
                className="input lg:min-h-8 lg:py-1"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <ChoiceButton
                selected={!activeOnly}
                onClick={() => setActiveOnly(false)}
              >
                {t.all}
              </ChoiceButton>
              <ChoiceButton
                selected={activeOnly}
                onClick={() => setActiveOnly(true)}
              >
                {t.active}
              </ChoiceButton>
            </div>
          </FilterToolbar>
          {rooms.length ? (
            <ul className="space-y-2 text-sm">
              {rooms.map((room) => (
                <li key={room.name} className="rounded-lg bg-slate-50 p-3">
                  {room.name}
                </li>
              ))}
            </ul>
          ) : (
            <InlineNotice>{t.none}</InlineNotice>
          )}
        </Recipe>
        <Recipe
          title={t.disclosure}
          help={t.disclosureHelp}
          components="DisclosureSection lifetime=retained | lazy | mounted"
        >
          <DisclosureSection title={t.retained} lifetime="retained">
            <DraftNote label={t.draft} />
          </DisclosureSection>
          <DisclosureSection title={t.lazy} lifetime="lazy">
            <p className="text-sm text-slate-600">{t.lazyText}</p>
          </DisclosureSection>
        </Recipe>
        <Recipe
          title={t.settings}
          help={t.settingsHelp}
          components="SettingRow · Switch · ChoiceButton standard · FormActions"
        >
          <SettingRow
            label={t.reminders}
            description={t.immediate}
            control={
              <Switch
                label={t.reminders}
                checked={reminders}
                onChange={setReminders}
              />
            }
          />
          <SettingRow
            label={t.willing}
            description={willingness === null ? t.unknown : undefined}
            control={
              <>
                <ChoiceButton
                  size="standard"
                  selected={willingness === true}
                  onClick={() => setWillingness(true)}
                >
                  {t.yes}
                </ChoiceButton>
                <ChoiceButton
                  size="standard"
                  selected={willingness === false}
                  onClick={() => setWillingness(false)}
                >
                  {t.no}
                </ChoiceButton>
              </>
            }
          />
          <form
            className="space-y-3 border-t border-slate-100 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              setSettingsSaved(true);
            }}
          >
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={displayNames}
                onChange={(event) => {
                  setDisplayNames(event.target.checked);
                  setSettingsSaved(false);
                }}
              />
              {t.staged}
            </label>
            <FormActions>
              <Button type="submit" variant="primary">
                {t.saveSettings}
              </Button>
            </FormActions>
            {settingsSaved && (
              <InlineNotice tone="success" announcement="status">
                {t.settingSaved}
              </InlineNotice>
            )}
          </form>
        </Recipe>
        <Recipe
          title={t.review}
          help={t.reviewHelp}
          components="ChangeReview · ApprovalReviewDetails · InlineNotice · FormActions"
        >
          <label className="block space-y-2 text-sm font-medium">
            {t.proposed}
            <select
              className="select"
              value={proposed}
              onChange={(event) => {
                setProposed(event.target.value);
                setPreview(null);
                setAcknowledged(false);
                setApplied(false);
              }}
            >
              <option value="quiet">{t.quiet}</option>
              <option value="science">{t.science}</option>
            </select>
          </label>
          <Button
            onClick={() => {
              setPreview(proposed === "quiet" ? t.quiet : t.science);
              setAcknowledged(false);
              setApplied(false);
            }}
          >
            {t.prepare}
          </Button>
          {preview && (
            <ChangeReview
              title={t.reviewTitle}
              evidence={
                <ApprovalReviewDetails
                  operation="admin.updateRoom"
                  payload={{ id: "example-room", name: preview }}
                  targets={{
                    Room: [{ record: { id: "example-room", name: "204" } }],
                  }}
                />
              }
              consequences={
                <InlineNotice tone="warning">{t.consequence}</InlineNotice>
              }
              acknowledgement={
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  {t.acknowledge}
                </label>
              }
              actions={
                <Button
                  variant="primary"
                  disabled={!acknowledged}
                  onClick={() => {
                    setApplied(true);
                    setPreview(null);
                    setAcknowledged(false);
                  }}
                >
                  {t.apply}
                </Button>
              }
            />
          )}
          {applied && (
            <InlineNotice tone="success" announcement="status">
              {t.applied}
            </InlineNotice>
          )}
        </Recipe>
        <Recipe
          title={t.notices}
          help={t.noticesHelp}
          components="InlineNotice · retained field state · explicit announcement"
        >
          <DraftNote label={t.draft} />
          <Button size="compact" onClick={() => setRefresh("failed")}>
            {t.refresh}
          </Button>
          {refresh === "failed" && (
            <InlineNotice
              tone="error"
              announcement="alert"
              action={
                <Button size="compact" onClick={() => setRefresh("ready")}>
                  {t.retry}
                </Button>
              }
            >
              {t.refreshFailed}
            </InlineNotice>
          )}
          {refresh === "ready" && (
            <InlineNotice tone="success" announcement="status">
              {t.refreshed}
            </InlineNotice>
          )}
        </Recipe>
        <Recipe
          title={t.publicCard}
          help={t.publicHelp}
          components="PublicFormPage · PublicPageNavigation · PublicFormCard · PublicFormRoute"
        >
          <div className="public-form">
            <PublicFormCard>
              <p className="text-sm wrap-break-word text-slate-700">
                {t.publicHelp}
              </p>
            </PublicFormCard>
          </div>
        </Recipe>
      </div>
      <NavigationRecipes locale={locale} />
      {dialog === "editor" && (
        <ProfileDialog
          title={t.editor}
          size="wide"
          onClose={() => setDialog(null)}
        >
          <DialogDraft t={t} />
        </ProfileDialog>
      )}
      {dialog === "reader" && (
        <CurrentPolicyDialog
          documents={[
            {
              locale,
              title: t.policy,
              body: t.policyBody,
              version: "Example 1",
            },
          ]}
          loading={false}
          error={false}
          onRetry={() => undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </NextIntlClientProvider>
  );
}
