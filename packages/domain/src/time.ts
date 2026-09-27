/**
 * Time helpers. Timestamps are stored and compared in UTC; calendar logic
 * (weekends, seasons, holidays) is evaluated in the branch's IANA timezone.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export interface Interval {
  start: Date;
  end: Date;
}

export function assertValidInterval({ start, end }: Interval): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new RangeError("Invalid date");
  if (end.getTime() <= start.getTime()) throw new RangeError("end must be after start");
}

/**
 * Billable 24-hour periods. A rental of 24h + grace counts as one day; anything
 * beyond the grace window starts a new day. Minimum 1.
 */
export function billableDays(interval: Interval, graceMinutes = 0): number {
  assertValidInterval(interval);
  const ms = interval.end.getTime() - interval.start.getTime() - graceMinutes * MINUTE_MS;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

export function billableHours(interval: Interval): number {
  assertValidInterval(interval);
  return Math.max(1, Math.ceil((interval.end.getTime() - interval.start.getTime()) / HOUR_MS));
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalDateParts {
  /** YYYY-MM-DD in the given timezone */
  date: string;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  hour: number;
  minute: number;
}

export function localParts(instant: Date, timeZone: string): LocalDateParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** The local calendar date of each billable day's start, in the branch timezone. */
export function rentalDayDates(interval: Interval, days: number, timeZone: string): LocalDateParts[] {
  return Array.from({ length: days }, (_, i) => localParts(new Date(interval.start.getTime() + i * DAY_MS), timeZone));
}

/** Whole years between birth date (YYYY-MM-DD) and a reference instant. */
export function ageOn(dateOfBirth: string, at: Date): number {
  const [y, m, d] = dateOfBirth.split("-").map(Number) as [number, number, number];
  let age = at.getUTCFullYear() - y;
  const beforeBirthday = at.getUTCMonth() + 1 < m || (at.getUTCMonth() + 1 === m && at.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}
