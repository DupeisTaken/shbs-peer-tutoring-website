"use client";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatWeekday, minToHm } from "~/lib/time";
import { SummaryTable, TableActions, TableDetails } from "./ui/summary-table";
import { FilterToolbar } from "./ui/patterns";
import { Button, ChoiceButton } from "./ui/button";
import { SectionTabs } from "./ui/section-tabs";
import { ProfileDialog } from "./profile-dialog";
import { ParticipantName } from "./participant-name";

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
  dayOfWeek?: number;
  startMin?: number;
  endMin?: number;
  scheduleConfirmed?: boolean;
  tutor: {
    englishName: string;
    username?: string | null;
    user?: { username?: string | null } | null;
  };
};
type GridBlock = {
  id: string;
  roomId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  reason: string | null;
};
type ScheduleData = {
  rooms: GridRoom[];
  slots: GridSlot[];
  pairings: GridPairing[];
  blocks: GridBlock[];
  highlightTutorId?: string | null;
};
const overlaps = (
  a: { dayOfWeek: number; startMin: number; endMin: number },
  b: { dayOfWeek: number; startMin: number; endMin: number },
) =>
  a.dayOfWeek === b.dayOfWeek && a.startMin < b.endMin && a.endMin > b.startMin;
const slotText = (slot: GridSlot, locale: string) =>
  `${formatWeekday(slot.dayOfWeek, locale)} ${minToHm(slot.startMin)}–${minToHm(slot.endMin)}`;
function pairingMatchesSlot(pairing: GridPairing, slot: GridSlot) {
  return pairing.dayOfWeek !== undefined &&
    pairing.startMin !== undefined &&
    pairing.endMin !== undefined
    ? overlaps(
        {
          dayOfWeek: pairing.dayOfWeek,
          startMin: pairing.startMin,
          endMin: pairing.endMin,
        },
        slot,
      )
    : pairing.timeSlotId === slot.id;
}

/** Both layouts are projections of the same authorized data. Filters never modify booking rules. */
export function RoomGrid(data: ScheduleData) {
  const { rooms, slots, pairings, blocks, highlightTutorId } = data;
  const t = useTranslations("tablePatterns");
  const scheduleText = useTranslations("roomSchedule");
  const locale = useLocale();
  const [view, setView] = useState<"combined" | "individual">("combined");
  // Unchosen defaults derive from arriving data; a deliberate empty selection remains empty.
  const [selection, setSelection] = useState<{
    owner: string;
    ids: string[] | null;
  } | null>(null);
  const owner = highlightTutorId ?? "management";
  const defaultRooms = highlightTutorId
    ? [
        ...new Set(
          pairings
            .filter(
              (pairing) =>
                pairing.tutorId === highlightTutorId && pairing.roomId,
            )
            .map((pairing) => pairing.roomId!),
        ),
      ]
    : null;
  const chosen = selection?.owner === owner ? selection.ids : defaultRooms;
  const setChosen = (
    value: string[] | null | ((before: string[] | null) => string[] | null),
  ) =>
    setSelection({
      owner,
      ids: typeof value === "function" ? value(chosen) : value,
    });
  useEffect(() => {
    setSelection((previous) => (previous?.owner === owner ? previous : null));
  }, [owner]);
  const [details, setDetails] = useState(false);
  const selected = rooms.filter(
    (room) => chosen === null || chosen.includes(room.id),
  );
  const index = useMemo(() => {
    const result = new Map<
      string,
      { occupants: GridPairing[]; blocked: GridBlock[] }
    >();
    for (const room of rooms)
      for (const slot of slots)
        result.set(`${room.id}:${slot.id}`, { occupants: [], blocked: [] });
    for (const pairing of pairings) {
      if (pairing.scheduleConfirmed === false || !pairing.roomId) continue;
      for (const slot of slots) {
        if (pairingMatchesSlot(pairing, slot))
          result.get(`${pairing.roomId}:${slot.id}`)?.occupants.push(pairing);
      }
    }
    for (const block of blocks)
      for (const slot of slots)
        if (overlaps(block, slot))
          result.get(`${block.roomId}:${slot.id}`)?.blocked.push(block);
    return result;
  }, [rooms, slots, pairings, blocks]);
  const intervals = useMemo(
    () =>
      [
        ...new Map(
          slots.map((slot) => [
            `${slot.startMin}:${slot.endMin}`,
            { startMin: slot.startMin, endMin: slot.endMin },
          ]),
        ).values(),
      ].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin),
    [slots],
  );
  const renderCell = (
    room: GridRoom,
    matches: GridSlot[],
    interval?: { dayOfWeek: number; startMin: number; endMin: number },
  ) => {
    const entries = matches.map((slot) => index.get(`${room.id}:${slot.id}`)!);
    const blocked =
      entries.some((entry) => entry.blocked.length) ||
      (!!interval &&
        blocks.some(
          (block) => block.roomId === room.id && overlaps(block, interval),
        ));
    const occupants = [
      ...new Map(
        entries
          .flatMap((entry) => entry.occupants)
          .map((pairing) => [pairing.id, pairing]),
      ).values(),
    ];
    const mine = occupants.some(
      (pairing) => pairing.tutorId === highlightTutorId,
    );
    return (
      <td
        className={`border-b border-l border-slate-100 p-2 text-center align-middle ${blocked || occupants.length ? "bg-slate-100 text-slate-800" : ""}`}
      >
        {blocked ? (
          <span
            aria-label={t("unavailable")}
            title={t("unavailable")}
            className="text-xl font-semibold"
          >
            ×
          </span>
        ) : occupants.length ? (
          <span
            className={mine ? "text-accent-800 font-semibold" : "font-medium"}
          >
            {t("records", { count: occupants.length })}
            <span className="sr-only"> · {scheduleText("occupied")}</span>
          </span>
        ) : matches.length ? (
          <span className="text-slate-500">{t("available")}</span>
        ) : (
          <span className="text-slate-500">{scheduleText("noSlot")}</span>
        )}
      </td>
    );
  };
  if (!rooms.length || !slots.length)
    return (
      <div className="space-y-3">
        <p className="muted">{t(!rooms.length ? "noRooms" : "noSlots")}</p>
        {pairings.length > 0 && (
          <Button onClick={() => setDetails(true)}>
            {scheduleText("allDetails")}
          </Button>
        )}
        {details && (
          <ProfileDialog
            title={t("schedule")}
            size="wide"
            onClose={() => setDetails(false)}
          >
            <ScheduleDetails data={data} />
          </ProfileDialog>
        )}
      </div>
    );
  return (
    <div className="card space-y-4 p-4">
      <FilterToolbar
        label={scheduleText("rooms")}
        actions={
          <>
            <Button size="compact" onClick={() => setChosen(null)}>
              {scheduleText("allRooms")}
            </Button>
            <Button size="compact" onClick={() => setChosen([])}>
              {scheduleText("clearRooms")}
            </Button>
            <Button size="compact" onClick={() => setDetails(true)}>
              {scheduleText("allDetails")}
            </Button>
          </>
        }
      >
        {rooms.map((room) => (
          <ChoiceButton
            key={room.id}
            size="compact"
            selected={chosen === null || chosen.includes(room.id)}
            onClick={() =>
              setChosen((before) => {
                const ids = before ?? rooms.map((item) => item.id);
                return ids.includes(room.id)
                  ? ids.filter((id) => id !== room.id)
                  : [...ids, room.id];
              })
            }
          >
            {room.name}
          </ChoiceButton>
        ))}
      </FilterToolbar>
      <p className="text-sm text-slate-600">{scheduleText("legend")}</p>
      <SectionTabs
        label={t("schedule")}
        value={view}
        onChange={setView}
        items={[
          { value: "combined", label: scheduleText("combined") },
          { value: "individual", label: scheduleText("individual") },
        ]}
      >
        {!selected.length ? (
          <p role="status" className="muted">
            {scheduleText("noSelection")}
          </p>
        ) : view === "combined" ? (
          <SummaryTable label={t("schedule")}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white">{t("slot")}</th>
                {selected.map((room) => (
                  <th key={room.id}>{room.name}</th>
                ))}
                <th className="table-actions-heading">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white p-2 text-left font-medium whitespace-nowrap"
                  >
                    {slotText(slot, locale)}
                  </th>
                  {selected.map((room) => (
                    <SlotCell key={room.id}>
                      {renderCell(room, [slot])}
                    </SlotCell>
                  ))}
                  <TableActions>
                    <TableDetails
                      longReader
                      label={t("schedule")}
                      title={slotText(slot, locale)}
                    >
                      <ScheduleDetails data={data} initialSlot={slot.id} />
                    </TableDetails>
                  </TableActions>
                </tr>
              ))}
            </tbody>
          </SummaryTable>
        ) : (
          <div className="space-y-6">
            {selected.map((room) => (
              <section key={room.id} className="space-y-2">
                <h3 className="font-semibold">{room.name}</h3>
                <SummaryTable label={`${t("schedule")}: ${room.name}`}>
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-white">
                        {scheduleText("time")}
                      </th>
                      {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                        <th key={day}>{formatWeekday(day, locale)}</th>
                      ))}
                      <th className="table-actions-heading">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intervals.map((interval) => (
                      <tr key={`${interval.startMin}:${interval.endMin}`}>
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-white p-2 text-left font-medium whitespace-nowrap"
                        >
                          {minToHm(interval.startMin)}–
                          {minToHm(interval.endMin)}
                        </th>
                        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                          <SlotCell key={day}>
                            {renderCell(
                              room,
                              slots.filter(
                                (slot) =>
                                  slot.dayOfWeek === day &&
                                  slot.startMin === interval.startMin &&
                                  slot.endMin === interval.endMin,
                              ),
                              { ...interval, dayOfWeek: day },
                            )}
                          </SlotCell>
                        ))}
                        <TableActions>
                          <TableDetails
                            longReader
                            title={`${room.name} · ${minToHm(interval.startMin)}–${minToHm(interval.endMin)}`}
                          >
                            <ScheduleDetails
                              data={data}
                              initialRoom={room.id}
                              initialInterval={`${interval.startMin}:${interval.endMin}`}
                            />
                          </TableDetails>
                        </TableActions>
                      </tr>
                    ))}
                  </tbody>
                </SummaryTable>
              </section>
            ))}
          </div>
        )}
      </SectionTabs>
      {details && (
        <ProfileDialog
          title={t("schedule")}
          size="wide"
          onClose={() => setDetails(false)}
        >
          <ScheduleDetails data={data} />
        </ProfileDialog>
      )}
    </div>
  );
}
// A keyed fragment keeps table markup valid without adding DOM wrappers.
function SlotCell({ children }: { children: React.ReactNode }) {
  return children;
}

/** Day/slot/room filters include all authorized records, including copied or missing catalog schedules. */
function ScheduleDetails({
  data,
  initialRoom = "",
  initialSlot = "",
  initialInterval = "",
}: {
  data: ScheduleData;
  initialRoom?: string;
  initialSlot?: string;
  initialInterval?: string;
}) {
  const t = useTranslations("roomSchedule");
  const table = useTranslations("tablePatterns");
  const locale = useLocale();
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState(initialSlot);
  const [room, setRoom] = useState(initialRoom);
  const [interval, setInterval] = useState(initialInterval);
  const intervalOptions = [
    ...new Map(
      data.slots.map((item) => [`${item.startMin}:${item.endMin}`, item]),
    ).entries(),
  ];
  const [rangeStart, rangeEnd] = interval.split(":").map(Number);
  const selectedSlot = data.slots.find((item) => item.id === slot);
  const shown = data.pairings.filter(
    (pairing) =>
      (!room || pairing.roomId === room) &&
      (!interval ||
        ((pairing.startMin ??
          data.slots.find((item) => item.id === pairing.timeSlotId)?.startMin ??
          Infinity) < rangeEnd! &&
          (pairing.endMin ??
            data.slots.find((item) => item.id === pairing.timeSlotId)?.endMin ??
            -Infinity) > rangeStart!)) &&
      (!day ||
        (pairing.dayOfWeek ??
          data.slots.find((item) => item.id === pairing.timeSlotId)
            ?.dayOfWeek) === Number(day)) &&
      (!slot || (!!selectedSlot && pairingMatchesSlot(pairing, selectedSlot))),
  );
  const blocks = data.blocks.filter(
    (block) =>
      (!room || block.roomId === room) &&
      (!day || block.dayOfWeek === Number(day)) &&
      (!selectedSlot || overlaps(block, selectedSlot)) &&
      (!interval || (block.startMin < rangeEnd! && block.endMin > rangeStart!)),
  );
  return (
    <div className="space-y-4">
      <FilterToolbar label={t("detailFilters")}>
        <label>
          <span className="label">{t("time")}</span>
          <select
            className="input control-compact lg:min-h-8 lg:py-1"
            value={interval}
            onChange={(event) => {
              setInterval(event.target.value);
              setSlot("");
            }}
          >
            <option value="">{t("allTimes")}</option>
            {intervalOptions.map(([key, item]) => (
              <option key={key} value={key}>
                {minToHm(item.startMin)}–{minToHm(item.endMin)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">{t("day")}</span>
          <select
            className="input control-compact lg:min-h-8 lg:py-1"
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
              setSlot("");
            }}
          >
            <option value="">{t("allDays")}</option>
            {[1, 2, 3, 4, 5, 6, 7].map((value) => (
              <option key={value} value={value}>
                {formatWeekday(value, locale)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">{table("slot")}</span>
          <select
            className="input control-compact lg:min-h-8 lg:py-1"
            value={slot}
            onChange={(event) => setSlot(event.target.value)}
          >
            <option value="">{t("allSlots")}</option>
            {[1, 2, 3, 4, 5, 6, 7]
              .filter((value) => !day || value === Number(day))
              .map((value) => (
                <optgroup key={value} label={formatWeekday(value, locale)}>
                  {data.slots
                    .filter((item) => item.dayOfWeek === value)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {slotText(item, locale)} · {item.label}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </label>
        <label>
          <span className="label">{t("room")}</span>
          <select
            className="input control-compact lg:min-h-8 lg:py-1"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
          >
            <option value="">{t("allRooms")}</option>
            {data.rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </FilterToolbar>
      {!shown.length && !blocks.length && (
        <p role="status" className="muted">
          {t("emptyDetails")}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="space-y-3">
          {shown.map((pairing) => {
            const saved = data.slots.find(
              (item) => item.id === pairing.timeSlotId,
            );
            return (
              <li
                key={pairing.id}
                className={`rounded-lg border border-slate-200 p-3 ${pairing.tutorId === data.highlightTutorId ? "text-accent-800" : ""}`}
              >
                <p className="font-medium">
                  {pairing.subject} ·{" "}
                  <ParticipantName
                    name={pairing.tutor.englishName}
                    username={
                      pairing.tutor.user?.username ?? pairing.tutor.username
                    }
                  />
                </p>
                <p className="muted mt-1 text-sm">
                  {data.rooms.find((item) => item.id === pairing.roomId)
                    ?.name ?? t("noRoom")}{" "}
                  ·{" "}
                  {pairing.scheduleConfirmed === false
                    ? t("unconfirmed")
                    : pairing.dayOfWeek !== undefined &&
                        pairing.startMin !== undefined &&
                        pairing.endMin !== undefined
                      ? `${formatWeekday(pairing.dayOfWeek, locale)} ${minToHm(pairing.startMin)}–${minToHm(pairing.endMin)}${saved?.dayOfWeek !== pairing.dayOfWeek || saved?.startMin !== pairing.startMin || saved?.endMin !== pairing.endMin ? ` · ${t("outsideCatalog")}` : ""}`
                      : saved
                        ? slotText(saved, locale)
                        : t("outsideCatalog")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {blocks.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold">{table("unavailable")}</h3>
          <ul className="space-y-2">
            {blocks.map((block) => (
              <li key={block.id} className="rounded-lg bg-slate-100 p-3">
                {data.rooms.find((item) => item.id === block.roomId)?.name ??
                  t("noRoom")}{" "}
                · {formatWeekday(block.dayOfWeek, locale)}{" "}
                {minToHm(block.startMin)}–{minToHm(block.endMin)}
                {block.reason ? ` · ${block.reason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
