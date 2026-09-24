type Row = Record<string, unknown>;
export type ReviewPeriod = {
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  reason: string | null;
};
const record = (value: unknown): Row | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
function period(value: unknown): ReviewPeriod | null {
  const row = record(value);
  if (
    !row ||
    typeof row.dayOfWeek !== "number" ||
    !Number.isInteger(row.dayOfWeek) ||
    row.dayOfWeek < 1 ||
    row.dayOfWeek > 7 ||
    typeof row.startMin !== "number" ||
    !Number.isInteger(row.startMin) ||
    row.startMin < 0 ||
    typeof row.endMin !== "number" ||
    !Number.isInteger(row.endMin) ||
    row.endMin > 1440 ||
    row.startMin >= row.endMin
  )
    return null;
  return {
    dayOfWeek: row.dayOfWeek,
    startMin: row.startMin,
    endMin: row.endMin,
    reason:
      typeof row.reason === "string" && row.reason.trim() ? row.reason : null,
  };
}

/** Read only immutable evidence; never substitute today's room name or schedule
 * into an old proposal. Missing legacy context is explicitly unavailable. */
export function roomBlockReview(
  operation: string,
  payload: unknown,
  targets: unknown,
) {
  const kind =
    operation === "admin.createRoomUnavailability"
      ? "create"
      : operation === "admin.updateRoomUnavailability"
        ? "update"
        : operation === "admin.deleteRoomUnavailability"
          ? "delete"
          : null;
  if (!kind) return null;
  const input = record(payload);
  const evidence = record(targets);
  const rows = (key: string) => {
    const values = evidence?.[key];
    return Array.isArray(values)
      ? values
          .map((value) => record(record(value)?.record ?? value))
          .filter((row): row is Row => !!row)
      : [];
  };
  const original = rows("RoomUnavailability").find(
    (row) => row.id === input?.id,
  );
  const roomId = kind === "create" ? input?.roomId : original?.roomId;
  const context = record(evidence?.roomBlockContext);
  const room =
    context?.id === roomId
      ? context
      : rows("Room").find((row) => row.id === roomId);
  return {
    kind,
    roomName: typeof room?.name === "string" ? room.name : null,
    before: kind === "create" ? null : period(original),
    after: kind === "delete" ? null : period(input),
  };
}
