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
 * When `timeZone` is given, duration is measured on the branch's wall clock so
 * a DST change never adds or removes a billable day (10:00 -> 10:00 two days
 * later is always 2 days, even if 47 or 49 real hours elapsed).
 */
export function billableDays(interval: Interval, graceMinutes = 0, timeZone?: string): number {
  assertValidInterval(interval);
  const span = timeZone
    ? wallClockMs(interval.end, timeZone) - wallClockMs(interval.start, timeZone)
    : interval.end.getTime() - interval.start.getTime();
  return Math.max(1, Math.ceil((span - graceMinutes * MINUTE_MS) / DAY_MS));
}

/** The instant's local wall-clock time, expressed as if it were UTC (minute precision). */
function wallClockMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const [y, mo, d] = p.date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d, p.hour, p.minute);
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

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock time at a branch ("YYYY-MM-DDTHH:mm") to a UTC instant.
 * Non-existent local times (spring-forward gap) resolve forward; ambiguous
 * times (fall-back overlap) resolve to the earlier instant.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new RangeError(`Invalid local datetime ${local}`);
  const naiveUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Offsets in force a day either side cover both sides of any DST transition.
  const candidates = [-DAY_MS, 0, DAY_MS].map((d) => naiveUtc - zoneOffsetMs(new Date(naiveUtc + d), timeZone));
  const exact = candidates.filter((c) => c + zoneOffsetMs(new Date(c), timeZone) === naiveUtc).sort((a, b) => a - b);
  if (exact.length) return new Date(exact[0]!);
  // In a DST gap: move forward by the gap size.
  return new Date(Math.max(...candidates));
}

/** UTC instant -> "YYYY-MM-DDTHH:mm" wall-clock time at the branch (for <input type="datetime-local">). */
export function utcToZonedLocal(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
