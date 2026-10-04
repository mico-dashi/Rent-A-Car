import type { BlockKind } from "@rental/types";
import { MINUTE_MS } from "./time";

/** Half-open interval [start, end). */
export interface Range {
  start: Date;
  end: Date;
}

export interface OccupancyBlock {
  id: string;
  vehicleId: string;
  kind: BlockKind;
  period: Range;
  holdExpiresAt: Date | null;
  releasedAt: Date | null;
}

/** Occupancy a rental needs: its own window plus the turnaround buffer after it. */
export function occupancyRange(start: Date, end: Date, bufferMinutes: number): Range {
  if (end <= start) throw new RangeError("end must be after start");
  return { start, end: new Date(end.getTime() + bufferMinutes * MINUTE_MS) };
}

export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

export function isLive(block: OccupancyBlock, now: Date): boolean {
  return block.releasedAt === null && (block.holdExpiresAt === null || block.holdExpiresAt > now);
}

/**
 * Deterministic availability check over a known block set. Used for UI
 * (calendars, drag/drop previews); the database exclusion constraint remains
 * the source of truth at write time.
 */
export function isVehicleFree(vehicleId: string, range: Range, blocks: readonly OccupancyBlock[], now: Date): boolean {
  return !blocks.some((b) => b.vehicleId === vehicleId && isLive(b, now) && overlaps(b.period, range));
}

export function conflictsFor(vehicleId: string, range: Range, blocks: readonly OccupancyBlock[], now: Date): OccupancyBlock[] {
  return blocks.filter((b) => b.vehicleId === vehicleId && isLive(b, now) && overlaps(b.period, range));
}

/** Fraction of vehicle-time occupied in a window (0..1), for dynamic pricing & analytics. */
export function utilization(vehicleIds: readonly string[], window: Range, blocks: readonly OccupancyBlock[], now: Date): number {
  if (vehicleIds.length === 0) return 0;
  const windowMs = window.end.getTime() - window.start.getTime();
  if (windowMs <= 0) return 0;
  let occupied = 0;
  for (const id of vehicleIds) {
    const intervals = blocks
      .filter((b) => b.vehicleId === id && isLive(b, now) && overlaps(b.period, window))
      .map((b) => [Math.max(b.period.start.getTime(), window.start.getTime()), Math.min(b.period.end.getTime(), window.end.getTime())] as const)
      .sort((x, y) => x[0] - y[0]);
    let cursor = -Infinity;
    for (const [s, e] of intervals) {
      const from = Math.max(s, cursor);
      if (e > from) occupied += e - from;
      cursor = Math.max(cursor, e);
    }
  }
  return occupied / (windowMs * vehicleIds.length);
}
