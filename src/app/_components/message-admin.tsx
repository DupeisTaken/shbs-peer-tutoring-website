"use client";
import { Activity, useState } from "react";
import { SectionTabs } from "./ui/section-tabs";
import { Button, ChoiceButton } from "./ui/button";
import { InlineNotice, FormActions } from "./ui/patterns";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterInputs } from "~/trpc/react";
import { MessageGroupChoices } from "./message-inbox";

export function MessageAdmin() {
  const t = useTranslations("messaging");
  const [view, setView] = useState<"review" | "settings">("review");
  const [settingsOpened, setSettingsOpened] = useState(false);
  return (
    <div className="space-y-6">
      <p className="muted text-sm">{t("supervisionHelp")}</p>
      <SectionTabs<"review" | "settings">
        label={t("supervision")}
        value={view}
        items={[
          { value: "review", label: t("reviewMessages") },
          { value: "settings", label: t("permissions") },
        ]}
        onChange={(next) => {
          setView(next);
          if (next === "settings") setSettingsOpened(true);
        }}
      >
        <Activity mode={view === "review" ? "visible" : "hidden"}>
          <Supervision />
        </Activity>
        {settingsOpened && (
          <Activity mode={view === "settings" ? "visible" : "hidden"}>
            <Permissions />
          </Activity>
        )}
      </SectionTabs>
    </div>
  );
}
function Reason({
  value,
  setValue,
}: {
  value: string;
  setValue: (v: string) => void;
}) {
  const t = useTranslations("messaging");
  return (
    <label className="block">
      <span className="label">{t("reason")}</span>
      <input
        className="input w-full"
        required
        minLength={5}
        maxLength={1000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </label>
  );
}
function Supervision() {
  const t = useTranslations("messaging");
  const format = useFormatter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [visibility, setVisibility] = useState<"ALL" | "VISIBLE" | "HIDDEN">(
    "ALL",
  );
  const [reason, setReason] = useState("");
  const [conversation, setConversation] = useState<{
    first: string;
    second: string;
    label: string;
  }>();
  const rows = api.messaging.supervision.useQuery({
    search,
    page,
    visibility,
    conversation: conversation
      ? { first: conversation.first, second: conversation.second }
      : undefined,
  });
  const review = api.messaging.review.useMutation();
  const moderate = api.messaging.moderate.useMutation({
    onSuccess: async () => {
      review.reset();
      await rows.refetch();
    },
  });
  const error = rows.error ?? (review.error?.data?.approvalId ? null : review.error) ?? (moderate.error?.data?.approvalId ? null : moderate.error);
  const approvals = useTranslations("approvals");
  return (
    <div className="space-y-4">
      <div className="card grid gap-4 p-5 md:grid-cols-2">
        <label className="block">
          <span className="label">{t("supervisionSearch")}</span>
          <input
            className="input w-full"
            value={search}
            maxLength={100}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
              review.reset();
            }}
          />
        </label>
        <label className="block">
          <span className="label">{t("visibility")}</span>
          <select
            className="input w-full"
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as typeof visibility);
              setPage(0);
              review.reset();
            }}
          >
            {(["ALL", "VISIBLE", "HIDDEN"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`visibilityOptions.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-2">
          <Reason value={reason} setValue={setReason} />
        </div>
      </div>
      {conversation && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-slate-900">
          <span>{conversation.label}</span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setConversation(undefined);
              setPage(0);
              review.reset();
            }}
          >
            {t("clearConversation")}
          </button>
        </div>
      )}
      {(review.error?.data?.approvalId ?? moderate.error?.data?.approvalId) && <InlineNotice tone="warning" announcement="status">{approvals("queuedBody")}</InlineNotice>}
      {error && <p role="alert">{error.message}</p>}
      {rows.isLoading && <p role="status">{t("loading")}</p>}
      {rows.data?.rows.length === 0 && (
        <p role="status" className="card muted p-5">
          {t("noMatches")}
        </p>
      )}
      {rows.data?.rows.map((row) => (
        <article key={row.id} className="card min-w-0 space-y-3 p-5">
          <div className="flex flex-wrap justify-between gap-2">
            <p className="font-semibold break-words">
              {row.sender?.name ?? row.senderId} →{" "}
              {row.recipient?.name ?? row.recipientId}
            </p>
            <time className="muted text-xs">
              {format.dateTime(row.createdAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </div>
          <p className="muted text-xs">
            {row.sender?.username ? `@${row.sender.username}` : row.senderId} →{" "}
            {row.recipient?.username
              ? `@${row.recipient.username}`
              : row.recipientId}{" "}
            ·{" "}
            {t(
              row.hiddenAt
                ? "visibilityOptions.HIDDEN"
                : "visibilityOptions.VISIBLE",
            )}
          </p>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={
              reason.trim().length < 5 || review.isPending || moderate.isPending
            }
            onClick={() => {
              review.reset();
              review.mutate({ id: row.id, reason });
            }}
          >
            {t("openReview")}
          </button>{" "}
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setConversation({
                first: row.senderId,
                second: row.recipientId,
                label: `${row.sender?.name ?? row.senderId} ↔ ${row.recipient?.name ?? row.recipientId}`,
              });
              setPage(0);
              setSearch("");
              review.reset();
            }}
          >
            {t("viewConversation")}
          </button>
          {review.data?.id === row.id && (
            <div className="space-y-4 border-t border-slate-200 pt-4">
              <p className="break-words whitespace-pre-wrap">
                {review.data.body}
              </p>
              <button
                type="button"
                className="btn-secondary"
                disabled={reason.trim().length < 5 || moderate.isPending}
                onClick={() =>
                  moderate.mutate({ id: row.id, hide: !row.hiddenAt, reason })
                }
              >
                {t(row.hiddenAt ? "restore" : "hide")}
              </button>
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  {t("auditHistory")}
                </summary>
                <ul className="mt-3 space-y-2 text-xs">
                  {review.data.history.map((h) => (
                    <li
                      key={h.id}
                      className="rounded-md bg-slate-50 p-3 text-slate-900"
                    >
                      <p>
                        {t(`actions.${h.action}`)} ·{" "}
                        <span title={h.actorId}>{h.actorName}</span> ·{" "}
                        {format.dateTime(h.createdAt, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                      <p className="mt-1 break-words">{h.reason}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </article>
      ))}
      <div className="flex gap-3">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={page === 0}
          onClick={() => {
            setPage((p) => p - 1);
            review.reset();
          }}
        >
          {t("previous")}
        </button>
        <span className="muted self-center text-sm">
          {t("page", { page: page + 1 })}
        </span>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={!rows.data?.more}
          onClick={() => {
            setPage((p) => p + 1);
            review.reset();
          }}
        >
          {t("next")}
        </button>
      </div>
    </div>
  );
}
function Permissions() {
  const t = useTranslations("messaging");
  const roles = useTranslations("admin.users.roles");
  const settings = api.messaging.settings.useQuery();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [user, setUser] = useState<{ id: string; name: string | null } | null>(
    null,
  );
  const people = api.messaging.permissionUsers.useQuery({ search, page });
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h2 className="section-title">{t("rolePermissions")}</h2>
        <p className="muted text-sm">{t("permissionHelp")}</p>
        {settings.error && <p role="alert">{settings.error.message}</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {settings.data?.map((s) => (
            <PermissionEditor
              key={`${s.role}:${s.groups.join()}`}
              label={roles(s.role)}
              target={{ type: "ROLE", role: s.role }}
              groups={s.groups}
              onSaved={() => settings.refetch()}
            />
          ))}
        </div>
      </section>
      <section className="card space-y-4 p-5">
        <h2 className="section-title">{t("userOverrides")}</h2>
        <label className="block">
          <span className="label">{t("findUser")}</span>
          <input
            className="input w-full"
            value={search}
            maxLength={100}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        {people.error && <p role="alert">{people.error.message}</p>}
        {people.isLoading && <p role="status">{t("loading")}</p>}
        <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
          {people.data?.people.map((p) => (
            <ChoiceButton
              key={p.id}
              selected={user?.id === p.id}
              onClick={() => setUser(p)}
            >
              {p.name ?? p.username} · {p.username ? `@${p.username}` : p.id} ·{" "}
              {roles(p.role)}
            </ChoiceButton>
          ))}
        </div>
        {people.data?.people.length === 0 && (
          <p role="status">{t("noMatches")}</p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("previous")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={!people.data?.more}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </button>
        </div>
        {user && <UserPermission key={user.id} user={user} />}
      </section>
    </div>
  );
}
function UserPermission({
  user,
}: {
  user: { id: string; name: string | null };
}) {
  const t = useTranslations("messaging");
  const approvals = useTranslations("approvals");
  const [reason, setReason] = useState("");
  const permission = api.messaging.userPermission.useQuery({ userId: user.id });
  const restrict = api.messaging.restrict.useMutation({
    onSuccess: () => permission.refetch(),
  });
  if (!permission.data)
    return (
      <p role={permission.error ? "alert" : "status"}>
        {permission.error?.message ?? t("loading")}
      </p>
    );
  return (
    <div className="space-y-4 border-t border-slate-200 pt-4">
      <p className="font-semibold">{user.name ?? user.id}</p>
      {permission.data.suspended && (
        <p role="alert" className="text-sm">
          {t("accountSuspended")}
        </p>
      )}
      <p className="text-sm">
        {t("effectiveSource", {
          source: t(`sources.${permission.data.source}`),
        })}
      </p>
      <PermissionEditor
        key={`${permission.data.source}:${permission.data.groups.join()}`}
        label={t("effectivePermission")}
        target={{ type: "USER", userId: user.id }}
        groups={permission.data.groups}
        onSaved={() => permission.refetch()}
      />
      <div className="space-y-3">
        <p className="text-sm">
          {t(permission.data.restricted ? "restricted" : "unrestricted")}
        </p>
        <Reason value={reason} setValue={setReason} />
        <button
          type="button"
          className="btn-secondary"
          disabled={restrict.isPending || reason.trim().length < 5}
          onClick={() =>
            restrict.mutate({
              userId: user.id,
              restricted: !permission.data.restricted,
              reason,
            })
          }
        >
          {t(permission.data.restricted ? "allowAccess" : "restrictAccess")}
        </button>
        {restrict.error?.data?.approvalId && <InlineNotice tone="warning" announcement="status">{approvals("queuedBody")}</InlineNotice>}
        {restrict.error && !restrict.error.data?.approvalId && <p role="alert">{restrict.error.message}</p>}
        {restrict.isSuccess && <p role="status">{t("saved")}</p>}
      </div>
    </div>
  );
}
function PermissionEditor({
  label,
  target,
  groups,
  onSaved,
}: {
  label: string;
  target: RouterInputs["messaging"]["setPermission"]["target"];
  groups: string[];
  onSaved: () => Promise<unknown>;
}) {
  const t = useTranslations("messaging");
  const identity = api.account.me.useQuery();
  const canEdit = !identity.error && ["HEAD", "ADMIN"].includes(identity.data?.role ?? "");
  const approvals = useTranslations("approvals");
  const [value, setValue] = useState(groups);
  const [reason, setReason] = useState("");
  const save = api.messaging.setPermission.useMutation({
    onSuccess: async () => {
      await onSaved();
    },
  });
  return (
    <form
      className="card space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canEdit || save.isPending) return;
        save.mutate({
          target,
          groups: value as RouterInputs["messaging"]["setPermission"]["groups"],
          reason,
        });
      }}
    >
      <h3 className="font-semibold">{label}</h3>
      <p className="muted text-sm">{approvals("sensitiveHelp")}</p>
      <fieldset disabled={!canEdit || save.isPending} className="min-w-0 space-y-4">
      <MessageGroupChoices
        value={value}
        onChange={setValue}
        disabled={save.isPending}
      />
      <Reason value={reason} setValue={setReason} />
      <FormActions>
        <Button
          type="submit"
          variant="primary"
          disabled={save.isPending || reason.trim().length < 5}
        >
          {identity.data?.role === "ADMIN" ? approvals("requestHead") : t("save")}
        </Button>
        <Button
          disabled={save.isPending || reason.trim().length < 5}
          onClick={() => { if (canEdit && !save.isPending) save.mutate({ target, groups: null, reason }); }}
        >
          {t(target.type === "USER" ? "inherit" : "resetDefault")}
        </Button>
      </FormActions>
      </fieldset>
      {save.error?.data?.approvalId && <InlineNotice tone="warning" announcement="status">{approvals("queuedBody")}</InlineNotice>}
      {save.error && !save.error.data?.approvalId && <p role="alert">{save.error.message}</p>}
      {save.isSuccess && <p role="status">{t("saved")}</p>}
    </form>
  );
}
