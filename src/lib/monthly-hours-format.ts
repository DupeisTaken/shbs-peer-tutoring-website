/** Report review, saved readers and mail use the same precision. CSV retains
 * the underlying stored number for further accounting. */
export const formatMonthlyHours = (value: number) =>
  Number(value.toFixed(4)).toString();
