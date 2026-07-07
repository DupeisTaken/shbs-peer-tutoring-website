import { DAY_NAMES, minToHm } from "~/lib/time";

type GridRoom = { id: string; name: string };
type GridSlot = {
  id: string;
  label: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
};
type GridPairing = {
  id: string;
  subject: string;
  tutorId: string;
  roomId: string | null;
  timeSlotId: string | null;
  tutor: { englishName: string };
};
type GridBlock = {
  id: string;
  roomId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  reason: string | null;
};

/**
 * Schedule grid: rows are time slots (day + time), columns are rooms. Each cell shows the
 * pairing occupying that room/slot, or a blackout when the room is unavailable then.
 * Presentational only — used by the admin Pairings page and (read-only) the tutor page.
 */
export function RoomGrid({
  rooms,
  slots,
  pairings,
  blocks,
  highlightTutorId,
}: {
  rooms: GridRoom[];
  slots: GridSlot[];
  pairings: GridPairing[];
  blocks: GridBlock[];
  /** When set, pairings for this tutor are emphasised (used on the tutor page). */
  highlightTutorId?: string | null;
}) {
  if (rooms.length === 0 || slots.length === 0) {
    return (
      <p className="muted">
        {rooms.length === 0 ? "No rooms yet." : "No time slots published yet."}
      </p>
    );
  }

  const overlaps = (block: GridBlock, slot: GridSlot) =>
    block.dayOfWeek === slot.dayOfWeek &&
    block.startMin < slot.endMin &&
    block.endMin > slot.startMin;

  return (
    <div className="card overflow-x-auto">
      <table className="min-w-[44rem] border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-slate-200 bg-white p-2 text-left font-semibold text-slate-500">
              Slot
            </th>
            {rooms.map((r) => (
              <th
                key={r.id}
                className="border-b border-l border-slate-200 p-2 font-semibold text-slate-600"
              >
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id}>
              <th className="sticky left-0 z-10 border-b border-slate-100 bg-white p-2 text-left font-medium whitespace-nowrap text-slate-700">
                {DAY_NAMES[slot.dayOfWeek]} {minToHm(slot.startMin)}–
                {minToHm(slot.endMin)}
              </th>
              {rooms.map((room) => {
                const blocked = blocks.find(
                  (b) => b.roomId === room.id && overlaps(b, slot),
                );
                const cellPairings = pairings.filter(
                  (p) => p.roomId === room.id && p.timeSlotId === slot.id,
                );
                return (
                  <td
                    key={room.id}
                    className={`border-b border-l border-slate-100 p-2 align-top ${
                      blocked ? "bg-slate-100 text-slate-400" : ""
                    }`}
                  >
                    {blocked ? (
                      <span title={blocked.reason ?? "Unavailable"}>
                        ✕ {blocked.reason ?? "Unavailable"}
                      </span>
                    ) : cellPairings.length === 0 ? (
                      <span className="text-slate-300">·</span>
                    ) : (
                      cellPairings.map((p) => {
                        const mine =
                          highlightTutorId && p.tutorId === highlightTutorId;
                        return (
                          <div
                            key={p.id}
                            className={`mb-1 rounded px-1.5 py-0.5 ${
                              mine
                                ? "bg-accent-100 text-accent-800 font-medium"
                                : "bg-slate-50 text-slate-700"
                            }`}
                          >
                            {p.subject}
                            <span className="text-slate-400">
                              {" "}
                              · {p.tutor.englishName}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
