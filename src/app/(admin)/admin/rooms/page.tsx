"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { hmToMin, minToHm } from "~/lib/time";
import { REFERENCE_STALE_TIME } from "~/lib/query";
import { DisclosureIcon } from "~/app/_components/icons";
import { useReadOnly } from "~/app/_components/read-only";

type Block = {
  id: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  reason: string | null;
};
type Room = { id: string; name: string; unavailabilities: Block[] };
type Draft = {
  id?: string;
  dayOfWeek: number;
  start: string;
  end: string;
  reason: string;
};
type Feedback = { message: string; error?: boolean; requestId?: string } | null;
type WriteError = {
  message: string;
  data?: { approvalId?: string | null } | null;
};
const EMPTY: Draft = { dayOfWeek: 1, start: "12:00", end: "13:00", reason: "" };
const control = "min-h-11 lg:min-h-10";
const compact = "min-h-11 lg:min-h-8";

function Notice({ feedback }: { feedback: Feedback }) {
  const t = useTranslations("admin.rooms");
  if (!feedback) return null;
  return (
    <div
      role={feedback.error ? "alert" : "status"}
      className={`rounded-lg border p-3 text-sm ${feedback.error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}
    >
      <p>{feedback.message}</p>
      {feedback.requestId && (
        <Link
          className={`link mt-1 inline-flex items-center ${compact}`}
          href={`/admin/approvals?request=${feedback.requestId}`}
        >
          {t("viewRequest")}
        </Link>
      )}
    </div>
  );
}

/** A single editor per room preserves drafts on failure. A queued proposal is
 * feedback only: it never changes the list of live blocked periods. */
function RoomCard({
  room,
  readOnly,
  coordinator,
  onChanged,
}: {
  room: Room;
  readOnly: boolean;
  coordinator: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("admin.rooms");
  const format = useFormatter();
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Block | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [name, setName] = useState(room.name);
  const dayName = (day: number) =>
    format.dateTime(new Date(Date.UTC(2026, 0, 4 + day)), {
      weekday: "long",
      timeZone: "UTC",
    });
  const onError = (error: WriteError) =>
    setFeedback(
      error.data?.approvalId
        ? { message: t("queued"), requestId: error.data.approvalId }
        : { message: error.message, error: true },
    );
  const onSuccess = async () => {
    setDraft(null);
    setRemoving(null);
    setFeedback({ message: t("saved") });
    await onChanged();
  };
  const add = api.admin.createRoomUnavailability.useMutation({
    onSuccess,
    onError,
  });
  const edit = api.admin.updateRoomUnavailability.useMutation({
    onSuccess,
    onError,
  });
  const remove = api.admin.deleteRoomUnavailability.useMutation({
    onSuccess,
    onError,
  });
  const rename = api.admin.updateRoom.useMutation({ onSuccess, onError });
  const deleteRoom = api.admin.deleteRoom.useMutation({ onSuccess, onError });
  const busy =
    add.isPending ||
    edit.isPending ||
    remove.isPending ||
    rename.isPending ||
    deleteRoom.isPending;
  const begin = (block?: Block) => {
    setRemoving(null);
    setFeedback(null);
    setDraft(
      block
        ? {
            id: block.id,
            dayOfWeek: block.dayOfWeek,
            start: minToHm(block.startMin),
            end: minToHm(block.endMin),
            reason: block.reason ?? "",
          }
        : { ...EMPTY },
    );
  };
  return (
    <article className="card overflow-hidden p-0" aria-label={room.name}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold break-words text-slate-900">
            {room.name}
          </h2>
          <p className="text-sm text-slate-600">
            {room.unavailabilities.length
              ? t("blockCount", { count: room.unavailabilities.length })
              : t("noBlocks")}
          </p>
        </div>
        <button
          type="button"
          className={`btn-secondary gap-2 ${control}`}
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen(!open)}
        >
          <DisclosureIcon open={open} />
          {open
            ? t("hidePeriods")
            : readOnly
              ? t("viewPeriods")
              : t("managePeriods")}
        </button>
      </div>
      {open && (
        <div
          id={regionId}
          className="space-y-4 border-t border-slate-200 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">
                {t("unavailablePeriods")}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {t("recurringHelp")}
              </p>
            </div>
            {!readOnly && (
              <button
                type="button"
                className={`btn-primary ${control}`}
                disabled={busy}
                onClick={() => begin()}
              >
                {coordinator ? t("requestAdd") : t("addPeriod")}
              </button>
            )}
          </div>
          {room.unavailabilities.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              {t("noBlocksHelp")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {room.unavailabilities.map((block) => (
                <li
                  key={block.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">
                      {dayName(block.dayOfWeek)}{" "}
                      <span className="ml-2 font-normal whitespace-nowrap tabular-nums">
                        {minToHm(block.startMin)}–{minToHm(block.endMin)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm break-words text-slate-500">
                      {block.reason ?? t("noReason")}
                    </p>
                  </div>
                  {!readOnly && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`btn-secondary btn-sm ${compact}`}
                        disabled={busy}
                        onClick={() => begin(block)}
                        aria-label={`${coordinator ? t("requestEdit") : t("editPeriod")}: ${dayName(block.dayOfWeek)} ${minToHm(block.startMin)}`}
                      >
                        {coordinator ? t("requestEdit") : t("editPeriod")}
                      </button>
                      <button
                        type="button"
                        className={`btn-ghost btn-sm text-red-700 ${compact}`}
                        disabled={busy}
                        onClick={() => {
                          setRemoving(block);
                          setDraft(null);
                          setFeedback(null);
                        }}
                        aria-label={`${coordinator ? t("requestRemove") : t("removePeriod")}: ${dayName(block.dayOfWeek)} ${minToHm(block.startMin)}`}
                      >
                        {coordinator ? t("requestRemove") : t("removePeriod")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {draft && !readOnly && (
            <form
              aria-label={draft.id ? t("editPeriod") : t("addPeriod")}
              className="space-y-4 rounded-lg border border-slate-300 bg-slate-50 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (busy) return;
                // Native time inputs cannot represent 24:00. Accept it explicitly for
                // the end field so midnight-ending periods can be edited intact.
                const time = /^([01]\d|2[0-3]):[0-5]\d$/;
                if (
                  !time.test(draft.start) ||
                  !(time.test(draft.end) || draft.end === "24:00") ||
                  hmToMin(draft.end) <= hmToMin(draft.start)
                ) {
                  setFeedback({ message: t("invalidRange"), error: true });
                  return;
                }
                setFeedback(null);
                const input = {
                  dayOfWeek: draft.dayOfWeek,
                  startMin: hmToMin(draft.start),
                  endMin: hmToMin(draft.end),
                  reason: draft.reason.trim(),
                };
                if (draft.id) edit.mutate({ id: draft.id, ...input });
                else add.mutate({ roomId: room.id, ...input });
              }}
            >
              <h4 className="font-semibold">
                {draft.id ? t("editPeriod") : t("addPeriod")}
              </h4>
              <fieldset
                disabled={busy}
                className="grid min-w-0 gap-3 sm:grid-cols-3"
              >
                <label className="min-w-0 text-sm font-medium">
                  {t("day")}
                  <select
                    autoFocus
                    aria-label={t("day")}
                    value={draft.dayOfWeek}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dayOfWeek: Number(event.target.value),
                      })
                    }
                    className={`select mt-1 ${control}`}
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                      <option key={day} value={day}>
                        {dayName(day)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 text-sm font-medium">
                  {t("start")}
                  <input
                    required
                    type="time"
                    value={draft.start}
                    onChange={(event) =>
                      setDraft({ ...draft, start: event.target.value })
                    }
                    className={`input mt-1 ${control}`}
                  />
                </label>
                <label className="min-w-0 text-sm font-medium">
                  {t("end")}
                  <input
                    required
                    type="text"
                    value={draft.end}
                    placeholder="HH:MM"
                    aria-describedby={`${regionId}-time-help`}
                    onChange={(event) =>
                      setDraft({ ...draft, end: event.target.value })
                    }
                    className={`input mt-1 ${control}`}
                  />
                </label>
                <label className="min-w-0 text-sm font-medium sm:col-span-3">
                  {t("reasonLabel")}
                  <input
                    maxLength={200}
                    value={draft.reason}
                    onChange={(event) =>
                      setDraft({ ...draft, reason: event.target.value })
                    }
                    className={`input mt-1 ${control}`}
                  />
                </label>
              </fieldset>
              <p
                id={`${regionId}-time-help`}
                className="text-sm text-slate-500"
              >
                {t("timeHelp")}
              </p>
              <div className="flex flex-wrap gap-2">
                <button className={`btn-primary ${control}`} disabled={busy}>
                  {busy
                    ? t("saving")
                    : coordinator
                      ? t("submitRequest")
                      : t("savePeriod")}
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${control}`}
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setFeedback(null);
                  }}
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}
          {removing && !readOnly && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-950">
                {coordinator ? t("confirmRequestRemove") : t("confirmRemove")}{" "}
                <strong>
                  {dayName(removing.dayOfWeek)} {minToHm(removing.startMin)}–
                  {minToHm(removing.endMin)}
                </strong>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`btn-secondary text-red-700 ${control}`}
                  disabled={busy}
                  onClick={() => {
                    setFeedback(null);
                    remove.mutate({ id: removing.id });
                  }}
                >
                  {busy
                    ? t("saving")
                    : coordinator
                      ? t("submitRequest")
                      : t("confirmRemoveButton")}
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${control}`}
                  disabled={busy}
                  onClick={() => {
                    setRemoving(null);
                    setFeedback(null);
                  }}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
          <Notice feedback={feedback} />
          {!readOnly && (
            <details className="border-t border-slate-200 pt-3">
              <summary
                className={`cursor-pointer content-center text-sm text-slate-600 ${compact}`}
              >
                {t("roomSettings")}
              </summary>
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy && name.trim()) {
                    setFeedback(null);
                    rename.mutate({ id: room.id, name: name.trim() });
                  }
                }}
              >
                <label className="min-w-0 flex-1 text-sm font-medium">
                  {t("colName")}
                  <input
                    className={`input mt-1 ${control}`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </label>
                <button
                  className={`btn-secondary ${control}`}
                  disabled={busy || !name.trim() || name.trim() === room.name}
                >
                  {coordinator ? t("requestRename") : t("renameRoom")}
                </button>
                <button
                  type="button"
                  className={`btn-ghost text-red-700 ${control}`}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        t("confirmDeleteRoom", { name: room.name }),
                      )
                    ) {
                      setFeedback(null);
                      deleteRoom.mutate({ id: room.id });
                    }
                  }}
                >
                  {coordinator ? t("requestDeleteRoom") : t("deleteRoom")}
                </button>
              </form>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

export default function RoomsPage() {
  const t = useTranslations("admin.rooms");
  const viewer = useReadOnly();
  const utils = api.useUtils();
  const rooms = api.admin.rooms.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const me = api.account.me.useQuery(undefined, {
    staleTime: REFERENCE_STALE_TIME,
  });
  const coordinator = me.data?.role === "COORDINATOR";
  const readOnly =
    viewer ||
    !me.data ||
    !["ADMIN", "HEAD", "COORDINATOR"].includes(me.data.role);
  // The management booking grid consumes this same query; invalidate it after
  // live writes so returning to Pairings shows the latest room availability.
  const invalidate = () => utils.admin.rooms.invalidate();
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const create = api.admin.createRoom.useMutation({
    onSuccess: async () => {
      setName("");
      setFeedback({ message: t("saved") });
      await invalidate();
    },
    onError: (error) =>
      setFeedback(
        error.data?.approvalId
          ? { message: t("queued"), requestId: error.data.approvalId }
          : { message: error.message, error: true },
      ),
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-1 max-w-3xl">{t("description")}</p>
      </div>
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        {readOnly
          ? t("viewerHelp")
          : coordinator
            ? t("coordinatorHelp")
            : t("adminHelp")}
      </p>
      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !create.isPending) {
              setFeedback(null);
              create.mutate({ name: name.trim() });
            }
          }}
        >
          <label className="min-w-0 text-sm font-medium">
            {t("namePlaceholder")}
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={`input mt-1 ${control}`}
            />
          </label>
          <button
            className={`btn-primary ${control}`}
            disabled={!name.trim() || create.isPending}
          >
            {coordinator ? t("requestAddRoom") : t("addRoom")}
          </button>
        </form>
      )}
      <Notice feedback={feedback} />
      {(rooms.isLoading || me.isLoading) && (
        <p role="status" className="muted">
          {t("loading")}
        </p>
      )}
      {(rooms.error ?? me.error) && (
        <div role="alert" className="space-y-2 text-sm text-red-700">
          <p>{rooms.error?.message ?? me.error?.message}</p>
          <button
            type="button"
            className={`btn-secondary ${control}`}
            onClick={() => {
              void rooms.refetch();
              void me.refetch();
            }}
          >
            {t("retry")}
          </button>
        </div>
      )}
      <div className="space-y-4">
        {rooms.data?.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            readOnly={readOnly}
            coordinator={coordinator}
            onChanged={invalidate}
          />
        ))}
      </div>
      {rooms.data?.length === 0 && (
        <p className="card p-6 text-sm text-slate-500">{t("empty")}</p>
      )}
    </div>
  );
}
