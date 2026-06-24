/**
 * Six-slot discipline meter: a red card fills 3 slots, a yellow fills 1 (so 3 yellow = 1 red, and
 * a full 6 = 2 reds = removal). Only VALID cards count. Shared by the admin discipline page and the
 * tutor attendance form / punishment history — the meter shows the *standing*, never the reasons.
 */
export function DisciplineSlots({
  validRed,
  validYellow,
  size = "md",
}: {
  validRed: number;
  validYellow: number;
  size?: "sm" | "md";
}) {
  let red = validRed * 3;
  let yellow = validYellow;
  const slots = Array.from({ length: 6 }, () => {
    if (red > 0) {
      red--;
      return "red";
    }
    if (yellow > 0) {
      yellow--;
      return "yellow";
    }
    return "empty";
  });
  const box = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  return (
    <span className="inline-flex gap-1 align-middle">
      {slots.map((s, i) => (
        <span
          key={i}
          className={`${box} rounded-sm border ${
            s === "red"
              ? "border-red-600 bg-red-500"
              : s === "yellow"
                ? "border-amber-500 bg-amber-400"
                : "border-slate-200 bg-slate-100"
          }`}
        />
      ))}
    </span>
  );
}
