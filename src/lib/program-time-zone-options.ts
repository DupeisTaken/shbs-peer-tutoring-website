import { isProgramTimeZone } from './program-time';
const fallback=['Asia/Shanghai','Asia/Tokyo','Asia/Singapore','Asia/Kolkata','Europe/London','Europe/Paris','America/New_York','America/Los_Angeles','Australia/Sydney','Pacific/Auckland'];
/** Enumerate on the server so every browser receives the same supported choices. Keep the
 * saved alias (e.g. Asia/Calcutta) selectable even when ICU enumerates its canonical name. */
export function programTimeZoneOptions(current:string):string[] {
  let zones:string[];
  try {zones=Intl.supportedValuesOf('timeZone');} catch {zones=fallback;}
  return [...new Set(['UTC',current,...zones])].filter(isProgramTimeZone).sort();
}
