"use client";

import { useTranslations } from "next-intl";
import { DAY_NAMES, minToHm } from "~/lib/time";
import { SummaryTable, TableActions, TableDetails } from "./ui/summary-table";

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
 * Schedule grid: room cells contain only availability/count summaries. Each time slot's
 * rightmost text link reveals full pairings and block reasons in a detail dialog.
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
  const t = useTranslations("tablePatterns");
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
    <div className="card">
      <SummaryTable label={t("schedule")}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-slate-200 bg-white p-2 text-left font-semibold text-slate-500">
              {t("slot")}
            </th>
            {rooms.map((r) => (
              <th
                key={r.id}
                className="border-b border-l border-slate-200 p-2 font-semibold text-slate-600"
              >
                {r.name}
              </th>
            ))}
            <th scope="col" className="table-actions-heading">
              {t("actions")}
            </th>
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
                      <span>{t("unavailable")}</span>
                    ) : cellPairings.length === 0 ? (
                      <span className="text-slate-500">{t("available")}</span>
                    ) : (
                      <span
                        className={
                          cellPairings.some(
                            (p) => p.tutorId === highlightTutorId,
                          )
                            ? "badge-green"
                            : "badge-slate"
                        }
                      >
                        {t("records", { count: cellPairings.length })}
                      </span>
                    )}
                  </td>
                );
              })}
              <TableActions>
                <TableDetails
                  label={t("schedule")}
                  title={`${DAY_NAMES[slot.dayOfWeek]} ${minToHm(slot.startMin)}–${minToHm(slot.endMin)}`}
                >
                  {rooms.map((room) => {
                    const blocked = blocks.find(
                      (b) => b.roomId === room.id && overlaps(b, slot),
                    );
                    const occupants = pairings.filter(
                      (p) => p.roomId === room.id && p.timeSlotId === slot.id,
                    );
                    return (
                      <section
                        key={room.id}
                        className="space-y-2 rounded-lg border border-slate-200 p-4"
                      >
                        <h3 className="font-semibold">{room.name}</h3>
                        {blocked ? (
                          <p>
                            {t("unavailable")}
                            {blocked.reason ? ` · ${blocked.reason}` : ""}
                          </p>
                        ) : occupants.length ? (
                          <ul className="space-y-2">
                            {occupants.map((p) => (
                              <li
                                key={p.id}
                                className={
                                  p.tutorId === highlightTutorId
                                    ? "text-accent-800 font-medium"
                                    : ""
                                }
                              >
                                {p.subject} · {p.tutor.englishName}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">{t("available")}</p>
                        )}
                      </section>
                    );
                  })}
                </TableDetails>
              </TableActions>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
    </div>
  );
}
