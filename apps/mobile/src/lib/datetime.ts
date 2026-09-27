import { utcToZonedLocal, zonedLocalToUtc } from "@rental/domain";

/** Wall-clock rental times at the branch ("YYYY-MM-DDTHH:mm"), stepped by whole days and hours. */
export function defaultWindow(timeZone: string, now = new Date()): { start: string; end: string } {
  const startDay = utcToZonedLocal(new Date(now.getTime() + 86_400_000), timeZone).slice(0, 10);
  const endDay = utcToZonedLocal(new Date(now.getTime() + 4 * 86_400_000), timeZone).slice(0, 10);
  return { start: `${startDay}T10:00`, end: `${endDay}T10:00` };
}

export function shiftDays(local: string, days: number): string {
  const [date, time] = local.split("T") as [string, string];
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

export function withHour(local: string, hour: number): string {
  return `${local.slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
}

export function toUtcIso(local: string, timeZone: string): string {
  return zonedLocalToUtc(local, timeZone).toISOString();
}
