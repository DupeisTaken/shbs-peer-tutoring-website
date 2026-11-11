"use client";
import { InlineNotice } from "./ui/patterns";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getQueryKey } from "@trpc/react-query";
import {
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  createSessionAccessAuthority,
  reconcileSessionAccessDenied,
  useSessionAccessDenied,
  type SessionAccessAuthority,
  type SessionAccessQuery,
} from "./session-view-state";
import { StatePanel } from "./ui/patterns";
import { Button } from "./ui/button";
import {
  useFormatter,
  useLocale,
  useTranslations,
  useTimeZone,
} from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { useReadOnly } from "./read-only";
import { QueryFeedback } from "./ui/query-feedback";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { localizedPatrolCorrectionError } from "~/lib/patrol-correction-error";
import { viewAccessDenied } from "~/lib/session-view-state";
import {
  getSessionReadReceipts,
  type SessionReadQuery,
} from "~/lib/session-read-receipts";

import { programDateTimeInput, parseProgramDateTime } from "~/lib/program-time";
import {
  programTimeZoneInputLabel,
  programTimeZoneLabel,
} from "~/lib/program-time-zone-label";
type Patrol = RouterOutputs["corrections"]["patrolById"];
type PatrolInput = { cursor: string | undefined };
type PatrolTargetAuthority = {
  access: SessionAccessAuthority;
  binding?: SessionReadQuery;
  denialOrder: number;
  // A target receipt alone cannot authorize the paired room prerequisite.
  concealed: boolean;
};
type PatrolWriteOwner = {
  readonly revision: number;
  readonly lease: { id: string; token: symbol } | null;
  readonly accepted: ReadonlyMap<string, "saved" | "queued">;
  readonly rooms: SessionAccessAuthority;
  readonly targets: ReadonlyMap<string, PatrolTargetAuthority>;
};
type PatrolWriteCommands = {
  acquire: (id: string) => symbol | null;
  release: (token: symbol) => void;
  getLeaseId: () => string | undefined;
  getAccepted: (id: string) => "saved" | "queued" | undefined;
  setAccepted: (id: string, accepted: "saved" | "queued") => void;
  clearAccepted: (id: string) => void;
  isConcealed: (id: string) => boolean;
  refreshTarget: (id: string, error?: unknown) => PatrolTargetAuthority;
  refreshRooms: () => SessionAccessAuthority;
  clearConcealed: (id: string, target: PatrolTargetAuthority) => boolean;
};
const emptyReadSnapshot = () => 0;
const roomsQueryKey = () => getQueryKey(api.admin.rooms, undefined, "query");
const targetQueryKey = (id: string) =>
  getQueryKey(api.corrections.patrolById, { id }, "query");
const historyQueryKey = (input: PatrolInput) => {
  // tRPC's public key input type omits cursor-only inputs as infinite-query
  // inputs. This is a normal query: retain its actual input on the real path.
  const [path, descriptor] = getQueryKey(
    api.corrections.patrols,
    undefined,
    "query",
  );
  return [path, { ...descriptor, input }] as const;
};
function readDescriptor(
  client: QueryClient,
  queryKey: QueryKey,
  denialKey: string,
  valid: (value: unknown) => boolean,
): SessionAccessQuery {
  const query = client.getQueryCache().find({ queryKey, exact: true });
  return {
    queryKey,
    denialKey,
    data: query?.state.data,
    error: query?.state.error,
    status: query?.state.status,
    isSuccess: query?.state.status === "success" && valid(query.state.data),
    isFetching: query?.state.fetchStatus === "fetching",
  };
}
function reconcileTarget(
  client: QueryClient,
  id: string,
  previous?: PatrolTargetAuthority,
  error?: unknown,
): PatrolTargetAuthority {
  const current: PatrolTargetAuthority = previous ?? {
    access: createSessionAccessAuthority(),
    denialOrder: 0,
    concealed: false,
  };
  const queryKey = targetQueryKey(id);
  const query = client.getQueryCache().find({ queryKey, exact: true });
  const ledger = getSessionReadReceipts(client);
  // Preserve the old exact Query's public denial fence before a removed/rebuilt
  // cache binding replaces it. The shared reducer retains the episode itself.
  const denialOrder = Math.max(
    current.denialOrder,
    current.binding && ledger ? ledger.read(current.binding).denialOrder : 0,
    query && ledger ? ledger.read(query).denialOrder : 0,
  );
  const descriptor = readDescriptor(
    client,
    queryKey,
    "patrol-target",
    (value) =>
      !!value && typeof value === "object" && "id" in value && value.id === id,
  );
  const access = reconcileSessionAccessDenied(
    current.access,
    viewAccessDenied(error as { data?: { code?: string } | null })
      ? [descriptor, { error }]
      : [descriptor],
    client,
  );
  const binding = query ?? current.binding;
  const concealed = current.concealed || access.denied;
  return access === current.access &&
    binding === current.binding &&
    denialOrder === current.denialOrder &&
    concealed === current.concealed
    ? current
    : { access, binding, denialOrder, concealed };
}
function reconcileOwner(
  owner: PatrolWriteOwner,
  client: QueryClient,
): PatrolWriteOwner {
  const rooms = reconcileSessionAccessDenied(
    owner.rooms,
    [readDescriptor(client, roomsQueryKey(), "patrol-rooms", Array.isArray)],
    client,
  );
  const targets = new Map(owner.targets);
  let changed = rooms !== owner.rooms;
  for (const [id, previous] of owner.targets) {
    const next = reconcileTarget(client, id, previous);
    if (next !== previous) {
      targets.set(id, next);
      changed = true;
    }
  }
  return changed
    ? { ...owner, revision: owner.revision + 1, rooms, targets }
    : owner;
}
// The stored buckets stay immutable; readers and editors share the same numeric labels.
const HEADCOUNT_LABELS = {
  ZERO: "0",
  ONE: "1",
  TWO: "2",
  THREE: "3",
  FOUR_PLUS: "4+",
};
function PatrolEditor({
  row,
  input,
  historyReady,
  owner,
  commands,
  busy,
  onRetain,
  onAdopt,
  roomsDenied,
  targetDenied,
}: {
  row: Patrol;
  input: PatrolInput;
  historyReady: boolean;
  owner: PatrolWriteOwner;
  commands: PatrolWriteCommands;
  busy: boolean;
  onRetain: (row: Patrol, input: PatrolInput) => void;
  onAdopt: (row: Patrol) => void;
  roomsDenied: boolean;
  targetDenied: boolean;
}) {
  const t = useTranslations("corrections");
  const approvals = useTranslations("approvals");
  const recovery = useTranslations("managementRecovery");
  const timeZone = useTimeZone() ?? "Asia/Shanghai";
  const locale = useLocale();
  // This snapshot owns both field values and the optimistic token. Only a
  // successful explicit reload or accepted-save synchronization replaces it.
  const [snapshot, setSnapshot] = useState<{
    row: Patrol;
    input: PatrolInput;
    timeZone: string;
  }>();
  const [revision, setRevision] = useState(0);
  const [draftTimes, setDraftTimes] = useState<Record<string, string>>({});
  const [draftRooms, setDraftRooms] = useState<
    Record<string, { id: string; name: string }>
  >({});
  const [draftCounts, setDraftCounts] = useState<Record<string, string>>({});
  const [draftNote, setDraftNote] = useState<string>();
  const [draftReason, setDraftReason] = useState("");
  const draftZone = snapshot?.timeZone ?? timeZone;
  const localTime = (date: Date) => programDateTimeInput(date, draftZone);
  const [inputError, setInputError] = useState("");
  const [open, setOpen] = useState(false);
  const accepted = owner.accepted.get(row.id);
  const [readFailed, setReadFailed] = useState(owner.accepted.has(row.id));
  const [reloadFailed, setReloadFailed] = useState(false);
  const ownBusy = owner.lease?.id === row.id;
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const rooms = api.admin.rooms.useQuery(undefined, { enabled: open });
  const roomData = Array.isArray(rooms.data) ? rooms.data : undefined;
  const roomReadFailed =
    !!rooms.error || rooms.data === null || (rooms.isSuccess && !roomData);
  const [lastRoomChoices, setLastRoomChoices] = useState<typeof roomData>();
  if (roomData && !roomsDenied && lastRoomChoices !== roomData)
    setLastRoomChoices(roomData);
  const roomChoices = roomData ?? lastRoomChoices;
  const save = api.corrections.correctPatrol.useMutation();
  const baseline = snapshot?.row;
  const ready =
    historyReady &&
    roomData !== undefined &&
    !roomReadFailed &&
    !roomsDenied &&
    !targetDenied;
  const roomsAvailable =
    baseline?.observations.every((observation) =>
      roomChoices?.some(
        (room) =>
          room.id === (draftRooms[observation.id]?.id ?? observation.roomId),
      ),
    ) ?? false;
  const acquire = () => commands.acquire(row.id);
  const release = (token: symbol) => commands.release(token);
  const readCurrent = async () => {
    const id = snapshot?.row.id ?? row.id;
    const refreshTarget = (error?: unknown) =>
      commands.refreshTarget(id, error);
    const refreshRooms = () => commands.refreshRooms();
    let fresh: Patrol | undefined;
    let targetBinding: SessionReadQuery | undefined;
    let roomBinding: SessionReadQuery | undefined;
    let targetPromise: Promise<unknown> | undefined;
    let roomPromise: Promise<unknown> | undefined;
    // Start invalidations before explicit reads so default cancellation cannot
    // cancel the recovery read. Discovery remains a bounded, independent list.
    await settleRefreshes([
      () => invalidateAndReport(utils.corrections.patrols),
      () => invalidateAndReport(utils.corrections.patrolById),
      async () => {
        const reads = await Promise.allSettled([
          Promise.resolve().then(async () => {
            // Force this existing fetch even when rollback leaves a future-dated
            // cache entry. This marks stale without an extra observer/read.
            await queryClient.invalidateQueries({
              queryKey: roomsQueryKey(),
              exact: true,
              refetchType: "none",
            });
            const pending = utils.admin.rooms.fetch(undefined, {
              staleTime: 0,
            });
            roomBinding = queryClient
              .getQueryCache()
              .find({ queryKey: roomsQueryKey(), exact: true });
            roomPromise = roomBinding?.promise;
            refreshRooms();
            try {
              return await pending;
            } finally {
              refreshRooms();
            }
          }),
          Promise.resolve()
            .then(async () => {
              const pending = utils.corrections.patrolById.fetch(
                { id },
                { staleTime: 0 },
              );
              targetBinding = queryClient
                .getQueryCache()
                .find({ queryKey: targetQueryKey(id), exact: true });
              targetPromise = targetBinding?.promise;
              refreshTarget();
              return await pending;
            })
            .catch((error: unknown) => {
              refreshTarget(error);
              throw error;
            })
            .finally(() => {
              refreshTarget();
            }),
        ]);
        const roomRead = reads[0];
        const targetRead = reads[1];
        if (roomRead.status === "rejected") throw roomRead.reason as unknown;
        if (targetRead.status === "rejected")
          throw targetRead.reason as unknown;
        if (!Array.isArray(roomRead.value) || targetRead.value?.id !== id)
          throw new Error(t("patrolReloadFailed"));
        fresh = targetRead.value;
      },
    ]);
    if (!fresh) throw new Error(t("patrolUnavailable"));
    const target = refreshTarget();
    const roomAuthority = refreshRooms();
    const ledger = getSessionReadReceipts(queryClient);
    // The shared reducer owns denial episodes. This stronger recovery boundary
    // additionally requires BOTH current pair members to have a real receipt:
    // rooms may not themselves have denied when the target denied. Keep each
    // captured retryer, so a later read cannot certify an older returned DTO.
    const pair = [
      [targetBinding, targetQueryKey(id), targetPromise],
      [roomBinding, roomsQueryKey(), roomPromise],
    ] as const;
    const freshPair = pair.every(([binding, queryKey, promise]) => {
      const current = queryClient
        .getQueryCache()
        .find({ queryKey, exact: true });
      const proof = current && ledger?.read(current).proof;
      return (
        current === binding &&
        !!proof &&
        proof.promise === promise &&
        proof.order > target.denialOrder &&
        (proof.firstDenialFence === undefined ||
          proof.firstDenialFence > target.denialOrder)
      );
    });
    if (target.access.denied || roomAuthority.denied || !freshPair)
      throw new Error(t("patrolReloadFailed"));
    if (!commands.clearConcealed(id, target))
      throw new Error(t("patrolReloadFailed"));
    return fresh;
  };
  const adopt = (fresh: Patrol) => {
    onAdopt(fresh);
    setSnapshot({ row: fresh, input: snapshot?.input ?? input, timeZone });
    setDraftTimes({});
    setDraftRooms({});
    setDraftCounts({});
    setDraftNote(undefined);
    setDraftReason("");
    setInputError("");
    setReloadFailed(false);
    setRevision((value) => value + 1);
    save.reset();
  };
  const synchronize = async () => {
    const fresh = await readCurrent();
    setReadFailed(false);
    if (commands.getAccepted(row.id) === "saved") {
      adopt(fresh);
      commands.clearAccepted(row.id);
      setOpen(false);
    }
  };
  const retryAccepted = async () => {
    const token = acquire();
    if (!token) return;
    try {
      await synchronize();
    } catch {
      setReadFailed(true);
    } finally {
      release(token);
    }
  };
  const reload = async () => {
    const token = acquire();
    if (!token) return;
    try {
      const fresh = await readCurrent();
      adopt(fresh);
      commands.clearAccepted(row.id);
      setReadFailed(false);
    } catch {
      setReloadFailed(true);
    } finally {
      release(token);
    }
  };
  if (targetDenied)
    return (
      <StatePanel
        kind="denied"
        title={recovery("denied", { section: t("patrolHistory") })}
        action={
          <Button
            disabled={busy}
            onClick={() =>
              void (accepted === "saved" ? retryAccepted() : reload())
            }
          >
            {accepted === "queued"
              ? t("reloadPatrol")
              : recovery("retry", { section: t("patrolHistory") })}
          </Button>
        }
      />
    );
  return (
    <div className="space-y-3">
      {accepted === "queued" && (
        <InlineNotice tone="warning" announcement="status">
          {approvals("queuedBody")}
        </InlineNotice>
      )}
      {accepted === "saved" && (
        <InlineNotice
          tone="warning"
          announcement="status"
          action={
            <Button disabled={busy} onClick={() => void retryAccepted()}>
              {recovery("retry", { section: t("patrolHistory") })}
            </Button>
          }
        >
          {t(readFailed ? "patrolSavedRefreshFailed" : "patrolSaved")}
        </InlineNotice>
      )}
      {accepted === "queued" && readFailed && (
        <InlineNotice
          tone="warning"
          announcement="status"
          action={
            <Button disabled={busy} onClick={() => void retryAccepted()}>
              {recovery("retry", { section: t("patrolHistory") })}
            </Button>
          }
        >
          {t("patrolQueuedRefreshFailed")}
        </InlineNotice>
      )}
      <details
        open={open}
        onToggle={(e) => {
          if (commands.getLeaseId() === row.id) {
            e.currentTarget.open = open;
            return;
          }
          setOpen(e.currentTarget.open);
          if (e.currentTarget.open && !snapshot) {
            setSnapshot({ row, input, timeZone });
            onRetain(row, input);
          }
        }}
      >
        <summary
          className="link cursor-pointer"
          aria-disabled={ownBusy}
          onClick={(event) => {
            if (commands.getLeaseId() === row.id) event.preventDefault();
          }}
        >
          {t("editPatrol")}
        </summary>
        {open &&
          (roomsDenied ? (
            <StatePanel
              kind="denied"
              title={recovery("denied", { section: t("patrolRooms") })}
              action={
                <Button
                  disabled={busy || rooms.isFetching}
                  onClick={() => void rooms.refetch()}
                >
                  {recovery("retry", { section: t("patrolRooms") })}
                </Button>
              }
            />
          ) : (
            <QueryFeedback
              hasData={roomChoices !== undefined}
              loading={roomChoices === undefined && !roomReadFailed}
              error={!!roomReadFailed}
              retrying={busy || rooms.isFetching}
              loadingTitle={recovery("loading", { section: t("patrolRooms") })}
              errorTitle={recovery(
                roomChoices === undefined ? "loadFailed" : "refreshFailed",
                { section: t("patrolRooms") },
              )}
              retryLabel={recovery("retry", { section: t("patrolRooms") })}
              onRetry={() => void rooms.refetch()}
            />
          ))}
        {baseline && roomChoices && !roomsDenied && (
          <form
            key={revision}
            className="mt-3 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !open ||
                !ready ||
                !roomsAvailable ||
                accepted ||
                commands.getAccepted(row.id) ||
                commands.isConcealed(row.id)
              )
                return;
              const token = acquire();
              if (!token) return;
              const data = new FormData(e.currentTarget);
              const v = (key: string) =>
                typeof data.get(key) === "string"
                  ? (data.get(key) as string)
                  : "";
              try {
                setInputError("");
                await save.mutateAsync({
                  id: baseline.id,
                  expectedUpdatedAt: baseline.updatedAt,
                  reason: v("reason"),
                  note: v("note") || null,
                  observations: baseline.observations.map((o) => ({
                    id: o.id,
                    roomId: v(`room-${o.id}`),
                    headcount: v(`count-${o.id}`) as typeof o.headcount,
                    observedAt:
                      v(`time-${o.id}`) === localTime(o.observedAt)
                        ? o.observedAt
                        : parseProgramDateTime(v(`time-${o.id}`), draftZone),
                  })),
                });
                commands.setAccepted(row.id, "saved");
                try {
                  await synchronize();
                } catch {
                  setReadFailed(true);
                }
              } catch (error) {
                if (queuedApprovalId(error)) {
                  commands.setAccepted(row.id, "queued");
                  try {
                    await synchronize();
                  } catch {
                    setReadFailed(true);
                  }
                } else
                  setInputError(
                    error instanceof Error
                      ? error.message
                      : t("invalidPatrolTime"),
                  );
              } finally {
                release(token);
              }
            }}
          >
            <p className="muted">{t("patrolHelp", { zone: draftZone })}</p>
            {inputError && (
              <p role="alert">
                {localizedPatrolCorrectionError(inputError, t) ?? inputError}
              </p>
            )}
            <fieldset
              className="min-w-0 space-y-3"
              disabled={busy || !ready || !!accepted}
            >
              {baseline.observations.map((o) => (
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
                      value={draftRooms[o.id]?.id ?? o.roomId}
                      onChange={(event) => {
                        const room = roomChoices.find(
                          (candidate) => candidate.id === event.target.value,
                        );
                        if (room)
                          setDraftRooms((previous) => ({
                            ...previous,
                            [o.id]: room,
                          }));
                      }}
                    >
                      {!roomChoices.some(
                        (room) =>
                          room.id === (draftRooms[o.id]?.id ?? o.roomId),
                      ) && (
                        <option value={draftRooms[o.id]?.id ?? o.roomId}>
                          {t("patrolRoomUnavailable", {
                            room: draftRooms[o.id]?.name ?? o.room.name,
                          })}
                        </option>
                      )}
                      {roomChoices.map((r) => (
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
                      value={draftCounts[o.id] ?? o.headcount}
                      onChange={(event) =>
                        setDraftCounts((previous) => ({
                          ...previous,
                          [o.id]: event.target.value,
                        }))
                      }
                    >
                      {Object.entries(HEADCOUNT_LABELS).map(([s, label]) => (
                        <option key={s} value={s}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="label">
                      {
                        // Preserve the known instant (including a repeated DST hour)
                        // until the user actually changes the observation's local time.
                        draftTimes[o.id] === undefined ||
                        draftTimes[o.id] === localTime(o.observedAt)
                          ? programTimeZoneLabel(
                              draftZone,
                              o.observedAt,
                              locale,
                            )
                          : programTimeZoneInputLabel(
                              draftTimes[o.id]!,
                              draftZone,
                              locale,
                            )
                      }
                    </span>
                    <input
                      className="input"
                      name={`time-${o.id}`}
                      type="datetime-local"
                      required
                      value={draftTimes[o.id] ?? localTime(o.observedAt)}
                      onChange={(event) =>
                        setDraftTimes((previous) => ({
                          ...previous,
                          [o.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                </fieldset>
              ))}
              <label className="block">
                <span className="label">{t("comments")}</span>
                <textarea
                  className="input"
                  name="note"
                  value={draftNote ?? baseline.note ?? ""}
                  onChange={(event) => setDraftNote(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">{t("reason")}</span>
                <textarea
                  className="input"
                  name="reason"
                  required
                  value={draftReason}
                  onChange={(event) => setDraftReason(event.target.value)}
                />
              </label>
              <p className="muted text-sm">{approvals("reversalHelp")}</p>
              {!roomsAvailable && (
                <p role="status" className="text-sm text-amber-800">
                  {t("patrolRoomRequired")}
                </p>
              )}
              <button
                className="btn-primary"
                disabled={busy || !ready || !roomsAvailable || !!accepted}
              >
                {t("save")}
              </button>
            </fieldset>
            {reloadFailed && (
              <InlineNotice tone="error" announcement="alert">
                {t("patrolReloadFailed")}
              </InlineNotice>
            )}
            <Button
              disabled={busy || accepted === "saved"}
              onClick={() => void reload()}
            >
              {t("reloadPatrol")}
            </Button>
          </form>
        )}
      </details>
    </div>
  );
}

export type PatrolViewReadState = {
  ready: boolean;
  denied: boolean;
  page: number;
};
export function PatrolCorrections({
  onViewReadState,
}: { onViewReadState?: (state: PatrolViewReadState) => void } = {}) {
  const programFormat = useFormatter();
  const t = useTranslations("corrections");
  const readOnly = useReadOnly();
  const queryClient = useQueryClient();
  const recovery = useTranslations("managementRecovery");
  const [cursors, setCursors] = useState<string[]>([]);
  const input = { cursor: cursors.at(-1) };
  const rows = api.corrections.patrols.useQuery(input);
  const rowData = Array.isArray(rows.data) ? rows.data : undefined;
  const denied = useSessionAccessDenied({
    ...rows,
    isSuccess: rows.isSuccess && !!rowData,
    denialKey: "patrol-history",
    queryKey: historyQueryKey(input),
  });
  const rowReadFailed =
    !!rows.error || rows.data === null || (rows.isSuccess && !rowData);
  const ready = rowData !== undefined && !rowReadFailed && !denied;
  const [lastPages, setLastPages] = useState<Record<string, Patrol[]>>({});
  const readKey = input.cursor ?? "";
  if (rowData && !denied && lastPages[readKey] !== rowData)
    setLastPages({ ...lastPages, [readKey]: rowData });
  const displayData = rowData ?? lastPages[readKey];
  const [owner, setOwner] = useState<PatrolWriteOwner>(() => ({
    revision: 0,
    lease: null,
    accepted: new Map(),
    rooms: createSessionAccessAuthority(),
    targets: new Map(),
  }));
  const ownerEvents = useRef(owner);
  const ledger = getSessionReadReceipts(queryClient);
  const subscribe = useCallback(
    (listener: () => void) => ledger?.subscribe(listener) ?? (() => undefined),
    [ledger],
  );
  const readSnapshot = useCallback(() => ledger?.getSnapshot() ?? 0, [ledger]);
  useSyncExternalStore(subscribe, readSnapshot, emptyReadSnapshot);
  const renderOwner = reconcileOwner(owner, queryClient);
  if (renderOwner !== owner) setOwner(renderOwner);
  // Render uses immutable snapshots. Only events and committed effects touch
  // this synchronous admission mirror. Equal revisions can arise independently;
  // preserve the event snapshot when a stale render has that same revision.
  useLayoutEffect(() => {
    if (ownerEvents.current.revision < renderOwner.revision)
      ownerEvents.current = renderOwner;
  }, [renderOwner]);
  const updateOwner = useCallback(
    (change: (current: PatrolWriteOwner) => PatrolWriteOwner) => {
      const previous = ownerEvents.current;
      const proposed = change(previous);
      if (proposed === previous) return previous;
      const next = { ...proposed, revision: previous.revision + 1 };
      ownerEvents.current = next;
      setOwner(next);
      return next;
    },
    [],
  );
  const commands: PatrolWriteCommands = {
    acquire(id) {
      const token = Symbol(id);
      const next = updateOwner((current) =>
        current.lease ? current : { ...current, lease: { id, token } },
      );
      return next.lease?.token === token ? token : null;
    },
    release(token) {
      updateOwner((current) =>
        current.lease?.token === token ? { ...current, lease: null } : current,
      );
    },
    getLeaseId: () => ownerEvents.current.lease?.id,
    getAccepted: (id) => ownerEvents.current.accepted.get(id),
    setAccepted(id, accepted) {
      updateOwner((current) => ({
        ...current,
        accepted: new Map(current.accepted).set(id, accepted),
      }));
    },
    clearAccepted(id) {
      updateOwner((current) => {
        if (!current.accepted.has(id)) return current;
        const accepted = new Map(current.accepted);
        accepted.delete(id);
        return { ...current, accepted };
      });
    },
    isConcealed: (id) => !!ownerEvents.current.targets.get(id)?.concealed,
    refreshTarget(id, error) {
      const next = updateOwner((current) => {
        const target = reconcileTarget(
          queryClient,
          id,
          current.targets.get(id),
          error,
        );
        return target === current.targets.get(id)
          ? current
          : { ...current, targets: new Map(current.targets).set(id, target) };
      });
      return next.targets.get(id)!;
    },
    refreshRooms() {
      return updateOwner((current) => {
        const rooms = reconcileSessionAccessDenied(
          current.rooms,
          [
            readDescriptor(
              queryClient,
              roomsQueryKey(),
              "patrol-rooms",
              Array.isArray,
            ),
          ],
          queryClient,
        );
        return rooms === current.rooms ? current : { ...current, rooms };
      }).rooms;
    },
    clearConcealed(id, target) {
      const clearedTarget = target.concealed
        ? { ...target, concealed: false }
        : target;
      const next = updateOwner((current) => {
        if (current.targets.get(id) !== target) return current;
        return target.concealed
          ? {
              ...current,
              targets: new Map(current.targets).set(id, clearedTarget),
            }
          : current;
      });
      return next.targets.get(id) === clearedTarget;
    },
  };
  const busy = !!renderOwner.lease;
  const [retainedRows, setRetainedRows] = useState<
    Record<string, { row: Patrol; input: PatrolInput }>
  >({});
  const retain = (row: Patrol, readInput: PatrolInput) =>
    setRetainedRows((previous) =>
      previous[row.id]
        ? previous
        : { ...previous, [row.id]: { row, input: readInput } },
    );
  const adoptRetained = (row: Patrol) =>
    setRetainedRows((previous) =>
      previous[row.id]
        ? { ...previous, [row.id]: { ...previous[row.id]!, row } }
        : previous,
    );
  const targetDenied = (id: string) => !!renderOwner.targets.get(id)?.concealed;
  // An opened owner survives pagination and background list removal. Its pending
  // lease and accepted receipt also live above denial's concealed row content.
  const visibleIds = new Set(displayData?.map((row) => row.id));
  const displayRows = new Map<string, Patrol>(
    displayData?.map((row) => [row.id, row]),
  );
  for (const { row } of Object.values(retainedRows))
    if (!displayRows.has(row.id)) displayRows.set(row.id, row);
  const visible = (id: string) =>
    visibleIds.has(id) ||
    (!!retainedRows[id] && retainedRows[id].input.cursor === input.cursor) ||
    renderOwner.accepted.has(id) ||
    renderOwner.lease?.id === id;
  const page = cursors.length;
  // The Crew page owns scroll. Report readiness and the numeric page only;
  // opaque cursor IDs, patrol evidence and editor drafts remain in this owner.
  useEffect(() => {
    onViewReadState?.({ ready, denied, page });
  }, [onViewReadState, ready, denied, page]);
  if (denied)
    return (
      <section className="card space-y-4 p-5">
        <h2 className="section-title">{t("patrolHistory")}</h2>
        <StatePanel
          kind="denied"
          title={recovery("denied", { section: t("patrolHistory") })}
          action={
            <Button
              disabled={busy || rows.isFetching}
              onClick={() => void rows.refetch()}
            >
              {recovery("retry", { section: t("patrolHistory") })}
            </Button>
          }
        />
      </section>
    );
  return (
    <section className="card space-y-4 p-5">
      <h2 className="section-title">{t("patrolHistory")}</h2>
      <QueryFeedback
        hasData={displayData !== undefined}
        loading={displayData === undefined && !rowReadFailed}
        error={!!rowReadFailed}
        retrying={busy || rows.isFetching}
        loadingTitle={recovery("loading", { section: t("patrolHistory") })}
        errorTitle={recovery(
          displayData === undefined ? "loadFailed" : "refreshFailed",
          { section: t("patrolHistory") },
        )}
        retryLabel={recovery("retry", { section: t("patrolHistory") })}
        onRetry={() => void rows.refetch()}
      />
      {[...displayRows.values()].map((row) => (
        <article
          key={row.id}
          hidden={!visible(row.id)}
          className="space-y-2 border-t border-slate-100 pt-3"
        >
          {!targetDenied(row.id) && (
            <>
              <p className="font-medium">
                {row.crewUser.name} ·{" "}
                {programFormat.dateTime(row.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                · {row.hours} h
              </p>
              <p className="muted">
                {row.observations
                  .map(
                    (o) => `${o.room.name}: ${HEADCOUNT_LABELS[o.headcount]}`,
                  )
                  .join(" · ")}
              </p>
              {ready && !visibleIds.has(row.id) && visible(row.id) && (
                <InlineNotice tone="warning" announcement="status">
                  {t("patrolUnavailable")}
                </InlineNotice>
              )}
            </>
          )}
          {!readOnly && (
            <PatrolEditor
              row={row}
              input={retainedRows[row.id]?.input ?? input}
              historyReady={ready}
              owner={renderOwner}
              commands={commands}
              busy={busy}
              onRetain={retain}
              onAdopt={adoptRetained}
              roomsDenied={renderOwner.rooms.denied}
              targetDenied={targetDenied(row.id)}
            />
          )}
        </article>
      ))}
      {ready &&
        rowData?.length === 0 &&
        ![...displayRows.keys()].some(visible) && (
          <p className="muted">{t("empty")}</p>
        )}
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={busy || !ready || !cursors.length}
          onClick={() => {
            if (commands.getLeaseId() !== undefined) return;
            setCursors((c) => c.slice(0, -1));
          }}
        >
          {t("newer")}
        </button>
        <button
          className="btn-secondary"
          disabled={busy || !ready || rowData?.length !== 50}
          onClick={() => {
            if (commands.getLeaseId() !== undefined) return;
            setCursors((c) => [...c, rowData!.at(-1)!.id]);
          }}
        >
          {t("older")}
        </button>
      </div>
    </section>
  );
}
