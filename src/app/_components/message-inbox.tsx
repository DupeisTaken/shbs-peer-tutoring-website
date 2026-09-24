"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { MAX_MESSAGE_RECIPIENTS, type MessageGroup } from "~/lib/messaging";
import { Pager } from "./student-portal";

type Contact = {
  id: string;
  name: string | null;
  username: string | null;
  role: string;
};
export function MessageInbox() {
  const format = useFormatter();
  const t = useTranslations("workflows");
  const m = useTranslations("messaging");
  const roleLabel = useTranslations("admin.users.roles");
  const [page, setPage] = useState(0);
  const [contactPage, setContactPage] = useState(0);
  const [search, setSearch] = useState("");
  // Store selected identities independently of the current search/page result.
  const [selected, setSelected] = useState<Contact[]>([]);
  const [body, setBody] = useState("");
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const contacts = api.messaging.recipients.useQuery({
    search,
    page: contactPage,
  });
  const permission = api.messaging.permission.useQuery();
  const inbox = api.messaging.inbox.useQuery(
    { page },
    { refetchInterval: 30000, refetchIntervalInBackground: false },
  );
  const send = api.messaging.send.useMutation({
    onSuccess: async () => {
      setBody("");
      setSelected([]);
      setClientKey(crypto.randomUUID());
      await inbox.refetch();
    },
  });
  const read = api.messaging.markRead.useMutation({
    onSuccess: () => inbox.refetch(),
  });
  function changeSelection(next: Contact[]) {
    setSelected(next);
    setClientKey(crypto.randomUUID());
    send.reset();
  }
  return (
    <div className="space-y-5">
      <aside className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-slate-800">
        <p className="font-semibold">{m("privacyTitle")}</p>
        <p className="mt-1">{m("disclosure")}</p>
        <p className="mt-2 text-xs">{m("legacyHelp")}</p>
      </aside>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <form
          className="card min-w-0 space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate({
              recipientIds: selected.map((c) => c.id),
              body,
              clientKey,
              disclosureVersion: 1,
            });
          }}
        >
          <h2 className="section-title">{t("send")}</h2>
          <p id="allowed-contacts" className="muted text-sm">
            {m("allowedHelp")}
          </p>
          {permission.data && (
            <p className="text-sm">
              {m("allowed", {
                groups:
                  permission.data.groups
                    .map((g) => m(`groups.${g}`))
                    .join(" · ") || m("none"),
              })}
            </p>
          )}
          {permission.data?.restricted && <p role="alert">{m("restricted")}</p>}
          <fieldset
            disabled={send.isPending || permission.data?.restricted}
            className="min-w-0 space-y-3"
            onKeyDown={(e) => {
              // Enter while exploring recipients must not implicitly send a drafted batch.
              if (e.key === "Enter" && e.target instanceof HTMLInputElement)
                e.preventDefault();
            }}
          >
            <legend className="label">{m("recipients")}</legend>
            <label className="block">
              <span className="label">{t("search")}</span>
              <input
                className="input w-full"
                value={search}
                maxLength={100}
                aria-describedby="allowed-contacts"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setContactPage(0);
                }}
              />
            </label>
            <p className="text-sm font-medium" role="status">
              {m("selectedCount", {
                count: selected.length,
                max: MAX_MESSAGE_RECIPIENTS,
              })}
            </p>
            {selected.length > 0 && (
              <ul
                aria-label={m("selectedRecipients")}
                className="flex flex-wrap gap-2"
              >
                {selected.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm text-slate-900"
                      aria-label={m("remove", {
                        name: `${c.name ?? c.username ?? c.id} (@${c.username ?? c.id})`,
                      })}
                      onClick={() =>
                        changeSelection(selected.filter((s) => s.id !== c.id))
                      }
                    >
                      {c.name ?? c.username}{" "}
                      <span className="text-xs">@{c.username ?? c.id}</span> ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div
              className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2"
              role="group"
              aria-label={m("results")}
            >
              {contacts.isFetching && (
                <p role="status" className="muted p-2 text-sm">
                  {m("loading")}
                </p>
              )}
              {!contacts.isFetching && contacts.data?.people.length === 0 && (
                <p role="status" className="muted p-2 text-sm">
                  {m("noMatches")}
                </p>
              )}
              {contacts.data?.people.map((c) => {
                const checked = selected.some((s) => s.id === c.id);
                return (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={checked}
                      disabled={
                        !checked && selected.length >= MAX_MESSAGE_RECIPIENTS
                      }
                      onChange={() =>
                        changeSelection(
                          checked
                            ? selected.filter((s) => s.id !== c.id)
                            : [...selected, c],
                        )
                      }
                    />
                    <span className="min-w-0 text-sm break-words">
                      <span className="font-medium">
                        {c.name ?? c.username}
                      </span>{" "}
                      <span className="muted block">
                        {c.username ? `@${c.username}` : c.id} ·{" "}
                        {roleLabel(c.role)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {contacts.error && (
              <div role="alert">
                <p>{contacts.error.message}</p>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void contacts.refetch()}
                >
                  {m("retry")}
                </button>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={contactPage === 0}
                onClick={() => setContactPage((p) => p - 1)}
              >
                {m("previous")}
              </button>
              <span className="muted text-xs">
                {m("page", { page: contactPage + 1 })}
              </span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={!contacts.data?.more}
                onClick={() => setContactPage((p) => p + 1)}
              >
                {m("next")}
              </button>
            </div>
          </fieldset>
          <label className="block">
            <span className="label">{t("body")}</span>
            <textarea
              className="input min-h-36 w-full"
              required
              maxLength={4000}
              disabled={send.isPending}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setClientKey(crypto.randomUUID());
                send.reset();
              }}
            />
          </label>
          <button
            className="btn-primary"
            disabled={
              send.isPending ||
              !selected.length ||
              !body.trim() ||
              permission.data?.restricted
            }
          >
            {send.isPending ? m("sending") : t("send")}
          </button>
          {send.isSuccess && (
            <p role="status" className="text-emerald-700">
              {m("sentCount", { count: send.data.count })}
            </p>
          )}
          {(send.error ?? permission.error) && (
            <p role="alert">{(send.error ?? permission.error)?.message}</p>
          )}
        </form>
        <section className="min-w-0 space-y-4" aria-label={m("inbox")}>
          <h2 className="section-title">{m("inbox")}</h2>
          {inbox.isLoading && <p role="status">{m("loading")}</p>}
          {(inbox.error ?? read.error) && (
            <p role="alert">{(inbox.error ?? read.error)?.message}</p>
          )}
          {inbox.data?.length === 0 && (
            <p className="card muted p-6">{t("empty")}</p>
          )}
          {inbox.data?.map((msg) => (
            <article
              className={`card min-w-0 p-5 ${msg.incoming && !msg.readAt ? "border-l-4 border-l-blue-500" : ""}`}
              key={msg.id}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold break-words">
                  {msg.sender} → {msg.recipient}
                </p>
                <time className="muted text-xs">
                  {format.dateTime(msg.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>
              <p className="muted mt-2 text-xs">
                {msg.supervisable ? m("supervised") : m("legacy")}
              </p>
              <p className="my-4 break-words whitespace-pre-wrap">
                {msg.hiddenAt ? m("hiddenMessage") : msg.body}
              </p>
              <div className="flex flex-wrap gap-3">
                {msg.incoming && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={!msg.canReply || send.isPending}
                    onClick={() => {
                      changeSelection([
                        {
                          id: msg.senderId,
                          name: msg.sender,
                          username: msg.senderUsername,
                          role: msg.senderRole ?? "STUDENT",
                        },
                      ]);
                    }}
                  >
                    {t("reply")}
                  </button>
                )}
                {msg.incoming && !msg.readAt && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={read.isPending}
                    onClick={() => read.mutate({ id: msg.id })}
                  >
                    {t("read")}
                  </button>
                )}
              </div>
              {msg.incoming && !msg.canReply && (
                <p className="muted mt-2 text-xs">{m("replyUnavailable")}</p>
              )}
            </article>
          ))}
          <Pager
            page={page}
            setPage={setPage}
            more={inbox.data?.length === 30}
          />
        </section>
      </div>
    </div>
  );
}

export function MessageGroupChoices({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (groups: MessageGroup[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("messaging");
  const groups: MessageGroup[] = [
    "MANAGEMENT",
    "CURRENT_TUTORS",
    "PAST_TUTORS",
    "SAME_GROUP",
    "ALL_USERS",
  ];
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="label">{t("allowedGroups")}</legend>
      {groups.map((g) => (
        <label key={g} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={value.includes(g)}
            onChange={() =>
              onChange(
                (value.includes(g)
                  ? value.filter((v) => v !== g)
                  : [...value, g]) as MessageGroup[],
              )
            }
          />
          <span>{t(`groups.${g}`)}</span>
        </label>
      ))}
    </fieldset>
  );
}
