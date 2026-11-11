"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice } from "~/app/_components/ui/patterns";

const en = {
  legend: "Narrow notice examples",
  help: "This bounded example also checks long recovery labels inside a desktop card. Recovery only updates this local example.",
  shape: "Notice action",
  button: "Shared button",
  native: "Native button",
  link: "Navigation link",
  group: "Wrapping action group",
  none: "No action",
  tone: "Notice tone",
  info: "Information",
  warning: "Warning",
  success: "Success",
  error: "Error",
  announcement: "Notice announcement",
  silent: "No announcement",
  alert: "Alert",
  status: "Status",
  pending: "Recovery pending",
  message:
    "Could not refresh example history and corrections. Previously loaded content is still shown.",
  retry: "Retry example history and corrections",
  reload: "Reload the current example snapshot",
  destination: "Open the retained example history and corrections",
  attempts: "Local recovery attempts",
};
const zh: Record<keyof typeof en, string> = {
  legend: "窄版提示示例",
  help: "此限宽示例也用于检查桌面卡片内的长恢复标签。恢复操作仅更新本地示例。",
  shape: "提示操作",
  button: "共用按钮",
  native: "原生按钮",
  link: "导航链接",
  group: "可换行操作组",
  none: "无操作",
  tone: "提示类型",
  info: "信息",
  warning: "警告",
  success: "成功",
  error: "错误",
  announcement: "提示播报",
  silent: "不播报",
  alert: "警报",
  status: "状态",
  pending: "正在恢复",
  message: "无法刷新示例历史与更正记录。之前加载的内容仍然显示。",
  retry: "重新加载示例历史与更正记录",
  reload: "重新加载当前示例快照",
  destination: "打开保留的示例历史与更正记录",
  attempts: "本地恢复次数",
};

/** Synthetic action shapes only; actual reads, drafts and authority stay in callers. */
export function NoticeLayoutExamples({ locale }: { locale: "en" | "zh" }) {
  const t = locale === "zh" ? zh : en;
  const [shape, setShape] = useState("button");
  const [tone, setTone] = useState<"info" | "warning" | "success" | "error">(
    "warning",
  );
  const [announcement, setAnnouncement] = useState<"alert" | "status">();
  const [pending, setPending] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const recover = () => setAttempts((count) => count + 1);
  const button = (
    <Button size="compact" disabled={pending} onClick={recover}>
      {t.retry}
    </Button>
  );
  const action =
    shape === "none" ? undefined : shape === "native" ? (
      <button
        type="button"
        className="btn-secondary control-compact"
        disabled={pending}
        onClick={recover}
      >
        {t.retry}
      </button>
    ) : shape === "link" ? (
      <Link
        className="btn-secondary control-compact"
        href="#notice-layout-example"
      >
        {t.destination}
      </Link>
    ) : shape === "group" ? (
      <div className="flex flex-wrap gap-2">
        {button}
        <Button size="compact" disabled={pending} onClick={recover}>
          {t.reload}
        </Button>
      </div>
    ) : (
      button
    );

  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-sm font-semibold">{t.legend}</legend>
      <p className="muted">{t.help}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          {t.shape}
          <select
            className="input block"
            value={shape}
            onChange={(event) => setShape(event.target.value)}
          >
            {(["button", "native", "link", "group", "none"] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {t[value]}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          {t.tone}
          <select
            className="input block"
            value={tone}
            onChange={(event) => setTone(event.target.value as typeof tone)}
          >
            {(["info", "warning", "success", "error"] as const).map((value) => (
              <option key={value} value={value}>
                {t[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          {t.announcement}
          <select
            className="input block"
            value={announcement ?? ""}
            onChange={(event) =>
              setAnnouncement(
                event.target.value === "alert"
                  ? "alert"
                  : event.target.value === "status"
                    ? "status"
                    : undefined,
              )
            }
          >
            <option value="">{t.silent}</option>
            <option value="alert">{t.alert}</option>
            <option value="status">{t.status}</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pending}
            onChange={(event) => setPending(event.target.checked)}
          />
          {t.pending}
        </label>
      </div>
      <div id="notice-layout-example" className="max-w-sm">
        <InlineNotice tone={tone} announcement={announcement} action={action}>
          {t.message}
        </InlineNotice>
      </div>
      <p className="text-sm">
        {t.attempts}: {attempts}
      </p>
    </fieldset>
  );
}
