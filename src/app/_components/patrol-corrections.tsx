"use client";
import { useState } from "react";
import { useFormatter, useTranslations, useTimeZone } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { useReadOnly } from "./read-only";

import { programDateTimeInput, parseProgramDateTime } from "~/lib/program-time";
type Patrol = RouterOutputs["corrections"]["patrols"][number];
function PatrolEditor({ row }: { row: Patrol }) {
  const t = useTranslations("corrections");
  const timeZone = useTimeZone();
  const localTime = (date: Date) => programDateTimeInput(date, timeZone);
  const [inputError, setInputError] = useState("");
  const [open, setOpen] = useState(false);
  const utils = api.useUtils();
  const rooms = api.admin.rooms.useQuery(undefined, { enabled: open });
  const save = api.corrections.correctPatrol.useMutation({
    onSuccess: async () => {
      await utils.corrections.patrols.invalidate();
      setOpen(false);
    },
  });
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="link cursor-pointer">{t("editPatrol")}</summary>
      {open && rooms.data && (
        <form
          key={row.updatedAt.toISOString()}
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const v = (key: string) =>
              typeof data.get(key) === "string"
                ? (data.get(key) as string)
                : "";
            try { setInputError(""); save.mutate({
              id: row.id,
              expectedUpdatedAt: row.updatedAt,
              reason: v("reason"),
              note: v("note") || null,
              observations: row.observations.map((o) => ({
                id: o.id,
                roomId: v(`room-${o.id}`),
                headcount: v(`count-${o.id}`) as typeof o.headcount,
                observedAt:
                  v(`time-${o.id}`) === localTime(o.observedAt)
                    ? o.observedAt
                    : parseProgramDateTime(v(`time-${o.id}`), timeZone),
              })),
            }); } catch (error) { setInputError(error instanceof Error ? error.message : "Invalid date"); }
          }}
        >
          <p className="muted">{t("patrolHelp")}</p>
          {inputError && <p role="alert">{inputError}</p>}
          {row.observations.map((o) => (
            <fieldset
              className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-3"
              key={o.id}
            >
              <legend className="font-medium">{o.room.name}</legend>
              <label>
                <span className="label">{t("room")}</span>
                <select
                  className="select"
                  name={`room-${o.id}`}
                  defaultValue={o.roomId}
                >
                  {rooms.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">{t("count")}</span>
                <select
                  className="select"
                  name={`count-${o.id}`}
                  defaultValue={o.headcount}
                >
                  {["ZERO", "ONE", "TWO", "THREE", "FOUR_PLUS"].map((s, i) => (
                    <option key={s} value={s}>
                      {i === 4 ? "4+" : i}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">{timeZone}</span>
                <input
                  className="input"
                  name={`time-${o.id}`}
                  type="datetime-local"
                  required
                  defaultValue={localTime(o.observedAt)}
                />
              </label>
            </fieldset>
          ))}
          <label className="block">
            <span className="label">{t("comments")}</span>
            <textarea
              className="input"
              name="note"
              defaultValue={row.note ?? ""}
            />
          </label>
          <label className="block">
            <span className="label">{t("reason")}</span>
            <textarea className="input" name="reason" required />
          </label>
          <button
            className="btn-primary"
            disabled={save.isPending || rooms.isLoading}
          >
            {t("save")}
          </button>
          {save.error && (
            <p role="alert" className="text-sm text-red-600">
              {save.error.message}
            </p>
          )}
        </form>
      )}
    </details>
  );
}

export function PatrolCorrections() {
  const programFormat = useFormatter();
  const t = useTranslations("corrections");
  const readOnly = useReadOnly();
  const [cursors, setCursors] = useState<string[]>([]);
  const rows = api.corrections.patrols.useQuery({ cursor: cursors.at(-1) });
  return (
    <section className="card space-y-4 p-5">
      <h2 className="section-title">{t("patrolHistory")}</h2>
      {rows.data?.map((row) => (
        <article
          key={row.id}
          className="space-y-2 border-t border-slate-100 pt-3"
        >
          <p className="font-medium">
            {row.crewUser.name} · {programFormat.dateTime(row.createdAt, { dateStyle: "medium", timeStyle: "short" })} · {row.hours}{" "}
            h
          </p>
          <p className="muted">
            {row.observations
              .map((o) => `${o.room.name}: ${o.headcount}`)
              .join(" · ")}
          </p>
          {!readOnly && <PatrolEditor row={row} />}
        </article>
      ))}
      {rows.data?.length === 0 && <p className="muted">{t("empty")}</p>}
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={!cursors.length}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          {t("newer")}
        </button>
        <button
          className="btn-secondary"
          disabled={rows.data?.length !== 50}
          onClick={() => setCursors((c) => [...c, rows.data!.at(-1)!.id])}
        >
          {t("older")}
        </button>
      </div>
    </section>
  );
}
