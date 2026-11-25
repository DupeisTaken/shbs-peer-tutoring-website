"use client";

import { useId, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { DetailsAutoClose } from "~/app/_components/details-auto-close";
import { ChevronDownIcon } from "~/app/_components/icons";
import {
  ActiveFilterChips,
  MultiFilter,
} from "~/app/_components/multi-filter";
import {
  CheckboxListbox,
  type CheckboxListboxOption,
} from "~/app/_components/ui/checkbox-listbox";
import { FilterToolbar } from "~/app/_components/ui/patterns";
import type { Selection } from "~/lib/user-filters";

/**
 * Interactive selector gallery covering the shared `.select` hierarchy, compact
 * content-sized toolbar selects, error/disabled states, sculpted `.popover-surface`
 * dropdown menus, and `CheckboxListbox` for short and long multi-select lists.
 */
export function SelectorRecipe({ locale }: { locale: "en" | "zh" }) {
  const zh = locale === "zh";
  const [course, setCourse] = useState("ap-calc-bc");
  const [period, setPeriod] = useState("spring");
  const [status, setStatus] = useState("active");
  const [requiredChoice, setRequiredChoice] = useState("");
  const [days, setDays] = useState<string[]>(["mon", "wed"]);
  const [catalogCourses, setCatalogCourses] = useState<string[]>([
    "ap-calc-bc",
    "hon-phys",
    "ap-csa",
    "hon-chem",
    "eng-11",
  ]);
  const [menuChoice, setMenuChoice] = useState("management");
  const [roleFilter, setRoleFilter] = useState<Selection>({
    include: ["TUTOR", "COORDINATOR"],
    exclude: [],
  });
  const [accountFilter, setAccountFilter] = useState<Selection>({
    include: [],
    exclude: ["none"],
  });
  const errorId = useId();

  const invalid = requiredChoice === "";

  const menuGroups = [
    {
      key: "workspaces",
      title: zh ? "工作区" : "Workspaces",
      items: [
        { id: "management", label: zh ? "管理后台" : "Management" },
        { id: "tutor", label: zh ? "辅导伙伴工作区" : "Tutor Workspace" },
        { id: "tutee", label: zh ? "学习伙伴工作区" : "Tutee Workspace" },
      ],
    },
    {
      key: "general",
      title: zh ? "通用" : "General",
      items: [
        { id: "home", label: zh ? "项目主页" : "Program Home" },
        { id: "help", label: zh ? "帮助中心" : "Help Center" },
      ],
    },
  ];

  const selectedMenuLabel =
    menuGroups
      .flatMap((group) => group.items)
      .find((item) => item.id === menuChoice)?.label ?? "";

  const dayOptions: CheckboxListboxOption[] = [
    { value: "mon", label: zh ? "星期一" : "Monday" },
    { value: "tue", label: zh ? "星期二" : "Tuesday" },
    { value: "wed", label: zh ? "星期三" : "Wednesday" },
    { value: "thu", label: zh ? "星期四" : "Thursday" },
  ];

  const longCourseOptions: CheckboxListboxOption[] = [
    {
      value: "ap-calc-ab",
      label: zh ? "AP 微积分 AB" : "AP Calculus AB",
      group: "AP",
    },
    {
      value: "ap-calc-bc",
      label: zh
        ? "AP 微积分 BC（含晚自习答疑与考前专题冲刺）"
        : "AP Calculus BC (with extended evening review sessions)",
      group: "AP",
    },
    {
      value: "ap-phys-c",
      label: zh ? "AP 物理 C：力学" : "AP Physics C: Mechanics",
      group: "AP",
    },
    {
      value: "ap-chem",
      label: zh ? "AP 化学" : "AP Chemistry",
      group: "AP",
    },
    {
      value: "ap-bio",
      label: zh ? "AP 生物" : "AP Biology",
      group: "AP",
    },
    {
      value: "ap-csa",
      label: zh ? "AP 计算机科学 A" : "AP Computer Science A",
      group: "AP",
    },
    {
      value: "hon-phys",
      label: zh ? "荣誉物理" : "Honors Physics",
      group: zh ? "荣誉课程" : "Honors",
    },
    {
      value: "hon-chem",
      label: zh ? "荣誉化学" : "Honors Chemistry",
      group: zh ? "荣誉课程" : "Honors",
    },
    {
      value: "hon-precalc",
      label: zh ? "荣誉微积分预备" : "Honors Precalculus",
      group: zh ? "荣誉课程" : "Honors",
    },
    {
      value: "eng-11",
      label: zh ? "11 年级英语写作" : "Grade 11 English Composition",
      group: zh ? "基础课程" : "Core",
    },
  ];

  const listboxLabels = zh
    ? {
        selectedCount: (count: number) => `已选 ${count} 项`,
        clear: "清空",
        searchPlaceholder: "搜索选项…",
        searchLabel: "筛选选项",
        selectedOnly: "仅看已选",
        noMatches: "没有匹配的选项。",
        removeItem: (label: string) => `移除 ${label}`,
        moreSelected: (count: number) => `另有 ${count} 项`,
      }
    : undefined;

  return (
    <section
      id="selectors"
      className="card min-w-0 space-y-5 p-5 sm:p-6 lg:col-span-2"
    >
      <header className="space-y-2 border-b border-slate-100 pb-4">
        <h2 className="section-title">
          {zh ? "选择器、多选列表与下拉菜单" : "Selectors, multi-select listboxes and dropdown menus"}
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          {zh
            ? "单选下拉框使用统一的 .select 自定义箭头与内边距；工具栏使用 .select.control-compact 配合 field-auto（桌面端 32 px，触控端 44 px）；多选使用 CheckboxListbox 替代原生 <select multiple>（长列表自动提供限高滚动、本地搜索、仅看已选与已选摘要）；浮动菜单使用 .popover-surface。"
            : "Single-value native selects share the custom-chevron .select styling; toolbars pair .select.control-compact with field-auto (32 px desktop, >=44 px mobile); multi-select uses CheckboxListbox instead of raw <select multiple> (automatically adding bounded scroll, search, selected-only view and selection pills for long lists); floating menus use .popover-surface."}
        </p>
        <code className="block text-xs break-words text-slate-500">
          .select · .select.control-compact · field-auto · CheckboxListbox ·
          MultiFilter · .popover-surface · ChevronDownIcon · DetailsAutoClose
        </code>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <p className="eyebrow">
            {zh ? "表单与工具栏单选 (.select)" : "Form and toolbar selects (.select)"}
          </p>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>
              {zh
                ? "标准全宽表单选择（含长选项）"
                : "Standard full-width form select (long option)"}
            </span>
            <select
              className="select min-h-11 lg:min-h-10"
              value={course}
              onChange={(event) => setCourse(event.target.value)}
            >
              <option value="ap-calc-bc">
                {zh
                  ? "AP 微积分 BC · 高级辅导（含每周两次晚自习答疑与考前冲刺）"
                  : "AP Calculus BC · Advanced Peer Tutoring with Extended Exam Review"}
              </option>
              <option value="physics">
                {zh ? "荣誉物理" : "Honors Physics"}
              </option>
            </select>
          </label>

          <FilterToolbar
            label={zh ? "紧凑工具栏筛选示例" : "Compact toolbar filter example"}
          >
            <label className="min-w-0 max-w-full space-y-1 text-sm font-medium">
              <span className="label">{zh ? "学期" : "Term"}</span>
              <select
                className="select control-compact field-auto"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              >
                <option value="spring">{zh ? "春季学期" : "Spring"}</option>
                <option value="fall">{zh ? "秋季学期" : "Fall"}</option>
              </select>
            </label>
            <label className="min-w-0 max-w-full space-y-1 text-sm font-medium">
              <span className="label">{zh ? "状态" : "Status"}</span>
              <select
                className="select control-compact field-auto-bounded [--field-min-width:9rem]"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="active">{zh ? "启用中" : "Active"}</option>
                <option value="archived">{zh ? "已归档" : "Archived"}</option>
              </select>
            </label>
          </FilterToolbar>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{zh ? "禁用状态" : "Disabled state"}</span>
              <select className="select" disabled defaultValue="locked">
                <option value="locked">
                  {zh ? "已锁定（只读）" : "Locked (read-only)"}
                </option>
              </select>
            </label>
            <div className="space-y-1.5">
              <label className="block space-y-1.5 text-sm font-medium">
                <span>{zh ? "校验错误状态" : "Validation error state"}</span>
                <select
                  className="select"
                  value={requiredChoice}
                  aria-invalid={invalid ? "true" : undefined}
                  aria-describedby={invalid ? errorId : undefined}
                  onChange={(event) => setRequiredChoice(event.target.value)}
                >
                  <option value="">
                    {zh ? "请选择辅导教室…" : "Choose a room…"}
                  </option>
                  <option value="204">{zh ? "204 教室" : "Room 204"}</option>
                </select>
              </label>
              {invalid && (
                <p id={errorId} className="text-xs text-red-700">
                  {zh
                    ? "请先选择一个教室再继续。"
                    : "Select a room before continuing."}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-4">
            <p className="eyebrow">
              {zh ? "浮动菜单 (.popover-surface)" : "Floating menu (.popover-surface)"}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <details className="group relative">
                <DetailsAutoClose />
                <summary className="focus-visible:ring-accent-500 group-open:bg-accent-50 group-open:text-accent-800 group-open:ring-accent-200/80 inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-200/90 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 group-open:ring-1 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden lg:min-h-8 [&::-webkit-details-marker]:hidden">
                  <span>{selectedMenuLabel}</span>
                  <ChevronDownIcon className="group-open:text-accent-600 h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <nav
                  aria-label={zh ? "示例工作区菜单" : "Example workspace menu"}
                  className="popover-surface absolute left-0 z-30 mt-2 w-[min(15.5rem,calc(100vw-2rem))] p-1.5"
                >
                  <div className="divide-y divide-slate-100">
                    {menuGroups.map((group) => (
                      <div
                        key={group.key}
                        className="py-1 first:pt-0.5 last:pb-0.5"
                      >
                        <p className="px-2.5 pt-1 pb-1 text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">
                          {group.title}
                        </p>
                        <div className="grid gap-0.5">
                          {group.items.map((item) => {
                            const active = item.id === menuChoice;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={(event) => {
                                  setMenuChoice(item.id);
                                  event.currentTarget
                                    .closest("details")
                                    ?.removeAttribute("open");
                                }}
                                className={`focus-visible:ring-accent-500 flex min-h-11 w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition focus-visible:ring-2 focus-visible:outline-hidden lg:min-h-9 ${
                                  active
                                    ? "bg-accent-50 text-accent-800"
                                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                                }`}
                              >
                                <span className="min-w-0 truncate">
                                  {item.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </nav>
              </details>
              <p role="status" className="text-sm text-slate-600">
                {zh
                  ? `当前选择：${selectedMenuLabel}`
                  : `Selected: ${selectedMenuLabel}`}
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <p className="eyebrow">
            {zh
              ? "多选列表框 (CheckboxListbox — 短列表与超长分组列表)"
              : "Multi-select listbox (CheckboxListbox — short & long grouped lists)"}
          </p>

          <CheckboxListbox
            label={
              zh ? "短多选列表（无需搜索栏）" : "Short multi-select list (no search chrome)"
            }
            options={dayOptions}
            value={days}
            onChange={setDays}
            labels={listboxLabels}
          />

          <CheckboxListbox
            label={
              zh
                ? "超长分组列表（限高滚动 + 搜索 + 仅看已选 + 已选摘要）"
                : "Long grouped list (bounded scroll + search + selected-only + summary)"
            }
            options={longCourseOptions}
            value={catalogCourses}
            onChange={setCatalogCourses}
            maxVisibleSummary={3}
            labels={listboxLabels}
          />
        </div>
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-5">
        <p className="eyebrow">
          {zh
            ? "浮动包含 / 排除筛选器与已选标签 (MultiFilter + ActiveFilterChips)"
            : "Floating include / exclude filters & active chips (MultiFilter + ActiveFilterChips)"}
        </p>
        <p className="text-sm text-slate-600">
          {zh
            ? "点击筛选按钮打开浮动 .popover-surface 面板，在互斥的「包含 / 排除」模式间切换（未选中任何项时显示全部），并在下方以可移除标签展示当前生效条件。"
            : "Open any filter trigger for a floating .popover-surface picker with a mutually exclusive Include / Exclude mode switch (empty matches all) and removable active filter chips underneath."}
        </p>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Asia/Shanghai"
          messages={{
            userMultiFilters: zh
              ? {
                  all: "全部",
                  value: "选项",
                  include: "包含",
                  exclude: "排除",
                  resetFilter: "重置",
                  removeFilter: "移除 {label}",
                  selectedCount: "已选 {count} 项",
                }
              : {
                  all: "All",
                  value: "Value",
                  include: "Include",
                  exclude: "Exclude",
                  resetFilter: "Reset",
                  removeFilter: "Remove {label}",
                  selectedCount: "{count} selected",
                },
          }}
        >
          {(() => {
            const roleOpts = [
              { value: "STUDENT", label: zh ? "学习伙伴" : "Tutee" },
              { value: "VIEWER", label: zh ? "访客" : "Viewer" },
              { value: "TUTOR", label: zh ? "辅导伙伴" : "Tutor" },
              { value: "COORDINATOR", label: zh ? "协调员" : "Coordinator" },
              { value: "ADMIN", label: zh ? "管理员" : "Admin" },
            ];
            const accountOpts = [
              {
                value: "registered",
                label: zh ? "设置已完成" : "Setup complete",
              },
              {
                value: "setup",
                label: zh ? "设置未完成" : "Setup incomplete",
              },
              {
                value: "invited",
                label: zh ? "待接受邀请" : "Invitation pending",
              },
              {
                value: "none",
                label: zh ? "未关联直接登录账号" : "No direct login attached",
              },
            ];
            return (
              <div className="space-y-3">
                <div className="relative flex flex-wrap items-center gap-2">
                  <MultiFilter
                    label={zh ? "角色" : "Role"}
                    options={roleOpts}
                    value={roleFilter}
                    onChange={setRoleFilter}
                  />
                  <MultiFilter
                    label={zh ? "账号" : "Account"}
                    options={accountOpts}
                    value={accountFilter}
                    onChange={setAccountFilter}
                  />
                </div>
                <ActiveFilterChips
                  groups={[
                    {
                      id: "role",
                      label: zh ? "角色" : "Role",
                      options: roleOpts,
                      value: roleFilter,
                      onChange: setRoleFilter,
                    },
                    {
                      id: "account",
                      label: zh ? "账号" : "Account",
                      options: accountOpts,
                      value: accountFilter,
                      onChange: setAccountFilter,
                    },
                  ]}
                />
              </div>
            );
          })()}
        </NextIntlClientProvider>
      </div>
    </section>
  );
}
