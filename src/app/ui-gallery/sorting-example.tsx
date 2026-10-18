"use client";

import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";

/** Multiple keyed records exercise the same sorting contract as the live rosters. */
export function SortingExample({ chinese }: { chinese: boolean }) {
  const records = [
    { name: "Jordan Chen", count: 10, date: "2026-10-12" },
    { name: "Alex Lin", count: 2, date: "2026-09-30" },
    { name: "Sam Wu", count: 0, date: null },
  ];
  return (
    <div className="space-y-3">
      <p className="muted text-sm">
        {chinese
          ? "点击列标题：升序 → 降序 → 原始顺序。操作列不参与排序。"
          : "Click a column heading: ascending → descending → original order. Actions stay separate."}
      </p>
      <SummaryTable
        sortable
        label={
          chinese ? "信息表格排序示例" : "Information table sorting example"
        }
      >
        <thead>
          <tr>
            <th>{chinese ? "辅导伙伴" : "Tutor"}</th>
            <th className="text-right">
              {chinese ? "已分配时段" : "Assigned blocks"}
            </th>
            <th>{chinese ? "日期" : "Date"}</th>
            <th className="table-actions-heading">
              {chinese ? "操作" : "Actions"}
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.name}>
              <td className="font-medium">{record.name}</td>
              <td className="text-right">{record.count}</td>
              <td
                data-sort-value={
                  record.date ? Date.parse(`${record.date}T00:00:00Z`) : ""
                }
              >
                {record.date
                  ? new Intl.DateTimeFormat(chinese ? "zh" : "en", {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    }).format(new Date(`${record.date}T00:00:00Z`))
                  : "—"}
              </td>
              <TableActions>
                <TableDetails title={record.name}>
                  <p>
                    {chinese
                      ? "示例详情；排序不改变原始记录。"
                      : "Example details; sorting does not change the underlying record."}
                  </p>
                </TableDetails>
              </TableActions>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
    </div>
  );
}
