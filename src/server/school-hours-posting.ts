import { Prisma } from "../../generated/prisma";

// A finite JS number spans at most 309 integer and 324 fractional decimal
// places. Keep their exact decimal representations, including tiny carry,
// without changing Prisma's shared Decimal configuration.
const PostingDecimal = Prisma.Decimal.clone({ precision: 700 });
const maximum = new PostingDecimal(Number.MAX_VALUE);
const tenth = new PostingDecimal("0.1");

function carryDecimal(value: string) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))
    throw new RangeError("Invalid school-hours carry.");
  let parsed: Prisma.Decimal;
  try {
    parsed = new PostingDecimal(value);
  } catch {
    throw new RangeError("Invalid school-hours carry.");
  }
  if (
    !parsed.isFinite() ||
    parsed.abs().gt(maximum) ||
    parsed.decimalPlaces() > 324 ||
    (parsed.isZero() && /[1-9]/.test(value.split(/e/i)[0]!))
  )
    throw new RangeError("School-hours carry exceeds supported precision.");
  return parsed;
}

/** Ownership merges combine the exact residuals, never their Number projections. */
export function sumSchoolHoursCarry(values: readonly string[]): string {
  const total = values.reduce(
    (sum, value) => sum.plus(carryDecimal(value)),
    new PostingDecimal(0),
  );
  if (total.abs().gt(maximum))
    throw new RangeError("Combined school-hours carry is too large.");
  return total.isZero() ? "0" : total.toString();
}

/** Each issue posts only positive complete tenths and retains the exact balance.
 * Negative balances are carried in full: later earnings repay that debt before
 * any further credit posts. Near a positive tenth, machine roundoff may advance
 * that tenth; its exact residual remains owed, so no source precision is lost. */
export function quantizeSchoolHours(rawChange: number, carryIn = "0") {
  if (!Number.isFinite(rawChange))
    throw new RangeError("School-hours changes must be finite.");
  const available = new PostingDecimal(rawChange).plus(carryDecimal(carryIn));
  if (available.lte(0)) {
    // Never truncate a reversal to tenths or clamp away its outstanding debt.
    if (available.abs().gt(maximum))
      throw new RangeError("School-hours carry exceeds supported precision.");
    return {
      hoursToAdd: 0,
      carryOutHours: available.isZero() ? "0" : available.toString(),
    };
  }
  let posted = available.toDecimalPlaces(1, PostingDecimal.ROUND_DOWN);
  if (!available.eq(posted)) {
    const next = posted.plus(tenth);
    const deficit = next.minus(available).abs();
    // Decimal inputs originated as JS numbers (including fractional durations).
    // Two relative machine epsilons cover the 80/60 then 4/60 boundary tail.
    // This is magnitude-relative, never a fixed epsilon or rounding to zero.
    const boundaryTolerance = next.abs().times(Number.EPSILON).times(2);
    // At very large magnitudes the next tenth is not a representable Number;
    // keep any tiny residual rather than advancing an unrepresentable amount.
    const nextNumber = next.toNumber();
    if (
      Number.isFinite(nextNumber) &&
      new PostingDecimal(nextNumber).eq(next) &&
      deficit.lte(boundaryTolerance)
    )
      posted = next;
  }
  const hoursToAdd = posted.isZero() ? 0 : posted.toNumber();
  if (
    !Number.isFinite(hoursToAdd) ||
    !new PostingDecimal(hoursToAdd).eq(posted)
  )
    throw new RangeError("School-hours posting cannot be represented exactly.");
  const carryOut = available.minus(posted);
  return {
    hoursToAdd,
    carryOutHours: carryOut.isZero() ? "0" : carryOut.toString(),
  };
}
