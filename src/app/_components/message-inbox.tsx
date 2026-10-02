"use client";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { MAX_MESSAGE_RECIPIENTS, type MessageGroup } from "~/lib/messaging";
import { Pager } from "./student-portal";
import { Button } from "./ui/button";
import { FormActions, InlineNotice, StatePanel } from "./ui/patterns";
import { focusVisibleContext } from "./focus-visible-context";

type Contact = {
  id: string;
  name: string | null;
  username: string | null;
  role: string;
};
type MessageDraft = { selected: Contact[]; body: string; clientKey: string };
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
  const [replyTo, setReplyTo] = useState<Contact | null>(null);
  const previousDraft = useRef<MessageDraft | null>(null);
  const replyDrafts = useRef(new Map<string, MessageDraft>());
  const replyOpener = useRef<HTMLButtonElement | null>(null);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const composerContext = useRef<HTMLDivElement>(null);
  const requestedFocus = useRef<HTMLElement | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    // Wait for the composer to expand/collapse before measuring the target.
    const opener = requestedFocus.current;
    const usable =
      opener?.isConnected &&
      !opener.matches(':disabled, [aria-disabled="true"]') &&
      !opener.closest("[hidden], [inert]");
    if (focusRequest)
      focusVisibleContext(
        usable ? opener : bodyField.current,
        usable ? null : composerContext.current,
      );
  }, [focusRequest]);
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
      if (replyTo) replyDrafts.current.delete(replyTo.id);
      // A reply is a separate payload. Sending it must not erase a general draft.
      restoreDraft(replyTo ? previousDraft.current : null);
      setReplyTo(null);
      previousDraft.current = null;
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
  const permissionReady =
    !!permission.data && !permission.error && !permission.data.restricted;
  function restoreDraft(draft: MessageDraft | null) {
    setBody(draft?.body ?? "");
    setSelected(draft?.selected ?? []);
    setClientKey(draft?.clientKey ?? crypto.randomUUID());
  }
  function beginReply(contact: Contact, opener: HTMLButtonElement) {
    if (send.isPending || !permissionReady) return;
    const current = { selected, body, clientKey };
    // Preserve payload and retry key independently for every recipient. Never
    // silently redirect an existing general message to the clicked sender.
    if (replyTo) replyDrafts.current.set(replyTo.id, current);
    else previousDraft.current = current;
    restoreDraft(
      replyDrafts.current.get(contact.id) ?? {
        selected: [contact],
        body: "",
        clientKey: crypto.randomUUID(),
      },
    );
    setReplyTo(contact);
    replyOpener.current = opener;
    requestedFocus.current = null;
    send.reset();
    setFocusRequest((request) => request + 1);
  }
  function cancelReply() {
    if (send.isPending || !replyTo) return;
    replyDrafts.current.set(replyTo.id, { selected, body, clientKey });
    restoreDraft(previousDraft.current);
    previousDraft.current = null;
    setReplyTo(null);
    send.reset();
    requestedFocus.current = replyOpener.current;
    setFocusRequest((request) => request + 1);
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
          aria-label={t("send")}
          aria-busy={send.isPending}
          className="card min-w-0 space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              send.isPending ||
              !permissionReady ||
              !selected.length ||
              !body.trim()
            )
              return;
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
          {!permission.data && !permission.error && (
            <StatePanel kind="loading" title={m("loading")} />
          )}
          {permission.error && (
            <StatePanel
              kind={
                permission.error.data?.code === "FORBIDDEN" ? "denied" : "error"
              }
              title={permission.error.message}
              action={
                <Button onClick={() => void permission.refetch()}>
                  {m("retry")}
                </Button>
              }
            />
          )}
          {permission.data?.restricted && (
            <StatePanel kind="denied" title={m("restricted")} />
          )}
          <fieldset
            hidden={!!replyTo}
            disabled={send.isPending || !permissionReady || !!replyTo}
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
                      className="control-compact rounded-full border border-blue-200 bg-blue-50 text-sm text-slate-900"
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
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-slate-50"
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
                <Button size="compact" onClick={() => void contacts.refetch()}>
                  {m("retry")}
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <Button
                size="compact"
                disabled={contactPage === 0}
                onClick={() => setContactPage((p) => p - 1)}
              >
                {m("previous")}
              </Button>
              <span className="muted text-xs">
                {m("page", { page: contactPage + 1 })}
              </span>
              <Button
                size="compact"
                disabled={!contacts.data?.more}
                onClick={() => setContactPage((p) => p + 1)}
              >
                {m("next")}
              </Button>
            </div>
          </fieldset>
          <div ref={composerContext} className="space-y-3">
            {replyTo && (
              <InlineNotice>
                <p id="reply-context" className="font-semibold break-words">
                  {m("replyContext", {
                    name: `${replyTo.name ?? replyTo.username ?? replyTo.id}${replyTo.username ? ` (@${replyTo.username})` : ""}`,
                  })}
                </p>
                <p className="mt-1">{m("replyDraftHelp")}</p>
              </InlineNotice>
            )}
            <label className="block">
              <span className="label">{t("body")}</span>
              <textarea
                ref={bodyField}
                aria-describedby={replyTo ? "reply-context" : undefined}
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
          </div>
          <FormActions>
            <Button
              type="submit"
              variant="primary"
              disabled={
                send.isPending ||
                !permissionReady ||
                !selected.length ||
                !body.trim() ||
                permission.data?.restricted
              }
            >
              {send.isPending ? m("sending") : t("send")}
            </Button>
            {replyTo && (
              <Button disabled={send.isPending} onClick={cancelReply}>
                {m("cancelReply")}
              </Button>
            )}
          </FormActions>
          {send.isSuccess && (
            <p role="status" className="text-emerald-700">
              {m("sentCount", { count: send.data.count })}
            </p>
          )}
          {send.error && <p role="alert">{send.error.message}</p>}
        </form>
        <section className="min-w-0 space-y-4" aria-label={m("inbox")}>
          <h2 className="section-title">{m("inbox")}</h2>
          {inbox.isLoading && (
            <StatePanel kind="loading" title={m("loading")} />
          )}
          {(inbox.error ?? read.error) && (
            <StatePanel
              kind="error"
              title={(inbox.error ?? read.error)!.message}
              action={
                inbox.error ? (
                  <Button size="compact" onClick={() => void inbox.refetch()}>
                    {m("retry")}
                  </Button>
                ) : undefined
              }
            />
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
                  <Button
                    size="compact"
                    disabled={
                      !msg.canReply || send.isPending || !permissionReady
                    }
                    onClick={(event) => {
                      beginReply(
                        {
                          id: msg.senderId,
                          name: msg.sender,
                          username: msg.senderUsername,
                          role: msg.senderRole ?? "STUDENT",
                        },
                        event.currentTarget,
                      );
                    }}
                  >
                    {t("reply")}
                  </Button>
                )}
                {msg.incoming && !msg.readAt && (
                  <Button
                    size="compact"
                    disabled={read.isPending}
                    onClick={() => read.mutate({ id: msg.id })}
                  >
                    {t("read")}
                  </Button>
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
        <label
          key={g}
          className="flex min-h-11 items-start gap-2 text-sm lg:min-h-10"
        >
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
