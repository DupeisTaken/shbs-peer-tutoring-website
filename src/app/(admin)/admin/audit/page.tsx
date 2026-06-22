"use client";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/**
 * Audit trail of admin mutations. Entries that carry undo data can be reverted with one
 * click (see src/server/audit/log.ts). Supports the revertibility philosophy in CLAUDE.md.
 */
export default function AuditPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const log = api.admin.auditLog.useQuery();
  const undo = api.admin.undoAudit.useMutation({
    onSuccess: () => utils.admin.auditLog.invalidate(),
  });

  const entries = log.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.audit.title")}</h1>
        <p className="muted mt-1">{t("admin.audit.subtitle")}</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.audit.columns.when")}</th>
              <th>{t("admin.audit.columns.who")}</th>
              <th>{t("admin.audit.columns.action")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className={e.undone ? "opacity-50" : ""}>
                <td className="text-xs text-slate-500">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="text-slate-600">{e.userName ?? "—"}</td>
                <td className="text-slate-800">
                  {e.action}
                  {e.undone && <span className="badge-slate ml-2">{t("admin.audit.undone")}</span>}
                </td>
                <td className="text-right">
                  {e.undoData != null && !e.undone ? (
                    <button
                      className="btn-secondary btn-sm"
                      disabled={undo.isPending}
                      onClick={() => undo.mutate({ id: e.id })}
                    >
                      {t("admin.audit.undo")}
                    </button>
                  ) : (
                    <span className="muted text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="text-slate-500">
                  {t("admin.audit.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {undo.error && <p className="text-sm text-red-600">{undo.error.message}</p>}
    </div>
  );
}
