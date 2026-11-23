"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RoomAllocationStatus } from "~/app/_components/room-allocation-status";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { TableDetails } from "~/app/_components/ui/summary-table";

type SyntheticPairingCard = {
  id: string;
  subjects: string[];
  students: string[];
  combined: boolean;
  schedule: { en: string; zh: string };
  slotId: string;
  room: {
    room: { name: string } | null;
    roomMode: string;
    roomNeedsAssignment: boolean;
    scheduleConfirmed: boolean;
  };
};

const INITIAL_CARDS: readonly SyntheticPairingCard[] = [
  {
    id: "combined-alex",
    subjects: ["Mathematics", "Physics"],
    students: ["Alex Chen"],
    combined: true,
    schedule: { en: "Mon 15:30–16:15", zh: "周一 15:30–16:15" },
    slotId: "mon-1530",
    room: {
      room: { name: "A101" },
      roomMode: "FIXED",
      roomNeedsAssignment: false,
      scheduleConfirmed: true,
    },
  },
  {
    id: "math-mina",
    subjects: ["Mathematics"],
    students: ["Mina Li"],
    combined: false,
    schedule: { en: "Wed 16:00–16:45", zh: "周三 16:00–16:45" },
    slotId: "wed-1600",
    room: {
      room: { name: "B204" },
      roomMode: "AUTO",
      roomNeedsAssignment: false,
      scheduleConfirmed: true,
    },
  },
  {
    id: "phys-mina",
    subjects: ["Physics"],
    students: ["Mina Li"],
    combined: false,
    schedule: { en: "Awaiting schedule", zh: "等待排期" },
    slotId: "",
    room: {
      room: null,
      roomMode: "AUTO",
      roomNeedsAssignment: false,
      scheduleConfirmed: false,
    },
  },
  {
    id: "chem-sam",
    subjects: ["Chemistry"],
    students: ["Sam Wu"],
    combined: false,
    schedule: { en: "Thu 15:30–16:15", zh: "周四 15:30–16:15" },
    slotId: "thu-1530",
    room: {
      room: null,
      roomMode: "NONE",
      roomNeedsAssignment: false,
      scheduleConfirmed: true,
    },
  },
];

const copy = {
  en: {
    title: "Unified summary cards and dynamic combine selection",
    help: "Single and combined cards share one 50/50 split layout (stacking on narrow screens) with a compact content-sized select on the left, distinct students on the right, and header text links ahead of boxed buttons. Checkboxes appear only in combine mode, dynamically greying out incompatible cards and auto-selecting required companion cards.",
    combineGroups: "Combine groups",
    confirmCombine: "Review combine ({count})",
    cancelCombine: "Cancel",
    selectCard: "Select {group} to combine",
    combinedNotice: "Example combine review opened for: {groups}.",
    splitNotice: "Example split review opened for: {group}.",
    autoSelectedNotice:
      "Auto-selected companion card ({companions}) to keep complete student × subject coverage.",
    incompatibleHint:
      "Greyed-out cards share neither a student nor a subject with the current selection.",
    scheduleLabel: "Default schedule",
    roomLabel: "Room",
    slotLabel: "Default time slot",
    noSlot: "No default time slot",
    mutualGroup: "Both available",
    otherGroup: "Other time slots",
    unavailableGroup: "Unavailable (conflict)",
    rosterSingle: "Students",
    rosterCombined: "Combined student roster",
    details: "Details",
    detailsNote:
      "Synthetic per-assignment details dialog. Production features own availability, removal and scheduling rules.",
    viewSessions: "View sessions",
    split: "Split this group",
    combinedBadge: "Combined pairing",
    slots: {
      "mon-1530": "Mon 15:30–16:15",
      "wed-1600": "Wed 16:00–16:45",
      "thu-1530": "Thu 15:30–16:15",
      "fri-1600": "Fri 16:00–16:45 (Overlaps Chemistry)",
    },
  },
  zh: {
    title: "统一摘要卡片与动态合并选择",
    help: "单个与已合并卡片共用 50/50 分栏布局（窄屏自动堆叠）：左侧放置时间、教室与自适应紧凑选择框，右侧按行展示学生与详情入口；卡片标题栏将文字链接放在边框按钮之前。复选框仅在合并模式显示，自动置灰不兼容卡片并补选必需的关联卡片。",
    combineGroups: "合并分组",
    confirmCombine: "审核合并（{count}）",
    cancelCombine: "取消",
    selectCard: "选择 {group} 进行合并",
    combinedNotice: "已打开示例合并审核：{groups}。",
    splitNotice: "已打开示例拆分审核：{group}。",
    autoSelectedNotice:
      "已自动勾选关联卡片（{companions}），以保持完整的学生 × 科目覆盖。",
    incompatibleHint: "置灰卡片与当前已选卡片既无共同学生也无共同科目。",
    scheduleLabel: "默认时间",
    roomLabel: "教室",
    slotLabel: "默认辅导时段",
    noSlot: "不设置默认时段",
    mutualGroup: "双方均有空",
    otherGroup: "其他时段",
    unavailableGroup: "不可用（时间冲突）",
    rosterSingle: "学生",
    rosterCombined: "合并学生名单",
    details: "详情",
    detailsNote:
      "合成的单条辅导详情弹窗。正式页面保留各自的可用时间、移出与排期规则。",
    viewSessions: "查看课次",
    split: "拆分此分组",
    combinedBadge: "已合并辅导",
    slots: {
      "mon-1530": "周一 15:30–16:15",
      "wed-1600": "周三 16:00–16:45",
      "thu-1530": "周四 15:30–16:15",
      "fri-1600": "周五 16:00–16:45（与 Chemistry 冲突）",
    },
  },
} as const;

function sharesAxis(
  base: readonly SyntheticPairingCard[],
  candidate: SyntheticPairingCard,
): boolean {
  const subjects = new Set(base.flatMap((c) => c.subjects));
  const students = new Set(base.flatMap((c) => c.students));
  return (
    candidate.subjects.some((s) => subjects.has(s)) ||
    candidate.students.some((st) => students.has(st))
  );
}

/** Resolve rectangular student × subject closure over the synthetic card set. */
function resolveSelection(
  cards: readonly SyntheticPairingCard[],
  selectedIds: string[],
  addedId: string,
): { nextIds: string[]; autoIds: string[] } | null {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const current = selectedIds
    .map((id) => byId.get(id))
    .filter((c): c is SyntheticPairingCard => Boolean(c));
  const candidate = byId.get(addedId);
  if (!candidate) return null;
  if (current.length > 0 && !sharesAxis(current, candidate)) return null;

  const picked = new Set([...selectedIds, addedId]);
  const autoIds: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    const chosen = cards.filter((c) => picked.has(c.id));
    const subjects = new Set(chosen.flatMap((c) => c.subjects));
    const students = new Set(chosen.flatMap((c) => c.students));
    for (const student of students) {
      for (const subject of subjects) {
        const alreadyCovered = chosen.some(
          (c) => c.students.includes(student) && c.subjects.includes(subject),
        );
        if (alreadyCovered) continue;
        const companion = cards.find(
          (c) =>
            !picked.has(c.id) &&
            c.students.includes(student) &&
            c.subjects.includes(subject),
        );
        if (!companion) return null;
        picked.add(companion.id);
        autoIds.push(companion.id);
        changed = true;
      }
    }
  }
  return { nextIds: [...picked], autoIds };
}

function cardSummaryLabel(card: SyntheticPairingCard): string {
  return `${card.subjects.join(" + ")} (${card.students.join(", ")})`;
}

/** Synthetic unified pairing-card showcase; no live mutations or scheduling writes. */
export function PairingCardRecipe({ locale }: { locale: "en" | "zh" }) {
  const c = copy[locale];
  const t = useTranslations("pairingGroups");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [autoSelectedIds, setAutoSelectedIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<Record<string, string>>(() =>
    Object.fromEntries(INITIAL_CARDS.map((card) => [card.id, card.slotId])),
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const canAdd = (cardId: string) =>
    resolveSelection(INITIAL_CARDS, selectedIds, cardId) !== null;

  const toggleCard = (cardId: string) => {
    setStatusMessage(null);
    if (selectedIds.includes(cardId)) {
      // Removing a card clears companions that would otherwise leave incomplete coverage.
      const remaining = selectedIds.filter((id) => id !== cardId);
      if (remaining.length <= 1) {
        setSelectedIds(remaining);
        setAutoSelectedIds([]);
        return;
      }
      const chosen = INITIAL_CARDS.filter((item) =>
        remaining.includes(item.id),
      );
      const subjects = new Set(chosen.flatMap((item) => item.subjects));
      const students = new Set(chosen.flatMap((item) => item.students));
      const complete = [...students].every((student) =>
        [...subjects].every((subject) =>
          chosen.some(
            (item) =>
              item.students.includes(student) &&
              item.subjects.includes(subject),
          ),
        ),
      );
      setSelectedIds(complete ? remaining : [remaining[0]!]);
      setAutoSelectedIds([]);
      return;
    }
    const result = resolveSelection(INITIAL_CARDS, selectedIds, cardId);
    if (!result) return;
    setSelectedIds(result.nextIds);
    setAutoSelectedIds(result.autoIds);
  };

  const exitCombine = () => {
    setSelecting(false);
    setSelectedIds([]);
    setAutoSelectedIds([]);
  };

  return (
    <section
      id="pairing-card-recipe"
      className="card min-w-0 space-y-4 p-4 sm:p-5 lg:col-span-2"
    >
      <header className="flex flex-col items-start gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="section-title">{c.title}</h2>
          <p className="text-sm leading-6 wrap-break-word text-slate-600">
            {c.help}
          </p>
          <code className="block text-xs break-words text-slate-500">
            50/50 split card · field-auto-bounded select · RoomAllocationStatus
            · text link before boxed button · dynamic combine selection
          </code>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {selecting ? (
            <>
              <Button
                variant="primary"
                size="compact"
                disabled={selectedIds.length < 2}
                onClick={() => {
                  const groups = INITIAL_CARDS.filter((card) =>
                    selectedIds.includes(card.id),
                  )
                    .map(cardSummaryLabel)
                    .join(" + ");
                  setStatusMessage(
                    c.combinedNotice.replace("{groups}", groups),
                  );
                  exitCombine();
                }}
              >
                {c.confirmCombine.replace(
                  "{count}",
                  String(selectedIds.length),
                )}
              </Button>
              <Button size="compact" onClick={exitCombine}>
                {c.cancelCombine}
              </Button>
            </>
          ) : (
            <Button
              size="compact"
              onClick={() => {
                setStatusMessage(null);
                setSelecting(true);
              }}
            >
              {c.combineGroups}
            </Button>
          )}
        </div>
      </header>

      {selecting && selectedIds.length > 0 && (
        <p className="text-xs text-slate-600">{c.incompatibleHint}</p>
      )}

      {selecting && autoSelectedIds.length > 0 && (
        <InlineNotice tone="info" announcement="status">
          {c.autoSelectedNotice.replace(
            "{companions}",
            INITIAL_CARDS.filter((card) => autoSelectedIds.includes(card.id))
              .map(cardSummaryLabel)
              .join(", "),
          )}
        </InlineNotice>
      )}

      {statusMessage && (
        <InlineNotice tone="success" announcement="status">
          {statusMessage}
        </InlineNotice>
      )}

      <ul className="space-y-3" aria-label={t("title")}>
        {INITIAL_CARDS.map((card) => {
          const subjectHeading = card.subjects.join(" + ");
          const isSelected = selectedIds.includes(card.id);
          const checkboxEnabled = selecting && (isSelected || canAdd(card.id));
          const isUnavailable = selecting && !isSelected && !checkboxEnabled;
          const selectedSlot = slots[card.id] ?? "";
          const activeSchedule =
            selectedSlot && selectedSlot in c.slots
              ? c.slots[selectedSlot as keyof typeof c.slots]
              : card.schedule[locale];

          return (
            <li key={card.id}>
              <div
                data-combine-unavailable={isUnavailable ? "true" : undefined}
                className={`min-w-0 rounded-xl border transition-opacity ${
                  isSelected
                    ? "border-accent-500 ring-accent-500/20 ring-2"
                    : isUnavailable
                      ? "border-slate-200/80 bg-slate-50/70 opacity-55"
                      : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b border-slate-100 bg-slate-50/50 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    {selecting && (
                      <label
                        className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center lg:min-h-8 lg:min-w-8 ${
                          checkboxEnabled
                            ? "cursor-pointer"
                            : "cursor-not-allowed opacity-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!checkboxEnabled}
                          aria-label={c.selectCard.replace(
                            "{group}",
                            cardSummaryLabel(card),
                          )}
                          onChange={() => toggleCard(card.id)}
                        />
                      </label>
                    )}
                    <h3 className="min-w-0 text-base font-semibold break-words text-slate-900">
                      {subjectHeading}
                    </h3>
                    {card.combined && (
                      <span className="badge-slate">{c.combinedBadge}</span>
                    )}
                  </div>
                  {/* Record action order: ordinary text link on the left, boxed decision button next. */}
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      className="link inline-flex min-h-11 items-center text-sm font-medium lg:min-h-8"
                      href="#pairing-card-recipe"
                    >
                      {c.viewSessions}
                    </a>
                    {card.combined && (
                      <Button
                        size="compact"
                        onClick={() =>
                          setStatusMessage(
                            c.splitNotice.replace(
                              "{group}",
                              cardSummaryLabel(card),
                            ),
                          )
                        }
                      >
                        {c.split}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="p-4">
                  <div className="grid min-w-0 gap-4 md:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <dt className="text-xs font-medium text-slate-600">
                            {c.scheduleLabel}
                          </dt>
                          <dd className="mt-1 text-sm font-medium break-words text-slate-900">
                            {activeSchedule}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs font-medium text-slate-600">
                            {c.roomLabel}
                          </dt>
                          <dd className="mt-1 text-sm break-words text-slate-900">
                            <RoomAllocationStatus pairing={card.room} />
                          </dd>
                        </div>
                      </dl>
                      <div className="grid gap-1">
                        <label className="grid justify-items-start gap-1">
                          <span className="text-xs font-medium text-slate-600">
                            {c.slotLabel}
                          </span>
                          <select
                            aria-label={`${subjectHeading}: ${c.slotLabel}`}
                            value={selectedSlot}
                            onChange={(event) =>
                              setSlots((current) => ({
                                ...current,
                                [card.id]: event.target.value,
                              }))
                            }
                            className="select control-compact field-auto-bounded [--field-min-width:11rem] lg:min-h-8 lg:py-1"
                          >
                            <option value="">{c.noSlot}</option>
                            <optgroup label={c.mutualGroup}>
                              <option value="mon-1530">
                                {c.slots["mon-1530"]}
                              </option>
                              <option value="wed-1600">
                                {c.slots["wed-1600"]}
                              </option>
                            </optgroup>
                            <optgroup label={c.otherGroup}>
                              <option value="thu-1530">
                                {c.slots["thu-1530"]}
                              </option>
                            </optgroup>
                            <optgroup label={c.unavailableGroup}>
                              <option value="fri-1600" disabled>
                                {c.slots["fri-1600"]}
                              </option>
                            </optgroup>
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-2 border-t border-slate-100 pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-4">
                      <p className="text-xs font-medium text-slate-600">
                        {card.combined ? c.rosterCombined : c.rosterSingle}
                      </p>
                      <ul className="divide-y divide-slate-100">
                        {card.students.map((student) => (
                          <li key={student} className="space-y-1 py-1.5">
                            <p className="text-sm font-medium text-slate-900">
                              {student}
                            </p>
                            <div className="space-y-0.5">
                              {card.subjects.map((subject) => (
                                <div
                                  key={subject}
                                  className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"
                                >
                                  {card.subjects.length > 1 && (
                                    <span className="min-w-0 break-words">
                                      {subject}
                                    </span>
                                  )}
                                  <TableDetails
                                    label={c.details}
                                    title={
                                      card.subjects.length > 1
                                        ? `${student} · ${subject}`
                                        : student
                                    }
                                  >
                                    <p>{c.detailsNote}</p>
                                  </TableDetails>
                                </div>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
