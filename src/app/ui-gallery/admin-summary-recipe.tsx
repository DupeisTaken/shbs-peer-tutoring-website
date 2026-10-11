"use client";
import { useState } from "react";
import { Button } from "~/app/_components/ui/button";
import { Modal } from "~/app/_components/ui/modal";
import {
  SummaryTable,
  TableAction,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";

/** Synthetic geometry and consequential states share production controls. No
 * program query, authorization result or draft is created by this example. */
export function AdminSummaryRecipe({ locale }: { locale: "en" | "zh" }) {
  const zh = locale === "zh";
  const [selected, setSelected] = useState(false);
  const [review, setReview] = useState(false);
  const name = zh
    ? "长期教学总结与记录审查示例"
    : "Long orientation summary and record review example";
  const close = zh ? "关闭" : "Close";
  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <h2 className="section-title">
        {zh
          ? "摘要、控件行与重要操作"
          : "Summaries, control rows and consequential actions"}
      </h2>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
        <label className="row-span-2 grid grid-rows-subgrid">
          <span className="label">
            {zh
              ? "允许换行的公告标题标签"
              : "Announcement title with a wrapping label"}
          </span>
          <input className="input" defaultValue={name} />
        </label>
        <span className="badge-green col-start-2 row-start-2">
          {zh ? "已发布" : "Published"}
        </span>
      </div>
      <SummaryTable label={zh ? "示例记录" : "Example records"}>
        <thead>
          <tr>
            <th>
              <span className="sr-only">{zh ? "选择" : "Select"}</span>
            </th>
            <th>{zh ? "主题" : "Subject"}</th>
            <th>{zh ? "状态" : "Status"}</th>
            <th className="table-actions-heading">{zh ? "操作" : "Actions"}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <label className="inline-flex min-h-11 min-w-11 items-center justify-center lg:min-h-8">
                <input
                  type="checkbox"
                  aria-label={`${zh ? "选择" : "Select"} ${name}`}
                  checked={selected}
                  onChange={(event) => setSelected(event.target.checked)}
                />
              </label>
            </td>
            <td>{name}</td>
            <td>
              <span className="badge-amber">
                {zh ? "需要复核" : "Review Needed"}
              </span>
            </td>
            <TableActions>
              <TableDetails title={name}>
                <p>
                  {zh
                    ? "完整原始记录保留在按需打开的详情中。"
                    : "Complete original records stay in details opened on demand."}
                </p>
              </TableDetails>
              <TableAction variant="danger" onClick={() => setReview(true)}>
                {zh ? "归档示例" : "Archive example"}
              </TableAction>
            </TableActions>
          </tr>
        </tbody>
      </SummaryTable>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={() => setReview(true)}>
          {zh ? "查看重要操作" : "Review consequential action"}
        </Button>
        <Button variant="danger" disabled>
          {zh ? "操作不可用" : "Action unavailable"}
        </Button>
      </div>
      {review && (
        <Modal
          title={zh ? "归档示例记录？" : "Archive the example record?"}
          onClose={() => setReview(false)}
          footer={
            <>
              <Button onClick={() => setReview(false)}>{close}</Button>
              <Button variant="danger" onClick={() => setReview(false)}>
                {zh ? "归档示例" : "Archive example"}
              </Button>
            </>
          }
        >
          <p>{name}</p>
        </Modal>
      )}
    </section>
  );
}
