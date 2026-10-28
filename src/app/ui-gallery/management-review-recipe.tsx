"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApprovalReviewDetails } from "~/app/_components/approval-review-details";
import { AuditChangeSummary } from "~/app/_components/audit-event-details";
import { ReviewDisclosure } from "~/app/_components/review-disclosure";
import { auditChangeSummary } from "~/lib/audit-change-summary";

const copy = {
  en: {
    title: "Management review evidence",
    help: "Synthetic saved evidence uses the production readers. Collapse retains the local decision note; no program record is read or changed.",
    scenario: "Review example",
    attendance: "Attendance: one changed student",
    stage: "Feature: stage a default override",
    clear: "Feature: clear a pending override",
    translation: "Translation: exact publication text",
    audit: "Audit: 75 recorded changes",
    pairing: "Pairing: people, subject and schedule",
    legacyPairing: "Pairing: missing historical names",
    unchanged: "No change: identical requested value",
    note: "Example decision note",
    pending: "Simulate pending confirmation",
    requester: "Requested by Alex Coordinator · Pending",
  },
  zh: {
    title: "管理审核证据",
    help: "合成的已保存证据使用正式阅读组件。折叠保留本地决定备注；不会读取或更改项目记录。",
    scenario: "审核示例",
    attendance: "出勤：一名学生的更改",
    stage: "功能：暂存默认值覆盖",
    clear: "功能：清除待生效覆盖",
    translation: "翻译：完整发布文本",
    audit: "审计：75 项记录更改",
    pairing: "辅导安排：人员、科目和时间",
    legacyPairing: "辅导安排：历史姓名未记录",
    unchanged: "无更改：申请值与原值相同",
    note: "示例决定备注",
    pending: "模拟待完成确认",
    requester: "申请人 Alex Coordinator · 待审核",
  },
};

type Example =
  | "attendance"
  | "stage"
  | "clear"
  | "translation"
  | "audit"
  | "pairing"
  | "legacyPairing"
  | "unchanged";

const pairing = {
  operation: "admin.updatePairing",
  payload: {
    id: "assignment",
    tutorId: "tutor-new",
    tuteeIds: ["learner-kept", "learner-added"],
    timeSlotId: "slot-new",
    roomMode: "FIXED",
    roomId: "room-new",
  },
  targets: {
    Pairing: [
      {
        id: "assignment",
        tutorId: "tutor-old",
        subject: "Mathematics",
        timeSlotId: "slot-old",
        dayOfWeek: 1,
        startMin: 960,
        endMin: 1020,
        roomMode: "AUTO",
        roomId: "room-old",
      },
    ],
    "Pairing.PairingTutee": [
      { pairingId: "assignment", tuteeId: "learner-kept" },
      { pairingId: "assignment", tuteeId: "learner-removed" },
    ],
    Tutor: [{ id: "tutor-new", englishName: "Alex Chen" }],
    Tutee: [
      { id: "learner-kept", englishName: "Mina Li" },
      { id: "learner-added", englishName: "Sam Lee" },
    ],
    TimeSlot: [
      {
        id: "slot-new",
        label: "Wednesday afternoon",
        dayOfWeek: 3,
        startMin: 990,
        endMin: 1050,
      },
    ],
    Room: [{ id: "room-new", name: "Room 204" }],
  },
};

// IDs and original values remain stable across locales and scenario changes.
// These are captured fixtures, not a projection of the current program database.
const students = Array.from({ length: 12 }, (_, index) => ({
  id: `student-${index + 1}`,
  englishName: `Student ${index + 1}`,
}));
const attendance = students.map((student) => ({
  tuteeId: student.id,
  status: "PRESENT",
  absenceReason: null,
}));
const fixtures = {
  pairing: {
    ...pairing,
    targets: {
      ...pairing.targets,
      reviewReferences: {
        version: 1,
        timeZone: "Asia/Shanghai",
        entities: {
          Tutor: [
            { id: "tutor-old", englishName: "Jordan Wu" },
            { id: "tutor-new", englishName: "Alex Chen" },
          ],
          Tutee: [
            { id: "learner-removed", englishName: "Sam Lee" },
            { id: "learner-added", englishName: "Sam Lee" },
            { id: "learner-kept", englishName: "Mina Li" },
          ],
          Room: [
            { id: "room-old", name: "Room 101" },
            { id: "room-new", name: "Room 204" },
          ],
          TimeSlot: [
            {
              id: "slot-old",
              label: "Monday afternoon",
              dayOfWeek: 1,
              startMin: 960,
              endMin: 1020,
            },
            {
              id: "slot-new",
              label: "Wednesday afternoon",
              dayOfWeek: 3,
              startMin: 990,
              endMin: 1050,
            },
          ],
        },
      },
    },
  },
  legacyPairing: pairing,
  unchanged: {
    operation: "admin.updateRoom",
    payload: { id: "room", name: "Room 101" },
    targets: { Room: [{ id: "room", name: "Room 101" }] },
  },
  attendance: {
    operation: "corrections.correctAttendance",
    payload: {
      id: "session",
      reason: "Confirmed school event.\n已核实学校活动。",
      tutees: attendance.map((row, index) =>
        index === 1
          ? {
              ...row,
              status: "EXCUSED_ABSENT",
              absenceReason: "School event\n学校活动",
            }
          : row,
      ),
    },
    targets: {
      Session: [
        { record: { id: "session", date: "2026-10-26T04:00:00.000Z" } },
      ],
      "Session.SessionTutee": attendance.map((row) => ({
        record: { sessionId: "session", ...row },
      })),
      Tutee: students.map((record) => ({ record })),
    },
  },
  stage: {
    operation: "program.setFeaturePending",
    payload: { key: "CREW", enabled: false },
    targets: {
      reviewPresentation: {
        version: 1,
        feature: {
          key: "CREW",
          effective: true,
          pending: null,
          source: "default",
        },
      },
    },
  },
  clear: {
    operation: "program.setFeaturePending",
    payload: { key: "CREW", enabled: true },
    targets: {
      reviewPresentation: {
        version: 1,
        feature: {
          key: "CREW",
          effective: true,
          pending: false,
          source: "stored",
        },
      },
    },
  },
  translation: {
    operation: "translationReview.decide",
    payload: { id: "draft", approve: true },
    targets: {
      TranslationDraft: [
        {
          record: {
            id: "draft",
            operation: "localization.setString",
            payload: {
              key: "public.welcome",
              locale: "zh",
              value:
                "欢迎参加同伴辅导。\n  Keep this indentation.\n第三行保留原文。",
            },
          },
        },
      ],
      destination: {
        translation: [{ key: "public.welcome", locale: "zh", value: "" }],
      },
    },
  },
};
const audit = {
  evidenceVersion: 1,
  changes: Array.from({ length: 75 }, (_, index) => ({
    entity: "Room",
    write: "update",
    before: { id: `room-${index + 1}`, name: `Room ${index + 1}` },
    after: { id: `room-${index + 1}`, name: `Study room ${index + 1}` },
  })),
};

/** Exercise production review composition without mounting an API query or write.
 * Only the selected audit fixture is rendered, keeping the gallery bounded. */
export function ManagementReviewRecipe() {
  const t = copy[useLocale() === "zh" ? "zh" : "en"];
  const review = useTranslations("approvals.review");
  const [example, setExample] = useState<Example>("attendance");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const fixture = example === "audit" ? null : fixtures[example];
  return (
    <section
      className="card space-y-4 p-4 sm:p-5 lg:col-span-2"
      aria-label={t.title}
    >
      <h2 className="section-title">{t.title}</h2>
      <p className="text-sm text-slate-600">{t.help}</p>
      <label className="block">
        <span className="label">{t.scenario}</span>
        <select
          className="input mt-1 w-full"
          value={example}
          disabled={pending}
          onChange={(event) => setExample(event.target.value as Example)}
        >
          {(
            [
              "attendance",
              "pairing",
              "legacyPairing",
              "unchanged",
              "stage",
              "clear",
              "translation",
              "audit",
            ] as const
          ).map((key) => (
            <option key={key} value={key}>
              {t[key]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-slate-700">{t.requester}</p>
      {fixture && <ApprovalReviewDetails {...fixture} summaryOnly />}
      <ReviewDisclosure title={review("reviewDetails")} busy={pending}>
        {fixture ? (
          <ApprovalReviewDetails
            key={example}
            {...fixture}
            hideSummary
            busy={pending}
          />
        ) : (
          <AuditChangeSummary summary={auditChangeSummary(audit)} />
        )}
        <label className="block">
          <span className="label">{t.note}</span>
          <textarea
            className="input mt-1 w-full"
            rows={2}
            value={note}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </ReviewDisclosure>
      <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-8">
        <input
          type="checkbox"
          checked={pending}
          onChange={(event) => setPending(event.target.checked)}
        />
        {t.pending}
      </label>
    </section>
  );
}
