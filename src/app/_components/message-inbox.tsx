"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Pager } from "./student-portal";
export function MessageInbox() {
  const programFormat = useFormatter();
  const t = useTranslations("workflows");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const contacts = api.messaging.recipients.useQuery({ search });
  const inbox = api.messaging.inbox.useQuery(
    { page },
    { refetchInterval: 30000, refetchIntervalInBackground: false },
  );
  const send = api.messaging.send.useMutation({
    onSuccess: async () => {
      setBody("");
      setClientKey(crypto.randomUUID());
      await inbox.refetch();
    },
  });
  const read = api.messaging.markRead.useMutation({
    onSuccess: () => inbox.refetch(),
  });
  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <form
        className="card space-y-4 p-6 md:sticky md:top-6"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate({ recipientId, body, clientKey });
        }}
      >
        <h2 className="section-title">{t("send")}</h2>
        <label className="block">
          <span className="label">{t("search")}</span>
          <input
            className="input w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">{t("recipient")}</span>
          <select
            className="input w-full"
            required
            disabled={send.isPending}
            value={recipientId}
            onChange={(e) => {
              setRecipientId(e.target.value);
              setClientKey(crypto.randomUUID());
            }}
          >
            <option value="">—</option>
            {contacts.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.role}
              </option>
            ))}
          </select>
        </label>
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
            }}
          />
        </label>
        <button className="btn-primary" disabled={send.isPending}>
          {t("send")}
        </button>
        {send.isSuccess && (
          <p role="status" className="text-emerald-700">
            {t("sent")}
          </p>
        )}
        {(send.error ?? contacts.error) && (
          <p role="alert">{(send.error ?? contacts.error)?.message}</p>
        )}
      </form>
      <section className="space-y-4">
        {inbox.error && <p role="alert">{inbox.error.message}</p>}
        {inbox.data?.length === 0 && (
          <p className="card muted p-6">{t("empty")}</p>
        )}
        {inbox.data?.map((m) => (
          <article
            className={`card p-5 ${m.incoming && !m.readAt ? "border-l-4 border-l-blue-500" : ""}`}
            key={m.id}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-semibold">
                {m.sender} → {m.recipient}
              </p>
              <time className="muted text-xs">
                {programFormat.dateTime(m.createdAt, { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </div>
            <p className="my-4 break-words whitespace-pre-wrap">{m.body}</p>
            <div className="flex gap-3">
              {m.incoming && (
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setSearch(m.sender);
                    setRecipientId(m.senderId);
                    setClientKey(crypto.randomUUID());
                  }}
                >
                  {t("reply")}
                </button>
              )}
              {m.incoming && !m.readAt && (
                <button
                  className="btn-secondary btn-sm"
                  disabled={read.isPending}
                  onClick={() => read.mutate({ id: m.id })}
                >
                  {t("read")}
                </button>
              )}
            </div>
          </article>
        ))}
        <Pager page={page} setPage={setPage} more={inbox.data?.length === 30} />
      </section>
    </div>
  );
}
