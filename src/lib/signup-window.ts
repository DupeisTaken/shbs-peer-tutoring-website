/** Pure time-window helpers shared by the public signup UI and its server-side enforcement. */

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** A missing or reached timestamp means the signup form is open. */
export function isSignupWindowOpen(
  opensAt: Date | string | null | undefined,
  now: Date | number = new Date(),
): boolean {
  if (!opensAt) return true;
  return new Date(opensAt).getTime() <= new Date(now).getTime();
}

/** Break a non-negative remaining duration into stable countdown display units. */
export function signupCountdown(
  opensAt: Date | string,
  now: Date | number = new Date(),
): CountdownParts {
  let remainingSeconds = Math.max(
    0,
    Math.ceil((new Date(opensAt).getTime() - new Date(now).getTime()) / 1_000),
  );
  const days = Math.floor(remainingSeconds / 86_400);
  remainingSeconds %= 86_400;
  const hours = Math.floor(remainingSeconds / 3_600);
  remainingSeconds %= 3_600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return { days, hours, minutes, seconds };
}
